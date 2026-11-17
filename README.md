# Saqi ساقي — Salt-Smart Irrigation for Desert Farms

> **Salt-smart irrigation decision tool built for UAE & Gulf desert growers.**  
> Zero build step · Plain HTML, CSS & vanilla JavaScript · Works on any phone or desktop browser.

**Live app:** https://saqi-gamma.vercel.app/ · **Demo video:** _[add link here]_ · **Hackathon:** Breaking Bytes Ch. 1 (GDG on Campus BITS Pilani Dubai), track **Desert AgriTech**, problem **A-001 Smart Farming for the Desert**

## At a glance (for judges)

**Problem inside the problem.** Desert farms irrigate with brackish well water on a fixed timer. That habit wastes water in cool months. In hot months the salt it leaves behind builds up around the roots and silently cuts yields. Growers pour extra water to "flush salt" by guesswork. And the owner who decides is usually not the worker who opens the valve, who may not read Arabic or English.

**Decision Saqi makes:** *how many minutes to run each valve tonight, and when*. That includes the exact salt flush, and it's delivered as a voice note, an SMS/WhatsApp message and a QR code in Urdu, Hindi, Bengali, Arabic or English.

**Why it beats the grower's guess (shown in the app):**
- Every plan is compared with the farmer's fixed habit and with a weather-only app, in m³, AED and estimated yield.
- A **60-day root-zone salt forecast** shows the day each strategy starts costing yield.
- On the default farm with live November weather, Saqi uses ~35% less water than the habit and stays under every crop's salt threshold. Weather-only crosses the tomato threshold within a week.

**Features:** Today's per-valve plan with a likely-minutes range · "Why this runtime?" breakdown · 7-day savings vs guesswork · 60-day salt forecast · 3-tap EC-pen update · worker voice note / SMS / WhatsApp / QR in 5 languages · offline / airplane mode · drip clog and leak detection · water-mix optimiser (RO + brackish) · soil-sensor salt bias check · what-to-plant suitability · water sharing between neighbours · adviser triage across farms · farm map with area tool · Saqi AI assistant and 1-page PDF report (Gemini, optional).

**How the predictions work:** FAO-56 Penman-Monteith ET₀ (live, Open-Meteo) × FAO-56 crop coefficients. Salt flush via FAO-29 Rhoades leaching, capped by drainage. A daily root-zone salt balance whose equilibrium equals FAO-29. Maas–Hoffman salt yield loss and FAO-33 Ky water stress. Runtime ranges come from ET₀ / EC-pen / efficiency error. The offline Hargreaves ET₀ is calibrated against past live forecasts. **About → Live model checks** re-validates these on the user's data each time (e.g. raw Hargreaves vs live Penman-Monteith ≈ 23% error, 8% after calibration; salt model vs FAO-29 within 1%). Full equations: section 5.

**Data: real vs realistic.**
- *Real:* live weather/ET₀ (Open-Meteo), FAO crop and salt-tolerance constants.
- *Realistic synthetic, labelled in the app:* flow-meter logs, scenario weeks, adviser farms.
- *Illustrative:* yields and prices.
- *Assumed and labelled:* uncertainty ranges and the start salt level when there is no sensor.

**Desert rules.**
- Water: night scheduling, minimum flush, leak/clog alerts, sharing.
- Weak connectivity: works offline as a PWA with a cached or calibrated forecast; SMS / voice / QR handoff.
- Affordable: free, no account, phone-only start; an optional EC pen is ~55 AED.

**Tech stack:** HTML/CSS/vanilla JS (no build step) · Leaflet map · offline QR · Web Speech · service worker PWA · Python serverless (`/api/ai/*` on Vercel) with Google Gemini (optional, server-side key) · Node `node:test` + Python `unittest` tests.

---

## 1. The Core Idea (Why Saqi Exists)

Most irrigation tools focus only on evaporation. In Gulf desert farms, **two hidden problems** cause huge water waste and quiet crop losses:

