[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Port = 3420
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$QaRoot = [IO.Path]::GetFullPath((Join-Path $TempRoot 'tubeknowledge-phase11b-playwright'))
$Server = $null

function Assert-SafeQaRoot([string]$Candidate) {
  $Resolved = [IO.Path]::GetFullPath($Candidate)
  if (-not $Resolved.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'La fixture E2E doit rester sous TEMP.' }
  if ((Split-Path -Leaf $Resolved) -ne 'tubeknowledge-phase11b-playwright') { throw 'Racine de fixture E2E inattendue.' }
}

function Stop-TestServer {
  if ($null -ne $Server -and -not $Server.HasExited) {
    Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
    $Server.WaitForExit(5000) | Out-Null
  }
  $Listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($Listener in $Listeners) {
    $Process = Get-Process -Id $Listener.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $Process -and $Process.ProcessName -eq 'node') {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

Assert-SafeQaRoot $QaRoot
$Existing = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($Existing.Count -gt 0) { throw "Le port $Port est déjà occupé; aucun processus n’a été arrêté." }

try {
  if (Test-Path -LiteralPath $QaRoot) { Remove-Item -LiteralPath $QaRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $QaRoot -Force | Out-Null

  $env:TUBEKNOWLEDGE_QA_ROOT = $QaRoot
  $env:TUBEKNOWLEDGE_NEXT_DIST_DIR = '.next-phase11b'
  $env:YOUTUBE_LIBRARY_PATH = Join-Path $QaRoot 'vault'
  $env:TUBEKNOWLEDGE_RUNTIME_PATH = Join-Path $QaRoot 'runtime'
  $env:TUBEKNOWLEDGE_IMPORT_SESSION_PATH = Join-Path $QaRoot 'import-sessions'
  $env:TUBEKNOWLEDGE_PORTABILITY_STATE_PATH = Join-Path $QaRoot 'state'
  $env:TUBEKNOWLEDGE_BACKUP_PATH = Join-Path $QaRoot 'backups'
  $env:TUBEKNOWLEDGE_ONEDRIVE_ROOT = Join-Path $QaRoot 'OneDrive'
  $env:TUBEKNOWLEDGE_MACHINE_NAME = 'Phase 11B QA'
  $env:TUBEKNOWLEDGE_MACHINE_ROLE = 'reader'
  $env:TUBEKNOWLEDGE_ANALYSIS_PROVIDER = 'manual'
  $env:TUBEKNOWLEDGE_ENABLE_PAID_AI = 'false'
  $env:OPENAI_API_KEY = ''
  $env:TUBEKNOWLEDGE_PHASE11B_EXTERNAL_SERVER = '1'

  Push-Location -LiteralPath $ProjectRoot
  try {
    & node.exe --import './scripts/node-tsx-windows-bootstrap.mjs' --import tsx './scripts/seed-phase11b-qa.ts'
    if ($LASTEXITCODE -ne 0) { throw 'La création de la fixture Phase 11B a échoué.' }

    $Stdout = Join-Path $QaRoot 'next-stdout.log'
    $Stderr = Join-Path $QaRoot 'next-stderr.log'
    $Server = Start-Process -FilePath (Get-Command node.exe).Source `
      -ArgumentList @('node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', $Port) `
      -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr

    $Healthy = $false
    for ($Attempt = 0; $Attempt -lt 120; $Attempt++) {
      if ($Server.HasExited) { break }
      try {
        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($Health.status -eq 'ok') { $Healthy = $true; break }
      } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $Healthy) { throw 'Le serveur E2E Phase 11B n’a pas répondu.' }

    & node.exe 'node_modules/@playwright/test/cli.js' test '--config=playwright.phase11b.config.ts'
    if ($LASTEXITCODE -ne 0) { throw "Playwright Phase 11B a échoué avec le code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
} finally {
  Stop-TestServer
  Assert-SafeQaRoot $QaRoot
  if (Test-Path -LiteralPath $QaRoot) { Remove-Item -LiteralPath $QaRoot -Recurse -Force }
}
