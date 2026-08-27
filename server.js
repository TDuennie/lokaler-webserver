"use strict";

/*
    Urlaubskalender - lokaler Webserver mit gemeinsamer Datei
    ---------------------------------------------------------
    Jeder Arbeitsplatz startet seinen eigenen Server. Alle arbeiten auf
    derselben Datei im MERKUR drive.

    Damit dabei nichts verloren geht:

      * Jeder Eintrag hat eine feste ID und einen Zeitstempel.
      * Vor JEDEM Schreiben wird die Datei frisch von der Platte gelesen
        und die eigene Aenderung hineingemischt - nie einfach ueberschrieben.
      * Geloeschtes wird als geloescht markiert statt entfernt, sonst
        taucht es beim naechsten Abgleich wieder auf.
      * Die Datei wird ueberwacht. Sobald der Sync eine neue Fassung
        bringt, laden alle offenen Browser sie automatisch nach.
      * Konfliktdateien des Sync-Clients werden erkannt und eingemischt.
*/

const http = require("http");
const fs   = require("fs");
const fsp  = require("fs/promises");
const path = require("path");
const os   = require("os");

const ORDNER        = __dirname;
const WEB_ORDNER    = path.join(ORDNER, "web");
const DATEN_ORDNER  = path.join(ORDNER, "daten");
const DATEN_NAME    = "urlaubskalender-daten.json";
const DATEN_DATEI   = path.join(DATEN_ORDNER, DATEN_NAME);
const BACKUP_ORDNER = path.join(DATEN_ORDNER, "backups");

const BACKUPS_BEHALTEN     = 30;
const GELOESCHTES_AUFRAEUMEN_NACH_TAGEN = 90;

// Wie oft zusaetzlich zur Ueberwachung nachgesehen wird (Sync-Ordner
// melden Aenderungen nicht immer zuverlaessig)
const NACHSEHEN_INTERVALL = 5000;

/* ===== Port ===== */

function portErmitteln() {

    const ausUmgebung =
        Number(process.env.PORT);

    if (ausUmgebung > 0) {
        return ausUmgebung;
    }

    const portDatei =
        path.join(ORDNER, "port.txt");

    if (fs.existsSync(portDatei)) {

        const ausDatei =
            Number(fs.readFileSync(portDatei, "utf8").trim());

        if (ausDatei > 0) {
            return ausDatei;
        }
    }

    return 8080;
}

const PORT = portErmitteln();

/* ===== Zustand ===== */

let zustand = {
    version: 0,
    mitarbeiter: [],
    eintraege: []
};

let schreibKette = Promise.resolve();

// Alle offenen Browser, die auf Live-Meldungen warten
const zuhoerer = new Set();

function jetzt() {
    return new Date().toISOString();
}

function neueId() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

class HttpFehler extends Error {

    constructor(status, nachricht) {
        super(nachricht);
        this.status = status;
    }
}

function anAlleVerteilen(ereignis) {

    const block =
        "data: " + JSON.stringify(ereignis) + "\n\n";

    for (const antwort of zuhoerer) {

        try {
            antwort.write(block);
        } catch (fehler) {
            zuhoerer.delete(antwort);
        }
    }
}

/* ===== Datensaetze vereinheitlichen ===== */

function mitarbeiterNormalisieren(roh) {

    return {
        name: String(roh.name),
        aktiv: roh.aktiv !== false,
        geloescht: roh.geloescht === true,
        geaendert: typeof roh.geaendert === "string" ? roh.geaendert : "1970-01-01T00:00:00.000Z"
    };
}

function eintragNormalisieren(roh) {

    return {
        id: roh.id || neueId(),
        mitarbeiter: String(roh.mitarbeiter),
        typ: String(roh.typ),
        von: String(roh.von),
        bis: String(roh.bis),
        vertreter: Array.isArray(roh.vertreter) ? roh.vertreter.map(String) : [],
        geloescht: roh.geloescht === true,
        geaendert: typeof roh.geaendert === "string" ? roh.geaendert : "1970-01-01T00:00:00.000Z"
    };
}

