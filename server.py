"""Saqi local server: serves the static app AND the Gemini-backed AI endpoints.

    python server.py            # http://127.0.0.1:8765

Environment:
    GEMINI_API_KEY   required for AI features (read from the environment or a git-ignored .env file)
    GEMINI_MODEL     optional, default "gemini-3.8-flash"
    PORT / HOST      optional, default 8765 / 127.0.0.1
    SAQI_AI_MOCK=1   optional, offline demo replies when no key is set (for UI testing only)

The API key stays on the server. The browser only ever talks to /api/ai/*.
"""
from __future__ import annotations

import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from ai_http import (
    MAX_BODY_BYTES,
    RATE_LIMIT_PER_MIN,
    RateLimiter as _RateLimiter,
    build_service,
    send_error as _send_error,
    send_json as _send_json,
    send_options as _send_options,
    serve_ai_post,
    serve_ai_status,
)

ROOT = Path(__file__).resolve().parent
BLOCKED_SUFFIXES = (".py", ".pyc", ".env", ".md~")
BLOCKED_PARTS = {"tests", "__pycache__", "node_modules", "dist"}


def load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines). Existing environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


class SaqiHandler(SimpleHTTPRequestHandler):
    service = None           # set in make_server
    limiter = _RateLimiter(RATE_LIMIT_PER_MIN)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # -- helpers --------------------------------------------------------------
    def log_message(self, fmt, *args):  # keep request bodies (farm data) out of logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status: int, payload: dict) -> None:
        _send_json(self, status, payload)

    def _error(self, status: int, code: str, message: str) -> None:
        _send_error(self, status, code, message)

    def _is_blocked(self, path: str) -> bool:
        parts = [p for p in unquote(urlparse(path).path).split("/") if p]
        if any(p.startswith(".") for p in parts):          # .env, .git, .vscode ...
            return True
        if any(p in BLOCKED_PARTS for p in parts):
            return True
        last = parts[-1].lower() if parts else ""
        return last.endswith(BLOCKED_SUFFIXES) or last in {"requirements.txt", "vercel.json"}

    # -- routing ----------------------------------------------------------------
    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        path = urlparse(self.path).path
        if path == "/api/ai/status":
            return _send_options(self, "GET, OPTIONS")
        if path in ("/api/ai/chat", "/api/ai/report"):
            return _send_options(self, "POST, OPTIONS")
        return self._error(404, "not_found", "Not found.")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/ai/status":
            return serve_ai_status(self, self.service)
        if path.startswith("/api/"):
            return self._error(404, "not_found", "Unknown API route.")
        if self._is_blocked(self.path):
            return self._error(404, "not_found", "Not found.")
        return super().do_GET()

    def do_HEAD(self):
        if self._is_blocked(self.path) or self.path.startswith("/api/"):
            self.send_response(404)
            self.end_headers()
            return
        return super().do_HEAD()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/ai/chat":
            return serve_ai_post(self, "chat", self.service, self.limiter)
        if path == "/api/ai/report":
            return serve_ai_post(self, "report", self.service, self.limiter)
        return self._error(404, "not_found", "Unknown API route.")


def make_server(host: str, port: int, service=None, limiter=None) -> ThreadingHTTPServer:
    import socket
    cls = ThreadingHTTPServer
    if ":" in host:
        cls = type("IPv6ThreadingHTTPServer", (ThreadingHTTPServer,), {"address_family": socket.AF_INET6})
    handler = type("BoundSaqiHandler", (SaqiHandler,), {"service": service or build_service(),
                                                        "limiter": limiter or _RateLimiter(RATE_LIMIT_PER_MIN)})
    return cls((host, port), handler)


def main() -> None:
    load_dotenv(ROOT / ".env")
    host_env = os.environ.get("HOST", "").strip()
    port = int(os.environ.get("PORT", "8765"))
    service = build_service()
    limiter = _RateLimiter(RATE_LIMIT_PER_MIN)
    primary_host = host_env or "127.0.0.1"
    servers = [make_server(primary_host, port, service=service, limiter=limiter)]
    if not host_env or host_env == "localhost":
        try:
            v6 = make_server("::1", port, service=service, limiter=limiter)
            servers.append(v6)
            threading.Thread(target=v6.serve_forever, daemon=True).start()
        except OSError:
            pass
    st = service.status()
    mode = "DEMO MOCK" if getattr(service, "mock", False) else (
        "ready" if st["configured"] else "disabled (set GEMINI_API_KEY)")
    print(f"Saqi running at http://localhost:{port} ({primary_host})  ·  AI: {mode}  ·  model: {st['model']}", flush=True)
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for s in servers:
            s.server_close()


if __name__ == "__main__":
    main()
