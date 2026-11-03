# Beendet den Webserver aus DIESEM Ordner - andere Webserver auf dem
# Rechner laufen weiter. Wird von "Webserver beenden.cmd" aufgerufen.

. (Join-Path $PSScriptRoot "gemeinsam.ps1")

# Laeuft er als Dienst, zuerst die Aufgabe anhalten - sonst startet der
# Waechter ihn gleich wieder. Das klappt nur mit Administratorrechten.
Get-EigeneAufgaben | ForEach-Object {
    Stop-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue
}

$treffer = @(Get-WebserverProzesse)

if ($treffer.Count) {

    $treffer | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500

    if (@(Get-WebserverProzesse).Count) {
        Write-Host "  Der Webserver laeuft als Dienst und laesst sich nur mit"
        Write-Host "  Administratorrechten beenden (Rechtsklick > Als Administrator"
        Write-Host "  ausfuehren). Neu starten geht auch ueber das Symbol in der Taskleiste."
    } else {
        Write-Host "  Beendet."
    }

} else {
    Write-Host "  Es lief kein Webserver aus diesem Ordner."
}