function rohInZustand(roh) {

    const mitarbeiter =
        Array.isArray(roh && roh.mitarbeiter) ? roh.mitarbeiter : [];

    const eintraege =
        Array.isArray(roh && roh.eintraege) ? roh.eintraege : [];

    return {
        version: 0,
        mitarbeiter: mitarbeiter.map(mitarbeiterNormalisieren),
        eintraege: eintraege.map(eintragNormalisieren)
    };
}

/* ===== Zusammenfuehren ===== */

function neuerVon(a, b) {

    // Bei gleichem Zeitstempel gewinnt der bereits vorhandene Datensatz,
    // damit das Ergebnis unabhaengig von der Reihenfolge gleich bleibt.
    return (b.geaendert > a.geaendert) ? b : a;
}

function listeZusammenfuehren(eigene, fremde, schluesselVon) {

    const nachSchluessel = new Map();

    for (const datensatz of eigene) {
        nachSchluessel.set(schluesselVon(datensatz), datensatz);
    }

    for (const datensatz of fremde) {

        const schluessel =
            schluesselVon(datensatz);

        const vorhanden =
            nachSchluessel.get(schluessel);

        nachSchluessel.set(
            schluessel,
            vorhanden ? neuerVon(vorhanden, datensatz) : datensatz
        );
    }

    return Array.from(nachSchluessel.values());
}

function zustaendeZusammenfuehren(eigener, fremder) {

    return {
        version: eigener.version,

        mitarbeiter: listeZusammenfuehren(
            eigener.mitarbeiter,
            fremder.mitarbeiter,
            function (person) { return person.name.toLowerCase(); }
        ),

        eintraege: listeZusammenfuehren(
            eigener.eintraege,
            fremder.eintraege,
            function (eintrag) { return eintrag.id; }
        )
    };
}

function altesAufraeumen(stand) {

    const grenze =
        new Date(Date.now() - GELOESCHTES_AUFRAEUMEN_NACH_TAGEN * 24 * 60 * 60 * 1000)
            .toISOString();

    const behalten = function (datensatz) {
        return !datensatz.geloescht || datensatz.geaendert > grenze;
    };

    stand.mitarbeiter = stand.mitarbeiter.filter(behalten);
    stand.eintraege = stand.eintraege.filter(behalten);

    return stand;
}

/* ===== Sichtbarer Stand fuer den Browser ===== */

function sichtbarerStand(stand) {

    const nichtGeloescht = function (datensatz) {
        return !datensatz.geloescht;
    };

    const ohneVerwaltung = function (datensatz) {

        const kopie = Object.assign({}, datensatz);

        delete kopie.geloescht;

        return kopie;
    };

    return {
        version: stand.version,
        mitarbeiter: stand.mitarbeiter.filter(nichtGeloescht).map(ohneVerwaltung),
        eintraege: stand.eintraege.filter(nichtGeloescht).map(ohneVerwaltung)
    };
}

/* ===== Lesen ===== */

function dateiLesen(pfad) {

    const text =
        fs.readFileSync(pfad, "utf8");

    if (!text || text.trim() === "") {
        return null;
    }

    return rohInZustand(JSON.parse(text));
}

function konfliktDateienEinsammeln() {

    // Der Sync-Client legt bei gleichzeitigen Aenderungen Dateien wie
    // "urlaubskalender-daten (Konfliktkopie ...).json" an. Weil jeder
    // Eintrag eine ID hat, lassen sie sich verlustfrei einmischen.

    const gefunden = [];

    try {

        for (const name of fs.readdirSync(DATEN_ORDNER)) {

            const istKonflikt =
                name !== DATEN_NAME &&
                name.toLowerCase().endsWith(".json") &&
                name.toLowerCase().startsWith("urlaubskalender-daten");

            if (istKonflikt) {
                gefunden.push(path.join(DATEN_ORDNER, name));
            }
        }

    } catch (fehler) {
        // Ordner noch nicht da
    }

    return gefunden;
}

