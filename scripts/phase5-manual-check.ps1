param([string]$AcquisitionId = "")

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Output "Phase 5 - contrôle manuel sans appel IA"
$arguments = @("node_modules/tsx/dist/cli.mjs", "scripts/phase5-manual-check.ts")
if ($AcquisitionId) { $arguments += $AcquisitionId }
& node.exe @arguments
if ($LASTEXITCODE -ne 0) { throw "Le contrôle manuel Phase 5 a échoué." }
