@echo off
REM Startet den Webserver sichtbar. Hier stehen alle Meldungen -
REM diese Datei nehmen, wenn etwas nicht klappt.
cd /d "%~dp0"
title Webserver

set "NODE="
if exist "%~dp0node.exe"                          set "NODE=%~dp0node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE where node >nul 2>&1 && set "NODE=node"

if not defined NODE (
  echo.
  echo   Node.js wurde nicht gefunden.
  echo.
  echo   Am einfachsten: die Datei "node.exe" neben diese Datei legen.
  echo   Sie steckt in der ZIP-Datei "Windows Binary (.zip)" auf
  echo   https://nodejs.org/en/download  im Ordner "node-vXX-win-x64".
  echo   Dann muss nichts installiert werden.
  echo.
  pause
  exit /b 1
)

"%NODE%" server.js
echo.
echo   Der Webserver wurde beendet.
pause
