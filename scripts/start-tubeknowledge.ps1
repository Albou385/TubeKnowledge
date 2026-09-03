[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 3100,
  [switch]$Production,
  [switch]$OpenBrowser,
  [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Stop-WithError([string]$Message, [int]$Code) {
  [Console]::Error.WriteLine($Message)
  exit $Code
}

function Test-PortAvailable([int]$RequestedPort) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $RequestedPort)
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch [Net.Sockets.SocketException] {
    return $false
  } finally {
    if ($null -ne $listener) { $listener.Stop() }
  }
}

function Import-AllowedLocalEnvironment([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $allowed = @{
    YOUTUBE_LIBRARY_PATH = $true
    TUBEKNOWLEDGE_RUNTIME_PATH = $true
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH = $true
    TUBEKNOWLEDGE_PYTHON_PATH = $true
  }
  $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
  foreach ($line in [IO.File]::ReadAllLines($Path, $strictUtf8)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) { continue }
    $key = $trimmed.Substring(0, $separator).Trim()
    if (-not $allowed.ContainsKey($key)) { continue }
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, "Process"))) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $quotedWithDouble = $value.StartsWith('"') -and $value.EndsWith('"')
      $quotedWithSingle = $value.StartsWith("'") -and $value.EndsWith("'")
      if ($quotedWithDouble -or $quotedWithSingle) { $value = $value.Substring(1, $value.Length - 2) }
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($key, $value, "Process") }
  }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "package.json") -PathType Leaf)) { Stop-WithError "package.json est absent de la racine du projet." 5 }
  Import-AllowedLocalEnvironment (Join-Path $projectRoot ".env.local")

  $nodeVersion = (& node --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) { Stop-WithError "Node.js 20.9 ou plus récent est requis." 10 }
  $versionParts = ($nodeVersion -replace '^v', '').Split('.')
  $major = [int]$versionParts[0]
  $minor = if ($versionParts.Length -gt 1) { [int]$versionParts[1] } else { 0 }
  if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 9)) { Stop-WithError "Node.js détecté : $nodeVersion. Version minimale : 20.9." 11 }

  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules") -PathType Container)) {
    if (-not $InstallDependencies) { Stop-WithError "Dépendances absentes. Relancez avec -InstallDependencies pour exécuter npm ci." 12 }
    Write-Host "Installation des dépendances du projet avec npm ci…"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { Stop-WithError "npm ci a échoué." 13 }
  }

  if ([string]::IsNullOrWhiteSpace($env:YOUTUBE_LIBRARY_PATH)) { Stop-WithError "YOUTUBE_LIBRARY_PATH n’est défini ni dans PowerShell ni dans .env.local." 20 }
  if (-not [IO.Path]::IsPathRooted($env:YOUTUBE_LIBRARY_PATH)) { Stop-WithError "YOUTUBE_LIBRARY_PATH doit être absolu." 21 }
  if (-not (Test-Path -LiteralPath $env:YOUTUBE_LIBRARY_PATH -PathType Container)) { Stop-WithError "Le dossier de bibliothèque configuré est introuvable." 22 }
  if (-not (Test-Path -LiteralPath (Join-Path $env:YOUTUBE_LIBRARY_PATH "INDEX.md") -PathType Leaf)) { Stop-WithError "INDEX.md manque à la racine de la bibliothèque." 23 }

  if (-not $env:TUBEKNOWLEDGE_RUNTIME_PATH) { Write-Warning "TUBEKNOWLEDGE_RUNTIME_PATH n’est pas explicite; le runtime local par défaut sera utilisé." }
  if (-not $env:TUBEKNOWLEDGE_PORTABILITY_STATE_PATH) { Write-Warning "Portabilité Phase 6 désactivée : mode mono-machine historique." }
  if (-not $env:TUBEKNOWLEDGE_PYTHON_PATH) { Write-Warning "Python de transcription non configuré explicitement; consultez /diagnostics." }

  if (-not (Test-PortAvailable $Port)) {
    Stop-WithError "Le port $Port est déjà occupé. Fermez l’application qui l’utilise ou relancez TubeKnowledge avec -Port <port-libre>." 30
  }

  $url = "http://127.0.0.1:$Port"
  if ($OpenBrowser) {
    Start-Job -ScriptBlock { param($Target) Start-Sleep -Seconds 2; Start-Process $Target } -ArgumentList $url | Out-Null
  }
  Write-Host "TubeKnowledge démarre sur $url. Ctrl+C effectue l’arrêt propre du serveur."
  if ($Production) {
    & npm.cmd run start -- --hostname 127.0.0.1 --port $Port
  } else {
    & npm.cmd run dev -- --hostname 127.0.0.1 --port $Port
  }
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