1. **Salt flushing by guesswork:** Brackish groundwater leaves salt behind in the root zone. Growers pour extra water to wash salts out without calculating how much—either wasting scarce water, causing waterlogging under poor drainage, or letting root-zone salinity silently cut yields. Salt also fools cheap capacitive soil-moisture sensors into reading "too wet" and gradually blocks drip emitters.
2. **Owner ≠ Worker:** The farm owner often lives in the city while a field worker opens the valves—and may not read Arabic or English. Saqi turns weather, crop stage, drainage, and salinity into **one clear number per valve** plus a **spoken voice note & SMS/WhatsApp preview** in the worker's language (**Urdu, Hindi, Bengali, Arabic, or English**).

---

## 2. Quick Start (Run Locally in 10 Seconds)

**One-command launcher** (runs JS + Python test suites, then starts Saqi on `http://127.0.0.1:8765/index.html`):
- Windows: double-click or run `.\start-saqi.bat`
- macOS / Linux: `chmod +x start-saqi.sh && ./start-saqi.sh`

Or manually with **Python 3.10+** (includes all farm tools **plus** the Gemini-powered **Saqi AI Chatbot & Report Generator**):

```bash
git clone https://github.com/Rifvik/saqi.git
cd saqi
pip install -r requirements.txt
cp .env.example .env   # then set GEMINI_API_KEY inside .env (never commit .env)
python server.py
```

Open **`http://127.0.0.1:8765/index.html`** in your browser.  
*(On Windows if `python` is mapped to an alias, use `py -3 server.py`; for static-only local testing with AI disabled, `npx --yes serve -l 8765 .` works cleanly; set `SAQI_AI_MOCK=1` for offline AI demo replies without a Gemini key.)*

---

### Deploy on Vercel (Static Frontend + Python Serverless AI)

1. Push the repository to GitHub (never commit `.env`; `.gitignore` and `.vercelignore` exclude it automatically).
2. Import the repository into **Vercel** (`Framework Preset: Other` — `vercel.json` builds static files into `dist/` and deploys `/api/ai/*.py` serverless endpoints on Python 3.12).
3. Under **Project Settings → Environment Variables**, configure:
   - `GEMINI_API_KEY` *(required for live Gemini AI chat & reports)*
   - `GEMINI_MODEL` *(optional — defaults to `gemini-3.8-flash` with Flash fallbacks)*
   - `SAQI_AI_MOCK` *(optional — set `1` if deploying a demo without `GEMINI_API_KEY`)*
4. Click **Deploy**.
5. Open `https://<your-project>.vercel.app/` (or `/index.html`) and verify:
   - Farm calculators, Today, My Farm map, and Offline PDF work even if no AI env vars are set
   - `https://<your-project>.vercel.app/api/ai/status` returns JSON (`{"ok": true, "configured": ..., "model": ...}`)
   - Chat & Farm Report work end-to-end when `GEMINI_API_KEY` (or `SAQI_AI_MOCK=1`) is set.

---

## 3. Repository Structure & Module Guide

