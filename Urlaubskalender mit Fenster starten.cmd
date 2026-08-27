@echo off
REM Startet den Urlaubskalender sichtbar in einem Fenster.
REM Nuetzlich, wenn etwas nicht klappt - hier stehen die Meldungen.
cd /d "%~dp0"
title Urlaubskalender

REM Zuerst die mitgelieferte node.exe verwenden. Nur wenn sie fehlt,
REM auf ein am Arbeitsplatz installiertes Node.js ausweichen.
set "NODE="
if exist "%~dp0node.exe"          set "NODE=%~dp0node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE where node >nul 2>&1 && set "NODE=node"

if not defined NODE (
  echo.
  echo   Node.js wurde nicht gefunden.
  echo.
  echo   Einfachste Loesung: die Datei "node.exe" neben diese Datei legen.
  echo   Sie steckt in der ZIP-Datei "Windows Binary (.zip)" auf
  echo   https://nodejs.org/en/download  ^(Ordner "node-vXX-win-x64"^).
  echo   Dann muss niemand etwas installieren.
  echo.
  pause
  exit /b 1
)

"%NODE%" server.js
echo.
echo   Der Urlaubskalender wurde beendet.
pause
