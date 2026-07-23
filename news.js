// ── Crypto News Monitor ───────────────────────────────────────────────────────
// Speed approach:
//   1. sessionStorage cache (5 min TTL) — instant on tab switch
//   2. Progressive render — each source updates the feed as it resolves
//   3. RSS: Promise.any([allorigins, rss2json]) — race both proxies, first wins
//   4. CC: max 2 pages (3-day window needs ~50-100 articles, 1 page usually enough)

const NEWS_HISTORY_DAYS = 3;
const NEWS_PER_PAGE     = 30;
const NEWS_CACHE_KEY    = 'hype_news_v2';
const NEWS_CACHE_TTL    = 5 * 60 * 1000;

const NEWS_SOURCES = {
  cryptocompare: { label: 'CryptoCompare', cls: 'src-cryptocompare' },
  messari:       { label: 'Messari',       cls: 'src-cryptocompare' },
  reddit:        { label: 'Reddit',        cls: 'src-reddit' },
  coindesk:      { label: 'CoinDesk',      cls: 'src-coindesk' },
  cointelegraph: { label: 'Cointelegraph', cls: 'src-cointelegraph' },
  decrypt:       { label: 'Decrypt',       cls: 'src-decrypt' },
  cryptonews:    { label: 'CryptoNews',    cls: 'src-cryptonews' },
  theblock:      { label: 'The Block',     cls: 'src-theblock' },
  bitcoinmag:    { label: 'Bitcoin Mag',   cls: 'src-coindesk' },
};

const RSS_FEEDS = [
  { id: 'coindesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt',       url: 'https://decrypt.co/feed' },
  { id: 'cryptonews',    url: 'https://cryptonews.com/news/feed/' },
  { id: 'theblock',      url: 'https://www.theblock.co/rss/all' },
  { id: 'bitcoinmag',    url: 'https://bitcoinmagazine.com/.rss/full/' },
];

const ALLORIGINS   = 'https://api.allorigins.win/get?url=';
const RSS2JSON     = 'https://api.rss2json.com/v1/api.json?count=20&rss_url=';
const CORSPROXY_IO = 'https://corsproxy.io/?url=';
const FNG_URL     = 'https://api.alternative.me/fng/?limit=7';
const CC_BASE     = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=50';
const MESSARI_URL = 'https://data.messari.io/api/v1/news?limit=50&fields=id,title,content,published_at,url,references/name';
const REDDIT_URL  = 'https://www.reddit.com/r/CryptoCurrency/new.json?limit=50&raw_json=1';

let _newsItems    = [];
let _newsFng      = [];
let _newsStatus   = {};
let _newsFilter   = 'all';
let _newsSearch   = '';
let _newsSent     = 'all'; // 'all' | 'BULL' | 'BEAR' | 'NEUTRAL'
let _newsPage     = 1;
let _newsLoaded   = false;
let _newsSeenSet  = new Set();
let _newsTimer    = null;
let _newsAnalyses = {};   // id → { sentiment, coins, reasoning, timeframe }
let _newsAiState  = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
const NEWS_AI_CACHE = 'hype_news_ai_v1';

// ── AI Analysis ───────────────────────────────────────────────────────────────

function _aiCacheLoad() {
  try {
    const raw = sessionStorage.getItem(NEWS_AI_CACHE);
    if (!raw) return {};
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > NEWS_CACHE_TTL * 2) return {};
    return data || {};
  } catch { return {}; }
}

function _aiCacheSave() {
  try {
    sessionStorage.setItem(NEWS_AI_CACHE, JSON.stringify({ ts: Date.now(), data: _newsAnalyses }));
  } catch {}
}

function _newsHasRouter() {
  return typeof _callLLM === 'function' && !!localStorage.getItem('hype_edge_fn_url');
}

