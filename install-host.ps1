# Registers the local yt-dlp native host for this unpacked extension.
# ASCII only so Windows PowerShell 5.1 parses it without a UTF-8 BOM.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostDir = Join-Path $root 'host'
$manifestFile = Join-Path $root 'manifest.json'
$cs = Join-Path $hostDir 'yt_host.cs'
$exe = Join-Path $hostDir 'yt_host.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
  throw "csc.exe was not found."
}
& $csc /nologo /target:winexe "/out:$exe" $cs
if ($LASTEXITCODE -ne 0) { throw "Failed to compile yt_host.exe." }

$python = (& py -3 -c "import sys; print(sys.executable)").Trim()
if (-not (Test-Path -LiteralPath $python)) { throw "Python 3 was not found." }
& $python -c "import yt_dlp"
if ($LASTEXITCODE -ne 0) {
  Write-Output "Installing yt-dlp for the current user."
  & $python -m pip install --user -U "yt-dlp>=2026.7.4"
  if ($LASTEXITCODE -ne 0) { throw "Could not install yt-dlp." }
  & $python -c "import yt_dlp"
  if ($LASTEXITCODE -ne 0) { throw "yt-dlp is still not importable." }
}

$node = ""
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) { $node = $nodeCmd.Source }
if (-not $node) {
  $fallbackNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $fallbackNode) { $node = $fallbackNode }
}
if (-not (Test-Path -LiteralPath $node)) { throw "Node.js was not found. yt-dlp needs it." }

$ffmpeg = ""
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegCmd) { $ffmpeg = $ffmpegCmd.Source }
if (-not $ffmpeg) {
  $fallbackFfmpeg = Join-Path $env:APPDATA 'VideoToolkit\bin\ffmpeg.exe'
  if (Test-Path -LiteralPath $fallbackFfmpeg) { $ffmpeg = $fallbackFfmpeg }
}
if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "ffmpeg was not found." }

[System.IO.File]::WriteAllText((Join-Path $hostDir 'python.path'), $python)
$toolsJson = @{ node = $node; ffmpeg = $ffmpeg } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $hostDir 'tools.json'), $toolsJson)

function Get-ExtensionId([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  $alphabet = 'abcdefghijklmnop'
  $builder = New-Object System.Text.StringBuilder
  foreach ($b in $sha[0..15]) {
    [void]$builder.Append($alphabet.Substring(($b -shr 4), 1))
    [void]$builder.Append($alphabet.Substring(($b -band 15), 1))
  }
  return $builder.ToString()
}

$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$keyId = Get-ExtensionId ([Convert]::FromBase64String($manifest.key))
# Unpacked loads that have not picked up the key yet keep the path-based id.
$pathId = Get-ExtensionId ([System.Text.Encoding]::Unicode.GetBytes($root))
$origins = @("chrome-extension://$keyId/", "chrome-extension://$pathId/") | Select-Object -Unique
$hostManifestPath = Join-Path $hostDir 'com.youtubetitles.downloader.json'
$hostJson = @{
  name = 'com.youtubetitles.downloader'
  description = 'Local yt-dlp host for the YouTube title copier extension'
  path = $exe
  type = 'stdio'
  allowed_origins = @($origins)
} | ConvertTo-Json
[System.IO.File]::WriteAllText($hostManifestPath, $hostJson)

$registryKeys = @(
  'Software\Google\Chrome\NativeMessagingHosts\com.youtubetitles.downloader',
  'Software\Chromium\NativeMessagingHosts\com.youtubetitles.downloader',
  'Software\Microsoft\Edge\NativeMessagingHosts\com.youtubetitles.downloader'
)
foreach ($name in $registryKeys) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($name)
  $key.SetValue('', $hostManifestPath)
  $key.Close()
}

Write-Output "Installed native host."
Write-Output "Extension ids: $($origins -join ', ')"
Write-Output "Reload the unpacked extension at chrome://extensions."
