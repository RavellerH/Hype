const CACHE = 'hype-v11';
const STATIC = [
  './',
  './index.html',
  './styles.css',
  './llm.js',
  './app.js',
  './ai.js',
  './signals.js',
  './news.js',
  './ta-signal.js',
  './position-meta.js',
  './intel.js',
  './indicators.js',
  './analytics.js',
  './logger.js',
  './nansen.js',
  './mvrv-ai.js',
  './kb.js',
  './journal.js',
  './autojournal.js',
  './fundamentals.js',
  './arb.js',
  './defillama.js',
  './trend.js',
  './onchain.js',
  './heatmap.js',
  './docs.html',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
];
const STATIC_URLS = new Set(STATIC.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
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
  if (!STATIC_URLS.has(e.request.url)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
