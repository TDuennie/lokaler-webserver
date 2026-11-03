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
| `Als Dienst einrichten.cmd` | Windows: startet mit Windows, überwacht, Symbol in der Taskleiste |
| `Dienst entfernen.cmd` | nimmt das wieder heraus |

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
- **HTTPS** auf Wunsch, mit einem Zertifikat der eigenen IT oder einem, das
  der Server sich selbst ausstellt – ganz ohne OpenSSL.

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
https       = nein    # verschlüsselt über https:// (siehe unten)
```

Das Gleiche geht über die Befehlszeile (`--port`, `--ordner`, `--netzwerk`,
`--kein-browser`, `--kein-listing`, `--https`, `--zertifikat`) und über die Umgebungsvariablen `PORT`,
`ORDNER`, `IM_NETZWERK`, `KEIN_BROWSER`. Die Befehlszeile hat Vorrang vor der
Umgebung, diese vor der Einstellungsdatei.

### Port 80

`port = 80` macht die Adresse zu `http://localhost` ohne Portangabe. Unter
Windows geht das ohne besondere Rechte, solange der Port frei ist – belegt ist
er dort häufig durch IIS oder Skype. Unter macOS und Linux sind Ports unter
1024 geschützt, dort braucht es `sudo node server.js`. In beiden Fällen sagt
der Server beim Start, was zu tun ist.

## Als Dienst auf einem Windows-Server

Für den Dauerbetrieb: `Als Dienst einrichten.cmd` doppelklicken und die
Abfrage nach Administratorrechten bestätigen. Danach

- **startet der Server mit Windows**, auch ohne dass jemand angemeldet ist –
  über eine Aufgabe „Lokaler Webserver“ in der Aufgabenplanung, die als
  SYSTEM läuft,
- **passt ein Wächter auf ihn auf** (`waechter.js`): Stürzt der Server ab,
  startet er ihn neu. Alle 30 Sekunden fragt er unter `/_status` nach;
  bleibt die Antwort zweimal aus, gilt der Server als hängend und wird
  ebenfalls neu gestartet. Stürzt er gleich wieder ab, wartet der Wächter
  jedes Mal doppelt so lange, höchstens eine Minute. Fällt der Wächter
  selbst aus, startet ihn Windows nach einer Minute neu.
- **zeigt ein Symbol in der Taskleiste** den Zustand – grün läuft, gelb
  startet, rot gestört, grau aus. Bei einer Störung kommt eine
  Benachrichtigung. Rechtsklick: im Browser öffnen, neu starten, Protokoll
  anzeigen. Das Symbol startet bei jeder Anmeldung, für alle Benutzer.
- **steht alles im Protokoll** `protokoll/server.log`, mit Uhrzeit. Ab 5 MB
  wird es weitergeschoben, die letzten drei bleiben.
- ist bei `netzwerk = ja` der Port in der **Windows-Firewall** freigegeben
  (Domäne und privat).

Unter dem Wächter bleibt der Server beim eingestellten Port, statt auf den
nächsten freien auszuweichen – ein Proxy davor erwartet ihn dort. Wird
`Webserver starten.vbs` doppelgeklickt, während der Dienst läuft, öffnet
sich nur der Browser auf den laufenden Server.

`/_status` antwortet mit `{"status":"ok", …}` und eignet sich auch als
Gesundheitsprüfung für einen Proxy oder Load Balancer.

Der Ordner sollte dafür nicht in einem Benutzerprofil liegen (Desktop,
Dokumente), sondern zum Beispiel unter `C:\Webserver`.

## HTTPS

```ini
https = ja
port  = 443
```

Damit läuft der Server unter `https://localhost`. Wer die `http://`-Adresse
aufruft, wird auf `https://` umgeleitet – das erkennt der Server am ersten
Byte der Verbindung, ein zweiter Port ist dafür nicht nötig. PHP sieht die
Verschlüsselung wie gewohnt in `$_SERVER["HTTPS"]`.

