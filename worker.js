// Cloudflare Worker — Hyperliquid API proxy with edge caching
// Deploy: https://dash.cloudflare.com → Workers → Create Worker → paste & save
// Then set the worker URL in the dashboard: Settings → Proxy URL

const HL_API = 'https://api.hyperliquid.xyz/info';

// Cache TTL per request type (seconds). 0 = no cache.
const TTL = {
  candleSnapshot:     300,   // 5 min — candles change slowly
  metaAndAssetCtxs:   120,   // 2 min — coin metadata + funding rates
  spotMeta:           600,   // 10 min — spot market metadata
  clearinghouseState:  30,   // 30 sec — positions + margin
  openOrders:          20,   // 20 sec — open orders
  userFunding:         60,   // 1 min — funding history
  userFills:           60,   // 1 min — fill history
  allMids:              5,   // 5 sec — live mid prices
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400, headers: CORS });
    }

    const reqType = body?.type || 'unknown';
    const ttl = TTL[reqType] ?? 0;

    // Use a fake GET URL as the cache key (caches.default only stores GET)
    const cacheKey = new Request(
      `https://hl-cache.invalid/${reqType}/${encodeURIComponent(JSON.stringify(body))}`,
      { method: 'GET' }
    );

    if (ttl > 0) {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const resp = new Response(cached.body, {
          status: cached.status,
          headers: { ...Object.fromEntries(cached.headers), ...CORS, 'X-Cache': 'HIT' },
        });
        return resp;
      }
    }

    let upstream;
    try {
      upstream = await fetch(HL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'upstream_error', message: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const upstreamText = await upstream.text();
    const responseHeaders = {
      'Content-Type': 'application/json',
      ...CORS,
      'X-Cache': 'MISS',
      'Cache-Control': ttl > 0 ? `public, max-age=${ttl}` : 'no-store',
    };

    const response = new Response(upstreamText, { status: 200, headers: responseHeaders });

    if (ttl > 0) {
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    }

    return response;
  },
};
