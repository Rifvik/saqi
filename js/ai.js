'use strict';
/* Saqi AI — farm chatbot + AI farm report (Gemini via server.py; the API key never reaches the browser).
 * Source of truth for every number: Saqi's own engine results (`results`, `wx`, `state`).
 * Language: whatever is selected in Saqi's existing website language picker (`curSiteLang`). */

const AI_API = 'api/ai';
const AI_CHAT_KEY = 'saqi-ai-chat-v1';
const AI_REPORT_KEY = 'saqi-ai-report-v1';
const AI_LIBS = {
  html2canvas: 'vendor/html2canvas-pro.min.js',
  jspdf: 'vendor/jspdf.umd.min.js',
};
const AI_SUGGESTIONS = [
  'How long should I water each valve tonight, and why?',
  'Is my irrigation water too salty for my crops?',
  'Why does Saqi add a salt flush, and how much?',
  'How much water am I saving compared with my fixed habit?',
  'Are there any drip clog or leak problems I should fix?',
  'What should I do before the next heatwave?',
];

const aiState = { status: null, busy: false, reportBusy: false, history: [], report: null };

/* ---------- language (reuses the existing site language picker) ---------- */
function aiLang() {
  const code = (typeof curSiteLang !== 'undefined' && curSiteLang) || 'en';
  const entry = SITE_LANGS.find(x => x[0] === code);
  return { code, name: entry ? entry[1] : code, dir: RTL_CODES.has(code) ? 'rtl' : 'ltr' };
}

