"""Saqi shared AI service (Google Gemini via the official `google-genai` SDK).

One service powers both the farm chatbot and the AI report generator.

Design rules:
  * The Gemini API key is read ONLY from the GEMINI_API_KEY environment variable
    (optionally loaded from a git-ignored .env file by server.py). It is never
    sent to the browser, logged, or echoed in error messages.
  * SAQI's own FAO-56 / FAO-29 calculations (computed in the browser) are passed in
    as `context` and treated as the single source of truth. The model is told never
    to invent measurements or irrigation quantities, and every reply is checked for
    numbers that do not appear in the farm data (`unverified_numbers`).
  * Replies are written in the language currently selected in SAQI's existing
    website language picker (the `lang` code sent by the browser).
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Iterable

DEFAULT_MODEL = "gemini-3.8-flash"
FLASH_FALLBACKS = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
)
MAX_CONTEXT_CHARS = 40_000
MAX_MESSAGE_CHARS = 2_000
MAX_HISTORY_TURNS = 12

# Mirrors SITE_LANGS in js/app.js (the existing whole-site language picker).
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English", "ar": "Arabic", "ur": "Urdu", "hi": "Hindi", "bn": "Bengali",
    "ml": "Malayalam", "ta": "Tamil", "tl": "Tagalog (Filipino)", "fa": "Persian (Farsi)",
    "ps": "Pashto", "pa": "Punjabi", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati",
    "si": "Sinhala", "ne": "Nepali", "am": "Amharic", "sw": "Swahili", "so": "Somali",
    "ha": "Hausa", "tr": "Turkish", "fr": "French", "es": "Spanish", "de": "German",
    "pt": "Portuguese", "ru": "Russian", "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese", "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese",
    "th": "Thai", "ja": "Japanese", "ko": "Korean", "it": "Italian", "nl": "Dutch",
    "pl": "Polish", "uk": "Ukrainian", "ro": "Romanian", "el": "Greek", "uz": "Uzbek",
    "kk": "Kazakh", "az": "Azerbaijani", "he": "Hebrew",
}
RTL_CODES = {"ar", "ur", "fa", "ps", "he"}

# Labels the report UI needs; the model translates them into the selected language.
REPORT_LABEL_KEYS: dict[str, str] = {
    "report_title": "Saqi AI Farm Report",
    "farm_overview": "Farm overview",
    "environment": "Environmental conditions",
    "crop_irrigation": "Crop-wise irrigation requirements",
    "salinity": "Soil & water salinity analysis",
    "water_usage": "Water usage, savings & comparison",
    "risks": "Risks & preventive measures",
    "recommendations": "Prioritised recommendations",
    "insights": "AI insights",
    "key_numbers": "Key numbers (calculated by Saqi)",
    "location": "Location",
    "weather_source": "Weather data",
    "water_ecw": "Irrigation water salinity (ECw)",
    "drainage": "Drainage",
    "generated": "Generated",
    "language": "Language",
    "valve": "Valve",
    "crop": "Crop",
    "area": "Area",
    "tonight": "Tonight",
    "volume_today": "Water today",
    "salt_flush": "Salt flush",
    "modeled_ece": "Modeled root-zone ECe",
    "week_saqi": "7-day Saqi",
    "week_weather_only": "7-day weather-only",
    "week_habit": "7-day fixed habit",
    "est_yield": "Est. relative yield",
    "recommendation": "Recommendation",
    "risk": "Risk",
    "severity": "Severity",
    "prevention": "Prevention",
    "priority": "Priority",
    "action": "Action",
    "why": "Why",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "flow_not_set": "Set block flow > 0 m³/h",
    "disclaimer": "Disclaimer",
    "numbers_note": "All numbers come from Saqi's FAO-56 / FAO-29 calculations. Text is AI-generated.",
}


class AIServiceError(Exception):
    """Raised for any AI failure. `status` is an HTTP status, `code` a stable error id."""

    def __init__(self, message: str, status: int = 500, code: str = "ai_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def language_info(code: str | None) -> tuple[str, str, str]:
    """Return (code, english_name, dir) for a SAQI site language code (defaults to English)."""
    code = (code or "en").strip()
    if code not in LANGUAGE_NAMES:
        base = code.split("-")[0]
        code = base if base in LANGUAGE_NAMES else "en"
    return code, LANGUAGE_NAMES[code], ("rtl" if code in RTL_CODES else "ltr")


# ---------------------------------------------------------------------------
# Number consistency checking
# ---------------------------------------------------------------------------
_DIGIT_MAP = {}
for _zero in (0x0660, 0x06F0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0BE6, 0x0C66, 0x0CE6,
              0x0D66, 0x0E50, 0x0ED0, 0x0F20, 0x1040, 0x17E0, 0xFF10):
    for _i in range(10):
        _DIGIT_MAP[_zero + _i] = str(_i)
_DIGIT_MAP[0x066B] = "."   # Arabic decimal separator
_DIGIT_MAP[0x066C] = ","   # Arabic thousands separator

_NUM_RE = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?")


def normalize_digits(text: str) -> str:
    return (text or "").translate(_DIGIT_MAP)


def extract_numbers(text: str) -> list[tuple[str, float]]:
    out = []
    for m in _NUM_RE.finditer(normalize_digits(text)):
        raw = m.group(0)
        try:
            out.append((raw, float(raw.replace(",", ""))))
        except ValueError:
            continue
    return out


def _collect_context_numbers(obj: Any, acc: set[float]) -> None:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        v = float(obj)
        acc.add(v)
        acc.add(abs(v))
        if 0 < abs(v) <= 1.5:
            acc.add(round(abs(v) * 100, 1))  # fractions quoted as percentages
        return
    if isinstance(obj, str):
        for _, v in extract_numbers(obj):
            acc.add(v)
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            _collect_context_numbers(k, acc)
            _collect_context_numbers(v, acc)
        return
    if isinstance(obj, (list, tuple)):
        for v in obj:
            _collect_context_numbers(v, acc)


def find_unverified_numbers(text: str, context: Any, extra_allowed: Iterable[float] = ()) -> list[str]:
    """Numbers in `text` that cannot be traced to the farm `context` (within rounding).

    Small integers (0-12) are always allowed (list numbering, "2 days", valve ids...).
    """
    allowed: set[float] = set(extra_allowed)
    _collect_context_numbers(context, allowed)
    bad: list[str] = []
    for raw, val in extract_numbers(text):
        if val <= 12 and float(val).is_integer():
            continue
        ok = any(abs(val - a) <= max(0.051, abs(a) * 0.012) or round(a) == val for a in allowed)
        if not ok and raw not in bad:
            bad.append(raw)
    return bad


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
_COMMON_RULES = """
SOURCE OF TRUTH
- FARM_DATA (JSON below) was calculated by Saqi's own engine: FAO-56 crop water use (ETc = Kc x ET0),
  FAO-29 leaching requirement with drainage limits, and modeled root-zone salinity (ECe).
