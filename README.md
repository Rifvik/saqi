# Saqi ساقي — Salt-Smart Desert Farming

Offline-first web prototype for salt-smart desert irrigation, built with plain HTML, CSS, and JavaScript (no build step).

## Quick start

Serve the folder with any static server:

```bash
python -m http.server 8765
```

Then open `http://localhost:8765/index.html`.

## Files (for copying UI or logic)

- `styles.css` — Dark & Light frosted-glass design tokens (`:root` and `html[data-theme="light"]`), sliding tab pill, directional tab transitions, responsive grids, cards, alerts, tables, and buttons.
- `index.html` — Header, pill navigation, and all 10 views (`Today`, `My farm`, `Water mix`, `Sensor check`, `Drip health`, `What to plant`, `Date harvest`, `Water sharing`, `Adviser`, `Why Saqi`).
- `js/data.js` — FAO-56 crop coefficients (`Kc`), FAO-29 salt-tolerance thresholds/slopes, soils, locations, climate normals, and worker voice phrases (`en`, `ar`, `ur`, `hi`, `bn`).
- `js/engine.js` — Pure agronomic & economic calculations (irrigation scheduling, leaching requirement, root-zone salinity, water blending, flow anomaly detection, water sharing).
- `js/tools.js` — Water mix chart, sensor calibration gauge, drip sparklines, crop planner, on-device date ripeness colour analysis, well-sharing schedule, and adviser map.
- `js/app.js` — State persistence (`localStorage`), Open-Meteo live forecast + Hargreaves offline backup, voice synthesis / WhatsApp / SMS export, theme toggle, and smooth tab transitions.
- `sw.js` & `manifest.json` & `icon.svg` — PWA offline cache and app icon.
