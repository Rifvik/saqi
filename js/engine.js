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

  /* Daily irrigation decision for one block. block.area in ha, block.flow in m³/h. */
  function blockDecision(block, crop, wx, ecw, preHeat = false) {
    const kc = kcAt(crop, block.day);
    const etc = kc * wx.et0;
    const effRain = wx.rain > 5 ? 0.8 * wx.rain : 0;
    const netNeed = Math.max(0, etc - effRain);
    const Ea = SYSTEMS[block.system].eff;
    let LR = leachingReq(ecw, crop.ecThr);
    let unsuitable = false;
    if (LR === null || LR > MAX_LR) { unsuitable = true; LR = MAX_LR; }
    const heatFactor = preHeat ? 1.10 : 1;
    const grossMm = (netNeed * heatFactor) / ((1 - LR) * Ea);
    const m3 = grossMm * block.area * 10; // 1 mm over 1 ha = 10 m³
    const minutes = block.flow > 0 ? m3 / block.flow * 60 : 0;
    return { kc, etc, effRain, netNeed, LR, unsuitable, preHeat: Boolean(preHeat), Ea, grossMm, m3, minutes, stage: stageName(crop, block.day) };
  }

  /* What happens to the crop if a given volume is applied over a period whose net crop need is etcMm.
   * Combines water-stress loss (FAO-33 Ky) and salt build-up (leaching fraction → root-zone ECe → Maas-Hoffman). */
  function evaluate(crop, block, m3, etcMm, ecw) {
    const Ea = SYSTEMS[block.system].eff;
    const inf = block.area > 0 ? m3 / (block.area * 10) * Ea : 0;
    let lf, stress = 1;
    if (etcMm <= 0) lf = 1;
    else if (inf >= etcMm) lf = (inf - etcMm) / inf;
    else { lf = 0.02; stress = clamp(1 - crop.ky * (1 - inf / etcMm), 0, 1); }
    lf = Math.max(lf, 0.02);
    const ece = rootzoneECe(ecw, lf);
    const ys = salinityYield(crop, ece);
    return { inf, lf, ece, ys, stress, y: ys * stress, ratio: etcMm > 0 ? inf / etcMm : 1 };
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

  /* Blend two water sources: maximise daily profit (revenue × yield − water cost). */
  function optimiseBlend({ netMm, area, Ea, crop, A, B, dailyRevenue }) {
    const curve = [];
    for (let i = 0; i <= 100; i++) {
      const f = i / 100;
      const ecw = (1 - f) * A.ec + f * B.ec;
      let LR = leachingReq(ecw, crop.ecThr), capped = false;
      if (LR === null || LR > 0.4) { LR = 0.4; capped = true; }
      const ece = capped ? rootzoneECe(ecw, LR) : crop.ecThr;
      const y = salinityYield(crop, ece);
      const V = netMm * area * 10 / ((1 - LR) * Ea);
      const vB = f * V;
      const feasible = vB <= B.max + 1e-9;
      const cost = V * ((1 - f) * A.cost + f * B.cost);
      const profit = dailyRevenue * y - cost;
      curve.push({ f, ecw, LR, capped, y, V, vA: V - vB, vB, cost, profit, feasible });
    }
    const feas = curve.filter(p => p.feasible);
    const best = feas.reduce((a, b) => (b.profit > a.profit ? b : a), feas[0] || curve[0]);
    return { curve, best, freshOnly: curve[0], wellOnly: curve[100] };
  }

  /* Whole-season water and economics for a crop, using monthly climate normals. */
  function seasonPlan(crop, ecw, Ea, et0Month) {
    const L = seasonLength(crop);
    let LR = leachingReq(ecw, crop.ecThr), capped = false;
    if (LR === null || LR > 0.4) { LR = 0.4; capped = true; }
    const ece = capped ? rootzoneECe(ecw, LR) : Math.min(crop.ecThr, rootzoneECe(ecw, Math.max(LR, 0.02)));
    const ys = salinityYield(crop, ece);
    let tot = 0, peak = 0;
    const start = new Date(2026, crop.perennial ? 0 : crop.plantMonth - 1, 1);
    for (let d = 0; d < L; d++) {
      const dt = new Date(start.getTime() + d * 864e5);
      const g = kcAt(crop, d) * et0Month[dt.getMonth()] / ((1 - LR) * Ea) * 10;
      tot += g; if (g > peak) peak = g;
    }
    return { L, LR, capped, ys, totM3: tot, peakM3: peak };
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

  /* Homepage interactive Zone A simulator (2 ha drip-irrigated date palms, 40 m³/h flow). */
  const HOME_SCENARIOS = {
    normal:   { label: 'Normal Day',               conditions: { temperature: 42, salinity: 4.8,  moisture: 26, humidity: 32 } },
    heatwave: { label: '48°C Heatwave',            conditions: { temperature: 48, salinity: 4.8,  moisture: 18, humidity: 18 } },
    salinity: { label: 'High Soil Salinity Spike', conditions: { temperature: 42, salinity: 10.5, moisture: 26, humidity: 32 } },
  };
  function decideZoneA({ temperature, salinity, moisture, humidity }) {
    const baseMinutes = Math.round(clamp(
      11 + Math.max(0, temperature - 35) * 0.35 + Math.max(0, 28 - moisture) * 0.25 + Math.max(0, 35 - humidity) * 0.04,
      6, 24
    ));
    const flushPct = Math.round(clamp(Math.max(0, salinity - 3) * 4, 0, 25));
    const totalMinutes = Math.min(30, Math.round(baseMinutes * (1 + flushPct / 100)));
    const smartLitres = Math.round((totalMinutes / 60) * 40000);
    const traditionalLitres = 20000;
    const savedLitres = traditionalLitres - smartLitres;
    const savedPct = Math.round((savedLitres / traditionalLitres) * 100);
    const stressRisk = (salinity >= 8 || moisture < 16 || temperature >= 48) ? 'High'
      : (salinity >= 5 || moisture < 23 || temperature >= 43) ? 'Moderate' : 'Low';
    const traditionalStressRisk = (salinity >= 5 || temperature >= 45) ? 'High' : 'Moderate';
    return { baseMinutes, flushPct, totalMinutes, smartLitres, traditionalLitres, savedLitres, savedPct, stressRisk, traditionalStressRisk };
  }

  return { kcAt, stageName, seasonLength, hargreavesET0, leachingReq, rootzoneECe, salinityYield,
           blockDecision, evaluate, flowCheck, dayLossPct, optimiseBlend, seasonPlan, shareWater,
           HOME_SCENARIOS, decideZoneA, sum, clamp };
})();
if (typeof module !== 'undefined') module.exports = Engine;
