from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .artifacts import write_artifacts
from .normalization import Segment, normalize_upload, parse_timed_text
from .protocol import emit, log


MAX_TOOL_OUTPUT = 10 * 1024 * 1024
YTDLP_NETWORK_OPTIONS = [
    "--compat-options", "no-certifi",
    "--retry-sleep", "http:linear=2:6:2",
    "--retry-sleep", "extractor:linear=2:6:2",
]


class ToolUnavailableError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ToolExecutionError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _yt_dlp_failure(stderr: str, fallback_code: str) -> ToolExecutionError:
    lowered = stderr.lower()
    if "certificate_verify_failed" in lowered or "certificate verify failed" in lowered:
        return ToolExecutionError("YOUTUBE_ACCESS_FAILED", "La connexion sécurisée à YouTube n’a pas pu être validée.")
    if "http error 429" in lowered or "too many requests" in lowered:
        return ToolExecutionError("YOUTUBE_RATE_LIMITED", "YouTube limite temporairement les requêtes de sous-titres.")
    if any(marker in lowered for marker in ("sign in to confirm", "confirm you’re not a bot", "confirm you're not a bot", "login required", "cookies")):
        return ToolExecutionError("AUTH_REQUIRED", "YouTube demande une authentification pour cette vidéo publique.")
    if any(marker in lowered for marker in ("video unavailable", "private video", "this video is not available", "video has been removed", "does not exist")):
        return ToolExecutionError("VIDEO_UNAVAILABLE", "Cette vidéo n’est plus disponible publiquement.")
    if any(marker in lowered for marker in ("network is unreachable", "name or service not known", "temporary failure in name resolution", "connection timed out", "connection reset", "unable to download api page")):
        return ToolExecutionError("NETWORK_ERROR", "La connexion réseau à YouTube a échoué. Vérifiez le réseau puis réessayez.")
    if "requested subtitles" in lowered and ("not available" in lowered or "not found" in lowered):
        return ToolExecutionError("SUBTITLE_NOT_AVAILABLE", "La piste de sous-titres demandée n’est plus disponible.")
    if "no subtitles" in lowered or "does not have subtitles" in lowered:
        return ToolExecutionError("SUBTITLE_NOT_AVAILABLE", "La piste de sous-titres demandée n’est plus disponible.")
    if any(marker in lowered for marker in ("http error 403", "sign in")):
        return ToolExecutionError("YOUTUBE_ACCESS_FAILED", "YouTube a refusé ou interrompu l’accès à la ressource demandée.")
    return ToolExecutionError(fallback_code, "L’outil externe n’a pas pu terminer l’opération demandée.")


def _tool_unavailable(arguments: list[str]) -> ToolUnavailableError:
    executable_name = Path(arguments[0]).name.lower()
    if "ffprobe" in executable_name:
        return ToolUnavailableError("FFPROBE_UNAVAILABLE", "ffprobe n’est pas disponible.")
    if "ffmpeg" in executable_name:
        return ToolUnavailableError("FFMPEG_UNAVAILABLE", "FFmpeg n’est pas disponible.")
    return ToolUnavailableError("WORKER_DEPENDENCY_UNAVAILABLE", "Un outil requis par le worker n’est pas disponible.")


def run_tool(arguments: list[str], timeout: int, failure_code: str = "WORKER_FAILED") -> subprocess.CompletedProcess[str]:
    log("Exécution : " + " ".join(Path(item).name if index == 0 else item for index, item in enumerate(arguments[:6])))
    try:
        process = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, shell=False)
    except FileNotFoundError as error:
        log(f"Outil introuvable : {error}")
        raise _tool_unavailable(arguments) from error
    if len(process.stdout.encode("utf-8")) > MAX_TOOL_OUTPUT or len(process.stderr.encode("utf-8")) > MAX_TOOL_OUTPUT:
        raise RuntimeError("Sortie d’outil excessive.")
    if process.returncode != 0:
        if len(arguments) >= 3 and arguments[1:3] == ["-m", "yt_dlp"] and "No module named" in process.stderr:
            raise ToolUnavailableError("YT_DLP_UNAVAILABLE", "yt-dlp n’est pas disponible.")
        if len(arguments) >= 3 and arguments[1:3] == ["-m", "yt_dlp"]:
            error = _yt_dlp_failure(process.stderr, failure_code)
            log(f"{error.code}: {error}")
            raise error
        log(f"{failure_code}: outil externe en échec (code {process.returncode}).")
        raise ToolExecutionError(failure_code, "L’outil externe n’a pas pu terminer l’opération demandée.")
    return process


