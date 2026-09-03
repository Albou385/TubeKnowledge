[CmdletBinding()]
param()

$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $ProjectRoot '.venv-transcription\Scripts\python.exe'

function U([string]$Text) { return [regex]::Unescape($Text) }

function Show-Status([string]$Name, [string]$Status, [string]$Detail) {
    [pscustomobject]@{ Tool = (U $Name); Status = $Status; Detail = (U $Detail) }
}

function Test-CommandVersion([string]$Command, [string[]]$Arguments) {
    if ([IO.Path]::IsPathRooted($Command) -and -not (Test-Path -LiteralPath $Command -PathType Leaf)) {
        return 'missing'
    }
    try {
        $null = & $Command @Arguments 2>&1
        $ExitCode = $LASTEXITCODE
    } catch {
        return 'missing'
    }
    if ($ExitCode -eq 0) { return 'ok' }
    return 'incompatible'
}

function Status-FromResult([string]$Name, [string]$Result, [string]$Ok, [string]$Missing, [string]$Incompatible) {
    if ($Result -eq 'ok') { return Show-Status $Name 'OK' $Ok }
    if ($Result -eq 'missing') { return Show-Status $Name 'MANQUANT' $Missing }
    return Show-Status $Name 'INCOMPATIBLE' $Incompatible
}

$ConfiguredPython = if ($env:TUBEKNOWLEDGE_PYTHON_PATH) { $env:TUBEKNOWLEDGE_PYTHON_PATH.Trim() } else { $null }
$ConfiguredResult = if ($ConfiguredPython) { Test-CommandVersion $ConfiguredPython @('--version') } else { 'missing' }
$Launcher = Get-Command py -ErrorAction SilentlyContinue
$LauncherResult = if ($Launcher) { Test-CommandVersion $Launcher.Source @('-3.12', '--version') } else { 'missing' }
$Global = Get-Command python -ErrorAction SilentlyContinue
$GlobalResult = if ($Global) { Test-CommandVersion $Global.Source @('--version') } else { 'missing' }
$VenvResult = Test-CommandVersion $VenvPython @('--version')
$ActivePython = if ($ConfiguredPython) { $ConfiguredPython } else { $VenvPython }
$ActiveResult = if ($ConfiguredPython) { $ConfiguredResult } else { $VenvResult }

$Rows = @()
$Rows += if ($ConfiguredPython) {
    Status-FromResult 'Python configur\u00e9' $ConfiguredResult 'Interpr\u00e9teur configur\u00e9 ex\u00e9cutable.' 'Ex\u00e9cutable configur\u00e9 introuvable.' 'L''ex\u00e9cutable configur\u00e9 ne r\u00e9ussit pas --version.'
} else { Show-Status 'Python configur\u00e9' 'OPTIONNEL' 'Aucun TUBEKNOWLEDGE_PYTHON_PATH explicite.' }
$Rows += Status-FromResult 'Launcher py' $LauncherResult 'Launcher et runtime Python 3.12 disponibles.' 'Launcher py absent.' 'Launcher pr\u00e9sent, mais aucun runtime Python 3.12 utilisable.'
$Rows += Status-FromResult 'Runtime global' $GlobalResult 'La commande python r\u00e9ussit --version.' 'Commande python absente.' 'La commande python existe, mais --version \u00e9choue.'
$Rows += Status-FromResult 'venv' $VenvResult '.venv-transcription ex\u00e9cute --version.' '.venv-transcription absent.' 'Le venv existe, mais son Python ne s''ex\u00e9cute pas.'
$Rows += Status-FromResult 'Python actif' $ActiveResult 'Le Python utilis\u00e9 par l''application est ex\u00e9cutable.' 'Le Python utilis\u00e9 par l''application est introuvable.' 'Le Python utilis\u00e9 par l''application ne r\u00e9ussit pas --version.'

if ($ActiveResult -eq 'ok') {
    $null = & $ActivePython -c 'import yt_dlp' 2>&1
    $Rows += if ($LASTEXITCODE -eq 0) { Show-Status 'yt-dlp' 'OK' 'Module Python importable.' } else { Show-Status 'yt-dlp' 'MANQUANT' 'Module non importable avec le Python actif.' }
    $null = & $ActivePython -c 'import faster_whisper' 2>&1
    $Rows += if ($LASTEXITCODE -eq 0) { Show-Status 'faster-whisper' 'OK' 'Module Python importable.' } else { Show-Status 'faster-whisper' 'MANQUANT' 'Module non importable avec le Python actif.' }
    Push-Location (Join-Path $ProjectRoot 'transcription-worker')
    try {
        $null = & $ActivePython -c 'import tubeknowledge_worker.cli' 2>&1
        $Rows += if ($LASTEXITCODE -eq 0) { Show-Status 'worker' 'OK' 'Module worker importable.' } else { Show-Status 'worker' 'MANQUANT' 'Module worker non importable avec le Python actif.' }
    } finally { Pop-Location }
} else {
    $Rows += Show-Status 'yt-dlp' 'MANQUANT' 'Python actif indisponible.'
    $Rows += Show-Status 'faster-whisper' 'MANQUANT' 'Python actif indisponible.'
    $Rows += Show-Status 'worker' 'MANQUANT' 'Python actif indisponible.'
}

$FfmpegCommand = if ($env:TUBEKNOWLEDGE_FFMPEG_PATH) { $env:TUBEKNOWLEDGE_FFMPEG_PATH } else { 'ffmpeg' }
$FfprobeCommand = if ($env:TUBEKNOWLEDGE_FFPROBE_PATH) { $env:TUBEKNOWLEDGE_FFPROBE_PATH } else { 'ffprobe' }
$Rows += Status-FromResult 'FFmpeg' (Test-CommandVersion $FfmpegCommand @('-version')) 'Ex\u00e9cutable disponible.' 'Installation manuelle requise.' 'L''ex\u00e9cutable ne r\u00e9ussit pas -version.'
$Rows += Status-FromResult 'ffprobe' (Test-CommandVersion $FfprobeCommand @('-version')) 'Ex\u00e9cutable disponible.' 'Installation manuelle requise.' 'L''ex\u00e9cutable ne r\u00e9ussit pas -version.'
$Rows += Show-Status 'CPU' 'OK' 'Chemin par d\u00e9faut : CPU, int8, concurrence 1.'
$NvidiaResult = Test-CommandVersion 'nvidia-smi' @('--query-gpu=name', '--format=csv,noheader')
$Rows += if ($NvidiaResult -eq 'ok') { Show-Status 'NVIDIA/CUDA' 'OK' 'GPU NVIDIA d\u00e9tect\u00e9; utilisation facultative.' } else { Show-Status 'NVIDIA/CUDA' 'OPTIONNEL' 'Non d\u00e9tect\u00e9; utilisez le CPU.' }

$Rows | Format-Table -AutoSize
Write-Host (U 'Ce diagnostic n''installe rien et ne t\u00e9l\u00e9charge aucun mod\u00e8le.')
exit 0