| File | Role | Key Exports / Responsibilities |
|---|---|---|
| [`index.html`](index.html) | Single-page shell & all views | Floating pill header, Homepage Zone-A Simulator (`#home`), 11 views (`#today`, `#farm`, `#blend`, `#sensor`, `#drip`, `#planner`, `#harvest`, `#share`, `#adviser`, `#assistant`, `#about`), Leaflet + Google Translate script tags |
| [`styles.css`](styles.css) | Complete UI design system | Light & Dark theme CSS variables (`:root` & `html[data-theme="dark"]`), frosted-glass floating header, smooth directional tab animations, printable/PDF report layout + RTL support |
| [`js/data.js`](js/data.js) | Reference agronomic tables & localization | `CROPS` (FAO-56 $K_c$, FAO-29 thresholds/slopes, FAO-33 $K_y$), `SYSTEMS`, `LOCATIONS`, `CLIMATE`, `SCENARIOS`, `SOILS`, `DRAINAGE`, `LANGS`, `PHRASES` |
| [`js/engine.js`](js/engine.js) | Pure math & agronomic engine (no DOM) | `Engine` module: ET₀/Kc, leaching, drainage-bounded root-zone $EC_e$, `blockDecision`, `weatherOnlyDecision`, `evaluate`, `optimiseBlend`, `seasonPlan`, `shareWater`, `flowCheck`, `decideZoneA`, WGS84 geodesic `polygonStats` |
| [`js/tools.js`](js/tools.js) | Interactive tools, charts, GIS map & public APIs | `renderBlend` + `svgChart`, `renderSensor`, `renderDrip`, `renderPlanner`, `drawSample`/`analyseHarvest`, `renderShare`, `renderAdviser`, `renderFieldMap`, `fetchPublicReadings` |
| [`js/app.js`](js/app.js) | App state, weather fetching, scroll motion & UI wiring | `localStorage` persistence (`saqi-state-v2`, `saqi-theme-v2`, `saqi-site-lang`), Open-Meteo 7-day forecast + Hargreaves fallback, `computeAll`, `renderToday`, `renderFarm`, `initHomeSim`, `initScrollMotion`, `initTranslatorUI`, `speechSynthesis` |
| [`js/ai.js`](js/ai.js) | AI Chatbot & PDF Report client | Builds verified farm context from live SAQI calculations, manages session chat history, reuses existing selected site language, renders multilingual RTL/LTR report previews, and builds A4 PDF exports (`html2canvas-pro` + `jsPDF`) |
| [`ai_service.py`](ai_service.py) | Shared Gemini AI service (`google-genai`) | Single shared service powering both `/api/ai/chat` and `/api/ai/report` using `gemini-3.8-flash` (with automatic Flash fallback on transient capacity spikes), server-side `GEMINI_API_KEY`, 44-language support, and fabricated-number grounding validation |
| [`ai_http.py`](ai_http.py) | Shared HTTP + rate-limit helper | Reused by both local `server.py` and Vercel `api/ai/*.py`: `MAX_BODY_BYTES` (256 KB), `RateLimiter`, proxy IP extraction, `serve_ai_status`, `serve_ai_post`, safe error formatting |
| [`api/ai/`](api/ai/) | Vercel Python serverless endpoints | `status.py`, `chat.py`, `report.py` (`BaseHTTPRequestHandler` subclasses) + `_common.py` adapter exposing `/api/ai/status`, `/api/ai/chat`, `/api/ai/report` on Vercel |
| [`server.py`](server.py) | Local web server + `/api/ai/*` proxy | Serves static files, loads optional git-ignored `.env`, exposes `/api/ai/status`, `/api/ai/chat`, `/api/ai/report`, blocks `.env`/`.py`/`tests/` downloads |
| [`vercel.json`](vercel.json) & [`.python-version`](.python-version) | Vercel deployment config | Stages static assets into `dist/`, excludes backend/tests from static CDN & Lambda bundles, sets Python 3.12 runtime and API security/cache headers |
| [`js/shader-bg.js`](js/shader-bg.js) | Theme-adaptive WebGL background | 16-layer warped plasma wave shader syncing smoothly between Light Alabaster and Dark Obsidian themes |
| [`vendor/`](vendor/) | Vendored zero-CDN offline libraries | Local copies of GSAP, ScrollTrigger, `html2canvas-pro`, `jsPDF`, and UTF-8 `qrcode.js` so offline field use never depends on third-party CDNs |
| [`sw.js`](sw.js) | Service Worker cache | Caches core app shell + vendored `vendor/*` files (`saqi-v24`) while bypassing `/api/*` for live AI calls |
| [`start-saqi.bat`](start-saqi.bat) & [`start-saqi.sh`](start-saqi.sh) | One-command launch & verify | Runs JS engine & Python unit tests, then launches the local Saqi server on port `8765` |
| [`tests/engine.test.js`](tests/engine.test.js) | Automated JS unit tests | Zero-dependency `node:test` suite verifying FAO-29/56 equations, drainage caps, zero-flow guards, blending, and GIS geometry |
| [`tests/test_ai.py`](tests/test_ai.py) | Automated Python AI & server tests | `unittest` suite testing `SaqiAIService`, Gemini error sanitization, number validation, multilingual/RTL output, and `server.py` security |
| [`manifest.json`](manifest.json) & [`icon.svg`](icon.svg) | PWA metadata & vector icon | App name, theme colors, droplet emblem |

---

## 4. Every Page / Module Explained

