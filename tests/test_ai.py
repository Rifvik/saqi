"""Unit and integration tests for Saqi's Gemini AI service and server."""
from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ai_mock import MockGeminiClient  # noqa: E402
from ai_service import (  # noqa: E402
    AIServiceError,
    SaqiAIService,
    find_unverified_numbers,
    language_info,
    normalize_report,
    parse_json_reply,
)
from server import make_server  # noqa: E402


SAMPLE_CONTEXT = {
    "app": "Saqi",
    "location": {"name": "Al Ain, UAE", "lat": 24.21, "lon": 55.74},
    "weather": {
        "source": "Live forecast for Al Ain, UAE (Open-Meteo)",
        "kind": "live",
        "heat_threshold_c": 45,
        "days": [{"date": "2026-11-17", "tmax_c": 33, "tmin_c": 20, "et0_mm": 4.2, "rain_mm": 0, "wind_kmh": 14}],
        "heat_days": [],
    },
    "water": {"ecw_dS_m": 3.0, "source": "measured (EC pen)", "age_days": 7, "cost_aed_per_m3": 2.0},
    "drainage": {"class": "good", "max_leaching_fraction_pct": 45},
    "start_time": "21:00",
    "valves": [
        {
            "valve": 1,
            "name": "Date palms – north",
            "crop": "Date palm",
            "crop_ece_threshold_dS_m": 4.0,
            "area_ha": 2.0,
            "stage": "established",
            "system": "Drip",
            "block_flow_m3h": 40,
            "flow_valid": True,
            "tonight": {
                "minutes": 150,
                "volume_m3": 102.5,
                "gross_mm": 5.1,
                "salt_flush_pct": 21,
                "modeled_rootzone_ece_dS_m": 4.0,
                "drainage_blocked": False,
            },
            "week_m3": {"saqi": 718, "weather_only": 591, "habit": 1120},
            "est_relative_yield_pct": {"saqi": 100, "weather_only": 12, "habit": 100},
            "salt_trend": "stable",
            "drip_flow_status": "ok",
        },
        {
            "valve": 2,
            "name": "Tomato – open field",
            "crop": "Tomato",
            "crop_ece_threshold_dS_m": 2.5,
            "area_ha": 0.5,
            "stage": "development",
            "system": "Drip",
            "block_flow_m3h": 0,
            "flow_valid": False,
            "tonight": {
                "minutes": None,
                "volume_m3": 28.4,
                "gross_mm": 5.7,
                "salt_flush_pct": 46,
                "modeled_rootzone_ece_dS_m": 2.5,
                "drainage_blocked": False,
            },
            "week_m3": {"saqi": 199, "weather_only": 137, "habit": 0},
            "est_relative_yield_pct": {"saqi": 100, "weather_only": 0, "habit": 0},
            "salt_trend": "stable",
            "drip_flow_status": "ok",
        },
    ],
    "totals_week": {
        "saqi_m3": 917,
        "weather_only_m3": 728,
        "habit_m3": 1120,
        "saved_vs_habit_m3": 203,
        "saved_vs_habit_pct": 18,
    },
}


class _RecordingModels:
    def __init__(self, text: str | None = None, exc: Exception | None = None):
        self.text = text
        self.exc = exc
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.exc:
            raise self.exc
        return type("Resp", (), {"text": self.text})()


class _FakeClient:
    def __init__(self, text: str | None = None, exc: Exception | None = None):
        self.models = _RecordingModels(text=text, exc=exc)


