'use strict';
/* Saqi tools: water mix, sensor check, drip health, crop planner, date harvest, water sharing, adviser triage. */

/* ---------- small SVG chart ---------- */
function svgChart(series, { w = 520, h = 220, xlab = '', ylab = '', marker = null, shade = null, xfmt = v => fmt(v) } = {}) {
  const all = series.flatMap(s => s.pts);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0);
  if (y1 === y0) y1 = y0 + 1;
  const pad = (y1 - y0) * 0.08; y1 += pad; if (y0 < 0) y0 -= pad;
  const L = 52, R = 12, T = 28, B = 36;
  const X = x => L + (x - x0) / ((x1 - x0) || 1) * (w - L - R);
  const Y = y => T + (y1 - y) / (y1 - y0) * (h - T - B);
  let g = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" style="max-width:${w}px">`;
  if (shade) g += `<rect x="${X(shade[0])}" y="${T}" width="${Math.max(0, X(shade[1]) - X(shade[0]))}" height="${h - T - B}" fill="var(--chart-shade)"/>`;
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + (y1 - y0) * i / 4;
    g += `<line x1="${L}" x2="${w - R}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="var(--chart-grid)"/><text x="${L - 5}" y="${Y(yv) + 4}" font-size="10" text-anchor="end" fill="var(--chart-axis)">${fmt(yv)}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const xv = x0 + (x1 - x0) * i / 4;
    g += `<text x="${X(xv)}" y="${h - B + 14}" font-size="10" text-anchor="middle" fill="var(--chart-axis)">${xfmt(xv)}</text>`;
  }
  if (y0 < 0) g += `<line x1="${L}" x2="${w - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--chart-axis)" stroke-dasharray="3 3"/>`;
  series.forEach(s => {
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.4" points="${s.pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}"/>`;
  });
  if (marker) g += `<line x1="${X(marker[0])}" x2="${X(marker[0])}" y1="${T}" y2="${h - B}" stroke="var(--chart-profit)" stroke-width="1.5" stroke-dasharray="4 3"/><circle cx="${X(marker[0])}" cy="${Y(marker[1])}" r="5" fill="var(--chart-profit)"/>`;
  g += `<text x="${(L + w - R) / 2}" y="${h - 4}" font-size="11" text-anchor="middle" fill="var(--chart-text)">${xlab}</text>`;
  g += `<text x="12" y="${(T + h - B) / 2}" font-size="11" text-anchor="middle" fill="var(--chart-text)" transform="rotate(-90 12 ${(T + h - B) / 2})">${ylab}</text>`;
  g += series.map((s, i) => `<g transform="translate(${L + i * 155},6)"><rect width="12" height="4" y="4" rx="2" fill="${s.color}"/><text x="16" y="10" font-size="10" fill="var(--chart-text)">${s.label}</text></g>`).join('');
  return g + '</svg>';
}

