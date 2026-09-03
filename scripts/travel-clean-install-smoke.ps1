[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$Source = Split-Path -Parent $PSScriptRoot
$TempBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$Root = [IO.Path]::GetFullPath((Join-Path $TempBase ('tk-travel-clean-' + [guid]::NewGuid().ToString('N'))))

function Assert-SafeTemporaryRoot([string]$Candidate) {
  $Resolved = [IO.Path]::GetFullPath($Candidate)
  if (-not $Resolved.StartsWith($TempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'La simulation doit rester sous TEMP.' }
  if (-not (Split-Path -Leaf $Resolved).StartsWith('tk-travel-clean-')) { throw 'Nom de racine temporaire inattendu.' }
}

Assert-SafeTemporaryRoot $Root
$Clone = Join-Path $Root 'clone'
$Vault = Join-Path $Root 'OneDrive\projet_youtube'
$Runtime = Join-Path $Root 'runtime'
$State = Join-Path $Root 'state'
$Backups = Join-Path $Root 'backups'
$Sessions = Join-Path $Root 'sessions'
$NpmCache = Join-Path $Root 'npm-cache'
$Server = $null

try {
  New-Item -ItemType Directory -Path (Join-Path $Vault '02_SOURCES') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $Vault 'INDEX.md'), ('# Fixture clone propre' + [Environment]::NewLine), $Utf8)
  [IO.File]::WriteAllText((Join-Path $Vault '02_SOURCES\videos.md'), ('# Videos' + [Environment]::NewLine), $Utf8)

  & git clone --quiet --no-local $Source $Clone | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Le clone local temporaire a échoué.' }

  # Tant que la mission interdit commit/staging, superposer l’arbre courant simule le futur clone de la branche.
  $Changed = @(& git -C $Source diff --name-only)
  $Untracked = @(& git -C $Source ls-files --others --exclude-standard)
  foreach ($Relative in @($Changed + $Untracked | Sort-Object -Unique)) {
    if ([string]::IsNullOrWhiteSpace($Relative)) { continue }
    $From = Join-Path $Source $Relative
    $To = Join-Path $Clone $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $To) -Force | Out-Null
    Copy-Item -LiteralPath $From -Destination $To -Force
  }

  Push-Location -LiteralPath $Clone
  try {
    $PreviousNodeOptions = $env:NODE_OPTIONS
    $env:NODE_OPTIONS = (($PreviousNodeOptions, '--use-system-ca') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' '
    & npm.cmd ci --no-audit --no-fund --cache $NpmCache
    if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué dans le clone temporaire.' }
    $env:NODE_OPTIONS = $PreviousNodeOptions
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Le build production a échoué dans le clone temporaire.' }

    $env:YOUTUBE_LIBRARY_PATH = $Vault
    $env:TUBEKNOWLEDGE_RUNTIME_PATH = $Runtime
    $env:TUBEKNOWLEDGE_IMPORT_SESSION_PATH = $Sessions
    $env:TUBEKNOWLEDGE_PORTABILITY_STATE_PATH = $State
    $env:TUBEKNOWLEDGE_BACKUP_PATH = $Backups
    $env:TUBEKNOWLEDGE_ONEDRIVE_ROOT = Split-Path -Parent $Vault
    $env:TUBEKNOWLEDGE_MACHINE_NAME = 'Portable clone fixture'
    $env:TUBEKNOWLEDGE_MACHINE_ROLE = 'reader'
    $env:TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS = '0'

    $Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $Listener.Start() } catch { throw "Le port $Port est déjà occupé; aucun processus n’a été arrêté." } finally { $Listener.Stop() }

    $NextBin = Join-Path $Clone 'node_modules\next\dist\bin\next'
    $ProcessInfo = [Diagnostics.ProcessStartInfo]::new()
    $ProcessInfo.FileName = (Get-Command node.exe).Source
    $ProcessInfo.Arguments = ('"{0}" dev --port {1}' -f $NextBin, $Port)
    $ProcessInfo.WorkingDirectory = $Clone
    $ProcessInfo.UseShellExecute = $false
    $ProcessInfo.CreateNoWindow = $true
    $Server = [Diagnostics.Process]::new()
    $Server.StartInfo = $ProcessInfo
    if (-not $Server.Start()) { throw 'Le serveur temporaire n’a pas démarré.' }
    $Health = $null
    for ($Index = 0; $Index -lt 60; $Index++) {
      if ($Server.HasExited) { break }
      try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $Health -or $Health.status -ne 'ok') { throw 'La santé du serveur temporaire n’a pas répondu.' }
    $Diagnostic = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/diagnostics" -TimeoutSec 15
    [pscustomobject]@{
      CloneCreated = $true
      CurrentChangesOverlaid = ($Changed.Count + $Untracked.Count) -gt 0
      NpmCi = $true
      ProductionBuild = $true
      Port = $Port
      Health = $Health.status
      DiagnosticSchema = $Diagnostic.schemaVersion
      VaultFixtureOnly = $true
      RuntimeFixtureOnly = $true
    } | ConvertTo-Json -Compress
  } finally {
    Pop-Location
  }
} finally {
  if ($null -ne $Server -and -not $Server.HasExited) { Stop-Process -Id $Server.Id -Force }
  Assert-SafeTemporaryRoot $Root
  if (Test-Path -LiteralPath $Root) { Remove-Item -LiteralPath $Root -Recurse -Force }
}