function vonPlatteLesen() {

    let stand = null;

    try {

        if (fs.existsSync(DATEN_DATEI)) {
            stand = dateiLesen(DATEN_DATEI);
        }

    } catch (fehler) {
        console.warn("Datendatei nicht lesbar, bisheriger Stand bleibt:", fehler.message);
        return null;
    }

    if (!stand) {
        stand = { version: 0, mitarbeiter: [], eintraege: [] };
    }

    // Konfliktkopien einmischen und danach wegraeumen
    for (const pfad of konfliktDateienEinsammeln()) {

        try {

            const ausKonflikt =
                dateiLesen(pfad);

            if (ausKonflikt) {

                stand = zustaendeZusammenfuehren(stand, ausKonflikt);

                console.log("Konfliktkopie eingemischt: " + path.basename(pfad));
            }

            fs.renameSync(pfad, path.join(BACKUP_ORDNER, path.basename(pfad)));

        } catch (fehler) {

            try {
                fs.mkdirSync(BACKUP_ORDNER, { recursive: true });
                fs.renameSync(pfad, path.join(BACKUP_ORDNER, path.basename(pfad)));
            } catch (zweiterFehler) {
                console.warn("Konfliktkopie nicht verarbeitbar:", path.basename(pfad));
            }
        }
    }

    return stand;
}

/* ===== Schreiben ===== */

const GESPERRT_CODES = ["EPERM", "EBUSY", "EACCES", "EEXIST"];

async function mitWiederholung(arbeit) {

    // Virenscanner und der Sync-Client greifen unter Windows kurz auf
    // frisch geschriebene Dateien zu. Das aeussert sich als EPERM/EBUSY
    // und ist nach wenigen Millisekunden wieder vorbei.

    const HOECHSTENS = 12;

    for (let versuch = 1; ; versuch++) {

        try {
            return await arbeit();

        } catch (fehler) {

            const nurKurzGesperrt =
                GESPERRT_CODES.indexOf(fehler.code) >= 0;

            if (!nurKurzGesperrt || versuch >= HOECHSTENS) {
                throw fehler;
            }

            await new Promise(function (weiter) {
                setTimeout(weiter, 25 * versuch);
            });
        }
    }
}

let zuletztGeschrieben = "";

async function zustandSchreiben(neuerZustand) {

    await fsp.mkdir(DATEN_ORDNER, { recursive: true });

    const inhalt =
        JSON.stringify({
            mitarbeiter: neuerZustand.mitarbeiter,
            eintraege: neuerZustand.eintraege
        }, null, 2);

    // Erst vollstaendig in eine Nebendatei schreiben, dann umbenennen.
    // So kann die Datendatei nie halb geschrieben zurueckbleiben.

    const temporaer =
        DATEN_DATEI + "." + process.pid + "." + Date.now() + ".sichern";

    try {

        await mitWiederholung(function () {
            return fsp.writeFile(temporaer, inhalt, "utf8");
        });

        await mitWiederholung(function () {
            return fsp.rename(temporaer, DATEN_DATEI);
        });

        zuletztGeschrieben = inhalt;

    } catch (fehler) {

        await fsp.unlink(temporaer).catch(function () {});

        throw fehler;
    }
}

async function backupSchreiben() {

    try {

        const heute =
            new Date().toISOString().slice(0, 10);

        const ziel =
            path.join(BACKUP_ORDNER, "daten-" + heute + ".json");

        if (fs.existsSync(ziel)) {
            return;
        }

        await fsp.mkdir(BACKUP_ORDNER, { recursive: true });
        await fsp.copyFile(DATEN_DATEI, ziel);

        const vorhandene =
            (await fsp.readdir(BACKUP_ORDNER))
                .filter(function (name) { return name.startsWith("daten-"); })
                .sort();

        const zuLoeschen =
            vorhandene.slice(0, Math.max(0, vorhandene.length - BACKUPS_BEHALTEN));

        for (const name of zuLoeschen) {
            await fsp.unlink(path.join(BACKUP_ORDNER, name));
        }

    } catch (fehler) {
        console.warn("Backup fehlgeschlagen:", fehler.message);
    }
}

/* ===== Abgleich mit der Datei ===== */

function standFingerabdruck(stand) {

    return JSON.stringify({
        mitarbeiter: stand.mitarbeiter,
        eintraege: stand.eintraege
    });
}