### 🏠 Homepage (`#home`)
- **Hero & Live Water Preview:** Tracks **Zone A** (2 ha drip-irrigated date palms, $40\text{ m}^3/\text{h}$ block flow, 240-min summer habit $= 160{,}000\text{ L}$) using the **exact same FAO-56 + FAO-29 engine (`Engine.decideZoneA()` → `blockDecision()` + `weatherOnlyDecision()`)** as Tonight's Plan.
- **3-Card Overview (`#problem`, `#engine`, `#results`):** Summarizes heat + salinity risk, the 3-step *Sense → Decide → Act* loop, and adapts honestly between **water saved** (typical/mild weather) and **crop protection water added** (when fixed habits under-water during heatwaves).
- **Interactive Field Simulator (`#demo`):** Switch between **Normal Day**, **48°C Heatwave**, and **High Water Salinity (6.5 dS/m)** or drag the 4 sliders (**Air temperature**, **Water salinity $EC_w$**, **Soil moisture**, **Humidity**) to compare **Habit vs. Weather-Only vs. Saqi** side-by-side, with an explicit **`Scenario ET₀ (Hargreaves)` badge** and one-click **`🔄 Seed from today's live ET₀`**.

### 💧 1. Today's Plan (`#today` — `renderToday()` in `js/app.js`)
- **Judge Demo, Sunlit Field Mode & Airplane-Mode Proof:** One-tap **`⚖️ Judge Demo`** resets the canonical Al Ain 4-valve showcase and opens Valve 1's *Why this runtime?* calculation; **`☀️ Field Mode`** switches to a high-contrast sunlit UI with `≥ 46px` touch controls; **`✈️ Airplane-mode test`** in Tools (plus **`#todayOfflineChip`**) proves zero-network cached forecast + Hargreaves $\text{ET}_0$ resilience live.
- **3-Tap EC Pen Check (`⚡ EC Pen`):** Quick preset chips (`1.5`, `3.0`, `5.5`, `8.0 dS/m`) or custom pocket-pen reading update `state.water.ec` and recalculate every valve immediately.
- **Data Confidence & Provenance Strip (`#dataConfidence`):** Shows the source, freshness, and uncertainty of every input:
  - *Weather:* Live Open-Meteo forecast timestamp vs. cached forecast vs. Hargreaves fallback.
  - *Water $EC_w$:* Source (EC pen, lab test, or estimated) and age in days (flags stale measurements $> 30$ days).
  - *Soil $EC_e$:* Modeled FAO-29 steady-state estimate + active subsurface drainage class.
  - *Flow:* Flags active emitter clog or pipe burst anomalies.
- **7-Day Forecast & Heatwave Pre-Watering:** Highlights days $\ge$ `heatThreshold` (default $45\,^\circ\text{C}$), recommends night irrigation (`21:00–05:00`), and triggers a **`+10% pre-heatwave buffer`** the evening before a heatwave begins.
- **Per-Valve Decision Cards:** Displays recommended minutes (rounded to 5-min steps), volume ($\text{m}^3$), gross depth ($\text{mm}$), block flow ($\text{m}^3/\text{h}$), and a progressive-disclosure **`Why this runtime?`** breakdown.
- **Three-Way 7-Day Comparison + Offline 1-Page PDF:** Features the **"Beat the guess" story card (`#compareStory`)**, 7-day **salt risk dot strip** per valve, and compares **Saqi** against both **Weather-only ($\text{ET}_0 \times K_c / E_a$, no salt flush)** and **Fixed daily habit** — plus a zero-AI **`📄 1-Page Plan PDF (Offline)`** generator powered by local vendored `jsPDF` + QR vector rendering.
- **Voice Note, Valve Filter, SMS/WhatsApp & Offline Worker QR (`#voiceBox`):** Generates concise valve instructions for **All valves** or an **individual valve (`#voiceValve`)** in **English, Arabic, Urdu, Hindi, or Bengali**, plays them aloud via `speechSynthesis`, generates a **0-network UTF-8 QR code card (`📱 Worker QR Card`)** with print slip support, or opens an **SMS / WhatsApp Preview** composer *(note: actual automated SMS delivery requires a server-side SMS gateway and sender connectivity)*.

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