async function _analyzeViaBot(botUrl, unseen) {
  const res = await fetch(`${botUrl}/analyze-news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: unseen.map(a => ({ id: a.id, title: a.title, excerpt: a.excerpt })) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { analyses = [], error } = await res.json();
  if (error) throw new Error(error);
  return analyses;
}

async function _analyzeViaRouter(unseen) {
  const list = unseen.map(a => `id=${a.id}\ntitle=${a.title}\nexcerpt=${a.excerpt || ''}`).join('\n---\n');
  const prompt = `Classify each crypto news article below for a trader. Reply with ONLY a JSON array, no prose, one object per article: {"id":"<the id verbatim>","sentiment":"BULL"|"BEAR"|"NEUTRAL","coins":["BTC",...max 3 tickers],"timeframe":"immediate"|"short-term"|"long-term","reasoning":"<one sentence>"}.\n\n${list}`;
  const text = await _callLLM('news', prompt, { maxTokens: 1200 });
  if (!text) throw new Error('router unavailable');
  const raw = text.replace(/```json|```/g, '').trim();
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('bad JSON from router');
  const arr = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error('bad JSON from router');
  return arr.filter(a => a && a.id && a.sentiment);
}

async function _analyzeTopArticles() {
  const botUrl = (localStorage.getItem('hype_bot_url') || '').replace(/\/$/, '');
  if (!botUrl && !_newsHasRouter()) return;

  // Load from cache first
  _newsAnalyses = { ..._aiCacheLoad() };

  // Find articles not yet analysed (top 10 most recent)
  const unseen = _newsItems.filter(a => !_newsAnalyses[a.id]).slice(0, 10);
  if (!unseen.length) return;

  _newsAiState = 'loading';
  _updateFeedEl();

  let analyses = null, lastErr = null;
  if (botUrl) {
    try { analyses = await _analyzeViaBot(botUrl, unseen); }
    catch (e) { lastErr = e; }
  }
  if (!analyses && _newsHasRouter()) {
    try { analyses = await _analyzeViaRouter(unseen); lastErr = null; }
    catch (e) { lastErr = lastErr || e; }
  }

  if (analyses) {
    analyses.forEach(a => { if (a.id) _newsAnalyses[a.id] = a; });
    _aiCacheSave();
    _newsAiState = 'done';
  } else {
    _newsAiState = 'error:' + (lastErr?.message || 'no AI backend reachable');
  }
  _buildPage();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function _cacheLoad() {
  try {
    const raw = sessionStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return null;
    const { ts, items, fng, status } = JSON.parse(raw);
    if (Date.now() - ts > NEWS_CACHE_TTL) return null;
    return { items, fng, status };
  } catch { return null; }
}

function _cacheSave() {
  try {
    sessionStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({
      ts: Date.now(), items: _newsItems, fng: _newsFng, status: _newsStatus,
    }));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _strip(s = '') {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'")
    .replace(/\s+/g,' ').trim();
}
function _ago(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s ago`; if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`; return `${Math.floor(d/86400)}d ago`;
}
function _cutoff() { return Date.now() - NEWS_HISTORY_DAYS * 86400 * 1000; }

function _merge(incoming) {
  let added = 0;
  for (const item of incoming) {
    const key = item.title.toLowerCase().slice(0, 60);
    if (!item.title || _newsSeenSet.has(key)) continue;
    _newsSeenSet.add(key);
    _newsItems.push(item);
    added++;
  }
  if (added) _newsItems.sort((a, b) => b.ts - a.ts);
  return added;
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function _fetchCC() {
  const cutSec = Math.floor(_cutoff() / 1000);
  const items  = [];
  try {
    for (let page = 0; page < 2; page++) {   // max 2 pages for 3-day window
      const url  = page === 0 ? CC_BASE : `${CC_BASE}&before_ts=${items[items.length-1]?.published_on}`;
      const r    = await fetch(url);
      if (!r.ok) break;
      const d    = await r.json();
      if (d.Response === 'Error' || !d.Data?.length) break;
      items.push(...d.Data);
      if (d.Data[d.Data.length-1].published_on < cutSec) break;
      if (d.Data.length < 50) break;
    }
    const result = items.filter(n => n.published_on >= cutSec).map(n => ({
      id: 'cc:' + n.id, source: 'cryptocompare', title: n.title || '',
      excerpt: _strip(n.body || '').slice(0, 220), url: n.url,
      ts: n.published_on * 1000,
      tags: (n.categories || '').split('|').map(t => t.trim()).filter(Boolean).slice(0, 5),
    }));
    _newsStatus.cryptocompare = { ok: true, count: result.length };
    return result;
  } catch (e) { _newsStatus.cryptocompare = { ok: false, err: e.message }; return []; }
}

async function _fetchMessari() {
  try {
    const r = await fetch(MESSARI_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    const result = (d.data || []).filter(n => new Date(n.published_at).getTime() >= _cutoff()).map(n => ({
      id: 'ms:' + n.id, source: 'messari', title: n.title || '',
      excerpt: _strip(n.content || '').slice(0, 220), url: n.url,
      ts: new Date(n.published_at).getTime(),
      tags: (n.references || []).map(r => r.name).filter(Boolean).slice(0, 5),
    }));
    _newsStatus.messari = { ok: true, count: result.length };
    return result;
  } catch (e) { _newsStatus.messari = { ok: false, err: e.message }; return []; }
}

async function _fetchReddit() {
  try {
    const r = await fetch(REDDIT_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    const result = (d?.data?.children || []).map(c => c.data)
      .filter(p => !p.stickied && p.created_utc * 1000 >= _cutoff())
      .map(p => ({
        id: 'rd:' + p.id, source: 'reddit', title: p.title,
        excerpt: p.selftext ? _strip(p.selftext).slice(0, 220) : '',
        url: p.url?.startsWith('http') ? p.url : 'https://reddit.com' + p.permalink,
        ts: p.created_utc * 1000, tags: [],
        redditMeta: `↑ ${(p.score||0).toLocaleString()} · ${p.num_comments||0} comments`,
      }));
    _newsStatus.reddit = { ok: true, count: result.length };
    return result;
  } catch (e) { _newsStatus.reddit = { ok: false, err: e.message }; return []; }
}

async function _parseXml(xml) {
  const doc   = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [...doc.querySelectorAll('item, entry')];
  return items.map(item => {
    const g = tag => { const el = item.querySelector(tag); return el ? (el.textContent || el.getAttribute('href') || '') : ''; };
    const ts = new Date(g('pubDate') || g('updated') || g('published') || '').getTime();
    return { title: _strip(g('title')), link: g('link') || g('guid'), ts, desc: _strip(g('description') || g('summary') || g('content')) };
  }).filter(i => i.title && !isNaN(i.ts) && i.ts >= _cutoff());
}

async function _fetchViaAllOrigins(url) {
  const r = await fetch(ALLORIGINS + encodeURIComponent(url));
  if (!r.ok) throw new Error(`ao:${r.status}`);
  const j = await r.json();
  if (!j.contents) throw new Error('ao:empty');
  return _parseXml(j.contents);
}

async function _fetchViaCorsproxyIo(url) {
  const r = await fetch(CORSPROXY_IO + encodeURIComponent(url));
  if (!r.ok) throw new Error(`cp:${r.status}`);
  return _parseXml(await r.text());
}

async function _fetchViaRss2json(url) {
  const r = await fetch(RSS2JSON + encodeURIComponent(url));
  if (!r.ok) throw new Error(`r2j:${r.status}`);
  const d = await r.json();
  if (d.status !== 'ok') throw new Error(`r2j:${d.status}`);
  return (d.items || [])
    .map(i => ({ title: _strip(i.title||''), link: i.link||'', ts: new Date(i.pubDate).getTime(), desc: _strip(i.description||i.content||'') }))
    .filter(i => i.title && !isNaN(i.ts) && i.ts >= _cutoff());
}

async function _fetchViaCustomWorker(url) {
  const base = (localStorage.getItem('hype_rss_proxy') || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('cw:unset');
  const r = await fetch(`${base}/?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`cw:${r.status}`);
  return _parseXml(await r.text());
}

