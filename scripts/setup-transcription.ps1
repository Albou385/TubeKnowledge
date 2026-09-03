[CmdletBinding()]
param(
    [string]$VenvPythonExecutable = ''
)

$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvPath = Join-Path $ProjectRoot '.venv-transcription'
$DefaultVenvPython = Join-Path $VenvPath 'Scripts\python.exe'

function U([string]$Text) { return [regex]::Unescape($Text) }

function Stop-Setup([string]$Message) {
    [Console]::Error.WriteLine("ERREUR - $(U $Message)")
    exit 1
}

function Test-PythonRuntime([string]$Command, [string[]]$PrefixArguments = @()) {
    try {
        $VersionOutput = & $Command @PrefixArguments --version 2>&1
        $ExitCode = $LASTEXITCODE
    } catch {
        return $false
    }
    if ($ExitCode -ne 0) { return $false }
    $VersionText = [string]::Join(' ', @($VersionOutput))
    $Match = [regex]::Match($VersionText, 'Python\s+(\d+)\.(\d+)')
    if (-not $Match.Success) { return $false }
    $Major = [int]$Match.Groups[1].Value
    $Minor = [int]$Match.Groups[2].Value
    return ($Major -gt 3 -or ($Major -eq 3 -and $Minor -ge 10))
}

$VenvPython = $DefaultVenvPython
if ($VenvPythonExecutable) {
    $Candidate = [IO.Path]::GetFullPath($VenvPythonExecutable)
    $ExpectedScriptsPath = [IO.Path]::GetFullPath((Join-Path $VenvPath 'Scripts'))
    if (-not [string]::Equals((Split-Path -Parent $Candidate), $ExpectedScriptsPath, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Setup 'L''ex\u00e9cutable de venv fourni doit rester sous .venv-transcription\Scripts.'
    }
    $VenvPython = $Candidate
}

function Test-PythonImport([string]$Module) {
    try {
        $null = & $VenvPython -c "import $Module" 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Get-MissingWorkerModules() {
    $Missing = @()
    if (-not (Test-PythonImport 'yt_dlp')) { $Missing += 'yt_dlp' }
    if (-not (Test-PythonImport 'faster_whisper')) { $Missing += 'faster_whisper' }
    return @($Missing)
}

function Get-PipVersion() {
    try {
        $VersionOutput = & $VenvPython -m pip --version 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        $Match = [regex]::Match([string]::Join(' ', @($VersionOutput)), '\bpip\s+([0-9]+(?:\.[0-9]+){1,3})\b')
        if (-not $Match.Success) { return $null }
        return [version]$Match.Groups[1].Value
    } catch {
        return $null
    }
}

function Ensure-PipTrustStoreSupport() {
    $MinimumVersion = [version]'22.2'
    $CurrentVersion = Get-PipVersion
    if ($CurrentVersion -and $CurrentVersion -ge $MinimumVersion) {
        Write-Host "OK - pip $CurrentVersion prend en charge truststore."
        return
    }

    Write-Host (U 'INFO - pip est absent ou ant\u00e9rieur \u00e0 22.2; bootstrap hors ligne avec ensurepip.')
    & $VenvPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) {
        Stop-Setup 'Le bootstrap hors ligne ensurepip a \u00e9chou\u00e9. R\u00e9parez l''installation Python, puis relancez le script.'
    }

    $UpdatedVersion = Get-PipVersion
    if (-not $UpdatedVersion -or $UpdatedVersion -lt $MinimumVersion) {
        Stop-Setup 'pip 22.2 ou plus r\u00e9cent est requis pour le magasin de certificats syst\u00e8me. Installez une distribution Python maintenue qui l''inclut, puis relancez le script.'
    }
    Write-Host "OK - ensurepip a fourni pip $UpdatedVersion compatible avec truststore."
}

Write-Host (U 'TubeKnowledge - pr\u00e9paration du worker de transcription (sans droits administrateur)')
Write-Host "Projet : $ProjectRoot"

$VenvAlreadyExisted = Test-Path -LiteralPath $VenvPython -PathType Leaf
if ($VenvAlreadyExisted) {
    if (-not (Test-PythonRuntime $VenvPython)) {
        Stop-Setup 'Le venv existe, mais son interpr\u00e9teur est inutilisable ou incompatible. R\u00e9parez ou recr\u00e9ez .venv-transcription avec Python 3.12.'
    }
    Write-Host (U 'OK - venv existant et ex\u00e9cutable; mise \u00e0 jour idempotente des d\u00e9pendances.')
} else {
    $RuntimeCommand = $null
    $RuntimePrefix = @()
    $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($PyLauncher) {
        if (Test-PythonRuntime $PyLauncher.Source @('-3.12')) {
            $RuntimeCommand = $PyLauncher.Source
            $RuntimePrefix = @('-3.12')
            Write-Host (U 'OK - launcher py et runtime Python 3.12 d\u00e9tect\u00e9s.')
        } else {
            Write-Host (U 'INFO - launcher py d\u00e9tect\u00e9, mais aucun runtime Python 3.12 utilisable.')
        }
    }
    if (-not $RuntimeCommand) {
        $GlobalPython = Get-Command python -ErrorAction SilentlyContinue
        if ($GlobalPython -and (Test-PythonRuntime $GlobalPython.Source)) {
            $RuntimeCommand = $GlobalPython.Source
            $RuntimePrefix = @()
            Write-Host (U 'OK - runtime Python global compatible d\u00e9tect\u00e9.')
        }
    }
    if (-not $RuntimeCommand) {
        Stop-Setup 'Aucun runtime Python compatible ne peut ex\u00e9cuter --version. Installez Python 3.12 avec \u00ab winget install -e --id Python.Python.3.12 \u00bb, puis relancez ce script.'
    }

    & $RuntimeCommand @RuntimePrefix -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) { Stop-Setup 'La cr\u00e9ation de .venv-transcription a \u00e9chou\u00e9.' }
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) { Stop-Setup 'La commande venv s''est termin\u00e9e sans cr\u00e9er Scripts\python.exe.' }
    if (-not (Test-PythonRuntime $VenvPython)) { Stop-Setup 'Le Python du venv cr\u00e9\u00e9 ne r\u00e9ussit pas --version ou est incompatible.' }
    Write-Host (U 'OK - .venv-transcription cr\u00e9\u00e9 et v\u00e9rifi\u00e9.')
}