function vonPlatteAuffrischen() {

    const vonPlatte =
        vonPlatteLesen();

    if (!vonPlatte) {
        return false;
    }

    const vorher =
        standFingerabdruck(zustand);

    const zusammengefuehrt =
        altesAufraeumen(zustaendeZusammenfuehren(zustand, vonPlatte));

    zusammengefuehrt.version = zustand.version;

    const nachher =
        standFingerabdruck(zusammengefuehrt);

    zustand = zusammengefuehrt;

    return vorher !== nachher;
}

function aenderungVonAussenPruefen() {

    return inWarteschlange(async function () {

        const hatSichGeaendert =
            vonPlatteAuffrischen();

        if (!hatSichGeaendert) {
            return;
        }

        zustand.version += 1;

        // Der eigene Stand kann jetzt Dinge enthalten, die noch nicht in
        // der Datei stehen (z.B. aus einer eingemischten Konfliktkopie).
        // Deshalb zurueckschreiben, damit alle denselben Stand bekommen.
        if (standFingerabdruck(zustand) !== zuletztGeschrieben) {
            await zustandSchreiben(zustand).catch(function (fehler) {
                console.warn("Zurueckschreiben nach Abgleich fehlgeschlagen:", fehler.message);
            });
        }

        console.log(new Date().toLocaleTimeString("de-DE") +
                    "  Datei wurde von aussen geaendert - Stand uebernommen");

        anAlleVerteilen({
            art: "aenderung",
            meldung: "Die Daten wurden an einem anderen Arbeitsplatz geändert.",
            absender: null,
            zustand: sichtbarerStand(zustand)
        });
    });
}

function dateiUeberwachen() {

    let anstehend = null;

    const angestossen = function () {

        // Mehrfach ausgeloeste Meldungen zusammenfassen
        clearTimeout(anstehend);

        anstehend = setTimeout(function () {
            aenderungVonAussenPruefen().catch(function (fehler) {
                console.warn("Abgleich fehlgeschlagen:", fehler.message);
            });
        }, 400);
    };

    try {

        // Auf den Ordner hoeren, nicht auf die Datei: beim Ersetzen
        // durch den Sync ginge ein Datei-Wachposten sonst verloren.
        fs.watch(DATEN_ORDNER, function (ereignis, name) {

            if (!name || name.toLowerCase().startsWith("urlaubskalender-daten")) {
                angestossen();
            }
        });

    } catch (fehler) {
        console.warn("Ordner kann nicht ueberwacht werden:", fehler.message);
    }

    // Sicherheitsnetz: Sync-Ordner melden Aenderungen nicht immer
    setInterval(angestossen, NACHSEHEN_INTERVALL).unref();
}

/* ===== Aktionen ===== */

const TYP_TEXT = { U: "Urlaub", K: "Krankheit", P: "Planung" };

function datumAnzeige(datumStr) {

    const teile = datumStr.split("-");

    return teile[2] + "." + teile[1] + "." + teile[0];
}

function eintragBeschreiben(eintrag) {

    const zeitraum =
        eintrag.von === eintrag.bis
        ? datumAnzeige(eintrag.von)
        : datumAnzeige(eintrag.von) + " – " + datumAnzeige(eintrag.bis);

    const vertretung =
        eintrag.vertreter.length > 0
        ? " (Vertretung: " + eintrag.vertreter.join(", ") + ")"
        : "";

    return eintrag.mitarbeiter + " – " +
           (TYP_TEXT[eintrag.typ] || eintrag.typ) + " " +
           zeitraum + vertretung;
}

