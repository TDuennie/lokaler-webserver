# Nimmt alles wieder heraus, was "einrichten.ps1" fuer DIESEN Ordner
# angelegt hat. Andere Webserver auf dem Rechner bleiben unberuehrt,
# ebenso Server, Daten und Protokoll in diesem Ordner.

$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "gemeinsam.ps1")

Write-Host ""
Write-Host "  Webserver-Dienst entfernen: $Name"
Write-Host "  ================================"
Write-Host ""

$aufgaben = @(Get-EigeneAufgaben)

foreach ($aufgabe in $aufgaben) {
    Stop-ScheduledTask -TaskName $aufgabe.TaskName -TaskPath $aufgabe.TaskPath -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $aufgabe.TaskName -TaskPath $aufgabe.TaskPath -Confirm:$false
    Write-Host "  Aufgabe '$($aufgabe.TaskName)' entfernt."
}

if (-not $aufgaben.Count) {
    Write-Host "  Fuer diesen Ordner ist keine Aufgabe eingerichtet."
}

Get-WebserverProzesse | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "  Webserver aus diesem Ordner beendet."

# Die Firewall-Regel steht unter dem Namen der Aufgabe, der Ordner in der
# Beschreibung - so wird auch eine unter frueherem Namen gefunden
Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "$Aufgabe (*" -or $_.Description -eq $Ordner } |
    Remove-NetFirewallRule
Write-Host "  Firewall-Freigabe entfernt."

Remove-Item $Verknuepfung -ErrorAction SilentlyContinue

$symbolSkript = (Join-Path $PSScriptRoot "taskleiste.ps1").ToLowerInvariant()

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { "$($_.CommandLine)".ToLowerInvariant().Contains($symbolSkript) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "  Taskleisten-Symbol entfernt."
Write-Host ""
Write-Host "  Fertig. Von Hand starten geht weiterhin mit 'Webserver starten.vbs'."
