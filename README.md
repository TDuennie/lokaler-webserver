# Lokaler Webserver

Ein kleiner Webserver zum Mitnehmen. Zeigt die Dateien aus einem Ordner im
Browser an – HTML, CSS, Bilder, PDF, Video – und führt PHP-Seiten aus,
SQLite inklusive.

Der ganze Ordner lässt sich in einen Drive legen und von dort per Doppelklick
starten. Installiert werden muss nichts: `node.exe` liegt einfach daneben.
Alle Pfade sind relativ zum Server, der Ordner darf also beliebig verschoben
oder kopiert werden.

Eine bebilderte Schritt-für-Schritt-Anleitung für alle, die den Server nur
benutzen wollen, liegt als `Anleitung.html` dabei – einfach doppelklicken. Sie
enthält ihre Bilder selbst und funktioniert deshalb auch ohne Internet und
weitergegeben als einzelne Datei.

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

## Gemeinsame Daten in einem Sync-Ordner

Wenn mehrere Arbeitsplätze denselben Ordner über Nextcloud (oder einen anderen
Sync-Dienst) teilen und jeder seinen eigenen Server startet, arbeiten alle auf
derselben Datei. Naiv geschrieben gehen dabei Daten verloren: Wer zuletzt
speichert, überschreibt die Änderungen der anderen.

`www/lib/speicher.php` löst das. Datensätze landen in einer JSON-Datei, die
sich zusammenführen lässt:

```php
require __DIR__ . "/lib/speicher.php";

// Neben www ablegen, nicht darin - sonst ist die Datei über den Browser lesbar
$speicher = new Speicher(__DIR__ . "/../daten/kunden.json");

$id  = $speicher->sichern(["name" => "Anna Berger", "ort" => "Kassel"]);
$alle = $speicher->alle();
$einer = $speicher->holen($id);
$speicher->sichern(["id" => $id, "name" => "Anna Berger", "ort" => "Marburg"]);
$speicher->loeschen($id);
```

`www/beispiel.php` ist eine vollständige Liste zum Anschauen und Löschen.

### Wie das Zusammenführen arbeitet

- **Kennung und Zeitstempel je Datensatz.** Treffen zwei Fassungen aufeinander,
  gewinnt der jüngere Datensatz – nicht die jüngere Datei. Bei exakt gleichem
  Zeitstempel entscheidet der Inhalt, damit alle Arbeitsplätze unabhängig
  voneinander zum selben Ergebnis kommen.
- **Vor jedem Schreiben wird frisch gelesen** und die eigene Änderung
  hineingemischt.
- **Gelöschtes wird markiert statt entfernt** – sonst brächte der nächste
  Abgleich es zurück. Nach 90 Tagen fallen die Markierungen weg.
- **Geschrieben wird über eine Nebendatei mit anschließendem Umbenennen**, mit
  Wiederholung bei kurzzeitigen Sperren durch Virenscanner oder Sync-Client.
  So bleibt nie eine halb geschriebene Datei zurück.
- **Konfliktkopien** (`kunden (conflicted copy …).json`) werden erkannt,
  eingemischt und nach `daten/sicherungen/` weggeräumt.
- **Eine Dateisperre** hält gleichzeitige Aufrufe auf demselben Rechner
  auseinander.
- **Einmal täglich eine Sicherung** in `daten/sicherungen/`, die letzten 14.

Gemessen mit zehn gleichzeitig schreibenden Prozessen, je zehn Datensätze:
100 von 100 kommen an. Dieselbe Aufgabe mit `file_put_contents` geschrieben
verliert 94 davon.

### Zwei Grenzen

- **Die Uhren der Rechner müssen stimmen.** „Der jüngere gewinnt“ stützt sich
  auf die Uhrzeit des schreibenden Rechners. Geht einer merklich nach, verlieren
  seine Änderungen systematisch. In einer Domäne mit Zeitabgleich ist das kein
  Thema.
- **Zusammengeführt wird je Datensatz, nicht je Feld.** Ändern zwei Personen
  gleichzeitig denselben Datensatz – eine den Namen, die andere den Ort –,
  setzt sich die spätere Fassung komplett durch. Verschiedene Datensätze
  gleichzeitig zu bearbeiten ist dagegen immer sicher.

Wo beides nicht reicht, ist ein einziger Server für alle der bessere Weg:
`netzwerk = ja`, und die anderen rufen dessen Adresse auf. Dann gibt es nur
eine Datei, einen Schreiber und keine Sync-Verzögerung.

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
│   ├── test.php                       Selbsttest, darf weg
│   ├── beispiel.php                   gemeinsame Liste, darf weg
│   └── lib/speicher.php               Datensätze für den Sync-Ordner
├── daten/                             Datenbanken und JSON-Dateien
├── einstellungen.txt                  legt der Server selbst an
├── Anleitung.html                     bebilderte Anleitung, per Doppelklick
├── Webserver starten.vbs
├── Webserver mit Fenster starten.cmd
├── Webserver beenden.cmd
├── Webserver starten.command
└── LIESMICH.txt
```

`node.exe`, `php/` und `daten/` liegen nicht im Repository – zu groß
beziehungsweise inhaltlich nichts, was versioniert gehört.
