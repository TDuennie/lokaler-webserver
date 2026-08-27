<?php
declare(strict_types=1);

/*
    Speicher - Datensätze in einer JSON-Datei, die in einem Sync-Ordner liegt
    ------------------------------------------------------------------------

    Gedacht für den Fall: mehrere Arbeitsplätze, jeder mit eigenem Webserver,
    alle auf derselben Datei in Nextcloud (oder einem anderen Sync-Ordner).

    Ein Sync-Ordner ist keine Datenbank. Zwei Leute, die kurz nacheinander
    speichern, würden sich normalerweise gegenseitig überschreiben. Dagegen:

      * Jeder Datensatz hat eine feste Kennung und einen Zeitstempel.
        Beim Zusammenführen gewinnt der jüngere - nicht die ganze Datei.
      * Vor jedem Schreiben wird frisch von der Platte gelesen und die
        eigene Änderung hineingemischt, nie einfach überschrieben.
      * Gelöschtes wird als gelöscht markiert statt entfernt. Sonst
        brächte der nächste Abgleich es zurück.
      * Geschrieben wird über eine Nebendatei mit anschließendem
        Umbenennen - so bleibt nie eine halbe Datei zurück.
      * Konfliktkopien des Sync-Clients werden erkannt, eingemischt und
        weggeräumt.
      * Innerhalb eines Rechners sorgt eine Sperre dafür, dass sich zwei
        gleichzeitige Aufrufe nicht in die Quere kommen.

    Verwendung:

        require __DIR__ . "/lib/speicher.php";

        $speicher = new Speicher(__DIR__ . "/../daten/kunden.json");

        $alle = $speicher->alle();
        $id   = $speicher->sichern(["name" => "Anna Berger", "ort" => "Kassel"]);
        $einer = $speicher->holen($id);
        $speicher->sichern(["id" => $id, "name" => "Anna Berger", "ort" => "Fulda"]);
        $speicher->loeschen($id);
*/

class SpeicherFehler extends RuntimeException {}

class Speicher
{
    private string $datei;
    private string $ordner;
    private string $stamm;
    private string $sperrdatei;

    /** Gelöschtes wird nach so vielen Tagen endgültig entfernt. */
    private int $aufraeumenNachTagen;

    /** Wie viele Tagessicherungen behalten werden. 0 schaltet sie ab. */
    private int $sicherungenBehalten;

    public function __construct(string $datei,
                                int $aufraeumenNachTagen = 90,
                                int $sicherungenBehalten = 14)
    {
        $this->datei  = $datei;
        $this->ordner = dirname($datei);
        $this->stamm  = pathinfo($datei, PATHINFO_FILENAME);

        $this->aufraeumenNachTagen = $aufraeumenNachTagen;
        $this->sicherungenBehalten = $sicherungenBehalten;

        $this->sperrdatei = $datei . ".sperre";

        $this->ordnerSicherstellen($this->ordner);
    }

    /* ===================== Öffentlich ===================== */

    /**
     * Alle vorhandenen Datensätze, ohne die gelöschten.
     * Die Verwaltungsfelder werden dabei ausgeblendet.
     */
    public function alle(): array
    {
        $sichtbare = [];

        foreach ($this->imSchutz(fn() => $this->vonPlatteLesen()) as $datensatz) {

            if ($datensatz["geloescht"] ?? false) {
                continue;
            }

            unset($datensatz["geloescht"]);
            $sichtbare[] = $datensatz;
        }

        return $sichtbare;
    }

    /** Ein einzelner Datensatz, oder null wenn es ihn nicht (mehr) gibt. */
    public function holen(string $id): ?array
    {
        foreach ($this->alle() as $datensatz) {
            if ($datensatz["id"] === $id) {
                return $datensatz;
            }
        }

        return null;
    }

