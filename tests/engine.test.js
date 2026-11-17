'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8'));

test('FAO-29 leaching requirement and ECw salt ceiling', () => {
  const lr = Engine.leachingReq(3.0, 4.0);
  assert(Math.abs(lr - 3 / 17) < 1e-6);
  // Water too salty for tomato full yield (5 * 2.5 = 12.5 dS/m)
  assert.equal(Engine.leachingReq(13.0, 2.5), null);
});

test('blockDecision applies leaching and Ea once without double counting', () => {
  const blk = { crop: 'tomato', area: 1, day: 60, system: 'drip', flowMode: 'direct', flow: 10 };
  const dec = Engine.blockDecision(blk, CROPS.tomato, { et0: 7, rain: 0 }, 3.2, false, 'good');
  const expectedGross = dec.netNeed / ((1 - dec.LR) * dec.Ea);
  assert(Math.abs(dec.grossMm - expectedGross) < 1e-6);
  const wxOnly = Engine.weatherOnlyDecision(blk, CROPS.tomato, { et0: 7, rain: 0 });
  assert(dec.m3 > wxOnly.m3, 'Salt-aware decision adds leaching above weather-only');
  assert(Math.abs(wxOnly.grossMm - wxOnly.netNeed / wxOnly.Ea) < 1e-6);
});

test('emitter count × flow auto-calculates block flow accurately', () => {
  const blk = { crop: 'tomato', area: 0.5, system: 'drip', flowMode: 'emitters', emitterLph: 4, emitterCount: 100 };
  assert.equal(Engine.resolveBlockFlow(blk), 0.4);
  const b2 = { crop: 'tomato', area: 0.5, system: 'drip', flowMode: 'emitters', emitterLph: 4, emitterCount: 3000 };
  assert.equal(Engine.resolveBlockFlow(b2), 12);
});

test('zero or negative flow flags invalidFlow and has flowZero phrases in all 5 worker languages', () => {
  const blk = { crop: 'date', area: 2, day: 10, system: 'drip', flowMode: 'direct', flow: 0 };
  const dec = Engine.blockDecision(blk, CROPS.date, { et0: 5, rain: 0 }, 3.0, false, 'good');
  assert.equal(dec.invalidFlow, true);
  assert.equal(dec.minutes, null);
  assert(dec.m3 > 0, 'Crop volume requirement is still reported even when flow is invalid');
  for (const lang of ['en', 'ar', 'ur', 'hi', 'bn']) {
    assert(typeof PHRASES.flowZero?.[lang] === 'string' && PHRASES.flowZero[lang].includes('{v}'));
  }
});

test('poor drainage caps leaching fraction and flags salt accumulation risk', () => {
  const blk = { crop: 'tomato', area: 1, day: 60, system: 'drip', flowMode: 'direct', flow: 10 };
  const dec = Engine.blockDecision(blk, CROPS.tomato, { et0: 6, rain: 0 }, 5.0, false, 'poor');
  assert.equal(dec.drainageBlocked, true);
  assert.equal(dec.drainCap, DRAINAGE.poor.maxLF);
  assert(dec.LR <= DRAINAGE.poor.maxLF + 1e-9);
  const ev = Engine.evaluate(CROPS.tomato, blk, dec.m3, dec.etc, 5.0, 'poor');
  assert.equal(ev.saltTrend, 'increasing');
});

test('optional measured soil ECe triggers bounded reclamation flush when enabled', () => {
  const blk = { crop: 'tomato', area: 1, day: 60, system: 'drip', flowMode: 'direct', flow: 10 };
  const base = Engine.blockDecision(blk, CROPS.tomato, { et0: 5, rain: 0 }, 2.0, false, 'good', null);
  const withSoil = Engine.blockDecision(blk, CROPS.tomato, { et0: 5, rain: 0 }, 2.0, false, 'good', 7.5);
  assert(withSoil.LR > base.LR && withSoil.soilReclaim > 0);
  assert(withSoil.LR <= withSoil.drainCap);
});

test('optimiseBlend honors farm drainage class limit', () => {
  const goodBlend = Engine.optimiseBlend({ netMm: 5, area: 1, Ea: 0.9, crop: CROPS.tomato, A: { ec: 0.4, cost: 5 }, B: { ec: 9.0, cost: 0.5, max: 200 }, dailyRevenue: 300, drainage: 'good' });
  const poorBlend = Engine.optimiseBlend({ netMm: 5, area: 1, Ea: 0.9, crop: CROPS.tomato, A: { ec: 0.4, cost: 5 }, B: { ec: 9.0, cost: 0.5, max: 200 }, dailyRevenue: 300, drainage: 'poor' });
  assert.equal(poorBlend.drainCap, DRAINAGE.poor.maxLF);
  assert(poorBlend.wellOnly.LR <= DRAINAGE.poor.maxLF + 1e-9);
  assert(goodBlend.wellOnly.LR > poorBlend.wellOnly.LR);
});

