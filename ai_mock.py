"""Offline-safe demo client for Saqi AI (used ONLY when SAQI_AI_MOCK=1 and no GEMINI_API_KEY is set).

It never calls the network. Replies are deterministic and quote numbers straight from FARM_DATA,
so the chatbot / report UI, RTL layout and PDF export can be exercised end-to-end without a key.
Every reply is clearly marked as demo output.
"""
from __future__ import annotations

import json

# Small fixed label sets so RTL / complex-script rendering can be tested in the UI and PDF.
_DEMO_LABELS = {
    "ar": {"report_title": "تقرير ساقي الزراعي (عرض تجريبي)", "farm_overview": "نظرة عامة على المزرعة",
           "environment": "الظروف البيئية", "crop_irrigation": "احتياجات الري لكل محصول",
           "salinity": "تحليل ملوحة التربة والمياه", "water_usage": "استهلاك المياه والتوفير",
           "risks": "المخاطر والوقاية", "recommendations": "التوصيات حسب الأولوية", "valve": "الصمام",
           "crop": "المحصول", "tonight": "الليلة", "volume_today": "مياه اليوم"},
    "ur": {"report_title": "ساقی فارم رپورٹ (ڈیمو)", "farm_overview": "فارم کا جائزہ",
           "environment": "ماحولیاتی حالات", "crop_irrigation": "ہر فصل کی آبپاشی",
           "salinity": "مٹی اور پانی کی نمکیات", "water_usage": "پانی کا استعمال اور بچت",
           "risks": "خطرات اور احتیاط", "recommendations": "ترجیحی سفارشات", "valve": "والو", "crop": "فصل"},
    "hi": {"report_title": "साक़ी फ़ार्म रिपोर्ट (डेमो)", "farm_overview": "फ़ार्म का सारांश",
           "environment": "पर्यावरण की स्थिति", "crop_irrigation": "फ़सल-वार सिंचाई",
           "salinity": "मिट्टी और पानी की लवणता", "water_usage": "पानी का उपयोग और बचत",
           "risks": "जोखिम और बचाव", "recommendations": "प्राथमिक सुझाव", "valve": "वाल्व", "crop": "फ़सल"},
    "bn": {"report_title": "সাকি খামার রিপোর্ট (ডেমো)", "farm_overview": "খামারের সারসংক্ষেপ",
           "salinity": "মাটি ও পানির লবণাক্ততা", "risks": "ঝুঁকি ও প্রতিরোধ", "valve": "ভালভ", "crop": "ফসল"},
}
_DEMO_PREFIX = {
    "ar": "عرض تجريبي (بدون مفتاح Gemini):", "ur": "ڈیمو جواب (Gemini کلید کے بغیر):",
    "hi": "डेमो उत्तर (Gemini कुंजी के बिना):", "bn": "ডেমো উত্তর (Gemini কী ছাড়া):",
}


class _Resp:
    def __init__(self, text: str):
        self.text = text


def _cfg(config, name):
    return config.get(name) if isinstance(config, dict) else getattr(config, name, None)


def _farm_data(system_prompt: str) -> dict:
    marker = "FARM_DATA (current, from Saqi):\n"
    i = system_prompt.find(marker)
    if i == -1:
        return {}
    try:
        return json.loads(system_prompt[i + len(marker):])
    except json.JSONDecodeError:
        return {}


def _lang(system_prompt: str) -> str:
    i = system_prompt.find("(language code '")
    return system_prompt[i + 16:system_prompt.find("'", i + 16)] if i != -1 else "en"


class _Models:
    def generate_content(self, model, contents, config):
        system = _cfg(config, "system_instruction") or ""
        data, lang = _farm_data(system), _lang(system)
        valves = data.get("valves") or []
        totals = data.get("totals_week") or {}
        prefix = _DEMO_PREFIX.get(lang, "[Demo reply – no Gemini key configured]")
        if _cfg(config, "response_mime_type") == "application/json":
            crops = []
            for v in valves:
                t = v.get("tonight") or {}
                if v.get("flow_valid") is False:
                    rec = "Block flow is not set, so Saqi cannot calculate minutes. Enter the block flow in My farm."
                else:
                    rec = f"Run {t.get('minutes')} min after {data.get('start_time')} ({t.get('volume_m3')} m3)."
                crops.append({"valve": v.get("valve"), "insight": f"{prefix} {v.get('crop')} · {v.get('stage')}.",
                              "recommendation": rec})
            report = {
                "title": _DEMO_LABELS.get(lang, {}).get("report_title", "Saqi AI Farm Report (demo)"),
                "labels": _DEMO_LABELS.get(lang, {}),
                "summary": f"{prefix} 7-day Saqi plan {totals.get('saqi_m3')} m3 vs fixed habit {totals.get('habit_m3')} m3.",
                "overview": f"{(data.get('location') or {}).get('name')} · {len(valves)} valves.",
                "environment": str((data.get("weather") or {}).get("source")),
                "crops": crops,
                "salinity": f"Water ECw {(data.get('water') or {}).get('ecw_dS_m')} dS/m · drainage {(data.get('drainage') or {}).get('class')}.",
                "water_usage": f"Saqi {totals.get('saqi_m3')} m3 · weather-only {totals.get('weather_only_m3')} m3 · habit {totals.get('habit_m3')} m3.",
                "risks": [{"risk": "Salt build-up if flushing is skipped", "severity": "medium",
                           "prevention": "Keep the salt flush Saqi calculates and re-test water EC monthly."}],
                "recommendations": [{"priority": 1, "action": "Follow tonight's valve runtimes",
                                     "why": "They combine crop water need and salt flush."}],
                "disclaimer": "Demo output generated without Gemini. Modeled values are estimates.",
            }
            return _Resp(json.dumps(report, ensure_ascii=False))
        question = ""
        for c in contents or []:
            parts = c.get("parts") if isinstance(c, dict) else getattr(c, "parts", [])
            for p in parts or []:
                question = (p.get("text") if isinstance(p, dict) else getattr(p, "text", "")) or question
        lines = [prefix, f"You asked: “{question[:120]}”"]
        for v in valves[:4]:
            t = v.get("tonight") or {}
            if v.get("flow_valid") is False:
                lines.append(f"- Valve {v.get('valve')} ({v.get('crop')}): set block flow first.")
            else:
                lines.append(f"- Valve {v.get('valve')} ({v.get('crop')}): {t.get('minutes')} min, {t.get('volume_m3')} m3, "
                             f"salt flush +{t.get('salt_flush_pct')}%.")
        return _Resp("\n".join(lines))


class MockGeminiClient:
    def __init__(self):
        self.models = _Models()