/* ---------- farm context: Saqi's own calculations, rounded exactly like the dashboards ---------- */
const aiR = (n, d = 1) => (n == null || !isFinite(n)) ? null : +(+n).toFixed(d);
function buildFarmContext() {
  const loc = LOCATIONS[state.location] || LOCATIONS.alain;
  const drainage = state.drainage || 'good';
  const thr = +state.heatThreshold;
  const ctx = {
    app: 'Saqi', generated_at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    units: { volume: 'm3', depth: 'mm', salinity: 'dS/m', area: 'ha', temperature: 'degC', flow: 'm3/h', money: 'AED' },
    location: { name: loc.name, lat: aiR(loc.lat, 3), lon: aiR(loc.lon, 3) },
    weather: null,
    water: {
      ecw_dS_m: aiR(+state.water.ec), source: state.water.source || null, last_tested: state.water.tested || null,
      age_days: typeof daysSince === 'function' ? daysSince(state.water.tested) : null, cost_aed_per_m3: aiR(+state.water.cost, 2),
    },
    drainage: { class: drainage, description: DRAINAGE[drainage]?.name || drainage, max_leaching_fraction_pct: Math.round((DRAINAGE[drainage]?.maxLF || 0) * 100) },
    soil_sensor: state.sensor ? {
      soil_type: SOILS[state.sensor.soil]?.name || state.sensor.soil, raw_reading_pct: aiR(+state.sensor.reading),
      measured_soil_ece_dS_m: measuredSoilECe() == null ? null : aiR(measuredSoilECe()), soil_ece_source: state.sensor.eceSource === 'measured' ? 'measured' : 'modeled by Saqi',
      used_in_salt_flush: Boolean(state.sensor.useForFlush && measuredSoilECe()),
    } : null,
    start_time: state.startTime,
    valves: [],
    totals_week: null,
    homepage_simulator_zone_a: null,
    notes: [
      'Root-zone ECe and relative yields are modeled estimates (FAO-29 steady state + Maas-Hoffman), not measurements.',
      'Minutes are rounded to 5-minute steps exactly as shown on the Today page.',
      'SMS/WhatsApp in Saqi are previews; automated sending needs an SMS gateway.',
    ],
  };
  if (wx && wx.days) {
    ctx.weather = {
      source: wx.source, kind: wx.kind, fetched_at: wx.fetchedAt ? new Date(wx.fetchedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
      heat_threshold_c: thr,
      days: wx.days.map(d => ({ date: d.date, tmax_c: aiR(d.tmax), tmin_c: aiR(d.tmin), et0_mm: aiR(d.et0), rain_mm: aiR(d.rain), wind_kmh: aiR(d.wind, 0) })),
      heat_days: wx.days.filter(d => d.tmax >= thr).map(d => d.date),
    };
  }
  if (Array.isArray(results) && results.length) {
    ctx.valves = results.map(r => {
      const t = r.today, invalid = Boolean(t.invalidFlow);
      const mins = invalid ? null : round5(t.minutes);
      return {
        valve: r.bi + 1, name: r.b.name, crop: r.crop.name, crop_ece_threshold_dS_m: r.crop.ecThr, area_ha: r.b.area,
        stage: t.stage, system: SYSTEMS[r.b.system].name, block_flow_m3h: aiR(r.flow, 2), flow_valid: !invalid,
        tonight: {
          minutes: mins, no_water_today: !invalid && mins < 5, start_after: state.startTime,
          volume_m3: aiR(t.m3), gross_mm: aiR(t.grossMm), crop_et_mm: aiR(t.etc), kc: aiR(t.kc, 2),
          salt_flush_pct: Math.round((1 / (1 - t.LR) - 1) * 100), leaching_fraction_pct: Math.round(t.LR * 100),
          modeled_rootzone_ece_dS_m: aiR(t.modeledECe), drainage_blocked: Boolean(t.drainageBlocked),
          unsuitable_even_with_max_flush: Boolean(t.unsuitable), pre_heatwave_buffer: Boolean(t.preHeat),
        },
        fixed_habit: { minutes_per_day: r.b.habitMin, volume_m3_per_day: aiR(r.b.habitMin / 60 * r.flow) },
        week_m3: { saqi: aiR(r.weekOurs, 0), weather_only: aiR(r.weekWeatherOnly, 0), habit: aiR(r.weekHabit, 0) },
        modeled_ece_week_dS_m: { saqi: aiR(r.eo.ece), weather_only: aiR(r.ew.ece), habit: aiR(r.eh.ece) },
        est_relative_yield_pct: { saqi: Math.round(r.eo.y * 100), weather_only: Math.round(r.ew.y * 100), habit: Math.round(r.eh.y * 100) },
        salt_trend: r.eo.saltTrend, drip_flow_status: r.flags.status, drip_flow_ratio_pct: Math.round((r.flags.ratio || 1) * 100),
        tonight_minutes_likely_range: r.range && r.range.loMin != null ? [round5(r.range.loMin), round5(r.range.hiMin)] : null,
        salt_forecast_60d: r.salt ? {
          start_ece_dS_m: aiR(r.salt.startECe), start_is_assumed: r.salt.startAssumed,
          day_crosses_threshold: { saqi: r.salt.saqi.crossDay, weather_only: r.salt.wxOnly.crossDay, habit: r.salt.habit.crossDay },
          ece_day60_dS_m: { saqi: aiR(r.salt.saqi.endECe), weather_only: aiR(r.salt.wxOnly.endECe), habit: aiR(r.salt.habit.endECe) },
          water_m3: { saqi: aiR(r.salt.m3.saqi, 0), weather_only: aiR(r.salt.m3.wxOnly, 0), habit: aiR(r.salt.m3.habit, 0) },
        } : null,
      };
    });
    const tO = sum(results.map(r => r.weekOurs)), tW = sum(results.map(r => r.weekWeatherOnly)), tH = sum(results.map(r => r.weekHabit));
    const cost = +state.water.cost || 0;
    ctx.totals_week = {
      saqi_m3: aiR(tO, 0), weather_only_m3: aiR(tW, 0), habit_m3: aiR(tH, 0),
      saved_vs_habit_m3: aiR(tH - tO, 0), saved_vs_habit_pct: tH > 0 ? Math.round((tH - tO) / tH * 100) : null,
      salt_flush_extra_vs_weather_only_m3: aiR(tO - tW, 0), water_cost_saved_vs_habit_aed: aiR((tH - tO) * cost, 0),
    };
  }
  if (typeof simCond !== 'undefined' && Engine.decideZoneA) {
    const d = Engine.decideZoneA(simCond);
    ctx.homepage_simulator_zone_a = {
      description: 'Homepage what-if simulator: 2 ha drip date palms, 40 m3/h, fixed habit 240 min',
      inputs: { air_temp_c: simCond.temperature, water_ecw_dS_m: aiR(+(simCond.ecw ?? simCond.salinity)), soil_moisture_pct: simCond.moisture, humidity_pct: simCond.humidity },
      saqi_minutes: d.totalMinutes, saqi_litres: d.smartLitres, weather_only_litres: d.weatherOnlyLitres, habit_litres: d.traditionalLitres,
      salt_flush_pct: d.flushPct, est_yield_pct: { saqi: d.smartYieldPct, weather_only: d.wxYieldPct, habit: d.habitYieldPct },
    };
  }
  return ctx;
}

/* ---------- networking ---------- */
async function aiFetch(path, body, timeoutMs = 75000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${AI_API}/${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    } : { signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Saqi AI took too long to answer. Please try again.'
      : (navigator.onLine ? 'Cannot reach the Saqi AI server.' : 'You are offline. Saqi AI needs an internet connection.')), { code: 'network' });
  } finally { clearTimeout(to); }
  let data = null;
  try { data = await res.json(); } catch (e) { }
  if (!data || typeof data !== 'object') {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|)$/i.test(location.hostname);
    throw Object.assign(new Error(isLocal
      ? 'Saqi AI server is not running here. Start the app with “python server.py”.'
      : 'Saqi AI endpoint is unavailable right now. All farm calculators still work.'), { code: 'no_server' });
  }
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.error?.message || `AI request failed (${res.status}).`), { code: data.error?.code || 'ai_error' });
  }
  return data;
}

