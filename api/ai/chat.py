"""Vercel serverless endpoint: POST /api/ai/chat."""
from __future__ import annotations

import sys
from pathlib import Path

_DIR = str(Path(__file__).resolve().parent)
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

from _common import ChatHandler  # noqa: E402


class handler(ChatHandler):
    pass
