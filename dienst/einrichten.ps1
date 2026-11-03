# Richtet den Webserver als Hintergrunddienst ein:
#
#   - eine Aufgabe in der Aufgabenplanung, die beim Systemstart den
#     Waechter startet - auch ohne angemeldeten Benutzer
#   - eine Freigabe in der Windows-Firewall, wenn "netzwerk = ja"
#   - das Symbol in der Taskleiste fuer alle, die sich anmelden
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

Write-Host "  Ordner   $Ordner"
Write-Host "  Node.js  $node"

if ($Ordner -like "$env:SystemDrive\Users\*") {
    Write-Host ""
    Write-Host "  Hinweis: Der Ordner liegt in einem Benutzerprofil. Andere Benutzer"
    Write-Host "  sehen dann das Taskleisten-Symbol nicht, und wird das Profil einmal"
    Write-Host "  geloescht, ist der Server weg. Besser ist ein eigener Ordner wie"
    Write-Host "  C:\Webserver - dann vorher 'Dienst entfernen.cmd', Ordner verschieben"
    Write-Host "  und hier neu einrichten."
}

# --- Laufende Instanzen beenden, damit der Port frei wird -----------------

$laufende = Get-WebserverProzesse

if ($laufende) {
    Write-Host ""
    Write-Host "  Beende den bisher laufenden Webserver ..."
    Stop-ScheduledTask -TaskName $Aufgabe -ErrorAction SilentlyContinue
    $laufende | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
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
                       -Description "Startet den lokalen Webserver ($Ordner) mit Windows und passt auf ihn auf." `
                       -Action $aktion -Trigger $ausloeser -Settings $einstellungen -Principal $konto `
                       -Force | Out-Null

Write-Host ""
Write-Host "  Aufgabe '$Aufgabe' eingerichtet - startet mit Windows."

# --- Windows-Firewall -------------------------------------------------

$port = Get-Einstellung "port" "8080"
$netzwerk = (Get-Einstellung "netzwerk" "nein").ToLower()

if (@("ja", "j", "an", "ein", "true", "1", "yes") -contains $netzwerk) {

    Get-NetFirewallRule -DisplayName "Lokaler Webserver*" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule

    New-NetFirewallRule -DisplayName "Lokaler Webserver (TCP $port)" `
                        -Direction Inbound -Protocol TCP -LocalPort $port `
                        -Action Allow -Profile Domain,Private | Out-Null

    Write-Host "  Firewall: Port $port fuer das Firmennetz freigegeben."
} else {
    Write-Host "  Firewall: unveraendert (netzwerk = nein, nur dieser Rechner)."
}

# --- Taskleisten-Symbol fuer alle Benutzer ----------------------------

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($Verknuepfung)
$link.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$link.Arguments = "`"$(Join-Path $PSScriptRoot 'taskleiste.vbs')`""
$link.WorkingDirectory = $Ordner
$link.Description = "Zeigt an, ob der Webserver laeuft"
$link.Save()

Write-Host "  Symbol in der Taskleiste startet bei jeder Anmeldung."

# --- Jetzt starten ----------------------------------------------------

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