def executable(value: str) -> str | None:
    candidate = Path(value)
    if candidate.is_absolute():
        return str(candidate) if candidate.is_file() else None
    return shutil.which(value)


def health(_: argparse.Namespace) -> dict[str, Any]:
    emit("started", stage="health")
    items: list[dict[str, str]] = []
    python_ok = sys.version_info >= (3, 10)
    items.append({"name": "Python", "status": "OK" if python_ok else "INCOMPATIBLE", "detail": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"})
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    items.append({"name": "venv", "status": "OK" if in_venv else "MANQUANT", "detail": "Environnement virtuel actif." if in_venv else "Exécutez scripts/setup-transcription.ps1."})
    for module, label in [("yt_dlp", "yt-dlp"), ("faster_whisper", "faster-whisper")]:
        found = importlib.util.find_spec(module) is not None
        items.append({"name": label, "status": "OK" if found else "MANQUANT", "detail": "Module Python disponible." if found else "Module Python absent."})
    for variable, fallback, label in [("TUBEKNOWLEDGE_FFMPEG_PATH", "ffmpeg", "FFmpeg"), ("TUBEKNOWLEDGE_FFPROBE_PATH", "ffprobe", "ffprobe")]:
        found = executable(os.environ.get(variable, fallback))
        items.append({"name": label, "status": "OK" if found else "MANQUANT", "detail": "Exécutable disponible." if found else "Exécutable introuvable; aucune installation automatique."})
    items.append({"name": "worker", "status": "OK", "detail": "Protocole JSONL V1 disponible."})
    items.append({"name": "CPU", "status": "OK", "detail": "Profil CPU/int8 pris en charge."})
    nvidia = shutil.which("nvidia-smi")
    items.append({"name": "NVIDIA/CUDA", "status": "OK" if nvidia else "OPTIONNEL", "detail": "Détection NVIDIA disponible." if nvidia else "Absent; le CPU reste le chemin par défaut."})
    emit("completed", result={"items": items, "cpuFirst": True})
    return {"items": items}


def _subtitle_tracks(data: dict[str, Any]) -> list[dict[str, Any]]:
    tracks: list[dict[str, Any]] = []
    for key, origin in [("subtitles", "manual"), ("automatic_captions", "automatic")]:
        source = data.get(key) or {}
        if not isinstance(source, dict):
            continue
        for language, formats in source.items():
            selected: list[dict[str, str]] = []
            if isinstance(formats, list):
                extensions = {str(item.get("ext", "")).lower() for item in formats if isinstance(item, dict)}
                for extension in ("vtt", "srt"):
                    if extension in extensions:
                        selected.append({"extension": extension})
            if selected:
                tracks.append({"language": str(language), "origin": origin, "formats": selected})
    return tracks


def inspect_video(args: argparse.Namespace) -> dict[str, Any]:
    emit("started", stage="inspect")
    command = [sys.executable, "-m", "yt_dlp", *YTDLP_NETWORK_OPTIONS, "--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", "--", args.url]
    result = run_tool(command, timeout=240, failure_code="YOUTUBE_ACCESS_FAILED")
    data = json.loads(result.stdout)
    video_id = str(data.get("id") or "")
    title = str(data.get("title") or "").strip()
    duration = float(data.get("duration") or 0)
    if not video_id or not title or duration <= 0:
        raise RuntimeError("Métadonnées vidéo incomplètes.")
    live = str(data.get("live_status") or "not_live")
    live_status = {"is_live": "is-live", "is_upcoming": "upcoming", "was_live": "was-live"}.get(live, "not-live")
    chapters = []
    for chapter in data.get("chapters") or []:
        if isinstance(chapter, dict) and chapter.get("start_time") is not None:
            item: dict[str, Any] = {"title": str(chapter.get("title") or "Chapitre")[:500], "start": float(chapter["start_time"])}
            if chapter.get("end_time") is not None:
                item["end"] = float(chapter["end_time"])
            chapters.append(item)
    estimates = [item.get("filesize") or item.get("filesize_approx") for item in data.get("formats") or [] if isinstance(item, dict) and item.get("vcodec") == "none"]
    estimate = min((int(value) for value in estimates if isinstance(value, (int, float)) and value > 0), default=None)
    inspection: dict[str, Any] = {
        "videoId": video_id,
        "title": title[:500],
        "durationSeconds": duration,
        "canonicalUrl": f"https://www.youtube.com/watch?v={video_id}",
        "chapters": chapters[:500],
        "subtitles": _subtitle_tracks(data),
        "liveStatus": live_status,
        "warnings": [],
    }
    if data.get("language"):
        inspection["language"] = str(data["language"])[:40]
    if estimate is not None:
        inspection["estimatedAudioBytes"] = estimate
    if not any(track["origin"] == "manual" for track in inspection["subtitles"]) and any(track["origin"] == "automatic" for track in inspection["subtitles"]):
        inspection["warnings"].append({"code": "AUTO_SUBS_ONLY", "message": "Seuls des sous-titres automatiques sont disponibles."})
    emit("completed", result={"inspection": inspection})
    return inspection


def _job_metadata(job_dir: Path, title: str, source_kind: str, language: str | None = None, **extra: Any) -> dict[str, Any]:
    source_path = job_dir / "source.json"
    source = json.loads(source_path.read_text(encoding="utf-8-sig")) if source_path.is_file() else {}
    metadata: dict[str, Any] = {
        "jobId": job_dir.name,
        "title": title,
        "sourceKind": source_kind,
        "language": language or "und",
        "detectedLanguage": language or "und",
        "transcriptionSource": "whisper" if source_kind == "local-whisper" else source_kind,
        "warnings": [],
    }
    for key in ("videoId", "canonicalUrl"):
        if source.get(key):
            metadata[key] = source[key]
    metadata.update({key: value for key, value in extra.items() if value is not None})
    return metadata


def download_subtitles(args: argparse.Namespace) -> dict[str, Any]:
    job_dir = Path(args.job_dir).resolve()
    raw = job_dir / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    emit("started", stage="downloading-subtitles")
    command = [
        sys.executable, "-m", "yt_dlp", *YTDLP_NETWORK_OPTIONS, "--skip-download", "--no-playlist", "--no-warnings",
        "--write-subs" if args.origin == "manual" else "--write-auto-subs", "--sub-langs", args.language,
        "--sub-format", f"{args.format}/vtt/srt", "--paths", str(raw), "--output", "subtitle.%(ext)s", "--", args.url,
    ]
    run_tool(command, timeout=1_200, failure_code="SUBTITLE_DOWNLOAD_FAILED")
    candidates = sorted(raw.glob(f"subtitle*.{args.format}")) or sorted(raw.glob("subtitle*.vtt")) or sorted(raw.glob("subtitle*.srt"))
    if not candidates:
        raise ToolExecutionError("SUBTITLE_NOT_AVAILABLE", "La piste de sous-titres demandée n’a pas été produite.")
    emit("progress", stage="normalizing-subtitles", progress=None, message="Normalisation déterministe des sous-titres.")
    try:
        segments = parse_timed_text(candidates[0].read_text(encoding="utf-8", errors="strict"))
    except (UnicodeError, ValueError) as error:
        raise ToolExecutionError("TRANSCRIPT_NORMALIZATION_FAILED", "Les sous-titres reçus ne peuvent pas être normalisés.") from error
    if not segments:
        raise ToolExecutionError("TRANSCRIPT_NORMALIZATION_FAILED", "Les sous-titres reçus sont vides ou malformés.")
    source_kind = "manual-subtitles" if args.origin == "manual" else "automatic-subtitles"
    metadata = _job_metadata(job_dir, args.title, source_kind, args.language, duration=segments[-1].end, subtitleFormat=candidates[0].suffix.lstrip("."))
    result = write_artifacts(job_dir, segments, metadata, ["Inspection yt-dlp sans téléchargement", "Téléchargement de la piste de sous-titres", "Normalisation UTF-8 déterministe"])
    emit("completed", result=result)
    return result


def download_audio(args: argparse.Namespace) -> dict[str, Any]:
    job_dir = Path(args.job_dir).resolve()
    raw = job_dir / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(job_dir).free < 512 * 1024 * 1024:
        raise RuntimeError("Espace disque insuffisant (minimum de sécurité : 512 MiB).")
    emit("started", stage="downloading-audio")
    command = [
        sys.executable, "-m", "yt_dlp", *YTDLP_NETWORK_OPTIONS, "--no-playlist", "--no-warnings", "--format", "bestaudio/best",
        "--paths", str(raw), "--output", "audio.%(ext)s", "--", args.url,
    ]
    try:
        run_tool(command, timeout=7_000, failure_code="YOUTUBE_ACCESS_FAILED")
    except Exception:
        for partial in raw.glob("*.part"):
            partial.unlink(missing_ok=True)
        raise
    candidates = [item for item in raw.glob("audio.*") if item.is_file() and item.suffix != ".part"]
    if len(candidates) != 1:
        raise RuntimeError("Le téléchargement audio n’a pas produit exactement un fichier.")
    emit("completed", result={"audioReady": True})
    return {"audioReady": True}


def _probe_audio(path: Path) -> dict[str, Any]:
    ffprobe = os.environ.get("TUBEKNOWLEDGE_FFPROBE_PATH", "ffprobe")
    result = run_tool([ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", str(path)], timeout=120)
    data = json.loads(result.stdout)
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError("Aucune piste audio détectée par ffprobe.")
    duration = float((data.get("format") or {}).get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("Durée audio invalide.")
    return {"duration": duration, "stream": streams[0]}


def transcribe(args: argparse.Namespace) -> dict[str, Any]:
    if not args.confirm_model_download:
        raise RuntimeError("Confirmation du téléchargement éventuel du modèle requise.")
    job_dir = Path(args.job_dir).resolve()
    candidates = [item for item in (job_dir / "raw").glob("audio.*") if item.is_file() and item.suffix != ".part"]
    if len(candidates) != 1:
        raise RuntimeError("Fichier audio source introuvable.")
    audio = candidates[0]
    emit("started", stage="probing-audio")
    probe = _probe_audio(audio)
    work = job_dir / "work"
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "audio.wav"
    emit("progress", stage="converting-audio", progress=None, message="Conversion WAV mono 16 kHz PCM.")
    ffmpeg = os.environ.get("TUBEKNOWLEDGE_FFMPEG_PATH", "ffmpeg")
    command = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    if args.start_time is not None:
        command.extend(["-ss", str(args.start_time)])
    command.extend(["-i", str(audio)])
    if args.end_time is not None:
        duration = args.end_time - (args.start_time or 0)
        command.extend(["-t", str(duration)])
    command.extend(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)])
    run_tool(command, timeout=7_200)
    emit("progress", stage="loading-model", progress=None, message=f"Chargement du modèle {args.model}; un téléchargement peut avoir lieu après confirmation.")
    emit("warning", code="MODEL_DOWNLOAD_CONFIRMED", message="Le téléchargement éventuel du modèle a été explicitement confirmé.")
    with contextlib.redirect_stdout(sys.stderr):
        from faster_whisper import WhisperModel
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type, download_root=os.environ.get("HF_HOME"))
        iterator, info = model.transcribe(str(wav), language=args.language, task="transcribe", vad_filter=True, word_timestamps=False)
        duration = float(getattr(info, "duration", 0) or probe["duration"])
        segments: list[Segment] = []
        for item in iterator:
            segment = Segment(float(item.start), float(item.end), str(item.text))
            segments.append(segment)
            progress = min(1.0, segment.end / duration) if duration > 0 else None
            emit("progress", stage="transcribing", progress=progress, message=f"Transcription jusqu’à {segment.end:.1f} s sur {duration:.1f} s.")
    if not segments:
        raise RuntimeError("Whisper n’a produit aucun segment.")
    emit("progress", stage="normalizing-transcript", progress=None, message="Production des artifacts de transcription.")
    language = args.language or str(getattr(info, "language", "und"))
    metadata = _job_metadata(job_dir, args.title, "local-whisper", language, duration=duration, model=args.model, device=args.device, computeType=args.compute_type)
    result = write_artifacts(job_dir, segments, metadata, ["Téléchargement audio seul avec yt-dlp", "Inspection ffprobe", "Conversion FFmpeg WAV mono 16 kHz PCM", "Transcription locale faster-whisper avec VAD"])
    wav.unlink(missing_ok=True)
    if not args.keep_audio:
        audio.unlink(missing_ok=True)
    emit("completed", result=result)
    return result


def normalize_local_upload(args: argparse.Namespace) -> dict[str, Any]:
    job_dir = Path(args.job_dir).resolve()
    input_path = (job_dir / args.input).resolve()
    try:
        input_path.relative_to(job_dir)
    except ValueError as error:
        raise RuntimeError("Chemin d’import hors du job.") from error
    if input_path.suffix.lower() not in {".txt", ".md", ".vtt", ".srt"} or not input_path.is_file():
        raise RuntimeError("Fichier d’import non autorisé.")
    emit("started", stage="normalizing-transcript")
    segments = normalize_upload(input_path)
    metadata = _job_metadata(job_dir, args.title, "uploaded-transcript", "und", canonicalUrl=args.url or None, duration=segments[-1].end)
    result = write_artifacts(job_dir, segments, metadata, ["Import local UTF-8", f"Normalisation déterministe {input_path.suffix.upper()}"])
    emit("completed", result=result)
    return result


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="python -m tubeknowledge_worker.cli")
    commands = root.add_subparsers(dest="command", required=True)

    health_parser = commands.add_parser("health")
    health_parser.add_argument("--job-dir", required=True)
    health_parser.set_defaults(handler=health)

    inspect_parser = commands.add_parser("inspect")
    inspect_parser.add_argument("--job-dir", required=True)
    inspect_parser.add_argument("--url", required=True)
    inspect_parser.add_argument("--max-minutes", type=int, default=360)
    inspect_parser.set_defaults(handler=inspect_video)

    subtitle_parser = commands.add_parser("download-subtitles")
    subtitle_parser.add_argument("--job-dir", required=True)
    subtitle_parser.add_argument("--url", required=True)
    subtitle_parser.add_argument("--language", required=True)
    subtitle_parser.add_argument("--origin", choices=["manual", "automatic"], required=True)
    subtitle_parser.add_argument("--format", choices=["vtt", "srt"], required=True)
    subtitle_parser.add_argument("--title", required=True)
    subtitle_parser.set_defaults(handler=download_subtitles)

    audio_parser = commands.add_parser("download-audio")
    audio_parser.add_argument("--job-dir", required=True)
    audio_parser.add_argument("--url", required=True)
    audio_parser.add_argument("--start-time", type=float)
    audio_parser.add_argument("--end-time", type=float)
    audio_parser.set_defaults(handler=download_audio)

    transcribe_parser = commands.add_parser("transcribe")
    transcribe_parser.add_argument("--job-dir", required=True)
    transcribe_parser.add_argument("--title", required=True)
    transcribe_parser.add_argument("--model", required=True)
    transcribe_parser.add_argument("--device", choices=["cpu", "cuda"], required=True)
    transcribe_parser.add_argument("--compute-type", required=True)
    transcribe_parser.add_argument("--language")
    transcribe_parser.add_argument("--confirm-model-download", action="store_true")
    transcribe_parser.add_argument("--keep-audio", action="store_true")
    transcribe_parser.add_argument("--start-time", type=float)
    transcribe_parser.add_argument("--end-time", type=float)
    transcribe_parser.set_defaults(handler=transcribe)

    upload_parser = commands.add_parser("normalize-upload")
    upload_parser.add_argument("--job-dir", required=True)
    upload_parser.add_argument("--input", required=True)
    upload_parser.add_argument("--title", required=True)
    upload_parser.add_argument("--url")
    upload_parser.set_defaults(handler=normalize_local_upload)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        args.handler(args)
        return 0
    except subprocess.TimeoutExpired:
        emit("failed", code="TRANSCRIPTION_TIMEOUT", message="Un outil externe a dépassé son délai maximal.")
    except ToolUnavailableError as error:
        log(str(error))
        emit("failed", code=error.code, message=str(error))
    except ToolExecutionError as error:
        emit("failed", code=error.code, message=str(error))
    except ModuleNotFoundError as error:
        log(str(error))
        code = "FASTER_WHISPER_UNAVAILABLE" if error.name == "faster_whisper" else "WORKER_DEPENDENCY_UNAVAILABLE"
        emit("failed", code=code, message="Une dépendance Python requise est absente. Exécutez le diagnostic.")
    except OSError as error:
        log(f"{type(error).__name__}: erreur de stockage locale.")
        emit("failed", code="TRANSCRIPTION_STORAGE_FAILED", message="Le runtime local ne peut pas lire ou écrire les fichiers requis.")
    except Exception as error:
        log(f"{type(error).__name__}: {error}")
        emit("failed", code="WORKER_FAILED", message=str(error)[:1_000])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
