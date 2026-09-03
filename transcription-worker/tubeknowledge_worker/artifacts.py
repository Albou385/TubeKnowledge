from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .normalization import Segment
from .protocol import emit


def _timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{milliseconds:03d}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_artifacts(job_dir: Path, segments: list[Segment], metadata: dict[str, Any], steps: list[str]) -> dict[str, Any]:
    output = job_dir / "output"
    output.mkdir(parents=True, exist_ok=True)
    transcript_path = output / "transcript.txt"
    vtt_path = output / "transcript.vtt"
    segments_path = output / "segments.json"
    metadata_path = output / "metadata.json"
    report_path = output / "acquisition-report.md"

    transcript_path.write_text("\n".join(segment.text for segment in segments).strip() + "\n", encoding="utf-8", newline="\n")
    cues = ["WEBVTT", ""]
    for index, segment in enumerate(segments, start=1):
        end = segment.end if segment.end > segment.start else segment.start + 0.001
        cues.extend([str(index), f"{_timestamp(segment.start)} --> {_timestamp(end)}", segment.text, ""])
    vtt_path.write_text("\n".join(cues), encoding="utf-8", newline="\n")

    segment_document = {
        "schemaVersion": 1,
        "language": metadata.get("language") or "und",
        "sourceKind": metadata["sourceKind"],
        "segments": [
            {"id": index, "start": round(segment.start, 3), "end": round(segment.end, 3), "text": segment.text}
            for index, segment in enumerate(segments)
        ],
    }
    segments_path.write_text(json.dumps(segment_document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    hashes = {name: _sha256(path) for name, path in {
        "transcript.txt": transcript_path, "transcript.vtt": vtt_path, "segments.json": segments_path,
    }.items()}
    document = {
        "schemaVersion": 1,
        **metadata,
        "date": datetime.now(timezone.utc).isoformat(),
        "warnings": metadata.get("warnings", []),
        "hashes": hashes,
    }
    metadata_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    report_lines = [
        "# Rapport d’acquisition", "", f"- Job : `{metadata['jobId']}`", f"- Source : `{metadata['sourceKind']}`",
        f"- Date : {document['date']}", "", "## Étapes et outils", "",
        *[f"- {step}" for step in steps], "", "Ce rapport décrit le traitement technique et ne résume pas le contenu.", "",
    ]
    report_path.write_text("\n".join(report_lines), encoding="utf-8", newline="\n")
    for kind, name in [
        ("transcript", "transcript.txt"), ("timed-transcript", "transcript.vtt"), ("segments", "segments.json"),
        ("metadata", "metadata.json"), ("report", "acquisition-report.md"),
    ]:
        emit("artifact", kind=kind, relativePath=f"output/{name}")
    return {"artifacts": list(hashes) + ["metadata.json", "acquisition-report.md"], "hashes": hashes}

