"use strict";

/*
    Lokaler Webserver
    -----------------

    Liefert die Dateien aus dem Ordner "www" im Browser aus und fuehrt
    dabei PHP-Seiten aus, sofern PHP im Ordner liegt oder installiert ist.

    Alles laeuft relativ zu dieser Datei. Der Ordner darf also verschoben,
    kopiert oder in einem Drive abgelegt werden - der Server findet sich
    immer selbst.

    Aufruf:
        node server.js
        node server.js --port 3000 --ordner htdocs --netzwerk
*/

const http = require("http");
const fs   = require("fs");
const fsp  = require("fs/promises");
const path = require("path");
const url  = require("url");
const { spawn } = require("child_process");

const ORDNER = __dirname;

/* ===== Einstellungen ===== */

// Einstellungen kommen aus Textdateien neben dem Server (damit sie sich
// per Doppelklick nutzen lassen), aus Umgebungsvariablen oder von der
// Befehlszeile. Die Befehlszeile hat immer das letzte Wort.

function textDatei(name) {

    try {
        const inhalt = fs.readFileSync(path.join(ORDNER, name), "utf8").trim();
        return inhalt === "" ? null : inhalt;
    } catch (fehler) {
        return null;
    }
}

function dateiVorhanden(name) {
    return fs.existsSync(path.join(ORDNER, name));
}

function argument(name) {

    const stelle = process.argv.indexOf("--" + name);

    if (stelle >= 0 && process.argv[stelle + 1] && !process.argv[stelle + 1].startsWith("--")) {
        return process.argv[stelle + 1];
    }

    return null;
}

function schalter(name) {
    return process.argv.indexOf("--" + name) >= 0;
}

/* ===== Einstellungsdatei ===== */

const EINSTELLUNGSDATEI = path.join(ORDNER, "einstellungen.txt");

const VORLAGE = [
    "# Einstellungen fuer den lokalen Webserver",
    "# Nach einer Aenderung den Server neu starten.",
    "",
    "",
    "# Auf welchem Port der Server laeuft.",
    "#",
    "#   8080   ueblich zum Entwickeln:  http://localhost:8080",
    "#   80     dann entfaellt die Portangabe:  http://localhost",
    "#          Achtung: Port 80 ist oft schon belegt, und unter macOS",
    "#          und Linux braucht er besondere Rechte (sudo).",
    "#",
    "# Ist der Port belegt, nimmt der Server von selbst den naechsten freien.",
    "",
    "port = 8080",
    "",
    "",
    "# Welcher Ordner im Browser gezeigt wird - dort gehoeren die",
    "# eigenen Seiten hinein.",
    "",
    "ordner = www",
    "",
    "",
    "# Beim Start den Browser oeffnen?   ja / nein",
    "",
    "browser = ja",
    "",
    "",
    "# Sollen andere Geraete im selben Netz (Handy, Tablet, Kollegen)",
    "# die Seiten auch aufrufen koennen?   ja / nein",
    "# Bei \"nein\" ist der Server nur auf diesem Rechner erreichbar.",
    "",
    "netzwerk = nein",
    "",
    "",
    "# Wenn in einem Ordner keine index.html liegt: den Inhalt des",
    "# Ordners auflisten?   ja / nein",
    "",
    "ordnerliste = ja",
    ""
].join("\r\n");

function einstellungenLesen() {

    const werte = {};

    let inhalt = null;

    try {
        inhalt = fs.readFileSync(EINSTELLUNGSDATEI, "utf8");
    } catch (fehler) {

        // Beim ersten Start eine Vorlage hinlegen, damit sich alles
        // ohne Befehlszeile einstellen laesst.
        try {
            fs.writeFileSync(EINSTELLUNGSDATEI, VORLAGE, "utf8");
        } catch (zweiterFehler) {
            // Schreibgeschuetzter Ordner - dann gelten die Standardwerte
        }

        return werte;
    }

    for (const zeile of inhalt.split(/\r?\n/)) {

        const ohneKommentar = zeile.split("#")[0].trim();

        if (ohneKommentar === "") {
            continue;
        }

        const gleich = ohneKommentar.indexOf("=");

        if (gleich < 0) {
            continue;
        }

        werte[ohneKommentar.slice(0, gleich).trim().toLowerCase()] =
            ohneKommentar.slice(gleich + 1).trim();
    }

    return werte;
}

