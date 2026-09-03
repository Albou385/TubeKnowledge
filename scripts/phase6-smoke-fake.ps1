[CmdletBinding()] param()
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot; Push-Location $ProjectRoot
try { & node.exe --import './scripts/node-tsx-windows-bootstrap.mjs' --import tsx 'scripts/phase6-smoke-fake.ts'; if ($LASTEXITCODE -ne 0) { throw 'Fumee factice Phase 6 echouee.' } } finally { Pop-Location }

