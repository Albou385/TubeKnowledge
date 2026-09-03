[CmdletBinding()]
param(
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectRoot
try {
  $Raw = & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/portability-cli.ts' 'diagnose'
  if ($LASTEXITCODE -ne 0) { throw 'Diagnostic de portabilite echoue.' }
  if ($Json) {
    $Raw
  } else {
    $Diagnostic = $Raw | ConvertFrom-Json
    Write-Output "[INFO] Writer: $($Diagnostic.writer.state); lease valide: $($Diagnostic.writer.leaseValid); canWrite: $($Diagnostic.writer.canWrite)"
    Write-Output "[INFO] Checkpoint: $($Diagnostic.checkpoint.checkpointId); backups: $(@($Diagnostic.backups).Count); conflits: $(@($Diagnostic.conflicts).Count)"
    Write-Output "[INFO] Disponibilite: $($Diagnostic.availability.localState); placeholders: $(@($Diagnostic.availability.placeholders).Count); reparse points: $(@($Diagnostic.availability.reparsePoints).Count)"
    foreach ($Issue in @($Diagnostic.issues)) { Write-Output "[$($Issue.level.ToUpperInvariant())] $($Issue.code): $($Issue.message)" }
    Write-Output "[INFO] Action recommandee: $($Diagnostic.writer.recommendedAction)"
    Write-Output "[INFO] Synchronisation cloud non verifiee; aucun appel Microsoft."
  }
} finally {
  Pop-Location
}