const DATEI_WERTE = einstellungenLesen();

function jaNein(wert, standard) {

    if (wert === undefined || wert === null || wert === "") {
        return standard;
    }

    const text = String(wert).trim().toLowerCase();

    if (["ja", "j", "an", "ein", "wahr", "true", "1", "yes"].indexOf(text) >= 0) {
        return true;
    }

    if (["nein", "n", "aus", "falsch", "false", "0", "no"].indexOf(text) >= 0) {
        return false;
    }

    return standard;
}

// Reihenfolge: Befehlszeile schlaegt Umgebungsvariable schlaegt
// Einstellungsdatei schlaegt Standardwert.
const EINSTELLUNGEN = {

    port: Number(argument("port") ||
                 process.env.PORT ||
                 DATEI_WERTE.port ||
                 textDatei("port.txt") ||
                 8080),

    ordner: argument("ordner") ||
            process.env.ORDNER ||
            DATEI_WERTE.ordner ||
            textDatei("ordner.txt") ||
            "www",

    imNetzwerk: schalter("netzwerk") ||
                process.env.IM_NETZWERK === "1" ||
                dateiVorhanden("im-netzwerk.txt") ||
                jaNein(DATEI_WERTE.netzwerk, false),

    keinBrowser: schalter("kein-browser") ||
                 process.env.KEIN_BROWSER === "1" ||
                 dateiVorhanden("kein-browser.txt") ||
                 !jaNein(DATEI_WERTE.browser, true),

    keinListing: schalter("kein-listing") ||
                 dateiVorhanden("kein-listing.txt") ||
                 !jaNein(DATEI_WERTE.ordnerliste, true)
};

if (!Number.isInteger(EINSTELLUNGEN.port) ||
    EINSTELLUNGEN.port < 1 || EINSTELLUNGEN.port > 65535) {

    console.error("");
    console.error("  \"port\" muss eine Zahl zwischen 1 und 65535 sein.");
    console.error("  Bitte in \"einstellungen.txt\" berichtigen. Ueblich sind 8080 oder 80.");
    process.exit(1);
}

const WURZEL = path.resolve(ORDNER, EINSTELLUNGEN.ordner);

const ADRESSE = EINSTELLUNGEN.imNetzwerk ? "0.0.0.0" : "127.0.0.1";

/* ===== PHP finden ===== */

// Zuerst ein PHP, das im eigenen Ordner mitliegt - so muss auf dem
// Arbeitsplatz nichts installiert werden. Sonst eines aus dem System.

function phpSuchen() {

    const kandidaten = [
        path.join(ORDNER, "php", "php-cgi.exe"),
        path.join(ORDNER, "php", "php-cgi"),
        path.join(ORDNER, "php-cgi.exe"),
        path.join(ORDNER, "php-cgi")
    ];

    for (const pfad of kandidaten) {
        if (fs.existsSync(pfad)) {
            return pfad;
        }
    }

    // Im System suchen
    const suchbefehl = process.platform === "win32" ? "where" : "which";

    try {

        const ergebnis =
            require("child_process").spawnSync(suchbefehl, ["php-cgi"], { encoding: "utf8" });

        if (ergebnis.status === 0) {
            const erste = ergebnis.stdout.split(/\r?\n/)[0].trim();
            if (erste) {
                return erste;
            }
        }

    } catch (fehler) {
        // Nicht gefunden - PHP bleibt einfach aus
    }

    return null;
}

const PHP = phpSuchen();

/* ===== PHP einsatzbereit machen ===== */

// Ein frisch entpacktes PHP fuer Windows bringt keine "php.ini" mit.
// Ohne sie sind saemtliche Erweiterungen aus - auch SQLite. Deshalb
// legen wir einmalig eine an, wenn PHP im eigenen Ordner liegt.

