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