Ensure-PipTrustStoreSupport

$CurrentPipFeatures = [Environment]::GetEnvironmentVariable('PIP_USE_FEATURE', 'Process')
$PipFeatures = if ([string]::IsNullOrWhiteSpace($CurrentPipFeatures)) { @() } else { @($CurrentPipFeatures -split '\s+' | Where-Object { $_ }) }
if ($PipFeatures -notcontains 'truststore') {
    $env:PIP_USE_FEATURE = (@($PipFeatures) + 'truststore') -join ' '
    Write-Host (U 'INFO - pip utilisera le magasin de certificats syst\u00e8me Windows pour cette ex\u00e9cution.')
} else {
    Write-Host (U 'INFO - PIP_USE_FEATURE contient d\u00e9j\u00e0 truststore; la configuration du processus est pr\u00e9serv\u00e9e.')
}

$MissingBefore = @(Get-MissingWorkerModules)
if ($MissingBefore.Count -gt 0) {
    $MissingList = $MissingBefore -join ', '
    if ($VenvAlreadyExisted) {
        Write-Host (U "INFO - le venv existe mais est incomplet; imports manquants : $MissingList. L'installation va reprendre.")
    } else {
        Write-Host (U "INFO - d\u00e9pendances Python \u00e0 installer : $MissingList.")
    }
}

& $VenvPython -m pip install --use-feature=truststore --upgrade pip
if ($LASTEXITCODE -ne 0) { Stop-Setup 'La mise \u00e0 jour de pip a \u00e9chou\u00e9; le venv existe mais demeure incomplet.' }
& $VenvPython -m pip install --use-feature=truststore -r (Join-Path $ProjectRoot 'transcription-worker\requirements.txt')
if ($LASTEXITCODE -ne 0) { Stop-Setup 'L''installation des d\u00e9pendances Python a \u00e9chou\u00e9; le venv existe mais demeure incomplet. Corrigez la cause puis relancez ce script.' }
& $VenvPython -m pip install --use-feature=truststore --editable (Join-Path $ProjectRoot 'transcription-worker')
if ($LASTEXITCODE -ne 0) { Stop-Setup 'L''installation editable du worker a \u00e9chou\u00e9; le venv existe mais demeure incomplet. Corrigez la cause puis relancez ce script.' }

$MissingAfter = @(Get-MissingWorkerModules)
if ($MissingAfter.Count -gt 0) {
    $MissingList = $MissingAfter -join ', '
    Stop-Setup "Le venv existe, mais il est incomplet : imports impossibles apr\u00e8s installation ($MissingList). Relancez le script apr\u00e8s correction."
}

Write-Host (U 'OK - environnement Python pr\u00eat.')
Write-Host (U 'FFmpeg et ffprobe ne sont pas install\u00e9s par ce script.')
Write-Host (U 'Aucun mod\u00e8le Whisper n''a \u00e9t\u00e9 t\u00e9l\u00e9charg\u00e9 et .env.local n''a pas \u00e9t\u00e9 modifi\u00e9.')
