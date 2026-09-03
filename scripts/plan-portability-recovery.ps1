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
  $Raw = & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/portability-cli.ts' 'plan-recovery'
  if ($LASTEXITCODE -ne 0) { throw 'Plan de recuperation echoue.' }
  if ($Json) {
    $Raw
  } else {
    $Plan = $Raw | ConvertFrom-Json
    Write-Output "Plan read-only pour l'etat writer: $($Plan.writerState)"
    $Index = 1
    foreach ($Step in @($Plan.steps)) {
      Write-Output "$Index. $Step"
      $Index++
    }
    Write-Output "Aucune action n'a ete appliquee."
  }
} finally {
  Pop-Location
}
