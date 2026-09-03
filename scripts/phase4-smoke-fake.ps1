[CmdletBinding()]
param()

$Utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $Utf8
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8
function U([string]$Text) { [regex]::Unescape($Text) }
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $ProjectRoot '.venv-transcription\Scripts\python.exe'
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
$Python = if ($env:TUBEKNOWLEDGE_PYTHON_PATH -and (Test-Path -LiteralPath $env:TUBEKNOWLEDGE_PYTHON_PATH -PathType Leaf)) { $env:TUBEKNOWLEDGE_PYTHON_PATH } elseif (Test-Path -LiteralPath $VenvPython -PathType Leaf) { $VenvPython } elseif ($PythonCommand) { $PythonCommand.Source } else { $null }
if (-not $Python) { throw (U 'Python est requis pour la fum\u00e9e factice. Configurez TUBEKNOWLEDGE_PYTHON_PATH ou ex\u00e9cutez le setup; aucune d\u00e9pendance externe ne sera utilis\u00e9e.') }
$FakeTitle = U 'Vid\u00e9o factice'
$Sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('tubeknowledge-phase4-fake-' + [guid]::NewGuid())
$FakeModules = Join-Path $Sandbox 'fake-modules'
$Job = Join-Path $Sandbox 'runtime\acquisitions\11111111-1111-4111-8111-111111111111'
$UploadJob = Join-Path $Sandbox 'runtime\acquisitions\22222222-2222-4222-8222-222222222222'
$Vault = Join-Path $Sandbox 'vault'