function eintragPruefen(roh) {

    if (!roh || typeof roh !== "object") {
        throw new HttpFehler(400, "Eintrag fehlt.");
    }

    const name =
        String(roh.mitarbeiter || "").trim();

    if (name === "") {
        throw new HttpFehler(400, "Mitarbeiter fehlt.");
    }

    if (["U", "K", "P"].indexOf(roh.typ) < 0) {
        throw new HttpFehler(400, "Ungueltiger Typ.");
    }

    const datumMuster = /^\d{4}-\d{2}-\d{2}$/;

    if (!datumMuster.test(roh.von) || !datumMuster.test(roh.bis)) {
        throw new HttpFehler(400, "Ungueltiges Datum.");
    }

    if (roh.von > roh.bis) {
        throw new HttpFehler(400, "Das Von-Datum liegt nach dem Bis-Datum.");
    }

    return {
        id: roh.id || null,
        mitarbeiter: name,
        typ: roh.typ,
        von: roh.von,
        bis: roh.bis,
        vertreter: Array.isArray(roh.vertreter) ? roh.vertreter.map(String) : [],
        geloescht: false,
        geaendert: jetzt()
    };
}

function lebendeMitarbeiter(stand) {
    return stand.mitarbeiter.filter(function (p) { return !p.geloescht; });
}

function lebendeEintraege(stand) {
    return stand.eintraege.filter(function (e) { return !e.geloescht; });
}

function aktionAnwenden(stand, aktion) {

    if (!aktion || typeof aktion !== "object") {
        throw new HttpFehler(400, "Aktion fehlt.");
    }

    switch (aktion.art) {

        case "mitarbeiterHinzufuegen": {

            const name =
                String(aktion.name || "").trim();

            if (name === "") {
                throw new HttpFehler(400, "Name fehlt.");
            }

            const vorhanden =
                stand.mitarbeiter.find(function (person) {
                    return person.name.toLowerCase() === name.toLowerCase();
                });

            if (vorhanden && !vorhanden.geloescht) {
                throw new HttpFehler(409, "\"" + name + "\" ist bereits angelegt.");
            }

            if (vorhanden) {

                // War geloescht - wieder aufnehmen
                vorhanden.name = name;
                vorhanden.aktiv = true;
                vorhanden.geloescht = false;
                vorhanden.geaendert = jetzt();

            } else {

                stand.mitarbeiter.push({
                    name: name,
                    aktiv: true,
                    geloescht: false,
                    geaendert: jetzt()
                });
            }

            return "Neuer Mitarbeiter: " + name;
        }

        case "mitarbeiterAktiv": {

            const person =
                lebendeMitarbeiter(stand).find(function (p) {
                    return p.name === aktion.name;
                });

            if (!person) {
                throw new HttpFehler(404, "Mitarbeiter nicht gefunden - bitte Seite neu laden.");
            }

            person.aktiv = Boolean(aktion.aktiv);
            person.geaendert = jetzt();

            return person.name + " ist jetzt " + (person.aktiv ? "aktiv" : "inaktiv");
        }

        case "eintragSpeichern": {

            const eintrag =
                eintragPruefen(aktion.eintrag);

            if (eintrag.id) {

                const index =
                    stand.eintraege.findIndex(function (e) {
                        return e.id === eintrag.id && !e.geloescht;
                    });

                if (index < 0) {
                    throw new HttpFehler(409, "Dieser Eintrag wurde zwischenzeitlich von jemand anderem geloescht.");
                }

                stand.eintraege[index] = eintrag;

                return "Geändert: " + eintragBeschreiben(eintrag);
            }

            eintrag.id = neueId();
            stand.eintraege.push(eintrag);

            return "Neu eingetragen: " + eintragBeschreiben(eintrag);
        }

        case "eintragLoeschen": {

            const eintrag =
                stand.eintraege.find(function (e) {
                    return e.id === aktion.id && !e.geloescht;
                });

            if (!eintrag) {
                return "Der Eintrag war bereits gelöscht.";
            }

            // Als geloescht markieren statt entfernen - sonst brächte
            // der naechste Abgleich ihn wieder zurueck.
            eintrag.geloescht = true;
            eintrag.geaendert = jetzt();

            return "Gelöscht: " + eintragBeschreiben(eintrag);
        }

        case "allesErsetzen": {

            const mitarbeiter =
                Array.isArray(aktion.mitarbeiter) ? aktion.mitarbeiter : null;

            const eintraege =
                Array.isArray(aktion.eintraege) ? aktion.eintraege : null;

            if (!mitarbeiter || !eintraege) {
                throw new HttpFehler(400, "Ungueltiges Format.");
            }

            const zeitpunkt = jetzt();

            const gewollteNamen =
                new Set(mitarbeiter.map(function (p) { return String(p.name).toLowerCase(); }));

            const gewollteIds = new Set();

            // Alles Bisherige als geloescht markieren, dann die
            // gewuenschten Datensaetze wieder aufnehmen. So wird der
            // Import auch bei den anderen Arbeitsplaetzen wirksam.

            for (const person of stand.mitarbeiter) {
                if (!gewollteNamen.has(person.name.toLowerCase()) && !person.geloescht) {
                    person.geloescht = true;
                    person.geaendert = zeitpunkt;
                }
            }

            for (const roh of mitarbeiter) {

                const name = String(roh.name);

                const vorhanden =
                    stand.mitarbeiter.find(function (p) {
                        return p.name.toLowerCase() === name.toLowerCase();
                    });

                if (vorhanden) {
                    vorhanden.name = name;
                    vorhanden.aktiv = roh.aktiv !== false;
                    vorhanden.geloescht = false;
                    vorhanden.geaendert = zeitpunkt;
                } else {
                    stand.mitarbeiter.push({
                        name: name,
                        aktiv: roh.aktiv !== false,
                        geloescht: false,
                        geaendert: zeitpunkt
                    });
                }
            }

            for (const roh of eintraege) {

                const geprueft = eintragPruefen(roh);

                geprueft.id = geprueft.id || neueId();
                geprueft.geaendert = zeitpunkt;

                gewollteIds.add(geprueft.id);

                const index =
                    stand.eintraege.findIndex(function (e) { return e.id === geprueft.id; });

                if (index >= 0) {
                    stand.eintraege[index] = geprueft;
                } else {
                    stand.eintraege.push(geprueft);
                }
            }

            for (const eintrag of stand.eintraege) {
                if (!gewollteIds.has(eintrag.id) && !eintrag.geloescht) {
                    eintrag.geloescht = true;
                    eintrag.geaendert = zeitpunkt;
                }
            }

            return "Alle Daten wurden ersetzt (" +
                   lebendeMitarbeiter(stand).length + " Mitarbeiter, " +
                   lebendeEintraege(stand).length + " Einträge).";
        }

        default:
            throw new HttpFehler(400, "Unbekannte Aktion.");
    }
}

