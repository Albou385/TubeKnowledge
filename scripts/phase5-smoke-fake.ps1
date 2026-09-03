$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Output "Phase 5 - fumée factice hors réseau et hors vrai vault"
& node.exe "node_modules/tsx/dist/cli.mjs" "scripts/phase5-smoke-fake.ts"
if ($LASTEXITCODE -ne 0) { throw "La fumée factice Phase 5 a échoué." }
