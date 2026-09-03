from __future__ import annotations

import json
import sys
from typing import Any


def emit(event_type: str, **payload: Any) -> None:
    event = {"type": event_type, **payload}
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) > 1_048_576:
        raise RuntimeError("Événement JSONL trop volumineux.")
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def log(message: str) -> None:
    sys.stderr.write(message[:4_096] + "\n")
    sys.stderr.flush()

