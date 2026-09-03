[CmdletBinding()] param([Parameter(Mandatory=$true)][string]$BackupId,[Parameter(Mandatory=$true)][string]$StagingPath)
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if (-not [IO.Path]::IsPathRooted($StagingPath)) { throw 'Le staging doit etre un chemin absolu explicite.' }
$ProjectRoot = Split-Path -Parent $PSScriptRoot; Push-Location $ProjectRoot
try { & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/portability-cli.ts' restore-staging --backup $BackupId --staging $StagingPath; if ($LASTEXITCODE -ne 0) { throw 'Restauration staging echouee.' } } finally { Pop-Location }
Write-Output 'Aucune restauration in-place n est lancee par ce wrapper.'

