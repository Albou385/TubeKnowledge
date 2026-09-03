[CmdletBinding()]
param(
  [ValidateSet('Code', 'Portable', 'Release')]
  [string]$Profile = 'Code',
  [ValidateRange(1, 65535)]
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Failures = 0

function Invoke-Check([string]$Name, [scriptblock]$Action) {
  Write-Host "== $Name =="
  try {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Write-Host "[PASS] $Name"
  } catch {
    $script:Failures++
    Write-Host "[FAIL] $Name - $($_.Exception.Message)"
  }
}

Push-Location -LiteralPath $ProjectRoot
try {
  Invoke-Check 'Depot Git' {
    $GitRoot = (& git rev-parse --show-toplevel)
    if ($LASTEXITCODE -ne 0) { throw 'racine Git introuvable' }
    if ([IO.Path]::GetFullPath($GitRoot) -ne [IO.Path]::GetFullPath($ProjectRoot)) { throw 'racine Git inattendue' }
    & git status --short --branch
    if ($LASTEXITCODE -ne 0) { throw 'etat Git illisible' }
    & git worktree list --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'worktrees Git illisibles' }
  }
  Invoke-Check 'Node.js' { & node --version }
  Invoke-Check 'npm' { & npm.cmd --version }
  if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) {
    Write-Host '[WARN] Dependances absentes - executer npm.cmd ci explicitement.'
  }

  if ($Profile -ne 'Code') {
    Invoke-Check 'Preflight operationnel' { & powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/phase10-6-preflight.ps1' -Port $Port }
    Invoke-Check 'Outils de transcription' { & powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/check-transcription-tools.ps1' }
    Invoke-Check 'Diagnostic de portabilite' { & powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/check-portability.ps1' }
  }
} finally {
  Pop-Location
}

Write-Host "Preflight $Profile termine : FAIL=$Failures"
if ($Failures -gt 0) { exit 1 }
exit 0
