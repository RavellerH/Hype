const CACHE = 'hype-v16';
const STATIC = [
  './',
  './styles.css',
  './app.js',
  './signals.js',
  './news.js',
  './hlpulse.js',
  './ta-signal.js',
  './position-meta.js',
  './intel.js',
  './indicators.js',
  './analytics.js',
  './logger.js',
  './nansen.js',
  './mvrv-ai.js',
  './kb.js',
  './docs.html',
  './icons/icon.svg',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
];

// Immutable third-party assets — safe to serve cache-first forever
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(
    // Per-item, non-fatal precache: one unreachable asset (e.g. the fonts CDN)
    // must not abort the whole install — caches.addAll() is all-or-nothing.
    caches.open(CACHE)
      .then(c => Promise.allSettled(STATIC.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // CDN assets (fonts, chart.js, supabase-js): cache-first, they never change per URL
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return res;
      }).catch(() => new Response(null, { status: 599, statusText: 'Network error (sw)' })))
    );
    return;
  }

  // App shell & same-origin assets: network-first so a new deploy shows up on the
  // very next load; the cache copy is only an offline fallback. (The old
  // cache-first strategy made every deploy invisible until users reloaded twice.)
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return res;
      }).catch(() =>
        caches.match(req).then(hit => hit || new Response(null, { status: 599, statusText: 'Offline (sw)' }))
      )
    );
    return;
  }

  // Everything else is live API data (CoinGecko, DeFiLlama, raw.githubusercontent
  // briefs, RSS proxies…): never cache — the old strategy froze these responses
  // until the next cache-version bump.
  e.respondWith(
    fetch(req).catch(() => new Response(null, { status: 599, statusText: 'Network error (sw)' }))
  );
});