const PHP_INI_INHALT = [
    "; Von \"Webserver starten\" angelegt.",
    "; Diese Datei darf angepasst werden - sie wird nicht ueberschrieben.",
    "",
    "extension_dir = \"ext\"",
    "",
    "extension=pdo_sqlite",
    "extension=sqlite3",
    "extension=mbstring",
    "extension=openssl",
    "extension=curl",
    "extension=gd",
    "extension=fileinfo",
    "extension=zip",
    "extension=exif",
    "",
    "display_errors = On",
    "error_reporting = E_ALL",
    "",
    "upload_max_filesize = 64M",
    "post_max_size = 64M",
    "max_execution_time = 120",
    "date.timezone = Europe/Berlin",
    ""
].join("\r\n");

function phpIniSicherstellen() {

    if (!PHP) {
        return;
    }

    // Nur bei einem mitgelieferten PHP eingreifen, nie bei einem,
    // das auf dem Rechner installiert ist.
    const phpOrdner = path.dirname(PHP);

    if (!phpOrdner.startsWith(ORDNER)) {
        return;
    }

    const ini = path.join(phpOrdner, "php.ini");

    if (fs.existsSync(ini)) {
        return;
    }

    try {

        fs.writeFileSync(ini, PHP_INI_INHALT, "utf8");

        console.log("");
        console.log("  Hinweis: In " + phpOrdner + " fehlte die \"php.ini\".");
        console.log("  Es wurde eine angelegt, in der unter anderem SQLite");
        console.log("  eingeschaltet ist.");

    } catch (fehler) {
        console.warn("  \"php.ini\" liess sich nicht anlegen: " + fehler.message);
    }
}

// Welche Erweiterungen kann dieses PHP? Wird nur fuer die Startmeldung
// gebraucht und darf deshalb nie den Start aufhalten.
function phpFaehigkeiten() {

    if (!PHP) {
        return null;
    }

    try {

        const ergebnis =
            require("child_process").spawnSync(PHP, ["-n", "-v"], { encoding: "utf8" });

        const version =
            /PHP (\d+\.\d+\.\d+)/.exec(ergebnis.stdout || "");

        const module =
            require("child_process").spawnSync(PHP, ["-m"], { encoding: "utf8" });

        const liste =
            (module.stdout || "").toLowerCase();

        return {
            version: version ? version[1] : null,
            sqlite: liste.includes("pdo_sqlite") || liste.includes("sqlite3")
        };

    } catch (fehler) {
        return null;
    }
}

/* ===== Dateitypen ===== */

const TYPEN = {
    ".html": "text/html; charset=utf-8",
    ".htm":  "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "text/javascript; charset=utf-8",
    ".mjs":  "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml":  "application/xml; charset=utf-8",
    ".txt":  "text/plain; charset=utf-8",
    ".csv":  "text/csv; charset=utf-8",
    ".md":   "text/plain; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico":  "image/x-icon",
    ".bmp":  "image/bmp",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".ogv":  "video/ogg",
    ".mp3":  "audio/mpeg",
    ".wav":  "audio/wav",
    ".ogg":  "audio/ogg",
    ".m4a":  "audio/mp4",
    ".woff":  "font/woff",
    ".woff2": "font/woff2",
    ".ttf":   "font/ttf",
    ".otf":   "font/otf",
    ".pdf":  "application/pdf",
    ".zip":  "application/zip",
    ".wasm": "application/wasm"
};

function typVon(datei) {
    return TYPEN[path.extname(datei).toLowerCase()] || "application/octet-stream";
}

/* ===== Hilfen ===== */

function fehlerSeite(antwort, status, ueberschrift, text) {

    const seite =
        "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\">" +
        "<title>" + status + "</title>" +
        "<style>body{font:15px/1.6 system-ui,sans-serif;max-width:34rem;" +
        "margin:5rem auto;padding:0 1.5rem;color:#1d2430}" +
        "h1{font-size:1.2rem;margin:0 0 .5rem}p{color:#6b7484}" +
        "code{background:#f1f3f6;padding:.1rem .35rem;border-radius:4px}</style>" +
        "<h1>" + ueberschrift + "</h1><p>" + text + "</p>";

    antwort.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
    });

    antwort.end(seite);
}

