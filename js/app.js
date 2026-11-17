'use strict';
/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (n, d = 0) => (isFinite(n) ? Number(n) : 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const sum = a => a.reduce((x, y) => x + y, 0);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round5 = m => Math.round(m / 5) * 5;
const pct = x => fmt(x * 100) + '%';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3800); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }

/* ---------- state ---------- */
const STORE_KEY = 'saqi-state-v2';
function demoFlowLog(blocks) {
  const r = seeded(42);
  return blocks.map((b, bi) => Array.from({ length: 14 }, (_, d) => {
    let f = b.flow * (1 + (r() - 0.5) * 0.05);
    if (bi === 1 && d >= 8) f = b.flow * (1 - 0.045 * (d - 7)); // tomato line: emitters slowly clogging
    if (bi === 2 && d === 13) f = b.flow * 1.24;                // forage line: burst lateral today
    return { date: isoDaysAgo(13 - d), flow: +f.toFixed(1) };
  }));
}
function defaultState() {
  const blocks = [
    { name: 'Date palms – north', crop: 'date', area: 2.0, planted: isoDaysAgo(0), system: 'drip', flowMode: 'direct', emitterLph: 8, emitterCount: 5000, flow: 40, habitMin: 240 },
    { name: 'Tomato – open field', crop: 'tomato', area: 0.5, planted: isoDaysAgo(55), system: 'drip', flowMode: 'emitters', emitterLph: 4, emitterCount: 3000, flow: 12, habitMin: 240 },
    { name: 'Forage grass', crop: 'bermuda', area: 1.0, planted: isoDaysAgo(0), system: 'sprinkler', flowMode: 'direct', emitterLph: 4, emitterCount: 10000, flow: 40, habitMin: 150 },
    { name: 'Cucumber – shade house', crop: 'cucumber', area: 0.3, planted: isoDaysAgo(20), system: 'drip', flowMode: 'emitters', emitterLph: 4, emitterCount: 2000, flow: 8, habitMin: 90 },
  ];
  return {
    v: 1, location: 'alain', scenario: 'live',
    water: { ec: 3.0, cost: 2.0, source: 'measured (EC pen)', tested: isoDaysAgo(7) },
    drainage: 'good', heatThreshold: 45, startTime: '21:00', lang: 'ur',
    blocks, flowLog: demoFlowLog(blocks),
    blend: { a: { name: 'Desalinated (RO)', ec: 0.4, cost: 5.0 }, b: { name: 'Brackish well', ec: 9.0, cost: 0.5, max: 200 }, block: 1 },
    sensor: { soil: 'sand', reading: 9.5, ece: 8, k: 0.35, depth: 40, tested: isoDaysAgo(3), useForFlush: false, eceSource: 'modeled', block: 0 },
    share: { cap: 400, pump: 25, price: 1.5, link: true, farms: [
      { name: 'My farm', share: 25, need: 150 }, { name: 'Al Kaabi farm', share: 25, need: 60 }, { name: 'Rashid farm', share: 20, need: 140 },
      { name: 'Hamad farm', share: 15, need: 30 }, { name: 'Saeed farm', share: 15, need: 110 }] },
    planner: { system: 'drip', avail: 80, current: 'alfalfa' },
  };
}
/* Soil ECe the farmer actually measured (null when Saqi is modelling it instead). */
function measuredSoilECe() { return state.sensor?.eceSource === 'measured' && +state.sensor.ece > 0 ? +state.sensor.ece : null; }
function load() {
  const def = defaultState();
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 1) {
      const merged = Object.assign({}, def, s);
      merged.water = Object.assign({}, def.water, s.water);
      merged.sensor = Object.assign({}, def.sensor, s.sensor);
      merged.blocks = (s.blocks || def.blocks).map(b => Object.assign({ flowMode: 'direct', emitterLph: 4, emitterCount: Math.round((b.flow || 10) * 1000 / 4) }, b));
      return merged;
    }
  } catch (e) { }
  return def;
}
let state = load();
if (state.customLoc) LOCATIONS.custom = state.customLoc;
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { } }
let wx = null;
let results = [];

