// ── HL Pulse — Hyperliquid ecosystem news, stats & content studio ─────────────
// Sources (all keyless):
//   News:  CryptoCompare (keyword-filtered) + r/hyperliquid + News-tab cache
//   Stats: Hyperliquid metaAndAssetCtxs (HYPE px/funding/OI, total perp volume)
//          DeFiLlama chains + protocols (HyperEVM TVL, ecosystem protocols)
// Drafts: llm.js router (if hype_edge_fn_url set) → bot worker /draft-hl (Workers AI)

const HLP_CACHE_KEY    = 'hype_hlpulse_v1';
const HLP_CACHE_TTL    = 5 * 60 * 1000;
const HLP_HISTORY_DAYS = 7;
const HLP_CC_URL       = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=50';
const HLP_REDDIT_URL   = 'https://www.reddit.com/r/hyperliquid/new.json?limit=30&raw_json=1';

// Ecosystem terms (any case) — or HYPE/$HYPE as an uppercase ticker so plain
// english "hype" headlines don't slip through.
const HLP_RX_ECO  = /hyperliquid|hyperevm|hypercore|hyperbft|hyperunit|\bhip-\d+|\bpurr\b|\bhlp vault/i;
const HLP_RX_TICK = /\$HYPE\b|\bHYPE\b/;
function _hlpMatch(txt = '') { return HLP_RX_ECO.test(txt) || HLP_RX_TICK.test(txt); }

let _hlpItems = [];
let _hlpStats = null;
let _hlpTs    = 0;
let _hlpBusy  = false;

// ── Cache ─────────────────────────────────────────────────────────────────────

function _hlpCacheLoad() {
  try {
    const raw = sessionStorage.getItem(HLP_CACHE_KEY);
    if (!raw) return false;
    const { ts, items, stats } = JSON.parse(raw);
    if (Date.now() - ts > HLP_CACHE_TTL) return false;
    _hlpItems = items || []; _hlpStats = stats || null; _hlpTs = ts;
    return true;
  } catch { return false; }
}

function _hlpCacheSave() {
  try {
    sessionStorage.setItem(HLP_CACHE_KEY, JSON.stringify({ ts: _hlpTs, items: _hlpItems, stats: _hlpStats }));
  } catch {}
}

// ── News fetchers ─────────────────────────────────────────────────────────────

async function _hlpFetchCC() {
  const cutSec = Math.floor((Date.now() - HLP_HISTORY_DAYS * 86400000) / 1000);
  const items = [];
  let beforeTs = null;
  for (let page = 0; page < 3; page++) {
    const r = await fetch(beforeTs ? `${HLP_CC_URL}&before_ts=${beforeTs}` : HLP_CC_URL);
    if (!r.ok) break;
    const arts = (await r.json())?.Data || [];
    if (!arts.length) break;
    for (const a of arts) {
      if (a.published_on < cutSec) return items;
      if (!_hlpMatch(`${a.title} ${a.body || ''}`)) continue;
      items.push({
        id: `hlp-cc-${a.id}`, source: 'CryptoCompare', title: _strip(a.title),
        excerpt: _strip(a.body || '').slice(0, 220), url: a.url, ts: a.published_on * 1000,
      });
    }
    beforeTs = arts.at(-1)?.published_on;
    if (!beforeTs) break;
  }
  return items;
}

async function _hlpFetchReddit() {
  const r = await fetch(HLP_REDDIT_URL);
  if (!r.ok) throw new Error(`reddit ${r.status}`);
  const posts = (await r.json())?.data?.children || [];
  const cutoff = Date.now() - HLP_HISTORY_DAYS * 86400000;
  return posts
    .map(p => p.data)
    .filter(d => d && d.created_utc * 1000 > cutoff && !d.stickied)
    .map(d => ({
      id: `hlp-rd-${d.id}`, source: 'r/hyperliquid', title: _strip(d.title),
      excerpt: _strip(d.selftext || '').slice(0, 220),
      url: `https://www.reddit.com${d.permalink}`, ts: d.created_utc * 1000,
      redditMeta: `▲ ${d.ups} · ${d.num_comments} comments`,
    }));
}

// Reuse whatever the News tab already pulled (9 sources) — filter for HL items
function _hlpFromNewsCache() {
  try {
    const raw = sessionStorage.getItem('hype_news_v2');
    if (!raw) return [];
    const items = JSON.parse(raw)?.items || [];
    return items
      .filter(n => _hlpMatch(`${n.title} ${n.excerpt || ''}`))
      .map(n => ({ ...n, id: `hlp-news-${n.id || n.title.slice(0, 40)}`, source: n.source || 'news' }));
  } catch { return []; }
}