function inWarteschlange(arbeit) {

    // Alle Zugriffe auf die Datei laufen nacheinander ab, damit sich
    // zwei gleichzeitige Klicks nicht ins Gehege kommen.

    const ergebnis =
        schreibKette.then(arbeit, arbeit);

    schreibKette =
        ergebnis.catch(function () {});

    return ergebnis;
}

/* ===== HTTP ===== */

const MIME_TYPEN = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico":  "image/x-icon",
    ".png":  "image/png",
    ".svg":  "image/svg+xml"
};

function jsonSenden(antwort, status, objekt) {

    const inhalt =
        JSON.stringify(objekt);

    antwort.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(inhalt)
    });

    antwort.end(inhalt);
}

function koerperLesen(anfrage) {

    return new Promise(function (resolve, reject) {

        const teile = [];
        let groesse = 0;

        anfrage.on("data", function (teil) {

            groesse += teil.length;

            if (groesse > 5 * 1024 * 1024) {
                reject(new HttpFehler(413, "Anfrage zu gross."));
                anfrage.destroy();
                return;
            }

            teile.push(teil);
        });

        anfrage.on("end", function () {

            try {
                resolve(JSON.parse(Buffer.concat(teile).toString("utf8")));
            } catch (fehler) {
                reject(new HttpFehler(400, "Ungueltiges JSON."));
            }
        });

        anfrage.on("error", reject);
    });
}

