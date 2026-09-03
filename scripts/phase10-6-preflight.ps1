[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 3100
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Status, [string]$Check, [string]$Message) {
  $results.Add([pscustomobject]@{ Status = $Status; Check = $Check; Message = $Message })
}

function Read-LocalEnvironment([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
  $allowed = @{
    YOUTUBE_LIBRARY_PATH = $true
    TUBEKNOWLEDGE_RUNTIME_PATH = $true
    TUBEKNOWLEDGE_PYTHON_PATH = $true
    TUBEKNOWLEDGE_FFMPEG_PATH = $true
  }
  $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
  foreach ($line in [IO.File]::ReadAllLines($Path, $strictUtf8)) {
    $trimmed = $line.Trim().TrimStart([char]0xFEFF)
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -le 0) { continue }
    $key = $trimmed.Substring(0, $separator).Trim()
    if (-not $allowed.ContainsKey($key)) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($value)) { $values[$key] = $value }
  }
  return $values
}

$localEnvironment = Read-LocalEnvironment (Join-Path $projectRoot ".env.local")
function Local-Value([string]$Name) {
  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue }
  if ($localEnvironment.ContainsKey($Name)) { return $localEnvironment[$Name] }
  return $null
}

try {
  $nodeVersion = (& node --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)') { throw "runtime invalide" }
  $major = [int]$Matches[1]; $minor = [int]$Matches[2]
  if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 9)) { Add-Result "FAIL" "Node.js" "Node.js 20.9 ou plus récent est requis." }
  else { Add-Result "PASS" "Node.js" "Runtime compatible détecté." }
} catch { Add-Result "FAIL" "Node.js" "Node.js est absent ou inutilisable." }

try { $null = (& npm.cmd --version 2>$null); if ($LASTEXITCODE -ne 0) { throw "npm" }; Add-Result "PASS" "npm" "npm est disponible." }
catch { Add-Result "FAIL" "npm" "npm est absent ou inutilisable." }

try {
  $inside = (& git rev-parse --is-inside-work-tree 2>$null)
  if ($LASTEXITCODE -ne 0 -or $inside -ne "true") { throw "git" }
  Add-Result "PASS" "Git" "Le dépôt Git est reconnu."
  $dirty = @(& git status --short 2>$null)
  if ($dirty.Count -gt 0) { Add-Result "WARN" "Dépôt" "Le dépôt contient des changements locaux; vérifiez-les avant qualification." }
  else { Add-Result "PASS" "Dépôt" "Le dépôt est propre." }
} catch { Add-Result "FAIL" "Git" "Git est absent ou le dossier n'est pas un dépôt valide." }

$vault = Local-Value "YOUTUBE_LIBRARY_PATH"
if ([string]::IsNullOrWhiteSpace($vault)) { Add-Result "FAIL" "Bibliothèque" "La configuration locale de la bibliothèque est absente." }
elseif (-not [IO.Path]::IsPathRooted($vault) -or -not (Test-Path -LiteralPath $vault -PathType Container)) { Add-Result "FAIL" "Bibliothèque" "La bibliothèque configurée est indisponible." }
else {
  try { $null = [IO.File]::OpenRead((Join-Path $vault "INDEX.md")).Dispose(); Add-Result "PASS" "Bibliothèque" "La bibliothèque et son index sont lisibles." }
  catch { Add-Result "FAIL" "Bibliothèque" "L'index de la bibliothèque est absent ou illisible." }
}

$runtime = Local-Value "TUBEKNOWLEDGE_RUNTIME_PATH"
if ([string]::IsNullOrWhiteSpace($runtime)) {
  $localRoot = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $env:TEMP } else { $env:LOCALAPPDATA }
  $runtime = Join-Path $localRoot "TubeKnowledge\runtime"
}
if (Test-Path -LiteralPath $runtime -PathType Container) { Add-Result "PASS" "Runtime local" "Le runtime local existe." }
else { Add-Result "WARN" "Runtime local" "Le runtime local n'existe pas encore; la consultation reste disponible." }

$python = Local-Value "TUBEKNOWLEDGE_PYTHON_PATH"
if ([string]::IsNullOrWhiteSpace($python)) {
  $venvPython = Join-Path $projectRoot ".venv-transcription\Scripts\python.exe"
  if (Test-Path -LiteralPath $venvPython -PathType Leaf) { $python = $venvPython }
}
if ([string]::IsNullOrWhiteSpace($python)) { Add-Result "WARN" "Python" "Python de transcription n'est pas configuré." }
else {
  try { $null = (& $python --version 2>$null); if ($LASTEXITCODE -ne 0) { throw "python" }; Add-Result "PASS" "Python" "Python configuré répond correctement." }
  catch { Add-Result "WARN" "Python" "Python configuré ne répond pas correctement." }
}

