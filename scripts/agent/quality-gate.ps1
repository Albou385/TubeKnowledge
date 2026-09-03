[CmdletBinding()]
param(
  [ValidateSet('Feature', 'Hotfix', 'Portable', 'Release')]
  [string]$Profile = 'Feature'
)

$ErrorActionPreference = 'Stop'
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Failures = 0

function Invoke-Gate([string]$Name, [scriptblock]$Action) {
  Write-Host "== $Name =="
  try {
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Write-Host "[PASS] $Name"
  } catch {
    $script:Failures++
    Write-Host "[FAIL] $Name - $($_.Exception.Message)"
  }
}

function Invoke-Npm([string]$Script) {
  Invoke-Gate "npm:$Script" { & npm.cmd run $Script }
}

Push-Location -LiteralPath $ProjectRoot
try {
  foreach ($Script in @('lint', 'typecheck', 'test', 'build')) { Invoke-Npm $Script }

  if ($Profile -eq 'Hotfix') {
    for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
      Invoke-Gate "launcher Windows $Attempt/3" { & npm.cmd test -- 'src/lib/launcher-windows.test.ts' }
    }
    foreach ($Script in @('travel:smoke', 'phase11a:smoke', 'phase11b:smoke')) { Invoke-Npm $Script }
  }

  if ($Profile -eq 'Portable') {
    foreach ($Script in @('phase6:smoke', 'travel:smoke')) { Invoke-Npm $Script }
  }

  if ($Profile -eq 'Release') {
    for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
      Invoke-Gate "launcher Windows $Attempt/3" { & npm.cmd test -- 'src/lib/launcher-windows.test.ts' }
    }
    foreach ($Script in @('phase6:smoke', 'phase7:smoke', 'travel:smoke', 'phase11a:smoke', 'phase11b:smoke')) { Invoke-Npm $Script }
    Invoke-Npm 'test:worker'
    Invoke-Gate 'Parcours utilisateur fixture' { & powershell -NoProfile -ExecutionPolicy Bypass -File 'scripts/agent/user-journey-smoke.ps1' }
    Invoke-Gate 'Audit production' { & npm.cmd audit --omit=dev }
  }

  Invoke-Gate 'git diff branche --check' { & git diff --check 'origin/main...HEAD' }
  Invoke-Gate 'git diff index --check' { & git diff --cached --check }
  Invoke-Gate 'git diff worktree --check' { & git diff --check }
} finally {
  Pop-Location
}

Write-Host "Quality gate $Profile termine : FAIL=$Failures"
if ($Failures -gt 0) { exit 1 }
exit 0
