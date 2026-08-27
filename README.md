# Urlaubskalender – lokaler Webserver

Ein Webserver, der auf jedem Arbeitsplatz einzeln läuft. Alle Arbeitsplätze
arbeiten dabei auf **derselben Datei in einem gemeinsamen Drive-Ordner**.
Es gibt keinen zentralen Server und keine Verbindung ins Internet.

Der ganze Ordner lässt sich in den Drive legen und von dort starten – es muss
nichts installiert werden.

## Aufbau im Drive-Ordner

```
Urlaubskalender/
├── server.js                              das Programm
├── node.exe                               ~80 MB, wird nur mitgelegt
├── web/                                   die Oberfläche
├── daten/                                 legt der Server selbst an
│   ├── urlaubskalender-daten.json         der gemeinsame Stand
│   ├── backups/                           tägliche Sicherung, 30 Stück
│   └── server-log-<rechner>.txt
├── Urlaubskalender starten.vbs            startet ohne Fenster
├── Urlaubskalender mit Fenster starten.cmd
├── Urlaubskalender beenden.cmd
└── LIESMICH.txt                           Anleitung für die Kollegen
```

`node.exe`, `web/` und `daten/` liegen bewusst **nicht** in diesem Repository:
die erste ist zu groß, `daten/` enthält Namen von Mitarbeitern, und die
Oberfläche wird separat gepflegt.

## Starten

| Datei | Wirkung |
| --- | --- |
| `Urlaubskalender starten.vbs` | Start im Hintergrund, Browser öffnet sich |
| `Urlaubskalender mit Fenster starten.cmd` | Start mit sichtbaren Meldungen |
| `Urlaubskalender beenden.cmd` | beendet den laufenden Server |

Die Startdateien nehmen die `node.exe` aus dem eigenen Ordner. Nur wenn sie
fehlt, weichen sie auf ein installiertes Node.js aus; ist auch das nicht da,
erklären sie, wo man die Datei bekommt.

Auf dem Mac oder unter Linux geht es direkt:

```bash
node server.js
```

## Wie mehrere Arbeitsplätze zusammenkommen

Ein gemeinsamer Ordner ist keine Datenbank – zwei gleichzeitige Änderungen
könnten sich gegenseitig überschreiben. Dagegen tut der Server Folgendes:

- **Jeder Datensatz hat eine feste Kennung und einen Zeitstempel.** Beim
  Zusammenführen gewinnt der jüngere Stand.
- **Vor jedem Schreiben wird die Datei frisch gelesen** und die eigene
  Änderung hineingemischt – nie einfach überschrieben.
- **Gelöschtes wird als gelöscht markiert**, statt zu verschwinden. Sonst
  brächte der nächste Abgleich es zurück.
- **Geschrieben wird über eine Nebendatei mit anschließendem Umbenennen.**
  So bleibt nie eine halb geschriebene Datei zurück.
- **Konfliktkopien des Sync-Clients werden erkannt**, eingemischt und nach
  `daten/backups/` weggeräumt.
- **Der Ordner wird überwacht** (plus alle 5 Sekunden ein Blick zur
  Sicherheit, weil Sync-Ordner Änderungen nicht zuverlässig melden). Kommt
  ein neuer Stand an, laden alle offenen Browser ihn automatisch nach.
- **Kurzzeitige Dateisperren** durch Virenscanner oder den Sync-Client
  (`EPERM`, `EBUSY`) werden mehrfach wiederholt statt als Fehler gemeldet.

## Einstellungen

| Datei im Ordner | Wirkung |
| --- | --- |
| `port.txt` | anderer Port, nur die Zahl hineinschreiben (Standard 8080) |
| `kein-browser.txt` | leere Datei anlegen, dann öffnet sich der Browser nicht |

Alternativ per Umgebungsvariable: `PORT` und `KEIN_BROWSER=1`.

Der Server lauscht ausschließlich auf `127.0.0.1` – vom Netzwerk aus ist er
nicht erreichbar.

## Schnittstelle

| Weg | Zweck |
| --- | --- |
| `GET /api/daten` | aktueller Stand |
| `GET /api/version` | nur die Versionsnummer |
| `GET /api/ereignisse` | dauerhaft offene Verbindung, meldet jede Änderung |
| `POST /api/aktion` | eine Änderung durchführen |

Aktionen für `POST /api/aktion`:

```jsonc
{ "art": "mitarbeiterHinzufuegen", "name": "Anna Berger" }
{ "art": "mitarbeiterAktiv",       "name": "Anna Berger", "aktiv": false }
{ "art": "eintragSpeichern",       "eintrag": { "mitarbeiter": "Anna Berger",
                                                "typ": "U",          // U, K oder P
                                                "von": "2026-09-01",
                                                "bis": "2026-09-14",
                                                "vertreter": ["Bernd Klein"] } }
{ "art": "eintragLoeschen",        "id": "e1a2b3c4" }
{ "art": "allesErsetzen",          "mitarbeiter": [], "eintraege": [] }
```

`typ` ist `U` (Urlaub), `K` (Krankheit) oder `P` (Planung). Wer eine Aktion
schickt, kann eine eigene Kennung als `absender` mitgeben – dann bekommt
dieser Browser die eigene Änderung nicht noch einmal gemeldet.

Alles, was nicht unter `/api/` liegt, wird als Datei aus `web/` ausgeliefert.