    /**
     * Legt einen Datensatz an oder ändert einen vorhandenen.
     * Mit "id" im Feldsatz wird geändert, ohne wird angelegt.
     * Gibt die Kennung zurück.
     */
    public function sichern(array $felder): string
    {
        if (isset($felder["id"]) && !is_string($felder["id"])) {
            throw new SpeicherFehler('Das Feld "id" muss Text sein.');
        }

        return $this->imSchutz(function () use ($felder): string {

            $vorhandene = $this->vonPlatteLesen();

            $id = $felder["id"] ?? $this->neueKennung();

            $felder["id"]        = $id;
            $felder["geloescht"] = false;
            $felder["geaendert"] = $this->jetzt();

            $gefunden = false;

            foreach ($vorhandene as $stelle => $datensatz) {
                if ($datensatz["id"] === $id) {
                    $vorhandene[$stelle] = $felder;
                    $gefunden = true;
                    break;
                }
            }

            if (!$gefunden) {
                $vorhandene[] = $felder;
            }

            $this->schreiben($vorhandene);

            return $id;
        });
    }

    /**
     * Markiert einen Datensatz als gelöscht. Er verschwindet aus alle(),
     * bleibt aber als Markierung erhalten, damit der nächste Abgleich ihn
     * nicht zurückbringt. Gibt zurück, ob es ihn überhaupt gab.
     */
    public function loeschen(string $id): bool
    {
        return $this->imSchutz(function () use ($id): bool {

            $vorhandene = $this->vonPlatteLesen();
            $getroffen  = false;

            foreach ($vorhandene as $stelle => $datensatz) {

                if ($datensatz["id"] === $id && !($datensatz["geloescht"] ?? false)) {

                    $vorhandene[$stelle]["geloescht"] = true;
                    $vorhandene[$stelle]["geaendert"] = $this->jetzt();

                    $getroffen = true;
                    break;
                }
            }

            if ($getroffen) {
                $this->schreiben($vorhandene);
            }

            return $getroffen;
        });
    }

    /** Anzahl der sichtbaren Datensätze. */
    public function anzahl(): int
    {
        return count($this->alle());
    }

    /* ===================== Sperre ===================== */

    /**
     * Führt die Arbeit aus, während kein anderer Aufruf auf demselben
     * Rechner an die Datei geht. Gegen andere Rechner hilft das nicht -
     * dafür ist das Zusammenführen da.
     */
    private function imSchutz(callable $arbeit)
    {
        $griff = @fopen($this->sperrdatei, "c");

        if ($griff === false) {
            // Ohne Sperre weiterarbeiten ist besser als gar nicht zu
            // arbeiten - das Zusammenführen fängt das meiste ohnehin ab.
            return $arbeit();
        }

        $gesperrt = @flock($griff, LOCK_EX);

        try {
            return $arbeit();
        } finally {

            if ($gesperrt) {
                @flock($griff, LOCK_UN);
            }

            @fclose($griff);
        }
    }

    /* ===================== Lesen ===================== */

    /**
     * Liest die Datei und mischt alles ein, was der Sync-Client daneben
     * abgelegt hat. Liefert die Datensätze einschließlich der gelöschten.
     */
    private function vonPlatteLesen(): array
    {
        $datensaetze = $this->dateiLesen($this->datei) ?? [];

        foreach ($this->konfliktkopienSuchen() as $kopie) {

            $ausKopie = $this->dateiLesen($kopie);

            if ($ausKopie !== null) {
                $datensaetze = $this->zusammenfuehren($datensaetze, $ausKopie);
            }

            $this->kopieWegraeumen($kopie);
        }

        return $this->altesEntfernen($datensaetze);
    }

    /** Liest eine JSON-Datei. null, wenn es sie nicht gibt oder sie leer ist. */
    private function dateiLesen(string $pfad): ?array
    {
        if (!is_file($pfad)) {
            return null;
        }

        $text = @file_get_contents($pfad);

        if ($text === false || trim($text) === "") {
            return null;
        }

        $roh = json_decode($text, true);

        if (!is_array($roh) || !isset($roh["datensaetze"]) || !is_array($roh["datensaetze"])) {

            // Beschädigte Datei nicht stillschweigend überschreiben,
            // sondern beiseitelegen und melden.
            if (!is_array($roh)) {
                $this->beiseitelegen($pfad, "unlesbar");
                throw new SpeicherFehler(
                    "Die Datei " . basename($pfad) . " war unlesbar und wurde " .
                    "beiseitegelegt. Der letzte gültige Stand liegt in " .
                    "\"sicherungen\"."
                );
            }

            return null;
        }

        $sauber = [];

        foreach ($roh["datensaetze"] as $datensatz) {
            if (is_array($datensatz) && isset($datensatz["id"]) && is_string($datensatz["id"])) {
                $sauber[] = $this->vereinheitlichen($datensatz);
            }
        }

        return $sauber;
    }