/* ---------- Water mix ---------- */
function renderBlend() {
  const s = state.blend, sel = $('#blBlock');
  sel.innerHTML = state.blocks.map((b, i) => `<option value="${i}">${i + 1}. ${esc(b.name)} (${CROPS[b.crop].name})</option>`).join('');
  sel.value = s.block;
  const r = results[s.block];
  if (!r) { $('#blendOut').innerHTML = '<p class="muted">Add a block first.</p>'; return; }
  const rev = weeklyRevenue(r.crop, r.b.area, 1);
  const o = Engine.optimiseBlend({ netMm: r.today.netNeed, area: r.b.area, Ea: r.today.Ea, crop: r.crop, A: s.a, B: s.b, dailyRevenue: rev });
  const b = o.best;
  const rowOf = (label, p, hl) => `<tr class="${hl ? 'hl' : ''}"><td>${label}</td><td class="num">${fmt(p.ecw, 1)}</td><td class="num">${fmt(p.V, 1)}</td><td class="num">${fmt(p.cost)}</td><td class="num">${pct(p.y)}</td><td class="num"><b>${fmt(p.profit)}</b></td><td>${p.feasible ? '' : '<span class="tag red">well too small</span>'}</td></tr>`;
  const firstInfeasible = o.curve.find(p => !p.feasible);
  $('#blendOut').innerHTML = `<h3>Best mix for today</h3>
    <div class="verdict">${pct(1 - b.f)} ${esc(s.a.name)} + ${pct(b.f)} ${esc(s.b.name)}</div>
    <div>${fmt(b.vA, 1)} m³ of A + ${fmt(b.vB, 1)} m³ of B → mixed EC <b>${fmt(b.ecw, 1)} dS/m</b>, salt flush ${pct(b.LR)}, expected yield ${pct(b.y)}.</div>
    <div class="tablewrap" style="margin:.6rem 0"><table><tr><th>Option</th><th class="num">EC</th><th class="num">m³/day</th><th class="num">Water AED</th><th class="num">Yield</th><th class="num">Profit AED/day</th><th></th></tr>
    ${rowOf('Only ' + esc(s.a.name), o.freshOnly)}${rowOf('Only ' + esc(s.b.name), o.wellOnly)}${rowOf('<b>Saqi mix</b>', b, true)}</table></div>
    <p>Compared with fresh water only: <b class="good">${fmt(b.profit - o.freshOnly.profit)} AED/day</b> (≈ ${fmt((b.profit - o.freshOnly.profit) * 30)} AED/month) and <b>${fmt(o.freshOnly.vA - b.vA, 1)} m³/day</b> less desalinated water.</p>
    ${svgChart([{ pts: o.curve.map(p => [p.f * 100, p.profit]), color: 'var(--chart-profit)', label: 'Profit AED/day' }, { pts: o.curve.map(p => [p.f * 100, p.cost]), color: 'var(--chart-cost)', label: 'Water cost AED/day' }],
      { xlab: '% of ' + esc(s.b.name) + ' in the mix', ylab: 'AED / day', marker: [b.f * 100, b.profit], shade: firstInfeasible ? [firstInfeasible.f * 100, 100] : null })}
    <p class="muted">Crop need today: ${fmt(r.today.netNeed, 1)} mm. More salty water is cheaper, but it needs more flushing water and costs yield once it passes the crop's limit. Red zone = beyond what the well can supply.</p>`;
}