function entschaerfen(text) {

    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function groesseAnzeigen(bytes) {

    if (bytes < 1024) { return bytes + " B"; }
    if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + " KB"; }
    if (bytes < 1024 * 1024 * 1024) { return (bytes / 1024 / 1024).toFixed(1) + " MB"; }

    return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

// Dateien, die zwar im Ordner liegen duerfen, aber nicht ueber den
// Browser abrufbar sein sollen - allen voran die SQLite-Datenbank.
const GESCHUETZT = [".sqlite", ".sqlite3", ".db", ".db3", ".env", ".ini", ".htaccess"];

function istGeschuetzt(datei) {

    const name = path.basename(datei).toLowerCase();

    if (name === ".env" || name === ".htaccess") {
        return true;
    }

    return GESCHUETZT.indexOf(path.extname(name)) >= 0;
}

// Dateien, die Sync-Dienste und Betriebssysteme anlegen
function istMuell(name) {

    return name === ".DS_Store" ||
           name === "desktop.ini" ||
           name === "Thumbs.db" ||
           name.startsWith("~$") ||
           name.endsWith(".tmp");
}

/* ===== Verzeichnis anzeigen ===== */

async function verzeichnisAnzeigen(antwort, ordner, urlPfad) {

    if (EINSTELLUNGEN.keinListing) {
        fehlerSeite(antwort, 403, "Kein Zugriff",
                    "Die Anzeige von Ordnerinhalten ist abgeschaltet.");
        return;
    }

    const namen =
        (await fsp.readdir(ordner, { withFileTypes: true }))
            .filter(function (eintrag) {
                return !istMuell(eintrag.name) &&
                       (eintrag.isDirectory() || !istGeschuetzt(eintrag.name));
            })
            .sort(function (a, b) {

                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? -1 : 1;
                }

                return a.name.localeCompare(b.name, "de");
            });

    const zeilen = [];

    if (urlPfad !== "/") {
        zeilen.push("<li class=\"o\"><a href=\"..\">&#8593; eine Ebene h&ouml;her</a></li>");
    }

    for (const eintrag of namen) {

        const istOrdner = eintrag.isDirectory();

        let groesse = "";

        if (!istOrdner) {
            try {
                groesse = groesseAnzeigen((await fsp.stat(path.join(ordner, eintrag.name))).size);
            } catch (fehler) {
                groesse = "";
            }
        }

        zeilen.push(
            "<li class=\"" + (istOrdner ? "o" : "d") + "\">" +
            "<a href=\"" + encodeURIComponent(eintrag.name) + (istOrdner ? "/" : "") + "\">" +
            entschaerfen(eintrag.name) + (istOrdner ? "/" : "") + "</a>" +
            "<span>" + groesse + "</span></li>"
        );
    }

    const seite =
        "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<title>" + entschaerfen(urlPfad) + "</title>" +
        "<style>" +
        "body{font:15px/1.6 system-ui,-apple-system,sans-serif;max-width:52rem;" +
        "margin:3rem auto;padding:0 1.5rem;color:#1d2430;background:#fff}" +
        "h1{font-size:1.1rem;font-weight:600;margin:0 0 1.2rem;word-break:break-all}" +
        "ul{list-style:none;padding:0;margin:0;border-top:1px solid #e6e8ed}" +
        "li{display:flex;justify-content:space-between;gap:1rem;padding:.5rem .25rem;" +
        "border-bottom:1px solid #e6e8ed}" +
        "a{color:#1f5fb0;text-decoration:none;overflow-wrap:anywhere}" +
        "a:hover{text-decoration:underline}li.o a{font-weight:600}" +
        "span{color:#8a909c;white-space:nowrap;font-variant-numeric:tabular-nums}" +
        "footer{margin-top:2rem;color:#8a909c;font-size:.83rem}" +
        "@media(prefers-color-scheme:dark){body{background:#15171b;color:#e6e8ec}" +
        "a{color:#7aa7ff}ul,li{border-color:#2b2f36}}" +
        "</style>" +
        "<h1>" + entschaerfen(decodeURIComponent(urlPfad)) + "</h1>" +
        "<ul>" + (zeilen.join("") || "<li class=\"d\"><span>Der Ordner ist leer.</span></li>") + "</ul>" +
        "<footer>Lokaler Webserver &middot; " + entschaerfen(WURZEL) + "</footer>";

    antwort.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
    });

    antwort.end(seite);
}

/* ===== PHP ausfuehren ===== */