class AIServiceTests(unittest.TestCase):
    def test_language_lookup_handles_rtl_and_unknown_fallback(self):
        self.assertEqual(language_info("ar"), ("ar", "Arabic", "rtl"))
        self.assertEqual(language_info("ur"), ("ur", "Urdu", "rtl"))
        self.assertEqual(language_info("hi"), ("hi", "Hindi", "ltr"))
        self.assertEqual(language_info("bn"), ("bn", "Bengali", "ltr"))
        self.assertEqual(language_info("fr-CA"), ("fr", "French", "ltr"))
        self.assertEqual(language_info("xx-unknown"), ("en", "English", "ltr"))

    def test_missing_api_key_returns_friendly_503(self):
        old = os.environ.pop("GEMINI_API_KEY", None)
        try:
            svc = SaqiAIService(api_key="")
            with self.assertRaises(AIServiceError) as ctx:
                svc.chat("How much water tonight?", [], SAMPLE_CONTEXT, "en")
            self.assertEqual(ctx.exception.status, 503)
            self.assertEqual(ctx.exception.code, "no_api_key")
        finally:
            if old is not None:
                os.environ["GEMINI_API_KEY"] = old

    def test_upstream_errors_mask_api_key_and_explain_cleanly(self):
        secret = "AIzaTestSecretKey98765"
        for err_text, expected_phrase in [
            (f"401 API key invalid: {secret}", "rejected the server's API key"),
            ("429 RESOURCE_EXHAUSTED quota exceeded", "quota or rate limit"),
            ("404 models/gemini-bad not found", "not available"),
            ("Request timed out", "took too long"),
        ]:
            svc = SaqiAIService(api_key=secret, client=_FakeClient(exc=RuntimeError(err_text)))
            with self.assertRaises(AIServiceError) as ctx:
                svc.chat("Water plan?", [], SAMPLE_CONTEXT, "en")
            msg = str(ctx.exception)
            self.assertNotIn(secret, msg)
            self.assertIn(expected_phrase, msg)

    def test_flash_fallback_retries_503_and_stops_on_401(self):
        class _FallbackModels:
            def __init__(self, fail_auth=False):
                self.models_tried = []
                self.fail_auth = fail_auth

            def generate_content(self, model, contents, config):
                self.models_tried.append(model)
                if self.fail_auth:
                    raise RuntimeError("401 invalid API key")
                if len(self.models_tried) < 3:
                    raise RuntimeError("503 UNAVAILABLE: high demand")
                return type("Resp", (), {"text": "Valve 1 needs 150 min."})()

        c_ok = type("C", (), {"models": _FallbackModels()})()
        res = SaqiAIService(client=c_ok).chat("How long?", [], SAMPLE_CONTEXT, "en")
        self.assertEqual(len(c_ok.models.models_tried), 3)
        self.assertEqual(res["model"], c_ok.models.models_tried[-1])

        c_auth = type("C", (), {"models": _FallbackModels(fail_auth=True)})()
        with self.assertRaises(AIServiceError):
            SaqiAIService(client=c_auth).chat("How long?", [], SAMPLE_CONTEXT, "en")
        self.assertEqual(len(c_auth.models.models_tried), 1)

    def test_chat_passes_language_history_and_grounding_rules(self):
        fake = _FakeClient(text="Valve 1 needs 150 min (102.5 m3) with +21% salt flush after 21:00.")
        svc = SaqiAIService(client=fake)
        res = svc.chat(
            "How long for valve 1?",
            history=[
                {"role": "model", "text": "stray opening"},
                {"role": "user", "text": "What crop is on valve 1?"},
                {"role": "assistant", "text": "Date palm."},
            ],
            context=SAMPLE_CONTEXT,
            lang="ur",
        )
        self.assertEqual(res["lang"], "ur")
        self.assertEqual(res["dir"], "rtl")
        self.assertEqual(res["unverified_numbers"], [])
        call = fake.models.calls[0]
        cfg = call["config"]
        sys_prompt = cfg["system_instruction"] if isinstance(cfg, dict) else cfg.system_instruction
        self.assertIn("Urdu (language code 'ur')", sys_prompt)
        self.assertIn("NEVER invent measurements", sys_prompt)
        self.assertIn("Date palms – north", sys_prompt)
        # Stray leading model turn stripped so Gemini receives user -> model -> user
        turns = call["contents"]
        roles = [c["role"] if isinstance(c, dict) else c.role for c in turns]
        self.assertEqual(roles, ["user", "model", "user"])

    def test_number_guard_flags_fabricated_quantities_and_allows_arabic_digits(self):
        # 150 and 102.5 are in context (even using Eastern Arabic digits)
        self.assertEqual(find_unverified_numbers("Valve 1: ١٥٠ min, ١٠٢٫٥ m3.", SAMPLE_CONTEXT), [])
        # Fabricated 999 min must be flagged
        self.assertEqual(find_unverified_numbers("Valve 1: run 999 minutes tonight.", SAMPLE_CONTEXT), ["999"])

    def test_report_parses_json_fences_and_requires_valves(self):
        raw = """```json
        {
          "title": "تقرير ساقي",
          "labels": {"farm_overview": "نظرة عامة"},
          "summary": "Saqi saves 203 m3 vs habit.",
          "overview": "Al Ain farm, 2 valves.",
          "environment": "Open-Meteo ET0 4.2 mm.",
          "crops": [{"valve": 1, "insight": "150 min", "recommendation": "Run after 21:00"}],
          "salinity": "ECw 3.0 dS/m.",
          "water_usage": "Saqi 917 m3 vs habit 1120 m3.",
          "risks": [{"risk": "Flow 0 on valve 2", "severity": "HIGH", "prevention": "Enter flow"}],
          "recommendations": [
            {"priority": 2, "action": "Water valve 1", "why": "Crop ET"},
            {"priority": 1, "action": "Set valve 2 flow", "why": "Invalid flow"}
          ],
          "disclaimer": "Estimates only."
        }
        ```"""
        parsed = normalize_report(parse_json_reply(raw))
        self.assertEqual(parsed["title"], "تقرير ساقي")
        self.assertEqual(parsed["labels"]["farm_overview"], "نظرة عامة")
        self.assertEqual(parsed["recommendations"][0]["priority"], 1)
        self.assertEqual(parsed["risks"][0]["severity"], "high")

        svc = SaqiAIService(client=_FakeClient(text=raw))
        out = svc.report(SAMPLE_CONTEXT, "ar")
        self.assertEqual(out["dir"], "rtl")
        self.assertEqual(out["unverified_numbers"], [])

        with self.assertRaises(AIServiceError) as ctx:
            svc.report({"valves": []}, "en")
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.code, "missing_farm_data")


class ServerHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        svc = SaqiAIService(api_key="", model="saqi-demo-mock", client=MockGeminiClient())
        svc.mock = True
        cls.httpd = make_server("127.0.0.1", 0, service=svc)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _req(self, path: str, body: dict | None = None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"} if data is not None else {}
        req = Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except HTTPError as err:
            return err.code, err.read().decode("utf-8")

    def test_status_chat_report_and_secret_file_blocking(self):
        st, body = self._req("/api/ai/status")
        self.assertEqual(st, 200)
        self.assertTrue(body["configured"])
        self.assertTrue(body["mock"])

        st, chat_res = self._req("/api/ai/chat", {"message": "Tonight plan?", "history": [], "context": SAMPLE_CONTEXT, "lang": "ur"})
        self.assertEqual(st, 200)
        self.assertEqual(chat_res["lang"], "ur")
        self.assertEqual(chat_res["dir"], "rtl")
        self.assertIn("150 min", chat_res["reply"])

        st, rep_res = self._req("/api/ai/report", {"context": SAMPLE_CONTEXT, "lang": "ar"})
        self.assertEqual(st, 200)
        self.assertEqual(rep_res["lang"], "ar")
        self.assertEqual(rep_res["dir"], "rtl")
        self.assertEqual(len(rep_res["report"]["crops"]), 2)

        for secret_path in ("/.env", "/server.py", "/ai_service.py", "/requirements.txt", "/tests/engine.test.js"):
            code, _ = self._req(secret_path)
            self.assertEqual(code, 404, f"{secret_path} must be blocked")


if __name__ == "__main__":
    unittest.main()
