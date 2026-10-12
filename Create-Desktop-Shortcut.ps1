# Creates a "Focus Board" shortcut on the Desktop that opens index.html
# in its own app window (no tabs / address bar) using Chrome or Edge.
# Run:  powershell -ExecutionPolicy Bypass -File .\Create-Desktop-Shortcut.ps1

$ErrorActionPreference = 'Stop'
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$index = Join-Path $here 'index.html'
$url   = ([System.Uri]$index).AbsoluteUri
$ico   = Join-Path $here 'icon.ico'

# --- Pick a browser (Chrome first, then Edge) ---
$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { throw 'Could not find Chrome or Edge.' }

# --- Generate icon.ico (PNG-in-ICO) if it doesn't exist ---
if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $size = 256
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  function RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r, $r, 180, 90)
    $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $p.CloseFigure()
    return $p
  }
  $indigo = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)
  $g.FillPath((New-Object System.Drawing.SolidBrush $indigo), (RoundRect 0 0 256 256 112))
  $cells = @(@(48, 48, 140), @(136, 48, 255), @(48, 136, 77), @(136, 136, 140))
  foreach ($c in $cells) {
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($c[2], 255, 255, 255))
    $g.FillPath($brush, (RoundRect $c[0] $c[1] 72 72 32))
  }
  $pen = New-Object System.Drawing.Pen $indigo, 12
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $g.DrawLines($pen, [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 154, 86),
    (New-Object System.Drawing.Point 167, 99),
    (New-Object System.Drawing.Point 191, 73)))
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $fs = [System.IO.File]::Create($ico)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)   # ICONDIR
  $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)  # 256x256
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
  $w.Write($png)
  $w.Close()
  $bmp.Dispose()
}

# --- Create the shortcut ---
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Focus Board.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $browser
$lnk.Arguments = "--app=`"$url`" --window-size=1400,900"
$lnk.WorkingDirectory = $here
$lnk.IconLocation = "$ico,0"
$lnk.Description = 'Focus Board - tasks and reminders'
$lnk.Save()

Write-Host "Shortcut created: $lnkPath"
Write-Host "Opens with: $browser"