async function _fetchRSS(feed) {
  try {
    // Race the proxies — whichever responds first wins. A user-deployed
    // Cloudflare Worker (Settings → RSS Proxy) joins the race when configured.
    const racers = [
      _fetchViaAllOrigins(feed.url),
      _fetchViaRss2json(feed.url),
      _fetchViaCorsproxyIo(feed.url),
    ];
    if (localStorage.getItem('hype_rss_proxy')) racers.unshift(_fetchViaCustomWorker(feed.url));
    const parsed = await Promise.any(racers);
    const result = parsed.map(p => ({
      id: feed.id + ':' + encodeURIComponent(p.link || p.title).slice(0, 80),
      source: feed.id, title: p.title, excerpt: p.desc.slice(0, 220),
      url: p.link || '#', ts: p.ts, tags: [],
    }));
    _newsStatus[feed.id] = { ok: true, count: result.length };
    return result;
  } catch { _newsStatus[feed.id] = { ok: false }; return []; }
}

async function _fetchFNG() {
  try {
    const r = await fetch(FNG_URL);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).map(e => ({ value: parseInt(e.value,10), label: e.value_classification, ts: parseInt(e.timestamp,10)*1000 }));
  } catch { return []; }
}

// ── Progressive load ──────────────────────────────────────────────────────────

