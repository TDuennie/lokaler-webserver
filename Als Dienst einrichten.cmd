@echo off
REM Richtet den Webserver als Dienst ein: Er startet mit Windows, auch
REM ohne Anmeldung, wird bei Stoerungen neu gestartet und zeigt sich
REM mit einem Symbol in der Taskleiste. Braucht Administratorrechte.
cd /d "%~dp0"

net session >nul 2>&1
if not errorlevel 1 goto los

echo   Fuer die Einrichtung werden Administratorrechte gebraucht ...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:los
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dienst\einrichten.ps1"
echo.
pause