function dateiAusliefern(antwort, urlPfad) {

    const relativ =
        urlPfad === "/"
        ? "index.html"
        : decodeURIComponent(urlPfad).replace(/^\/+/, "");

    const ziel =
        path.resolve(WEB_ORDNER, relativ);

    // Ausbrechen aus dem web-Ordner verhindern
    if (ziel !== WEB_ORDNER && !ziel.startsWith(WEB_ORDNER + path.sep)) {
        antwort.writeHead(403).end("Verboten");
        return;
    }

    fs.readFile(ziel, function (fehler, inhalt) {

        if (fehler) {
            antwort.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
                   .end("Nicht gefunden");
            return;
        }

        antwort.writeHead(200, {
            "Content-Type": MIME_TYPEN[path.extname(ziel).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-cache"
        });

        antwort.end(inhalt);
    });
}

const server = http.createServer(function (anfrage, antwort) {

    const pfad =
        anfrage.url.split("?")[0];

    if (pfad === "/api/version") {
        jsonSenden(antwort, 200, { version: zustand.version });
        return;
    }

    if (pfad === "/api/daten") {
        jsonSenden(antwort, 200, sichtbarerStand(zustand));
        return;
    }

    if (pfad === "/api/ereignisse") {

        // Dauerhaft offene Verbindung. Der Server schickt hierueber jede
        // Aenderung sofort an alle Browser - ohne dass die nachfragen muessen.

        antwort.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive"
        });

        antwort.write("retry: 3000\n\n");
        antwort.write("data: " + JSON.stringify({
            art: "verbunden",
            version: zustand.version
        }) + "\n\n");

        zuhoerer.add(antwort);

        // Lebenszeichen, damit Zwischenstellen die Verbindung nicht kappen
        const puls =
            setInterval(function () {
                try {
                    antwort.write(": puls\n\n");
                } catch (fehler) {
                    zuhoerer.delete(antwort);
                }
            }, 25000);

        anfrage.on("close", function () {
            clearInterval(puls);
            zuhoerer.delete(antwort);
        });

        return;
    }

    if (pfad === "/api/aktion") {

        if (anfrage.method !== "POST") {
            jsonSenden(antwort, 405, { fehler: "Nur POST." });
            return;
        }

        // Kennung des Browsers, der die Aenderung ausloest. Damit bekommt
        // genau dieser keine Benachrichtigung ueber die eigene Aktion.
        let aktionAbsender = null;

        koerperLesen(anfrage)
            .then(function (aktion) {

                aktionAbsender =
                    typeof aktion.absender === "string" ? aktion.absender : null;

                return inWarteschlange(async function () {

                    // Zuerst den Stand von der Platte holen. Ein anderer
                    // Arbeitsplatz kann inzwischen etwas geaendert haben.
                    vonPlatteAuffrischen();

                    const entwurf =
                        structuredClone(zustand);

                    const meldung =
                        aktionAnwenden(entwurf, aktion);

                    entwurf.version += 1;

                    // Erst schreiben, dann gilt der neue Stand. Sonst
                    // koennten Arbeitsspeicher und Datei auseinanderlaufen.
                    await zustandSchreiben(entwurf);

                    zustand = entwurf;

                    await backupSchreiben();

                    return { zustand: zustand, meldung: meldung };
                });
            })
            .then(function (ergebnis) {

                console.log(new Date().toLocaleTimeString("de-DE") +
                            "  " + ergebnis.meldung);

                const sichtbar =
                    sichtbarerStand(ergebnis.zustand);

                jsonSenden(antwort, 200, sichtbar);

                // Erst antworten, dann alle anderen Browser benachrichtigen
                anAlleVerteilen({
                    art: "aenderung",
                    meldung: ergebnis.meldung,
                    absender: aktionAbsender,
                    zustand: sichtbar
                });
            })
            .catch(function (fehler) {

                const status =
                    fehler.status || 500;

                if (status >= 500) {
                    console.error("Fehler:", fehler);
                }

                jsonSenden(antwort, status, { fehler: fehler.message });
            });

        return;
    }

    if (anfrage.method !== "GET") {
        antwort.writeHead(405).end("Nur GET");
        return;
    }

    dateiAusliefern(antwort, pfad);
});

/* ===== Protokoll ===== */

const LOG_DATEI = path.join(DATEN_ORDNER, "server-log-" + os.hostname().toLowerCase() + ".txt");

