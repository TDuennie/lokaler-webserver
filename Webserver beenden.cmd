@echo off
REM Beendet den Webserver aus diesem Ordner. Laufen auf dem Rechner noch
REM andere Webserver aus anderen Ordnern, bleiben die an.
cd /d "%~dp0"

echo   Webserver wird beendet...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dienst\beenden.ps1"

timeout /t 5 >nul
