'use strict';
/* Saqi — reference data.
 * Crop coefficients (Kc, stage lengths): FAO Irrigation & Drainage Paper 56 (arid-region values).
 * Salt tolerance (ECe threshold dS/m, % yield loss per dS/m): FAO Paper 29 (Ayers & Westcot), Maas-Hoffman model.
 * Ky (yield response to water): FAO Paper 33 / 66, approximate.
 * Yields & farm-gate prices: illustrative UAE values for a prototype — editable in code, not official statistics.
 */
const CROPS = {
  date:     { name: 'Date palm',              perennial: true,  kc: [0.90, 0.95, 0.95], stages: [0, 0, 365, 0],   ecThr: 4.0, ecSlope: 3.6,  ky: 0.8,  yield: 10,  price: 7.0, plantMonth: 1 },
  tomato:   { name: 'Tomato',                 perennial: false, kc: [0.60, 1.15, 0.80], stages: [30, 40, 40, 25], ecThr: 2.5, ecSlope: 9.9,  ky: 1.05, yield: 45,  price: 2.5, plantMonth: 10 },
  cucumber: { name: 'Cucumber',               perennial: false, kc: [0.60, 1.00, 0.75], stages: [20, 30, 40, 15], ecThr: 2.5, ecSlope: 13.0, ky: 1.1,  yield: 35,  price: 3.0, plantMonth: 10 },
  lettuce:  { name: 'Lettuce',                perennial: false, kc: [0.70, 1.00, 0.95], stages: [20, 30, 15, 10], ecThr: 1.3, ecSlope: 13.0, ky: 1.0,  yield: 25,  price: 3.5, plantMonth: 11 },
  barley:   { name: 'Barley (grain)',         perennial: false, kc: [0.30, 1.15, 0.25], stages: [15, 25, 50, 30], ecThr: 8.0, ecSlope: 5.0,  ky: 1.0,  yield: 4,   price: 1.2, plantMonth: 11 },
  quinoa:   { name: 'Quinoa',                 perennial: false, kc: [0.50, 1.00, 0.70], stages: [25, 35, 40, 20], ecThr: 8.0, ecSlope: 3.5,  ky: 0.8,  yield: 2.5, price: 8.0, plantMonth: 11 },
  sorghum:  { name: 'Sorghum (grain)',        perennial: false, kc: [0.30, 1.00, 0.55], stages: [20, 35, 40, 30], ecThr: 6.8, ecSlope: 16.0, ky: 0.9,  yield: 5,   price: 1.3, plantMonth: 3 },
  bermuda:  { name: 'Bermuda grass (forage)', perennial: true,  kc: [0.90, 0.90, 0.90], stages: [0, 0, 365, 0],   ecThr: 6.9, ecSlope: 6.4,  ky: 1.0,  yield: 25,  price: 0.9, plantMonth: 1 },
  alfalfa:  { name: 'Alfalfa',                perennial: true,  kc: [0.95, 0.95, 0.95], stages: [0, 0, 365, 0],   ecThr: 2.0, ecSlope: 7.3,  ky: 1.1,  yield: 18,  price: 1.3, plantMonth: 1 },
};

const SYSTEMS = {
  drip:      { name: 'Drip',      eff: 0.90 },
  sprinkler: { name: 'Sprinkler', eff: 0.75 },
  flood:     { name: 'Flood / basin', eff: 0.60 },
};

const LOCATIONS = {
  alain:  { name: 'Al Ain, UAE',          lat: 24.21, lon: 55.74 },
  liwa:   { name: 'Liwa Oasis, UAE',      lat: 23.13, lon: 53.77 },
  dhaid:  { name: 'Al Dhaid, UAE',        lat: 25.29, lon: 55.88 },
  dubai:  { name: 'Dubai, UAE',           lat: 25.20, lon: 55.27 },
  nizwa:  { name: 'Nizwa, Oman',          lat: 22.93, lon: 57.53 },
  kharj:  { name: 'Al Kharj, Saudi Arabia', lat: 24.15, lon: 47.31 },
};

/* Typical UAE-interior monthly climate (approximate long-term normals), Jan..Dec.
 * Used for the crop planner and as an offline fallback when no forecast is cached. */
const CLIMATE = {
  et0:  [3.0, 3.9, 5.2, 6.8, 8.5, 9.4, 9.2, 8.8, 7.6, 5.9, 4.1, 3.1], // mm/day
  tmax: [24, 26, 30, 35, 40, 43, 44, 44, 41, 37, 31, 26],
  tmin: [12, 13, 16, 20, 24, 27, 30, 30, 27, 22, 18, 14],
};

