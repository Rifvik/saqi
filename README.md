# Saqi ساقي — Salt-Smart Irrigation for Desert Farms

> **Salt-smart irrigation decision tool built for UAE & Gulf desert growers.**  
> Zero build step · Plain HTML, CSS & vanilla JavaScript · Works on any phone or desktop browser.

---

## 1. The Core Idea (Why Saqi Exists)

Most irrigation tools focus only on evaporation. In Gulf desert farms, **two hidden problems** cause huge water waste and quiet crop losses:

1. **Salt flushing by guesswork:** Brackish groundwater leaves salt behind in the root zone. Growers pour extra water to wash salts out without calculating how much—either wasting scarce water, causing waterlogging under poor drainage, or letting root-zone salinity silently cut yields. Salt also fools cheap capacitive soil-moisture sensors into reading "too wet" and gradually blocks drip emitters.
2. **Owner ≠ Worker:** The farm owner often lives in the city while a field worker opens the valves—and may not read Arabic or English. Saqi turns weather, crop stage, drainage, and salinity into **one clear number per valve** plus a **spoken voice note & SMS/WhatsApp preview** in the worker's language (**Urdu, Hindi, Bengali, Arabic, or English**).

---

## 2. Quick Start (Run Locally in 10 Seconds)

No `npm install`, bundler, or database is required.

```bash
git clone https://github.com/Rifvik/saqi.git
cd saqi
python -m http.server 8765
```

Open **`http://localhost:8765/index.html`** in your browser.  
*(Any static file server works—e.g. VS Code Live Server or `npx serve`.)*

---

## 3. Repository Structure & Module Guide

| File | Role | Key Exports / Responsibilities |
|---|---|---|
| [`index.html`](index.html) | Single-page shell & all 11 views | Floating pill header, Homepage Zone-A Simulator (`#home`), 10 farm tool views (`#today`, `#farm`, `#blend`, `#sensor`, `#drip`, `#planner`, `#harvest`, `#share`, `#adviser`, `#about`), Leaflet + Google Translate script tags |
| [`styles.css`](styles.css) | Complete UI design system | Light & Dark theme CSS variables (`:root` & `html[data-theme="dark"]`), frosted-glass floating header, smooth directional tab animations, responsive grids, interactive slider & map styles |
| [`js/data.js`](js/data.js) | Reference agronomic tables & localization | `CROPS` (FAO-56 $K_c$, FAO-29 thresholds/slopes, FAO-33 $K_y$), `SYSTEMS`, `LOCATIONS`, `CLIMATE`, `SCENARIOS`, `SOILS`, `DRAINAGE`, `LANGS`, `PHRASES` |
| [`js/engine.js`](js/engine.js) | Pure math & agronomic engine (no DOM) | `Engine` module: ET₀/Kc, leaching, drainage-bounded root-zone $EC_e$, `blockDecision`, `weatherOnlyDecision`, `evaluate`, `optimiseBlend`, `seasonPlan`, `shareWater`, `flowCheck`, `decideZoneA`, WGS84 geodesic `polygonStats` |
| [`js/tools.js`](js/tools.js) | Interactive tools, charts, GIS map & public APIs | `renderBlend` + `svgChart`, `renderSensor`, `renderDrip`, `renderPlanner`, `drawSample`/`analyseHarvest`, `renderShare`, `renderAdviser`, `renderFieldMap`, `fetchPublicReadings` |
| [`js/app.js`](js/app.js) | App state, weather fetching, voice & UI wiring | `localStorage` persistence (`saqi-state-v2`, `saqi-theme-v2`, `saqi-site-lang`), Open-Meteo 7-day forecast + Hargreaves fallback, `computeAll`, `renderToday`, `renderFarm`, `initHomeSim`, `initTranslatorUI`, `speechSynthesis` |
| [`sw.js`](sw.js) | Service Worker cache | Caches static app files (`saqi-v13`) for resilient reload/offline fallback on `localhost` / HTTPS |
| [`manifest.json`](manifest.json) & [`icon.svg`](icon.svg) | PWA metadata & vector icon | App name, theme colors, droplet emblem |

---

## 4. Every Page / Module Explained

### 🏠 Homepage (`#home`)
- **Hero & Live Water Preview:** Presents the core value proposition with a live preview card tracking **Zone A** (2 ha drip-irrigated date palms, $40\text{ m}^3/\text{h}$ block flow) against a 20,000 L traditional fixed schedule.
- **3-Card Overview (`#problem`, `#engine`, `#results`):** Summarizes heat + salinity risk, the 3-step *Sense → Decide → Act* loop, and live water savings.
- **Interactive Field Simulator (`#demo`):** Implemented by `Engine.decideZoneA()` and `initHomeSim()`. Switch between **Normal Day**, **48°C Heatwave**, and **High Soil Salinity Spike** or drag the 4 sliders (**Temperature**, **Soil salinity**, **Soil moisture**, **Humidity**) to watch runtime, salt-leaching flush %, stress risk, and litres saved update live.

