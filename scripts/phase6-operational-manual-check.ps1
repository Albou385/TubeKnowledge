[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectRoot
try {
  & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/phase6-operational-manual-check.ts'
  if ($LASTEXITCODE -ne 0) { throw 'Controle manuel operationnel Phase 6.1 echoue.' }
} finally {
  Pop-Location
}
