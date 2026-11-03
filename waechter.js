"use strict";

/*
    Waechter fuer den lokalen Webserver
    ----------------------------------

    Startet server.js und passt auf ihn auf:

      - Stuerzt der Server ab, startet er ihn neu.
      - Alle 30 Sekunden fragt er nach, ob der Server noch antwortet.
        Bleibt die Antwort zweimal aus, haengt er - dann wird er
        beendet und neu gestartet.
      - Alle Meldungen landen mit Uhrzeit in "protokoll/server.log".
      - In "protokoll/status.json" steht der aktuelle Zustand. Das
        Symbol in der Taskleiste liest ihn von dort.
      - Legt jemand die Datei "protokoll/neustart" an (das tut das
        Symbol bei "Server neu starten"), startet er den Server neu.

    Eingerichtet wird er mit "Als Dienst einrichten.cmd" - dann startet
    er mit Windows, auch ohne dass jemand angemeldet ist.

    Aufruf von Hand (zum Ausprobieren, Meldungen erscheinen dann auch
    im Fenster):
        node waechter.js
*/

const fs    = require("fs");
const path  = require("path");
const http  = require("http");
const https = require("https");
const { fork } = require("child_process");

const ORDNER = __dirname;

const PROTOKOLL_ORDNER = path.join(ORDNER, "protokoll");
const PROTOKOLL        = path.join(PROTOKOLL_ORDNER, "server.log");
const STATUS           = path.join(PROTOKOLL_ORDNER, "status.json");
const NEUSTART         = path.join(PROTOKOLL_ORDNER, "neustart");

const PRUEF_ABSTAND   = 30 * 1000;
const PRUEF_ZEITLIMIT = 10 * 1000;
const FEHLVERSUCHE    = 2;
const START_ZEITLIMIT = 60 * 1000;

// Laeuft der Server so lange, gilt er als stabil - danach wird nach
// einem Absturz wieder sofort neu gestartet statt mit Wartezeit
const STABIL_NACH = 5 * 60 * 1000;
const WARTEZEIT_MAX = 60 * 1000;

const PROTOKOLL_MAX = 5 * 1024 * 1024;
const PROTOKOLL_ALTE = 3;

/* ===== Protokoll ===== */

fs.mkdirSync(PROTOKOLL_ORDNER, { recursive: true });

let protokollGroesse = 0;

try {
    protokollGroesse = fs.statSync(PROTOKOLL).size;
} catch (fehler) {
    // Noch keins da
}

function zeitstempel() {

    const jetzt = new Date();
    const zwei = function (zahl) { return String(zahl).padStart(2, "0"); };

    return jetzt.getFullYear() + "-" + zwei(jetzt.getMonth() + 1) + "-" + zwei(jetzt.getDate()) +
           " " + zwei(jetzt.getHours()) + ":" + zwei(jetzt.getMinutes()) + ":" + zwei(jetzt.getSeconds());
}

// Waechst das Protokoll ueber 5 MB, wird es weggeschoben:
// server.log -> server.1.log -> server.2.log -> server.3.log
function protokollWeiterschieben() {

    try {

        for (let nummer = PROTOKOLL_ALTE - 1; nummer >= 1; nummer--) {

            const alt = path.join(PROTOKOLL_ORDNER, "server." + nummer + ".log");

            if (fs.existsSync(alt)) {
                fs.renameSync(alt, path.join(PROTOKOLL_ORDNER, "server." + (nummer + 1) + ".log"));
            }
        }

        fs.renameSync(PROTOKOLL, path.join(PROTOKOLL_ORDNER, "server.1.log"));
        protokollGroesse = 0;

    } catch (fehler) {
        // Gerade geoeffnet, etwa im Editor - dann beim naechsten Mal
    }
}

function protokoll(text) {

    const zeile = zeitstempel() + "  " + text + "\r\n";

    if (process.stdout.isTTY) {
        process.stdout.write(zeile);
    }

    try {

        fs.appendFileSync(PROTOKOLL, zeile);
        protokollGroesse += Buffer.byteLength(zeile);

        if (protokollGroesse > PROTOKOLL_MAX) {
            protokollWeiterschieben();
        }

    } catch (fehler) {
        // Protokoll nicht beschreibbar - der Server laeuft trotzdem weiter
    }
}

