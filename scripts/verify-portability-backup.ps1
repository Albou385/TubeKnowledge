[CmdletBinding()] param([Parameter(Mandatory=$true)][string]$BackupId)
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot; Push-Location $ProjectRoot
try { & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/portability-cli.ts' verify --backup $BackupId; if ($LASTEXITCODE -ne 0) { throw 'Verification du backup echouee.' } } finally { Pop-Location }

