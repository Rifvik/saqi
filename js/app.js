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
    sensor: { soil: 'sand', reading: 9.5, ece: 8, k: 0.35, depth: 40, tested: isoDaysAgo(3) },
    share: { cap: 400, pump: 25, price: 1.5, link: true, farms: [
      { name: 'My farm', share: 25, need: 150 }, { name: 'Al Kaabi farm', share: 25, need: 60 }, { name: 'Rashid farm', share: 20, need: 140 },
      { name: 'Hamad farm', share: 15, need: 30 }, { name: 'Saeed farm', share: 15, need: 110 }] },
    planner: { system: 'drip', avail: 80, current: 'alfalfa' },
  };
}
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
function climatologyDays(loc) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = isoDaysAgo(-i); const m = new Date(date + 'T12:00').getMonth();
    const tmax = CLIMATE.tmax[m], tmin = CLIMATE.tmin[m];
    return { date, tmax, tmin, et0: +Engine.hargreavesET0(tmax, tmin, loc.lat, doy(date)).toFixed(1), wind: 15, rain: 0 };
  });
}
async function loadWeather(force) {
  const loc = LOCATIONS[state.location] || LOCATIONS.alain;
  if (state.scenario !== 'live') { wx = { source: SCENARIOS[state.scenario].label, kind: 'scenario', days: scenarioDays(state.scenario) }; return; }
  const key = 'saqi-wx-' + state.location + '-' + loc.lat.toFixed(2) + '-' + loc.lon.toFixed(2);
  let cached = null; try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { }
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
  } catch (e) {
    if (cached) wx = { ...cached, kind: 'cached', source: 'Offline: using forecast saved ' + new Date(cached.fetchedAt).toLocaleString('en-GB') };
    else wx = { source: 'Offline, no saved forecast: using climate normals + Hargreaves ET₀ (works with zero internet)', kind: 'clim', days: climatologyDays(loc) };
  }
}
function updateNet() {
  const p = $('#netPill'); const on = navigator.onLine;
  let txt = on ? '● Online' : '● Offline', cls = on ? 'ok' : 'warn';
  if (wx && wx.kind === 'cached') { txt = '● Offline · saved forecast'; cls = 'warn'; }
  if (wx && wx.kind === 'clim') { txt = '● Offline · climate backup'; cls = 'bad'; }
  if (wx && wx.kind === 'scenario') { txt = '● Scenario data'; cls = ''; }
  p.textContent = txt; p.className = 'pill ' + cls;
}

/* ---------- core computation ---------- */
function dayOf(block, offset = 0) {
  if (CROPS[block.crop].perennial) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(block.planted + 'T00:00').getTime()) / 864e5) + offset);
}
function weeklyRevenue(crop, area, nDays) { return crop.yield * 1000 * crop.price / Engine.seasonLength(crop) * nDays * area; }
function computeAll() {
  const ecw = +state.water.ec || 0; const n = wx.days.length; const thr = +state.heatThreshold;
  const drainage = state.drainage || 'good';
  const prevECe = +state.sensor?.ece || null;
  return state.blocks.map((b, bi) => {
    const crop = CROPS[b.crop];
    const flow = Engine.resolveBlockFlow(b);
    const daily = wx.days.map((d, i) => {
      const preHeat = Boolean(d.tmax < thr && wx.days[i + 1] && wx.days[i + 1].tmax >= thr);
      return Engine.blockDecision({ ...b, flow, day: dayOf(b, i) }, crop, d, ecw, preHeat, drainage);
    });
    const weatherDaily = wx.days.map((d, i) => Engine.weatherOnlyDecision({ ...b, flow, day: dayOf(b, i) }, crop, d));
    const weekOurs = sum(daily.map(x => x.m3));
    const weekWeatherOnly = sum(weatherDaily.map(x => x.m3));
    const weekHabit = n * b.habitMin / 60 * flow;
    const netWeek = sum(daily.map(x => x.netNeed));
    const eo = Engine.evaluate(crop, b, weekOurs, netWeek, ecw, drainage, prevECe);
    const ew = Engine.evaluate(crop, b, weekWeatherOnly, netWeek, ecw, drainage, prevECe);
    const eh = Engine.evaluate(crop, b, weekHabit, netWeek, ecw, drainage, prevECe);
    const rev = weeklyRevenue(crop, b.area, n);
    const flags = Engine.flowCheck(state.flowLog[bi], flow);
    return { b, bi, crop, flow, today: daily[0], daily, weatherDaily, weekOurs, weekWeatherOnly, weekHabit, netWeek, eo, ew, eh, rev, flags };
  });
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = Math.round((Date.now() - new Date(dateStr + 'T00:00').getTime()) / 864e5);
  return isFinite(d) ? Math.max(0, d) : null;
}