/* Realistic synthetic 7-day scenarios (shaped on typical UAE interior weather). */
const SCENARIOS = {
  nov:  { label: 'Mid-November week (realistic synthetic)',
          tmax: [32, 33, 31, 32, 34, 33, 31], tmin: [20, 21, 19, 20, 22, 21, 19],
          et0: [4.3, 4.5, 4.0, 4.2, 4.7, 4.4, 4.0], wind: [14, 16, 22, 15, 12, 18, 25], rain: [0, 0, 0, 0, 0, 1.2, 0] },
  july: { label: 'July heatwave week (realistic synthetic)',
          tmax: [44, 46, 48, 49, 47, 45, 44], tmin: [31, 32, 33, 34, 33, 32, 31],
          et0: [8.9, 9.6, 10.4, 10.8, 10.1, 9.3, 8.8], wind: [18, 20, 24, 26, 21, 18, 16], rain: [0, 0, 0, 0, 0, 0, 0] },
};

/* Sandy desert soils: field capacity / wilting point, % volumetric water content. */
const SOILS = {
  sand:      { name: 'Sand (dune / typical desert)', fc: 10, wp: 4 },
  loamysand: { name: 'Loamy sand', fc: 14, wp: 6 },
  sandyloam: { name: 'Sandy loam', fc: 20, wp: 9 },
};

/* Subsurface drainage / water-table suitability: limits safe leaching fraction (LF).
 * If excess water cannot drain below roots, extra leaching causes waterlogging & salt retention. */
const DRAINAGE = {
  good:     { name: 'Good drainage (deep sand, water table > 2 m)', maxLF: 0.45 },
  moderate: { name: 'Moderate drainage (slow subsoil / clay lens)', maxLF: 0.20 },
  poor:     { name: 'Poor drainage / high water table (< 1 m)',    maxLF: 0.05 },
};

/* Worker voice-note languages. Many Gulf farm workers speak Urdu, Hindi, Bengali or Arabic. */
const LANGS = {
  en: { name: 'English', bcp: 'en-US', dir: 'ltr' },
  ar: { name: 'العربية Arabic', bcp: 'ar-SA', dir: 'rtl' },
  ur: { name: 'اردو Urdu', bcp: 'ur-PK', dir: 'rtl' },
  hi: { name: 'हिन्दी Hindi', bcp: 'hi-IN', dir: 'ltr' },
  bn: { name: 'বাংলা Bengali', bcp: 'bn-IN', dir: 'ltr' },
};

const PHRASES = {
  run: {
    en: 'Valve {v}: run {m} minutes, start after {t}.',
    ar: 'الصمام {v}: شغّل {m} دقيقة، ابدأ بعد الساعة {t}.',
    ur: 'والو {v}: {m} منٹ چلائیں، {t} بجے کے بعد شروع کریں۔',
    hi: 'वाल्व {v}: {m} मिनट चलाएं, {t} बजे के बाद शुरू करें।',
    bn: 'ভালভ {v}: {m} মিনিট চালান, {t}টার পরে শুরু করুন।',
  },
  none: {
    en: 'Valve {v}: no water today.',
    ar: 'الصمام {v}: لا سقي اليوم.',
    ur: 'والو {v}: آج پانی نہیں۔',
    hi: 'वाल्व {v}: आज पानी नहीं।',
    bn: 'ভালভ {v}: আজ পানি নয়।',
  },
  heat: {
    en: 'Very hot days are coming. Water at night only.',
    ar: 'أيام حارة جداً قادمة. اسقِ في الليل فقط.',
    ur: 'بہت گرم دن آرہے ہیں۔ صرف رات کو پانی دیں۔',
    hi: 'बहुत गर्म दिन आ रहे हैं। केवल रात में पानी दें।',
    bn: 'খুব গরম দিন আসছে। শুধু রাতে পানি দিন।',
  },
  clog: {
    en: 'Check drip line {v}, the water flow is low.',
    ar: 'افحص خط التنقيط {v}، التدفق منخفض.',
    ur: 'ڈرپ لائن {v} چیک کریں، پانی کا بہاؤ کم ہے۔',
    hi: 'ड्रिप लाइन {v} जांचें, पानी का बहाव कम है।',
    bn: 'ড্রিপ লাইন {v} পরীক্ষা করুন, পানির প্রবাহ কম।',
  },
  leak: {
    en: 'Valve {v}: water is leaking, check the pipes.',
    ar: 'الصمام {v}: يوجد تسرب، افحص الأنابيب.',
    ur: 'والو {v}: پانی لیک ہو رہا ہے، پائپ چیک کریں۔',
    hi: 'वाल्व {v}: पानी लीक हो रहा है, पाइप जांचें।',
    bn: 'ভালভ {v}: পানি লিক হচ্ছে, পাইপ পরীক্ষা করুন।',
  },
};