### Selbst erstelltes Zertifikat

Ist nichts weiter eingestellt, legt der Server beim Start im Ordner
`zertifikat/` eine kleine eigene Zertifizierungsstelle an und stellt sich
damit ein Zertifikat aus. Erzeugt wird beides mit Node.js selbst, OpenSSL
muss nicht installiert sein.

| Datei | |
| --- | --- |
| `stammzertifikat.crt` | wird einmal auf den Geräten installiert, 10 Jahre gültig |
| `stammzertifikat.key` | geheim, unterschreibt die Server-Zertifikate |
| `server-<rechner>.crt`, `.key` | das Zertifikat des Servers, je Rechner, 800 Tage gültig |

Das Server-Zertifikat enthält `localhost`, den Rechnernamen (in einer
Windows-Domäne auch mit Domäne), alle IP-Adressen des Rechners und die
Namen aus `namen = …`. Fehlt beim Start ein Name oder eine Adresse oder
läuft es in weniger als 60 Tagen ab, stellt der Server ein neues aus. Weil
das Stammzertifikat dabei bleibt, muss auf den Geräten nichts neu
installiert werden.

Bis das Stammzertifikat installiert ist, warnt der Browser. Installieren:

- **Windows:** `stammzertifikat.crt` doppelklicken → *Zertifikat
  installieren* → *Lokaler Computer* → *Vertrauenswürdige
  Stammzertifizierungsstellen*. In einer Domäne kann die IT das per
  Gruppenrichtlinie verteilen.
- **iPad, iPhone:** In Safari `https://<Server>/_zertifikat` öffnen, Profil
  laden und installieren, dann unter *Allgemein → Info →
  Zertifikatsvertrauenseinstellungen* einschalten.

Unter `/_zertifikat` liefert der Server nur das Stammzertifikat aus, nie
einen Schlüssel. Dateien mit `.key`, `.pem`, `.pfx` und `.p12` gibt er auch
aus `www/` heraus nicht ab.

### Zertifikat der eigenen IT

In einer Firma ist ein Zertifikat der internen Zertifizierungsstelle der
bessere Weg – dem vertrauen die Geräte der Domäne schon, kein Browser
warnt.

```ini
zertifikat          = zertifikat/server.pfx
zertifikat-passwort = …
```

Statt einer `.pfx` geht auch eine `.crt` (gern mit Zwischenzertifikaten)
mit einer gleichnamigen `.key` daneben. Passt das Passwort nicht oder fehlt
eine Datei, sagt der Server das beim Start und beendet sich.

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
├── waechter.js                        startet und überwacht den Server
├── dienst/                            Einrichtung als Dienst, Taskleisten-Symbol
├── protokoll/                         Protokoll und Zustand, legt der Wächter an
├── node.exe                           ~80 MB, nur mitgelegt
├── php/                               nur nötig für PHP
├── www/                               die eigenen Seiten
│   ├── index.html
│   ├── test.php                       Selbsttest, darf weg
│   ├── beispiel.php                   gemeinsame Liste, darf weg
│   └── lib/speicher.php               Datensätze für den Sync-Ordner
├── daten/                             Datenbanken und JSON-Dateien
├── zertifikat/                        nur bei https, legt der Server an
├── einstellungen.txt                  legt der Server selbst an
├── Anleitung.html                     bebilderte Anleitung, per Doppelklick
├── Webserver starten.vbs
├── Webserver mit Fenster starten.cmd
├── Webserver beenden.cmd
├── Webserver starten.command
├── Als Dienst einrichten.cmd
├── Dienst entfernen.cmd
└── LIESMICH.txt
```

`node.exe`, `php/`, `daten/`, `zertifikat/` und `protokoll/` liegen nicht im Repository – zu groß
beziehungsweise inhaltlich nichts, was versioniert gehört.