/* ---------- Today ---------- */
function renderToday() {
  results = computeAll();
  const thr = +state.heatThreshold; const ecw = +state.water.ec;
  const drainage = state.drainage || 'good';
  $('#wxSource').innerHTML = `${esc(wx.source)}. Water ECw <b class="mono">${fmt(ecw, 1)} dS/m</b> · Drainage: <b>${drainage}</b>.` +
    (wx.days[0] ? ` <span class="muted">Hargreaves backup ET₀ today: <span class="mono">${fmt(Engine.hargreavesET0(wx.days[0].tmax, wx.days[0].tmin, (LOCATIONS[state.location] || LOCATIONS.alain).lat, doy(wx.days[0].date)), 1)} mm</span>.</span>` : '');
  const rb = $('#refreshWx'); if (rb) rb.style.display = wx.kind === 'live' ? '' : 'none';

  // Data confidence & provenance bar
  const wxConf = wx.kind === 'live'
    ? `<span class="tag green">Weather: Live Open-Meteo · updated ${wx.fetchedAt ? new Date(wx.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'today'} (high confidence)</span>`
    : wx.kind === 'cached'
      ? `<span class="tag amber">Weather: Cached forecast · ${wx.fetchedAt ? new Date(wx.fetchedAt).toLocaleString('en-GB') : 'saved'} (medium)</span>`
      : wx.kind === 'scenario'
        ? `<span class="tag amber">Weather: Synthetic scenario (demo mode)</span>`
        : `<span class="tag red">Weather: Hargreaves climate fallback (±15% ET₀ uncertainty)</span>`;
  const ecAge = daysSince(state.water.tested);
  const ecStale = ecAge == null || ecAge > 30 || (state.water.source || '').startsWith('estimated');
  const ecConf = `<span class="tag ${ecStale ? 'amber' : 'green'}">Water ECw: ${fmt(ecw, 1)} dS/m · ${esc(state.water.source || 'measured')}${ecAge != null ? ` · ${ecAge === 0 ? 'today' : ecAge + 'd ago'}` : ''}${ecStale ? ' (verify soon)' : ''}</span>`;
  const drainConf = `<span class="tag ${drainage === 'poor' ? 'red' : drainage === 'moderate' ? 'amber' : 'blue'}">Soil ECe: modeled FAO-29 steady-state (${drainage} drainage)</span>`;
  const flowBad = results.some(r => r.flags.status !== 'ok');
  const flowConf = `<span class="tag ${flowBad ? 'red' : 'blue'}">Flow: ${flowBad ? 'anomaly detected — verify emitters/pipes' : 'synthetic 14d meter baseline'}</span>`;
  $('#dataConfidence').innerHTML = wxConf + ecConf + drainConf + flowConf;

  $('#forecast').innerHTML = wx.days.map((d, i) => {
    const hot = d.tmax >= thr; const dt = new Date(d.date + 'T12:00');
    return `<div class="day ${i === 0 ? 'is-today' : ''} ${hot ? 'hot' : ''}">
      <div class="d-name">${dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</div>
      <div class="d-temp">${fmt(d.tmax)}° <span>/ ${fmt(d.tmin)}°</span></div>
      <div class="d-et">ET₀ <b>${fmt(d.et0, 1)}</b> mm</div>
      <div class="d-wind">↗ ${fmt(d.wind)} km/h${d.rain > 0 ? ' · 🌧 ' + fmt(d.rain, 1) : ''}</div>
      ${hot ? '<span class="tag red" style="margin-top:.25rem">Heat</span>' : ''}</div>`;
  }).join('');

  // alerts
  const icWarn = '<span class="alert-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>';
  const icDrop = '<span class="alert-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg></span>';
  const icOk = '<span class="alert-icon"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg></span>';
  const al = [];
  const hotDays = wx.days.filter(d => d.tmax >= thr);
  if (hotDays.length) {
    let save = 0;
    results.forEach(r => { if (r.b.system !== 'drip') wx.days.forEach((d, i) => { if (d.tmax >= thr) save += r.daily[i].m3 * (Engine.dayLossPct(d.tmax, d.wind) - 5) / 100; }); });
    al.push(`<div class="alert red">${icWarn}<span class="alert-body"><b>Heat ≥ ${thr} °C on ${hotDays.map(d => new Date(d.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' })).join(', ')}.</b> Water only between ${esc(state.startTime)} and 05:00, and give about 10% extra the evening before so roots start the hot day full.${save > 1 ? ` Night watering of sprinkler/flood blocks avoids ≈ <b>${fmt(save)} m³</b> of evaporation this week.` : ''}</span></div>`);
  }
  results.forEach(r => {
    if (r.today.drainageBlocked) {
      al.push(`<div class="alert amber">${icWarn}<span class="alert-body"><b>${esc(r.b.name)} (drainage limit):</b> full salt flushing is blocked by <b>${drainage} drainage</b> (max LF ${pct(r.today.drainCap)}). Modeled root-zone ECe rises to <b>${fmt(r.today.modeledECe, 1)} dS/m</b> vs crop threshold ${r.crop.ecThr} dS/m — avoid over-flushing (waterlogging risk); instead blend fresher water <a href="#blend" data-goto="blend">Water mix</a> or check suitability <a href="#planner" data-goto="planner">Suitability</a></span></div>`);
    } else if (r.today.unsuitable) {
      al.push(`<div class="alert amber">${icWarn}<span class="alert-body"><b>${esc(r.b.name)}:</b> modeled root-zone ECe (${fmt(r.today.modeledECe, 1)} dS/m) exceeds ${r.crop.name} threshold (${r.crop.ecThr} dS/m) even at max leaching. Blend fresher water <a href="#blend" data-goto="blend">Water mix</a> or switch crop <a href="#planner" data-goto="planner">Suitability</a></span></div>`);
    }
    if (r.flags.status === 'clog') al.push(`<div class="alert red">${icWarn}<span class="alert-body"><b>Valve ${r.bi + 1} (${esc(r.b.name)}):</b> flow is only <b class="bad">${pct(r.flags.ratio)}</b> of normal for 2+ days. Drippers are probably blocked: flush the lines or acid-clean them. <a href="#drip" data-goto="drip">Details</a></span></div>`);
    if (r.flags.status === 'leak') al.push(`<div class="alert red">${icDrop}<span class="alert-body"><b>Valve ${r.bi + 1} (${esc(r.b.name)}):</b> flow is <b class="bad">${pct(r.flags.ratio)}</b> of normal, which points to a burst pipe or open end. Water is being lost right now. <a href="#drip" data-goto="drip">Details</a></span></div>`);
  });
  if (!al.length) al.push(`<div class="alert green">${icOk}<span class="alert-body">No heat, salt, drainage or pipe problems this week.</span></div>`);
  $('#alerts').innerHTML = al.join('');

  // decision cards
  const trendLabel = tr => tr === 'increasing' ? '<span class="bad">↑ salt accumulating</span>' : tr === 'flushing' ? '<span class="good">↓ salt flushing</span>' : '<span class="good">→ salt stable</span>';
  $('#decisions').innerHTML = results.map(r => {
    const t = r.today, b = r.b, mins = round5(t.minutes), skip = mins < 5;
    const habitM3 = b.habitMin / 60 * r.flow; const diff = t.m3 > 0 ? (habitM3 - t.m3) / t.m3 : 1;
    const flush = 1 / (1 - t.LR) - 1;
    const d0 = wx.days[0];
    const cls = (t.unsuitable || t.drainageBlocked || r.flags.status !== 'ok') ? 'warnb' : skip ? 'skip' : '';
    const tagCls = cls === 'warnb' ? 'red' : cls === 'skip' ? 'green' : 'blue';
    const habitTxt = Math.abs(diff) < 0.1 ? `<span class="good"><b>close to Saqi</b></span>` :
      diff > 0 ? `<span class="bad"><b>+${pct(diff)} over need: ${fmt(habitM3 - t.m3)} m³ wasted today</b></span>` :
        `<span class="bad"><b>${pct((t.m3 - habitM3) / t.m3)} under need: water stress and salt build-up</b></span>`;
    return `<div class="card decision ${cls}">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><h3>Valve ${r.bi + 1} · ${esc(b.name)}</h3><span class="tag ${tagCls}">${r.crop.name} · ${t.stage}</span></div>
      <div class="big">${skip ? 'No water today' : `${fmt(mins)} min <span class="after">after ${esc(state.startTime)}</span>`}</div>
      <div class="metrics">${fmt(t.m3, 1)} m³ · ${fmt(t.grossMm, 1)} mm · ${b.area} ha ${SYSTEMS[b.system].name.toLowerCase()} · block flow ${fmt(r.flow, 1)} m³/h</div>
      <div class="habit-line">Fixed habit: ${b.habitMin} min (${fmt(habitM3, 1)} m³) → ${habitTxt}</div>
      <div class="why">Why: ET₀ ${fmt(d0.et0, 1)} mm × Kc ${fmt(t.kc, 2)} (${t.stage}) = <b>${fmt(t.etc, 1)} mm</b> crop ET${t.effRain ? ` − ${fmt(t.effRain, 1)} mm rain` : ''}${t.preHeat ? ' · <b>+10% pre-heatwave buffer</b>' : ''}
      · salt flush <b>+${pct(flush)}</b> (modeled root-zone ECe <b>${fmt(t.modeledECe, 1)} dS/m</b> vs crop ECe threshold ${r.crop.ecThr} dS/m; drainage: ${drainage})
      · ${SYSTEMS[b.system].name.toLowerCase()} efficiency ${pct(t.Ea)} → ${fmt(t.grossMm, 1)} mm × ${b.area} ha = ${fmt(t.m3, 1)} m³ at ${fmt(r.flow, 1)} m³/h (${trendLabel(r.eo.saltTrend)}).</div>
    </div>`;
  }).join('');

  // 3-way compare: Saqi vs Weather-only (no salt) vs Fixed habit
  const tO = sum(results.map(r => r.weekOurs));
  const tW = sum(results.map(r => r.weekWeatherOnly));
  const tH = sum(results.map(r => r.weekHabit));
  const cost = +state.water.cost;
  const saltFlushM3 = tO - tW;
  const saltYieldProtectedAED = sum(results.map(r => Math.max(0, (r.eo.y - r.ew.y) * r.rev)));
  const saltNetValueAED = saltYieldProtectedAED - saltFlushM3 * cost;
  const habitWaterSaved = tH - tO;
  const habitYieldVal = sum(results.map(r => (r.eo.y - r.eh.y) * r.rev));
  const habitNetAED = habitWaterSaved * cost + habitYieldVal;

  $('#compareKpi').innerHTML = `
    <div><span>Saqi vs. Fixed Habit</span><b class="${habitWaterSaved >= 0 ? 'good' : 'warn'}">${habitWaterSaved >= 0 ? '−' : '+'}${fmt(Math.abs(habitWaterSaved))} m³</b><span>${habitWaterSaved >= 0 ? 'saved' : 'more'} (${pct(tH > 0 ? Math.abs(habitWaterSaved) / tH : 0)}) · ${fmt(tO)} vs ${fmt(tH)} m³</span></div>
    <div><span>Salt flush vs. Weather-Only</span><b>+${fmt(Math.max(0, saltFlushM3))} m³</b><span>extra water to leach salts (${fmt(tO)} vs ${fmt(tW)} m³)</span></div>
    <div><span>Est. value of salt management</span><b class="${saltNetValueAED >= 0 ? 'good' : 'warn'}">${saltNetValueAED >= 0 ? '+' : '−'}${fmt(Math.abs(saltNetValueAED))} AED</b><span>+${fmt(saltYieldProtectedAED)} AED est. crop protected vs weather-only</span></div>
    <div><span>Est. total benefit vs. Habit</span><b class="${habitNetAED >= 0 ? 'good' : 'bad'}">${fmt(habitNetAED)} AED</b><span>water cost diff + est. stress protection</span></div>`;

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
  $('#compareChart').innerHTML = results.map(r => `<div style="margin:.4rem 0"><div class="muted">${r.bi + 1}. ${esc(r.b.name)} (${trendLabel(r.eo.saltTrend)} under Saqi · ${r.ew.saltTrend === 'increasing' ? '<span class="bad">↑ salt rises under weather-only</span>' : 'stable under weather-only'})</div>
    <div class="row"><span style="width:62px" class="muted">Saqi</span><div class="bar" style="flex:1"><i style="width:${r.weekOurs / maxV * 100}%"></i></div><span style="width:70px" class="muted mono">${fmt(r.weekOurs)} m³</span></div>
    <div class="row"><span style="width:62px" class="muted">Wx-only</span><div class="bar" style="flex:1"><i style="width:${r.weekWeatherOnly / maxV * 100}%;background:var(--warn)"></i></div><span style="width:70px" class="muted mono">${fmt(r.weekWeatherOnly)} m³</span></div>
    <div class="row"><span style="width:62px" class="muted">Habit</span><div class="bar" style="flex:1"><i style="width:${r.weekHabit / maxV * 100}%;background:var(--destructive)"></i></div><span style="width:70px" class="muted mono">${fmt(r.weekHabit)} m³</span></div></div>`).join('') +
    `<p class="muted">Model note: Weekly water balance constrained by drainage capacity (${drainage}). Effective leaching sets steady-state modeled root-zone ECe (FAO-29 Rhoades); modeled ECe → estimated relative yield (Maas-Hoffman); water deficit → Ky (FAO-33). All yields and ECe values are <b>estimates</b>, not guaranteed field yields.</p>`;

  renderVoice();
}

