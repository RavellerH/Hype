/**
 * Hype RSS Proxy — Cloudflare Worker
 *
 * Proxies RSS feeds through Cloudflare's edge with CORS headers and 5-minute caching.
 * Replaces the fragile allorigins.win / rss2json.com third-party proxies.
 *
 * Deploy:
 *   1. npx wrangler deploy   (from this directory)
 *   2. Copy the worker URL into Hype Settings → RSS Proxy URL
 *      (news.js will use it automatically when set as hype_rss_proxy in localStorage)
 *
 * Usage: GET https://your-worker.workers.dev/?url=https://cointelegraph.com/rss
 */

const ALLOWED_DOMAINS = [
  'coindesk.com',
  'cointelegraph.com',
  'decrypt.co',
  'cryptonews.com',
  'theblock.co',
  'bitcoinmagazine.com',
  'messari.io',
  'min-api.cryptocompare.com',
  'reddit.com',
];

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url    = new URL(request.url);
    const target = url.searchParams.get('url');

    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const allowed = ALLOWED_DOMAINS.some(d => targetUrl.hostname === d || targetUrl.hostname.endsWith('.' + d));
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Domain not in allowlist' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Use Cloudflare Cache API for 5-minute edge caching
    const cacheKey = new Request(target);
    const cache    = caches.default;
    const cached   = await cache.match(cacheKey);
    if (cached) {
      return addCors(cached);
    }

    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HypeRSSBot/1.0; +https://github.com/ravellerh/hype)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const body        = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('Content-Type') || 'application/xml; charset=utf-8';

    const response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'X-Proxied-By': 'hype-rss-worker',
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

function addCors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}
