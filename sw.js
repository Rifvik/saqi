/* Saqi service worker: app works fully offline after first visit. Network-first for app files, cache fallback. */
const CACHE = 'saqi-v19';
const FILES = ['./', 'index.html', 'styles.css', 'js/data.js', 'js/engine.js', 'js/tools.js', 'js/app.js', 'js/ai.js', 'js/shader-bg.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return; // forecasts in localStorage; AI routes live-only
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
