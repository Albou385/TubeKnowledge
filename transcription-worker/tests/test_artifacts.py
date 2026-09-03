import hashlib
import json
from pathlib import Path

from tubeknowledge_worker.artifacts import write_artifacts
from tubeknowledge_worker.normalization import Segment


def test_artifact_schema_and_hashes(tmp_path: Path, capsys) -> None:
    result = write_artifacts(
        tmp_path,
        [Segment(0.0, 4.2, "Bonjour")],
        {"jobId": "123e4567-e89b-42d3-a456-426614174000", "title": "Test", "language": "fr", "sourceKind": "manual-subtitles", "warnings": []},
        ["Normalisation de test"],
    )
    segments = json.loads((tmp_path / "output" / "segments.json").read_text(encoding="utf-8"))
    metadata = json.loads((tmp_path / "output" / "metadata.json").read_text(encoding="utf-8"))
    assert segments == {"schemaVersion": 1, "language": "fr", "sourceKind": "manual-subtitles", "segments": [{"id": 0, "start": 0.0, "end": 4.2, "text": "Bonjour"}]}
    transcript = (tmp_path / "output" / "transcript.txt").read_bytes()
    assert metadata["hashes"]["transcript.txt"] == hashlib.sha256(transcript).hexdigest()
    assert "ne résume pas" in (tmp_path / "output" / "acquisition-report.md").read_text(encoding="utf-8")
    assert result["artifacts"][-1] == "acquisition-report.md"
    assert all(json.loads(line)["type"] == "artifact" for line in capsys.readouterr().out.splitlines())

