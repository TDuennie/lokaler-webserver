<?php
/*
   Prueft, ob PHP und SQLite laufen. Diese Datei darf geloescht werden.
*/

$sqliteDa = extension_loaded("pdo_sqlite");
$sqliteMeldung = "";
$zeilen = [];

if ($sqliteDa) {

    try {
        // Datenbank im Ordner "daten" neben dem Server, nicht in "www":
        // so ist sie ueber den Browser gar nicht erst erreichbar.
        $ordner = dirname(__DIR__) . DIRECTORY_SEPARATOR . "daten";

        if (!is_dir($ordner)) {
            mkdir($ordner, 0777, true);
        }

        $db = new PDO("sqlite:" . $ordner . DIRECTORY_SEPARATOR . "test.sqlite");
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $db->exec("CREATE TABLE IF NOT EXISTS besuche (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       zeitpunkt TEXT NOT NULL)");

        $db->prepare("INSERT INTO besuche (zeitpunkt) VALUES (?)")
           ->execute([date("d.m.Y H:i:s")]);

        $zeilen = $db->query("SELECT id, zeitpunkt FROM besuche
                              ORDER BY id DESC LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);

        $anzahl = $db->query("SELECT COUNT(*) FROM besuche")->fetchColumn();

        $sqliteMeldung = "Datenbank angelegt und beschrieben – bisher "
                       . $anzahl . " Aufrufe gespeichert.";

    } catch (Throwable $fehler) {
        $sqliteDa = false;
        $sqliteMeldung = "Fehler: " . $fehler->getMessage();
    }

} else {
    $sqliteMeldung = 'Die Erweiterung "pdo_sqlite" ist nicht eingeschaltet. '
                   . 'In der Datei php.ini muss die Zeile "extension=pdo_sqlite" stehen.';
}
?>
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PHP-Test</title>
<style>
  body { font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 40rem; margin: 4rem auto; padding: 0 1.5rem; color: #1d2430; }
  h1 { font-size: 1.5rem; margin: 0 0 1.2rem; }
  h2 { font-size: 1rem; margin: 1.8rem 0 .5rem; }
  .marke { display: inline-block; border-radius: 999px; padding: .2rem .8rem;
           font-size: .85rem; font-weight: 600; }
  .gut { background: #e3f5ec; color: #1c7a52; }
  .schlecht { background: #fdeceb; color: #a8352b; }
  table { border-collapse: collapse; margin-top: .6rem; }
  td, th { border: 1px solid #e6e8ed; padding: .3rem .7rem; text-align: left; font-size: .9rem; }
  code { background: #f1f3f6; padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
  a { color: #1f5fb0; }
  @media (prefers-color-scheme: dark) {
    body { background: #15171b; color: #e6e8ec; }
    code { background: #22262c; } a { color: #7aa7ff; }
    td, th { border-color: #2b2f36; }
    .gut { background: #14301f; color: #7ee2ab; }
    .schlecht { background: #3a1c1a; color: #ff9f96; }
  }
</style>
</head>
<body>
  <h1>PHP-Test</h1>

  <h2>PHP</h2>
  <span class="marke gut">läuft</span>
  <p>Version <?= htmlspecialchars(PHP_VERSION) ?>
     &middot; Anfrage per <?= htmlspecialchars($_SERVER["REQUEST_METHOD"]) ?></p>

  <h2>SQLite</h2>
  <span class="marke <?= $sqliteDa ? "gut" : "schlecht" ?>">
    <?= $sqliteDa ? "läuft" : "nicht verfügbar" ?>
  </span>
  <p><?= htmlspecialchars($sqliteMeldung) ?></p>

<?php if ($zeilen): ?>
  <table>
    <tr><th>Nr.</th><th>Aufruf</th></tr>
    <?php foreach ($zeilen as $zeile): ?>
      <tr>
        <td><?= (int) $zeile["id"] ?></td>
        <td><?= htmlspecialchars($zeile["zeitpunkt"]) ?></td>
      </tr>
    <?php endforeach; ?>
  </table>
  <p>Seite neu laden – es kommt eine Zeile dazu.</p>
<?php endif; ?>

  <h2>Formular</h2>
  <form method="post">
    <input type="text" name="text" placeholder="Etwas eintippen"
           value="<?= htmlspecialchars($_POST["text"] ?? "") ?>">
    <button type="submit">Absenden</button>
  </form>
<?php if (isset($_POST["text"]) && $_POST["text"] !== ""): ?>
  <p>Empfangen: <code><?= htmlspecialchars($_POST["text"]) ?></code></p>
<?php endif; ?>

  <p style="margin-top:2rem"><a href="/">Zurück zur Startseite</a></p>
</body>
</html>
