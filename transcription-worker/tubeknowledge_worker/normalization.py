from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path


TIMESTAMP = re.compile(r"(?P<start>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3})\s*-->\s*(?P<end>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3})")
TAG = re.compile(r"<[^>]+>")
SPACE = re.compile(r"[ \t\f\v]+")


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


def parse_timestamp(value: str) -> float:
    normalized = value.replace(",", ".")
    parts = normalized.split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    elif len(parts) == 3:
        hours, minutes, seconds = parts
    else:
        raise ValueError("Timestamp invalide.")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def clean_caption_text(value: str) -> str:
    value = html.unescape(TAG.sub("", value))
    lines = [SPACE.sub(" ", line).strip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return " ".join(line for line in lines if line).strip()


def _rolling_suffix(previous: str, current: str) -> str:
    if current == previous:
        return ""
    previous_words = previous.split()
    current_words = current.split()
    max_overlap = min(len(previous_words), len(current_words))
    for size in range(max_overlap, 0, -1):
        if previous_words[-size:] == current_words[:size]:
            return " ".join(current_words[size:])
    if current.startswith(previous + " "):
        return current[len(previous):].strip()
    return current


def normalize_segments(segments: list[Segment]) -> list[Segment]:
    normalized: list[Segment] = []
    previous_full = ""
    for segment in segments:
        full = clean_caption_text(segment.text)
        if not full:
            continue
        text = _rolling_suffix(previous_full, full) if previous_full else full
        previous_full = full
        if not text:
            continue
        if normalized and normalized[-1].text == text:
            continue
        normalized.append(Segment(max(0.0, segment.start), max(segment.start, segment.end), text))
    return normalized


def parse_timed_text(content: str) -> list[Segment]:
    text = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", text)
    segments: list[Segment] = []
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines or lines[0].strip().upper().startswith(("WEBVTT", "NOTE", "STYLE", "REGION")):
            continue
        timestamp_index = next((index for index, line in enumerate(lines) if TIMESTAMP.search(line)), None)
        if timestamp_index is None:
            continue
        match = TIMESTAMP.search(lines[timestamp_index])
        if not match:
            continue
        caption = "\n".join(lines[timestamp_index + 1 :])
        segments.append(Segment(parse_timestamp(match.group("start")), parse_timestamp(match.group("end")), caption))
    return normalize_segments(segments)


def normalize_upload(path: Path) -> list[Segment]:
    content = path.read_text(encoding="utf-8", errors="strict")
    if "\x00" in content:
        raise ValueError("Contenu binaire interdit.")
    if path.suffix.lower() in {".vtt", ".srt"}:
        segments = parse_timed_text(content)
        if not segments:
            raise ValueError("Aucun segment valide trouvé dans le fichier minuté.")
        return segments
    text = clean_caption_text(content)
    if not text:
        raise ValueError("La transcription est vide.")
    return [Segment(0.0, 0.001, text)]