try {
    New-Item -ItemType Directory -Force -Path (Join-Path $FakeModules 'yt_dlp'), (Join-Path $FakeModules 'faster_whisper'), (Join-Path $Job 'raw'), (Join-Path $Job 'work'), (Join-Path $Job 'output'), (Join-Path $UploadJob 'raw'), $Vault | Out-Null
    Set-Content -LiteralPath (Join-Path $Vault 'INDEX.md') -Encoding utf8 -Value '# Vault factice intact'
    $VaultHashBefore = (Get-FileHash -LiteralPath (Join-Path $Vault 'INDEX.md') -Algorithm SHA256).Hash
    Set-Content -LiteralPath (Join-Path $Job 'source.json') -Encoding utf8 -Value '{"videoId":"abcDEF_1234","canonicalUrl":"https://www.youtube.com/watch?v=abcDEF_1234"}'
    Set-Content -LiteralPath (Join-Path $UploadJob 'source.json') -Encoding utf8 -Value '{"type":"upload"}'
    Set-Content -LiteralPath (Join-Path $UploadJob 'raw\input.vtt') -Encoding utf8 -Value "WEBVTT`n`n00:00:00.000 --> 00:00:02.000`nBonjour factice"
    Set-Content -LiteralPath (Join-Path $FakeModules 'yt_dlp\__init__.py') -Encoding utf8 -Value ''
    @'
import json, pathlib, sys
args=sys.argv[1:]
if '--dump-single-json' in args:
 print(json.dumps({'id':'abcDEF_1234','title':'Vid\u00e9o factice','duration':90,'live_status':'not_live','language':'fr','chapters':[],'subtitles':{'fr':[{'ext':'vtt'}]},'automatic_captions':{},'formats':[{'vcodec':'none','filesize_approx':1024}]}))
elif '--write-subs' in args or '--write-auto-subs' in args:
 root=pathlib.Path(args[args.index('--paths')+1]); root.mkdir(parents=True,exist_ok=True); (root/'subtitle.fr.vtt').write_text('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBonjour &amp; bienvenue\n\n00:00:02.000 --> 00:00:04.000\nBonjour &amp; bienvenue ici\n',encoding='utf-8')
else:
 root=pathlib.Path(args[args.index('--paths')+1]); root.mkdir(parents=True,exist_ok=True); (root/'audio.fake').write_bytes(b'fake-audio')
'@ | Set-Content -LiteralPath (Join-Path $FakeModules 'yt_dlp\__main__.py') -Encoding utf8
    @'
class Info:
    duration=4.0
    language='fr'
class Item:
    def __init__(self,start,end,text): self.start,self.end,self.text=start,end,text
class WhisperModel:
    def __init__(self,*args,**kwargs): pass
    def transcribe(self,*args,**kwargs): return iter([Item(0,2,'Bonjour'),Item(2,4,'monde')]),Info()
'@ | Set-Content -LiteralPath (Join-Path $FakeModules 'faster_whisper\__init__.py') -Encoding utf8
    $FakeFfprobe = Join-Path $Sandbox 'ffprobe.cmd'
    $FakeFfmpeg = Join-Path $Sandbox 'ffmpeg.cmd'
    Set-Content -LiteralPath $FakeFfprobe -Encoding ascii -Value '@echo {"streams":[{"codec_name":"fake","sample_rate":"48000","channels":2}],"format":{"duration":"90"}}'
    Set-Content -LiteralPath $FakeFfmpeg -Encoding ascii -Value '@echo off', 'set last=', 'for %%a in (%*) do set last=%%~a', 'type nul > "%last%"'
    $env:PYTHONPATH = $FakeModules
    $env:TUBEKNOWLEDGE_FFMPEG_PATH = $FakeFfmpeg
    $env:TUBEKNOWLEDGE_FFPROBE_PATH = $FakeFfprobe
    $env:HF_HOME = Join-Path $Sandbox 'models'
    Push-Location (Join-Path $ProjectRoot 'transcription-worker')
    try {
        & $Python -m tubeknowledge_worker.cli inspect --job-dir $Job --url 'https://www.youtube.com/watch?v=abcDEF_1234' --max-minutes 360
        if ($LASTEXITCODE -ne 0) { throw (U 'Inspection factice \u00e9chou\u00e9e.') }
        & $Python -m tubeknowledge_worker.cli download-subtitles --job-dir $Job --url 'https://www.youtube.com/watch?v=abcDEF_1234' --language fr --origin manual --format vtt --title $FakeTitle
        if ($LASTEXITCODE -ne 0) { throw (U 'Pipeline de sous-titres factice \u00e9chou\u00e9.') }
        & $Python -m tubeknowledge_worker.cli download-audio --job-dir $Job --url 'https://www.youtube.com/watch?v=abcDEF_1234'
        if ($LASTEXITCODE -ne 0) { throw (U 'T\u00e9l\u00e9chargement audio factice \u00e9chou\u00e9.') }
        & $Python -m tubeknowledge_worker.cli transcribe --job-dir $Job --title $FakeTitle --model small --device cpu --compute-type int8 --confirm-model-download
        if ($LASTEXITCODE -ne 0) { throw (U 'Transcription factice \u00e9chou\u00e9e.') }
        & $Python -m tubeknowledge_worker.cli normalize-upload --job-dir $UploadJob --input 'raw/input.vtt' --title 'Import factice'
        if ($LASTEXITCODE -ne 0) { throw (U 'Import factice \u00e9chou\u00e9.') }
    } finally { Pop-Location }
    foreach ($Name in 'transcript.txt','transcript.vtt','segments.json','metadata.json','acquisition-report.md') {
        if (-not (Test-Path -LiteralPath (Join-Path $Job "output\$Name"))) { throw "Artifact manquant : $Name" }
    }
    if (Test-Path -LiteralPath (Join-Path $Job 'raw\audio.fake')) { throw (U 'L''audio aurait d\u00fb \u00eatre supprim\u00e9 apr\u00e8s succ\u00e8s.') }
    $VaultHashAfter = (Get-FileHash -LiteralPath (Join-Path $Vault 'INDEX.md') -Algorithm SHA256).Hash
    if ($VaultHashBefore -ne $VaultHashAfter) { throw (U 'Le vault factice a \u00e9t\u00e9 modifi\u00e9.') }
    Write-Host 'OK - inspection, sous-titres, normalisation, audio, transcription factice, progression, artifacts, nettoyage et vault intact.'
    Write-Host (U 'L''annulation, les timeouts et les erreurs de protocole sont couverts par Vitest avec processus factices.')
} finally {
    Remove-Item -LiteralPath $Sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
