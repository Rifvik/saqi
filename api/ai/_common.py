"""Shared Vercel BaseHTTPRequestHandler adapter (underscored so Vercel does not deploy it as a route)."""
from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_http import (  # noqa: E402
    RATE_LIMIT_PER_MIN,
    RateLimiter,
    drain_body,
    get_cached_service,
    send_error,
    send_options,
    serve_ai_post,
    serve_ai_status,
)

_WARM_LIMITER = RateLimiter(RATE_LIMIT_PER_MIN)


class _AiHandlerBase(BaseHTTPRequestHandler):
    """Base Vercel Python handler forwarding GET/POST/OPTIONS to shared `ai_http`."""

    route_name: str = ""
    allowed_methods: tuple[str, ...] = ()
    service_override = None
    limiter_override = None

    def log_message(self, fmt, *args):  # keep farm payloads & secrets out of serverless logs
        return

    def _service(self):
        return self.service_override if self.service_override is not None else get_cached_service()

    def _limiter(self):
        return self.limiter_override if self.limiter_override is not None else _WARM_LIMITER

    def do_OPTIONS(self):
        send_options(self, ", ".join((*self.allowed_methods, "OPTIONS")))

    def do_GET(self):
        if "GET" not in self.allowed_methods:
            return send_error(self, 405, "method_not_allowed", f"Use {', '.join(self.allowed_methods)} on this endpoint.")
        return serve_ai_status(self, self._service())

    def do_POST(self):
        if "POST" not in self.allowed_methods:
            drain_body(self)
            return send_error(self, 405, "method_not_allowed", f"Use {', '.join(self.allowed_methods)} on this endpoint.")
        return serve_ai_post(self, self.route_name, self._service(), self._limiter())


class StatusHandler(_AiHandlerBase):
    route_name = "status"
    allowed_methods = ("GET",)


class ChatHandler(_AiHandlerBase):
    route_name = "chat"
    allowed_methods = ("POST",)


class ReportHandler(_AiHandlerBase):
    route_name = "report"
    allowed_methods = ("POST",)