### 💧 1. Today's Plan (`#today` — `renderToday()` in `js/app.js`)
- **Data Confidence & Provenance Strip (`#dataConfidence`):** Shows the source, freshness, and uncertainty of every input:
  - *Weather:* Live Open-Meteo forecast timestamp vs. cached forecast vs. Hargreaves fallback.
  - *Water $EC_w$:* Source (EC pen, lab test, or estimated) and age in days (flags stale measurements $> 30$ days).
  - *Soil $EC_e$:* Modeled FAO-29 steady-state estimate + active subsurface drainage class.
  - *Flow:* Flags active emitter clog or pipe burst anomalies.
- **7-Day Forecast & Heatwave Pre-Watering:** Highlights days $\ge$ `heatThreshold` (default $45\,^\circ\text{C}$), recommends night irrigation (`21:00–05:00`), and triggers a **`+10% pre-heatwave buffer`** the evening before a heatwave begins.
- **Per-Valve Decision Cards:** Displays recommended minutes (rounded to 5-min steps), volume ($\text{m}^3$), gross depth ($\text{mm}$), block flow ($\text{m}^3/\text{h}$), and a transparent **`Why:`** calculation breakdown.
- **Three-Way 7-Day Comparison:** Compares **Saqi** against both:
  1. **Weather-only ($\text{ET}_0 \times K_c / E_a$, no salt flush)** — proves the crop-value protection added specifically by salinity management; and
  2. **Fixed daily habit** — shows water and cost savings over guesswork.
- **Voice Note & SMS/WhatsApp Preview (`#voiceBox`):** Generates concise valve instructions in **English, Arabic, Urdu, Hindi, or Bengali**, plays them aloud via the browser's Web Speech API (`speechSynthesis`), copies text, or opens an **SMS / WhatsApp Preview** composer *(note: actual automated SMS delivery requires a server-side SMS gateway and sender connectivity)*.

### 🌴 2. My Farm — Field Map, Grid Area & Public Feeds (`#farm` — `js/tools.js` & `js/app.js`)
- **Interactive GIS Map & Grid Area Calculator (`renderFieldMap()`):**
  - Jump to your browser GPS (`📍 My current location`) or search any town/coordinates (`lat, lon`) via **OpenStreetMap Nominatim**.
  - Toggle between **Esri World Imagery (Satellite)** and **OpenStreetMap (Street)** layers using **Leaflet**.
  - Click map corners (`✏️ Draw corners`), drag numbered pins (`1, 2, 3, 4`), or click `⬛ Snap grid box`.
  - Overlay configurable irrigation sub-plot grids (`10m`, `25m`, `50m`, or `100m` cells) and compute exact **WGS84 geodesic area ($\text{ha}$ & $\text{m}^2$)**, perimeter ($\text{m}$), and cell count (`Engine.polygonStats()`).
  - Click **`Apply area & location to farm`** to push the measured area to any valve block and fetch local forecasts for that exact point.
- **Open Public Data Feeds (`fetchPublicReadings()`):** Queries three public endpoints in real time for the mapped field:
  1. **Open-Meteo Land-Surface & Soil Model (ECMWF / ICON):** Air temp, RH, VPD ($\text{kPa}$), surface soil temp ($0\text{ cm}$), soil moisture ($0\text{–}1$, $3\text{–}9$, $9\text{–}27\text{ cm}$ VWC), elevation, and today's FAO-56 $\text{ET}_0$.
  2. **NASA POWER Agroclimatology Satellite Archive:** Monthly solar irradiance ($\text{MJ}/\text{m}^2/\text{day}$), temperature, and humidity normals.
  3. **OpenStreetMap Nominatim:** Reverse-geocoded district/emirate name.
  - One button (**`Use live soil & weather in Sensor Check + Simulator`**) copies live readings directly into the moisture sensor tool and homepage simulator.
- **Water, Drainage & Block Flow Configuration:**
  - Configure irrigation water salinity $EC_w$, EC measurement source & test date, subsurface drainage (`Good`, `Moderate`, `Poor`), cost ($\text{AED}/\text{m}^3$), and start time.
  - Configure each valve using either **Direct block flow ($\text{m}^3/\text{h}$)** or **Emitter flow ($\text{L/h}$) × Emitter count** (`Engine.resolveBlockFlow()`), preventing the common bug of using a single emitter's L/h instead of total block flow.

