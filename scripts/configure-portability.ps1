[CmdletBinding()]
param([switch]$WriteEnvFile)
$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8; [Console]::OutputEncoding = $Utf8; $OutputEncoding = $Utf8
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Candidates = @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
Write-Output 'Racines OneDrive locales probables (diagnostic local uniquement):'
if ($Candidates.Count -eq 0) { Write-Output '  Aucune racine detectee. Fournissez un chemin explicitement.' } else { for ($Index = 0; $Index -lt $Candidates.Count; $Index++) { Write-Output "  [$Index] $($Candidates[$Index])" } }
$OneDriveRoot = Read-Host 'Saisissez explicitement la racine OneDrive locale'
if (-not $OneDriveRoot -or -not [IO.Path]::IsPathRooted($OneDriveRoot)) { throw 'Une racine OneDrive absolue explicite est requise.' }
$LocalRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'TubeKnowledge\portability'
$Lines = @(
  'TUBEKNOWLEDGE_MACHINE_NAME=',
  'TUBEKNOWLEDGE_MACHINE_ROLE=reader',
  "TUBEKNOWLEDGE_PORTABILITY_STATE_PATH=$LocalRoot",
  "TUBEKNOWLEDGE_BACKUP_PATH=$(Join-Path $LocalRoot 'backups')",
  "TUBEKNOWLEDGE_ONEDRIVE_ROOT=$OneDriveRoot",
  'TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS=3',
  'TUBEKNOWLEDGE_WRITER_LEASE_MINUTES=30',
  'TUBEKNOWLEDGE_BACKUP_RETENTION_COUNT=10'
)
Write-Output 'Lignes a ajouter a .env.local:'; $Lines | ForEach-Object { Write-Output $_ }
if ($WriteEnvFile) {
  $Confirmation = Read-Host 'Saisissez ECRIRE pour ajouter ces lignes a .env.local'
  if ($Confirmation -ne 'ECRIRE') { throw 'Confirmation refusee; .env.local est intact.' }
  Add-Content -LiteralPath (Join-Path $ProjectRoot '.env.local') -Encoding utf8 -Value ("`r`n# Phase 6 - configuration locale`r`n" + ($Lines -join "`r`n"))
  Write-Output '.env.local mis a jour apres confirmation explicite.'
} else { Write-Output '.env.local intact. Utilisez -WriteEnvFile seulement si vous souhaitez une ecriture confirmee.' }