function phpAusfuehren(anfrage, antwort, datei, urlPfad, abfrage) {

    // PHP wird als CGI-Programm aufgerufen: Die Angaben zur Anfrage
    // kommen ueber Umgebungsvariablen, der Anfragekoerper ueber die
    // Standardeingabe. Zurueck kommen Kopfzeilen, eine Leerzeile und
    // dann der Seiteninhalt.

    const umgebung = Object.assign({}, process.env, {
        GATEWAY_INTERFACE: "CGI/1.1",
        SERVER_SOFTWARE: "LokalerWebserver",
        SERVER_PROTOCOL: "HTTP/1.1",
        SERVER_NAME: "localhost",
        SERVER_PORT: String(EINSTELLUNGEN.port),
        DOCUMENT_ROOT: WURZEL,
        SCRIPT_FILENAME: datei,
        SCRIPT_NAME: urlPfad,
        REQUEST_URI: anfrage.url,
        REQUEST_METHOD: anfrage.method,
        QUERY_STRING: abfrage || "",
        CONTENT_TYPE: anfrage.headers["content-type"] || "",
        CONTENT_LENGTH: anfrage.headers["content-length"] || "",
        REMOTE_ADDR: anfrage.socket.remoteAddress || "127.0.0.1",
        HTTP_HOST: anfrage.headers.host || "localhost",

        // Ohne diese Angabe verweigert php-cgi aus Sicherheitsgruenden
        // den Dienst ("Security Alert: request not from CGI").
        REDIRECT_STATUS: "200"
    });

    // Alle uebrigen Kopfzeilen der Anfrage weiterreichen
    for (const [name, wert] of Object.entries(anfrage.headers)) {

        const schluessel =
            "HTTP_" + name.toUpperCase().replace(/-/g, "_");

        if (!(schluessel in umgebung)) {
            umgebung[schluessel] = Array.isArray(wert) ? wert.join(", ") : wert;
        }
    }

    const kind =
        spawn(PHP, [], { env: umgebung, cwd: path.dirname(datei) });

    const teile = [];
    const meldungen = [];

    kind.stdout.on("data", function (teil) { teile.push(teil); });
    kind.stderr.on("data", function (teil) { meldungen.push(teil); });

    anfrage.pipe(kind.stdin);

    kind.stdin.on("error", function () {
        // Bricht PHP frueh ab, ist die Eingabe schon zu. Das ist in Ordnung.
    });

    kind.on("error", function (fehler) {

        console.error("  PHP konnte nicht gestartet werden: " + fehler.message);

        if (!antwort.headersSent) {
            fehlerSeite(antwort, 500, "PHP konnte nicht gestartet werden",
                        entschaerfen(fehler.message));
        }
    });

    kind.on("close", function () {

        if (antwort.headersSent) {
            return;
        }

        const ausgabe = Buffer.concat(teile);
        const fehlertext = Buffer.concat(meldungen).toString("utf8").trim();

        if (fehlertext) {
            console.error("  PHP: " + fehlertext);
        }

        // Kopfzeilen vom Inhalt trennen
        let trenner = ausgabe.indexOf("\r\n\r\n");
        let laenge = 4;

        if (trenner < 0) {
            trenner = ausgabe.indexOf("\n\n");
            laenge = 2;
        }

        if (trenner < 0) {

            if (ausgabe.length === 0 && fehlertext) {
                fehlerSeite(antwort, 500, "Fehler in PHP",
                            "<code>" + entschaerfen(fehlertext) + "</code>");
                return;
            }

            // Ohne Kopfzeilen alles als Seiteninhalt behandeln
            antwort.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store"
            });

            antwort.end(ausgabe);
            return;
        }

        const kopfText = ausgabe.slice(0, trenner).toString("utf8");
        const inhalt = ausgabe.slice(trenner + laenge);

        const kopfzeilen = {};
        let status = 200;

        for (const zeile of kopfText.split(/\r?\n/)) {

            const doppelpunkt = zeile.indexOf(":");

            if (doppelpunkt < 0) {
                continue;
            }

            const name = zeile.slice(0, doppelpunkt).trim();
            const wert = zeile.slice(doppelpunkt + 1).trim();

            if (name.toLowerCase() === "status") {
                status = parseInt(wert, 10) || 200;
                continue;
            }

            // Mehrfache Kopfzeilen (etwa Set-Cookie) sammeln
            if (kopfzeilen[name] === undefined) {
                kopfzeilen[name] = wert;
            } else if (Array.isArray(kopfzeilen[name])) {
                kopfzeilen[name].push(wert);
            } else {
                kopfzeilen[name] = [kopfzeilen[name], wert];
            }
        }

        if (!kopfzeilen["Content-Type"] && !kopfzeilen["content-type"]) {
            kopfzeilen["Content-Type"] = "text/html; charset=utf-8";
        }

        kopfzeilen["Cache-Control"] = "no-store";

        antwort.writeHead(status, kopfzeilen);
        antwort.end(inhalt);
    });
}

