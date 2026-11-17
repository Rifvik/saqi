"""Shared HTTP / AI routing helpers used by both local `server.py` and Vercel `/api/ai/*.py`."""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any

from ai_service import AIServiceError, SaqiAIService

MAX_BODY_BYTES = 256 * 1024
RATE_LIMIT_PER_MIN = 30

_service_lock = threading.Lock()
_cached_key: tuple[str, str, str] | None = None
_cached_service: SaqiAIService | None = None


def build_service() -> SaqiAIService:
    """Create a SaqiAIService (or MockGeminiClient if SAQI_AI_MOCK=1 and no GEMINI_API_KEY)."""
    if not os.environ.get("GEMINI_API_KEY") and os.environ.get("SAQI_AI_MOCK") == "1":
        from ai_mock import MockGeminiClient
        svc = SaqiAIService(api_key="", model="saqi-demo-mock", client=MockGeminiClient())
        svc.mock = True
        return svc
    svc = SaqiAIService()
    svc.mock = False
    return svc


def get_cached_service() -> SaqiAIService:
    """Reuse one SaqiAIService per env config across warm serverless invocations."""
    global _cached_key, _cached_service
    env_key = (
        os.environ.get("GEMINI_API_KEY", ""),
        os.environ.get("GEMINI_MODEL", ""),
        os.environ.get("SAQI_AI_MOCK", ""),
    )
    with _service_lock:
        if _cached_service is None or _cached_key != env_key:
            _cached_service = build_service()
            _cached_key = env_key
        return _cached_service


class RateLimiter:
    """In-memory per-IP sliding window limiter (exact locally; best-effort per warm Vercel instance)."""

    def __init__(self, per_minute: int = RATE_LIMIT_PER_MIN):
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
            if hits:
                self.hits[key] = hits
            else:
                self.hits.pop(key, None)
            return ok


def client_ip(headers: Any, client_address: tuple[str, int] | None = None) -> str:
    """Resolve client IP behind reverse proxies (Vercel) or direct local sockets."""
    if headers is not None:
        fwd = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or ""
        if fwd:
            return fwd.split(",")[0].strip() or "unknown"
        real_ip = headers.get("x-real-ip") or headers.get("X-Real-IP")
        if real_ip:
            return str(real_ip).strip()
    if client_address:
        return str(client_address[0])
    return "local"


def cors_headers_for(headers: Any) -> dict[str, str]:
    """Same-origin by default; emit CORS headers only when ALLOWED_ORIGIN explicitly matches Origin."""
    allowed = os.environ.get("ALLOWED_ORIGIN", "").strip()
    if not allowed or headers is None:
        return {}
    origin = (headers.get("Origin") or headers.get("origin") or "").strip()
    if not origin:
        return {}
    allowed_set = {o.strip().rstrip("/") for o in allowed.split(",") if o.strip()}
    if origin.rstrip("/") in allowed_set:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Vary": "Origin",
        }
    return {}


def send_json(handler: Any, status: int, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    for k, v in (extra_headers or {}).items():
        handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(body)


def send_error(handler: Any, status: int, code: str, message: str, extra_headers: dict[str, str] | None = None) -> None:
    send_json(handler, status, {"ok": False, "error": {"code": code, "message": message}}, extra_headers=extra_headers)


def send_options(handler: Any, allow_methods: str) -> None:
    handler.send_response(204)
    handler.send_header("Allow", allow_methods)
    handler.send_header("Cache-Control", "no-store")
    for k, v in cors_headers_for(getattr(handler, "headers", None)).items():
        handler.send_header(k, v)
    handler.end_headers()


def read_json_body(rfile: Any, headers: Any, max_bytes: int = MAX_BODY_BYTES) -> tuple[dict | None, tuple[int, str, str] | None]:
    try:
        length = int((headers.get("Content-Length") if headers else 0) or 0)
    except ValueError:
        length = 0
    if length > max_bytes:
        # Drain (bounded) so the client receives a clean 413 instead of a connection reset mid-upload.
        remaining = min(length, 4 * max_bytes)
        while remaining > 0:
            chunk = rfile.read(min(65536, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
        return None, (413, "payload_too_large", "Request body too large.")
    if length <= 0:
        return None, (400, "bad_request", "Request body missing.")
    raw = rfile.read(length)
    if not raw or len(raw) > max_bytes:
        return None, (413 if raw and len(raw) > max_bytes else 400, "bad_request", "Request body missing or too large.")
    try:
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError
        return payload, None
    except (ValueError, UnicodeDecodeError):
        return None, (400, "bad_json", "Request body must be a JSON object.")


def serve_ai_status(handler: Any, service: SaqiAIService) -> None:
    extra = cors_headers_for(getattr(handler, "headers", None))
    st = service.status()
    st["mock"] = bool(getattr(service, "mock", False))
    send_json(handler, 200, {"ok": True, **st}, extra_headers=extra)


def serve_ai_post(handler: Any, route: str, service: SaqiAIService, limiter: RateLimiter | None = None) -> None:
    extra = cors_headers_for(getattr(handler, "headers", None))
    if route not in ("chat", "report"):
        return send_error(handler, 404, "not_found", "Unknown API route.", extra_headers=extra)
    if limiter is not None:
        ip = client_ip(getattr(handler, "headers", None), getattr(handler, "client_address", None))
        if not limiter.allow(ip):
            return send_error(handler, 429, "rate_limited", "Too many AI requests. Please wait a minute.", extra_headers=extra)

    payload, err = read_json_body(handler.rfile, getattr(handler, "headers", None))
    if err:
        return send_error(handler, err[0], err[1], err[2], extra_headers=extra)

    try:
        if route == "chat":
            result = service.chat(payload.get("message"), payload.get("history"),
                                  payload.get("context"), payload.get("lang"))
        else:
            result = service.report(payload.get("context"), payload.get("lang"))
    except AIServiceError as exc:
        return send_error(handler, exc.status, exc.code, str(exc), extra_headers=extra)
    except Exception:  # never expose tracebacks or server config
        return send_error(handler, 500, "server_error", "Unexpected server error.", extra_headers=extra)

    result["mock"] = bool(getattr(service, "mock", False))
    return send_json(handler, 200, {"ok": True, **result}, extra_headers=extra)