/* ---------- weather ---------- */
function scenarioDays(kind) {
  const s = SCENARIOS[kind];
  return s.tmax.map((_, i) => ({ date: isoDaysAgo(-i), tmax: s.tmax[i], tmin: s.tmin[i], et0: s.et0[i], wind: s.wind[i], rain: s.rain[i] }));
}
function doy(dateStr) { const d = new Date(dateStr + 'T12:00'); return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
const HG_BIAS_KEY = 'saqi-hg-bias-';
function hgBias() { try { const v = +localStorage.getItem(HG_BIAS_KEY + state.location); return v > 0 ? v : null; } catch (e) { return null; } }
function climatologyDays(loc) {
  const k = hgBias() || 1; // local Hargreaves→Penman-Monteith calibration learned from past live forecasts
  return Array.from({ length: 7 }, (_, i) => {
    const date = isoDaysAgo(-i); const m = new Date(date + 'T12:00').getMonth();
    const tmax = CLIMATE.tmax[m], tmin = CLIMATE.tmin[m];
    return { date, tmax, tmin, et0: +(k * Engine.hargreavesET0(tmax, tmin, loc.lat, doy(date))).toFixed(1), wind: 15, rain: 0 };
  });
}
const climSuffix = () => hgBias() ? ` (calibrated ×${hgBias().toFixed(2)} to past live forecasts here)` : '';
let simOffline = false;
try { simOffline = sessionStorage.getItem('saqi-sim-offline') === '1'; } catch (e) { }
let expandWhyIdx = null;
let voiceValveFilter = 'all';
let showWorkerQr = false;
let simFromLive = false;

async function loadWeather(force) {
  const loc = LOCATIONS[state.location] || LOCATIONS.alain;
  if (state.scenario !== 'live') { wx = { source: SCENARIOS[state.scenario].label, kind: 'scenario', days: scenarioDays(state.scenario) }; return; }
  const key = 'saqi-wx-' + state.location + '-' + loc.lat.toFixed(2) + '-' + loc.lon.toFixed(2);
  let cached = null; try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { }
  if (simOffline || !navigator.onLine) {
    const prefix = simOffline ? 'Airplane-mode test' : 'Offline';
    if (cached) wx = { ...cached, kind: 'cached', source: `${prefix}: using forecast saved ${new Date(cached.fetchedAt).toLocaleString('en-GB')}` };
    else wx = { source: `${prefix}, no saved forecast: using climate normals + Hargreaves ET₀ (works with zero internet)${climSuffix()}`, kind: 'clim', days: climatologyDays(loc) };
    return;
  }
  if (!force && cached && Date.now() - cached.fetchedAt < 3 * 3600e3) { wx = { ...cached, kind: 'live' }; return; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=7`;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(to);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = (await r.json()).daily;
    const days = d.time.map((t, i) => ({ date: t, tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], et0: d.et0_fao_evapotranspiration[i], rain: d.precipitation_sum[i] || 0, wind: d.wind_speed_10m_max[i] }));
    wx = { source: 'Live forecast for ' + loc.name + ' (Open-Meteo, FAO-56 Penman-Monteith ET₀)', fetchedAt: Date.now(), days, kind: 'live' };
    try { localStorage.setItem(key, JSON.stringify(wx)); } catch (e) { }
    const bias = Engine.hargreavesBias(days, loc.lat);
    if (bias) try { localStorage.setItem(HG_BIAS_KEY + state.location, bias.toFixed(3)); } catch (e) { }
  } catch (e) {
    if (cached) wx = { ...cached, kind: 'cached', source: 'Offline: using forecast saved ' + new Date(cached.fetchedAt).toLocaleString('en-GB') };
    else wx = { source: 'Offline, no saved forecast: using climate normals + Hargreaves ET₀ (works with zero internet)' + climSuffix(), kind: 'clim', days: climatologyDays(loc) };
  }
}
function updateNet() {
  const p = $('#netPill'); const on = navigator.onLine && !simOffline;
  let txt = on ? '● Online' : (simOffline ? '✈️ Airplane mode' : '● Offline'), cls = on ? 'ok' : 'warn';
  if (wx && wx.kind === 'cached') { txt = simOffline ? '✈️ Airplane mode · saved' : '● Offline · saved forecast'; cls = 'warn'; }
  if (wx && wx.kind === 'clim') { txt = simOffline ? '✈️ Airplane mode · Hargreaves' : '● Offline · climate backup'; cls = 'bad'; }
  if (wx && wx.kind === 'scenario' && !simOffline) { txt = '● Scenario data'; cls = ''; }
  if (p) { p.textContent = txt; p.className = 'pill ' + cls; }
  const chip = $('#todayOfflineChip');
  if (chip) {
    const isOfflineView = simOffline || !navigator.onLine || (wx && (wx.kind === 'cached' || wx.kind === 'clim'));
    chip.hidden = !isOfflineView;
    if (isOfflineView) {
      chip.className = 'pill ' + (wx?.kind === 'clim' ? 'warn' : 'ok');
      chip.textContent = simOffline
        ? (wx?.kind === 'cached' ? '✈️ Airplane mode · Cached forecast' : '✈️ Airplane mode · Zero-network ET₀')
        : (wx?.kind === 'cached' ? '📶 Offline · Cached forecast' : '📶 Offline · Climate ET₀ backup');
    }
  }
}

/* ---------- core computation ---------- */
function dayOf(block, offset = 0) {
  if (CROPS[block.crop].perennial) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(block.planted + 'T00:00').getTime()) / 864e5) + offset);
}
function weeklyRevenue(crop, area, nDays) { return crop.yield * 1000 * crop.price / Engine.seasonLength(crop) * nDays * area; }
function computeAll() {
  const ecw = Math.min(25, Math.max(0, +state.water.ec || 0)); const n = wx.days.length; const thr = +state.heatThreshold; // ECw clamped to EC-pen range 0–25 dS/m
  const drainage = state.drainage || 'good';
  const prevECe = measuredSoilECe();
  const soilForFlush = state.sensor?.useForFlush ? prevECe : null;
  return state.blocks.map((b, bi) => {
    const crop = CROPS[b.crop];
    const flow = Engine.resolveBlockFlow(b);
    const daily = wx.days.map((d, i) => {
      const preHeat = Boolean(d.tmax < thr && wx.days[i + 1] && wx.days[i + 1].tmax >= thr);
      return Engine.blockDecision({ ...b, flow, day: dayOf(b, i) }, crop, d, ecw, preHeat, drainage, soilForFlush);
    });
    const weatherDaily = wx.days.map((d, i) => Engine.weatherOnlyDecision({ ...b, flow, day: dayOf(b, i) }, crop, d));
    const weekOurs = sum(daily.map(x => x.m3));
    const weekWeatherOnly = sum(weatherDaily.map(x => x.m3));
    const weekHabit = n * b.habitMin / 60 * flow;
    const netWeek = sum(daily.map(x => x.netNeed));
    const salt = saltProjection(b, crop, flow, daily, ecw, drainage);
    const wk = f => { const pts = f.series.slice(0, n); return { ece: pts[pts.length - 1].ece, ys: sum(pts.map(p => p.y)) / pts.length, startECe: salt.startECe }; };
    const eo = Engine.evaluate(crop, b, weekOurs, netWeek, ecw, drainage, prevECe, wk(salt.saqi));
    const ew = Engine.evaluate(crop, b, weekWeatherOnly, netWeek, ecw, drainage, prevECe, wk(salt.wxOnly));
    const eh = Engine.evaluate(crop, b, weekHabit, netWeek, ecw, drainage, prevECe, wk(salt.habit));
    const rev = weeklyRevenue(crop, b.area, n);
    const flags = Engine.flowCheck(state.flowLog[bi], flow);
    const uEt = (typeof UNCERTAINTY !== 'undefined' && UNCERTAINTY.et0[wx.kind]) || 0.15;
    const range = Engine.runtimeRange({ ...b, flow, day: dayOf(b, 0) }, crop, wx.days[0], ecw,
      { uEt, preHeat: Boolean(wx.days[0].tmax < thr && wx.days[1] && wx.days[1].tmax >= thr), drainage, soilECe: soilForFlush });
    return { b, bi, crop, flow, today: daily[0], daily, weatherDaily, weekOurs, weekWeatherOnly, weekHabit, netWeek, eo, ew, eh, rev, flags, range, salt };
  });
}

/* 60-day transient salt projection for three strategies: forecast days first, then monthly climate ET₀. */
const SALT_HORIZON = 60;
function saltProjection(b, crop, flow, daily, ecw, drainage) {
  const Ea = SYSTEMS[b.system].eff;
  const wxDays = Array.from({ length: SALT_HORIZON }, (_, i) => {
    if (wx.days[i]) return wx.days[i];
    const scenMonth = { july: 6, nov: 10 }[state.scenario]; // synthetic weeks continue with their own season
    const m = scenMonth != null ? (scenMonth + Math.floor(i / 30)) % 12 : new Date(isoDaysAgo(-i) + 'T12:00').getMonth();
    return { et0: CLIMATE.et0[m], rain: 0 };
  });
  const etc = [], saqi = [], wxOnly = [], habit = [];
  const habitMm = b.area > 0 ? b.habitMin / 60 * flow / (b.area * 10) * Ea : 0;
  wxDays.forEach((d, i) => {
    const dec = daily[i] || Engine.blockDecision({ ...b, flow, day: dayOf(b, i) }, crop, d, ecw, false, drainage);
    etc.push(dec.netNeed);
    saqi.push(dec.grossMm * dec.Ea);
    wxOnly.push(dec.netNeed);
    habit.push(habitMm);
  });
  const sensorOn = Boolean(state.sensor?.useForFlush && measuredSoilECe());
  const startECe = sensorOn ? +state.sensor.ece : +(crop.ecThr * 0.8).toFixed(2);
  const run = applied => Engine.saltForecast({ crop, ecw, startECe, applied, etc, drainage, fcPct: (SOILS[state.sensor?.soil] || SOILS.sand).fc });
  const m3 = arr => sum(arr) / Ea * b.area * 10;
  return { startECe, startAssumed: !sensorOn, saqi: run(saqi), wxOnly: run(wxOnly), habit: run(habit),
           m3: { saqi: m3(saqi), wxOnly: m3(wxOnly), habit: m3(habit) } };
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = Math.round((Date.now() - new Date(dateStr + 'T00:00').getTime()) / 864e5);
  return isFinite(d) ? Math.max(0, d) : null;
}

/* ---------- Today ---------- */
function weatherEmoji(day, heatThreshold = 45) {
  if (!day) return '☀️';
  if ((day.rain || 0) > 0.2) return '🌧️';
  if (day.tmax >= heatThreshold + 3) return '🔥';
  if (day.tmax >= heatThreshold || day.tmax >= 33) return '☀️';
  if (day.tmax >= 27) return '🌤️';
  return '⛅';
}

function renderToday() {
  results = computeAll();
  const thr = +state.heatThreshold; const ecw = +state.water.ec;
  const drainage = state.drainage || 'good';
  const locObj = LOCATIONS[state.location] || LOCATIONS.alain;
  const startHr = parseInt(String(state.startTime || '21:00').split(':')[0], 10);
  const isNightWindow = !isNaN(startHr) && (startHr >= 17 || startHr <= 5);

  $('#wxSource').innerHTML = `${esc(wx.source)} · ECw <b class="mono">${fmt(ecw, 1)} dS/m</b> · ${drainage} drainage`;
  const rb = $('#refreshWx'); if (rb) rb.style.display = wx.kind === 'live' ? '' : 'none';
  const np = $('#todayNightPill'), nt = $('#todayNightTime');
  if (np && nt) { np.hidden = !isNightWindow; nt.textContent = `After ${state.startTime}`; }

  // Data confidence & provenance (compact summary outside + full tags inside details)
  const wxShort = wx.kind === 'live' ? 'Live weather' : wx.kind === 'cached' ? 'Cached forecast' : wx.kind === 'scenario' ? 'Synthetic demo' : 'Climate fallback';
  const wxConf = wx.kind === 'live'
    ? `<span class="tag green">Weather: Live Open-Meteo · updated ${wx.fetchedAt ? new Date(wx.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'today'} (high confidence)</span>`
    : wx.kind === 'cached'
      ? `<span class="tag amber">Weather: Cached forecast · ${wx.fetchedAt ? new Date(wx.fetchedAt).toLocaleString('en-GB') : 'saved'} (medium)</span>`
      : wx.kind === 'scenario'
        ? `<span class="tag amber">Weather: Synthetic scenario (demo mode)</span>`
        : `<span class="tag red">Weather: Hargreaves climate fallback (±15% ET₀ uncertainty)</span>`;
  const hargToday = wx.days[0] ? fmt(Engine.hargreavesET0(wx.days[0].tmax, wx.days[0].tmin, locObj.lat, doy(wx.days[0].date)), 1) + ' mm' : '–';
  const ecAge = daysSince(state.water.tested);
  const ecStale = ecAge == null || ecAge > 30 || (state.water.source || '').startsWith('estimated');
  const ecConf = `<span class="tag ${ecStale ? 'amber' : 'green'}">Water ECw: ${fmt(ecw, 1)} dS/m · ${esc(state.water.source || 'measured')}${ecAge != null ? ` · ${ecAge === 0 ? 'today' : ecAge + 'd ago'}` : ''}${ecStale ? ' (verify soon)' : ''}</span>`;
  const drainConf = `<span class="tag ${drainage === 'poor' ? 'red' : drainage === 'moderate' ? 'amber' : 'blue'}">Soil ECe: modeled FAO-29 salt balance (${drainage} drainage)${measuredSoilECe() ? ` · Measured ${fmt(measuredSoilECe(), 1)} dS/m (${state.sensor.useForFlush ? 'used in tonight’s flush' : 'monitor only'})` : ''}</span>`;
  const flowBad = results.some(r => r.flags.status !== 'ok' || r.today.invalidFlow);
  const flowConf = `<span class="tag ${flowBad ? 'red' : 'blue'}">Flow: ${flowBad ? 'check flow / pipes' : 'synthetic 14d meter baseline'} · Hargreaves backup ET₀ ${hargToday}</span>`;
  $('#dataConfidence').innerHTML = wxConf + ecConf + drainConf + flowConf;
  if ($('#todayConfBrief')) {
    $('#todayConfBrief').textContent = `${wxShort} · ECw ${fmt(ecw, 1)} dS/m (${ecAge === 0 ? 'today' : ecAge != null ? ecAge + 'd' : 'est.'}) · Soil modeled${flowBad ? ' · Flow notice' : ''}`;
  }

  // Band 2: Clean 7-day weather strip with weatherEmoji
  $('#forecast').innerHTML = wx.days.map((d, i) => {
    const hot = d.tmax >= thr; const dt = new Date(d.date + 'T12:00');
    const cue = d.rain > 0.2 ? ` · ${fmt(d.rain, 1)}mm` : d.wind >= 22 ? ` · 💨 ${fmt(d.wind)}` : '';
    return `<div class="day ${i === 0 ? 'is-today' : ''} ${hot ? 'hot' : ''}">
      <div class="d-name">${dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</div>
      <div class="d-icon" aria-hidden="true">${weatherEmoji(d, thr)}</div>
      <div class="d-temp">${fmt(d.tmax)}° <span>/ ${fmt(d.tmin)}°</span></div>
      <div class="d-et">ET₀ <b>${fmt(d.et0, 1)}</b>${cue}</div>
    </div>`;
  }).join('');

  // Band 3a: Priority alerts (max 2 prominent, overflow folded calmly)
  const icWarn = '<span class="alert-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>';
  const icDrop = '<span class="alert-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg></span>';
  const criticalAlerts = [], otherAlerts = [];
  results.forEach(r => {
    if (r.today.invalidFlow) criticalAlerts.push(`<div class="alert red">${icWarn}<span class="alert-body"><b>Valve ${r.bi + 1} (${esc(r.b.name)}) flow is 0 m³/h:</b> enter block flow or emitters in <a href="#farm" data-goto="farm">My farm</a> (crop needs ${fmt(r.today.m3, 1)} m³).</span></div>`);
    if (r.flags.status === 'leak') criticalAlerts.push(`<div class="alert red">${icDrop}<span class="alert-body"><b>Valve ${r.bi + 1} leak:</b> flow is <b class="bad">${pct(r.flags.ratio)}</b> of normal. Inspect lines. <a href="#drip" data-goto="drip">Details</a></span></div>`);
    if (r.flags.status === 'clog') criticalAlerts.push(`<div class="alert red">${icWarn}<span class="alert-body"><b>Valve ${r.bi + 1} clog:</b> flow at <b class="bad">${pct(r.flags.ratio)}</b> for 2+ days. Flush emitters. <a href="#drip" data-goto="drip">Details</a></span></div>`);
    if (r.today.drainageBlocked) otherAlerts.push(`<div class="alert amber">${icWarn}<span class="alert-body"><b>${esc(r.b.name)} drainage cap:</b> max LF ${pct(r.today.drainCap)} (${drainage}) limits flushing; modeled ECe ${fmt(r.today.modeledECe, 1)} dS/m. <a href="#blend" data-goto="blend">Water mix</a></span></div>`);
    else if (r.today.unsuitable) otherAlerts.push(`<div class="alert amber">${icWarn}<span class="alert-body"><b>${esc(r.b.name)}:</b> modeled ECe (${fmt(r.today.modeledECe, 1)} dS/m) exceeds threshold (${r.crop.ecThr}). <a href="#planner" data-goto="planner">Suitability</a></span></div>`);
  });
  const hotDays = wx.days.filter(d => d.tmax >= thr);
  if (hotDays.length) {
    let save = 0;
    results.forEach(r => { if (r.b.system !== 'drip') wx.days.forEach((d, i) => { if (d.tmax >= thr) save += r.daily[i].m3 * (Engine.dayLossPct(d.tmax, d.wind) - 5) / 100; }); });
    otherAlerts.push(`<div class="alert amber">${icWarn}<span class="alert-body"><b>Heat ≥ ${thr} °C (${hotDays.map(d => new Date(d.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' })).join(', ')}):</b> irrigate ${esc(state.startTime)}–05:00 with +10% pre-heat buffer.${save > 1 ? ` Saves ≈ <b>${fmt(save)} m³</b> evaporation.` : ''}</span></div>`);
  }
  const allAlerts = [...criticalAlerts, ...otherAlerts];
  if (!allAlerts.length) {
    $('#alerts').innerHTML = '';
  } else if (allAlerts.length <= 2) {
    $('#alerts').innerHTML = allAlerts.join('');
  } else {
    $('#alerts').innerHTML = allAlerts.slice(0, 2).join('') +
      `<details class="today-more-alerts"><summary>+${allAlerts.length - 2} more field notice${allAlerts.length - 2 === 1 ? '' : 's'}</summary><div class="today-more-list">${allAlerts.slice(2).join('')}</div></details>`;
  }

  // Band 3b: Primary action cards (clean hero runtime + progressive-disclosed Why)
  const trendLabel = tr => tr === 'increasing' ? '<span class="bad">↑ salt accumulating</span>' : tr === 'flushing' ? '<span class="good">↓ salt flushing</span>' : '<span class="good">→ salt stable</span>';
  $('#decisions').innerHTML = results.map(r => {
    const t = r.today, b = r.b, invalidFlow = Boolean(t.invalidFlow), mins = invalidFlow ? 0 : round5(t.minutes), skip = !invalidFlow && mins < 5;
    const habitM3 = b.habitMin / 60 * r.flow; const diff = t.m3 > 0 ? (habitM3 - t.m3) / t.m3 : 1;
    const flush = 1 / (1 - t.LR) - 1;
    const d0 = wx.days[0];
    const cls = (invalidFlow || t.unsuitable || t.drainageBlocked || r.flags.status !== 'ok') ? 'warnb' : skip ? 'skip' : '';
    const tagCls = cls === 'warnb' ? 'red' : cls === 'skip' ? 'green' : 'blue';
    const habitTxt = invalidFlow ? `<span class="bad">set valid flow &gt; 0 m³/h</span>` :
      Math.abs(diff) < 0.1 ? `<span class="good">matches Saqi</span>` :
        diff > 0 ? `<span class="good">${fmt(habitM3 - t.m3)} m³ saved vs. habit</span>` :
          `<span class="warn">${pct((t.m3 - habitM3) / t.m3)} more — prevents heat/salt stress</span>`;
    return `<div class="card decision ${cls}">
      <div class="row" style="justify-content:space-between;align-items:center"><h3>Valve ${r.bi + 1} · ${esc(b.name)}</h3><span class="tag ${tagCls}">${r.crop.name} · ${t.stage}</span></div>
      <div class="big">${invalidFlow ? '<span class="bad">Set block flow &gt; 0 m³/h</span>' : skip ? 'No water today' : `${fmt(mins)} min <span class="after">${isNightWindow ? '🌙 ' : ''}after ${esc(state.startTime)}</span>`}</div>
      <div class="metrics">${fmt(t.m3, 1)} m³ · ${fmt(t.grossMm, 1)} mm · ${fmt(r.flow, 1)} m³/h ${SYSTEMS[b.system].name.toLowerCase()}</div>
      ${!invalidFlow && !skip && r.range.loMin != null ? `<div class="range-line">Likely range <b>${fmt(round5(r.range.loMin))}–${fmt(round5(r.range.hiMin))} min</b> <span class="muted">(ET₀ ±${pct(r.range.uEt)}, ECw ±${fmt(r.range.dEc, 1)} dS/m, efficiency ±${pct(r.range.dEa)}: assumed input error)</span></div>` : ''}
      <div class="habit-line">Habit ${b.habitMin} min (${fmt(habitM3, 1)} m³) · ${habitTxt}</div>
      <details class="today-why-fold"${r.bi === expandWhyIdx ? ' open' : ''}>
        <summary>Why this runtime?</summary>
        <div class="why">ET₀ ${fmt(d0.et0, 1)} mm × Kc ${fmt(t.kc, 2)} (${t.stage}) = <b>${fmt(t.etc, 1)} mm</b> crop ET${t.effRain ? ` − ${fmt(t.effRain, 1)} mm rain` : ''}${t.preHeat ? ' · <b>+10% pre-heatwave buffer</b>' : ''}
        · salt flush <b>+${pct(flush)}</b>${t.soilReclaim > 0 ? ' (incl. bounded sensor ECe reclamation heuristic)' : ''} (modeled root-zone ECe <b>${fmt(t.modeledECe, 1)} dS/m</b> vs crop ECe threshold ${r.crop.ecThr} dS/m; drainage: ${drainage})
        · ${SYSTEMS[b.system].name.toLowerCase()} efficiency ${pct(t.Ea)} → ${fmt(t.grossMm, 1)} mm × ${b.area} ha = ${fmt(t.m3, 1)} m³${invalidFlow ? ' (set valid block flow to compute minutes)' : ` at ${fmt(r.flow, 1)} m³/h`} (${trendLabel(r.eo.saltTrend)}).</div>
      </details>
    </div>`;
  }).join('');
  const wizInp = $('#ecWizInput');
  if (wizInp && document.activeElement !== wizInp) wizInp.value = ecw.toFixed(1);

  // Band 4: 3-way compare (Beat the guess story + KPIs + 7-day salt dot bars)
  const tO = sum(results.map(r => r.weekOurs));
  const tW = sum(results.map(r => r.weekWeatherOnly));
  const tH = sum(results.map(r => r.weekHabit));
  const cost = +state.water.cost;
  const saltFlushM3 = tO - tW;
  // Salt damage is cumulative, so the value of salt management is judged on the 60-day transient projection.
  const saltYieldProtectedAED = sum(results.map(r => Math.max(0, (r.salt.saqi.meanY - r.salt.wxOnly.meanY) * weeklyRevenue(r.crop, r.b.area, SALT_HORIZON))));
  const saltFlush60 = sum(results.map(r => r.salt.m3.saqi - r.salt.m3.wxOnly));
  const saltNetValueAED = saltYieldProtectedAED - Math.max(0, saltFlush60) * cost;
  const wx60Yield = sum(results.map(r => r.salt.wxOnly.meanY * r.rev)) / (sum(results.map(r => r.rev)) || 1);
  const habitWaterSaved = tH - tO;
  const habitYieldVal = sum(results.map(r => (r.eo.y - r.eh.y) * r.rev));
  const habitNetAED = habitWaterSaved * cost + habitYieldVal;

  const totRev = sum(results.map(r => r.rev)) || 1;
  const saqiYield = sum(results.map(r => r.eo.y * r.rev)) / totRev;
  const wxYield = sum(results.map(r => r.ew.y * r.rev)) / totRev;
  const habitYield = sum(results.map(r => r.eh.y * r.rev)) / totRev;
  const accumValves = results.filter(r => r.eo.saltTrend === 'increasing').length;

  const storyEl = $('#compareStory');
  if (storyEl) {
    const leadStory = habitWaterSaved >= 0
      ? `<strong>Beat the guess:</strong> Saqi uses <b>${fmt(habitWaterSaved)} m³ less water</b> (${pct(tH > 0 ? habitWaterSaved / tH : 0)} saved vs. ${fmt(tH)} m³ fixed habit) while holding <b>${pct(saqiYield)} est. yield</b> (without the salt flush, weather-only slides to <b>${pct(wx60Yield)}</b> salt-limited yield over 60 days).`
      : `<strong>Stop heat &amp; salt loss:</strong> Fixed habit (${fmt(tH)} m³) under-waters this week (${pct(habitYield)} est. yield). Saqi adds <b>+${fmt(Math.abs(habitWaterSaved))} m³</b> to hold <b>${pct(saqiYield)} est. yield</b> (weather-only: <b>${pct(wxYield)}</b>).`;
    storyEl.innerHTML = `<div>${leadStory}</div>
      <div class="compare-story-pills">
        <span class="pill ${habitNetAED >= 0 ? 'ok' : 'warn'}">${habitNetAED >= 0 ? '+' : '−'}${fmt(Math.abs(habitNetAED))} AED net vs. habit</span>
        <span class="pill ${accumValves ? 'warn' : 'ok'}">${accumValves ? `${accumValves} valve salt rising` : '7-day salt safe'}</span>
      </div>`;
  }

  $('#compareKpi').innerHTML = `
    <div><span>Saqi vs. Fixed Habit</span><b class="${habitWaterSaved >= 0 ? 'good' : 'warn'}">${habitWaterSaved >= 0 ? '−' : '+'}${fmt(Math.abs(habitWaterSaved))} m³</b><span>${habitWaterSaved >= 0 ? `saved (${pct(tH > 0 ? habitWaterSaved / tH : 0)} less)` : `more (${pct(tH > 0 ? Math.abs(habitWaterSaved) / tH : 0)}) — protects yield from heat/salt under-watering`} · ${fmt(tO)} vs ${fmt(tH)} m³</span></div>
    <div><span>Salt flush vs. Weather-Only</span><b>+${fmt(Math.max(0, saltFlushM3))} m³</b><span>extra water to leach salts (${fmt(tO)} vs ${fmt(tW)} m³)</span></div>
    <div><span>Est. value of salt management (60 days)</span><b class="${saltNetValueAED >= 0 ? 'good' : 'warn'}">${saltNetValueAED >= 0 ? '+' : '−'}${fmt(Math.abs(saltNetValueAED))} AED</b><span>+${fmt(saltYieldProtectedAED)} AED est. crop protected vs weather-only, minus ${fmt(Math.max(0, saltFlush60))} m³ flush water</span></div>
    <div><span>Est. total benefit vs. Habit</span><b class="${habitNetAED >= 0 ? 'good' : 'bad'}">${habitNetAED >= 0 ? '+' : '−'}${fmt(Math.abs(habitNetAED))} AED</b><span>water cost diff + est. stress protection</span></div>`;

  $('#compareTable').innerHTML = `<tr><th>Valve</th><th class="num">Saqi m³</th><th class="num">Wx-only m³</th><th class="num">Habit m³</th><th class="num">Modeled ECe (Saqi / Wx-only / Habit)</th><th class="num">Est. rel. yield (Saqi / Wx-only / Habit)</th><th class="num">Salt-aware est. gain</th></tr>` +
    results.map(r => {
      const saltGain = (r.eo.y - r.ew.y) * r.rev - (r.weekOurs - r.weekWeatherOnly) * cost;
      return `<tr><td>${r.bi + 1}. ${esc(r.b.name)}</td>
        <td class="num"><b>${fmt(r.weekOurs)}</b></td>
        <td class="num">${fmt(r.weekWeatherOnly)}</td>
        <td class="num">${fmt(r.weekHabit)}</td>
        <td class="num">${fmt(r.eo.ece, 1)} / <span class="${r.ew.ece > r.crop.ecThr ? 'bad' : ''}">${fmt(r.ew.ece, 1)}</span> / <span class="${r.eh.ece > r.crop.ecThr ? 'bad' : ''}">${fmt(r.eh.ece, 1)}</span> dS/m</td>
        <td class="num">${pct(r.eo.y)} / <span class="${r.ew.y < r.eo.y - 0.01 ? 'bad' : ''}">${pct(r.ew.y)}</span> / <span class="${r.eh.y < r.eo.y - 0.01 ? 'bad' : ''}">${pct(r.eh.y)}</span></td>
        <td class="num ${saltGain > 1 ? 'good' : ''}">${saltGain >= 0 ? '+' : '−'}${fmt(Math.abs(saltGain))} AED</td></tr>`;
    }).join('');

  const maxV = Math.max(...results.map(r => Math.max(r.weekOurs, r.weekWeatherOnly, r.weekHabit)), 1);
  $('#compareChart').innerHTML = results.map(r => {
    const dots = r.daily.map((d, di) => {
      const cls = (d.unsuitable || d.modeledECe > r.crop.ecThr) ? 'bad' : (d.drainageBlocked || d.modeledECe > r.crop.ecThr * 0.85) ? 'warn' : '';
      return `<i class="salt-dot ${cls}" title="Day ${di + 1}: ECe ${fmt(d.modeledECe, 1)} / ${r.crop.ecThr} dS/m"></i>`;
    }).join('');
    return `<div class="today-bar-row"><div class="today-bar-head"><span>${r.bi + 1}. ${esc(r.b.name)}<span class="salt-dot-strip" title="7-day modeled salt safety (green safe, amber approaching crop threshold, red above threshold)">${dots}</span></span><span class="muted">${trendLabel(r.eo.saltTrend)}${r.ew.saltTrend === 'increasing' ? ' · <span class="bad">↑ Wx-only salt rises</span>' : ''}</span></div>
    <div class="row"><span class="today-bar-lbl">Saqi</span><div class="bar" style="flex:1"><i style="width:${r.weekOurs / maxV * 100}%"></i></div><span class="today-bar-val mono">${fmt(r.weekOurs)} m³</span></div>
    <div class="row"><span class="today-bar-lbl">Wx-only</span><div class="bar" style="flex:1"><i style="width:${r.weekWeatherOnly / maxV * 100}%;background:var(--warn)"></i></div><span class="today-bar-val mono">${fmt(r.weekWeatherOnly)} m³</span></div>
    <div class="row"><span class="today-bar-lbl">Habit</span><div class="bar" style="flex:1"><i style="width:${r.weekHabit / maxV * 100}%;background:var(--destructive)"></i></div><span class="today-bar-val mono">${fmt(r.weekHabit)} m³</span></div></div>`;
  }).join('');
  if ($('#todayModelNote')) {
    const habEx = state.blocks[0] ? `${state.blocks[0].habitMin} min/day on ${state.blocks[0].name}` : '240 min/day';
    $('#todayModelNote').innerHTML = `Model note: Today's runtime range re-runs the same model at the edges of assumed input error (forecast ET₀, EC-pen accuracy, irrigation efficiency). Weekly water balance constrained by drainage capacity (${drainage}). Root-zone ECe follows a daily salt mass balance from the start ECe (equilibrium = FAO-29 Rhoades steady state), so salt builds over weeks rather than instantly; week-average ECe → estimated relative yield (Maas–Hoffman); water deficit → Ky (FAO-33). Fixed habit baseline uses farmer-entered timer schedules per valve (e.g. ${esc(habEx)}, editable in My farm). All yields and ECe values are <b>estimates</b>, not guaranteed field yields.`;
  }

  renderSaltForecast();
  renderModelChecks();
  renderVoice();
}

/* ---------- Live model checks (About → Validation) ---------- */
function renderModelChecks() {
  const box = $('#modelChecks'); if (!box || !wx || !results.length) return;
  const loc = LOCATIONS[state.location] || LOCATIONS.alain;
  const ecw = Math.max(0, +state.water.ec || 0);
  const row = (ok, title, body) => `<div class="step"><span class="step-num">${ok === null ? 'ℹ️' : ok ? '✅' : '⚠️'}</span><div><b>${title}</b> ${body}</div></div>`;
  const out = [];
  // 1. Backtest offline Hargreaves against live Penman-Monteith for this week.
  if (wx.kind === 'live' || wx.kind === 'cached') {
    const errs = wx.days.filter(d => d.et0 > 0).map(d => Math.abs(Engine.hargreavesET0(d.tmax, d.tmin, loc.lat, doy(d.date)) - d.et0) / d.et0);
    const k = Engine.hargreavesBias(wx.days, loc.lat) || 1;
    const errsCal = wx.days.filter(d => d.et0 > 0).map(d => Math.abs(k * Engine.hargreavesET0(d.tmax, d.tmin, loc.lat, doy(d.date)) - d.et0) / d.et0);
    const mape = sum(errs) / (errs.length || 1), mapeCal = sum(errsCal) / (errsCal.length || 1);
    out.push(row(mapeCal < 0.2, 'Offline ET₀ backtest:', `raw Hargreaves vs live Penman-Monteith over ${errs.length} days = <b>${pct(mape)}</b> mean error; after local calibration ×${k.toFixed(2)} = <b>${pct(mapeCal)}</b> (in-sample; refreshed on every live fetch).`));
  } else out.push(row(null, 'Offline ET₀ backtest:', 'needs one live forecast to compare against (currently using ' + esc(wx.kind === 'scenario' ? 'a synthetic scenario' : 'climate normals') + ').'));
  // 2. Transient salt model must converge to the published FAO-29 steady state.
  const crop = results[0].crop, lf = 0.2, N = 720;
  const eq = Engine.saltForecast({ crop, ecw: Math.max(ecw, 0.5), startECe: 0.5, applied: Array(N).fill(6 / (1 - lf)), etc: Array(N).fill(6) }).endECe;
  const ref = Engine.rootzoneECe(Math.max(ecw, 0.5), lf), eqErr = Math.abs(eq - ref) / ref;
  out.push(row(eqErr < 0.02, 'Salt model vs FAO-29:', `2-year simulation at LF 20% settles at <b>${fmt(eq, 2)}</b> dS/m vs FAO-29 steady state <b>${fmt(ref, 2)}</b> dS/m (error ${pct(eqErr)}).`));
  // 3. Water balance closes for every valve (LR and efficiency applied exactly once).
  const closes = results.every(r => Math.abs(r.today.grossMm * (1 - r.today.LR) * r.today.Ea - r.today.netNeed * (r.today.preHeat ? 1.1 : 1)) < 1e-6);
  out.push(row(closes, 'Water balance closes:', `gross × (1 − LR) × efficiency = crop need for all ${results.length} valves${closes ? '' : ' (check inputs)'}.`));
  // 4. Does Saqi beat the grower's guess over 60 days?
  const beats = results.filter(r => r.salt.m3.saqi <= r.salt.m3.habit * 1.001 && r.salt.saqi.meanY >= r.salt.habit.meanY - 0.005).length;
  const protects = results.filter(r => r.salt.saqi.meanY > r.salt.habit.meanY + 0.005).length;
  out.push(row(beats + protects === results.length, 'Beats the guess (60 days):', `on <b>${beats}</b> of ${results.length} valves Saqi uses less water than the fixed habit with equal or better yield${protects ? `; on <b>${protects}</b> it uses more water to stop heat/salt loss the habit causes` : ''}.`));
  // 5. Input sanity.
  const rawEc = +state.water.ec;
  out.push(row(rawEc >= 0 && rawEc <= 20, 'Input check:', `water ECw ${fmt(rawEc, 1)} dS/m ${rawEc > 20 ? '(above EC-pen range: re-measure)' : rawEc < 0 ? '(negative: treated as 0)' : 'within EC-pen range'}; ${results.filter(r => r.today.invalidFlow).length} valve(s) missing flow.`));
  box.innerHTML = out.join('');
}

/* ---------- 60-day salt forecast ---------- */
let saltValveIdx = 1;
function saltChartSvg(r) {
  const W = 640, H = 220, L = 38, R = 10, T = 12, B = 26;
  const S = r.salt, thr = r.crop.ecThr;
  const series = [['habit', 'var(--destructive)', 'Fixed habit'], ['wxOnly', 'var(--warn)', 'Weather-only'], ['saqi', 'var(--good)', 'Saqi']];
  const all = series.flatMap(([k]) => S[k].series.map(p => p.ece)).concat([thr, S.startECe]);
  const yMax = Math.max(...all) * 1.12 || 1;
  const x = d => L + (d / SALT_HORIZON) * (W - L - R);
  const y = v => T + (1 - v / yMax) * (H - T - B);
  const path = k => 'M' + [[0, S.startECe], ...S[k].series.map(p => [p.day, p.ece])].map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('L');
  const ticks = [0, yMax / 2, yMax].map(v => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, 1)}</text><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('');
  const xt = [0, 15, 30, 45, 60].map(d => `<text x="${x(d)}" y="${H - 8}" text-anchor="${d === 0 ? 'start' : d === SALT_HORIZON ? 'end' : 'middle'}">${d === 0 ? 'today' : 'day ' + d}</text>`).join('');
  const lines = series.map(([k, c]) => `<path d="${path(k)}" fill="none" stroke="${c}" stroke-width="${k === 'saqi' ? 3 : 2}" stroke-linejoin="round"/>`).join('');
  const marks = series.map(([k, c]) => S[k].crossDay ? `<circle cx="${x(S[k].crossDay)}" cy="${y(thr)}" r="4.5" fill="${c}"/>` : '').join('');
  return `<svg class="salt-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected root-zone ECe over 60 days for fixed habit, weather-only and Saqi">
    <g class="axis">${ticks}${xt}</g>
    <line x1="${L}" x2="${W - R}" y1="${y(thr)}" y2="${y(thr)}" class="thr"/>
    <text x="${W - R}" y="${y(thr) - 5}" text-anchor="end" class="thr-lbl">${esc(r.crop.name)} yield-loss threshold ${thr} dS/m</text>
    ${lines}${marks}</svg>
    <div class="salt-legend">${series.map(([k, c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>`;
}
function renderSaltForecast() {
  const box = $('#saltChart'); if (!box || !results.length) return;
  const sel = $('#saltValve');
  if (saltValveIdx >= results.length) saltValveIdx = 0;
  if (sel) {
    sel.innerHTML = results.map(r => `<option value="${r.bi}"${r.bi === saltValveIdx ? ' selected' : ''}>Valve ${r.bi + 1} · ${esc(r.b.name)}</option>`).join('');
    sel.onchange = () => { saltValveIdx = +sel.value; renderSaltForecast(); };
  }
  const r = results[saltValveIdx], S = r.salt, thr = r.crop.ecThr;
  const line = (k, n) => {
    const f = S[k];
    const when = f.crossDay ? `<b class="bad">crosses ${thr} dS/m on day ${f.crossDay}</b>` : (f.startAbove ? (f.endECe < S.startECe ? '<b class="good">flushing salt down</b>' : '<b class="bad">stays above threshold</b>') : '<b class="good">stays below threshold</b>');
    return `<li><b>${n}</b> (${fmt(S.m3[k])} m³): ${when} · ECe day 60 <b class="mono">${fmt(f.endECe, 1)}</b> dS/m · est. salt-limited yield <b>${pct(f.meanY)}</b></li>`;
  };
  const vsHabit = S.m3.habit - S.m3.saqi, flushExtra = S.m3.saqi - S.m3.wxOnly;
  const takeaway = `<div><strong>Next 60 days:</strong> Saqi ${vsHabit >= 0 ? `uses <b>${fmt(vsHabit)} m³ less</b> than the fixed habit (${pct(S.m3.habit > 0 ? vsHabit / S.m3.habit : 0)})` : `adds <b>${fmt(-vsHabit)} m³</b> over the habit to stop heat and salt stress`}; the extra <b>${fmt(Math.max(0, flushExtra))} m³</b> over weather-only is the salt flush that keeps the root zone ${S.saqi.crossDay ? 'as low as drainage allows' : 'under the yield-loss line'}${(() => { const v = (S.saqi.meanY - S.wxOnly.meanY) * weeklyRevenue(r.crop, r.b.area, SALT_HORIZON) - Math.max(0, flushExtra) * (+state.water.cost || 0); return v > 0 ? `, protecting an est. <b>${fmt(v)} AED</b> of crop vs weather-only` : ''; })()}.</div>`;
  $('#saltStory').innerHTML = takeaway + `<ul class="salt-list">${line('saqi', 'Saqi')}${line('wxOnly', 'Weather-only')}${line('habit', 'Fixed habit')}</ul>`;
  box.innerHTML = saltChartSvg(r);
  $('#saltNote').innerHTML = `Start ECe ${fmt(S.startECe, 1)} dS/m (${S.startAssumed ? '<b>assumed</b> 80% of crop threshold; enable the soil sensor in Soil sensor to start from a measured value' : 'measured soil sensor'}). Days 1–${wx.days.length} use the forecast, then monthly climate ET₀ (<b>simulated</b>). Daily salt mass balance: water ${state.water.ec ? fmt(+state.water.ec, 1) : '–'} dS/m in, drainage out (capped by ${esc(state.drainage || 'good')} drainage); root depth ${r.crop.rootM} m (FAO-56); equilibrium matches FAO-29. Yield excludes water-stress loss.`;
}

/* ---------- Voice ---------- */
function voiceLines(lang, valveFilter = voiceValveFilter) {
  const L = k => PHRASES[k][lang];
  const lines = [];
  const hotSoon = wx.days.slice(0, 3).some(d => d.tmax >= +state.heatThreshold);
  if (hotSoon) lines.push(L('heat'));
  const subset = valveFilter === 'all' ? results : results.filter(r => String(r.bi) === String(valveFilter));
  subset.forEach(r => {
    const v = r.bi + 1;
    if (r.today.invalidFlow) {
      lines.push(L('flowZero').replace('{v}', v));
    } else {
      const m = round5(r.today.minutes);
      lines.push(m < 5 ? L('none').replace('{v}', v) : L('run').replace('{v}', v).replace('{m}', m).replace('{t}', state.startTime));
    }
    if (r.flags.status === 'clog') lines.push(L('clog').replace('{v}', v));
    if (r.flags.status === 'leak') lines.push(L('leak').replace('{v}', v));
  });
  return lines;
}
function speak(text, lang, onend) {
  if (!('speechSynthesis' in window)) { toast('Voice is not supported in this browser. Use WhatsApp or SMS.'); return; }
  const u = new SpeechSynthesisUtterance(text);
  const code = LANGS[lang].bcp; u.lang = code; u.rate = 0.9;
  const v = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-').toLowerCase().startsWith(code.slice(0, 2)));
  if (v) u.voice = v; else toast(`No ${LANGS[lang].name} voice installed on this device. The text can still be sent by WhatsApp/SMS.`);
  if (onend) u.onend = onend;
  speechSynthesis.speak(u);
}
function makeOfflineQrSvg(text, cellSize = 4) {
  if (typeof window.qrcode !== 'function') return '';
  try {
    if (window.qrcode.stringToBytesFuncs?.['UTF-8']) {
      window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize, margin: 2 });
  } catch (e) { return ''; }
}
function renderVoice() {
  const lang = state.lang;
  const vSel = $('#voiceValve');
  if (vSel) {
    if (voiceValveFilter !== 'all' && !results.some(r => String(r.bi) === String(voiceValveFilter))) voiceValveFilter = 'all';
    vSel.innerHTML = `<option value="all">All valves (${results.length})</option>` +
      results.map(r => `<option value="${r.bi}">Valve ${r.bi + 1} · ${esc(r.b.name)}</option>`).join('');
    vSel.value = String(voiceValveFilter);
    vSel.onchange = () => { voiceValveFilter = vSel.value; renderVoice(); };
  }
  const lines = voiceLines(lang, voiceValveFilter);
  const sel = $('#voiceLang');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('');
    sel.onchange = () => { state.lang = sel.value; save(); renderVoice(); };
  }
  sel.value = lang;
  $('#playAll').onclick = () => { speechSynthesis.cancel(); speak(voiceLines(state.lang, voiceValveFilter).join(' '), state.lang); };
  $('#copyVoice').onclick = () => { navigator.clipboard?.writeText(voiceLines(state.lang, voiceValveFilter).join('\n')).then(() => toast('Copied')); };
  $('#voiceLines').innerHTML = lines.map((l, i) => `<div class="voice-line" dir="${LANGS[lang].dir}"><button class="btn sm ghost" data-say="${i}">▶</button><span class="txt">${esc(l)}</span></div>`).join('');
  $$('[data-say]').forEach(b => b.onclick = () => { speechSynthesis.cancel(); speak(lines[+b.dataset.say], lang); });
  const msg = lines.join('\n');
  $('#waLink').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('#smsLink').href = 'sms:?&body=' + encodeURIComponent(msg);

  const qrBtn = $('#qrBtn'), qrBox = $('#workerQrBox');
  if (qrBtn) {
    qrBtn.textContent = showWorkerQr ? '✕ Hide QR Card' : '📱 Worker QR Card';
    qrBtn.onclick = () => { showWorkerQr = !showWorkerQr; renderVoice(); };
  }
  if (qrBox) {
    qrBox.hidden = !showWorkerQr;
    if (showWorkerQr) {
      const locName = (LOCATIONS[state.location] || LOCATIONS.alain).name;
      const qrText = `SAQI · ${locName} (${isoDaysAgo(0)})\n` + msg;
      const svg = makeOfflineQrSvg(qrText, 4);
      const scopeLabel = voiceValveFilter === 'all' ? 'All valves' : `Valve ${Number(voiceValveFilter) + 1}`;
      qrBox.innerHTML = `${svg ? `<div class="worker-qr-svg" aria-label="Offline worker QR code">${svg}</div>` : ''}
        <div class="worker-qr-meta">
          <h4>Offline Worker QR Card · ${esc(scopeLabel)} (${esc(LANGS[lang].name)})</h4>
          <p class="muted" style="margin:0;font-size:.82rem">Scans on any phone camera with zero mobile data — plain text worker instructions inside the QR code.</p>
          <pre dir="${LANGS[lang].dir}">${esc(qrText)}</pre>
          <div class="row" style="gap:.4rem">
            <button type="button" class="btn sm" id="printQrBtn">🖨️ Print QR slip</button>
            <button type="button" class="btn sm ghost" id="copyQrBtn">Copy slip text</button>
          </div>
        </div>`;
      $('#printQrBtn').onclick = () => {
        document.documentElement.classList.add('printing-qr');
        window.print();
        setTimeout(() => document.documentElement.classList.remove('printing-qr'), 500);
      };
      $('#copyQrBtn').onclick = () => {
        navigator.clipboard?.writeText(qrText).then(() => toast('Worker QR slip copied'));
      };
    } else {
      qrBox.innerHTML = '';
    }
  }
}

/* ---------- Farm ---------- */
function renderFarm() {
  const fmDr = $('#fmDrainage');
  if (fmDr && !fmDr.options.length) fmDr.innerHTML = Object.entries(DRAINAGE).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
  const cropOpts = sel => Object.entries(CROPS).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.name}</option>`).join('');
  const sysOpts = sel => Object.entries(SYSTEMS).map(([k, s]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${s.name}</option>`).join('');
  $('#blockTable').innerHTML = `<tr><th>Valve</th><th>Name</th><th>Crop</th><th>Area (ha)</th><th>Planted</th><th>System</th><th>Flow input</th><th>Emitter (L/h)</th><th>Emitters (#)</th><th>Block flow (m³/h)</th><th>Habit (min/day)</th><th></th></tr>` +
    state.blocks.map((b, i) => {
      const em = b.flowMode === 'emitters';
      const bf = Engine.resolveBlockFlow(b);
      return `<tr><td>${i + 1}</td>
      <td><input type="text" data-bi="${i}" data-k="name" value="${esc(b.name)}"></td>
      <td><select data-bi="${i}" data-k="crop">${cropOpts(b.crop)}</select></td>
      <td><input type="number" step="0.1" min="0.01" data-bi="${i}" data-k="area" value="${b.area}"></td>
      <td><input type="date" data-bi="${i}" data-k="planted" value="${b.planted}" ${CROPS[b.crop].perennial ? 'disabled title="Perennial crop"' : ''}></td>
      <td><select data-bi="${i}" data-k="system">${sysOpts(b.system)}</select></td>
      <td><select data-bi="${i}" data-k="flowMode"><option value="direct" ${!em ? 'selected' : ''}>Direct m³/h</option><option value="emitters" ${em ? 'selected' : ''}>Emitters × count</option></select></td>
      <td><input type="number" step="0.5" min="0.5" data-bi="${i}" data-k="emitterLph" value="${b.emitterLph || 4}" ${em ? '' : 'disabled title="Switch Flow input to Emitters × count"'}></td>
      <td><input type="number" step="50" min="1" data-bi="${i}" data-k="emitterCount" value="${b.emitterCount || 1000}" ${em ? '' : 'disabled title="Switch Flow input to Emitters × count"'}></td>
      <td><input type="number" step="0.5" min="0.1" data-bi="${i}" data-k="flow" value="${fmt(bf, 2).replace(/,/g, '')}" ${em ? 'disabled title="Auto-computed: emitter L/h × count ÷ 1000"' : ''}></td>
      <td><input type="number" step="5" min="0" data-bi="${i}" data-k="habitMin" value="${b.habitMin}"></td>
      <td><button class="btn sm ghost" data-del="${i}" title="Remove">✕</button></td></tr>`;
    }).join('');
  $$('#blockTable [data-bi]').forEach(el => el.onchange = () => {
    const b = state.blocks[+el.dataset.bi], k = el.dataset.k;
    b[k] = el.type === 'number' ? (+el.value || 0) : el.value;
    if (b.flowMode === 'emitters') {
      if (!(b.emitterLph > 0)) b.emitterLph = 4;
      if (!(b.emitterCount > 0)) b.emitterCount = 100;
      b.flow = Engine.resolveBlockFlow(b);
    } else if (!(b.flow > 0)) {
      b.flow = 10;
      toast('Block flow must be > 0 m³/h');
    }
    save(); renderAll();
  });
  $$('#blockTable [data-del]').forEach(el => el.onclick = () => {
    const i = +el.dataset.del; state.blocks.splice(i, 1); state.flowLog.splice(i, 1);
    if (state.blend.block >= state.blocks.length) state.blend.block = 0;
    save(); renderAll();
  });
}

/* ---------- generic binding ---------- */
function bindInputs() {
  $$('[data-bind]').forEach(el => {
    const cur = getPath(state, el.dataset.bind);
    if (document.activeElement !== el) {
      if (el.type === 'checkbox') el.checked = Boolean(cur);
      else el.value = cur;
    }
    if (!el._bound) {
      el._bound = true;
      el.addEventListener('change', async () => {
        const val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (+el.value || 0) : el.value;
        setPath(state, el.dataset.bind, val);
        save(); renderAll();
      });
    }
  });
}

/* ---------- homepage Zone A simulator ---------- */
let simCond = { ...Engine.HOME_SCENARIOS.normal.conditions };
function renderHomeSim() {
  const ecw = +(simCond.ecw ?? simCond.salinity ?? 3.0);
  const d = Engine.decideZoneA({ ...simCond, ecw });
  $('#valTemp').textContent = simCond.temperature + '°C';
  $('#valSal').textContent = ecw.toFixed(1) + ' dS/m';
  $('#valMoist').textContent = simCond.moisture + '%';
  $('#valHum').textContent = simCond.humidity + '%';

  const saved = d.savedLitres >= 0;
  const absSaved = Math.abs(d.savedLitres);
  const barMax = Math.max(d.traditionalLitres, d.smartLitres, 1);
  if ($('#hpSavedLabel')) $('#hpSavedLabel').textContent = saved ? 'Water saved vs. 240-min fixed habit' : 'Crop protection water added vs. habit';
  $('#hpSavedLitres').textContent = (saved ? '' : '+') + fmt(absSaved);
  $('#hpSavedBadge').textContent = saved ? `${d.savedPct}% less than habit` : `+${Math.abs(d.savedPct)}% added — stops heat & salt stress`;
  if ($('#hpTradBar')) $('#hpTradBar').style.width = `${(d.traditionalLitres / barMax) * 100}%`;
  $('#hpTradL').textContent = fmt(d.traditionalLitres) + ' L';
  $('#hpSmartL').textContent = fmt(d.smartLitres) + ' L';
  $('#hpSmartBar').style.width = `${(d.smartLitres / barMax) * 100}%`;

  if ($('#resTitle')) $('#resTitle').textContent = saved ? 'Water saved vs. guesswork' : 'Yield protected in extreme heat';
  if ($('#resSub')) $('#resSub').textContent = saved
    ? `A fixed 240-min habit uses ${fmt(d.traditionalLitres)} L on 2 ha. Saqi gives ${fmt(d.smartLitres)} L: crop ET₀ (${d.et0} mm/d) + exact salt flush.`
    : `A fixed 240-min habit (${fmt(d.traditionalLitres)} L) under-waters today (${d.habitYieldPct}% est. yield over 90 days). Saqi increases run time to stop stress.`;
  $('#resSavedPct').textContent = saved ? `${d.savedPct}%` : `+${Math.abs(d.savedPct)}%`;
  if ($('#resPctLabel')) $('#resPctLabel').textContent = saved ? 'water saved' : 'heat/salt buffer';
  $('#resSavedL').textContent = saved ? fmt(absSaved) + ' L' : fmt(d.smartLitres) + ' L';
  if ($('#resVolLabel')) $('#resVolLabel').textContent = saved ? 'saved today' : 'recommended today';

  $('#simMins').textContent = d.totalMinutes + ' mins';
  const fl = $('#simFlush');
  fl.style.display = d.flushPct > 0 ? 'inline-flex' : 'none';
  fl.querySelector('span').textContent = `Add +${d.flushPct}% salt-leaching flush (modeled ECe ${d.modeledECe.toFixed(1)} dS/m)`;
  $('#simReason').textContent =
    `FAO-56 ET₀ ${d.et0} mm/d × Date palm Kc 0.95` +
    (simCond.moisture < 7 ? ' (+dry sandy soil deficit factor)' : '') +
    (simCond.temperature >= 45 ? ' + 10% heatwave buffer' : '') +
    ` with ${d.flushPct}% FAO-29 salt flush at ECw ${ecw.toFixed(1)} dS/m.`;
  $('#simRisk').textContent = `${d.stressRisk} stress risk (${d.smartYieldPct}% est. yield over 90 days)`;
  $('#simLitres').textContent = `${fmt(d.smartLitres)} L today (Weather-only: ${fmt(d.weatherOnlyLitres)} L)`;

  $('#cmpTradL').textContent = fmt(d.traditionalLitres) + ' L';
  if ($('#cmpWxL')) $('#cmpWxL').textContent = fmt(d.weatherOnlyLitres) + ' L';
  $('#cmpSmartL').textContent = fmt(d.smartLitres) + ' L';
  $('#cmpTradRisk').textContent = `${d.traditionalStressRisk} (${d.habitYieldPct}%)`;
  if ($('#cmpWxRisk')) $('#cmpWxRisk').textContent = `${d.weatherStressRisk} (${d.wxYieldPct}%)`;
  $('#cmpSmartRisk').textContent = `${d.stressRisk} (${d.smartYieldPct}%)`;
  if ($('#cmpSavedTitle')) $('#cmpSavedTitle').textContent = saved ? 'Water saved vs. habit' : 'Crop protection vs. habit';
  $('#cmpSavedPct').textContent = saved ? `${d.savedPct}%` : `+${Math.abs(d.savedPct)}%`;
  if ($('#cmpSavedNote')) $('#cmpSavedNote').innerHTML = saved
    ? `<span id="cmpSavedL">${fmt(absSaved)}</span> litres stay available vs. habit, while protecting salt balance vs. weather-only.`
    : `<span id="cmpSavedL">${fmt(absSaved)}</span> extra litres stop heat and salt stress when the 240-min habit under-waters (${d.habitYieldPct}% est. yield over 90 days).`;
  const etBadge = $('#simEt0Badge');
  if (etBadge) {
    const todayLive = wx?.days?.[0];
    etBadge.textContent = simFromLive && todayLive
      ? `Seeded from Today (${fmt(todayLive.tmax)}°C · ECw ${ecw.toFixed(1)}): Hargreaves ${d.et0} vs Live ET₀ ${fmt(todayLive.et0, 1)} mm/d`
      : `Scenario ET₀ (Hargreaves · ${d.et0} mm/d)`;
  }
  if (window.HeroCinema) window.HeroCinema.sync(d);
}
function initHomeSim() {
  const syncSliders = () => {
    $('#slTemp').value = simCond.temperature;
    $('#slSal').value = simCond.ecw ?? simCond.salinity ?? 3.0;
    $('#slMoist').value = simCond.moisture;
    $('#slHum').value = simCond.humidity;
  };
  $$('#simScenarios button').forEach(b => b.onclick = () => {
    const sc = b.dataset.sim;
    simFromLive = false;
    simCond = { ...Engine.HOME_SCENARIOS[sc].conditions };
    $$('#simScenarios button').forEach(x => x.classList.toggle('active', x === b));
    syncSliders(); renderHomeSim();
  });
  const bindSlider = (id, key) => $(id).addEventListener('input', e => {
    const val = +e.target.value;
    simFromLive = false;
    simCond[key] = val;
    if (key === 'ecw') simCond.salinity = val;
    $$('#simScenarios button').forEach(x => x.classList.remove('active'));
    renderHomeSim();
  });
  bindSlider('#slTemp', 'temperature'); bindSlider('#slSal', 'ecw');
  bindSlider('#slMoist', 'moisture'); bindSlider('#slHum', 'humidity');
  const seedBtn = $('#seedHomeLiveBtn');
  if (seedBtn) {
    seedBtn.onclick = () => {
      const d0 = wx?.days?.[0];
      if (!d0) { toast('Weather not ready yet'); return; }
      const tClamped = Math.min(55, Math.max(25, Math.round(d0.tmax)));
      const ecClamped = Math.min(10, Math.max(0.5, +(+state.water.ec || 3.0).toFixed(1)));
      simCond = { ...simCond, temperature: tClamped, ecw: ecClamped, salinity: ecClamped };
      simFromLive = true;
      $$('#simScenarios button').forEach(x => x.classList.remove('active'));
      syncSliders(); renderHomeSim();
      toast(`Zone A seeded from Today (${tClamped}°C, ECw ${ecClamped.toFixed(1)} dS/m)`);
    };
  }
  $('#simCopy').onclick = async () => {
    const d = Engine.decideZoneA(simCond);
    const msg = `Irrigate Zone A (2 ha Date palms) for ${d.totalMinutes} mins after 21:00 (${fmt(d.smartLitres)} L${d.flushPct > 0 ? ` incl. +${d.flushPct}% salt flush` : ''}).`;
    try { await navigator.clipboard.writeText(msg); toast('Watering instruction copied'); }
    catch { toast(msg); }
  };
  renderHomeSim();
}

/* ---------- tabs & init ---------- */
const TAB_ORDER = ['home', 'today', 'farm', 'assistant', 'blend', 'sensor', 'drip', 'planner', 'harvest', 'share', 'adviser', 'about'];
let leaveTimer = null;
function showTab(id, instant = false) {
  if (!document.getElementById(id)) id = 'home';
  const prevSec = $('section.tab.active');
  const nextSec = document.getElementById(id);
  const prevIdx = prevSec ? TAB_ORDER.indexOf(prevSec.id) : -1;
  const nextIdx = TAB_ORDER.indexOf(id);
  const dir = (prevIdx === -1 || nextIdx >= prevIdx) ? 1 : -1;

  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  $$('section.tab.is-leaving').forEach(s => s.classList.remove('is-leaving'));

  if (!instant && prevSec && prevSec !== nextSec) {
    prevSec.style.setProperty('--dir', dir);
    prevSec.classList.remove('active');
    prevSec.classList.add('is-leaving');
    leaveTimer = setTimeout(() => prevSec.classList.remove('is-leaving'), 220);
  } else if (prevSec && prevSec !== nextSec) {
    prevSec.classList.remove('active');
  }

  nextSec.style.setProperty('--dir', dir);
  nextSec.classList.add('active');
  const activeBtn = $$('.main-links [data-tab]').find(b => b.dataset.tab === id);
  $$('.main-links [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('.nav-dd').forEach(dd => {
    const trigger = dd.querySelector('.nav-drop-btn');
    if (trigger) trigger.classList.toggle('active', Boolean(dd.querySelector('.nav-menu [data-tab].active')));
  });
  if (!instant && activeBtn && window.innerWidth > 960) activeBtn.closest('.nav-dd')?.querySelector('.nav-drop-btn') || activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  if (id === 'farm' && typeof lmap !== 'undefined' && lmap) setTimeout(() => lmap.invalidateSize(), 80);
  if (id === 'home' && window.HeroCinema) window.HeroCinema.refresh();
  if (id === 'assistant' && typeof aiOnShow === 'function') aiOnShow();
  const fab = $('#aiFab'); if (fab) fab.hidden = (id === 'assistant');
  if (typeof refreshReveals === 'function') refreshReveals(prevSec !== nextSec && !instant);
  history.replaceState(null, '', '#' + id);
}
function syncLocationSelect() {
  const hl = $('#hdrLocation');
  if (!hl) return;
  if (state.customLoc) LOCATIONS.custom = state.customLoc;
  hl.innerHTML = Object.entries(LOCATIONS).map(([k, l]) => `<option value="${k}">${esc(l.name)}</option>`).join('') +
    `<option value="__gps__">📍 Use my current location (GPS)…</option>`;
  hl.value = LOCATIONS[state.location] ? state.location : 'alain';
  const n = LOCATIONS[hl.value]?.name || 'Al Ain';
  $('#wxBtnLabel').textContent = n.split(',')[0].replace(' (mapped)', '');
}
function renderAll() {
  if (!wx) return;
  syncLocationSelect();
  renderToday(); renderFarm(); renderFieldMap(); renderBlend(); renderSensor(); renderDrip(); renderPlanner(); renderShare(); renderAdviser();
  if (simFromLive) renderHomeSim();
  bindInputs(); updateNet();
  $$('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); showTab(a.dataset.goto); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  if ($('#assistant')?.classList.contains('active') && typeof aiOnShow === 'function') aiOnShow();
  else if (typeof aiRenderCtxBar === 'function') aiRenderCtxBar();
  if (typeof refreshReveals === 'function') refreshReveals(false);
}
const SITE_LANGS = [
  ['en', 'English'], ['ar', 'العربية · Arabic'], ['ur', 'اردو · Urdu'], ['hi', 'हिन्दी · Hindi'],
  ['bn', 'বাংলা · Bengali'], ['ml', 'മലയാളം · Malayalam'], ['ta', 'தமிழ் · Tamil'], ['tl', 'Tagalog · Filipino'],
  ['fa', 'فارسی · Persian'], ['ps', 'پښتو · Pashto'], ['pa', 'ਪੰਜਾਬੀ · Punjabi'], ['te', 'తెలుగు · Telugu'],
  ['mr', 'मराठी · Marathi'], ['gu', 'ગુજરાતી · Gujarati'], ['si', 'සිංහල · Sinhala'], ['ne', 'नेपाली · Nepali'],
  ['am', 'አማርኛ · Amharic'], ['sw', 'Kiswahili · Swahili'], ['so', 'Soomaali · Somali'], ['ha', 'Hausa'],
  ['tr', 'Türkçe · Turkish'], ['fr', 'Français · French'], ['es', 'Español · Spanish'], ['de', 'Deutsch · German'],
  ['pt', 'Português · Portuguese'], ['ru', 'Русский · Russian'], ['zh-CN', '中文 · Chinese (Simp)'], ['zh-TW', '繁體中文 · Chinese (Trad)'],
  ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['vi', 'Tiếng Việt · Vietnamese'], ['th', 'ไทย · Thai'],
  ['ja', '日本語 · Japanese'], ['ko', '한국어 · Korean'], ['it', 'Italiano · Italian'], ['nl', 'Nederlands · Dutch'],
  ['pl', 'Polski · Polish'], ['uk', 'Українська · Ukrainian'], ['ro', 'Română · Romanian'], ['el', 'Ελληνικά · Greek'],
  ['uz', 'Oʻzbek · Uzbek'], ['kk', 'Қазақ · Kazakh'], ['az', 'Azərbaycan'], ['he', 'עברית · Hebrew'],
];
const RTL_CODES = new Set(['ar', 'ur', 'fa', 'ps', 'he']);
let curSiteLang = localStorage.getItem('saqi-site-lang') || 'en';

window.googleTranslateElementInit = function () {
  if (window.google?.translate?.TranslateElement) {
    new google.translate.TranslateElement({ pageLanguage: 'en', autoDisplay: false }, 'google_translate_element');
    if (curSiteLang && curSiteLang !== 'en') setTimeout(() => triggerGoogleCombo(curSiteLang), 600);
  }
};

function triggerGoogleCombo(code) {
  const combo = $('.goog-te-combo');
  if (combo) {
    combo.value = code;
    combo.dispatchEvent(new Event('change'));
    return true;
  }
  return false;
}

function setSiteLanguage(code) {
  curSiteLang = code;
  try { localStorage.setItem('saqi-site-lang', code); } catch (e) { }
  document.documentElement.dir = RTL_CODES.has(code) ? 'rtl' : 'ltr';
  document.documentElement.lang = code;
  const entry = SITE_LANGS.find(x => x[0] === code);
  const shortLabel = code === 'en' ? 'Translate' : (entry ? entry[1].split('·')[0].trim() : code.toUpperCase());
  const lbl = $('#langBtnLabel'); if (lbl) lbl.textContent = shortLabel;

  if (LANGS[code]) { state.lang = code; save(); if (wx) renderVoice(); }
  document.dispatchEvent(new CustomEvent('saqi:langchange', { detail: { code } }));

  document.cookie = `googtrans=/en/${code};path=/`;
  document.cookie = `googtrans=/en/${code};path=/;domain=${location.hostname}`;

  if (code === 'en') {
    document.cookie = 'googtrans=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
    if (!triggerGoogleCombo('en')) location.reload();
    else toast('Website language set to English');
    return;
  }
  if (!triggerGoogleCombo(code)) {
    let tries = 0;
    const iv = setInterval(() => {
      if (triggerGoogleCombo(code) || ++tries > 15) clearInterval(iv);
    }, 300);
  }
  toast(`Translating website to ${entry ? entry[1] : code}…`);
}

function initTranslatorUI() {
  const langBtn = $('#langBtn'), langMenu = $('#langMenu'), langSearch = $('#langSearch'), langList = $('#langList');
  if (!langBtn || !langMenu) return;
  const setOpen = open => { langMenu.hidden = !open; langBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) langSearch.focus(); };
  const renderList = (q = '') => {
    const f = q.trim().toLowerCase();
    const items = SITE_LANGS.filter(([c, n]) => !f || n.toLowerCase().includes(f) || c.toLowerCase().includes(f));
    langList.innerHTML = items.map(([c, n]) => `<button type="button" data-slang="${c}" class="${c === curSiteLang ? 'active' : ''}"><span>${esc(n)}</span><small>${esc(c)}</small></button>`).join('') ||
      `<div class="muted" style="grid-column:1/-1;padding:.4rem">No matching language</div>`;
    $$('#langList [data-slang]').forEach(b => b.onclick = () => {
      setOpen(false);
      setSiteLanguage(b.dataset.slang);
      renderList(langSearch.value);
    });
  };
  renderList();
  if (curSiteLang !== 'en') {
    const entry = SITE_LANGS.find(x => x[0] === curSiteLang);
    $('#langBtnLabel').textContent = entry ? entry[1].split('·')[0].trim() : curSiteLang.toUpperCase();
    document.documentElement.dir = RTL_CODES.has(curSiteLang) ? 'rtl' : 'ltr';
  }
  langBtn.onclick = e => { e.stopPropagation(); setOpen(langMenu.hidden); };
  langSearch.oninput = () => renderList(langSearch.value);
  document.addEventListener('mousedown', e => { if (!$('#langWrap').contains(e.target)) setOpen(false); });
}

const THEME_KEY = 'saqi-theme-v2';
function applyTheme(t) {
  const mode = t === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = mode;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = mode === 'dark' ? '#1f1c18' : '#faf9f5';
  const btn = $('#themeToggle');
  if (btn) {
    btn.innerHTML = mode === 'dark'
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg><span class="sm-hide">Light</span>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><span class="sm-hide">Dark</span>';
    btn.title = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
}
let revealObserver = null;
function updateScrollMotion() {
  const doc = document.documentElement;
  const maxScroll = doc.scrollHeight - window.innerHeight;
  const pct = maxScroll > 0 ? Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)) : 0;
  const bar = $('#scrollProgress');
  if (bar) bar.style.width = pct.toFixed(2) + '%';

  $$('section.tab.active .reveal:not(.in-view)').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top <= window.innerHeight * 0.98) {
      el.classList.add('in-view');
      revealObserver?.unobserve(el);
    }
  });
}