    /** Sorgt dafür, dass die Verwaltungsfelder vorhanden und brauchbar sind. */
    private function vereinheitlichen(array $datensatz): array
    {
        $datensatz["geloescht"] = ($datensatz["geloescht"] ?? false) === true;

        if (!isset($datensatz["geaendert"]) || !is_string($datensatz["geaendert"])) {
            $datensatz["geaendert"] = "1970-01-01T00:00:00.000000Z";
        }

        return $datensatz;
    }

    /* ===================== Zusammenführen ===================== */

    /**
     * Führt zwei Stände zusammen. Bei gleicher Kennung gewinnt der jüngere
     * Datensatz.
     */
    private function zusammenfuehren(array $eigene, array $fremde): array
    {
        $nachKennung = [];

        foreach ($eigene as $datensatz) {
            $nachKennung[$datensatz["id"]] = $datensatz;
        }

        foreach ($fremde as $datensatz) {

            $id = $datensatz["id"];

            if (!isset($nachKennung[$id]) || $this->istJuenger($datensatz, $nachKennung[$id])) {
                $nachKennung[$id] = $datensatz;
            }
        }

        return array_values($nachKennung);
    }

    /**
     * Ist a jünger als b? Bei genau gleichem Zeitstempel entscheidet der
     * Inhalt - dadurch kommen alle Arbeitsplätze zum selben Ergebnis,
     * unabhängig davon, in welcher Reihenfolge sie zusammenführen.
     */
    private function istJuenger(array $a, array $b): bool
    {
        if ($a["geaendert"] !== $b["geaendert"]) {
            return $a["geaendert"] > $b["geaendert"];
        }

        return strcmp($this->alsText($a), $this->alsText($b)) > 0;
    }

    private function alsText(array $datensatz): string
    {
        ksort($datensatz);

        return (string) json_encode($datensatz, JSON_UNESCAPED_UNICODE);
    }

    /** Entfernt Gelöschtes, das lange genug zurückliegt. */
    private function altesEntfernen(array $datensaetze): array
    {
        if ($this->aufraeumenNachTagen <= 0) {
            return $datensaetze;
        }

        $grenze = gmdate(
            "Y-m-d\TH:i:s.000000\Z",
            time() - $this->aufraeumenNachTagen * 86400
        );

        return array_values(array_filter(
            $datensaetze,
            fn(array $d): bool => !$d["geloescht"] || $d["geaendert"] > $grenze
        ));
    }

    /* ===================== Konfliktkopien ===================== */

    /**
     * Sucht Dateien, die der Sync-Client neben die eigene gelegt hat.
     * Nextcloud nennt sie je nach Fassung etwa
     * "kunden (conflicted copy user 2026-08-27 120000).json" oder
     * "kunden_conflict-20260827-120000.json".
     */
    private function konfliktkopienSuchen(): array
    {
        $gefundene = [];
        $eigener   = basename($this->datei);

        $eintraege = @scandir($this->ordner);

        if ($eintraege === false) {
            return [];
        }

        foreach ($eintraege as $name) {

            if ($name === $eigener || !str_ends_with(strtolower($name), ".json")) {
                continue;
            }

            // Muss mit demselben Namen beginnen, danach aber etwas
            // anderes haben als nur ".json"
            $passt = preg_match(
                '/^' . preg_quote($this->stamm, "/") . '[ _\-\(].*\.json$/i',
                $name
            );

            if ($passt === 1) {
                $gefundene[] = $this->ordner . DIRECTORY_SEPARATOR . $name;
            }
        }

        return $gefundene;
    }

    private function kopieWegraeumen(string $pfad): void
    {
        $this->beiseitelegen($pfad, "eingemischt");
    }

    /** Verschiebt eine Datei in den Unterordner "sicherungen". */
    private function beiseitelegen(string $pfad, string $vermerk): void
    {
        $ziel = $this->ordner . DIRECTORY_SEPARATOR . "sicherungen";

        $this->ordnerSicherstellen($ziel);

        $neuerName = $ziel . DIRECTORY_SEPARATOR
                   . gmdate("Ymd-His") . "-" . $vermerk . "-" . basename($pfad);

        if (!@rename($pfad, $neuerName)) {
            @unlink($pfad);
        }
    }