- NEVER invent measurements, irrigation minutes, water volumes, salinity values, yields, prices or dates.
  Only quote numbers that appear in FARM_DATA (you may round them). Do not compute new irrigation quantities.
- If something is missing (null / not in FARM_DATA) say clearly that Saqi does not have it yet and explain how the
  farmer can add it in Saqi (e.g. measure water with an EC pen and enter it in "My farm").
- Root-zone ECe and yields are MODELED ESTIMATES, not measurements. Say so when you use them.
- If a valve has flow_valid=false, its runtime cannot be calculated: tell the farmer to set the block flow first.
- When fixed habit uses LESS water than Saqi (e.g. heatwaves), explain honestly that Saqi adds water to protect
  the crop from heat and salt stress. Do not claim Saqi always saves water.

STYLE
- Simple, friendly words for farmers and farm workers. Short sentences. Explain technical words once
  (ECw = how salty the irrigation water is; ECe = how salty the soil around the roots is).
- Write numbers with Western digits 0-9 and keep units exactly as in FARM_DATA (m3, min, mm, dS/m, ha, degC, AED).
""".strip()


def _language_rule(lang_name: str, code: str) -> str:
    return (f"LANGUAGE: Write your entire answer in {lang_name} (language code '{code}'), even if the farmer writes "
            f"in another language. Only numbers, units and crop/valve names from FARM_DATA may stay as they are.")


def build_chat_system_prompt(context: dict, lang_code: str) -> str:
    code, name, _ = language_info(lang_code)
    return "\n\n".join([
        "You are 'Saqi AI', a practical irrigation and soil-salinity adviser inside the Saqi app for small desert "
        "farms in the UAE and Gulf. You answer questions about irrigation timing and amounts, soil and water "
        "salinity, salt flushing (leaching), drainage, crop health, drip clogs/leaks, heat waves and water saving.",
        _language_rule(name, code),
        _COMMON_RULES,
        "ANSWER FORMAT\n- Usually under 160 words. Use short bullet points ('- ') when listing steps.\n"
        "- You may use **bold** for the single most important instruction.\n"
        "- Politely decline topics unrelated to farming, water or this farm.",
        "FARM_DATA (current, from Saqi):\n" + _context_json(context),
    ])


def build_report_system_prompt(context: dict, lang_code: str) -> str:
    code, name, _ = language_info(lang_code)
    labels = json.dumps(REPORT_LABEL_KEYS, ensure_ascii=False)
    schema = """{
  "title": string,
  "labels": { <every key of LABELS_EN>: string translated into the target language },
  "summary": string (3-4 sentences, the main take-away first),
  "overview": string (farm overview: location, valves, crops, areas),
  "environment": string (weather this week, heat days, ET0 range, data source/confidence),
  "crops": [ { "valve": integer (same as FARM_DATA valve number), "insight": string, "recommendation": string } ],
  "salinity": string (water ECw vs crop thresholds, modeled ECe, salt flush, drainage, salt trend),
  "water_usage": string (7-day Saqi vs weather-only vs fixed habit totals; savings or extra protection water),
  "risks": [ { "risk": string, "severity": "high" | "medium" | "low", "prevention": string } ],
  "recommendations": [ { "priority": integer (1 = most urgent), "action": string, "why": string } ],
  "disclaimer": string
}"""
    return "\n\n".join([
        "You are 'Saqi AI', writing a professional, personalised farm report for a desert farmer using ONLY the "
        "FARM_DATA from the Saqi app. The report UI shows Saqi's exact numbers in tables; your job is the narrative, "
        "insights, risks and prioritised recommendations.",
        _language_rule(name, code),
        _COMMON_RULES,
        "OUTPUT: Return ONLY valid JSON (no markdown fences) matching this schema:\n" + schema +
        "\nInclude one 'crops' item for every valve in FARM_DATA. Give 3-6 risks and 3-6 recommendations.",
        "LABELS_EN (translate the values, keep the keys):\n" + labels,
        "FARM_DATA (current, from Saqi):\n" + _context_json(context),
    ])


def _context_json(context: Any) -> str:
    text = json.dumps(context if context is not None else {}, ensure_ascii=False, separators=(",", ":"))
    if len(text) > MAX_CONTEXT_CHARS:
        raise AIServiceError("Farm data is too large to send to the AI.", 413, "context_too_large")
    return text


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def parse_json_reply(text: str) -> dict:
    """Parse the model's JSON reply, tolerating ```json fences or leading prose."""
    t = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if fence:
        t = fence.group(1).strip()
    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start == -1 or end <= start:
            raise AIServiceError("The AI returned an unreadable report. Please try again.", 502, "bad_ai_output")
        try:
            data = json.loads(t[start:end + 1])
        except json.JSONDecodeError as exc:
            raise AIServiceError("The AI returned an unreadable report. Please try again.", 502, "bad_ai_output") from exc
    if not isinstance(data, dict):
        raise AIServiceError("The AI returned an unreadable report. Please try again.", 502, "bad_ai_output")
    return data


