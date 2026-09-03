[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$Confirmation = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CliArguments = @('node_modules/tsx/dist/cli.mjs', 'scripts/portability-cli.ts', 'maintenance')

if ($Apply) {
  if ($Confirmation -cne 'NETTOYER') { throw 'La confirmation exacte NETTOYER est requise.' }
  $CliArguments += @('--apply', '--confirmation', $Confirmation)
}

Push-Location $ProjectRoot
try {
  & node.exe @CliArguments
  if ($LASTEXITCODE -ne 0) { throw 'Maintenance locale echouee.' }
} finally {
  Pop-Location
}

if (-not $Apply) {
  Write-Output 'Dry-run uniquement. Aucun fichier n a ete supprime.'
}