### 🤖 10. Saqi AI Assistant & Farm Report (`#assistant` — `js/ai.js` + `ai_service.py`)
- **Context-Aware Farming Chatbot:** Uses `google-genai` (`gemini-3.8-flash`) grounded strictly on SAQI's calculated farm context (`location`, `weather`, `water ECw`, `drainage`, `soil probe`, per-valve minutes, volumes, salt flush %, modeled `ECe`, 7-day comparison, drip alerts), maintains session conversation history (`sessionStorage`), provides suggested questions, and automatically responds in whichever of the 44 site languages is active in the top **Translate** selector.
- **AI Farm Report & Multilingual PDF Export:** Generates a structured, personalized report combining SAQI's verified tables with AI narrative sections (*Farm Overview, Environment, Crop-Wise Irrigation, Salinity Analysis, Water Usage & Savings, Risks & Prevention, Prioritised Recommendations*), with automatic `RTL`/`LTR` support and one-click **Download PDF** (`html2canvas-pro` + `jsPDF`) plus native **Print / Save PDF**.

### ℹ️ 11. Why Saqi (`#about`)
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
| **Transient Root-Zone Salt (60-day forecast)** | Daily bucket: $W_e \,\Delta EC_e = I\,EC_w - D \cdot \dfrac{5\,EC_e}{1+LF}$, $D = \min(\max(0, I-\text{ET}_c),\, LF_{\text{drainMax}} I)$, $W_e = 2\,\theta_{fc}\,z_{root}$ | Equilibrium equals FAO-29 Rhoades; root depth FAO-56 Table 22. `Engine.saltForecast()` |
| **Runtime Uncertainty Range** | Same decision re-run at $\text{ET}_0(1\pm u)$, $EC_w \pm (2\% + 0.1)$, $E_a \pm 0.05$; $u$ = 10% live, 15% cached, 20% climate | `Engine.runtimeRange()`, assumptions in `UNCERTAINTY` (`js/data.js`) |
| **Local Hargreaves Calibration** | $k = \sum \text{ET}_{0,PM} / \sum \text{ET}_{0,HG}$ learned from each live forecast, applied to the offline backup | `Engine.hargreavesBias()` |

**Why the transient model matters:** salt does not reach steady state overnight. The weekly comparison and the 60-day card integrate the daily salt balance from a starting ECe (measured soil sensor if enabled, otherwise *assumed* 80% of the crop threshold), so the app can say *when* each strategy starts costing yield rather than assuming instant equilibrium.

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

## 8. Running Tests & Offline Scope

Run syntax checks and both the automated Node agronomic engine tests and Python AI/server tests:

```bash
node --check js/data.js js/engine.js js/tools.js js/app.js js/ai.js js/hero-cinema.js js/shader-bg.js sw.js
node --test tests/engine.test.js
python -m unittest discover -s tests -v
```

> **Serverless Caveats (Vercel):**
> - In-memory rate limiting (`30 req/min/IP` in `ai_http.py`) applies per warm serverless instance, not globally across edge regions. Use Vercel WAF / Rate Limiting Rules in production if strict global quotas are required.
> - First request to a cold Python container may incur a short cold-start delay (`~1–2 s`); subsequent chat/report calls reuse the cached `genai.Client`.
> - Free Hobby builds/functions must stay under Vercel's bundle size limits (`excludeFiles` + `.vercelignore` strip `js/`, `vendor/`, `tests/` from Python Lambda packages automatically).

> **Scope & Offline Behavior:** After first visit, the Service Worker (`sw.js`) caches HTML/CSS/JS core assets and `localStorage` caches forecasts with Hargreaves $\text{ET}_0$ offline fallback. External map tiles (Esri/OSM), Google Fonts, Google Website Translator, and live satellite/public APIs require connectivity; SMS/WhatsApp buttons open device composers as previews (automated push SMS requires a gateway).
>
> **Disclaimer:** Prototype decisions, modeled root-zone salinity ($EC_e$), and economic returns are planning estimates for demonstration and decision support—always verify with local soil tests and agricultural extension guidance.
