<?php
declare(strict_types=1);

/*
   Beispiel: eine gemeinsame Liste, die im Sync-Ordner liegt.
   Zeigt, wie "lib/speicher.php" benutzt wird. Darf gelöscht werden.
*/

require __DIR__ . "/lib/speicher.php";

// Die Datei liegt bewusst NEBEN dem www-Ordner, nicht darin -
// so kommt niemand über den Browser an sie heran.
$speicher = new Speicher(__DIR__ . "/../daten/liste.json");

$meldung = null;
$fehler  = null;

// Wer gerade arbeitet - nur zur Anzeige, wird mitgespeichert
$rechner = gethostname() ?: "unbekannt";

try {

    if ($_SERVER["REQUEST_METHOD"] === "POST") {

        $was = $_POST["was"] ?? "";

        if ($was === "speichern") {

            $titel = trim((string) ($_POST["titel"] ?? ""));

            if ($titel === "") {
                throw new SpeicherFehler("Bitte einen Text eingeben.");
            }

            $felder = [
                "titel"     => $titel,
                "notiz"     => trim((string) ($_POST["notiz"] ?? "")),
                "erledigt"  => isset($_POST["erledigt"]),
                "bearbeiter"=> $rechner,
            ];

            if (($_POST["id"] ?? "") !== "") {
                $felder["id"] = (string) $_POST["id"];
            }

            $speicher->sichern($felder);
            $meldung = ($felder["id"] ?? null) ? "Geändert." : "Gespeichert.";

        } elseif ($was === "loeschen") {

            $speicher->loeschen((string) ($_POST["id"] ?? ""));
            $meldung = "Gelöscht.";
        }

        // Nach dem Speichern umleiten, damit ein Neuladen nichts doppelt anlegt
        header("Location: ?meldung=" . rawurlencode((string) $meldung));
        exit;
    }

    $eintraege = $speicher->alle();

    // Neueste zuerst
    usort($eintraege, fn(array $a, array $b): int => strcmp($b["geaendert"], $a["geaendert"]));

} catch (SpeicherFehler $ausnahme) {
    $fehler = $ausnahme->getMessage();
    $eintraege = $eintraege ?? [];
}

$meldung = $meldung ?? ($_GET["meldung"] ?? null);

/** Zeitstempel lesbar machen. */
function zeitpunkt(string $iso): string
{
    $zeit = strtotime($iso);

    return $zeit === false ? "" : date("d.m.Y H:i", $zeit);
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemeinsame Liste</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 44rem; margin: 3rem auto; padding: 0 1.5rem; color: #1d2430; }
  h1 { font-size: 1.45rem; margin: 0 0 .3rem; }
  .leise { color: #6b7484; font-size: .9rem; margin-top: 0; }
  form.neu { display: grid; gap: .6rem; margin: 1.6rem 0 2rem;
             padding: 1.1rem; border: 1px solid #dfe3e8; border-radius: 10px; }
  input[type=text], textarea { font: inherit; padding: .5rem .65rem; width: 100%;
             border: 1px solid #cfd5dc; border-radius: 7px; background: #fff; color: inherit; }
  textarea { min-height: 3.5rem; resize: vertical; }
  button { font: inherit; padding: .45rem .9rem; border-radius: 7px;
           border: 1px solid #cfd5dc; background: #fff; cursor: pointer; }
  button.haupt { background: #1f5fb0; border-color: #1f5fb0; color: #fff; font-weight: 500; }
  .reihe { display: flex; gap: .5rem; align-items: center; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { border: 1px solid #dfe3e8; border-radius: 10px; padding: .8rem 1rem; margin-bottom: .6rem; }
  li.fertig .titel { text-decoration: line-through; color: #8a919b; }
  .titel { font-weight: 600; }
  .fuss { color: #8a919b; font-size: .82rem; margin-top: .35rem; }
  .hinweis { background: #e7f3ec; color: #16653c; padding: .55rem .8rem;
             border-radius: 7px; margin-bottom: 1rem; font-size: .92rem; }
  .fehler { background: #fdeceb; color: #a8352b; padding: .55rem .8rem;
            border-radius: 7px; margin-bottom: 1rem; font-size: .92rem; }
  details summary { cursor: pointer; color: #1f5fb0; font-size: .9rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #15171b; color: #e6e8ec; }
    input[type=text], textarea, button { background: #1e2126; border-color: #333a42; color: #e6e8ec; }
    button.haupt { background: #2f6fc0; border-color: #2f6fc0; color: #fff; }
    li, form.neu { border-color: #2b313a; }
    .hinweis { background: #13301f; color: #7ee2ab; }
    .fehler { background: #34191a; color: #ff9f96; }
  }
</style>
</head>
<body>

<h1>Gemeinsame Liste</h1>
<p class="leise">
  Liegt in <code>daten/liste.json</code> im Sync-Ordner. Alle Arbeitsplätze
  schreiben in dieselbe Datei, ohne sich zu überschreiben.
</p>

<?php if ($meldung): ?>
  <p class="hinweis"><?= htmlspecialchars((string) $meldung) ?></p>
<?php endif; ?>

<?php if ($fehler): ?>
  <p class="fehler"><?= htmlspecialchars($fehler) ?></p>
<?php endif; ?>

<form class="neu" method="post">
  <input type="hidden" name="was" value="speichern">
  <input type="text" name="titel" placeholder="Was ist zu tun?" required autofocus>
  <textarea name="notiz" placeholder="Notiz (optional)"></textarea>
  <div class="reihe">
    <button type="submit" class="haupt">Hinzufügen</button>
  </div>
</form>

<?php if (!$eintraege): ?>
  <p class="leise">Noch nichts eingetragen.</p>
<?php endif; ?>

<ul>
<?php foreach ($eintraege as $eintrag): ?>
  <li class="<?= ($eintrag["erledigt"] ?? false) ? "fertig" : "" ?>">
    <div class="titel"><?= htmlspecialchars((string) $eintrag["titel"]) ?></div>

    <?php if (($eintrag["notiz"] ?? "") !== ""): ?>
      <div><?= nl2br(htmlspecialchars((string) $eintrag["notiz"])) ?></div>
    <?php endif; ?>

    <div class="fuss">
      <?= zeitpunkt((string) $eintrag["geaendert"]) ?>
      &middot; <?= htmlspecialchars((string) ($eintrag["bearbeiter"] ?? "?")) ?>
    </div>

    <details>
      <summary>Ändern</summary>
      <form method="post" style="margin-top:.6rem;display:grid;gap:.5rem">
        <input type="hidden" name="was" value="speichern">
        <input type="hidden" name="id" value="<?= htmlspecialchars((string) $eintrag["id"]) ?>">
        <input type="text" name="titel" value="<?= htmlspecialchars((string) $eintrag["titel"]) ?>" required>
        <textarea name="notiz"><?= htmlspecialchars((string) ($eintrag["notiz"] ?? "")) ?></textarea>
        <label class="reihe">
          <input type="checkbox" name="erledigt" <?= ($eintrag["erledigt"] ?? false) ? "checked" : "" ?>>
          erledigt
        </label>
        <div class="reihe">
          <button type="submit" class="haupt">Speichern</button>
        </div>
      </form>
      <form method="post" style="margin-top:.4rem"
            onsubmit="return confirm('Diesen Eintrag löschen?')">
        <input type="hidden" name="was" value="loeschen">
        <input type="hidden" name="id" value="<?= htmlspecialchars((string) $eintrag["id"]) ?>">
        <button type="submit">Löschen</button>
      </form>
    </details>
  </li>
<?php endforeach; ?>
</ul>

</body>
</html>
