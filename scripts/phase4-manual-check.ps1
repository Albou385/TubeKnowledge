[CmdletBinding()]
param(
    [string]$Url = ''
)

$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
function U([string]$Text) { [regex]::Unescape($Text) }
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Write-Host (U 'TubeKnowledge - contr\u00f4le manuel Phase 4')
Write-Host (U '1. Ex\u00e9cutez scripts/check-transcription-tools.ps1.')
Write-Host (U '2. D\u00e9marrez npm.cmd run dev depuis la racine du projet.')
Write-Host '3. Ouvrez http://localhost:3000/acquisitions/new.'
Write-Host (U '4. Choisissez vous-m\u00eame une courte vid\u00e9o publique et collez son URL.')
Write-Host (U '5. Inspectez-la, privil\u00e9giez des sous-titres existants, puis confirmez explicitement tout recours \u00e0 Whisper.')
Write-Host (U '6. Sur la page d\u00e9tail, v\u00e9rifiez la progression, testez Annuler, puis contr\u00f4lez le nettoyage et les artifacts.')
if ($Url) { Write-Host (U "URL fournie pour copie manuelle : $Url") }
Write-Host "Projet : $ProjectRoot"
Write-Host (U 'Ce script ne d\u00e9marre aucun t\u00e9l\u00e9chargement, ne lance aucun mod\u00e8le et ne modifie pas .env.local.')