/* ---------- Voice ---------- */
function voiceLines(lang) {
  const L = k => PHRASES[k][lang];
  const lines = [];
  const hotSoon = wx.days.slice(0, 3).some(d => d.tmax >= +state.heatThreshold);
  if (hotSoon) lines.push(L('heat'));
  results.forEach(r => {
    const v = r.bi + 1, m = round5(r.today.minutes);
    lines.push(m < 5 ? L('none').replace('{v}', v) : L('run').replace('{v}', v).replace('{m}', m).replace('{t}', state.startTime));
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
function renderVoice() {
  const lang = state.lang; const lines = voiceLines(lang);
  const sel = $('#voiceLang');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${l.name}</option>`).join('');
    sel.onchange = () => { state.lang = sel.value; save(); renderVoice(); };
    $('#playAll').onclick = () => { speechSynthesis.cancel(); speak(voiceLines(state.lang).join(' '), state.lang); };
    $('#copyVoice').onclick = () => { navigator.clipboard?.writeText(voiceLines(state.lang).join('\n')).then(() => toast('Copied')); };
  }
  sel.value = lang;
  $('#voiceLines').innerHTML = lines.map((l, i) => `<div class="voice-line" dir="${LANGS[lang].dir}"><button class="btn sm ghost" data-say="${i}">▶</button><span class="txt">${esc(l)}</span></div>`).join('');
  $$('[data-say]').forEach(b => b.onclick = () => { speechSynthesis.cancel(); speak(lines[+b.dataset.say], lang); });
  const msg = lines.join('\n');
  $('#waLink').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('#smsLink').href = 'sms:?&body=' + encodeURIComponent(msg);
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
    if (document.activeElement !== el) el.value = getPath(state, el.dataset.bind);
    if (!el._bound) {
      el._bound = true;
      el.addEventListener('change', async () => {
        setPath(state, el.dataset.bind, el.type === 'number' ? (+el.value || 0) : el.value);
        save(); renderAll();
      });
    }
  });
}

/* ---------- homepage Zone A simulator ---------- */
let simCond = { ...Engine.HOME_SCENARIOS.normal.conditions };
function renderHomeSim() {
  const d = Engine.decideZoneA(simCond);
  $('#valTemp').textContent = simCond.temperature + '°C';
  $('#valSal').textContent = simCond.salinity.toFixed(1) + ' dS/m';
  $('#valMoist').textContent = simCond.moisture + '%';
  $('#valHum').textContent = simCond.humidity + '%';

  $('#hpSavedLitres').textContent = fmt(d.savedLitres);
  $('#hpSavedBadge').textContent = `${d.savedPct}% less than habit`;
  $('#hpTradL').textContent = fmt(d.traditionalLitres) + ' L';
  $('#hpSmartL').textContent = fmt(d.smartLitres) + ' L';
  $('#hpSmartBar').style.width = `${(d.smartLitres / d.traditionalLitres) * 100}%`;

  $('#resSavedPct').textContent = d.savedPct + '%';
  $('#resSavedL').textContent = fmt(d.savedLitres) + ' L';

  $('#simMins').textContent = d.totalMinutes + ' mins';
  const fl = $('#simFlush');
  fl.style.display = d.flushPct > 0 ? 'inline-flex' : 'none';
  fl.querySelector('span').textContent = `Add ${d.flushPct}% salt-leaching flush`;
  $('#simReason').textContent =
    (simCond.moisture < 23 ? 'Dry soil and ' : 'Current moisture and ') +
    (simCond.temperature >= 43 ? 'extreme heat increase crop demand. ' : 'the heat set the base run time. ') +
    (d.flushPct > 0 ? 'The extra flush moves salt below the root zone instead of letting it build up.' : 'No extra salt flush is needed at this salinity.');
  $('#simRisk').textContent = `${d.stressRisk} crop stress risk`;
  $('#simLitres').textContent = `${fmt(d.smartLitres)} litres total`;

  $('#cmpTradL').textContent = fmt(d.traditionalLitres) + ' L';
  $('#cmpSmartL').textContent = fmt(d.smartLitres) + ' L';
  $('#cmpTradRisk').textContent = d.traditionalStressRisk;
  $('#cmpSmartRisk').textContent = d.stressRisk;
  $('#cmpSavedPct').textContent = d.savedPct + '%';
  $('#cmpSavedL').textContent = fmt(d.savedLitres);
}
function initHomeSim() {
  const syncSliders = () => {
    $('#slTemp').value = simCond.temperature;
    $('#slSal').value = simCond.salinity;
    $('#slMoist').value = simCond.moisture;
    $('#slHum').value = simCond.humidity;
  };
  $$('#simScenarios button').forEach(b => b.onclick = () => {
    const sc = b.dataset.sim;
    simCond = { ...Engine.HOME_SCENARIOS[sc].conditions };
    $$('#simScenarios button').forEach(x => x.classList.toggle('active', x === b));
    syncSliders(); renderHomeSim();
  });
  const bindSlider = (id, key) => $(id).addEventListener('input', e => {
    simCond[key] = +e.target.value;
    $$('#simScenarios button').forEach(x => x.classList.remove('active'));
    renderHomeSim();
  });
  bindSlider('#slTemp', 'temperature'); bindSlider('#slSal', 'salinity');
  bindSlider('#slMoist', 'moisture'); bindSlider('#slHum', 'humidity');
  $('#simCopy').onclick = async () => {
    const d = Engine.decideZoneA(simCond);
    const msg = `Irrigate Zone A for ${d.totalMinutes} mins at 4:30 AM${d.flushPct > 0 ? ` — Add ${d.flushPct}% salt-leaching flush` : ''}.`;
    try { await navigator.clipboard.writeText(msg); toast('Watering instruction copied'); }
    catch { toast(msg); }
  };
  renderHomeSim();
}

/* ---------- tabs & init ---------- */
const TAB_ORDER = ['home', 'today', 'farm', 'blend', 'sensor', 'drip', 'planner', 'harvest', 'share', 'adviser', 'about'];
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
  if (!instant && activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  if (id === 'farm' && typeof lmap !== 'undefined' && lmap) setTimeout(() => lmap.invalidateSize(), 80);
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
  bindInputs(); updateNet();
  $$('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); showTab(a.dataset.goto); window.scrollTo({ top: 0, behavior: 'smooth' }); });
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
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
      if (!el.classList.contains('in-view')) {
        requestAnimationFrame(() => el.classList.add('in-view'));
      }
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
  initScrollMotion();
  initTranslatorUI();
  $('#themeToggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { }
    applyTheme(next);
  };

  const toolsMenu = $('#toolsMenu'), toolsBtn = $('#toolsBtn');
  const setMenu = open => { toolsMenu.hidden = !open; toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  toolsBtn.onclick = e => { e.stopPropagation(); setMenu(toolsMenu.hidden); };
  document.addEventListener('mousedown', e => { if (!$('#toolsWrap').contains(e.target)) setMenu(false); });
  $$('.main-links [data-tab]').forEach(b => b.onclick = () => { showTab(b.dataset.tab); window.scrollTo({ top: 0, behavior: 'smooth' }); });

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
