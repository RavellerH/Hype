const CACHE = 'hype-v14';

// Precached as an offline fallback only — the network always wins when it is
// reachable (see the fetch handler), so a new deploy shows up on the very
// next load on every host it is deployed to (GitHub Pages, Vercel, …)
// instead of each origin staying pinned to whatever its cache last saw.
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
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
];

// Versioned/immutable CDN assets: safe to serve cache-first forever.
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // Per-item and non-fatal: caches.addAll is all-or-nothing, so one
      // unreachable asset used to abort the whole install.
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
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Same-origin app shell/assets: network-first, cache only as an offline
  // fallback.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(e.request)
          .then(cached => cached || (e.request.mode === 'navigate' ? caches.match('./') : undefined))
          .then(r => r || new Response(null, { status: 504, statusText: 'Offline (sw)' }))
      )
    );
    return;
  }

  // CDN assets (fonts, chart.js, supabase-js): cache-first.
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok || res.type === 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else is a live third-party API (Hyperliquid, CoinGecko,
  // raw.githubusercontent briefs, RSS proxies, …): never intercept, never
  // cache — the old cache-first handler froze these at whatever the cache
  // version last saw.
});