/* ===== Datei ausliefern ===== */

function dateiSenden(anfrage, antwort, datei, angaben) {

    const typ = typVon(datei);
    const bereich = anfrage.headers.range;

    // Teilbereiche werden fuer Video und Audio gebraucht: Der Browser
    // fragt damit nur den Abschnitt an, den er gerade abspielt.
    if (bereich) {

        const treffer = /^bytes=(\d*)-(\d*)$/.exec(bereich.trim());

        if (treffer) {

            let von = treffer[1] === "" ? null : Number(treffer[1]);
            let bis = treffer[2] === "" ? null : Number(treffer[2]);

            if (von === null && bis !== null) {
                von = Math.max(0, angaben.size - bis);
                bis = angaben.size - 1;
            } else {
                if (von === null) { von = 0; }
                if (bis === null || bis >= angaben.size) { bis = angaben.size - 1; }
            }

            if (von > bis || von >= angaben.size) {

                antwort.writeHead(416, {
                    "Content-Range": "bytes */" + angaben.size
                });

                antwort.end();
                return;
            }

            antwort.writeHead(206, {
                "Content-Type": typ,
                "Content-Length": bis - von + 1,
                "Content-Range": "bytes " + von + "-" + bis + "/" + angaben.size,
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store"
            });

            if (anfrage.method === "HEAD") {
                antwort.end();
                return;
            }

            fs.createReadStream(datei, { start: von, end: bis }).pipe(antwort);
            return;
        }
    }

    antwort.writeHead(200, {
        "Content-Type": typ,
        "Content-Length": angaben.size,
        "Accept-Ranges": "bytes",
        "Last-Modified": angaben.mtime.toUTCString(),

        // Beim Entwickeln soll ein Neuladen immer den neuen Stand zeigen
        "Cache-Control": "no-store, must-revalidate"
    });

    if (anfrage.method === "HEAD") {
        antwort.end();
        return;
    }

    const strom = fs.createReadStream(datei);

    strom.on("error", function () {
        antwort.destroy();
    });

    strom.pipe(antwort);
}

/* ===== Anfragen beantworten ===== */

