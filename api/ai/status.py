"""Vercel serverless endpoint: GET /api/ai/status."""
from __future__ import annotations

import sys
from pathlib import Path

_DIR = str(Path(__file__).resolve().parent)
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

from _common import StatusHandler  # noqa: E402


class handler(StatusHandler):
    pass
