@echo off
REM Beendet den im Hintergrund laufenden Webserver.
cd /d "%~dp0"

echo   Webserver wird beendet...

REM Laeuft er als Dienst, zuerst die Aufgabe anhalten - sonst startet der
REM Waechter ihn gleich wieder. Das klappt nur mit Administratorrechten.
schtasks /end /tn "Lokaler Webserver" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$treffer = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*waechter.js*' };" ^
  "if ($treffer) { $treffer | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host '  Beendet.' }" ^
  "else { Write-Host '  Es lief kein Webserver.' }"

echo.
echo   Ist der Webserver als Dienst eingerichtet, startet er mit dem
echo   naechsten Windows-Start wieder. Dauerhaft abschalten:
echo   "Dienst entfernen.cmd"

timeout /t 5 >nul