async function beantworten(anfrage, antwort) {

    if (anfrage.method !== "GET" && anfrage.method !== "HEAD" && anfrage.method !== "POST") {
        fehlerSeite(antwort, 405, "Nicht unterstützt",
                    "Dieser Server beantwortet GET, HEAD und POST.");
        return;
    }

    const zerlegt = url.parse(anfrage.url);

    let urlPfad;

    try {
        urlPfad = decodeURIComponent(zerlegt.pathname);
    } catch (fehler) {
        fehlerSeite(antwort, 400, "Fehlerhafte Adresse", "Die Adresse ist nicht lesbar.");
        return;
    }

    const ziel = path.resolve(WURZEL, "." + urlPfad);

    // Nichts ausserhalb des Ordners ausliefern
    if (ziel !== WURZEL && !ziel.startsWith(WURZEL + path.sep)) {
        fehlerSeite(antwort, 403, "Kein Zugriff",
                    "Diese Adresse liegt ausserhalb des ausgelieferten Ordners.");
        return;
    }

    if (istGeschuetzt(ziel)) {
        fehlerSeite(antwort, 403, "Kein Zugriff",
                    "Datenbanken und Einstellungsdateien werden nicht ausgeliefert.<br><br>" +
                    "Die Datei liegt weiterhin im Ordner und kann von PHP " +
                    "ganz normal geoeffnet werden - nur ueber den Browser " +
                    "herunterladen laesst sie sich nicht.");
        return;
    }

    let angaben;

    try {
        angaben = await fsp.stat(ziel);
    } catch (fehler) {
        fehlerSeite(antwort, 404, "Nicht gefunden",
                    "<code>" + entschaerfen(urlPfad) + "</code> gibt es in " +
                    "<code>" + entschaerfen(path.basename(WURZEL)) + "</code> nicht.");
        return;
    }

    if (angaben.isDirectory()) {

        // Ohne Schrägstrich am Ende zeigen relative Verweise ins Leere
        if (!urlPfad.endsWith("/")) {
            antwort.writeHead(301, { "Location": urlPfad + "/" + (zerlegt.search || "") });
            antwort.end();
            return;
        }

        for (const name of ["index.html", "index.htm", "index.php"]) {

            const startseite = path.join(ziel, name);

            if (fs.existsSync(startseite)) {

                if (name.endsWith(".php")) {

                    if (!PHP) {
                        phpFehlt(antwort);
                        return;
                    }

                    phpAusfuehren(anfrage, antwort, startseite,
                                  urlPfad + name, (zerlegt.query || ""));
                    return;
                }

                dateiSenden(anfrage, antwort, startseite, await fsp.stat(startseite));
                return;
            }
        }

        await verzeichnisAnzeigen(antwort, ziel, urlPfad);
        return;
    }

    if (path.extname(ziel).toLowerCase() === ".php") {

        if (!PHP) {
            phpFehlt(antwort);
            return;
        }

        phpAusfuehren(anfrage, antwort, ziel, urlPfad, (zerlegt.query || ""));
        return;
    }

    dateiSenden(anfrage, antwort, ziel, angaben);
}

function phpFehlt(antwort) {

    fehlerSeite(antwort, 501, "PHP ist nicht eingerichtet",
                "Diese Seite ist eine PHP-Datei, aber es wurde kein PHP gefunden.<br><br>" +
                "Am einfachsten: PHP herunterladen und den entpackten Ordner als " +
                "<code>php</code> neben den Server legen, sodass es " +
                "<code>php/php-cgi.exe</code> gibt. Dann den Server neu starten.");
}

/* ===== Server ===== */

const server = http.createServer(function (anfrage, antwort) {

    const beginn = Date.now();

    antwort.on("finish", function () {

        const zeit = new Date().toLocaleTimeString("de-DE");

        console.log("  " + zeit + "  " + antwort.statusCode + "  " +
                    anfrage.method + " " + anfrage.url +
                    "  (" + (Date.now() - beginn) + " ms)");
    });

    beantworten(anfrage, antwort).catch(function (fehler) {

        console.error("  Fehler:", fehler.message);

        if (!antwort.headersSent) {
            fehlerSeite(antwort, 500, "Fehler im Server", entschaerfen(fehler.message));
        } else {
            antwort.destroy();
        }
    });
});

/* ===== Browser oeffnen ===== */

function browserOeffnen(adresse) {

    if (EINSTELLUNGEN.keinBrowser) {
        return;
    }

    const aufruf =
        process.platform === "win32"  ? { befehl: "cmd",      argumente: ["/c", "start", "", adresse] } :
        process.platform === "darwin" ? { befehl: "open",     argumente: [adresse] } :
                                        { befehl: "xdg-open", argumente: [adresse] };

    try {

        spawn(aufruf.befehl, aufruf.argumente, {
            detached: true,
            stdio: "ignore",
            windowsHide: true
        }).unref();

    } catch (fehler) {
        // Kein Browser da - der Server laeuft trotzdem
    }
}

/* ===== Netzwerkadresse ===== */

function netzwerkAdresse() {

    const schnittstellen = require("os").networkInterfaces();

    for (const liste of Object.values(schnittstellen)) {
        for (const eintrag of liste || []) {
            if (eintrag.family === "IPv4" && !eintrag.internal) {
                return eintrag.address;
            }
        }
    }

    return null;
}

/* ===== Start ===== */