function refreshReveals(resetTab = false) {
  const targets = $$('section.tab.active :is(.card, .preview-card, .day, .kpi > div, .sim-compare, .pillar)');
  if (!targets.length) { updateScrollMotion(); return; }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.calmBg === '1';
  const vh = window.innerHeight || 900;

  targets.forEach((el, idx) => {
    el.style.setProperty('--stagger', String(idx % 8));
    if (resetTab) el.classList.remove('in-view');
    el.classList.add('reveal');

    if (reduced || !revealObserver) {
      el.classList.add('in-view');
      return;
    }

    const r = el.getBoundingClientRect();
    if (r.top < vh * 0.96) {
      // Mark visible / above-fold elements immediately so tab switches never appear blank
      el.classList.add('in-view');
      revealObserver.unobserve(el);
    } else if (!el.classList.contains('in-view')) {
      revealObserver.observe(el);
    }
  });
  updateScrollMotion();
}

function initScrollMotion() {
  if ('IntersectionObserver' in window && !revealObserver) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.04, rootMargin: '0px 0px -20px 0px' });
  }
  window.addEventListener('scroll', updateScrollMotion, { passive: true });
  window.addEventListener('resize', updateScrollMotion, { passive: true });
  updateScrollMotion();
}

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  const calmCb = $('#calmBgToggle');
  const savedCalm = localStorage.getItem('saqi-calm-bg') === '1';
  if (savedCalm) document.documentElement.dataset.calmBg = '1';
  if (calmCb) {
    calmCb.checked = savedCalm;
    calmCb.onchange = () => {
      const on = calmCb.checked;
      document.documentElement.dataset.calmBg = on ? '1' : '0';
      try { localStorage.setItem('saqi-calm-bg', on ? '1' : '0'); } catch (e) { }
      refreshReveals(false);
    };
  }
  initScrollMotion();
  initTranslatorUI();
  $('#themeToggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { }
    applyTheme(next);
  };

  const toolsMenu = $('#toolsMenu'), toolsBtn = $('#toolsBtn');
  const setMenu = open => { toolsMenu.hidden = !open; toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  const mainNav = $('#mainNav'), mobBtn = $('#mobMenuBtn');
  const drops = $$('.nav-dd').map(dd => ({ dd, btn: dd.querySelector('.nav-drop-btn'), menu: dd.querySelector('.nav-menu') }));
  const setDrop = (item, open) => {
    if (!item?.btn || !item?.menu) return;
    item.menu.hidden = !open;
    item.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const closeDrops = (except = null) => drops.forEach(d => { if (d.dd !== except) setDrop(d, false); });
  const setMob = open => {
    if (!mainNav || !mobBtn) return;
    mainNav.classList.toggle('is-open', open);
    mobBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) drops.forEach(d => setDrop(d, Boolean(d.menu?.querySelector('[data-tab].active'))));
    else closeDrops();
  };

  toolsBtn.onclick = e => { e.stopPropagation(); closeDrops(); setMob(false); setMenu(toolsMenu.hidden); };
  mobBtn?.addEventListener('click', e => { e.stopPropagation(); setMenu(false); setMob(!mainNav.classList.contains('is-open')); });

  drops.forEach(d => {
    const items = () => [...d.menu.querySelectorAll('[role="menuitem"]')];
    d.btn.onclick = e => {
      e.stopPropagation();
      setMenu(false);
      const willOpen = d.menu.hidden;
      if (window.innerWidth > 960) closeDrops(d.dd);
      setDrop(d, willOpen);
    };
    d.btn.onkeydown = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); closeDrops(d.dd); setDrop(d, true);
        const list = items();
        (e.key === 'ArrowDown' ? list[0] : list[list.length - 1])?.focus();
      } else if (e.key === 'Escape') { setDrop(d, false); }
    };
    d.menu.onkeydown = e => {
      const list = items(), i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); setDrop(d, false); d.btn.focus(); }
    };
    d.dd.addEventListener('focusout', e => {
      if (window.innerWidth > 960 && !d.dd.contains(e.relatedTarget)) setDrop(d, false);
    });
  });

  document.addEventListener('pointerdown', e => {
    if (!$('#toolsWrap').contains(e.target)) setMenu(false);
    if (!mainNav?.contains(e.target) && e.target !== mobBtn && !mobBtn?.contains(e.target)) {
      closeDrops(); setMob(false);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mainNav?.classList.contains('is-open')) { setMob(false); mobBtn?.focus(); }
  });
  $$('.main-links [data-tab]').forEach(b => b.onclick = () => {
    showTab(b.dataset.tab); closeDrops(); setMob(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $$('[data-anchor]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const targetId = a.dataset.anchor;
    if (!$('#home').classList.contains('active')) showTab('home', true);
    requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });

  const initial = (location.hash || '#home').slice(1);
  if (['problem', 'engine', 'results', 'demo'].includes(initial)) {
    showTab('home', true);
    requestAnimationFrame(() => document.getElementById(initial)?.scrollIntoView({ block: 'start' }));
  } else {
    showTab(initial, true);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  initHomeSim();
  const hl = $('#hdrLocation');
  syncLocationSelect();
  $('#hdrScenario').value = state.scenario;
  hl.onchange = async () => {
    if (hl.value === '__gps__') {
      syncLocationSelect();
      showTab('farm');
      $('#geoBtn')?.click();
      return;
    }
    state.location = hl.value;
    const loc = LOCATIONS[state.location] || LOCATIONS.alain;
    moveMapTo(loc.lat, loc.lon, loc.name);
    syncLocationSelect();
    save();
    await loadWeather();
    renderAll();
  };
  $('#hdrScenario').onchange = async e => { state.scenario = e.target.value; save(); await loadWeather(); renderAll(); };
  $('#refreshWx').onclick = async () => { await loadWeather(true); renderAll(); toast('Forecast updated'); };
  $('#jumpVoice').onclick = () => $('#voiceBox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const applyFieldMode = (on, switchTab = false) => {
    document.documentElement.dataset.fieldMode = on ? '1' : '0';
    try { localStorage.setItem('saqi-field-mode', on ? '1' : '0'); } catch (e) { }
    const cb = $('#fieldModeToggle'); if (cb) cb.checked = on;
    const btn = $('#todayFieldBtn');
    if (btn) {
      btn.classList.toggle('is-active', on);
      btn.textContent = on ? '✕ Exit Field Mode' : '☀️ Field Mode';
    }
    refreshReveals(false);
    if (on && switchTab && !$('#today')?.classList.contains('active')) showTab('today');
  };
  const savedField = localStorage.getItem('saqi-field-mode') === '1';
  applyFieldMode(savedField, false);
  const fieldCb = $('#fieldModeToggle');
  if (fieldCb) fieldCb.onchange = () => { applyFieldMode(fieldCb.checked, true); setMenu(false); toast(fieldCb.checked ? 'Sunlit Field Mode ON' : 'Field Mode OFF'); };
  const fieldBtn = $('#todayFieldBtn');
  if (fieldBtn) fieldBtn.onclick = () => {
    const next = document.documentElement.dataset.fieldMode !== '1';
    applyFieldMode(next, false);
    toast(next ? 'Sunlit Field Mode ON (big contrast UI)' : 'Field Mode OFF');
  };

  const offCb = $('#simOfflineToggle');
  if (offCb) {
    offCb.checked = simOffline;
    offCb.onchange = async () => {
      simOffline = offCb.checked;
      try { sessionStorage.setItem('saqi-sim-offline', simOffline ? '1' : '0'); } catch (e) { }
      await loadWeather(!simOffline);
      renderAll();
      setMenu(false);
      toast(simOffline ? 'Airplane-mode test ON · running 100% locally' : 'Airplane-mode test OFF · live weather restored');
    };
  }

  const applyJudgeDemo = async () => {
    setMenu(false);
    applyFieldMode(false, false);
    state = defaultState();
    state.scenario = (navigator.onLine && !simOffline) ? 'live' : 'nov';
    simFromLive = false;
    voiceValveFilter = 'all';
    save();
    $('#hdrScenario').value = state.scenario;
    expandWhyIdx = 0;
    await loadWeather();
    showTab('today');
    renderAll();
    expandWhyIdx = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Judge Demo ready: Al Ain 4-valve farm (Valve 1 math open)');
  };
  if ($('#judgeDemoBtn')) $('#judgeDemoBtn').onclick = applyJudgeDemo;
  if ($('#todayJudgeBtn')) $('#todayJudgeBtn').onclick = applyJudgeDemo;

  const ecBtn = $('#todayEcBtn'), ecWiz = $('#ecWizard'), ecInp = $('#ecWizInput');
  const applyEcVal = val => {
    const v = Math.min(25, Math.max(0, Number(val) || 0));
    state.water.ec = +v.toFixed(1);
    state.water.source = 'measured (EC pen)';
    state.water.tested = isoDaysAgo(0);
    save(); renderAll();
    if (ecWiz) ecWiz.hidden = true;
    toast(`Water ECw updated to ${v.toFixed(1)} dS/m — all valves recalculated`);
  };
  if (ecBtn && ecWiz) ecBtn.onclick = () => { ecWiz.hidden = !ecWiz.hidden; if (!ecWiz.hidden) { if (ecInp) ecInp.value = (+state.water.ec || 0).toFixed(1); ecInp?.focus(); } };
  $$('[data-ec-preset]').forEach(b => b.onclick = () => applyEcVal(b.dataset.ecPreset));
  if ($('#ecWizApply')) $('#ecWizApply').onclick = () => applyEcVal(ecInp?.value);

  const loadScriptOnce = src => typeof aiLoadScript === 'function' ? aiLoadScript(src) : new Promise((res, rej) => {
    if (window.jspdf?.jsPDF) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  const pdfBtn = $('#todayOnePagerBtn');
  if (pdfBtn) pdfBtn.onclick = async () => {
    const oldTxt = pdfBtn.textContent;
    pdfBtn.disabled = true; pdfBtn.textContent = 'Building PDF…';
    try {
      await loadScriptOnce(typeof AI_LIBS !== 'undefined' ? AI_LIBS.jspdf : 'vendor/jspdf.umd.min.js');
      const JsPdf = window.jspdf?.jsPDF;
      if (!JsPdf) throw new Error('jsPDF unavailable');
      const doc = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const locName = (LOCATIONS[state.location] || LOCATIONS.alain).name;
      const asc = s => String(s || '').replace(/[^\x20-\x7E]/g, ' ');
      doc.setFillColor(21, 76, 46);
      doc.rect(0, 0, 210, 26, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15);
      doc.text('SAQI - Daily Salt-Smart Irrigation Brief', 14, 11.5);
      doc.setFontSize(9.5);
      doc.text(asc(`${locName} | Date: ${isoDaysAgo(0)} | Start: After ${state.startTime}`), 14, 18.5);
      doc.text(asc(`ECw: ${fmt(state.water.ec, 1)} dS/m (${state.water.source}) | Drainage: ${state.drainage} | Mode: ${wx.kind}`), 14, 23.2);

      doc.setTextColor(20, 30, 25);
      let y = 35;
      doc.setFontSize(11.5);
      doc.text('1. Tonight Valve Schedule', 14, y);
      y += 5;
      doc.setFillColor(240, 245, 242);
      doc.rect(14, y, 182, 7, 'F');
      doc.setFontSize(8.5);
      doc.text('Valve & Crop', 16, y + 4.8);
      doc.text('Run Time', 78, y + 4.8);
      doc.text('Volume', 105, y + 4.8);
      doc.text('Salt Flush', 128, y + 4.8);
      doc.text('Modeled ECe', 152, y + 4.8);
      doc.text('Est. Yield', 177, y + 4.8);
      y += 9;

      results.forEach(r => {
        const t = r.today, mins = t.invalidFlow ? 'Fix flow' : (round5(t.minutes) < 5 ? 'Skip (0)' : round5(t.minutes) + ' min');
        const flush = pct(1 / (1 - t.LR) - 1);
        doc.setFontSize(9);
        doc.text(asc(`${r.bi + 1}. ${r.b.name} (${r.crop.name})`).slice(0, 34), 16, y);
        doc.text(mins, 78, y);
        doc.text(`${fmt(t.m3, 1)} m3`, 105, y);
        doc.text('+' + flush, 128, y);
        doc.text(`${fmt(t.modeledECe, 1)} dS/m`, 152, y);
        doc.text(pct(r.eo.y), 177, y);
        doc.setDrawColor(225, 232, 228);
        doc.line(14, y + 2.5, 196, y + 2.5);
        y += 7;
      });

      y += 5;
      const tO = sum(results.map(r => r.weekOurs)), tW = sum(results.map(r => r.weekWeatherOnly)), tH = sum(results.map(r => r.weekHabit));
      doc.setFontSize(11.5);
      doc.text('2. 7-Day Comparison vs Guesswork', 14, y);
      y += 6;
      doc.setFontSize(9.5);
      doc.text(`Saqi Planned: ${fmt(tO)} m3  |  Weather-Only (no salt flush): ${fmt(tW)} m3  |  Fixed Habit: ${fmt(tH)} m3`, 14, y);
      y += 5.5;
      const diff = tH - tO;
      doc.text(diff >= 0 ? `Water saved vs habit: ${fmt(diff)} m3 (${pct(tH > 0 ? diff / tH : 0)})` : `Protective extra vs under-watering habit: +${fmt(Math.abs(diff))} m3`, 14, y);

      y += 10;
      doc.setFontSize(11.5);
      doc.text('3. Worker Slip & Offline Scan QR', 14, y);
      y += 5;
      const workerMsg = voiceLines('en', voiceValveFilter).join('\n');
      doc.setFontSize(9);
      const split = doc.splitTextToSize(asc(workerMsg), 130);
      doc.text(split, 14, y + 2);
      if (typeof window.qrcode === 'function') {
        if (window.qrcode.stringToBytesFuncs?.['UTF-8']) window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
        const qr = window.qrcode(0, 'M');
        qr.addData(`SAQI ${isoDaysAgo(0)}\n` + voiceLines(state.lang, voiceValveFilter).join('\n'));
        qr.make();
        const cnt = qr.getModuleCount(), sz = 36 / cnt, qx = 156, qy = Math.min(y, 240);
        doc.setFillColor(20, 20, 20);
        for (let rr = 0; rr < cnt; rr++) {
          for (let cc = 0; cc < cnt; cc++) {
            if (qr.isDark(rr, cc)) doc.rect(qx + cc * sz, qy + rr * sz, sz, sz, 'F');
          }
        }
        doc.setFontSize(7.5);
        doc.text(`QR (${LANGS[state.lang].name})`, qx, qy + 40);
      }

      doc.setFontSize(7.5);
      doc.setTextColor(100, 110, 105);
      doc.text('Generated 100% locally in-browser (zero external AI calls). Weather: FAO-56 Penman-Monteith / Hargreaves backup.', 14, 286);
      doc.save(`saqi-plan-${isoDaysAgo(0)}.pdf`);
      toast('Offline 1-page plan PDF downloaded');
    } catch (e) {
      toast('Could not build PDF — opening browser print');
      window.print();
    } finally {
      pdfBtn.disabled = false; pdfBtn.textContent = oldTxt;
    }
  };

  let deferredInstallPrompt = null;
  const installBtn = $('#installPwaBtn');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) installBtn.onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  };

  $('#addBlock').onclick = () => {
    state.blocks.push({ name: 'New block', crop: 'date', area: 1, planted: isoDaysAgo(0), system: 'drip', flowMode: 'direct', emitterLph: 4, emitterCount: 5000, flow: 20, habitMin: 120 });
    state.flowLog.push(Array.from({ length: 14 }, (_, d) => ({ date: isoDaysAgo(13 - d), flow: 20 })));
    save(); renderAll();
  };
  $('#resetDemo').onclick = async () => { if (confirm('Reset to the demo farm?')) { state = defaultState(); save(); await loadWeather(); renderAll(); } };
  addEventListener('online', updateNet); addEventListener('offline', updateNet);
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  initTools();
  await loadWeather();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
}
init();
