/**
 * Hype APIU Proxy — Cloudflare Worker
 *
 * Server-side MCP client for apiu.ai's hosted macro-intelligence MCP server.
 * Keeps the APIU API key off the static frontend: the browser calls this
 * worker over plain JSON/GET, the worker speaks MCP (streamable HTTP) to
 * https://apiu.ai/mcp/ using a secret key, and returns a small combined
 * JSON payload of `daily_verdict` + `regime_state` for BTC.
 *
 * Deploy:
 *   1. Get a free APIU API key:
 *        curl -X POST https://apiu.ai/api/public/v1/keys
 *   2. cd cloudflare && npx wrangler deploy --config wrangler-apiu.toml
 *   3. npx wrangler secret put APIU_API_KEY --config wrangler-apiu.toml
 *   4. Copy the worker URL into Hype Settings → APIU Macro Proxy URL
 *      (intel.js uses it automatically when set as hype_apiu_proxy_url in localStorage)
 *
 * Usage: GET https://your-worker.workers.dev/?asset=BTC
 *
 * NOTE: this worker was written against APIU's documented MCP transport
 * spec (initialize → notifications/initialized → tools/call) but could not
 * be live-tested from the authoring environment (apiu.ai was unreachable
 * there). If the handshake or response parsing needs adjustment, check the
 * `details` field in error responses — it includes the raw upstream body.
 */

const APIU_MCP_URL = 'https://apiu.ai/mcp/';
const CACHE_TTL_SECONDS = 900; // 15 minutes — macro verdicts don't change fast

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url   = new URL(request.url);
    const asset = (url.searchParams.get('asset') || 'BTC').toUpperCase();

    const key = env.APIU_API_KEY;
    if (!key) {
      return json({ error: 'APIU_API_KEY not configured on worker' }, 503);
    }

    const cacheKey = new Request(`https://hype-apiu-cache.internal/${asset}`);
    const cache    = caches.default;
    const cached   = await cache.match(cacheKey);
    if (cached) return addCors(cached);

    try {
      const session = await mcpInitialize(key);

      const [verdict, regime] = await Promise.all([
        mcpCallTool(key, session, 'apiu.daily_verdict', { asset, format: 'brief + receipts' }),
        mcpCallTool(key, session, 'apiu.regime_state', { asset, output: 'regime + gates' }),
      ]);

      const response = json({
        asset,
        daily_verdict: verdict,
        regime_state: regime,
        fetched_at: new Date().toISOString(),
      });
      response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (e) {
      return json({ error: e.message || 'APIU proxy failed', details: e.details || null }, e.status || 502);
    }
  },
};

// ── MCP client (streamable HTTP transport) ────────────────────────────────

async function mcpInitialize(key) {
  const initRes = await fetch(APIU_MCP_URL, {
    method: 'POST',
    headers: mcpHeaders(key),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hype-dashboard', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    throw mcpErr(`MCP initialize failed: ${initRes.status}`, initRes.status, await safeText(initRes));
  }

  const sessionId = initRes.headers.get('Mcp-Session-Id') || initRes.headers.get('mcp-session-id');
  await readJsonRpc(initRes); // drain/parse the initialize result (unused)

  if (!sessionId) {
    throw mcpErr('MCP initialize did not return a session id', 502);
  }

  const ackRes = await fetch(APIU_MCP_URL, {
    method: 'POST',
    headers: mcpHeaders(key, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }),
  });

  if (!ackRes.ok) {
    throw mcpErr(`MCP initialized-ack failed: ${ackRes.status}`, ackRes.status, await safeText(ackRes));
  }

  return sessionId;
}

async function mcpCallTool(key, sessionId, toolName, args) {
  const res = await fetch(APIU_MCP_URL, {
    method: 'POST',
    headers: mcpHeaders(key, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    throw mcpErr(`${toolName} failed: ${res.status}`, res.status, await safeText(res));
  }

  const result = await readJsonRpc(res);
  if (result && result.error) {
    throw mcpErr(`${toolName} error: ${result.error.message || 'unknown'}`, 502, JSON.stringify(result.error));
  }

  // MCP tool results are typically { content: [{ type: 'text', text: '...' }] }
  const content = result?.result?.content;
  if (Array.isArray(content)) {
    const textPart = content.find((c) => c.type === 'text');
    if (textPart) {
      try {
        return JSON.parse(textPart.text);
      } catch {
        return textPart.text;
      }
    }
  }
  return result?.result ?? result;
}

function mcpHeaders(key, sessionId) {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'X-API-Key': key,
  };
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  return h;
}

// Streamable-HTTP MCP responses may come back as plain JSON or as an SSE
// stream of `data: {...}` events — handle both.
async function readJsonRpc(res) {
  const ct = res.headers.get('Content-Type') || '';
  const raw = await res.text();
  if (!raw) return null;

  if (ct.includes('text/event-stream')) {
    let last = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          try {
            last = JSON.parse(payload);
          } catch {
            // ignore unparseable SSE chunk
          }
        }
      }
    }
    return last;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return null;
  }
}

function mcpErr(message, status, details) {
  const e = new Error(message);
  e.status = status;
  e.details = details;
  return e;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function addCors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}
