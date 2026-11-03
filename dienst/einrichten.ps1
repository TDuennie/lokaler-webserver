# Richtet den Webserver als Hintergrunddienst ein:
#
#   - eine Aufgabe in der Aufgabenplanung, die beim Systemstart den
#     Waechter startet - auch ohne angemeldeten Benutzer
#   - eine Freigabe in der Windows-Firewall, wenn "netzwerk = ja"
#   - das Symbol in der Taskleiste fuer alle, die sich anmelden
#
# Mehrere Ordner lassen sich so nebeneinander einrichten, jeder mit
# eigenem Port in seiner einstellungen.txt.
#
# Wird von "Als Dienst einrichten.cmd" als Administrator aufgerufen.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "gemeinsam.ps1")

Write-Host ""
Write-Host "  Webserver als Dienst einrichten"
Write-Host "  ==============================="
Write-Host ""

# --- Node.js finden: zuerst das mitgelieferte -------------------------

$node = @((Join-Path $Ordner "node.exe"), (Join-Path $Ordner "node\node.exe")) |
            Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $node) {
    $gefunden = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($gefunden) { $node = $gefunden.Source }
}

if (-not $node) {
    Write-Host "  Node.js wurde nicht gefunden. Bitte node.exe neben server.js legen."
    exit 1
}

if (-not (Test-Path (Join-Path $Ordner "einstellungen.txt"))) {
    Write-Host "  Es gibt noch keine einstellungen.txt. Bitte den Server einmal mit"
    Write-Host "  'Webserver mit Fenster starten.cmd' starten, Port und 'netzwerk'"
    Write-Host "  in der neuen einstellungen.txt eintragen und dann hier neu beginnen."
    exit 1
}

$port = Get-Einstellung "port" "8080"
$netzwerk = (Get-Einstellung "netzwerk" "nein").ToLower()
$imNetz = @("ja", "j", "an", "ein", "true", "1", "yes") -contains $netzwerk

Write-Host "  Name     $Name"
Write-Host "  Ordner   $Ordner"
Write-Host "  Port     $port"
Write-Host "  Node.js  $node"

if ($Ordner -like "$env:SystemDrive\Users\*") {
    Write-Host ""
    Write-Host "  Hinweis: Der Ordner liegt in einem Benutzerprofil. Andere Benutzer"
    Write-Host "  sehen dann das Taskleisten-Symbol nicht, und wird das Profil einmal"
    Write-Host "  geloescht, ist der Server weg. Besser ist ein eigener Ordner wie"
    Write-Host "  C:\Webserver\$Name - dann vorher 'Dienst entfernen.cmd', Ordner"
    Write-Host "  verschieben und dort neu einrichten."
}

# --- Gibt es den Namen schon fuer einen anderen Ordner? ---------------

$gleichnamig = Get-ScheduledTask -TaskName $Aufgabe -ErrorAction SilentlyContinue

if ($gleichnamig -and -not (@($gleichnamig.Actions | Where-Object { $_.WorkingDirectory -eq $Ordner }).Count)) {
    Write-Host ""
    Write-Host "  Es gibt schon einen Webserver namens '$Name' aus einem anderen Ordner:"
    Write-Host "  $(@($gleichnamig.Actions)[0].WorkingDirectory)"
    Write-Host ""
    Write-Host "  Bitte in einstellungen.txt einen eigenen Namen eintragen, zum Beispiel"
    Write-Host "    name = $Name 2"
    Write-Host "  und dann hier neu beginnen."
    exit 1
}

# --- Laufende Instanz DIESES Ordners beenden --------------------------

$alte = @(Get-EigeneAufgaben)
$alte | ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue }

$laufende = @(Get-WebserverProzesse)

if ($laufende.Count) {
    Write-Host ""
    Write-Host "  Beende den bisher laufenden Webserver aus diesem Ordner ..."
    $laufende | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# Alte Aufgaben dieses Ordners (etwa unter einem frueheren Namen) weg
$alte | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false }

# --- Ist der Port frei? -----------------------------------------------

$belegt = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($belegt) {

    $wer = Get-CimInstance Win32_Process -Filter "ProcessId=$($belegt.OwningProcess)" -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "  Port $port ist schon belegt von: $($wer.Name) $($wer.CommandLine)"
    Write-Host ""
    Write-Host "  Laufen zwei Webserver auf diesem Rechner, braucht jeder seinen"
    Write-Host "  eigenen Port. Bitte in einstellungen.txt einen anderen eintragen"
    Write-Host "  (etwa 8081) und dann hier neu beginnen."
    exit 1
}

# --- Aufgabe in der Aufgabenplanung -----------------------------------

$aktion = New-ScheduledTaskAction -Execute $node `
                                  -Argument "`"$(Join-Path $Ordner 'waechter.js')`"" `
                                  -WorkingDirectory $Ordner

$ausloeser = New-ScheduledTaskTrigger -AtStartup

# Keine Laufzeitgrenze (sonst beendet Windows die Aufgabe nach 3 Tagen),
# und faellt der Waechter selbst aus, startet Windows ihn jede Minute neu
$einstellungen = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew

$konto = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $Aufgabe `
                       -Description "Startet den lokalen Webserver aus $Ordner mit Windows und passt auf ihn auf." `
                       -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $konto `
                       -Force | Out-Null

Write-Host ""
Write-Host "  Aufgabe '$Aufgabe' eingerichtet - startet mit Windows."

# --- Windows-Firewall -------------------------------------------------

Get-NetFirewallRule -DisplayName "$Aufgabe (*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($imNetz) {

    New-NetFirewallRule -DisplayName "$Aufgabe (TCP $port)" `
                        -Description $Ordner `
                        -Direction Inbound -Protocol TCP -LocalPort $port `
                        -Action Allow -Profile Domain,Private | Out-Null

    Write-Host "  Firewall: Port $port fuer das Firmennetz freigegeben."
} else {
    Write-Host "  Firewall: keine Freigabe (netzwerk = nein, nur dieser Rechner)."
}

# --- Taskleisten-Symbol fuer alle Benutzer ----------------------------

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($Verknuepfung)
$link.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$link.Arguments = "`"$(Join-Path $PSScriptRoot 'taskleiste.vbs')`""
$link.WorkingDirectory = $Ordner
$link.Description = "Zeigt an, ob der Webserver '$Name' laeuft"
$link.Save()

Write-Host "  Symbol in der Taskleiste startet bei jeder Anmeldung."

# --- Jetzt starten ----------------------------------------------------

Remove-Item $StatusDatei -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $Aufgabe

Write-Host ""
Write-Host "  Starte den Webserver ..."

$bereit = $null

for ($i = 0; $i -lt 30 -and -not $bereit; $i++) {

    Start-Sleep -Seconds 1

    try {
        $status = Get-Content $StatusDatei -Raw -ErrorAction Stop | ConvertFrom-Json
        if ($status.zustand -eq "laeuft") { $bereit = $status }
    } catch {
        # Noch nicht da
    }
}

if ($bereit) {
    Write-Host "  Laeuft:  $($bereit.schema)://localhost:$($bereit.port)/"
} else {
    Write-Host "  Der Server meldet sich noch nicht. Was los ist, steht in:"
    Write-Host "  $LogDatei"
}

# Symbol gleich anzeigen, nicht erst nach der naechsten Anmeldung
Start-Process -FilePath (Join-Path $env:SystemRoot "System32\wscript.exe") `
              -ArgumentList "`"$(Join-Path $PSScriptRoot 'taskleiste.vbs')`""

Write-Host ""
Write-Host "  Fertig."
