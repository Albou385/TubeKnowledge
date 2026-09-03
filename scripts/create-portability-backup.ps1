[CmdletBinding()] param([switch]$Full)
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot; $Arguments = @('node_modules/tsx/dist/cli.mjs','scripts/portability-cli.ts','backup'); if ($Full) { $Arguments += '--full' }
Push-Location $ProjectRoot; try { & node.exe @Arguments; if ($LASTEXITCODE -ne 0) { throw 'Creation du backup echouee.' } } finally { Pop-Location }

