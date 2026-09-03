import json
import subprocess
from argparse import Namespace
from pathlib import Path

import pytest

from tubeknowledge_worker import cli


def test_ytdlp_tls_failure_is_classified_without_raw_stderr(monkeypatch, capsys) -> None:
    stderr = "ERROR: C:\\Users\\secret\\runtime [SSL: CERTIFICATE_VERIFY_FAILED] token=hidden"
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, "", stderr),
    )

    with pytest.raises(cli.ToolExecutionError) as caught:
        cli.run_tool(["python", "-m", "yt_dlp", "--skip-download"], 10, "SUBTITLE_DOWNLOAD_FAILED")

    assert caught.value.code == "YOUTUBE_ACCESS_FAILED"
    captured = capsys.readouterr().err
    assert "YOUTUBE_ACCESS_FAILED" in captured
    assert "Users\\secret" not in captured
    assert "token=hidden" not in captured


def test_ytdlp_subtitle_failure_is_closed_and_safe(monkeypatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, "", "ERROR: requested subtitles not available"),
    )

    with pytest.raises(cli.ToolExecutionError) as caught:
        cli.run_tool(["python", "-m", "yt_dlp", "--write-auto-subs"], 10, "SUBTITLE_DOWNLOAD_FAILED")

    assert caught.value.code == "SUBTITLE_NOT_AVAILABLE"


def test_ytdlp_rate_limit_has_a_stable_public_category(monkeypatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, "", "HTTP Error 429: Too Many Requests"),
    )

    with pytest.raises(cli.ToolExecutionError) as caught:
        cli.run_tool(["python", "-m", "yt_dlp", "--write-auto-subs"], 10, "SUBTITLE_DOWNLOAD_FAILED")

    assert caught.value.code == "YOUTUBE_RATE_LIMITED"


@pytest.mark.parametrize(
    ("language", "extension", "content"),
    [
        ("fr", "vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour\n"),
        ("en", "srt", "1\n00:00:00,000 --> 00:00:01,000\nHello\n"),
    ],
)
def test_download_subtitles_uses_system_certs_and_normalizes_tracks(
    tmp_path: Path,
    monkeypatch,
    language: str,
    extension: str,
    content: str,
) -> None:
    job_dir = tmp_path / "123e4567-e89b-42d3-a456-426614174000"
    (job_dir / "raw").mkdir(parents=True)
    (job_dir / "source.json").write_text(
        json.dumps({"videoId": "fixture01", "canonicalUrl": "https://www.youtube.com/watch?v=fixture01"}),
        encoding="utf-8",
    )

    def fake_run_tool(arguments: list[str], timeout: int, failure_code: str = "WORKER_FAILED"):
        assert arguments[3:5] == ["--compat-options", "no-certifi"]
        assert arguments[5:7] == ["--retry-sleep", "http:linear=2:6:2"]
        assert "--write-auto-subs" in arguments
        assert failure_code == "SUBTITLE_DOWNLOAD_FAILED"
        (job_dir / "raw" / f"subtitle.{language}.{extension}").write_text(content, encoding="utf-8")
        return subprocess.CompletedProcess(arguments, 0, "", "")

    monkeypatch.setattr(cli, "run_tool", fake_run_tool)
    result = cli.download_subtitles(Namespace(
        job_dir=str(job_dir),
        url="https://www.youtube.com/watch?v=fixture01",
        language=language,
        origin="automatic",
        format=extension,
        title="Fixture",
    ))

    metadata = json.loads((job_dir / "output" / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["language"] == language
    assert metadata["subtitleFormat"] == extension
    assert "transcript.txt" in result["artifacts"]