async function aiRefreshStatus() {
  const pill = $('#aiStatusPill');
  try {
    aiState.status = await aiFetch('status', null, 8000);
  } catch (e) {
    aiState.status = { configured: false, offline: true, message: e.message };
  }
  const s = aiState.status;
  if (pill) {
    if (s.offline) { pill.className = 'pill bad'; pill.textContent = 'AI server not running'; pill.title = s.message; }
    else if (s.mock) { pill.className = 'pill warn'; pill.textContent = 'Demo mode · no Gemini key'; pill.title = 'SAQI_AI_MOCK=1: demo replies'; }
    else if (s.configured) { pill.className = 'pill'; pill.textContent = `AI ready · ${s.model}`; pill.title = 'Google Gemini'; }
    else { pill.className = 'pill bad'; pill.textContent = 'AI not configured'; pill.title = 'Set GEMINI_API_KEY on the server'; }
  }
  const note = $('#aiSetupNote');
  if (note) {
    note.hidden = Boolean(s.configured);
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|)$/i.test(location.hostname);
    if (!s.configured) note.innerHTML = s.offline
      ? (isLocal
        ? '<b>AI features need the Saqi server.</b> Run <code>pip install -r requirements.txt</code>, set <code>GEMINI_API_KEY</code>, then <code>python server.py</code>. All other Saqi tools keep working without it.'
        : '<b>AI backend could not be reached right now.</b> All Saqi calculators, maps, and offline PDF tools continue working.')
      : (isLocal
        ? '<b>Gemini is not configured.</b> Add <code>GEMINI_API_KEY</code> to the server environment (or a <code>.env</code> file) and restart <code>python server.py</code>.'
        : '<b>Gemini is not configured.</b> Set <code>GEMINI_API_KEY</code> (or <code>SAQI_AI_MOCK=1</code> for demo replies) in your Vercel Environment Variables and redeploy.');
  }
  return s;
}