// Die Ausgabe des Servers kommt in Stuecken, nicht zeilenweise
function zeilenweise(strom) {

    let rest = "";

    strom.setEncoding("utf8");

    strom.on("data", function (teil) {

        const zeilen = (rest + teil).split(/\r?\n/);
        rest = zeilen.pop();

        for (const zeile of zeilen) {
            if (zeile.trim() !== "") {
                protokoll("  " + zeile.replace(/^\s+/, ""));
            }
        }
    });

    strom.on("end", function () {
        if (rest.trim() !== "") {
            protokoll("  " + rest.trim());
        }
    });
}

/* ===== Zustand ===== */

const zustand = {
    zustand: "startet",
    meldung: "",
    port: null,
    schema: null,
    seit: null,
    neustarts: 0
};

function statusSchreiben() {

    const inhalt = JSON.stringify(Object.assign({}, zustand, {
        waechter: process.pid,
        aktualisiert: new Date().toISOString(),
        // Als Zahl, damit das Taskleisten-Symbol nicht Datumstexte deuten muss
        aktualisiertMs: Date.now()
    }), null, 2);

    const zwischen = STATUS + ".tmp";

    try {
        fs.writeFileSync(zwischen, inhalt);
        fs.renameSync(zwischen, STATUS);
    } catch (fehler) {

        // Liest das Symbol die Datei gerade, klappt das Umbenennen unter
        // Windows nicht immer - dann direkt schreiben
        try {
            fs.writeFileSync(STATUS, inhalt);
        } catch (zweiterFehler) {
            // Beim naechsten Mal
        }
    }
}

function setzen(neuerZustand, meldung) {

    zustand.zustand = neuerZustand;
    zustand.meldung = meldung || "";

    statusSchreiben();
}

/* ===== Nur ein Waechter ===== */

function laeuftSchon() {

    try {

        const alt = JSON.parse(fs.readFileSync(STATUS, "utf8"));

        if (alt.zustand === "beendet" || alt.waechter === process.pid ||
            Date.now() - alt.aktualisiertMs > 90 * 1000) {
            return false;
        }

        // Wirft, wenn es den Prozess nicht mehr gibt
        process.kill(alt.waechter, 0);
        return true;

    } catch (fehler) {
        return false;
    }
}

if (laeuftSchon()) {
    console.log("");
    console.log("  Der Waechter laeuft schon - ein zweiter wird nicht gestartet.");
    console.log("");
    process.exit(0);
}

/* ===== Server starten und ueberwachen ===== */

let kind = null;
let startZeitpunkt = 0;
let startUhr = null;
let fehlversuche = 0;
let wartezeit = 2000;
let sofortNeu = false;
let wirdBeendet = false;

function starten() {

    if (wirdBeendet) {
        return;
    }

    fehlversuche = 0;
    startZeitpunkt = Date.now();
    zustand.port = null;

    setzen("startet", "Server wird gestartet");
    protokoll("Server wird gestartet");

    kind = fork(path.join(ORDNER, "server.js"), process.argv.slice(2), {
        cwd: ORDNER,
        env: Object.assign({}, process.env, { KEIN_BROWSER: "1" }),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true
    });

    const diesesKind = kind;

    zeilenweise(diesesKind.stdout);
    zeilenweise(diesesKind.stderr);

    startUhr = setTimeout(function () {

        if (kind === diesesKind && zustand.zustand === "startet") {
            protokoll("Der Server hat sich nach " + (START_ZEITLIMIT / 1000) +
                      " Sekunden nicht bereit gemeldet - Neustart");
            kindBeenden(diesesKind);
        }

    }, START_ZEITLIMIT);

    diesesKind.on("message", function (nachricht) {

        if (nachricht && nachricht.bereit) {

            clearTimeout(startUhr);

            zustand.port = nachricht.port;
            zustand.schema = nachricht.schema;
            zustand.seit = new Date().toISOString();

            setzen("laeuft", "");
            protokoll("Server laeuft auf " + nachricht.schema + "://localhost:" + nachricht.port + "/");
        }
    });

    diesesKind.on("error", function (fehler) {
        protokoll("Fehler beim Start des Servers: " + fehler.message);
    });

    diesesKind.on("exit", function (code, signal) {

        clearTimeout(startUhr);

        if (kind === diesesKind) {
            kind = null;
        }

        if (wirdBeendet) {
            return;
        }

        const lief = Date.now() - startZeitpunkt;

        // Nach einem gewollten Neustart oder einem langen, stabilen Lauf
        // sofort wieder starten. Stuerzt er dagegen gleich wieder ab, die
        // Wartezeit jedes Mal verdoppeln, damit sich nichts aufschaukelt.
        if (sofortNeu || lief > STABIL_NACH) {
            wartezeit = 2000;
        } else {
            wartezeit = Math.min(wartezeit * 2, WARTEZEIT_MAX);
        }

        const grund = sofortNeu ? "fuer den Neustart beendet"
                                : "beendet (" + (signal || "Code " + code) + ")";

        if (!sofortNeu) {
            zustand.neustarts++;
        }

        sofortNeu = false;

        setzen("gestoert", "Server " + grund);
        protokoll("Server " + grund + " - neuer Start in " + Math.round(wartezeit / 1000) + " s");

        setTimeout(starten, wartezeit);
    });
}

