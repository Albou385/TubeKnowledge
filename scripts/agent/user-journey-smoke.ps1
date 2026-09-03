[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Push-Location -LiteralPath $ProjectRoot
try {
  $BrowserPath = (& node -e "const { chromium } = require('@playwright/test'); process.stdout.write(chromium.executablePath())")
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($BrowserPath)) {
    throw 'Playwright est indisponible. Executer npm.cmd ci avant ce smoke.'
  }
  if (-not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
    Write-Host '[BLOCKED] Chromium Playwright est absent.'
    Write-Host 'Action : npx.cmd playwright install chromium'
    exit 2
  }

  Write-Host '[SCOPE] QUEUE_FIXTURE_ONLY - fixture sous TEMP; aucun vrai vault ni reseau YouTube.'
  & npm.cmd run 'e2e:phase11b'
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host '[PASS] Interface Phase 11B sur fixture. Le parcours Phase 11C complet reste une preuve distincte.'
  exit 0
} finally {
  Pop-Location
}