test('Zone A simulator uses FAO engine with aligned 160,000 L habit and honest heatwave framing', () => {
  const norm = Engine.decideZoneA(Engine.HOME_SCENARIOS.normal.conditions);
  const heat = Engine.decideZoneA(Engine.HOME_SCENARIOS.heatwave.conditions);
  const salt = Engine.decideZoneA(Engine.HOME_SCENARIOS.salinity.conditions);
  assert.equal(norm.traditionalLitres, 160000);
  assert(norm.savedLitres > 0 && norm.smartLitres > norm.weatherOnlyLitres);
  assert(heat.smartLitres > norm.smartLitres && heat.savedLitres < 0, 'Heatwave increases water above habit to stop crop stress');
  assert(salt.flushPct > norm.flushPct && salt.smartYieldPct > salt.wxYieldPct, 'Salinity flush preserves yield vs weather-only');
});

test('geodesic polygonStats computes accurate hectares and sub-plot grid', () => {
  const poly = Engine.rectPolygon(24.2075, 55.7447, 200, 100);
  const st = Engine.polygonStats(poly, 25);
  assert(Math.abs(st.areaHa - 2.0) < 0.05);
  assert(st.cells >= 30 && st.lines.length > 0);
});

test('vendored offline UTF-8 QR code generator encodes worker Arabic/Urdu notes locally', () => {
  const qrcode = require(path.join(root, 'vendor/qrcode.js'));
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData('والو 1: 160 منٹ چلائیں، 21:00 بجے کے بعد شروع کریں۔');
  qr.make();
  assert(qr.getModuleCount() >= 21);
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2 });
  assert(svg.includes('<svg') && svg.includes('<path'));
});

test('runtimeRange brackets the point estimate and widens with ET0 uncertainty', () => {
  const blk = { crop: 'tomato', area: 0.5, day: 60, system: 'drip', flowMode: 'direct', flow: 12 };
  const wx = { et0: 6, rain: 0 };
  const mid = Engine.blockDecision(blk, CROPS.tomato, wx, 3.0, false, 'good');
  const narrow = Engine.runtimeRange(blk, CROPS.tomato, wx, 3.0, { uEt: 0.10 });
  const wide = Engine.runtimeRange(blk, CROPS.tomato, wx, 3.0, { uEt: 0.20 });
  assert(narrow.loMin < mid.minutes && mid.minutes < narrow.hiMin);
  assert(wide.hiMin - wide.loMin > narrow.hiMin - narrow.loMin);
});

test('saltForecast converges to the FAO-29 steady state and flags threshold crossing', () => {
  const crop = CROPS.tomato, ecw = 3.0, days = 400;
  const etc = Array(days).fill(5);
  const lf = 0.2;
  const applied = etc.map(e => e / (1 - lf));
  const f = Engine.saltForecast({ crop, ecw, startECe: 1.0, applied, etc, drainage: 'good' });
  assert(Math.abs(f.endECe - Engine.rootzoneECe(ecw, lf)) < 0.05, `end ${f.endECe}`);
  // Weather-only (no leaching) keeps accumulating salt and crosses the crop threshold.
  const wxOnly = Engine.saltForecast({ crop, ecw, startECe: 2.0, applied: etc.slice(0, 60), etc: etc.slice(0, 60) });
  assert(wxOnly.crossDay !== null && wxOnly.endECe > crop.ecThr);
  // Poor drainage limits flushing: higher end salinity than good drainage for the same over-watering.
  const over = etc.slice(0, 60).map(e => e * 1.6);
  const good = Engine.saltForecast({ crop, ecw, startECe: 4, applied: over, etc: etc.slice(0, 60), drainage: 'good' });
  const poor = Engine.saltForecast({ crop, ecw, startECe: 4, applied: over, etc: etc.slice(0, 60), drainage: 'poor' });
  assert(poor.endECe > good.endECe);
});

test('hargreavesBias calibrates the offline ET0 backup against live Penman-Monteith', () => {
  const days = [0, 1, 2, 3].map(i => ({ date: `2026-11-1${i}`, tmax: 32, tmin: 20 }));
  const hg = days.map(d => Engine.hargreavesET0(d.tmax, d.tmin, 24.2, Engine.dayOfYear(d.date)));
  const live = days.map((d, i) => ({ ...d, et0: hg[i] * 0.85 }));
  assert(Math.abs(Engine.hargreavesBias(live, 24.2) - 0.85) < 1e-6);
  assert.equal(Engine.hargreavesBias(live.slice(0, 2), 24.2), null);
});

test('evaluate uses transient salt state so one week without leaching does not wipe out yield', () => {
  const blk = { crop: 'tomato', area: 0.5, day: 60, system: 'drip', flowMode: 'direct', flow: 12 };
  const etc = Array(7).fill(6);
  const f = Engine.saltForecast({ crop: CROPS.tomato, ecw: 3.0, startECe: 2.0, applied: etc, etc });
  const last = f.series[6];
  const steady = Engine.evaluate(CROPS.tomato, blk, 6 * 7 * 5 / 0.9, 42, 3.0, 'good');
  const trans = Engine.evaluate(CROPS.tomato, blk, 6 * 7 * 5 / 0.9, 42, 3.0, 'good', null,
    { ece: last.ece, ys: Engine.sum(f.series.map(p => p.y)) / 7, startECe: 2.0 });
  assert(steady.y < 0.2, 'instant steady state is the pessimistic old behaviour');
  assert(trans.y > 0.85 && trans.saltTrend === 'increasing');
});
