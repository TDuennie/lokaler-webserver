# Symbol im Infobereich der Taskleiste: zeigt, ob der Webserver laeuft.
#
#   gruen   laeuft und antwortet
#   gelb    startet gerade (neu)
#   rot     gestoert - der Waechter startet ihn von selbst neu
#   grau    nicht eingerichtet oder beendet
#
# Im Punkt steht der Anfangsbuchstabe des Namens (name = ... in
# einstellungen.txt, sonst der Ordnername).
#
# Den Zustand liest es aus protokoll\status.json, die der Waechter alle
# zehn Sekunden schreibt. Gestartet wird es ueber taskleiste.vbs, damit
# kein Fenster aufblitzt.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. (Join-Path $PSScriptRoot "gemeinsam.ps1")

$neustartDatei = Join-Path $Protokolle "neustart"

# Nur ein Symbol je Benutzer und Ordner - laufen zwei Webserver, gibt es zwei
$erstes = $false
$Script:Sperre = [System.Threading.Mutex]::new($true, "Local\LokalerWebserverSymbol_$OrdnerKennung", [ref]$erstes)
if (-not $erstes) { exit }

[System.Windows.Forms.Application]::EnableVisualStyles()

function New-Punkt([int]$Rot, [int]$Gruen, [int]$Blau) {

    $bild = New-Object System.Drawing.Bitmap 32, 32
    $flaeche = [System.Drawing.Graphics]::FromImage($bild)
    $flaeche.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $flaeche.Clear([System.Drawing.Color]::Transparent)

    $pinsel = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($Rot, $Gruen, $Blau))
    $flaeche.FillEllipse($pinsel, 3, 3, 26, 26)

    $rand = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 255)), 2
    $flaeche.DrawEllipse($rand, 3, 3, 26, 26)

    # Der Anfangsbuchstabe des Namens - laufen zwei Webserver, sieht man
    # so auf einen Blick, welcher Punkt zu welchem gehoert
    if ($Kuerzel) {

        $schrift = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $mitte = New-Object System.Drawing.StringFormat
        $mitte.Alignment = [System.Drawing.StringAlignment]::Center
        $mitte.LineAlignment = [System.Drawing.StringAlignment]::Center

        $flaeche.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $flaeche.DrawString($Kuerzel, $schrift, [System.Drawing.Brushes]::White,
                            (New-Object System.Drawing.RectangleF(0, 1, 32, 32)), $mitte)
        $schrift.Dispose()
    }

    $flaeche.Dispose()

    return [System.Drawing.Icon]::FromHandle($bild.GetHicon())
}

$Script:Kuerzel = if ($Name) { $Name.Substring(0, 1).ToUpper() } else { "" }

$Script:Punkte = @{
    laeuft   = New-Punkt 46 160 67
    startet  = New-Punkt 219 160 0
    gestoert = New-Punkt 207 34 46
    aus      = New-Punkt 140 140 140
}

$Script:Symbol = New-Object System.Windows.Forms.NotifyIcon
$Symbol.Icon = $Punkte.aus
$Symbol.Text = "Webserver $Name"
$Symbol.Visible = $true

# --- Zustand lesen -----------------------------------------------------

$Script:Status = $null
$Script:Anzeige = $null

function Read-Zustand {

    if (-not (Test-Path $StatusDatei)) {
        return @{ Art = "aus"; Text = "nicht eingerichtet"; Status = $null }
    }

    try {
        $status = [System.IO.File]::ReadAllText($StatusDatei) | ConvertFrom-Json
    } catch {
        # Wird gerade geschrieben - beim naechsten Takt wieder
        return $null
    }

    $alter = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [double]$status.aktualisiertMs) / 1000

    if ($status.zustand -eq "beendet") {
        return @{ Art = "aus"; Text = "beendet"; Status = $status }
    }

    if ($alter -gt 90) {
        return @{ Art = "gestoert"; Text = "Waechter laeuft nicht"; Status = $status }
    }

    switch ($status.zustand) {
        "laeuft"   { return @{ Art = "laeuft";   Text = "laeuft, Port $($status.port)"; Status = $status } }
        "startet"  { return @{ Art = "startet";  Text = "startet ..."; Status = $status } }
        default    { return @{ Art = "gestoert"; Text = "gestoert - Neustart folgt"; Status = $status } }
    }
}

