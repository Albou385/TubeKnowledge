[CmdletBinding()]
param(
  [ValidateSet('Audit', 'Prepare')]
  [string]$Mode = 'Audit',

  [string]$OutputDirectory,

  [ValidateRange(2, 60)]
  [int]$DurationDays = 45,

  [string]$Confirmation,

  [string]$FinalConfirmation,

  [switch]$Fixture
)

$ErrorActionPreference = 'Stop'
$Utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Cli = './scripts/travel-portability-cli.ts'
$TsxBootstrap = './scripts/node-tsx-windows-bootstrap.mjs'
$TsxPackage = Join-Path $ProjectRoot 'node_modules\tsx\package.json'

if (-not (Test-Path -LiteralPath $TsxPackage -PathType Leaf)) {
  throw 'Les dépendances locales sont absentes. Exécutez npm.cmd ci avant ce script.'
}

Push-Location -LiteralPath $ProjectRoot
try {
  if ($Mode -eq 'Audit') {
    Write-Output 'Audit de préparation au voyage (strictement non destructif).'
    Write-Output 'OneDrive est observé localement seulement; aucun état cloud n’est certifié.'
    & node.exe --import $TsxBootstrap --import tsx $Cli audit
    $Code = $LASTEXITCODE
    if ($Code -eq 2) {
      Write-Output 'NO-GO : corrigez les contrôles FAIL avant toute préparation.'
      exit 2
    }
    if ($Code -ne 0) { throw 'L’audit de voyage a échoué techniquement.' }
    Write-Output 'GO technique pour envisager Prepare; ce résultat ne prépare aucun handoff.'
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($OutputDirectory) -or -not [IO.Path]::IsPathRooted($OutputDirectory)) {
    throw 'Prepare exige -OutputDirectory avec un chemin absolu explicitement choisi.'
  }
  if ($Confirmation -ne 'PREPARER ABSENCE') {
    throw 'Prepare exige -Confirmation "PREPARER ABSENCE".'
  }
  if ($FinalConfirmation -ne 'LIBERER LA TOUR') {
    throw 'La libération finale exige -FinalConfirmation "LIBERER LA TOUR".'
  }

  Write-Warning 'Prepare crée un backup et un bundle, puis libère réellement le writer Tour en dernière étape.'
  Write-Warning 'Après succès, la Tour ne doit plus être utilisée pour écrire dans le vault.'
  $PrepareArguments = @('--import', $TsxBootstrap, '--import', 'tsx', $Cli, 'prepare', '--output', $OutputDirectory, '--days', $DurationDays, '--confirmation', 'PREPARER ABSENCE', '--final-confirmation', 'LIBERER LA TOUR')
  if ($Fixture) { $PrepareArguments += '--fixture' }
  & node.exe @PrepareArguments
  if ($LASTEXITCODE -ne 0) { throw 'Prepare a échoué. Lisez le diagnostic avant toute nouvelle tentative.' }
  Write-Output 'NE PLUS ÉCRIRE DEPUIS LA TOUR'
  Write-Output 'Conservez le bundle froid et ses trois fichiers compagnons jusqu’à l’import sur le Portable.'
} finally {
  Pop-Location
}