def normalize_report(data: dict) -> dict:
    """Coerce the model output into the exact shape the report UI expects."""
    labels_in = data.get("labels") if isinstance(data.get("labels"), dict) else {}
    labels = {k: _clean_text(labels_in.get(k), 120) or v for k, v in REPORT_LABEL_KEYS.items()}

    def items(key, fields):
        out = []
        for it in data.get(key) or []:
            if isinstance(it, dict):
                out.append({f: it.get(f) for f in fields})
        return out

    crops = []
    for it in items("crops", ("valve", "insight", "recommendation")):
        try:
            valve = int(it["valve"])
        except (TypeError, ValueError):
            continue
        crops.append({"valve": valve, "insight": _clean_text(it["insight"], 1200),
                      "recommendation": _clean_text(it["recommendation"], 1200)})
    risks = []
    for it in items("risks", ("risk", "severity", "prevention")):
        sev = str(it["severity"] or "medium").lower()
        risks.append({"risk": _clean_text(it["risk"], 600),
                      "severity": sev if sev in ("high", "medium", "low") else "medium",
                      "prevention": _clean_text(it["prevention"], 900)})
    recs = []
    for i, it in enumerate(items("recommendations", ("priority", "action", "why"))):
        try:
            pr = int(it["priority"])
        except (TypeError, ValueError):
            pr = i + 1
        recs.append({"priority": pr, "action": _clean_text(it["action"], 600), "why": _clean_text(it["why"], 900)})
    recs.sort(key=lambda r: r["priority"])
    return {
        "title": _clean_text(data.get("title"), 160) or labels["report_title"],
        "labels": labels,
        "summary": _clean_text(data.get("summary"), 2500),
        "overview": _clean_text(data.get("overview"), 2500),
        "environment": _clean_text(data.get("environment"), 2500),
        "crops": crops,
        "salinity": _clean_text(data.get("salinity"), 2500),
        "water_usage": _clean_text(data.get("water_usage"), 2500),
        "risks": risks[:8],
        "recommendations": recs[:8],
        "disclaimer": _clean_text(data.get("disclaimer"), 1200),
    }