/* ---------- Sensor check ---------- */
function renderSensor() {
  const s = state.sensor, soil = SOILS[s.soil] || SOILS.sand;
  const sel = $('#snSoil'); if (!sel.options.length) sel.innerHTML = Object.entries(SOILS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const app = +s.reading, bias = s.k * s.ece * app / 10, tru = Math.max(0, app - bias);
  const refill = soil.fc - 0.5 * (soil.fc - soil.wp);
  const dec = v => v < refill ? { t: 'IRRIGATE NOW', c: 'bad' } : v > soil.fc ? { t: 'Too wet: skip', c: 'warn' } : { t: 'Wait', c: 'good' };
  const da = dec(app), dt = dec(tru);
  const mm = Math.max(0, (soil.fc - tru) / 100 * s.depth * 10);
  const scale = soil.fc * 1.6, P = v => Math.min(100, v / scale * 100);
  const gauge = (v, color) => `<div style="position:relative;height:22px;background:linear-gradient(90deg,rgba(220,76,62,0.45) 0 ${P(soil.wp)}%,rgba(232,185,78,0.42) ${P(soil.wp)}% ${P(refill)}%,rgba(102,194,142,0.42) ${P(refill)}% ${P(soil.fc)}%,rgba(152,207,240,0.42) ${P(soil.fc)}%);border-radius:8px">
    <div style="position:absolute;left:calc(${P(v)}% - 2px);top:-3px;width:4px;height:28px;background:${color};border-radius:2px"></div></div>`;
  $('#sensorOut').innerHTML = `
    <div class="grid g2">
      <div><div class="muted">Sensor says</div><div class="big" style="color:var(--muted)">${fmt(app, 1)}%</div><div class="${da.c}"><b>${da.t}</b></div></div>
      <div><div class="muted">Salt-corrected</div><div class="big">${fmt(tru, 1)}%</div><div class="${dt.c}"><b>${dt.t}</b></div></div>
    </div>
    <div style="margin:.8rem 0">${gauge(app, 'var(--muted-foreground)')}<div style="height:6px"></div>${gauge(tru, 'var(--water)')}
    <div class="muted" style="display:flex;justify-content:space-between"><span>dry (wilting ${soil.wp}%)</span><span>refill ${fmt(refill, 0)}%</span><span>full (field capacity ${soil.fc}%)</span></div></div>
    ${dt.c === 'bad' && da.c !== 'bad'
      ? `<div class="alert red">⚠ <b>Salt is fooling the sensor.</b> It reads ${fmt(bias, 1)} points too wet, so the grower would wait while the roots are already below the refill point (${fmt(refill, 1)}%).</div>`
      : da.t !== dt.t
        ? `<div class="alert amber">⚠ <b>Salt is fooling the sensor.</b> It reads ${fmt(bias, 1)} points too wet, making the soil look over-saturated when it is actually only ${fmt(tru - refill, 1)} points above the refill point.</div>`
        : `<div class="alert green">The sensor's decision is right here. The salt error (${fmt(bias, 1)} points) does not change it.</div>`}
    ${tru < soil.fc ? `<p>To refill ${s.depth} cm of root zone: <b>${fmt(mm, 1)} mm = ${fmt(mm, 1)} litres per m²</b> (before salt flush and system losses).</p>` : ''}
    <p class="muted">Model: capacitive sensors pick up the soil water's electrical conductivity as extra "wetness", and the error grows with salinity and water content: bias ≈ k × ECe × reading / 10. Sandy soil holds very little water (≈ ${soil.fc - soil.wp} points available), so a 2–3 point error is a big part of the plant's reserve.</p>`;
}

/* ---------- Drip health ---------- */
function renderDrip() {
  $('#dripCards').innerHTML = state.blocks.map((b, i) => {
    const log = state.flowLog[i] || []; const f = Engine.flowCheck(log, b.flow);
    const ratios = log.map(p => p.flow / b.flow);
    const w = 320, h = 90, X = j => 8 + j / Math.max(1, ratios.length - 1) * (w - 16), Y = v => h - 8 - (Math.min(1.4, Math.max(0.5, v)) - 0.5) / 0.9 * (h - 16);
    const spark = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px"><rect x="8" y="${Y(1.12)}" width="${w - 16}" height="${Y(0.88) - Y(1.12)}" fill="rgba(102,194,142,0.18)" rx="4"/>
      <line x1="8" x2="${w - 8}" y1="${Y(1)}" y2="${Y(1)}" stroke="var(--good)" stroke-dasharray="3 3"/>
      <polyline fill="none" stroke="${f.status === 'ok' ? 'var(--water)' : 'var(--destructive)'}" stroke-width="2.2" points="${ratios.map((v, j) => X(j) + ',' + Y(v)).join(' ')}"/>
      ${ratios.map((v, j) => `<circle cx="${X(j)}" cy="${Y(v)}" r="2.5" fill="${v < 0.88 || v > 1.12 ? 'var(--destructive)' : 'var(--water)'}"/>`).join('')}</svg>`;
    const r = results[i]; const mins = r ? r.today.minutes : b.habitMin;
    let msg = '<span class="tag green">Healthy</span> Flow within ±12% of design.';
    if (f.status === 'clog') msg = `<span class="tag red">Clogging</span> Delivering ${pct(f.ratio)} of design flow, so plants get ≈ <b>${fmt((1 - f.ratio) * (r ? r.today.m3 : 0), 1)} m³ less</b> than planned today. Flush the laterals and acid-clean the emitters (salt and lime scale). Do <b>not</b> just run longer: the blocked drippers stay dry while the open ones get too much.`;
    if (f.status === 'leak') msg = `<span class="tag red">Leak / burst</span> Flow is ${pct(f.ratio)} of design: ≈ <b>${fmt((f.ratio - 1) * b.flow * mins / 60, 1)} m³ lost</b> per irrigation. Walk the line and look for a burst lateral, a missing end cap or a broken fitting.`;
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>Valve ${i + 1} · ${esc(b.name)}</h3><span class="muted">design ${b.flow} m³/h</span></div>
      ${spark}<div class="muted">Last 14 days, measured ÷ design flow (green band = normal)</div><p>${msg}</p>
      <div class="row"><input type="number" step="0.1" placeholder="Today's flow m³/h" data-flowin="${i}" style="max-width:180px"><button class="btn sm" data-flowbtn="${i}">Log reading</button></div></div>`;
  }).join('');
  $$('[data-flowbtn]').forEach(btn => btn.onclick = () => {
    const i = +btn.dataset.flowbtn, v = +$(`[data-flowin="${i}"]`).value;
    if (!(v > 0)) { toast('Enter the flow in m³/h (meter reading ÷ pump hours)'); return; }
    const log = state.flowLog[i] || (state.flowLog[i] = []); const today = isoDaysAgo(0);
    const last = log[log.length - 1];
    if (last && last.date === today) last.flow = v; else log.push({ date: today, flow: v });
    while (log.length > 30) log.shift();
    save(); renderAll(); toast('Reading saved');
  });
}

/* ---------- Crop planner ---------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function renderPlanner() {
  const p = state.planner;
  const ss = $('#plSystem'); if (!ss.options.length) ss.innerHTML = Object.entries(SYSTEMS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  const sc = $('#plCurrent'); if (!sc.options.length) sc.innerHTML = Object.entries(CROPS).map(([k, c]) => `<option value="${k}">${c.name}</option>`).join('');
  const ecw = +state.water.ec, cost = +state.water.cost, Ea = SYSTEMS[p.system].eff;
  const rows = Object.entries(CROPS).map(([k, c]) => {
    const sp = Engine.seasonPlan(c, ecw, Ea, CLIMATE.et0);
    const rev = c.yield * 1000 * c.price * sp.ys, wc = sp.totM3 * cost, profit = rev - wc;
    const endM = (c.plantMonth - 1 + Math.round(sp.L / 30.4) - 1) % 12;
    return { k, c, sp, rev, profit, perM3: profit / sp.totM3, kgM3: c.yield * 1000 * sp.ys / sp.totM3, feasible: sp.peakM3 <= p.avail,
      season: c.perennial ? 'all year' : `${MONTHS[c.plantMonth - 1]}–${MONTHS[endM]}` };
  }).sort((a, b) => (b.feasible - a.feasible) || (b.perM3 - a.perM3));
  $('#plannerTable').innerHTML = `<tr><th>#</th><th>Crop</th><th>Season</th><th class="num">Water m³/ha</th><th class="num">Peak m³/ha/day</th><th class="num">Salt flush</th><th class="num">Yield</th><th class="num">Profit AED/ha</th><th class="num">AED per m³</th><th class="num">kg per m³</th></tr>` +
    rows.map((r, i) => `<tr class="${r.k === p.current ? 'hl' : ''}"><td>${i + 1}</td><td>${r.c.name}${r.k === p.current ? ' <span class="tag amber">now</span>' : ''}${i === 0 ? ' <span class="tag green">best</span>' : ''}</td><td>${r.season}</td>
      <td class="num">${fmt(r.sp.totM3)}</td><td class="num ${r.feasible ? '' : 'bad'}">${fmt(r.sp.peakM3)}${r.feasible ? '' : ' ⚠'}</td>
      <td class="num">${r.sp.capped ? '<span class="bad">max 40%</span>' : pct(r.sp.LR)}</td><td class="num ${r.sp.ys < 0.9 ? 'bad' : ''}">${pct(r.sp.ys)}</td>
      <td class="num">${fmt(r.profit)}</td><td class="num"><b class="${r.perM3 < 0 ? 'bad' : ''}">${fmt(r.perM3, 2)}</b></td><td class="num">${fmt(r.kgM3, 1)}</td></tr>`).join('');
  const cur = rows.find(r => r.k === p.current), best = rows[0];
  let note;
  if (!cur || !best || best.k === cur?.k) {
    note = `Your current crop is already the best fit for this water. Water includes salt flushing at EC ${fmt(ecw, 1)} dS/m.`;
  } else if (best.perM3 <= 0) {
    note = `At ${fmt(cost, 1)} AED/m³ and EC ${fmt(ecw, 1)} dS/m, none of these crops cover water costs. Lower water cost or blend with fresher water.`;
  } else if (cur.perM3 <= 0) {
    note = `At this water cost and salinity, ${cur.c.name} loses <b>${fmt(Math.abs(cur.profit))} AED/ha</b>. Putting that ${fmt(cur.sp.totM3)} m³ into <b>${best.c.name}</b> earns <b>${fmt(best.perM3, 2)} AED/m³</b> (≈ <b>${fmt((best.perM3 - cur.perM3) * cur.sp.totM3)} AED/ha</b> swing). ⚠ = the well cannot supply the hottest-day peak.`;
  } else {
    note = `With the same ${fmt(cur.sp.totM3)} m³ of water that ${cur.c.name} uses on one hectare, <b>${best.c.name}</b> would earn ≈ <b>${fmt((best.perM3 - cur.perM3) * cur.sp.totM3)} AED more</b> — or earn the same profit using ${pct(1 - cur.perM3 / best.perM3)} less water. ⚠ = the well cannot supply the hottest-day peak. Water includes salt flushing at EC ${fmt(ecw, 1)} dS/m.`;
  }
  $('#plannerNote').innerHTML = note;
}

/* ---------- Date harvest (on-device colour analysis) ---------- */
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
function drawSample(kind) {
  const c = $('#hvCanvas'), ctx = c.getContext('2d'); const r = seeded({ kimri: 3, khalal: 5, rutab: 7, tamr: 11 }[kind]);
  ctx.fillStyle = '#f3ead8'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#9a8f80'; ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo(180, 0); ctx.lineTo(60 + i * 18, 200 + r() * 40); ctx.stroke(); }
  const col = { kimri: ['#6f9a2c', '#7fae35', '#5f8a26'], khalal: ['#e9c03a', '#f0c94a', '#d9a92a'], rutab: ['#e2b636', '#e9c03a'], tamr: ['#4a2a14', '#3f2411', '#56301a'] }[kind];
  for (let i = 0; i < 90; i++) {
    const y = 40 + r() * 200, spread = 40 + (y - 40) * 0.6, x = 180 + (r() - 0.5) * 2 * spread;
    ctx.save(); ctx.translate(x, y); ctx.rotate((r() - 0.5) * 0.6);
    ctx.beginPath(); ctx.ellipse(0, 0, 10, 15, 0, 0, Math.PI * 2); ctx.fillStyle = col[Math.floor(r() * col.length)]; ctx.fill();
    if (kind === 'rutab' && r() < 0.8) { ctx.clip(); const f = 0.3 + r() * 0.7; ctx.fillStyle = r() < 0.5 ? '#8a5a2b' : '#7a4a22'; ctx.fillRect(-12, 15 - 30 * f, 24, 30 * f); }
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(x - 3, y - 6, 2.5, 4, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
  }
  analyseHarvest();
}
function analyseHarvest() {
  const c = $('#hvCanvas'), ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const n = { green: 0, yellow: 0, red: 0, brown: 0, dark: 0 }; let total = 0, fruit = 0;
  for (let i = 0; i < d.length; i += 8) {
    total++;
    const [h, s, v] = rgb2hsv(d[i], d[i + 1], d[i + 2]);
    if (v < 0.1 || s < 0.22) continue;
    fruit++;
    if (h >= 65 && h <= 170) n.green++;
    else if (v < 0.33) n.dark++;
    else if ((h <= 40 || h >= 330) && v < 0.6) n.brown++;
    else if (h >= 330 || h < 20) n.red++;
    else if (h < 65) n.yellow++;
    else fruit--;
  }
  const out = $('#hvOut');
  if (fruit / total < 0.05) { out.innerHTML = '<p class="bad"><b>No date fruit found.</b> Fill the frame with the bunch, in daylight.</p>'; return; }
  const F = k => n[k] / fruit, g = F('green'), kh = F('yellow') + F('red'), br = F('brown'), dk = F('dark');
  let stage, action, water;
  if (g > 0.5) { stage = 'Kimri (green, unripe)'; action = 'Not ready. Roughly 4–8 weeks to Khalal, depending on variety and heat.'; water = 'Keep normal irrigation: fruit is still growing in size.'; }
  else if (dk > 0.5) { stage = 'Tamr (dry, fully ripe)'; action = 'Harvest now and dry or store. Waiting longer only adds bird, insect and dust losses.'; water = 'Irrigation can be at the minimum until after harvest.'; }
  else if (br + dk >= 0.25) { stage = `Rutab (${pct(br + dk)} of fruit softening)`; action = 'Harvest rutab now: pick the ripe bunches or strands every 2–3 days for the best fresh-market price.'; water = 'Keep irrigation reduced and avoid wetting fruit. Too much water now causes splitting and souring.'; }
  else { stage = 'Khalal (full colour, crunchy)'; action = 'Harvest now if you sell fresh khalal (e.g. Barhi). For rutab or tamr, wait about 2–4 weeks.'; water = 'Start reducing irrigation by about 20–30%: it improves sugar content, cuts fruit splitting and saves water.'; }
  const bar = (label, v, col) => `<div class="row"><span style="width:120px" class="muted">${label}</span><div class="bar" style="flex:1"><i style="width:${v * 100}%;background:${col}"></i></div><span style="width:44px" class="muted">${pct(v)}</span></div>`;
  out.innerHTML = `<div class="muted">Stage</div><div class="verdict">${stage}</div><p><b>${action}</b></p><div class="alert blue">💧 ${water}</div>
    ${bar('Green (Kimri)', g, '#6f9a2c')}${bar('Yellow/red (Khalal)', kh, '#e9c03a')}${bar('Soft brown (Rutab)', br, '#8a5a2b')}${bar('Dark (Tamr)', dk, '#4a2a14')}
    <p class="muted">The colour analysis runs on the phone: no upload and no data cost. It is a screening aid, so confirm by tasting a few fruits from different sides of the bunch.</p>`;
}

/* ---------- Water sharing ---------- */
function renderShare() {
  const s = state.share;
  if (s.link && results.length && s.farms[0]) s.farms[0].need = Math.round(sum(results.map(r => r.today.m3)));
  $('#shLink').checked = !!s.link;
  const o = Engine.shareWater(s.farms, +s.cap, +s.price);
  $('#shareTable').innerHTML = `<tr><th>Farm</th><th class="num">Share %</th><th class="num">Need m³/day</th><th class="num">Right m³</th><th class="num">Sold</th><th class="num">Bought</th><th class="num">Gets m³</th><th class="num">Credits AED</th><th class="num">Still short</th><th></th></tr>` +
    o.rows.map((r, i) => `<tr><td><input type="text" data-fi="${i}" data-fk="name" value="${esc(r.name)}"></td>
      <td><input type="number" step="1" data-fi="${i}" data-fk="share" value="${r.share}" style="max-width:80px"></td>
      <td><input type="number" step="5" data-fi="${i}" data-fk="need" value="${r.need}" style="max-width:90px" ${i === 0 && s.link ? 'disabled title="From Saqi plan"' : ''}></td>
      <td class="num">${fmt(r.right)}</td><td class="num">${r.sold ? fmt(r.sold) : '–'}</td><td class="num">${r.bought ? fmt(r.bought) : '–'}</td>
      <td class="num"><b>${fmt(r.alloc)}</b></td><td class="num ${r.aed > 0 ? 'good' : r.aed < 0 ? 'bad' : ''}">${r.aed ? (r.aed > 0 ? '+' : '') + fmt(r.aed) : '–'}</td>
      <td class="num ${r.short > 0.5 ? 'bad' : ''}">${r.short > 0.5 ? fmt(r.short) : '0'}</td>
      <td>${i ? `<button class="btn sm ghost" data-fdel="${i}">✕</button>` : ''}</td></tr>`).join('');
  $$('[data-fi]').forEach(el => el.onchange = () => { const f = s.farms[+el.dataset.fi]; f[el.dataset.fk] = el.type === 'number' ? (+el.value || 0) : el.value; save(); renderAll(); });
  $$('[data-fdel]').forEach(el => el.onclick = () => { s.farms.splice(+el.dataset.fdel, 1); save(); renderAll(); });
  const shortBefore = sum(o.rows.map(r => r.deficit)), shortAfter = sum(o.rows.map(r => Math.max(0, r.short)));
  $('#shareSummary').innerHTML = `<h3>Result</h3>
    ${o.totalShare !== 100 ? `<div class="alert amber">Shares add up to ${o.totalShare}%, not 100%.</div>` : ''}
    <div class="kpi"><div><span>Traded between farms</span><b>${fmt(o.traded)} m³/day</b></div>
    <div><span>Shortage fixed</span><b class="good">${fmt(shortBefore - shortAfter)} m³/day</b><span>${fmt(shortBefore)} → ${fmt(shortAfter)}</span></div>
    <div><span>Left in the aquifer</span><b class="good">${fmt(o.unused)} m³/day</b><span>not pumped, not wasted</span></div></div>
    <p class="muted">Without trading, a farm with spare hours usually runs the pump anyway ("use it or lose it"). With credits it earns money for <em>not</em> pumping, and the neighbour who is short buys at a fair price.</p>`;
  let t = 18 * 60; const pump = Math.max(1, +s.pump);
  const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const totalH = sum(o.rows.map(r => r.alloc)) / pump;
  $('#shareSchedule').innerHTML = `<h3>Pump timetable (night first)</h3><table><tr><th>Farm</th><th>From</th><th>To</th><th class="num">Hours</th></tr>` +
    o.rows.filter(r => r.alloc > 0).map(r => { const mins = r.alloc / pump * 60; const a = t; t += mins; return `<tr><td>${esc(r.name)}</td><td>${hm(a)}</td><td>${hm(t)}</td><td class="num">${fmt(mins / 60, 1)}</td></tr>`; }).join('') +
    `</table>${totalH > 24 ? `<div class="alert red">Needs ${fmt(totalH, 1)} h of pumping: more than a day. Raise the pump flow or lower the well output figure.</div>` : `<p class="muted">Total ${fmt(totalH, 1)} h. Cool hours go first to cut evaporation; the timetable can go to each farm as an SMS.</p>`}`;
}

/* ---------- Adviser triage ---------- */
let ADV = null, advRegion = 'All';
function advFarms() {
  if (ADV) return ADV;
  const r = seeded(2026);
  const regions = [['Al Ain', 24.2, 55.7], ['Liwa', 23.1, 53.8], ['Al Dhaid', 25.3, 55.9], ['Madinat Zayed', 23.7, 53.7]];
  const crops = ['date', 'date', 'date', 'bermuda', 'tomato', 'cucumber', 'barley'];
  ADV = Array.from({ length: 40 }, (_, i) => {
    const g = regions[i % 4], crop = crops[Math.floor(r() * crops.length)];
    const prev = 0.32 + r() * 0.36, drop = r() < 0.25 ? 0.06 + r() * 0.15 : (r() - 0.5) * 0.04;
    const ndvi = Math.max(0.08, prev - drop), ndmi = -0.15 + r() * 0.4 - (drop > 0.05 ? 0.12 : 0);
    return { id: 'F-' + String(i + 1).padStart(3, '0'), region: g[0], lat: g[1] + (r() - 0.5) * 0.5, lon: g[2] + (r() - 0.5) * 0.5, crop,
      ndviPrev: prev, ndvi, ndmi, ecw: 1.5 + r() * 12, days: Math.floor(r() * 90) };
  });
  ADV.forEach(f => {
    const c = CROPS[f.crop];
    const dn = Math.min(1, Math.max(0, (f.ndviPrev - f.ndvi) / 0.15)), dm = f.ndmi < 0 ? Math.min(1, -f.ndmi / 0.2) : 0;
    const ds = Math.min(1, Math.max(0, f.ecw / (5 * c.ecThr))), dv = Math.min(1, f.days / 60);
    f.score = Math.round(45 * dn + 25 * dm + 20 * ds + 10 * dv);
    f.reasons = [];
    if (dn > 0.3) f.reasons.push(`vigour fell ${fmt((f.ndviPrev - f.ndvi) * 100 / f.ndviPrev)}% in 20 days`);
    if (dm > 0.3) f.reasons.push('crop is short of water (low NDMI)');
    if (Engine.leachingReq(f.ecw, c.ecThr) === null || Engine.leachingReq(f.ecw, c.ecThr) > 0.4) f.reasons.push(`water ${fmt(f.ecw, 1)} dS/m is too salty for ${c.name.toLowerCase()}`);
    if (f.days > 60) f.reasons.push(`not visited for ${f.days} days`);
  });
  ADV.sort((a, b) => b.score - a.score);
  return ADV;
}
function riskColor(s) { return s >= 60 ? '#e0634e' : s >= 35 ? '#e0aa45' : '#57b887'; }
function renderAdviser() {
  const allF = advFarms();
  const F = advRegion === 'All' ? allF : allF.filter(f => f.region === advRegion);
  const w = 480, h = 360, la0 = 22.7, la1 = 25.7, lo0 = 53.3, lo1 = 56.3;
  const X = lo => 20 + (lo - lo0) / (lo1 - lo0) * (w - 40), Y = la => 20 + (la1 - la) / (la1 - la0) * (h - 40);
  $('#advMap').innerHTML = `<div class="row" style="margin-bottom:.5rem"><label style="margin:0">Region:</label><select id="advRegionSel" style="max-width:170px">${['All', 'Al Ain', 'Liwa', 'Al Dhaid', 'Madinat Zayed'].map(r => `<option value="${r}" ${r === advRegion ? 'selected' : ''}>${r === 'All' ? 'All regions (40)' : r}</option>`).join('')}</select></div>
    <svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;background:var(--map-bg);border:1px solid var(--map-border);border-radius:16px">
    ${[['Al Ain', 24.2, 55.7], ['Liwa', 23.1, 53.8], ['Al Dhaid', 25.3, 55.9], ['Madinat Zayed', 23.7, 53.7]].map(g => `<text x="${X(g[2])}" y="${Y(g[1]) - 34}" font-size="12" text-anchor="middle" fill="var(--chart-axis)">${g[0]}</text>`).join('')}
    ${F.slice().reverse().map(f => `<circle cx="${X(f.lon)}" cy="${Y(f.lat)}" r="${5 + f.score / 15}" fill="${riskColor(f.score)}" opacity=".9" stroke="var(--background)"><title>${f.id} ${CROPS[f.crop].name} · risk ${f.score}</title></circle>`).join('')}
    ${F.slice(0, 5).map((f, i) => `<text x="${X(f.lon) + 9}" y="${Y(f.lat) + 4}" font-size="11" font-weight="700" fill="var(--chart-text)">${i + 1}</text>`).join('')}</svg>
    <div class="row" style="margin-top:.4rem"><span class="tag red">High ≥ 60</span><span class="tag amber">Medium 35–59</span><span class="tag green">Watch &lt; 35</span></div>`;
  $('#advRegionSel').onchange = e => { advRegion = e.target.value; renderAdviser(); };
  $('#advTop').innerHTML = F.slice(0, 5).map((f, i) => `<div class="alert ${f.score >= 60 ? 'red' : f.score >= 35 ? 'amber' : 'green'}"><b>${i + 1}. ${f.id}</b> · ${f.region} · ${CROPS[f.crop].name} · risk <b>${f.score}</b><br><span class="muted">${f.reasons.join(' · ') || 'combined moderate signals'}</span></div>`).join('') +
    `<p class="muted">Scoring: vigour drop 45% · water stress 25% · salinity vs crop 20% · time since visit 10%. One adviser can cover hundreds of farms and still reach problems while they can be fixed.</p>`;
  $('#advTable').innerHTML = `<tr><th>#</th><th>Farm</th><th>Region</th><th>Crop</th><th class="num">NDVI before → now</th><th class="num">NDMI</th><th class="num">Water EC</th><th class="num">Last visit</th><th class="num">Risk</th></tr>` +
    F.map((f, i) => `<tr><td>${i + 1}</td><td>${f.id}</td><td>${f.region}</td><td>${CROPS[f.crop].name}</td><td class="num">${fmt(f.ndviPrev, 2)} → <b class="${f.ndvi < f.ndviPrev - 0.05 ? 'bad' : ''}">${fmt(f.ndvi, 2)}</b></td>
      <td class="num ${f.ndmi < 0 ? 'bad' : ''}">${fmt(f.ndmi, 2)}</td><td class="num">${fmt(f.ecw, 1)}</td><td class="num">${f.days} d</td>
      <td class="num"><span class="tag" style="background:${riskColor(f.score)};color:#fff">${f.score}</span></td></tr>`).join('');
}

/* ---------- one-time wiring ---------- */
function initTools() {
  $('#blBlock').onchange = e => { state.blend.block = +e.target.value; save(); renderAll(); };
  $('#calBtn').onclick = () => {
    const sv = +$('#calSensor').value, tv = +$('#calTrue').value, ec = +$('#calEce').value;
    if (!(sv > 0 && ec > 0) || tv > sv) { toast('Need sensor > true value and ECe > 0'); return; }
    state.sensor.k = +((sv - tv) / (ec * sv / 10)).toFixed(3); state.sensor.ece = ec;
    save(); renderAll(); toast('k calibrated to ' + state.sensor.k);
  };
  $('#shLink').onchange = e => { state.share.link = e.target.checked; save(); renderAll(); };
  $('#shAdd').onclick = () => { state.share.farms.push({ name: 'Neighbour', share: 10, need: 50 }); save(); renderAll(); };
  $$('[data-sample]').forEach(b => b.onclick = () => drawSample(b.dataset.sample));
  $('#hvFile').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image(); img.onload = () => {
      const c = $('#hvCanvas'), ctx = c.getContext('2d'), sc = Math.min(c.width / img.width, c.height / img.height);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, (c.width - img.width * sc) / 2, (c.height - img.height * sc) / 2, img.width * sc, img.height * sc);
      URL.revokeObjectURL(img.src); analyseHarvest();
    };
    img.src = URL.createObjectURL(file);
  };
  drawSample('rutab');
}
