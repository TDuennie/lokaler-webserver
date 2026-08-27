@echo off
REM Beendet den im Hintergrund laufenden Urlaubskalender.
cd /d "%~dp0"

echo   Urlaubskalender wird beendet...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$treffer = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' };" ^
  "if ($treffer) { $treffer | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host '  Beendet.' }" ^
  "else { Write-Host '  Es lief kein Urlaubskalender.' }"

timeout /t 3 >nul
