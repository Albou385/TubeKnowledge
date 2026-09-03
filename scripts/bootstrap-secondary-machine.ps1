[CmdletBinding()] param()
$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js est requis.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd est requis.' }
Push-Location $ProjectRoot
try { & npm.cmd install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install a echoue.' }; & powershell -ExecutionPolicy Bypass -File 'scripts/configure-portability.ps1'; Write-Output 'Configuration affichee. Relancez avec -WriteEnvFile seulement apres verification.'; Write-Output 'Setup transcription facultatif: scripts/setup-transcription.ps1' }
finally { Pop-Location }
Write-Output 'Aucun runtime, modele, venv, .env.local ou remote Git n a ete copie ou cree automatiquement.'

