[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

Write-Host "Smoke Phase 7: orchestration, reprise, doublons et suppression sur fixtures temporaires."
& npx vitest run src/lib/workflows/workflows.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Smoke Phase 7 réussi. Aucun vault configuré n'a été utilisé."