// Erst freundlich, und reagiert er nicht, nach 5 Sekunden hart.
// (Unter Windows ist schon das erste kill() endgueltig.)
function kindBeenden(welches) {

    welches.kill();

    setTimeout(function () {
        if (welches.exitCode === null && welches.signalCode === null) {
            welches.kill("SIGKILL");
        }
    }, 5000).unref();
}

function neuStarten(grund) {

    protokoll(grund);

    if (kind) {
        sofortNeu = true;
        kindBeenden(kind);
    } else {
        starten();
    }
}

/* ===== Nachfragen, ob er noch antwortet ===== */

function nachfragen() {

    if (!kind || zustand.zustand !== "laeuft" || !zustand.port) {
        return;
    }

    const modul = zustand.schema === "https" ? https : http;
    let erledigt = false;

    function ergebnis(gut, warum) {

        if (erledigt) {
            return;
        }

        erledigt = true;

        if (gut) {

            if (fehlversuche > 0) {
                protokoll("Server antwortet wieder");
            }

            fehlversuche = 0;
            return;
        }

        fehlversuche++;
        protokoll("Server antwortet nicht (" + warum + "), Versuch " + fehlversuche + " von " + FEHLVERSUCHE);

        if (fehlversuche >= FEHLVERSUCHE && kind) {
            zustand.neustarts++;
            setzen("gestoert", "Server antwortet nicht");
            neuStarten("Server haengt - wird neu gestartet");
        }
    }

    const anfrage = modul.get({
        host: "127.0.0.1",
        port: zustand.port,
        path: "/_status",
        timeout: PRUEF_ZEITLIMIT,
        // Selbst erstelltes Zertifikat - hier geht es nur ums Lebenszeichen
        rejectUnauthorized: false
    }, function (antwort) {
        antwort.resume();
        ergebnis(antwort.statusCode === 200, "Status " + antwort.statusCode);
    });

    anfrage.on("timeout", function () {
        anfrage.destroy(new Error("keine Antwort nach " + (PRUEF_ZEITLIMIT / 1000) + " s"));
    });

    anfrage.on("error", function (fehler) {
        ergebnis(false, fehler.message);
    });
}

setInterval(nachfragen, PRUEF_ABSTAND);

/* ===== Neustart auf Wunsch, Lebenszeichen ===== */

setInterval(function () {

    if (fs.existsSync(NEUSTART)) {

        try {
            fs.unlinkSync(NEUSTART);
        } catch (fehler) {
            // Dann beim naechsten Mal - nicht zweimal neu starten
            return;
        }

        neuStarten("Neustart angefordert");
    }

}, 2000);

// Damit das Symbol erkennt, dass der Waechter selbst noch lebt
setInterval(statusSchreiben, 10 * 1000);

/* ===== Beenden ===== */

function beenden() {

    if (wirdBeendet) {
        return;
    }

    wirdBeendet = true;

    protokoll("Waechter wird beendet");
    setzen("beendet", "Der Webserver wurde beendet");

    if (kind) {
        kind.kill();
    }

    setTimeout(function () { process.exit(0); }, 500);
}

process.on("SIGINT", beenden);
process.on("SIGTERM", beenden);
process.on("SIGBREAK", beenden);

process.on("uncaughtException", function (fehler) {

    protokoll("Fehler im Waechter: " + (fehler && fehler.stack || fehler));

    if (kind) {
        kind.kill();
    }

    // Die Aufgabenplanung startet ihn dann neu
    process.exit(1);
});

protokoll("Waechter gestartet (" + ORDNER + ")");
starten();