// ── Stats fetchers ────────────────────────────────────────────────────────────

async function _hlpFetchStats() {
  const stats = {};

  try {
    const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
    const idx = meta.universe.findIndex(u => u.name === 'HYPE');
    const c = idx >= 0 ? ctxs[idx] : null;
    if (c) {
      stats.hypePx      = parseFloat(c.markPx);
      stats.hype24h     = c.prevDayPx ? (stats.hypePx / parseFloat(c.prevDayPx) - 1) * 100 : null;
      stats.hypeFunding = parseFloat(c.funding);
      stats.hypeOI      = parseFloat(c.openInterest) * stats.hypePx;
    }
    stats.hlVolume24h = ctxs.reduce((s, x) => s + (parseFloat(x.dayNtlVlm) || 0), 0);
  } catch (e) { console.warn('[HLP] HL stats:', e.message); }

  try {
    const chains = await fetch('https://api.llama.fi/v2/chains').then(r => r.ok ? r.json() : []);
    stats.evmTvl = chains.filter(ch => /hyperliquid/i.test(ch.name || '')).reduce((s, ch) => s + (ch.tvl || 0), 0) || null;
  } catch (e) { console.warn('[HLP] llama chains:', e.message); }

  try {
    // Reuse the DeFi tab's protocol list when available (it's a heavy payload)
    const protos = (typeof _dflData !== 'undefined' && _dflData?.protocols?.length)
      ? _dflData.protocols
      : await fetch('https://api.llama.fi/protocols').then(r => r.ok ? r.json() : []);
    stats.ecosystem = protos
      .filter(p => (p.chains || []).some(ch => /hyperliquid/i.test(ch)) && p.tvl > 0)
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 12)
      .map(p => ({ name: p.name, category: p.category, tvl: p.tvl, d1: p.change_1d, d7: p.change_7d }));
  } catch (e) { console.warn('[HLP] llama protocols:', e.message); }

  return stats;
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadHLPulse() {
  const el = document.getElementById('hlpulse-content');
  if (!el) return;
  if (_hlpItems.length && Date.now() - _hlpTs < HLP_CACHE_TTL) { _hlpRender(); return; }
  if (_hlpCacheLoad()) { _hlpRender(); return; }

  el.innerHTML = '<div class="loading"><div class="spinner"></div> Scanning the Hyperliquid ecosystem…</div>';

  const [cc, rd, stats] = await Promise.allSettled([_hlpFetchCC(), _hlpFetchReddit(), _hlpFetchStats()]);

  const seen = new Set();
  _hlpItems = [
    ...(cc.status === 'fulfilled' ? cc.value : []),
    ...(rd.status === 'fulfilled' ? rd.value : []),
    ..._hlpFromNewsCache(),
  ].filter(n => {
    const key = n.title.toLowerCase().slice(0, 60);
    if (!n.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.ts - a.ts);

  _hlpStats = stats.status === 'fulfilled' ? stats.value : {};
  _hlpTs = Date.now();
  _hlpCacheSave();
  _hlpRender();
}

function hlpRefresh() { _hlpTs = 0; sessionStorage.removeItem(HLP_CACHE_KEY); loadHLPulse(); }

// ── Render ────────────────────────────────────────────────────────────────────

function _hlpFmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(2)}`;
}

function _hlpStatCell(label, value, sub = '') {
  return `<div class="stat-card">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">${label}</div>
    <div style="font-size:18px;font-weight:700;margin-top:4px">${value}</div>
    ${sub ? `<div style="font-size:11px;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}

function _hlpRender() {
  const el = document.getElementById('hlpulse-content');
  if (!el) return;
  const s = _hlpStats || {};

  const chg = s.hype24h == null ? '' :
    `<span class="${s.hype24h >= 0 ? 'pos' : 'neg'}">${s.hype24h >= 0 ? '+' : ''}${s.hype24h.toFixed(2)}% 24h</span>`;
  const fundAnnual = s.hypeFunding != null ? `${(s.hypeFunding * 3 * 365 * 100).toFixed(1)}% APR` : '';

  const statsRow = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
    ${_hlpStatCell('HYPE', s.hypePx != null ? `$${s.hypePx.toFixed(2)}` : '—', chg)}
    ${_hlpStatCell('HYPE Funding 8h', s.hypeFunding != null ? `${(s.hypeFunding * 100).toFixed(4)}%` : '—', fundAnnual)}
    ${_hlpStatCell('HYPE OI', _hlpFmtUsd(s.hypeOI))}
    ${_hlpStatCell('HL Perp Vol 24h', _hlpFmtUsd(s.hlVolume24h))}
    ${_hlpStatCell('HyperEVM TVL', _hlpFmtUsd(s.evmTvl), 'DeFiLlama')}
    ${_hlpStatCell('Eco Protocols', s.ecosystem?.length ? `${s.ecosystem.length}+` : '—', 'tracked by TVL')}
  </div>`;

  const studio = `<div class="card">
    <div class="card-title">Content Studio — draft a post from today's HL pulse</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="hlp-style" class="input" style="width:auto;padding:6px 10px">
        <option value="thread">X thread (4–6 tweets)</option>
        <option value="post">Single X post</option>
        <option value="digest">Daily digest</option>
      </select>
      <button class="btn btn-primary btn-sm" id="hlp-gen-btn" onclick="hlpGenerate()">⚡ Generate draft</button>
      <button class="btn btn-ghost btn-sm" id="hlp-copy-btn" onclick="hlpCopyDraft()" style="display:none">Copy</button>
      <span id="hlp-gen-status" style="font-size:11px;color:var(--text-faint)"></span>
    </div>
    <textarea id="hlp-draft" spellcheck="false" style="display:none;width:100%;min-height:220px;margin-top:10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5;resize:vertical"></textarea>
  </div>`;

  const feed = _hlpItems.length
    ? _hlpItems.slice(0, 40).map(item => `<div class="news-card">
        <div class="news-card-header">
          <span class="news-source-badge src-cryptocompare">${item.source}</span>
          <span class="news-time">${_ago(item.ts)}</span>
        </div>
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-title">${item.title}</a>
        ${item.excerpt ? `<div class="news-excerpt">${item.excerpt}</div>` : ''}
        ${item.redditMeta ? `<div class="news-reddit-meta">${item.redditMeta}</div>` : ''}
      </div>`).join('')
    : '<div class="news-empty">No Hyperliquid headlines in the last 7 days — sources may be rate-limited. Try ↺.</div>';

  const eco = s.ecosystem?.length ? `<div class="card">
    <div class="card-title">HyperEVM Ecosystem — top protocols by TVL</div>
    <div class="table-wrap"><table>
      <thead><tr><th style="text-align:left">Protocol</th><th style="text-align:left">Category</th><th style="text-align:right">TVL</th><th style="text-align:right">24h</th><th style="text-align:right">7d</th></tr></thead>
      <tbody>${s.ecosystem.map(p => `<tr>
        <td>${p.name}</td><td style="color:var(--text-muted)">${p.category || '—'}</td>
        <td style="text-align:right">${_hlpFmtUsd(p.tvl)}</td>
        <td style="text-align:right" class="${(p.d1 ?? 0) >= 0 ? 'pos' : 'neg'}">${p.d1 != null ? `${p.d1 >= 0 ? '+' : ''}${p.d1.toFixed(1)}%` : '—'}</td>
        <td style="text-align:right" class="${(p.d7 ?? 0) >= 0 ? 'pos' : 'neg'}">${p.d7 != null ? `${p.d7 >= 0 ? '+' : ''}${p.d7.toFixed(1)}%` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>` : '';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span class="section-title">🛰️ HL Pulse — Hyperliquid ecosystem</span>
      <span style="font-size:11px;color:var(--text-faint)">updated ${new Date(_hlpTs).toLocaleTimeString()} · <a href="javascript:hlpRefresh()" style="color:var(--accent)">↺ refresh</a></span>
    </div>
    ${statsRow}
    ${studio}
    <div class="card">
      <div class="card-title">Hyperliquid headlines — last ${HLP_HISTORY_DAYS} days (${_hlpItems.length})</div>
      ${feed}
    </div>
    ${eco}`;
}

// ── Content generator ─────────────────────────────────────────────────────────

function _hlpBuildContext() {
  const s = _hlpStats || {};
  const lines = ['HYPERLIQUID ECOSYSTEM SNAPSHOT — ' + new Date().toUTCString().slice(0, 16)];
  if (s.hypePx != null)      lines.push(`HYPE price: $${s.hypePx.toFixed(2)}${s.hype24h != null ? ` (${s.hype24h >= 0 ? '+' : ''}${s.hype24h.toFixed(2)}% 24h)` : ''}`);
  if (s.hypeFunding != null) lines.push(`HYPE funding (8h): ${(s.hypeFunding * 100).toFixed(4)}%`);
  if (s.hypeOI)              lines.push(`HYPE open interest: ${_hlpFmtUsd(s.hypeOI)}`);
  if (s.hlVolume24h)         lines.push(`Hyperliquid total perp volume 24h: ${_hlpFmtUsd(s.hlVolume24h)}`);
  if (s.evmTvl)              lines.push(`HyperEVM TVL (DeFiLlama): ${_hlpFmtUsd(s.evmTvl)}`);
  if (s.ecosystem?.length)   lines.push(`Top HyperEVM protocols: ${s.ecosystem.slice(0, 5).map(p => `${p.name} ${_hlpFmtUsd(p.tvl)}`).join(', ')}`);
  if (_hlpItems.length) {
    lines.push('', 'RECENT HEADLINES:');
    _hlpItems.slice(0, 12).forEach(n => lines.push(`- [${_ago(n.ts)}] ${n.title}`));
  }
  return lines.join('\n');
}

const HLP_STYLE_PROMPTS = {
  thread: 'Write an X (Twitter) thread of 4-6 tweets about what is happening in the Hyperliquid ecosystem right now. Start with a strong hook tweet, then one idea per tweet, number them "1/", "2/" etc. Each tweet under 270 characters. Plain text, at most one hashtag total.',
  post:   'Write ONE X (Twitter) post (under 270 characters) summarizing the most interesting thing happening in the Hyperliquid ecosystem right now. Strong hook, no hashtag spam.',
  digest: 'Write a concise daily Hyperliquid ecosystem digest: a one-line headline, then 4-6 short bullet points covering price/funding/TVL and the most important headlines, then a one-line takeaway. Under 900 characters total.',
};

const HLP_SYSTEM = 'You are a sharp crypto content writer focused on the Hyperliquid ecosystem (HYPE, HyperCore, HyperEVM). Write in English. Use ONLY facts and numbers from the provided context — never invent data, prices, or events. No financial advice, no "DYOR" boilerplate, no emojis unless one fits naturally.';

async function hlpGenerate() {
  if (_hlpBusy) return;
  const style  = document.getElementById('hlp-style')?.value || 'digest';
  const status = document.getElementById('hlp-gen-status');
  const btn    = document.getElementById('hlp-gen-btn');
  const ta     = document.getElementById('hlp-draft');
  _hlpBusy = true;
  btn.disabled = true;
  status.textContent = 'drafting…';

  const prompt = `${HLP_STYLE_PROMPTS[style]}\n\nCONTEXT:\n${_hlpBuildContext()}`;
  let text = null, via = '';

  // 1) Supabase llm-router (Tier 2 chain) if configured
  if (typeof _callLLM === 'function') {
    text = await _callLLM('synthesis', prompt, { system: HLP_SYSTEM, maxTokens: 1024 });
    if (text) via = 'llm-router';
  }

  // 2) Bot worker Workers AI fallback
  if (!text) {
    const botUrl = (localStorage.getItem('hype_bot_url') || '').replace(/\/$/, '');
    if (botUrl) {
      try {
        const r = await fetch(`${botUrl}/draft-hl`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style, context: _hlpBuildContext() }),
        });
        const d = await r.json();
        if (r.ok && d.text) { text = d.text; via = 'workers-ai'; }
        else status.textContent = `bot worker: ${d.error || r.status}`;
      } catch (e) { status.textContent = `bot worker: ${e.message}`; }
    }
  }

  if (text) {
    ta.value = text.trim();
    ta.style.display = 'block';
    document.getElementById('hlp-copy-btn').style.display = '';
    status.textContent = `drafted via ${via} — edit before posting`;
  } else if (!status.textContent || status.textContent === 'drafting…') {
    status.textContent = 'no AI configured — set hype_edge_fn_url or hype_bot_url in Settings';
  }
  btn.disabled = false;
  _hlpBusy = false;
}

async function hlpCopyDraft() {
  const ta  = document.getElementById('hlp-draft');
  const btn = document.getElementById('hlp-copy-btn');
  try {
    await navigator.clipboard.writeText(ta.value);
    btn.textContent = 'Copied ✓';
  } catch {
    ta.select();
    document.execCommand('copy');
    btn.textContent = 'Copied ✓';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}
