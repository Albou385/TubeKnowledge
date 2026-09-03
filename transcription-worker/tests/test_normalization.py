from pathlib import Path

import pytest

from tubeknowledge_worker.normalization import Segment, clean_caption_text, normalize_segments, normalize_upload, parse_timed_text


def test_vtt_html_entities_and_rolling_captions() -> None:
    content = """WEBVTT

00:00:00.000 --> 00:00:02.000
<c>Bonjour &amp; bienvenue</c>

00:00:02.000 --> 00:00:04.000
Bonjour &amp; bienvenue ici

00:00:04.000 --> 00:00:05.000
ici
"""
    segments = parse_timed_text(content)
    assert [segment.text for segment in segments] == ["Bonjour & bienvenue", "ici"]
    assert segments[0].start == 0


def test_srt_comma_timestamps() -> None:
    content = """1
00:00:00,100 --> 00:00:01,500
Première ligne

2
00:00:01,500 --> 00:00:03,000
Deuxième ligne
"""
    segments = parse_timed_text(content)
    assert [(segment.start, segment.end) for segment in segments] == [(0.1, 1.5), (1.5, 3.0)]


def test_exact_duplicates_are_removed() -> None:
    segments = normalize_segments([Segment(0, 1, "Texte"), Segment(1, 2, "Texte"), Segment(2, 3, "Autre")])
    assert [segment.text for segment in segments] == ["Texte", "Autre"]


def test_clean_text_does_not_paraphrase() -> None:
    assert clean_caption_text("  Un   texte\nfragmenté  ") == "Un texte fragmenté"


@pytest.mark.parametrize("extension", [".txt", ".md"])
def test_plain_upload(extension: str, tmp_path: Path) -> None:
    source = tmp_path / f"input{extension}"
    source.write_text("Texte UTF-8 : éthique", encoding="utf-8")
    assert normalize_upload(source)[0].text == "Texte UTF-8 : éthique"


def test_malformed_timed_upload(tmp_path: Path) -> None:
    source = tmp_path / "input.vtt"
    source.write_text("WEBVTT\n\npas de cue", encoding="utf-8")
    with pytest.raises(ValueError):
        normalize_upload(source)

