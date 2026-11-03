@echo off
REM Nimmt den Webserver-Dienst wieder heraus. Ordner, Daten und
REM Protokoll bleiben erhalten. Braucht Administratorrechte.
cd /d "%~dp0"

net session >nul 2>&1
if not errorlevel 1 goto los

echo   Zum Entfernen werden Administratorrechte gebraucht ...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:los
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dienst\entfernen.ps1"
echo.
pause