    /* ===================== Schreiben ===================== */

    private function schreiben(array $datensaetze): void
    {
        $this->tagessicherung();

        $inhalt = json_encode(
            [
                "hinweis"     => "Wird vom Webserver gepflegt. Jeder Datensatz "
                               . "hat eine Kennung und einen Zeitstempel, damit "
                               . "mehrere Arbeitsplätze zusammengeführt werden können.",
                "datensaetze" => array_values($datensaetze),
            ],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        if ($inhalt === false) {
            throw new SpeicherFehler("Die Daten ließen sich nicht in JSON umwandeln.");
        }

        // Erst vollständig daneben schreiben, dann umbenennen. Dadurch
        // liest nie jemand eine halb geschriebene Datei - auch der
        // Sync-Client nicht.
        $temporaer = $this->datei . "." . getmypid() . "." . uniqid() . ".neu";

        if (@file_put_contents($temporaer, $inhalt, LOCK_EX) === false) {
            throw new SpeicherFehler(
                "In den Ordner " . $this->ordner . " lässt sich nicht schreiben."
            );
        }

        $this->mitWiederholung(function () use ($temporaer): void {

            if (!@rename($temporaer, $this->datei)) {
                throw new SpeicherFehler("Umbenennen fehlgeschlagen.");
            }
        }, $temporaer);
    }

    /**
     * Virenscanner und Sync-Clients greifen unter Windows kurz auf frisch
     * geschriebene Dateien zu. Das geht nach wenigen Millisekunden vorbei.
     */
    private function mitWiederholung(callable $arbeit, string $aufraeumen): void
    {
        $hoechstens = 12;

        for ($versuch = 1; ; $versuch++) {

            try {
                $arbeit();
                return;

            } catch (SpeicherFehler $fehler) {

                if ($versuch >= $hoechstens) {
                    @unlink($aufraeumen);
                    throw new SpeicherFehler(
                        "Die Datei " . basename($this->datei) . " ließ sich nicht "
                        . "schreiben. Sie ist vermutlich gerade durch den "
                        . "Sync-Client oder ein anderes Programm belegt."
                    );
                }

                usleep(25000 * $versuch);
            }
        }
    }

    /** Einmal am Tag eine Kopie zurücklegen. */
    private function tagessicherung(): void
    {
        if ($this->sicherungenBehalten <= 0 || !is_file($this->datei)) {
            return;
        }

        $ordner = $this->ordner . DIRECTORY_SEPARATOR . "sicherungen";
        $ziel   = $ordner . DIRECTORY_SEPARATOR . $this->stamm . "-" . gmdate("Y-m-d") . ".json";

        if (is_file($ziel)) {
            return;
        }

        $this->ordnerSicherstellen($ordner);
        @copy($this->datei, $ziel);

        // Älteste Sicherungen abräumen
        $vorhandene = glob($ordner . DIRECTORY_SEPARATOR . $this->stamm . "-*.json") ?: [];

        sort($vorhandene);

        $zuviel = count($vorhandene) - $this->sicherungenBehalten;

        for ($i = 0; $i < $zuviel; $i++) {
            @unlink($vorhandene[$i]);
        }
    }

    /* ===================== Kleinkram ===================== */

    private function ordnerSicherstellen(string $pfad): void
    {
        if (!is_dir($pfad) && !@mkdir($pfad, 0777, true) && !is_dir($pfad)) {
            throw new SpeicherFehler("Der Ordner " . $pfad . " lässt sich nicht anlegen.");
        }
    }

    /** Zeitstempel mit Mikrosekunden, damit zwei Änderungen sich unterscheiden. */
    private function jetzt(): string
    {
        $zeit      = microtime(true);
        $sekunden  = (int) $zeit;
        $bruchteil = (int) round(($zeit - $sekunden) * 1000000);

        if ($bruchteil >= 1000000) {
            $sekunden++;
            $bruchteil = 0;
        }

        return gmdate("Y-m-d\TH:i:s", $sekunden) . sprintf(".%06dZ", $bruchteil);
    }

    /** Kennung, die auch dann eindeutig ist, wenn zehn Rechner gleichzeitig anlegen. */
    private function neueKennung(): string
    {
        return "d" . base_convert((string) time(), 10, 36) . bin2hex(random_bytes(5));
    }
}