def _report_text_blob(report: dict) -> str:
    parts = [report["summary"], report["overview"], report["environment"], report["salinity"],
             report["water_usage"], report["disclaimer"]]
    parts += [c["insight"] + " " + c["recommendation"] for c in report["crops"]]
    parts += [r["risk"] + " " + r["prevention"] for r in report["risks"]]
    parts += [r["action"] + " " + r["why"] for r in report["recommendations"]]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
class SaqiAIService:
    """Shared Gemini service for the chatbot and the report generator."""

    def __init__(self, api_key: str | None = None, model: str | None = None, client: Any = None):
        self._api_key = (api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")).strip()
        self.model = (model or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL).strip()
        self._client = client

    @property
    def configured(self) -> bool:
        return bool(self._client is not None or self._api_key)

    def status(self) -> dict:
        sdk = True
        try:
            import google.genai  # noqa: F401
        except ImportError:
            sdk = False
        return {"configured": self.configured and (sdk or self._client is not None),
                "sdk_installed": sdk, "model": self.model}

    # -- client ------------------------------------------------------------
    def _get_client(self):
        if self._client is not None:
            return self._client
        if not self._api_key:
            raise AIServiceError("Saqi AI is not set up yet: the server has no GEMINI_API_KEY.", 503, "no_api_key")
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise AIServiceError("The google-genai package is not installed on the server.", 503, "sdk_missing") from exc
        self._client = genai.Client(api_key=self._api_key, http_options=types.HttpOptions(timeout=60_000))
        return self._client

    def _candidate_models(self) -> list[str]:
        if not self.model.startswith("gemini-"):
            return [self.model]
        seen = [self.model]
        for m in FLASH_FALLBACKS:
            if m not in seen:
                seen.append(m)
        return seen

    def _is_retryable_model_err(self, exc: Exception) -> bool:
        low = str(exc).lower()
        if self._api_key and self._api_key.lower() in low:
            low = low.replace(self._api_key.lower(), "")
        if "401" in low or "403" in low or "api key" in low or "permission" in low:
            return False
        return any(tok in low for tok in ("503", "unavailable", "high demand", "404", "not_found", "no longer available", "not found"))

    def _generate(self, system_prompt: str, turns: list[tuple[str, str]], json_mode: bool, temperature: float) -> tuple[str, str]:
        client = self._get_client()
        try:
            from google.genai import types
            contents = [types.Content(role=role, parts=[types.Part(text=text)]) for role, text in turns]
            config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=temperature,
                max_output_tokens=8192 if json_mode else 1200,
                response_mime_type="application/json" if json_mode else "text/plain",
            )
        except ImportError:  # test doubles without the SDK
            contents = [{"role": role, "parts": [{"text": text}]} for role, text in turns]
            config = {"system_instruction": system_prompt, "temperature": temperature,
                      "response_mime_type": "application/json" if json_mode else "text/plain"}

        last_exc: Exception | None = None
        candidates = self._candidate_models()
        for idx, model_id in enumerate(candidates):
            try:
                response = client.models.generate_content(model=model_id, contents=contents, config=config)
                text = getattr(response, "text", None)
                if not text or not str(text).strip():
                    raise AIServiceError("The AI returned an empty answer. Please try again.", 502, "empty_ai_output")
                return str(text).strip(), model_id
            except AIServiceError:
                raise
            except Exception as exc:  # network, quota, auth, transient 503, safety...
                last_exc = exc
                if idx + 1 < len(candidates) and self._is_retryable_model_err(exc):
                    continue
                raise AIServiceError(self._friendly_upstream_error(exc), 502, "upstream_error") from exc
        raise AIServiceError(self._friendly_upstream_error(last_exc or RuntimeError("upstream_error")), 502, "upstream_error")

    def _friendly_upstream_error(self, exc: Exception) -> str:
        msg = str(exc)
        if self._api_key:
            msg = msg.replace(self._api_key, "***")
        low = msg.lower()
        if "api key" in low or "permission" in low or "401" in low or "403" in low:
            return "Gemini rejected the server's API key. Check GEMINI_API_KEY."
        if "429" in low or "quota" in low or "resource_exhausted" in low:
            return "Gemini quota or rate limit reached. Please wait a minute and try again."
        if "503" in low or "unavailable" in low or "high demand" in low:
            return "Gemini servers are temporarily busy right now. Please try again in a moment."
        if "timeout" in low or "timed out" in low or "deadline" in low:
            return "Gemini took too long to answer. Please try again."
        if "404" in low and "model" in low:
            return f"Gemini model '{self.model}' is not available. Set GEMINI_MODEL to a valid Flash model."
        return "Could not reach Gemini right now. Please try again shortly."

    # -- public API ----------------------------------------------------------
    def chat(self, message: str, history: list | None, context: dict | None, lang: str | None) -> dict:
        message = _clean_text(message, MAX_MESSAGE_CHARS)
        if not message:
            raise AIServiceError("Please type a question.", 400, "empty_message")
        code, name, direction = language_info(lang)
        context = context if isinstance(context, dict) else {}
        turns: list[tuple[str, str]] = []
        for item in (history or [])[-MAX_HISTORY_TURNS * 2:]:
            if not isinstance(item, dict):
                continue
            role = "model" if item.get("role") in ("model", "assistant", "ai") else "user"
            text = _clean_text(item.get("text"), MAX_MESSAGE_CHARS)
            if text:
                turns.append((role, text))
        while turns and turns[0][0] != "user":  # Gemini conversations must start with a user turn
            turns.pop(0)
        turns.append(("user", message))
        reply, used_model = self._generate(build_chat_system_prompt(context, code), turns, json_mode=False, temperature=0.3)
        return {"reply": reply, "lang": code, "language": name, "dir": direction, "model": used_model,
                "unverified_numbers": find_unverified_numbers(reply, [context, message])}

    def report(self, context: dict | None, lang: str | None) -> dict:
        if not isinstance(context, dict) or not context.get("valves"):
            raise AIServiceError("No farm data yet: add at least one valve/block in 'My farm' first.", 400, "missing_farm_data")
        code, name, direction = language_info(lang)
        raw, used_model = self._generate(build_report_system_prompt(context, code),
                                         [("user", "Write the farm report now as JSON.")], json_mode=True, temperature=0.25)
        report = normalize_report(parse_json_reply(raw))
        return {"report": report, "lang": code, "language": name, "dir": direction, "model": used_model,
                "unverified_numbers": find_unverified_numbers(_report_text_blob(report), context)}
