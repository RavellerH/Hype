// Shared helpers for the Daily Brief / Weekly Research GitHub Actions scripts.
// Ported from cloudflare/bot-worker.js so the two run identically; kept
// dependency-free (built-in fetch only) since the workflow does no npm install.

export const HL_URL = 'https://api.hyperliquid.xyz/info';

export async function hlPost(body) {
  const r = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json();
}

export async function getFundingRates() {
  const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
  const result = {};
  meta.universe.forEach((u, i) => {
    const ctx = ctxs[i];
    result[u.name] = {
      fundingRate: parseFloat(ctx.funding || 0),
      openInterest: parseFloat(ctx.openInterest || 0),
      markPx: parseFloat(ctx.markPx || 0),
    };
  });
  return result;
}

export async function getFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
  } catch {
    return { value: 50, label: 'Neutral' };
  }
}

function _hlpMatch(txt = '') {
  return /hyperliquid|hyperevm|hypercore|hyperbft|hyperunit|\bhip-\d+/i.test(txt) || /\$HYPE\b|\bHYPE\b/.test(txt);
}

export async function getHLNews(limit = 12) {
  const out = [];
  const cutSec = Math.floor(Date.now() / 1000) - 7 * 86400;
  let beforeTs = null;
  try {
    for (let page = 0; page < 3; page++) {
      const base = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=50';
      const r = await fetch(beforeTs ? `${base}&before_ts=${beforeTs}` : base);
      if (!r.ok) break;
      const arts = (await r.json())?.Data || [];
      if (!arts.length) break;
      for (const a of arts) {
        if (a.published_on < cutSec) return out.slice(0, limit);
        if (_hlpMatch(`${a.title} ${a.body || ''}`)) {
          const ageH = Math.floor((Date.now() / 1000 - a.published_on) / 3600);
          out.push({ title: a.title, age: ageH < 24 ? `${ageH}h` : `${Math.floor(ageH / 24)}d` });
        }
      }
      beforeTs = arts.at(-1)?.published_on;
      if (!beforeTs) break;
    }
  } catch {}
  return out.slice(0, limit);
}

export async function getHLStats() {
  const stats = {};
  try {
    const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
    const idx = meta.universe.findIndex(u => u.name === 'HYPE');
    const c = idx >= 0 ? ctxs[idx] : null;
    if (c) {
      stats.hypePx = parseFloat(c.markPx);
      stats.hype24h = c.prevDayPx ? (stats.hypePx / parseFloat(c.prevDayPx) - 1) * 100 : null;
      stats.hypeFunding = parseFloat(c.funding);
      stats.hypeOI = parseFloat(c.openInterest) * stats.hypePx;
    }
    stats.hlVolume24h = ctxs.reduce((s, x) => s + (parseFloat(x.dayNtlVlm) || 0), 0);
  } catch {}
  try {
    const chains = await fetch('https://api.llama.fi/v2/chains').then(r => (r.ok ? r.json() : []));
    stats.evmTvl = chains.filter(ch => /hyperliquid/i.test(ch.name || '')).reduce((s, ch) => s + (ch.tvl || 0), 0) || null;
  } catch {}
  return stats;
}

export const _f8 = r => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
export const _fmtM = n =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${(+n).toFixed(0)}`;

export async function tgSend(token, chatId, text) {
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Closes whatever a truncated response left open (unterminated string, dangling
// "key": with no value, trailing comma, unclosed braces/brackets) so JSON.parse
// can accept it.
function _repairJSON(text) {
  let inStr = false, escaped = false;
  const stack = [];
  for (const ch of text) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inStr) out += '"';
  out = out.replace(/"[^"\n]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

export function extractJSON(text) {
  // Models often wrap output in ```json fences and thinking models sometimes
  // hit the token cap mid-object, so tolerate both instead of requiring a
  // clean {...} block.
  let t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*(?:```|$)/i);
  if (fence && fence[1].includes('{')) t = fence[1];
  const start = t.indexOf('{');
  if (start === -1) throw new Error(`No JSON object in model response: ${String(text || '').slice(0, 120)}`);
  t = t.slice(start).trim();

  try { return JSON.parse(t); } catch {}
  const last = t.lastIndexOf('}');
  if (last !== -1) { try { return JSON.parse(t.slice(0, last + 1)); } catch {} }
  try { return JSON.parse(_repairJSON(t)); } catch {}
  // Drop trailing members one comma at a time until what's left parses.
  let cut = t;
  for (let i = cut.lastIndexOf(','); i !== -1; i = cut.lastIndexOf(',')) {
    cut = cut.slice(0, i);
    try { return JSON.parse(_repairJSON(cut)); } catch {}
  }
  throw new Error(`Unparseable JSON in model response: ${t.slice(0, 120)}`);
}

// Calls the Supabase llm-router Edge Function (supabase/functions/llm-router) —
// the same multi-provider gateway the dashboard's AI tabs use. Tier-2 tasks
// ('debrief', 'weekly_review') route through Gemini Pro → Claude Sonnet →
// OpenRouter → Groq 70B, in that order, for the highest-quality draft available.
export async function routedDraft(routerUrl, task, system, user, maxTokens = 1200) {
  const r = await fetch(routerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, system, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.text) throw new Error(`llm-router (${task}) failed: ${d.error || r.status} ${(d.details || []).join('; ')}`);
  console.log(`[llm-router] ${task} -> ${d.provider}/${d.model}`);
  return d.text.trim();
}

// Writes one markdown entry to disk and prepends it to a capped JSON index —
// both get committed straight into the repo by the workflow, so there's no
// database for Daily Brief / Weekly Research at all.
export async function writeEntry({ dir, file, md, indexPath, indexEntry, maxEntries = 120 }) {
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${file}`, md, 'utf8');
  let index = [];
  try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch {}
  index = [indexEntry, ...index.filter(e => e.file !== indexEntry.file)].slice(0, maxEntries);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

export async function readIndex(indexPath) {
  const fs = await import('node:fs/promises');
  try { return JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch { return []; }
}

export function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