async function _fetchAllProgressively() {
  _newsStatus = {}; _newsItems = []; _newsSeenSet = new Set();

  // FNG runs in background — update bar when it arrives
  _fetchFNG().then(fng => { _newsFng = fng; _updateFngEl(); });

  // Each source updates the feed as it resolves
  const sources = [
    _fetchCC(),
    _fetchMessari(),
    _fetchReddit(),
    ...RSS_FEEDS.map(_fetchRSS),
  ];

  for (const promise of sources) {
    promise.then(items => {
      if (_merge(items)) _updateFeedEl();
      _updateStatusEl();
    });
  }

  await Promise.allSettled(sources);
  _cacheSave();
}

// ── Render ────────────────────────────────────────────────────────────────────

function _fngClass(v) {
  if (v <= 25) return 'fng-extreme-fear'; if (v <= 45) return 'fng-fear';
  if (v <= 55) return 'fng-neutral';      if (v <= 75) return 'fng-greed';
  return 'fng-extreme-greed';
}

function _renderFNG() {
  if (!_newsFng.length) return '<div id="news-fng-bar"></div>';
  const labels = ['Today','Yst','2d','3d','4d','5d','6d'];
  const chips  = _newsFng.map((e,i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span class="news-fng-chip ${_fngClass(e.value)}${i===0?' today':''}" title="${e.label}">${e.value}</span>
      <span style="font-size:9px;color:var(--text-faint)">${labels[i]||''}</span>
    </div>${i < _newsFng.length-1 ? '<span class="news-fng-arrow">›</span>' : ''}`)
    .join('');
  return `<div class="news-fng-bar" id="news-fng-bar">
    <span class="news-fng-label">Fear &amp; Greed</span>${chips}
    <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${_newsFng[0].label}</span>
  </div>`;
}

function _renderStatus() {
  const entries = Object.entries(_newsStatus);
  if (!entries.length) return '<div id="news-status-bar"></div>';
  const ok     = entries.filter(([,v]) => v.ok).length;
  const failed = entries.filter(([,v]) => !v.ok).map(([k]) => NEWS_SOURCES[k]?.label || k);
  const failNote = failed.length ? ` · <span style="color:var(--red)">${failed.join(', ')} unavailable</span>` : '';
  return `<div id="news-status-bar" style="padding:5px 16px;font-size:11px;color:var(--text-faint);border-bottom:1px solid var(--border);background:var(--surface)">
    ${_newsItems.length} articles · ${ok}/${entries.length} sources · last ${NEWS_HISTORY_DAYS} days${failNote}
  </div>`;
}

function _renderFilters() {
  const counts = {};
  _newsItems.forEach(n => { counts[n.source] = (counts[n.source]||0)+1; });
  const srcs = ['all', ...Object.keys(NEWS_SOURCES).filter(s => (counts[s]||0) > 0)];
  const hasAI = Object.keys(_newsAnalyses).length > 0;
  const sentChips = hasAI ? `
    <div class="filter-sep"></div>
    ${['all','BULL','BEAR','NEUTRAL'].map(s => {
      const lbl = s === 'all' ? 'Any sentiment' : s === 'BULL' ? '▲ Bull' : s === 'BEAR' ? '▼ Bear' : '– Neutral';
      return `<button class="chip${_newsSent === s ? ' active' : ''}" onclick="newsSentFilter('${s}')">${lbl}</button>`;
    }).join('')}` : '';
  return `<div class="filter-bar" style="gap:4px;padding:8px 12px;flex-wrap:wrap" id="news-filter-bar">
    <input class="input" id="news-search" placeholder="Search articles…" value="${_newsSearch.replace(/"/g,'&quot;')}"
      oninput="newsSearch(this.value)" style="width:160px;min-height:28px;padding:4px 9px;font-size:12px;flex:none">
    ${srcs.map(s => {
      const active = _newsFilter === s ? ' active' : '';
      const lbl    = s === 'all' ? `All (${_newsItems.length})` : `${NEWS_SOURCES[s].label} (${counts[s]||0})`;
      return `<button class="btn btn-ghost btn-sm${active}" onclick="newsFilter('${s}')">${lbl}</button>`;
    }).join('')}
    ${sentChips}
    <div style="margin-left:auto">
      <button class="btn btn-ghost btn-sm" id="news-refresh-btn" onclick="newsRefresh()">↺ Refresh</button>
    </div>
  </div>`;
}

function _renderAnalysisBadge(a) {
  if (!a) return '';
  const sentColor = a.sentiment === 'BULL' ? 'var(--green)' : a.sentiment === 'BEAR' ? 'var(--red)' : 'var(--text-muted)';
  const sentBg    = a.sentiment === 'BULL' ? 'var(--green-bg)' : a.sentiment === 'BEAR' ? 'var(--red-bg)' : 'var(--surface2)';
  const tfColor   = a.timeframe === 'immediate' ? 'var(--red)' : a.timeframe === 'long-term' ? 'var(--text-muted)' : 'var(--yellow)';
  const coins = (a.coins || []).map(c =>
    `<span style="font-size:10px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--text-muted);font-family:var(--mono)">${c}</span>`
  ).join(' ');
  return `<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--border);padding-top:8px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:var(--radius-pill);background:${sentBg};color:${sentColor};letter-spacing:.06em">${a.sentiment}</span>
      <span style="font-size:10px;color:${tfColor};text-transform:uppercase;letter-spacing:.05em">${a.timeframe || ''}</span>
      ${coins}
    </div>
    ${a.reasoning ? `<div style="font-size:11px;color:var(--text-muted);line-height:1.4">${a.reasoning}</div>` : ''}
  </div>`;
}

function _renderCard(item) {
  const meta     = NEWS_SOURCES[item.source] || { label: item.source, cls: '' };
  const tags     = item.tags?.length ? `<div class="news-tags">${item.tags.map(t=>`<span class="news-tag">${t}</span>`).join('')}</div>` : '';
  const reddit   = item.redditMeta ? `<div class="news-reddit-meta">${item.redditMeta}</div>` : '';
  const analysis = _renderAnalysisBadge(_newsAnalyses[item.id]);
  return `<div class="news-card">
    <div class="news-card-header">
      <span class="news-source-badge ${meta.cls}">${meta.label}</span>
      <span class="news-time">${_ago(item.ts)}</span>
    </div>
    <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-title">${item.title}</a>
    ${item.excerpt ? `<div class="news-excerpt">${item.excerpt}</div>` : ''}
    ${tags}${reddit}${analysis}
  </div>`;
}

function _newsVisible() {
  let items = _newsFilter === 'all' ? _newsItems : _newsItems.filter(n => n.source === _newsFilter);
  if (_newsSearch) {
    const q = _newsSearch.toLowerCase();
    items = items.filter(n => n.title.toLowerCase().includes(q) || (n.excerpt || '').toLowerCase().includes(q));
  }
  if (_newsSent !== 'all') {
    items = items.filter(n => _newsAnalyses[n.id]?.sentiment === _newsSent);
  }
  return items;
}

function _renderFeed() {
  const visible = _newsVisible();
  const page    = visible.slice(0, _newsPage * NEWS_PER_PAGE);
  if (!page.length) {
    return (_newsSearch || _newsSent !== 'all')
      ? '<div class="news-empty">No articles match the current filters.</div>'
      : '<div class="news-empty">No articles yet — loading…</div>';
  }
  const more = visible.length > page.length
    ? `<button class="news-load-more" onclick="newsLoadMore()">Load ${Math.min(NEWS_PER_PAGE, visible.length - page.length)} more</button>`
    : '';
  return `<div class="news-feed" id="news-feed">${page.map(_renderCard).join('')}${more}</div>`;
}

// ── Incremental DOM updates (called by progressive loader) ────────────────────

function _updateFngEl() {
  const el = document.getElementById('news-fng-bar');
  if (el) el.outerHTML = _renderFNG();
}

function _updateStatusEl() {
  const el = document.getElementById('news-status-bar');
  if (el) el.outerHTML = _renderStatus();
  const fb = document.getElementById('news-filter-bar');
  if (fb) fb.outerHTML = _renderFilters();
}

function _updateFeedEl() {
  const el = document.getElementById('news-feed');
  const parent = document.getElementById('news-content');
  if (el) { el.outerHTML = _renderFeed(); return; }
  // Feed div doesn't exist yet (still in skeleton) — replace entire content
  if (parent && _newsItems.length) _buildPage();
}

function _renderAIBar() {
  const botUrl = localStorage.getItem('hype_bot_url') || '';
  const analyseCount = Object.keys(_newsAnalyses).length;
  let statusLine = '';
  if (!botUrl && !_newsHasRouter()) {
    statusLine = `<span style="color:var(--yellow)">⚠ Set the bot worker URL or Edge Function URL (Settings) to enable AI analysis</span>`;
  } else if (_newsAiState === 'loading') {
    statusLine = `<span style="color:var(--text-muted)">AI analysing headlines…</span>`;
  } else if (_newsAiState.startsWith('error')) {
    statusLine = `<span style="color:var(--red)" title="${_newsAiState}">AI error · check bot URL / Edge Function in Settings</span>`;
  } else if (analyseCount) {
    statusLine = `<span style="color:var(--green)">AI</span> <span style="color:var(--text-faint)">${analyseCount} articles analysed</span>`;
  } else {
    statusLine = `<span style="color:var(--text-faint)">AI ready · analysing on load</span>`;
  }
  return `<div style="padding:6px 16px;font-size:11px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
    <div>${statusLine}</div>
    <details style="font-size:11px">
      <summary style="cursor:pointer;color:var(--text-faint);list-style:none">⚙ Bot URL</summary>
      <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
        <input id="news-bot-url" type="text" value="${botUrl.replace(/"/g,'&quot;')}" placeholder="https://hype-bot.your-subdomain.workers.dev"
          style="flex:1;min-width:200px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:5px 8px;color:var(--text);font-size:11px;font-family:var(--mono);outline:none">
        <button onclick="_newsSaveBotUrl()" class="btn btn-ghost btn-sm">Save</button>
      </div>
    </details>
  </div>`;
}

function _buildPage() {
  const el = document.getElementById('news-content');
  if (!el) return;
  el.innerHTML = _renderFNG() + _renderStatus() + _renderAIBar() + _renderFilters() + _renderFeed();
}

// ── Public API ────────────────────────────────────────────────────────────────

async function loadNews() {
  const el = document.getElementById('news-content');
  if (!el) return;

  // Serve from cache immediately, then background-refresh if stale
  const cached = _cacheLoad();
  if (cached) {
    _newsItems  = cached.items;
    _newsFng    = cached.fng;
    _newsStatus = cached.status;
    _newsSeenSet = new Set(_newsItems.map(i => i.title.toLowerCase().slice(0,60)));
    _newsLoaded = true;
    _buildPage();
    return;
  }

  // No cache — show skeleton + load progressively
  el.innerHTML = `${_renderFNG()}<div id="news-status-bar" style="padding:5px 16px;font-size:11px;color:var(--text-faint);border-bottom:1px solid var(--border)">Fetching from ${RSS_FEEDS.length + 3} sources…</div><div id="news-feed"><div class="loading"><div class="spinner"></div> Loading…</div></div>`;

  await _fetchAllProgressively();
  _newsLoaded = true;
  _buildPage();
  _analyzeTopArticles();

  clearInterval(_newsTimer);
  _newsTimer = setInterval(async () => {
    // Don't hammer 9 sources in the background while another tab is open
    if (typeof currentPage !== 'undefined' && currentPage !== 'news') return;
    if (document.hidden) return;
    sessionStorage.removeItem(NEWS_CACHE_KEY);
    _newsPage = 1;
    await _fetchAllProgressively();
    _buildPage();
  }, 5 * 60 * 1000);
}

function newsFilter(src) { _newsFilter = src; _newsPage = 1; _buildPage(); }
function newsSentFilter(s) { _newsSent = s; _newsPage = 1; _buildPage(); }
function newsLoadMore()   { _newsPage++; _buildPage(); }

// Only the feed is re-rendered while typing so the search input keeps focus
function newsSearch(q) {
  _newsSearch = q;
  _newsPage = 1;
  const el = document.getElementById('news-feed');
  if (el) el.outerHTML = _renderFeed();
}

function _newsSaveBotUrl() {
  const val = (document.getElementById('news-bot-url')?.value || '').trim().replace(/\/$/, '');
  if (val) localStorage.setItem('hype_bot_url', val); else localStorage.removeItem('hype_bot_url');
  _newsAiState = 'idle';
  _newsAnalyses = {};
  sessionStorage.removeItem(NEWS_AI_CACHE);
  _buildPage();
  if (val) _analyzeTopArticles();
}

async function newsRefresh() {
  sessionStorage.removeItem(NEWS_CACHE_KEY);
  const btn = document.getElementById('news-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ …'; }
  _newsPage = 1;
  _newsLoaded = false;
  const el = document.getElementById('news-content');
  if (el) el.innerHTML = `<div id="news-feed"><div class="loading"><div class="spinner"></div> Refreshing…</div></div>`;
  await _fetchAllProgressively();
  _newsLoaded = true;
  _buildPage();
  _analyzeTopArticles();
}
