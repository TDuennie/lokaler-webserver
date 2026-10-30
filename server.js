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
    "",
    "",
    "# Verschluesselt ueber https:// statt http://?   ja / nein",
    "# Ueblich ist dann Port 443 - so entfaellt die Portangabe.",
    "#",
    "# Ohne eigenes Zertifikat erstellt der Server selbst eines. Der",
    "# Browser warnt dann, bis das Stammzertifikat aus dem Ordner",
    "# \"zertifikat\" einmal auf dem Geraet installiert ist.",
    "",
    "https = nein",
    "",
    "",
    "# Ein Zertifikat der eigenen IT statt des selbst erstellten:",
    "# Pfad zu einer .pfx-Datei, oder zu einer .crt-Datei mit einer",
    "# gleichnamigen .key-Datei daneben.",
    "#",
    "#   zertifikat = zertifikat/server.pfx",
    "#   zertifikat-passwort = geheim",
    "",
    "",
    "# Weitere Namen fuer das selbst erstellte Zertifikat, durch Komma",
    "# getrennt. Rechnername und IP-Adressen stehen schon von selbst drin.",
    "#",
    "#   namen = planer.firma.local",
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
                 !jaNein(DATEI_WERTE.ordnerliste, true),

    https: schalter("https") ||
           process.env.HTTPS === "1" ||
           jaNein(DATEI_WERTE.https, false),

    zertifikat: argument("zertifikat") ||
                process.env.ZERTIFIKAT ||
                DATEI_WERTE.zertifikat ||
                "",

    zertifikatPasswort: process.env.ZERTIFIKAT_PASSWORT ||
                        DATEI_WERTE["zertifikat-passwort"] ||
                        "",

    // Weitere Namen, unter denen der Server erreichbar ist, etwa
    // "planer.firma.local" - kommen mit ins selbst erstellte Zertifikat
    namen: (argument("namen") || DATEI_WERTE.namen || "")
               .split(/[,;\s]+/).filter(Boolean)
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

const SCHEMA = EINSTELLUNGEN.https ? "https" : "http";

/* ===== HTTPS-Zertifikat ===== */

// Fuer https braucht der Server ein Zertifikat. Bringt die IT eines mit,
// wird das genommen. Sonst erstellt der Server selbst eine kleine eigene
// Zertifizierungsstelle (Stammzertifikat) und damit ein Zertifikat fuer
// sich. Das Stammzertifikat wird einmal auf den Geraeten installiert -
// danach vertrauen sie jedem Zertifikat, das der Server sich ausstellt,
// auch wenn er es spaeter wegen einer neuen IP-Adresse erneuert.
//
// Erzeugt wird alles mit Node.js selbst, ohne OpenSSL.

const crypto = require("crypto");
const os     = require("os");

const ZERTIFIKAT_ORDNER = path.join(ORDNER, "zertifikat");

const STAMM_ZERTIFIKAT = path.join(ZERTIFIKAT_ORDNER, "stammzertifikat.crt");
const STAMM_SCHLUESSEL = path.join(ZERTIFIKAT_ORDNER, "stammzertifikat.key");
// Das Server-Zertifikat je Rechner, falls mehrere Arbeitsplaetze den
// Server aus demselben Sync-Ordner starten - das Stammzertifikat teilen sie
const RECHNER = os.hostname().toLowerCase().replace(/[^a-z0-9.-]/g, "_");
const SERVER_ZERTIFIKAT = path.join(ZERTIFIKAT_ORDNER, "server-" + RECHNER + ".crt");
const SERVER_SCHLUESSEL = path.join(ZERTIFIKAT_ORDNER, "server-" + RECHNER + ".key");

// Unter dieser Adresse laesst sich das Stammzertifikat herunterladen,
// etwa am iPad, um es dort zu installieren
const ZERTIFIKAT_PFAD = "/_zertifikat";

// Kleine Bausteine fuer das Binaerformat von Zertifikaten (DER/ASN.1)

function asn1(kennung, inhalt) {

    const laenge = inhalt.length;
    let kopf;

    if (laenge < 0x80) {
        kopf = Buffer.from([kennung, laenge]);
    } else {

        const bytes = [];

        for (let rest = laenge; rest > 0; rest = Math.floor(rest / 256)) {
            bytes.unshift(rest & 0xff);
        }

        kopf = Buffer.from([kennung, 0x80 | bytes.length].concat(bytes));
    }

    return Buffer.concat([kopf, inhalt]);
}