function Update-Symbol {

    $neu = Read-Zustand

    if (-not $neu) {
        return
    }

    $vorher = if ($Anzeige) { $Anzeige.Art } else { $null }

    $Script:Status = $neu.Status
    $Script:Anzeige = $neu

    $text = "Webserver $($Name): " + $neu.Text

    # Mehr als 63 Zeichen nimmt Windows hier nicht
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }

    $Symbol.Icon = $Punkte[$neu.Art]
    $Symbol.Text = $text

    if ($vorher -eq "laeuft" -and $neu.Art -eq "gestoert") {
        $Symbol.ShowBalloonTip(8000, "Webserver $Name gestoert",
            "Der Webserver antwortet nicht. Er wird automatisch neu gestartet.",
            [System.Windows.Forms.ToolTipIcon]::Warning)
    }

    if ($vorher -eq "gestoert" -and $neu.Art -eq "laeuft") {
        $Symbol.ShowBalloonTip(5000, "Webserver $Name",
            "Der Webserver laeuft wieder.",
            [System.Windows.Forms.ToolTipIcon]::Info)
    }
}

# --- Menue --------------------------------------------------------------

function Open-Browser {

    $schema = "http"
    $port = Get-Einstellung "port" "8080"

    if ($Status -and $Status.port) {
        $schema = $Status.schema
        $port = $Status.port
    }

    Start-Process "$($schema)://localhost:$port/"
}

function Request-Neustart {

    if ($Anzeige -and @("laeuft", "startet") -contains $Anzeige.Art) {

        try {
            New-Item -Path $neustartDatei -ItemType File -Force | Out-Null
            $Symbol.ShowBalloonTip(4000, "Webserver $Name", "Der Webserver wird neu gestartet.",
                [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Der Neustart liess sich nicht anfordern:`n`n" + $_.Exception.Message,
                "Webserver $Name") | Out-Null
        }

        return
    }

    # Der Waechter selbst laeuft nicht - die Aufgabe starten. Das braucht
    # Administratorrechte, Windows fragt dann nach.
    try {
        Start-Process -FilePath "schtasks.exe" -ArgumentList "/run /tn `"$Aufgabe`"" `
                      -Verb RunAs -WindowStyle Hidden
        $Symbol.ShowBalloonTip(4000, "Webserver $Name", "Der Webserver wird gestartet.",
            [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        # Abgebrochen
    }
}

function Open-Protokoll {

    if (Test-Path $LogDatei) {
        Start-Process notepad.exe -ArgumentList "`"$LogDatei`""
    } else {
        [System.Windows.Forms.MessageBox]::Show("Es gibt noch kein Protokoll.", "Webserver $Name") | Out-Null
    }
}

$menue = New-Object System.Windows.Forms.ContextMenuStrip

$eintrag = $menue.Items.Add("Im Browser öffnen")
$eintrag.Font = New-Object System.Drawing.Font($eintrag.Font, [System.Drawing.FontStyle]::Bold)
$eintrag.Add_Click({ Open-Browser })

$menue.Items.Add("Server neu starten").Add_Click({ Request-Neustart })
$menue.Items.Add("Protokoll anzeigen").Add_Click({ Open-Protokoll })
$menue.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menue.Items.Add("Symbol ausblenden").Add_Click({
    $Takt.Stop()
    $Symbol.Visible = $false
    $Symbol.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$Symbol.ContextMenuStrip = $menue

$Symbol.Add_MouseDoubleClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-Browser }
})

# --- Los geht's ------------------------------------------------------

$Script:Takt = New-Object System.Windows.Forms.Timer
$Takt.Interval = 5000
$Takt.Add_Tick({ Update-Symbol })
$Takt.Start()

Update-Symbol

[System.Windows.Forms.Application]::Run()
