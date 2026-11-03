# Gemeinsame Angaben fuer Einrichten, Entfernen und das Taskleisten-Symbol

$Script:Ordner      = Split-Path -Parent $PSScriptRoot
$Script:Aufgabe     = "Lokaler Webserver"
$Script:Protokolle  = Join-Path $Ordner "protokoll"
$Script:StatusDatei = Join-Path $Protokolle "status.json"
$Script:LogDatei    = Join-Path $Protokolle "server.log"
$Script:Verknuepfung = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\Webserver-Symbol.lnk"

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

# Prozesse des Webservers (Waechter und Server) auf diesem Rechner
function Get-WebserverProzesse {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like "*server.js*" -or $_.CommandLine -like "*waechter.js*" }
}