### ⚗️ 3. Water Mix Optimizer (`#blend` — `renderBlend()` & `Engine.optimiseBlend()`)
- Sweeps $0\text{–}100\%$ blending ratios between **Source A** (expensive low-EC desalinated RO water) and **Source B** (cheap brackish well water, subject to daily well $\text{m}^3/\text{day}$ capacity).
- Accounts for the extra leaching water required as blended $EC_w$ rises, plots **Profit vs. Water Cost** across the blend curve, and finds the most profitable feasible mix.

### 📟 4. Sensor Check — Salt Bias Correction (`#sensor` — `renderSensor()`)
- Cheap capacitive moisture probes ($\approx 15\text{ AED}$) misread dissolved salts as extra water:
  $$\text{bias} \approx k \times EC_e \times \frac{\text{reading}}{10}$$
- Compares the raw sensor decision (*"Wait"*) against the salt-corrected moisture (*"IRRIGATE NOW"*) on a soil-specific gauge (`Sand`, `Loamy sand`, `Sandy loam`), computes refill depth ($\text{mm}$ / $\text{L}/\text{m}^2$), and provides a **1-sample oven-dry calibration calculator** to solve $k$ for your field soil.

### 🚿 5. Drip Health (`#drip` — `renderDrip()` & `Engine.flowCheck()`)
- Tracks a 14-day rolling flow ratio ($\text{measured flow} \div \text{design block flow}$) with sparkline bands ($\pm 12\%$ normal tolerance):
  - **Clogging:** $< 88\%$ of design flow for $2+$ consecutive readings (recommends lateral flushing / acid treatment rather than longer runtimes).
  - **Leak / Burst:** $> 112\%$ of design flow (estimates $\text{m}^3$ lost per irrigation).
- Lets users log new daily flow-meter readings directly on device.

### 🌱 6. What to Plant — Crop Suitability Estimate (`#planner` — `renderPlanner()` & `Engine.seasonPlan()`)
- Ranks 9 desert/Gulf crops (**Date palm, Tomato, Cucumber, Lettuce, Barley, Quinoa, Sorghum, Bermuda grass, Alfalfa**) by **estimated net return per cubic metre ($\text{AED}/\text{m}^3$)** under your water $EC_w$, irrigation efficiency, drainage capacity, and well peak capacity ($\text{m}^3/\text{ha}/\text{day}$).
- Displays **Suitability (`Good` / `Marginal` / `Poor`)**, **Modeled $EC_e$ vs. threshold**, **Drainage-capped LF**, and **Estimated relative yield** (explicitly labeled as model estimates, not guaranteed yields).

### 📷 7. Date Harvest Ripeness Check (`#harvest` — `drawSample()` & `analyseHarvest()`)
- Runs 100% on-device pixel HSV color analysis on an uploaded camera photo (or built-in synthetic samples: **Kimri, Khalal, Rutab, Tamr**).
- Classifies the ripening stage and adjusts late-season irrigation advice (e.g., cutting water $20\text{–}30\%$ at *Khalal* and keeping fruit dry at *Rutab* to prevent splitting and souring).

### 🤝 8. Water Sharing Between Neighbours (`#share` — `renderShare()` & `Engine.shareWater()`)
- Models a shared well or *falaj* with percentage rights (`%`). Farms with surplus rights sell credits ($\text{AED}/\text{m}^3$) to neighbours in deficit rather than over-pumping ("use it or lose it"), leaving unused water in the aquifer and generating a **night-first pumping timetable** starting at `18:00`.

### 🛰️ 9. Adviser Triage (`#adviser` — `renderAdviser()`)
- Demonstrates how an agricultural adviser prioritizes 40 regional farms (`Al Ain`, `Liwa`, `Al Dhaid`, `Madinat Zayed`) by weighted risk score:
  - $45\%$ NDVI vigour drop, $25\%$ NDMI water stress, $20\%$ water $EC_w$ vs. crop threshold, $10\%$ days since last visit.

### ℹ️ 10. Why Saqi (`#about`)
- Crisp 1-minute pitch summarizing the **Salt Trap**, **Owner ≠ Worker** gap, **Zero-Hardware Start**, **Desert Rules**, and **Real vs. Synthetic Data Transparency**.