function starten(port, versuche) {

    server.listen(port, ADRESSE);

    server.once("error", function (fehler) {

        if (fehler.code === "EADDRINUSE" && versuche > 0) {

            console.log("  Port " + port + " ist belegt, versuche " + (port + 1) + " ...");

            setTimeout(function () { starten(port + 1, versuche - 1); }, 50);
            return;
        }

        if (fehler.code === "EADDRINUSE") {
            console.error("");
            console.error("  Es ist kein freier Port zu finden.");
            console.error("  In \"einstellungen.txt\" eine andere Zahl bei \"port\" eintragen.");
        } else if (fehler.code === "EACCES") {

            console.error("");
            console.error("  Port " + port + " darf so nicht verwendet werden.");
            console.error("");

            if (port < 1024 && process.platform !== "win32") {
                console.error("  Ports unter 1024 sind auf diesem System besonders");
                console.error("  geschuetzt. Zwei Moeglichkeiten:");
                console.error("");
                console.error("    1. In \"einstellungen.txt\" einen hoeheren Port");
                console.error("       eintragen, zum Beispiel 8080.");
                console.error("    2. Den Server mit erweiterten Rechten starten:");
                console.error("       sudo node server.js");
            } else if (port === 80) {
                console.error("  Port 80 ist auf diesem Rechner belegt - haeufig durch");
                console.error("  IIS, einen anderen Webserver oder Skype.");
                console.error("  In \"einstellungen.txt\" zum Beispiel 8080 eintragen.");
            } else {
                console.error("  In \"einstellungen.txt\" einen anderen Port eintragen.");
            }

        } else {
            console.error("  Fehler:", fehler.message);
        }

        process.exitCode = 1;
    });
}

server.on("listening", function () {

    const port = server.address().port;

    // Bei Port 80 gehoert keine Portangabe in die Adresse
    const adresse =
        port === 80 ? "http://localhost/" : "http://localhost:" + port + "/";

    console.log("");
    console.log("  ======================================================");
    console.log("   LOKALER WEBSERVER laeuft");
    console.log("  ======================================================");
    console.log("");
    console.log("   Adresse   " + adresse);

    if (EINSTELLUNGEN.imNetzwerk) {

        const ip = netzwerkAdresse();

        if (ip) {
            console.log("   Im Netz   http://" + ip + ":" + port + "/");
        }
    }

    console.log("   Ordner    " + WURZEL);

    if (PHP) {

        const koennen = phpFaehigkeiten();

        console.log("   PHP       " +
                    (koennen && koennen.version ? koennen.version + "  " : "") + PHP);

        console.log("   SQLite    " +
                    (koennen === null ? "unbekannt"
                                      : koennen.sqlite ? "einsatzbereit"
                                                       : "aus - siehe php.ini"));

    } else {
        console.log("   PHP       nicht gefunden - HTML, CSS, Bilder gehen trotzdem");
        console.log("   SQLite    braucht PHP");
    }

    console.log("");

    if (port !== EINSTELLUNGEN.port) {
        console.log("   Hinweis: Port " + EINSTELLUNGEN.port + " war belegt.");
        console.log("");
    }

    if (EINSTELLUNGEN.imNetzwerk) {
        console.log("   Achtung: Der Ordner ist fuer alle Geraete im Netzwerk");
        console.log("   erreichbar.");
        console.log("");
    }

    console.log("   Zum Beenden dieses Fenster schliessen oder Strg+C");
    console.log("  ======================================================");
    console.log("");

    browserOeffnen(adresse);
});

if (!fs.existsSync(WURZEL)) {

    try {

        fs.mkdirSync(WURZEL, { recursive: true });

        console.log("");
        console.log("  Der Ordner \"" + EINSTELLUNGEN.ordner + "\" war nicht da und wurde angelegt.");
        console.log("  Die eigenen Seiten gehoeren dort hinein.");

    } catch (fehler) {
        console.error("");
        console.error("  Der Ordner \"" + WURZEL + "\" laesst sich nicht anlegen:");
        console.error("  " + fehler.message);
        process.exit(1);
    }
}

phpIniSicherstellen();

process.on("SIGINT", function () {
    console.log("\n  Der Webserver wurde beendet.\n");
    process.exit(0);
});

starten(EINSTELLUNGEN.port, 20);
