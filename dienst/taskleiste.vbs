' Startet das Webserver-Symbol in der Taskleiste ohne sichtbares Fenster.

Option Explicit

Dim shell, fso, skript

Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

skript = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "taskleiste.ps1")

' 0 = kein Fenster, False = nicht auf das Ende warten
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & skript & """", 0, False
