# Lokaler Webserver

Ein kleiner Webserver zum Mitnehmen. Zeigt die Dateien aus einem Ordner im
Browser an – HTML, CSS, Bilder, PDF, Video – und führt PHP-Seiten aus,
SQLite inklusive.

Der ganze Ordner lässt sich in einen Drive legen und von dort per Doppelklick
starten. Installiert werden muss nichts: `node.exe` liegt einfach daneben.
Alle Pfade sind relativ zum Server, der Ordner darf also beliebig verschoben
oder kopiert werden.

## Starten

| Datei | |
| --- | --- |
| `Webserver starten.vbs` | Windows, ohne Fenster, Browser öffnet sich |
| `Webserver mit Fenster starten.cmd` | Windows, mit allen Meldungen |
| `Webserver beenden.cmd` | beendet den laufenden Server |
| `Webserver starten.command` | macOS und Linux |

Oder direkt:

```bash
node server.js
node server.js --port 80 --ordner htdocs --netzwerk
```

Die Startdateien nehmen ein `node.exe` aus dem eigenen Ordner und weichen nur
ersatzweise auf ein installiertes Node.js aus.

## Was der Server kann

- **Statische Dateien** aus `www/` mit passenden Dateitypen – HTML, CSS, JS,
  Bilder, Schriften, PDF, Video, Audio, WebAssembly.
- **PHP** über `php-cgi`, mit `$_GET`, `$_POST`, Cookies, Sitzungen, eigenen
  Kopfzeilen und Statuscodes. `index.php` wird als Startseite erkannt.
- **SQLite** über PHP. Fehlt die `php.ini` eines frisch entpackten PHP, legt
  der Server eine an, in der `pdo_sqlite` eingeschaltet ist – eine vorhandene
  wird nie verändert.
- **Ordnerliste**, wenn keine `index.html` vorhanden ist.
- **Bereichsabfragen** (`Range`), damit sich Video und Audio vorspulen lassen.
- **Kein Zwischenspeichern** – ein Neuladen zeigt immer den aktuellen Stand.
- **Freier Port**: Ist der eingestellte belegt, nimmt der Server den nächsten.
- **Browser öffnet sich** beim Start, unter Windows, macOS und Linux.

Nicht ausgeliefert werden `.sqlite`, `.db`, `.env`, `.ini` und `.htaccess` –
auch dann nicht, wenn sie in `www/` liegen. PHP kann sie normal öffnen.
Ebenso wird alles abgewiesen, was aus dem Ordner herausführt.

Standardmäßig lauscht der Server nur auf `127.0.0.1` und ist vom Netzwerk aus
nicht erreichbar. Mit `netzwerk = ja` wird er für andere Geräte im selben Netz
geöffnet; die Startmeldung nennt dann die Adresse und weist darauf hin.

## Einstellungen

Alles steht in `einstellungen.txt`, die beim ersten Start angelegt wird:

```ini
port        = 8080    # 80 bedeutet: http://localhost ohne Portangabe
ordner      = www     # welcher Ordner ausgeliefert wird
browser     = ja      # Browser beim Start öffnen
netzwerk    = nein    # auch für andere Geräte im Netz erreichbar
ordnerliste = ja      # Ordnerinhalt zeigen, wenn keine index.html da ist
```

Das Gleiche geht über die Befehlszeile (`--port`, `--ordner`, `--netzwerk`,
`--kein-browser`, `--kein-listing`) und über die Umgebungsvariablen `PORT`,
`ORDNER`, `IM_NETZWERK`, `KEIN_BROWSER`. Die Befehlszeile hat Vorrang vor der
Umgebung, diese vor der Einstellungsdatei.

### Port 80

`port = 80` macht die Adresse zu `http://localhost` ohne Portangabe. Unter
Windows geht das ohne besondere Rechte, solange der Port frei ist – belegt ist
er dort häufig durch IIS oder Skype. Unter macOS und Linux sind Ports unter
1024 geschützt, dort braucht es `sudo node server.js`. In beiden Fällen sagt
der Server beim Start, was zu tun ist.

## PHP einrichten

1. Auf [windows.php.net/download](https://windows.php.net/download) die
   Fassung **VS17 x64 Non Thread Safe** als ZIP laden.
2. Entpacken und den Ordner `php` neben `server.js` legen, sodass es
   `php/php-cgi.exe` gibt.
3. Server neu starten.

Gesucht wird in dieser Reihenfolge: `php/php-cgi.exe`, `php/php-cgi`,
`php-cgi.exe`, `php-cgi` im Serverordner, danach `php-cgi` im System. Die
Startmeldung zeigt, welches PHP gefunden wurde und ob SQLite bereitsteht.

`www/test.php` prüft beides und legt eine kleine SQLite-Datenbank an.

## Aufbau

```
lokaler-webserver/
├── server.js                          der Server
├── node.exe                           ~80 MB, nur mitgelegt
├── php/                               nur nötig für PHP
├── www/                               die eigenen Seiten
│   ├── index.html
│   └── test.php                       Selbsttest, darf weg
├── daten/                             guter Platz für SQLite-Dateien
├── einstellungen.txt                  legt der Server selbst an
├── Webserver starten.vbs
├── Webserver mit Fenster starten.cmd
├── Webserver beenden.cmd
├── Webserver starten.command
└── LIESMICH.txt
```

`node.exe`, `php/` und `daten/` liegen nicht im Repository – zu groß
beziehungsweise inhaltlich nichts, was versioniert gehört.
