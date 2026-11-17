'use strict';
/* Saqi decision engine — pure functions, no DOM. */
const Engine = (() => {
  const sum = a => a.reduce((x, y) => x + y, 0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* FAO-56 single crop coefficient curve. */
  function kcAt(crop, day) {
    if (crop.perennial) return crop.kc[1];
    const [Li, Ld, Lm, Ll] = crop.stages;
    const [ki, km, ke] = crop.kc;
    if (day <= Li) return ki;
    if (day <= Li + Ld) return ki + (km - ki) * (day - Li) / Ld;
    if (day <= Li + Ld + Lm) return km;
    if (day <= Li + Ld + Lm + Ll) return km + (ke - km) * (day - Li - Ld - Lm) / Ll;
    return ke;
  }

  function stageName(crop, day) {
    if (crop.perennial) return 'established';
    const [Li, Ld, Lm, Ll] = crop.stages;
    if (day <= Li) return 'initial';
    if (day <= Li + Ld) return 'development';
    if (day <= Li + Ld + Lm) return 'mid-season';
    if (day <= Li + Ld + Lm + Ll) return 'late season';
    return 'past harvest';
  }

  const seasonLength = crop => crop.perennial ? 365 : sum(crop.stages);

  /* Hargreaves ET0 (FAO-56 eq. 52) — offline backup when only temperatures are known. */
  function hargreavesET0(tmax, tmin, lat, doy) {
    const phi = lat * Math.PI / 180;
    const dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
    const delta = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
    const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
    const Ra = 24 * 60 / Math.PI * 0.0820 * dr *
      (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
    const tmean = (tmax + tmin) / 2;
    return Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * Ra * 0.408);
  }

  /* Leaching requirement (Rhoades, FAO-29): LR = ECw / (5·ECe_threshold − ECw).
   * Returns null when the water is too salty to keep the crop at full yield. */
  function leachingReq(ecw, ecThr) {
    const d = 5 * ecThr - ecw;
    if (d <= 0) return null;
    return ecw / d;
  }

  /* Steady-state average root-zone salinity for a given leaching fraction (inverse of the above). */
  function rootzoneECe(ecw, lf) {
    lf = Math.max(lf, 0.02);
    return ecw * (1 + lf) / (5 * lf);
  }

  /* Maas–Hoffman relative yield. */
  function salinityYield(crop, ece) {
    if (ece <= crop.ecThr) return 1;
    return clamp(1 - crop.ecSlope / 100 * (ece - crop.ecThr), 0, 1);
  }

  const MAX_LR = 0.5;

  function maxDrainLF(drainage = 'good') {
    if (typeof DRAINAGE !== 'undefined' && DRAINAGE[drainage]) return DRAINAGE[drainage].maxLF;
    return drainage === 'poor' ? 0.05 : drainage === 'moderate' ? 0.20 : 0.45;
  }

  /* Total block flow (m³/h): supports either emitter flow (L/h) × count OR direct block flow (m³/h). */
  function resolveBlockFlow(block) {
    if (block.flowMode === 'emitters' && block.emitterLph > 0 && block.emitterCount > 0) {
      return +(block.emitterLph * block.emitterCount / 1000).toFixed(3);
    }
    return +block.flow || 0;
  }

  /* Daily irrigation decision for one block. block.area in ha, flow in m³/h (block total, never per-emitter). */
  function blockDecision(block, crop, wx, ecw, preHeat = false, drainage = 'good', soilECe = null) {
    const kc = kcAt(crop, block.day);
    const etc = kc * wx.et0;
    const effRain = wx.rain > 5 ? 0.8 * wx.rain : 0;
    const netNeed = Math.max(0, etc - effRain);
    const Ea = block.eaOverride || SYSTEMS[block.system].eff;
    const drainCap = Math.min(MAX_LR, maxDrainLF(drainage));
    const rawLR = leachingReq(ecw, crop.ecThr);
    const soilReclaim = (soilECe != null && soilECe > crop.ecThr) ? clamp((soilECe - crop.ecThr) * 0.025, 0, 0.15) : 0;
    let LR = rawLR === null ? drainCap : rawLR + soilReclaim, drainageBlocked = false;
    if (rawLR === null || LR > drainCap) {
      LR = drainCap;
      drainageBlocked = (rawLR === null || rawLR > drainCap);
    }
    const modeledECe = rootzoneECe(ecw, Math.max(LR, 0.02));
    const unsuitable = drainageBlocked && modeledECe > crop.ecThr * 1.15;
    const heatFactor = preHeat ? 1.10 : 1;
    // Leaching fraction LR and system efficiency Ea are each applied exactly once (no double counting).
    const grossMm = (netNeed * heatFactor) / ((1 - LR) * Ea);
    const m3 = grossMm * block.area * 10; // 1 mm over 1 ha = 10 m³
    const flow = resolveBlockFlow(block);
    const invalidFlow = !(flow > 0);
    const minutes = !invalidFlow ? m3 / flow * 60 : null;
    return { kc, etc, effRain, netNeed, LR, rawLR, soilReclaim, drainCap, drainageBlocked, modeledECe, unsuitable, preHeat: Boolean(preHeat), Ea, grossMm, m3, flow, invalidFlow, minutes, stage: stageName(crop, block.day) };
  }

  /* Baseline #2: Weather-only irrigation (ET₀ × Kc / Ea) without salinity leaching management (LR = 0). */
  function weatherOnlyDecision(block, crop, wx) {
    const kc = kcAt(crop, block.day);
    const etc = kc * wx.et0;
    const effRain = wx.rain > 5 ? 0.8 * wx.rain : 0;
    const netNeed = Math.max(0, etc - effRain);
    const Ea = SYSTEMS[block.system].eff;
    const grossMm = netNeed / Ea;
    const m3 = grossMm * block.area * 10;
    const flow = resolveBlockFlow(block);
    const invalidFlow = !(flow > 0);
    const minutes = !invalidFlow ? m3 / flow * 60 : null;
    return { kc, etc, effRain, netNeed, Ea, grossMm, m3, flow, invalidFlow, minutes };
  }

  /* Estimated root-zone water & salinity balance over a period whose net crop ET need is etcMm.
   * Effective leaching is bounded by drainage capacity; excess beyond drainage causes waterlogging, not salt removal.
   * transient = { ece, ys, startECe } from saltForecast replaces the instant steady-state ECe (salt takes weeks to build). */
  function evaluate(crop, block, m3, etcMm, ecw, drainage = 'good', prevECe = null, transient = null) {
    const Ea = SYSTEMS[block.system].eff;
    const drainCap = maxDrainLF(drainage);
    const inf = block.area > 0 ? m3 / (block.area * 10) * Ea : 0;
    let rawLF, stress = 1;
    if (etcMm <= 0) rawLF = 1;
    else if (inf >= etcMm) rawLF = (inf - etcMm) / inf;
    else { rawLF = 0.02; stress = clamp(1 - crop.ky * (1 - inf / etcMm), 0, 1); }
    const effLF = Math.max(Math.min(rawLF, drainCap), 0.02);
    const waterlogged = etcMm > 0 && rawLF > drainCap + 0.04;
    const ece = transient ? transient.ece : rootzoneECe(ecw, effLF);
    const ys = transient ? transient.ys : salinityYield(crop, ece);
    const waterlogFactor = waterlogged ? clamp(1 - 0.35 * (rawLF - drainCap), 0.65, 1) : 1;
    let saltTrend = 'stable';
    // Rising only matters once it nears the crop threshold; settling up to a safe equilibrium is 'stable'.
    if (transient) saltTrend = (ece > transient.startECe + 0.15 && ece > crop.ecThr * 0.9) ? 'increasing' : ece < transient.startECe - 0.15 ? 'flushing' : 'stable';
    else if (drainage === 'poor' && ecw > 1.5) saltTrend = 'increasing';
    else if (prevECe != null) {
      if (ece > prevECe + 0.35) saltTrend = 'increasing';
      else if (ece < prevECe - 0.35) saltTrend = 'flushing';
    } else if (ece > crop.ecThr + 0.3) saltTrend = 'increasing';
    return { inf, lf: effLF, rawLF, waterlogged, ece, ys, stress, y: ys * stress * waterlogFactor, saltTrend, ratio: etcMm > 0 ? inf / etcMm : 1 };
  }

  /* Flow-meter anomaly check: expected vs measured flow (m³/h). */
  function flowCheck(log, expected) {
    if (!log || log.length < 2 || !expected) return { status: 'ok', ratio: 1 };
    const r = log.map(p => p.flow / expected);
    const last = r[r.length - 1], prev = r[r.length - 2];
    if (last < 0.88 && prev < 0.88) return { status: 'clog', ratio: last };
    if (last > 1.12) return { status: 'leak', ratio: last };
    return { status: 'ok', ratio: last };
  }

  /* Evaporation + drift loss for sprinkler/flood watering in daytime heat (approximate). */
  function dayLossPct(tmax, wind) { return clamp(5 + 0.6 * (tmax - 30) + 0.3 * wind, 5, 35); }

  /* Blend two water sources: maximise daily profit (revenue × yield − water cost) within drainage limits. */
  function optimiseBlend({ netMm, area, Ea, crop, A, B, dailyRevenue, drainage = 'good' }) {
    const drainCap = Math.min(MAX_LR, maxDrainLF(drainage));
    const curve = [];
    for (let i = 0; i <= 100; i++) {
      const f = i / 100;
      const ecw = (1 - f) * A.ec + f * B.ec;
      let LR = leachingReq(ecw, crop.ecThr), capped = false;
      if (LR === null || LR > drainCap) { LR = drainCap; capped = true; }
      const ece = rootzoneECe(ecw, Math.max(LR, 0.02));
      const y = salinityYield(crop, ece);
      const V = netMm * area * 10 / ((1 - LR) * Ea);
      const vB = f * V;
      const feasible = vB <= B.max + 1e-9;
      const cost = V * ((1 - f) * A.cost + f * B.cost);
      const profit = dailyRevenue * y - cost;
      curve.push({ f, ecw, LR, capped, drainCap, y, V, vA: V - vB, vB, cost, profit, feasible });
    }
    const feas = curve.filter(p => p.feasible);
    const best = feas.reduce((a, b) => (b.profit > a.profit ? b : a), feas[0] || curve[0]);
    return { curve, best, freshOnly: curve[0], wellOnly: curve[100], drainCap };
  }

  /* Whole-season water and crop suitability estimate (based on modeled root-zone ECe & drainage cap). */
  function seasonPlan(crop, ecw, Ea, et0Month, drainage = 'good') {
    const L = seasonLength(crop);
    const drainCap = Math.min(0.4, maxDrainLF(drainage));
    const rawLR = leachingReq(ecw, crop.ecThr);
    let LR = rawLR, capped = false;
    if (LR === null || LR > drainCap) { LR = drainCap; capped = true; }
    const modeledECe = capped ? rootzoneECe(ecw, Math.max(LR, 0.02)) : Math.min(crop.ecThr, rootzoneECe(ecw, Math.max(LR, 0.02)));
    const ys = salinityYield(crop, modeledECe);
    const suitability = (ys >= 0.90 && !(drainage === 'poor' && ecw > crop.ecThr)) ? 'Good' : ys >= 0.65 ? 'Marginal' : 'Poor';
    let tot = 0, peak = 0;
    const start = new Date(2026, crop.perennial ? 0 : crop.plantMonth - 1, 1);
    for (let d = 0; d < L; d++) {
      const dt = new Date(start.getTime() + d * 864e5);
      const g = kcAt(crop, d) * et0Month[dt.getMonth()] / ((1 - LR) * Ea) * 10;
      tot += g; if (g > peak) peak = g;
    }
    return { L, LR, drainCap, capped, modeledECe, ys, suitability, totM3: tot, peakM3: peak };
  }

  /* Share a well between neighbours: everyone keeps their right; unused rights are sold to those short. */
  function shareWater(farms, cap, price) {
    const rows = farms.map(f => {
      const right = cap * f.share / 100;
      return { ...f, right, alloc: Math.min(f.need, right), surplus: Math.max(0, right - f.need), deficit: Math.max(0, f.need - right) };
    });
    const S = sum(rows.map(r => r.surplus)), D = sum(rows.map(r => r.deficit));
    const used = Math.min(S, D);
    rows.forEach(r => {
      r.sold = S > 0 ? r.surplus * used / S : 0;
      r.bought = D > 0 ? r.deficit * used / D : 0;
      r.alloc += r.bought;
      r.aed = (r.sold - r.bought) * price;
      r.short = r.need - r.alloc;
    });
    return { rows, traded: used, unused: S - used, totalShare: sum(farms.map(f => f.share)) };
  }

  /* Prediction uncertainty: re-run the same decision at the low/high edges of the input error
   * (ET0 forecast error, EC-pen accuracy, irrigation efficiency) so the farmer sees a range, not false precision. */
  function runtimeRange(block, crop, wx, ecw, { uEt = 0.10, preHeat = false, drainage = 'good', soilECe = null } = {}) {
    const U = (typeof UNCERTAINTY !== 'undefined') ? UNCERTAINTY : { ecwRel: 0.02, ecwAbs: 0.10, ea: 0.05 };
    const dEc = ecw * U.ecwRel + U.ecwAbs;
    const Ea = block.eaOverride || SYSTEMS[block.system].eff;
    const lo = blockDecision({ ...block, eaOverride: Math.min(0.98, Ea + U.ea) }, crop, { ...wx, et0: wx.et0 * (1 - uEt) }, Math.max(0, ecw - dEc), preHeat, drainage, soilECe);
    const hi = blockDecision({ ...block, eaOverride: Math.max(0.3, Ea - U.ea) }, crop, { ...wx, et0: wx.et0 * (1 + uEt) }, ecw + dEc, preHeat, drainage, soilECe);
    return { loMin: lo.minutes, hiMin: hi.minutes, loM3: lo.m3, hiM3: hi.m3, uEt, dEc, dEa: U.ea };
  }

  function dayOfYear(dateStr) {
    const d = new Date(dateStr + 'T12:00');
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  }

  /* Local calibration of the offline Hargreaves ET0 backup against live FAO-56 Penman-Monteith forecasts
   * (ratio of sums). Applied when the app later falls back to climate normals with no network. */
  function hargreavesBias(days, lat) {
    const ok = (days || []).filter(d => d && d.et0 > 0 && isFinite(d.tmax) && isFinite(d.tmin) && d.date);
    if (ok.length < 3) return null;
    const pm = sum(ok.map(d => d.et0));
    const hg = sum(ok.map(d => hargreavesET0(d.tmax, d.tmin, lat, dayOfYear(d.date))));
    if (!(hg > 0)) return null;
    return clamp(pm / hg, 0.6, 1.5);
  }

  /* Transient root-zone salt balance (daily bucket), so salinity is a trajectory over weeks, not an instant
   * steady state. Salt store = ECe × We, with We = 2 × water held at field capacity (ECsw ≈ 2·ECe, FAO-29).
   * Drainage = water above crop ET, capped by the farm drainage class; drainage-water EC = 5·ECe/(1+LF),
   * which makes the long-run equilibrium identical to the FAO-29 Rhoades steady state used elsewhere.
   * applied[] = infiltrated water (mm/day); etc[] = net crop water need (mm/day). */
  function saltForecast({ crop, ecw, startECe, applied, etc, drainage = 'good', fcPct = 10 }) {
    const drainCap = maxDrainLF(drainage);
    const We = 2 * (fcPct / 100) * (crop.rootM || 1) * 1000;
    let ece = Math.max(0, +startECe || 0), crossDay = null;
    const series = [];
    for (let t = 0; t < applied.length; t++) {
      const I = Math.max(0, applied[t] || 0), E = Math.max(0, etc[t] || 0);
      const D = Math.min(Math.max(0, I - E), drainCap * I);
      const lf = I > 0 ? D / I : 0;
      const saltIn = I * ecw;
      const saltOut = Math.min(D * 5 * ece / (1 + Math.max(lf, 0.02)), saltIn + ece * We);
      ece = Math.max(0, ece + (saltIn - saltOut) / We);
      series.push({ day: t + 1, ece, y: salinityYield(crop, ece), lf, waterlogged: I - E > drainCap * I + 0.04 * I });
      if (crossDay === null && ece > crop.ecThr) crossDay = t + 1;
    }
    const meanY = series.length ? sum(series.map(p => p.y)) / series.length : 1;
    return { series, crossDay, endECe: ece, meanY, startAbove: startECe > crop.ecThr, We };
  }

  /* Homepage Zone A simulator powered by FAO-56 Hargreaves + FAO-29 Rhoades blockDecision (2 ha date palms, 40 m³/h, 240-min habit = 160,000 L). */
  const HOME_SCENARIOS = {
    normal:   { label: 'Normal Day',               conditions: { temperature: 34, ecw: 3.0, salinity: 3.0, moisture: 10, humidity: 35 } },
    heatwave: { label: '48°C Heatwave',            conditions: { temperature: 48, ecw: 3.0, salinity: 3.0, moisture: 6,  humidity: 18 } },
    salinity: { label: 'High Water Salinity Spike', conditions: { temperature: 34, ecw: 6.5, salinity: 6.5, moisture: 10, humidity: 35 } },
  };
  function decideZoneA({ temperature, ecw, salinity, moisture = 10, humidity = 35, drainage = 'good' }) {
    const waterEc = +(ecw ?? salinity ?? 3.0);
    const doy = Math.round(clamp(312 - Math.max(0, temperature - 33) * 8.5, 185, 325));
    const dT = clamp(17 - 0.14 * humidity, 7, 17);
    const baseEt0 = hargreavesET0(temperature, temperature - dT, 24.21, doy);
    // Moisture adjustment anchored on sandy soil reserve (WP 4%, refill 7%, FC 10%)
    const moistFactor = moisture < 7 ? clamp(1 + (7 - moisture) * 0.04, 1, 1.15)
      : moisture > 14 ? clamp(1 - (moisture - 14) * 0.015, 0.72, 1) : 1.0;
    const et0 = baseEt0 * moistFactor;
    const crop = (typeof CROPS !== 'undefined' && CROPS.date) ? CROPS.date : { kc: [0.9, 0.95, 0.95], perennial: true, stages: [0, 0, 365, 0], ecThr: 4.0, ecSlope: 3.6, ky: 0.8 };
    const block = { crop: 'date', area: 2.0, day: 180, system: 'drip', flow: 40, habitMin: 240 };
    const dec = blockDecision(block, crop, { et0, rain: 0 }, waterEc, temperature >= 45, drainage);
    const wxOnly = weatherOnlyDecision(block, crop, { et0, rain: 0 });
    // Each strategy is scored as if repeated for 90 days (one summer), using the transient salt balance (not instant steady state).
    const startECe = crop.ecThr * 0.8, DAYS = 90;
    const trans = m3 => {
      const I = m3 / (block.area * 10) * dec.Ea;
      const f = saltForecast({ crop, ecw: waterEc, startECe, applied: Array(DAYS).fill(I), etc: Array(DAYS).fill(dec.netNeed), drainage });
      return { ece: f.endECe, ys: f.meanY, startECe };
    };
    const evalSmart = evaluate(crop, block, dec.m3, dec.etc, waterEc, drainage, null, trans(dec.m3));
    const evalWx = evaluate(crop, block, wxOnly.m3, dec.etc, waterEc, drainage, null, trans(wxOnly.m3));
    const traditionalLitres = Math.round(block.habitMin / 60 * block.flow * 1000);
    const evalHabit = evaluate(crop, block, traditionalLitres / 1000, dec.etc, waterEc, drainage, null, trans(traditionalLitres / 1000));

    const flushPct = Math.round((1 / Math.max(0.1, 1 - dec.LR) - 1) * 100);
    const totalMinutes = Math.round((dec.minutes || 0) / 5) * 5;
    const baseMinutes = Math.round((wxOnly.minutes || 0) / 5) * 5;
    const smartLitres = Math.round(dec.m3 * 1000);
    const weatherOnlyLitres = Math.round(wxOnly.m3 * 1000);
    const savedLitres = traditionalLitres - smartLitres;
    const savedPct = Math.round((savedLitres / traditionalLitres) * 100);
    const riskFrom = (ev, capped = false) => (ev.y < 0.70 || capped) ? 'High' : ev.y < 0.94 ? 'Moderate' : 'Low';
    const stressRisk = riskFrom(evalSmart, dec.drainageBlocked);
    const weatherStressRisk = riskFrom(evalWx, false);
    const traditionalStressRisk = evalHabit.y < 0.70 ? 'High' : evalHabit.y < 0.94 ? 'Moderate' : (traditionalLitres > smartLitres * 1.25 ? 'Waste (+excess)' : 'Moderate');
    return {
      et0: +et0.toFixed(2), ecw: waterEc, LR: dec.LR, modeledECe: dec.modeledECe,
      baseMinutes, flushPct, totalMinutes,
      smartLitres, weatherOnlyLitres, traditionalLitres, savedLitres, savedPct,
      stressRisk, weatherStressRisk, traditionalStressRisk,
      smartYieldPct: Math.round(evalSmart.y * 100),
      wxYieldPct: Math.round(evalWx.y * 100),
      habitYieldPct: Math.round(evalHabit.y * 100),
    };
  }

  /* WGS84 local metre conversion, geodesic polygon area/perimeter, and sub-plot grid generator. */
  function metersScale(lat) {
    const r = lat * Math.PI / 180;
    return {
      mLat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
      mLon: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
    };
  }
  function rectPolygon(lat, lon, widthM = 200, heightM = 100) {
    const { mLat, mLon } = metersScale(lat);
    const dLat = (heightM / 2) / mLat, dLon = (widthM / 2) / mLon;
    return [
      { lat: +(lat + dLat).toFixed(6), lon: +(lon - dLon).toFixed(6) },
      { lat: +(lat + dLat).toFixed(6), lon: +(lon + dLon).toFixed(6) },
      { lat: +(lat - dLat).toFixed(6), lon: +(lon + dLon).toFixed(6) },
      { lat: +(lat - dLat).toFixed(6), lon: +(lon - dLon).toFixed(6) },
    ];
  }
  function pointInPoly(x, y, xy) {
    let inside = false;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
      const xi = xy[i][0], yi = xy[i][1], xj = xy[j][0], yj = xy[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }
  function polygonStats(pts, cellM = 25) {
    if (!pts || pts.length < 3) return { areaM2: 0, areaHa: 0, perimM: 0, cells: 0, lines: [], center: pts?.[0] || { lat: 24.21, lon: 55.74 } };
    const lat0 = sum(pts.map(p => p.lat)) / pts.length;
    const lon0 = sum(pts.map(p => p.lon)) / pts.length;
    const { mLat, mLon } = metersScale(lat0);
    const xy = pts.map(p => [(p.lon - lon0) * mLon, (p.lat - lat0) * mLat]);
    let area2 = 0, perimM = 0;
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
      area2 += x1 * y2 - x2 * y1;
      perimM += Math.hypot(x2 - x1, y2 - y1);
    }
    const areaM2 = Math.abs(area2) * 0.5;
    const areaHa = areaM2 / 10000;
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const step = Math.max(5, +cellM || 25);
    const maxSpan = Math.max(xMax - xMin, yMax - yMin);
    const effStep = maxSpan / step > 60 ? maxSpan / 60 : step;
    const lines = [];
    for (let x = Math.ceil(xMin / effStep) * effStep; x <= xMax; x += effStep) {
      lines.push([[lat0 + yMin / mLat, lon0 + x / mLon], [lat0 + yMax / mLat, lon0 + x / mLon]]);
    }
    for (let y = Math.ceil(yMin / effStep) * effStep; y <= yMax; y += effStep) {
      lines.push([[lat0 + y / mLat, lon0 + xMin / mLon], [lat0 + y / mLat, lon0 + xMax / mLon]]);
    }
    let cells = 0;
    for (let x = xMin + effStep / 2; x < xMax; x += effStep) {
      for (let y = yMin + effStep / 2; y < yMax; y += effStep) {
        if (pointInPoly(x, y, xy)) cells++;
      }
    }
    if (!cells && areaM2 > 0) cells = Math.max(1, Math.round(areaM2 / (step * step)));
    return { areaM2, areaHa, perimM, cells, cellM: step, lines, center: { lat: lat0, lon: lon0 } };
  }

  return { kcAt, stageName, seasonLength, hargreavesET0, leachingReq, rootzoneECe, salinityYield,
           resolveBlockFlow, blockDecision, weatherOnlyDecision, evaluate, flowCheck, dayLossPct,
           optimiseBlend, seasonPlan, shareWater, HOME_SCENARIOS, decideZoneA, metersScale,
           rectPolygon, polygonStats, runtimeRange, hargreavesBias, saltForecast, dayOfYear, sum, clamp };
})();
if (typeof module !== 'undefined') module.exports = Engine;