$ffmpeg = Local-Value "TUBEKNOWLEDGE_FFMPEG_PATH"
if ([string]::IsNullOrWhiteSpace($ffmpeg)) { $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue; if ($command) { $ffmpeg = $command.Source } }
if ([string]::IsNullOrWhiteSpace($ffmpeg)) { Add-Result "WARN" "FFmpeg" "FFmpeg n'est pas disponible pour la transcription locale." }
else {
  try { $null = (& $ffmpeg -version 2>$null); if ($LASTEXITCODE -ne 0) { throw "ffmpeg" }; Add-Result "PASS" "FFmpeg" "FFmpeg répond correctement." }
  catch { Add-Result "WARN" "FFmpeg" "FFmpeg configuré ne répond pas correctement." }
}

if ([string]::IsNullOrWhiteSpace($python)) { Add-Result "WARN" "yt-dlp" "yt-dlp ne peut pas être vérifié sans Python configuré." }
else {
  try { $null = (& $python -m yt_dlp --version 2>$null); if ($LASTEXITCODE -ne 0) { throw "yt-dlp" }; Add-Result "PASS" "yt-dlp" "yt-dlp répond correctement." }
  catch { Add-Result "WARN" "yt-dlp" "yt-dlp n'est pas importable par le Python configuré." }
}

function Test-LoopbackPortAvailable([Net.IPAddress]$Address, [bool]$IPv6Only = $false) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener($Address, $Port)
    $listener.Server.ExclusiveAddressUse = $true
    if ($IPv6Only) { $listener.Server.DualMode = $false }
    $listener.Start()
    return $true
  } catch [Net.Sockets.SocketException] {
    return $false
  } finally {
    if ($null -ne $listener) { $listener.Stop() }
  }
}

# Interroger d'abord l'application : sous Windows, un serveur Next lié à :: peut
# accepter 127.0.0.1 via dual-stack tout en laissant un bind IPv4 de contrôle réussir.
# Le comportement HTTP est donc la preuve prioritaire qu'une instance est déjà lancée.
$health = $null; $apiResponds = $false
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Method Get -TimeoutSec 3
  $apiResponds = $true
} catch { $apiResponds = $false }

if ($apiResponds) {
  try {
    if ($health.status -ne "ok" -or $health.schemaVersion -ne 1) { throw "service inattendu" }
    Add-Result "PASS" "Santé API" "TubeKnowledge répond sur le port demandé."
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/diagnostics" -Method Get -TimeoutSec 5
    Add-Result "PASS" "Diagnostic API" "La route de diagnostic sûre répond."
  } catch { Add-Result "FAIL" "Port" "Le port est occupé par un service qui ne répond pas comme TubeKnowledge." }
} else {
  $ipv4Available = Test-LoopbackPortAvailable ([Net.IPAddress]::Loopback)
  $ipv6Available = if ([Net.Sockets.Socket]::OSSupportsIPv6) {
    Test-LoopbackPortAvailable ([Net.IPAddress]::IPv6Loopback) $true
  } else { $true }
  $portAvailable = $ipv4Available -and $ipv6Available

  if ($portAvailable) {
    Add-Result "PASS" "Port" "Le port demandé est disponible."
    Add-Result "WARN" "API" "Le serveur n'est pas lancé; les routes sûres n'ont pas été interrogées."
  } else {
    Add-Result "FAIL" "Port" "Le port est occupé par un service qui ne répond pas comme TubeKnowledge."
  }
}

$pass = @($results | Where-Object Status -eq "PASS").Count
$warn = @($results | Where-Object Status -eq "WARN").Count
$fail = @($results | Where-Object Status -eq "FAIL").Count
Write-Host "TubeKnowledge - préqualification locale"
foreach ($result in $results) { Write-Host ("[{0}] {1} - {2}" -f $result.Status, $result.Check, $result.Message) }
Write-Host ("Résumé : PASS={0} WARN={1} FAIL={2}" -f $pass, $warn, $fail)
if ($fail -gt 0) { exit 1 }
exit 0
