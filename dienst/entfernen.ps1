# Nimmt alles wieder heraus, was "einrichten.ps1" angelegt hat.
# Der Ordner mit Server, Daten und Protokoll bleibt unangetastet.

$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "gemeinsam.ps1")

Write-Host ""
Write-Host "  Webserver-Dienst entfernen"
Write-Host "  =========================="
Write-Host ""

if (Get-ScheduledTask -TaskName $Aufgabe -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Aufgabe -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Aufgabe -Confirm:$false
    Write-Host "  Aufgabe '$Aufgabe' entfernt."
} else {
    Write-Host "  Keine Aufgabe '$Aufgabe' vorhanden."
}

Get-WebserverProzesse | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "  Webserver beendet."

Get-NetFirewallRule -DisplayName "Lokaler Webserver*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "  Firewall-Freigabe entfernt."

Remove-Item $Verknuepfung -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*taskleiste.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "  Taskleisten-Symbol entfernt."
Write-Host ""
Write-Host "  Fertig. Von Hand starten geht weiterhin mit 'Webserver starten.vbs'."
