# Gemeinsame Angaben fuer Einrichten, Entfernen, Beenden und das
# Taskleisten-Symbol.
#
# Auf einem Rechner duerfen mehrere Webserver laufen - jeder aus seinem
# eigenen Ordner, mit eigenem Port. Deshalb haengt hier alles am Ordner:
# der Name der Aufgabe, die Firewall-Regel, das Symbol und die Prozesse.

$Script:Ordner      = Split-Path -Parent $PSScriptRoot
$Script:Protokolle  = Join-Path $Ordner "protokoll"
$Script:StatusDatei = Join-Path $Protokolle "status.json"
$Script:LogDatei    = Join-Path $Protokolle "server.log"

# Einen Wert aus einstellungen.txt lesen, etwa "port"
function Get-Einstellung([string]$Name, [string]$Standard) {

    $datei = Join-Path $Ordner "einstellungen.txt"

    if (Test-Path $datei) {
        foreach ($zeile in Get-Content $datei) {
            $ohneKommentar = ($zeile -split "#")[0]
            if ($ohneKommentar -match "^\s*$Name\s*=\s*(.+?)\s*$") {
                return $Matches[1]
            }
        }
    }

    return $Standard
}

# Der Name dieses Servers: "name = ..." aus einstellungen.txt, sonst der
# Name des Ordners. Zeichen, die Windows in Aufgabennamen nicht mag, raus.
$Script:Name = Get-Einstellung "name" (Split-Path -Leaf $Ordner)
$Script:Name = ($Name -replace '[\\/:*?"<>|]', "_").Trim()

$Script:Aufgabe = "Lokaler Webserver - $Name"
$Script:Verknuepfung = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\Webserver-Symbol $Name.lnk"

# Kurzer, fester Schluessel je Ordner, etwa fuer die Sperre des Symbols
$Script:OrdnerKennung = ([BitConverter]::ToString(
    [System.Security.Cryptography.SHA1]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($Ordner.ToLowerInvariant())))).Replace("-", "").Substring(0, 12)

# Die Aufgabe dieses Ordners - gefunden am Arbeitsordner, nicht am Namen,
# damit sie auch nach einer Namensaenderung wiedergefunden wird
function Get-EigeneAufgaben {
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
        @($_.Actions | Where-Object { $_.WorkingDirectory -eq $Ordner }).Count -gt 0
    }
}

# Waechter und Server aus DIESEM Ordner - die eines anderen Ordners
# bleiben unberuehrt. Erkannt am vollen Pfad in der Befehlszeile.
function Get-WebserverProzesse {

    $server   = (Join-Path $Ordner "server.js").ToLowerInvariant()
    $waechter = (Join-Path $Ordner "waechter.js").ToLowerInvariant()

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $zeile = "$($_.CommandLine)".ToLowerInvariant()
        $zeile.Contains($server) -or $zeile.Contains($waechter)
    }
}