function folge(...teile) {
    return asn1(0x30, Buffer.concat(teile));
}

function menge(...teile) {
    return asn1(0x31, Buffer.concat(teile));
}

function ganzzahl(bytes) {

    // Ein gesetztes oberstes Bit hiesse "negativ"
    return asn1(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function kennzeichen(text) {

    const zahlen = text.split(".").map(Number);
    const bytes = [zahlen[0] * 40 + zahlen[1]];

    for (const zahl of zahlen.slice(2)) {

        const gruppe = [zahl & 0x7f];

        for (let rest = Math.floor(zahl / 128); rest > 0; rest = Math.floor(rest / 128)) {
            gruppe.unshift((rest & 0x7f) | 0x80);
        }

        bytes.push(...gruppe);
    }

    return asn1(0x06, Buffer.from(bytes));
}

function zeitpunkt(datum) {

    const text = datum.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";

    // Bis 2049 als UTCTime mit zweistelligem Jahr, danach GeneralizedTime
    return datum.getUTCFullYear() < 2050
        ? asn1(0x17, Buffer.from(text.slice(2)))
        : asn1(0x18, Buffer.from(text));
}

function namensfeld(gemeinsamerName) {

    return folge(
        menge(folge(kennzeichen("2.5.4.10"), asn1(0x0c, Buffer.from("Lokaler Webserver")))),
        menge(folge(kennzeichen("2.5.4.3"), asn1(0x0c, Buffer.from(gemeinsamerName))))
    );
}

function erweiterung(oid, kritisch, inhalt) {

    return folge(
        kennzeichen(oid),
        kritisch ? asn1(0x01, Buffer.from([0xff])) : Buffer.alloc(0),
        asn1(0x04, inhalt)
    );
}

function ipBytes(adresse) {

    if (adresse.indexOf(":") < 0) {
        return Buffer.from(adresse.split(".").map(Number));
    }

    // IPv6, auch in Kurzschreibweise wie ::1
    const [vorne, hinten] = adresse.split("::");
    const links  = vorne ? vorne.split(":") : [];
    const rechts = hinten !== undefined && hinten ? hinten.split(":") : [];
    const gruppen = hinten === undefined
        ? links
        : links.concat(new Array(8 - links.length - rechts.length).fill("0"), rechts);

    return Buffer.concat(gruppen.map(function (gruppe) {
        const zahl = parseInt(gruppe, 16);
        return Buffer.from([zahl >> 8, zahl & 0xff]);
    }));
}

function zertifikatAusstellen(angaben) {

    const sha256mitRsa = folge(kennzeichen("1.2.840.113549.1.1.11"), asn1(0x05, Buffer.alloc(0)));

    const seriennummer = crypto.randomBytes(16);
    seriennummer[0] &= 0x7f;

    const oeffentlich = angaben.oeffentlich.export({ type: "spki", format: "der" });
    const eigeneKennung = crypto.createHash("sha1").update(oeffentlich).digest();

    const erweiterungen = [
        erweiterung("2.5.29.19", true, angaben.stelle
            ? folge(asn1(0x01, Buffer.from([0xff])), ganzzahl(Buffer.from([0])))
            : folge()),
        erweiterung("2.5.29.15", true, angaben.stelle
            // keyCertSign, cRLSign
            ? asn1(0x03, Buffer.from([0x01, 0x06]))
            // digitalSignature, keyEncipherment
            : asn1(0x03, Buffer.from([0x05, 0xa0]))),
        erweiterung("2.5.29.14", false, asn1(0x04, eigeneKennung))
    ];

    if (!angaben.stelle) {

        // Nur fuer Webserver, mit Verweis auf das Stammzertifikat
        erweiterungen.push(
            erweiterung("2.5.29.37", false, folge(kennzeichen("1.3.6.1.5.5.7.3.1"))),
            erweiterung("2.5.29.35", false, folge(asn1(0x80, angaben.ausstellerKennung))),
            erweiterung("2.5.29.17", false, folge(
                ...angaben.namen.map(function (eintrag) {
                    return /^[\d.]+$|:/.test(eintrag)
                        ? asn1(0x87, ipBytes(eintrag))
                        : asn1(0x82, Buffer.from(eintrag));
                })
            ))
        );
    }

    const jetzt = Date.now();

    const inhalt = folge(
        asn1(0xa0, ganzzahl(Buffer.from([2]))),
        ganzzahl(seriennummer),
        sha256mitRsa,
        namensfeld(angaben.aussteller),
        folge(
            // Einen Tag zurueck, falls die Uhr eines Geraets nachgeht
            zeitpunkt(new Date(jetzt - 24 * 3600 * 1000)),
            zeitpunkt(new Date(jetzt + angaben.tage * 24 * 3600 * 1000))
        ),
        namensfeld(angaben.inhaber),
        oeffentlich,
        asn1(0xa3, folge(...erweiterungen))
    );

    const unterschrift = crypto.sign("sha256", inhalt, angaben.unterschreiber);

    const der = folge(inhalt, sha256mitRsa, asn1(0x03, Buffer.concat([Buffer.from([0]), unterschrift])));

    return "-----BEGIN CERTIFICATE-----\n" +
           der.toString("base64").match(/.{1,64}/g).join("\n") +
           "\n-----END CERTIFICATE-----\n";
}

function schluesselSchreiben(datei, schluessel) {

    fs.writeFileSync(datei, schluessel.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
}

// Alle Namen und Adressen, unter denen der Server erreichbar sein kann
function eigeneNamen() {

    const namen = ["localhost", "127.0.0.1", "::1"];
    const rechner = os.hostname().toLowerCase();

    namen.push(rechner);

    // In einer Windows-Domaene auch der volle Name, z. B. server.firma.local
    if (process.env.USERDNSDOMAIN && rechner.indexOf(".") < 0) {
        namen.push(rechner + "." + process.env.USERDNSDOMAIN.toLowerCase());
    }

    for (const liste of Object.values(os.networkInterfaces())) {
        for (const eintrag of liste || []) {
            if (eintrag.family === "IPv4" && !eintrag.internal) {
                namen.push(eintrag.address);
            }
        }
    }

    for (const zusatz of EINSTELLUNGEN.namen) {
        namen.push(zusatz.toLowerCase());
    }

    return Array.from(new Set(namen));
}

function enthaeltName(zertifikat, eintrag) {

    const liste = (zertifikat.subjectAltName || "").split(", ");

    if (/^[\d.]+$|:/.test(eintrag)) {

        const gesucht = ipBytes(eintrag).toString("hex");

        return liste.some(function (vorhanden) {
            return vorhanden.startsWith("IP Address:") &&
                   ipBytes(vorhanden.slice(11)).toString("hex") === gesucht;
        });
    }

    return liste.indexOf("DNS:" + eintrag) >= 0;
}

function selbstErstelltesZertifikat() {

    fs.mkdirSync(ZERTIFIKAT_ORDNER, { recursive: true });

    const meldungen = [];

    // Das Stammzertifikat bleibt, solange es gueltig ist - sonst muesste
    // es auf allen Geraeten neu installiert werden
    let stamm = null;

    try {

        stamm = {
            zertifikat: new crypto.X509Certificate(fs.readFileSync(STAMM_ZERTIFIKAT)),
            schluessel: crypto.createPrivateKey(fs.readFileSync(STAMM_SCHLUESSEL))
        };

        if (new Date(stamm.zertifikat.validTo) < new Date()) {
            stamm = null;
        }

    } catch (fehler) {
        stamm = null;
    }

    if (!stamm) {

        const paar = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const inhaber = "Lokaler Webserver Stamm " + os.hostname();

        const pem = zertifikatAusstellen({
            stelle: true,
            aussteller: inhaber,
            inhaber: inhaber,
            oeffentlich: paar.publicKey,
            unterschreiber: paar.privateKey,
            tage: 3650
        });

        schluesselSchreiben(STAMM_SCHLUESSEL, paar.privateKey);
        fs.writeFileSync(STAMM_ZERTIFIKAT, pem);

        stamm = { zertifikat: new crypto.X509Certificate(pem), schluessel: paar.privateKey };

        meldungen.push("Neues Stammzertifikat erstellt - bitte auf den Geraeten installieren.");
    }

    // Das Server-Zertifikat wird erneuert, wenn es bald ablaeuft oder
    // ein Name oder eine IP-Adresse fehlt
    const namen = eigeneNamen();
    let neuNoetig = true;

    try {

        const vorhanden = new crypto.X509Certificate(fs.readFileSync(SERVER_ZERTIFIKAT));
        crypto.createPrivateKey(fs.readFileSync(SERVER_SCHLUESSEL));

        const restTage = (new Date(vorhanden.validTo) - Date.now()) / (24 * 3600 * 1000);

        neuNoetig = restTage < 60 ||
                    !vorhanden.checkIssued(stamm.zertifikat) ||
                    !vorhanden.verify(stamm.zertifikat.publicKey) ||
                    !namen.every(function (eintrag) { return enthaeltName(vorhanden, eintrag); });

    } catch (fehler) {
        neuNoetig = true;
    }

    if (neuNoetig) {

        const paar = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const stammKennung = crypto.createHash("sha1")
            .update(stamm.zertifikat.publicKey.export({ type: "spki", format: "der" }))
            .digest();

        const pem = zertifikatAusstellen({
            stelle: false,
            aussteller: stamm.zertifikat.subject.split("\n")
                            .find(function (z) { return z.startsWith("CN="); }).slice(3),
            ausstellerKennung: stammKennung,
            inhaber: os.hostname(),
            namen: namen,
            oeffentlich: paar.publicKey,
            unterschreiber: stamm.schluessel,
            // Apple-Geraete nehmen hoechstens 825 Tage an
            tage: 800
        });

        schluesselSchreiben(SERVER_SCHLUESSEL, paar.privateKey);
        fs.writeFileSync(SERVER_ZERTIFIKAT, pem);

        meldungen.push("Server-Zertifikat erstellt fuer: " + namen.join(", "));
    }

    return {
        optionen: {
            key: fs.readFileSync(SERVER_SCHLUESSEL),
            cert: fs.readFileSync(SERVER_ZERTIFIKAT)
        },
        selbstErstellt: true,
        meldungen: meldungen
    };
}

function eigenesZertifikat() {

    const datei = path.resolve(ORDNER, EINSTELLUNGEN.zertifikat);
    const endung = path.extname(datei).toLowerCase();

    if (endung === ".pfx" || endung === ".p12") {

        return {
            optionen: {
                pfx: fs.readFileSync(datei),
                passphrase: EINSTELLUNGEN.zertifikatPasswort
            },
            selbstErstellt: false,
            meldungen: []
        };
    }

    const schluessel = datei.slice(0, datei.length - endung.length) + ".key";

    if (!fs.existsSync(schluessel)) {
        throw new Error("Zum Zertifikat fehlt der Schluessel \"" + schluessel + "\".");
    }

    return {
        optionen: {
            key: fs.readFileSync(schluessel),
            cert: fs.readFileSync(datei),
            passphrase: EINSTELLUNGEN.zertifikatPasswort || undefined
        },
        selbstErstellt: false,
        meldungen: []
    };
}

let TLS = null;

if (EINSTELLUNGEN.https) {

    try {

        TLS = EINSTELLUNGEN.zertifikat ? eigenesZertifikat() : selbstErstelltesZertifikat();

        // Gleich hier pruefen, damit ein falsches Passwort oder eine
        // kaputte Datei eine klare Meldung gibt statt eines Absturzes
        require("tls").createSecureContext(TLS.optionen);

    } catch (fehler) {

        console.error("");
        console.error("  HTTPS laesst sich nicht einschalten:");
        console.error("  " + (/mac verify|bad decrypt/i.test(fehler.message)
                                  ? "Das Passwort passt nicht zum Zertifikat."
                                  : fehler.message));
        console.error("");

        if (EINSTELLUNGEN.zertifikat) {
            console.error("  Bitte \"zertifikat\" und \"zertifikat-passwort\" in");
            console.error("  \"einstellungen.txt\" pruefen.");
        } else {
            console.error("  Der Ordner \"zertifikat\" muss beschreibbar sein.");
        }

        process.exit(1);
    }
}

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
const GESCHUETZT = [".sqlite", ".sqlite3", ".db", ".db3", ".env", ".ini", ".htaccess",
                    ".key", ".pem", ".pfx", ".p12"];

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
        SERVER_PORT: String(anfrage.socket.localPort || EINSTELLUNGEN.port),
        REQUEST_SCHEME: SCHEMA,
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

    // Daran erkennt PHP eine verschluesselte Verbindung ($_SERVER["HTTPS"])
    if (EINSTELLUNGEN.https) {
        umgebung.HTTPS = "on";
    }

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

function anfrageBearbeiten(anfrage, antwort) {

    const beginn = Date.now();

    antwort.on("finish", function () {

        const zeit = new Date().toLocaleTimeString("de-DE");

        console.log("  " + zeit + "  " + antwort.statusCode + "  " +
                    anfrage.method + " " + anfrage.url +
                    "  (" + (Date.now() - beginn) + " ms)");
    });

    // Das selbst erstellte Stammzertifikat zum Installieren auf anderen
    // Geraeten - nur das Zertifikat, nie ein Schluessel
    if (TLS && TLS.selbstErstellt && anfrage.url.split("?")[0] === ZERTIFIKAT_PFAD) {

        antwort.writeHead(200, {
            "Content-Type": "application/x-x509-ca-cert",
            "Content-Disposition": "attachment; filename=\"Webserver-Stammzertifikat.crt\"",
            "Cache-Control": "no-store"
        });

        antwort.end(fs.readFileSync(STAMM_ZERTIFIKAT));
        return;
    }

    beantworten(anfrage, antwort).catch(function (fehler) {

        console.error("  Fehler:", fehler.message);

        if (!antwort.headersSent) {
            fehlerSeite(antwort, 500, "Fehler im Server", entschaerfen(fehler.message));
        } else {
            antwort.destroy();
        }
    });
}

const server = TLS
    ? require("https").createServer(TLS.optionen, anfrageBearbeiten)
    : http.createServer(anfrageBearbeiten);

// Ruft jemand die https-Adresse mit http:// auf, kommt sonst nur eine
// leere Seite. Stattdessen wird er auf https:// umgeleitet.
if (TLS) {

    const tlsVerbindung = server.listeners("connection").slice();

    server.removeAllListeners("connection");

    server.on("connection", function (verbindung) {

        // Bricht die Verbindung schon hier ab, darf das den Server nicht
        // mitreissen
        verbindung.on("error", function () {});

        // Wer verbindet und nichts schickt, wird nach einer Weile getrennt
        const wartezeit = setTimeout(function () { verbindung.destroy(); }, 30000);

        verbindung.once("close", function () { clearTimeout(wartezeit); });

        verbindung.once("readable", function () {

            clearTimeout(wartezeit);


            const erstes = verbindung.read(1);

            if (erstes === null) {
                return;
            }

            verbindung.unshift(erstes);

            // Eine verschluesselte Verbindung beginnt immer mit 0x16
            if (erstes[0] === 0x16) {

                for (const weiter of tlsVerbindung) {
                    weiter.call(server, verbindung);
                }

                return;
            }

            umleitenAufHttps(verbindung);
        });
    });
}

function umleitenAufHttps(verbindung) {

    const teile = [];

    verbindung.on("data", function (teil) {

        teile.push(teil);

        const kopf = Buffer.concat(teile).toString("latin1");

        if (kopf.indexOf("\r\n\r\n") < 0 && kopf.length < 8192) {
            return;
        }

        const zeile = kopf.split("\r\n")[0].split(" ");
        const pfad = zeile[1] && zeile[1].startsWith("/") ? zeile[1] : "/";
        const host = (/^host:\s*([^\r\n]+)/im.exec(kopf) || [])[1] ||
                     "localhost:" + verbindung.localPort;

        verbindung.end(
            "HTTP/1.1 301 Moved Permanently\r\n" +
            "Location: https://" + host.trim() + pfad + "\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n\r\n"
        );
    });

    verbindung.on("error", function () {
        // Verbindung abgebrochen - nichts zu tun
    });
}

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
            } else if (port === 80 || port === 443) {
                console.error("  Port " + port + " ist auf diesem Rechner belegt - haeufig durch");
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

    // Beim ueblichen Port gehoert keine Portangabe in die Adresse
    const ohnePort = port === (TLS ? 443 : 80);

    function adresseFuer(rechner) {
        return SCHEMA + "://" + rechner + (ohnePort ? "" : ":" + port) + "/";
    }

    const adresse = adresseFuer("localhost");

    console.log("");
    console.log("  ======================================================");
    console.log("   LOKALER WEBSERVER laeuft");
    console.log("  ======================================================");
    console.log("");
    console.log("   Adresse   " + adresse);

    if (EINSTELLUNGEN.imNetzwerk) {

        const ip = netzwerkAdresse();

        if (ip) {
            console.log("   Im Netz   " + adresseFuer(ip));
        }
    }

    if (TLS) {

        if (TLS.selbstErstellt) {
            console.log("   HTTPS     mit selbst erstelltem Zertifikat");
            console.log("             Stammzertifikat fuer andere Geraete:");
            console.log("             " + adresseFuer(EINSTELLUNGEN.imNetzwerk && netzwerkAdresse() || "localhost")
                                            .replace(/\/$/, "") + ZERTIFIKAT_PFAD);
        } else {
            console.log("   HTTPS     " + path.resolve(ORDNER, EINSTELLUNGEN.zertifikat));
        }

        for (const meldung of TLS.meldungen) {
            console.log("             " + meldung);
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