### 🌐 Whole-Website Translator & 🌙 Dark / Light Mode (`js/app.js`)
- **Translate (`#langBtn`):** Searchable 44-language picker translating the entire interface via Google Website Translator (with automatic `RTL` layout switching for Arabic, Urdu, Persian, Pashto, and Hebrew, plus hidden Google banner bar).
- **Theme Toggle (`#themeToggle`):** Switches cleanly between Light Oasis (`oklch(0.985 0.003 90)`) and Dark Glass (`oklch(0.16 0.01 60)`) themes, updating all charts, maps, and inputs via CSS custom properties.

---

## 5. Core Agronomic Equations (`js/engine.js`)

| Concept | Formula / Method in Code | Reference |
|---|---|---|
| **Crop Water Use ($\text{ET}_c$)** | $\text{ET}_c = K_c(\text{stage, day}) \times \text{ET}_0$ | FAO Irrigation & Drainage Paper 56 |
| **Offline $\text{ET}_0$ Backup** | $0.0023 (T_{\text{mean}} + 17.8)\sqrt{T_{\max}-T_{\min}} \cdot R_a \cdot 0.408$ | Hargreaves equation (FAO-56 Eq. 52) |
| **Target Leaching Requirement** | $LR = \dfrac{EC_w}{5 \cdot EC_{e,\text{thr}} - EC_w}$, bounded by `DRAINAGE[drainage].maxLF` | Rhoades equation (FAO Paper 29) |
| **Modeled Root-Zone Salinity** | $EC_e = \dfrac{EC_w (1 + LF_{\text{eff}})}{5 \cdot LF_{\text{eff}}}$, where $LF_{\text{eff}} = \min(LF_{\text{raw}}, LF_{\text{drainMax}})$ | Steady-state drainage-constrained balance |
| **Gross Irrigation & Minutes** | $D_{\text{gross}} = \dfrac{\max(0, \text{ET}_c - R_{\text{eff}}) \cdot f_{\text{heat}}}{(1 - LR)\cdot E_a}$, $\; t = \dfrac{D_{\text{gross}} \cdot A \cdot 10}{Q_{\text{block}}} \times 60$ | Single application of $LR$ and $E_a$ (no double counting); $Q_{\text{block}}$ in $\text{m}^3/\text{h}$ |
| **Est. Relative Yield** | $Y_s = 1 - \frac{b}{100}(EC_e - EC_{e,\text{thr}})$ combined with water-deficit factor $1 - K_y(1 - \frac{I}{\text{ET}_c})$ | Maas–Hoffman & FAO Paper 33 |

---

## 6. Data Provenance (What Is Real vs. Demo Synthetic)

| Dataset | Status | Details |
|---|---|---|
| 7-day weather, $\text{ET}_0$, VPD & soil moisture | **Real live API** | Open-Meteo Forecast & ECMWF/ICON land-surface model |
| Monthly solar irradiance & climate normals | **Real live API** | NASA POWER Agroclimatology Satellite (`power.larc.nasa.gov`) |
| Reverse geocoding & place search | **Real live API** | OpenStreetMap Nominatim |
| Satellite imagery & street basemaps | **Real live tiles** | Esri World Imagery & OpenStreetMap via Leaflet |
| Crop $K_c$, $EC_e$ thresholds, Maas–Hoffman slopes | **Real published** | FAO Paper 56 & FAO Paper 29 |
| Date harvest photo ripeness check | **Real on-device** | Canvas RGB → HSV pixel classification |
| Drip 14-day flow logs & 40 Adviser farms | **Synthetic demo** | Seeded realistic examples for prototype demonstration |
| UAE crop yields, farm-gate prices & sensor default $k$ | **Illustrative** | Editable defaults; calibrate $k$ with one oven-dried soil sample |

---

## 7. How Teammates Can Reuse UI Elements or Engine Functions

- **Copy the UI system:** Take [`styles.css`](styles.css) for the light/dark tokens (`:root`, `html[data-theme="dark"]`), floating `.nav-pill.glass`, `.card`, `.kpi`, `.tag`, `.alert`, `.simulator-range`, and smooth `.tab` animations.
- **Reuse the pure math engine:** [`js/engine.js`](js/engine.js) + [`js/data.js`](js/data.js) have **zero DOM dependencies** and work directly in both browsers and Node.js (`require('./js/engine.js')`).

---

## 8. Running Tests

Syntax and unit tests can be run with Node.js:

```bash
node --check js/data.js js/engine.js js/tools.js js/app.js sw.js
```

> **Disclaimer:** Prototype decisions, modeled root-zone salinity ($EC_e$), and economic returns are planning estimates for demonstration and decision support—always verify with local soil tests and agricultural extension guidance.
