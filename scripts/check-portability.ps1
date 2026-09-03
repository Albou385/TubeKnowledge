[CmdletBinding()] param()
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot; Push-Location $ProjectRoot
try { & node.exe 'node_modules/tsx/dist/cli.mjs' 'scripts/portability-cli.ts' status; if ($LASTEXITCODE -ne 0) { throw 'Diagnostic Phase 6 echoue.' } }
finally { Pop-Location }
Write-Output 'Synchronisation cloud non verifiee. Aucun appel Microsoft effectue.'

