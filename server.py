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

import json
import os
import sys
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
MAX_BODY_BYTES = 256 * 1024
RATE_LIMIT_PER_MIN = 30
BLOCKED_SUFFIXES = (".py", ".pyc", ".env", ".md~")
BLOCKED_PARTS = {"tests", "__pycache__", "node_modules"}


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


def build_service():
    from ai_service import SaqiAIService
    if not os.environ.get("GEMINI_API_KEY") and os.environ.get("SAQI_AI_MOCK") == "1":
        from ai_mock import MockGeminiClient
        svc = SaqiAIService(api_key="", model="saqi-demo-mock", client=MockGeminiClient())
        svc.mock = True
        return svc
    svc = SaqiAIService()
    svc.mock = False
    return svc


class _RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            hits = [t for t in self.hits.get(key, []) if now - t < 60]
            ok = len(hits) < self.per_minute
            if ok:
                hits.append(now)
            self.hits[key] = hits
            return ok


class SaqiHandler(SimpleHTTPRequestHandler):
    service = None           # set in make_server
    limiter = _RateLimiter(RATE_LIMIT_PER_MIN)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # -- helpers --------------------------------------------------------------
    def log_message(self, fmt, *args):  # keep request bodies (farm data) out of logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, code: str, message: str) -> None:
        self._send_json(status, {"ok": False, "error": {"code": code, "message": message}})

    def _is_blocked(self, path: str) -> bool:
        parts = [p for p in unquote(urlparse(path).path).split("/") if p]
        if any(p.startswith(".") for p in parts):          # .env, .git, .vscode ...
            return True
        if any(p in BLOCKED_PARTS for p in parts):
            return True
        last = parts[-1].lower() if parts else ""
        return last.endswith(BLOCKED_SUFFIXES) or last in {"requirements.txt"}

    # -- routing ----------------------------------------------------------------
    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/ai/status":
            st = self.service.status()
            st["mock"] = bool(getattr(self.service, "mock", False))
            return self._send_json(200, {"ok": True, **st})
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
        if path not in ("/api/ai/chat", "/api/ai/report"):
            return self._error(404, "not_found", "Unknown API route.")
        if not self.limiter.allow(self.client_address[0]):
            return self._error(429, "rate_limited", "Too many AI requests. Please wait a minute.")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            return self._error(413 if length > MAX_BODY_BYTES else 400, "bad_request", "Request body missing or too large.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self._error(400, "bad_json", "Request body must be a JSON object.")

        from ai_service import AIServiceError
        try:
            if path == "/api/ai/chat":
                result = self.service.chat(payload.get("message"), payload.get("history"),
                                           payload.get("context"), payload.get("lang"))
            else:
                result = self.service.report(payload.get("context"), payload.get("lang"))
        except AIServiceError as exc:
            return self._error(exc.status, exc.code, str(exc))
        except Exception:  # never leak internals
            return self._error(500, "server_error", "Unexpected server error.")
        result["mock"] = bool(getattr(self.service, "mock", False))
        return self._send_json(200, {"ok": True, **result})


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