function protokollZeile(text) {

    try {

        fs.mkdirSync(DATEN_ORDNER, { recursive: true });

        // Wird die Datei zu gross, mit dem aktuellen Lauf neu anfangen
        if (fs.existsSync(LOG_DATEI) && fs.statSync(LOG_DATEI).size > 1024 * 1024) {
            fs.writeFileSync(LOG_DATEI, "", "utf8");
        }

        fs.appendFileSync(LOG_DATEI, text + "\r\n", "utf8");

    } catch (fehler) {
        // Das Protokoll ist Beiwerk und darf den Betrieb nie stoeren
    }
}

function protokollAnschliessen() {

    const inspect = require("util").inspect;

    const zuText = function (teile) {
        return teile
            .map(function (t) { return typeof t === "string" ? t : inspect(t); })
            .join(" ");
    };

    const echtesLog = console.log;
    const echtesError = console.error;
    const echtesWarn = console.warn;

    console.log = function () {
        const text = zuText([].slice.call(arguments));
        echtesLog(text);
        protokollZeile(text);
    };

    console.error = function () {
        const text = zuText([].slice.call(arguments));
        echtesError(text);
        protokollZeile("FEHLER  " + text);
    };

    console.warn = function () {
        const text = zuText([].slice.call(arguments));
        echtesWarn(text);
        protokollZeile("WARNUNG " + text);
    };
}

/* ===== Start ===== */

function browserOeffnen(adresse) {

    // Abschalten, indem eine leere Datei "kein-browser.txt" angelegt wird
    if (process.env.KEIN_BROWSER === "1" ||
        fs.existsSync(path.join(ORDNER, "kein-browser.txt"))) {
        return;
    }

    const ziel =
        adresse || ("http://localhost:" + PORT);

    // Windows startet ueber cmd, macOS ueber open, Linux ueber xdg-open.
    const aufruf =
        process.platform === "win32"  ? { befehl: "cmd",      argumente: ["/c", "start", "", ziel] } :
        process.platform === "darwin" ? { befehl: "open",     argumente: [ziel] } :
                                        { befehl: "xdg-open", argumente: [ziel] };

    try {

        require("child_process")
            .spawn(aufruf.befehl, aufruf.argumente, {
                detached: true,
                stdio: "ignore",
                windowsHide: true
            })
            .unref();

    } catch (fehler) {
        console.warn("Browser konnte nicht geoeffnet werden:", fehler.message);
    }
}

function startmeldung() {

    console.log("");
    console.log("  ============================================================");
    console.log("   URLAUBSKALENDER laeuft");
    console.log("  ============================================================");
    console.log("");
    console.log("     http://localhost:" + PORT);
    console.log("");
    console.log("   Gemeinsame Datei:");
    console.log("   " + DATEN_DATEI);
    console.log("");
    console.log("   Aenderungen der Kolleginnen und Kollegen werden");
    console.log("   automatisch uebernommen, sobald der MERKUR drive sie");
    console.log("   hergebracht hat.");
    console.log("");
    console.log("   Zum Beenden dieses Fenster schliessen oder Strg+C druecken.");
    console.log("  ============================================================");
    console.log("");

    browserOeffnen();
}

function starten() {

    const vonPlatte =
        vonPlatteLesen();

    zustand = altesAufraeumen(vonPlatte || { version: 0, mitarbeiter: [], eintraege: [] });
    zustand.version = 1;

    zuletztGeschrieben = standFingerabdruck(zustand);

    console.log("Geladen: " + lebendeMitarbeiter(zustand).length + " Mitarbeiter, " +
                lebendeEintraege(zustand).length + " Eintraege");

    server.listen(PORT, "127.0.0.1", function () {
        dateiUeberwachen();
        startmeldung();
    });
}

server.on("error", function (fehler) {

    if (fehler.code === "EADDRINUSE") {
        console.log("");
        console.log("  Der Urlaubskalender laeuft auf diesem Rechner bereits.");
        console.log("  Er wird im Browser geoeffnet.");
        console.log("");

        browserOeffnen();

        process.exit(0);
    }

    console.error("  FEHLER:", fehler.message);
    process.exitCode = 1;
});

protokollAnschliessen();

console.log("");
console.log("--- Start " + new Date().toLocaleString("de-DE") + " ---");

starten();