/* ---------- safe mini-markdown ---------- */
function aiFormat(text) {
  const lines = esc(text || '').split(/\r?\n/);
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
function aiUnverifiedNote(nums) {
  if (!nums || !nums.length) return '';
  return `<div class="ai-verify warn">⚠ ${nums.length} number(s) not found in Saqi's data: <span class="mono">${nums.slice(0, 6).map(esc).join(', ')}</span>. Check against Today's plan.</div>`;
}

/* ---------- chat ---------- */
function aiSaveSession() {
  try { sessionStorage.setItem(AI_CHAT_KEY, JSON.stringify(aiState.history.slice(-40))); } catch (e) { }
}
function aiRenderCtxBar() {
  const bar = $('#aiCtxBar'); if (!bar) return;
  const loc = (typeof LOCATIONS !== 'undefined' && LOCATIONS[state?.location]) ? LOCATIONS[state.location].name : 'Farm';
  const ecw = state?.water?.ec != null ? fmt(+state.water.ec, 1) + ' dS/m' : '–';
  const drain = state?.drainage || 'good';
  const vc = Array.isArray(state?.blocks) ? state.blocks.length : 0;
  const wxTxt = wx ? (wx.kind === 'live' ? 'Live weather' : wx.kind === 'cached' ? 'Cached forecast' : wx.kind === 'scenario' ? 'Scenario week' : 'Climate fallback') : 'Loading weather…';
  bar.innerHTML = `<span class="tag blue">📍 ${esc(loc)}</span>` +
    `<span class="tag green">${vc} valve${vc === 1 ? '' : 's'} · active FAO plan</span>` +
    `<span class="tag ${(+state?.water?.ec || 0) > 4 ? 'amber' : 'green'}">ECw ${esc(ecw)} · ${esc(drain)} drainage</span>` +
    `<span class="tag ${wx?.kind === 'clim' ? 'red' : 'blue'}">${esc(wxTxt)}</span>`;
}
function aiRenderChat() {
  aiRenderCtxBar();
  const box = $('#aiMessages'); if (!box) return;
  const L = aiLang();
  $('#aiLangNote').innerHTML = `Replies in <b class="notranslate" translate="no">${esc(L.name)}</b> — change it with the <b>Translate</b> button in the header.`;
  if (!aiState.history.length) {
    box.innerHTML = `<div class="ai-empty">Ask about tonight's watering, salt, drainage, drip health or saving water. Saqi AI uses your farm's live numbers.</div>`;
  } else {
    box.innerHTML = aiState.history.map((m, i) => {
      if (m.role === 'user') return `<div class="ai-msg user" dir="auto"><div class="ai-bubble">${esc(m.text)}</div></div>`;
      if (m.role === 'error') return `<div class="ai-msg error"><div class="ai-bubble"><b>Saqi AI could not answer.</b> ${esc(m.text)}${m.retry ? ` <button type="button" class="btn sm ghost" data-ai-retry="${i}">Retry</button>` : ''}</div></div>`;
      return `<div class="ai-msg model" dir="${m.dir || 'auto'}" lang="${esc(m.lang || 'en')}"><div class="ai-bubble notranslate" translate="no">${aiFormat(m.text)}${m.mock ? '<div class="ai-verify">Demo reply (no Gemini key)</div>' : ''}${aiUnverifiedNote(m.unverified)}</div></div>`;
    }).join('');
  }
  if (aiState.busy) box.insertAdjacentHTML('beforeend', '<div class="ai-msg model"><div class="ai-bubble ai-typing" aria-label="Saqi AI is thinking"><i></i><i></i><i></i></div></div>');
  box.scrollTop = box.scrollHeight;
  $$('[data-ai-retry]').forEach(b => b.onclick = () => {
    const i = +b.dataset.aiRetry, q = aiState.history[i]?.retry;
    aiState.history.splice(i, 1);
    if (aiState.history[i - 1]?.role === 'user' && aiState.history[i - 1].text === q) aiState.history.splice(i - 1, 1);
    aiSend(q);
  });
  const send = $('#aiSend'); if (send) send.disabled = aiState.busy;
}
async function aiSend(text) {
  text = String(text || '').trim();
  if (!text || aiState.busy) return;
  if (text.length > 2000) { toast('Please keep questions under 2000 characters.'); return; }
  const history = aiState.history.filter(m => m.role === 'user' || m.role === 'model').map(m => ({ role: m.role, text: m.text }));
  aiState.history.push({ role: 'user', text });
  aiState.busy = true; aiRenderChat();
  const L = aiLang();
  try {
    const res = await aiFetch('chat', { message: text, history, context: buildFarmContext(), lang: L.code });
    aiState.history.push({ role: 'model', text: res.reply, dir: res.dir, lang: res.lang, unverified: res.unverified_numbers, mock: res.mock });
  } catch (e) {
    aiState.history.push({ role: 'error', text: e.message, retry: text });
  } finally {
    aiState.busy = false; aiSaveSession(); aiRenderChat();
  }
}

/* ---------- report ---------- */
function aiReportHTML(res, ctx) {
  const rp = res.report, Lb = rp.labels, n = (v, d = 0) => v == null ? '–' : fmt(v, d);
  const sevLabel = s => Lb[s] || s;
  const tot = ctx.totals_week || {};
  const saved = (tot.saved_vs_habit_m3 ?? 0) >= 0;
  const et0s = (ctx.weather?.days || []).map(d => d.et0_mm).filter(v => v != null);
  const valveRows = ctx.valves.map(v => {
    const t = v.tonight;
    const tonight = !v.flow_valid ? `<span class="rp-bad">${esc(Lb.flow_not_set)}</span>` : t.no_water_today ? '0 min' : `${n(t.minutes)} min · ${esc(t.start_after)}`;
    return `<tr><td>${v.valve}</td><td>${esc(v.name)}<br><small>${esc(v.crop)} · ${n(v.area_ha, 2)} ha</small></td><td>${tonight}</td><td class="num">${n(t.volume_m3, 1)} m³</td>
      <td class="num">+${n(t.salt_flush_pct)}%</td><td class="num">${n(t.modeled_rootzone_ece_dS_m, 1)} <small>(${n(v.crop_ece_threshold_dS_m, 1)})</small></td>
      <td class="num">${n(v.week_m3.saqi)} / ${n(v.week_m3.weather_only)} / ${n(v.week_m3.habit)}</td><td class="num">${n(v.est_relative_yield_pct.saqi)}%</td></tr>`;
  }).join('');
  const cropCards = ctx.valves.map(v => {
    const ai = rp.crops.find(c => c.valve === v.valve) || {};
    return `<div class="rp-crop"><div class="rp-crop-head">${esc(Lb.valve)} ${v.valve} · ${esc(v.name)} <small>(${esc(v.crop)})</small></div>
      ${ai.insight ? `<p>${aiFormat(ai.insight)}</p>` : ''}${ai.recommendation ? `<p><b>${esc(Lb.recommendation)}:</b> ${esc(ai.recommendation)}</p>` : ''}</div>`;
  }).join('');
  const wxRows = (ctx.weather?.days || []).map(d => `<tr><td>${esc(d.date)}</td><td class="num">${n(d.tmax_c)}° / ${n(d.tmin_c)}°</td><td class="num">${n(d.et0_mm, 1)} mm</td><td class="num">${n(d.rain_mm, 1)} mm</td><td class="num">${n(d.wind_kmh)} km/h</td></tr>`).join('');
  const section = (key, body) => `<section class="rp-block"><h2>${esc(Lb[key])}</h2>${body}</section>`;
  return `<article class="ai-report notranslate" id="aiReportDoc" translate="no" dir="${res.dir}" lang="${esc(res.lang)}">
    <header class="rp-block rp-head">
      <div class="rp-brand">saqi<span>.</span> <small>AI</small></div>
      <h1>${esc(rp.title)}</h1>
      <div class="rp-meta">${esc(Lb.location)}: <b>${esc(ctx.location.name)}</b> · ${esc(Lb.generated)}: ${esc(ctx.generated_at)} · ${esc(Lb.language)}: ${esc(res.language)} · Gemini: ${esc(res.model)}${res.mock ? ' (demo)' : ''}</div>
    </header>
    <section class="rp-block"><h2>${esc(Lb.key_numbers)}</h2>
      <div class="rp-kpis">
        <div><span>${esc(Lb.week_saqi)}</span><b>${n(tot.saqi_m3)} m³</b></div>
        <div><span>${esc(Lb.week_weather_only)}</span><b>${n(tot.weather_only_m3)} m³</b></div>
        <div><span>${esc(Lb.week_habit)}</span><b>${n(tot.habit_m3)} m³</b></div>
        <div class="${saved ? 'rp-good' : 'rp-warn'}"><span>${esc(Lb.water_usage)}</span><b>${saved ? '−' : '+'}${n(Math.abs(tot.saved_vs_habit_m3 ?? 0))} m³ (${saved ? '' : '+'}${n(Math.abs(tot.saved_vs_habit_pct ?? 0))}%)</b></div>
        <div><span>${esc(Lb.water_ecw)}</span><b>${n(ctx.water.ecw_dS_m, 1)} dS/m</b></div>
        <div><span>${esc(Lb.drainage)}</span><b>${esc(ctx.drainage.class)} · LF ≤ ${n(ctx.drainage.max_leaching_fraction_pct)}%</b></div>
        ${et0s.length ? `<div><span>ET₀</span><b>${n(Math.min(...et0s), 1)}–${n(Math.max(...et0s), 1)} mm/d</b></div>` : ''}
      </div>
      ${rp.summary ? `<div class="rp-summary">${aiFormat(rp.summary)}</div>` : ''}
    </section>
    ${section('farm_overview', aiFormat(rp.overview))}
    ${section('environment', aiFormat(rp.environment) + (wxRows ? `<table class="rp-table"><tr><th>📅</th><th class="num">°C</th><th class="num">ET₀</th><th class="num">🌧</th><th class="num">💨</th></tr>${wxRows}</table><p class="rp-small">${esc(Lb.weather_source)}: ${esc(ctx.weather?.source || '–')}</p>` : ''))}
    ${section('crop_irrigation', `<table class="rp-table"><tr><th>${esc(Lb.valve)}</th><th>${esc(Lb.crop)}</th><th>${esc(Lb.tonight)}</th><th class="num">${esc(Lb.volume_today)}</th><th class="num">${esc(Lb.salt_flush)}</th><th class="num">${esc(Lb.modeled_ece)}</th><th class="num">${esc(Lb.week_saqi)} / ${esc(Lb.week_weather_only)} / ${esc(Lb.week_habit)} (m³)</th><th class="num">${esc(Lb.est_yield)}</th></tr>${valveRows}</table>${cropCards}`)}
    ${section('salinity', aiFormat(rp.salinity))}
    ${section('water_usage', aiFormat(rp.water_usage))}
    ${section('risks', `<ul class="rp-risks">${rp.risks.map(r => `<li><span class="rp-sev ${r.severity}">${esc(sevLabel(r.severity))}</span> <b>${esc(r.risk)}</b><br><span>${esc(Lb.prevention)}: ${esc(r.prevention)}</span></li>`).join('')}</ul>`)}
    ${section('recommendations', `<ol class="rp-recs">${rp.recommendations.map(r => `<li><b>${esc(r.action)}</b><br><span>${esc(Lb.why)}: ${esc(r.why)}</span></li>`).join('')}</ol>`)}
    <footer class="rp-block rp-foot">
      ${rp.disclaimer ? `<p><b>${esc(Lb.disclaimer)}:</b> ${esc(rp.disclaimer)}</p>` : ''}
      <p>${esc(Lb.numbers_note)}</p>
      ${res.unverified_numbers?.length ? `<p class="rp-warn-text">⚠ ${res.unverified_numbers.length} × ? : ${res.unverified_numbers.slice(0, 8).map(esc).join(', ')}</p>` : ''}
    </footer>
  </article>`;
}
function aiRenderReport() {
  const out = $('#aiReportOut'); if (!out) return;
  const rep = aiState.report;
  $('#aiPdfBtn').disabled = $('#aiPrintBtn').disabled = !rep;
  if (!rep) { out.innerHTML = '<p class="muted">Your report preview will appear here.</p>'; return; }
  const L = aiLang();
  const langNote = rep.res.lang !== L.code ? `<div class="alert amber" style="margin-bottom:.75rem"><span class="alert-body">This report was generated in <b class="notranslate" translate="no">${esc(rep.res.language)}</b>. Generate again to get it in <b class="notranslate" translate="no">${esc(L.name)}</b>.</span></div>` : '';
  out.innerHTML = langNote + aiUnverifiedNote(rep.res.unverified_numbers) + `<div class="ai-report-wrap">${aiReportHTML(rep.res, rep.ctx)}</div>`;
}
async function aiGenerateReport() {
  if (aiState.reportBusy) return;
  const ctx = buildFarmContext();
  const st = $('#aiReportStatus');
  if (!ctx.valves.length) { st.innerHTML = '<span class="bad">No farm data yet — add a valve in My farm and wait for the forecast to load.</span>'; return; }
  aiState.reportBusy = true; const btn = $('#aiReportBtn'); btn.disabled = true;
  const L = aiLang();
  st.innerHTML = `<span class="ai-spinner"></span> Writing your report in <b class="notranslate" translate="no">${esc(L.name)}</b>… (10–30 s)`;
  try {
    const res = await aiFetch('report', { context: ctx, lang: L.code }, 120000);
    aiState.report = { res, ctx };
    try { sessionStorage.setItem(AI_REPORT_KEY, JSON.stringify(aiState.report)); } catch (e) { }
    st.innerHTML = `<span class="good">✓ Report ready.</span>`;
    aiRenderReport();
  } catch (e) {
    st.innerHTML = `<span class="bad">${esc(e.message)}</span>`;
  } finally {
    aiState.reportBusy = false; btn.disabled = false;
  }
}

/* ---------- PDF ---------- */
function aiLoadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load the PDF library (internet needed).'));
    document.head.appendChild(s);
  });
}
async function aiBuildPdf() {
  const el = $('#aiReportDoc'); if (!el) throw new Error('Generate a report first.');
  await aiLoadScript(AI_LIBS.html2canvas); await aiLoadScript(AI_LIBS.jspdf);
  const h2c = window.html2canvas || window.html2canvasPro;
  if (!h2c || !window.jspdf) throw new Error('PDF library failed to initialise.');
  if (document.fonts?.ready) await document.fonts.ready;
  const scale = 2;
  const canvas = await h2c(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: Math.max(900, el.scrollWidth) });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const margin = 10, pageW = 210, pageH = 297, contentW = pageW - margin * 2, contentH = pageH - margin * 2;
  const pxPerMm = canvas.width / contentW, pageHpx = Math.floor(contentH * pxPerMm);
  // Prefer page breaks between report blocks / table rows so text lines are never cut.
  const top0 = el.getBoundingClientRect().top;
  const breaks = [...el.querySelectorAll('.rp-block, .rp-table tr, .rp-crop, .rp-risks li, .rp-recs li, p')]
    .map(b => Math.round((b.getBoundingClientRect().top - top0) * scale)).filter(y => y > 0).sort((a, b) => a - b);
  let y = 0, page = 0;
  while (y < canvas.height - 2) {
    let end = Math.min(y + pageHpx, canvas.height);
    if (end < canvas.height) {
      const cand = breaks.filter(b => b > y + pageHpx * 0.55 && b <= end);
      if (cand.length) end = cand[cand.length - 1];
    }
    const slice = document.createElement('canvas'); slice.width = canvas.width; slice.height = end - y;
    const sctx = slice.getContext('2d'); sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
    sctx.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, contentW, (end - y) / pxPerMm);
    pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`Saqi AI report · ${page + 1}`, pageW - margin, pageH - 4, { align: 'right' });
    y = end; page++;
  }
  pdf.setProperties({ title: aiState.report?.res?.report?.title || 'Saqi AI Farm Report', creator: 'Saqi', subject: 'Farm report' });
  return pdf;
}
async function aiDownloadPdf() {
  const btn = $('#aiPdfBtn'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Building PDF…';
  try {
    const pdf = await aiBuildPdf();
    const lang = aiState.report?.res?.lang || 'en';
    pdf.save(`saqi-farm-report-${new Date().toISOString().slice(0, 10)}-${lang}.pdf`);
    toast('PDF downloaded');
  } catch (e) {
    toast(e.message + ' Use “Print / Save as PDF” instead.');
  } finally { btn.disabled = false; btn.textContent = old; }
}
function aiPrintReport() {
  if (!$('#aiReportDoc')) return;
  document.documentElement.classList.add('printing-report');
  const done = () => { document.documentElement.classList.remove('printing-report'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}

/* ---------- wiring ---------- */
function aiOnShow() { aiRefreshStatus(); aiRenderChat(); aiRenderReport(); }
function initAI() {
  if (!$('#assistant')) return;
  try { aiState.history = JSON.parse(sessionStorage.getItem(AI_CHAT_KEY)) || []; } catch (e) { aiState.history = []; }
  try { aiState.report = JSON.parse(sessionStorage.getItem(AI_REPORT_KEY)) || null; } catch (e) { aiState.report = null; }
  $('#aiSuggest').innerHTML = AI_SUGGESTIONS.map(q => `<button type="button" class="ai-chip">${esc(q)}</button>`).join('');
  $$('#aiSuggest .ai-chip').forEach(b => b.onclick = () => aiSend(b.textContent));
  const input = $('#aiInput');
  $('#aiForm').onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ''; aiSend(v); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); } });
  $('#aiClear').onclick = () => { aiState.history = []; aiSaveSession(); aiRenderChat(); };
  $('#aiReportBtn').onclick = aiGenerateReport;
  $('#aiPdfBtn').onclick = aiDownloadPdf;
  $('#aiPrintBtn').onclick = aiPrintReport;
  $('#aiFab')?.addEventListener('click', () => { showTab('assistant'); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => input.focus(), 350); });
  document.addEventListener('saqi:langchange', () => { aiRenderChat(); aiRenderReport(); });
  aiRenderChat(); aiRenderReport();
  if ($('#assistant').classList.contains('active')) aiRefreshStatus();
}
initAI();
