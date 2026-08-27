' Startet den Urlaubskalender ohne sichtbares Konsolenfenster.
' Der Browser oeffnet sich von selbst.

Option Explicit

Dim shell, fso, ordner, node

Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

' Immer im eigenen Ordner arbeiten - der Startpfad ist dadurch egal
ordner = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = ordner

' Zuerst die mitgelieferte node.exe, sonst ein installiertes Node.js
node = ""

If fso.FileExists(fso.BuildPath(ordner, "node.exe")) Then
    node = fso.BuildPath(ordner, "node.exe")
ElseIf fso.FileExists(fso.BuildPath(ordner, "node\node.exe")) Then
    node = fso.BuildPath(ordner, "node\node.exe")
ElseIf shell.Run("cmd /c where node", 0, True) = 0 Then
    node = "node"
End If

If node = "" Then
    MsgBox "Node.js wurde nicht gefunden." & vbCrLf & vbCrLf & _
           "Einfachste Loesung: die Datei ""node.exe"" in denselben" & vbCrLf & _
           "Ordner wie diese Datei legen. Sie steckt in der ZIP-Datei" & vbCrLf & _
           """Windows Binary (.zip)"" auf https://nodejs.org/en/download" & vbCrLf & _
           "im Ordner ""node-vXX-win-x64""." & vbCrLf & vbCrLf & _
           "Dann muss niemand etwas installieren.", _
           vbExclamation, "Urlaubskalender"
    WScript.Quit 1
End If

' 0 = kein Fenster, False = nicht auf das Ende warten
shell.Run """" & node & """ ""server.js""", 0, False
