// ── Crypto News Monitor ───────────────────────────────────────────────────────
// Primary:    CryptoCompare (no key, paginated for 14d)
//             Messari news (no key)
//             Reddit r/CryptoCurrency /new.json
// RSS proxy:  allorigins.win (CORS-free) + rss2json fallback
// Widget:     Fear & Greed Index (alternative.me)

const NEWS_HISTORY_DAYS = 14;
const NEWS_PER_PAGE     = 30;

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

const ALLORIGINS = 'https://api.allorigins.win/get?url=';
const RSS2JSON   = 'https://api.rss2json.com/v1/api.json?count=20&rss_url=';
const FNG_URL    = 'https://api.alternative.me/fng/?limit=7';
const CC_BASE    = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=50';
const MESSARI_URL = 'https://data.messari.io/api/v1/news?limit=50&fields=id,title,content,published_at,url,references/name';
const REDDIT_URL = 'https://www.reddit.com/r/CryptoCurrency/new.json?limit=50&raw_json=1';

let _newsItems    = [];
let _newsFng      = [];
let _newsStatus   = {};   // { source: { ok: bool, count: int } }
let _newsFilter   = 'all';
let _newsLoaded   = false;
let _newsRefreshT = null;
let _newsPage     = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _stripTags(s = '') {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/\s+/g,' ').trim();
}

function _timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)    return `${d}s ago`;
  if (d < 3600)  return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function _fngClass(v) {
  if (v <= 25) return 'fng-extreme-fear';
  if (v <= 45) return 'fng-fear';
  if (v <= 55) return 'fng-neutral';
  if (v <= 75) return 'fng-greed';
  return 'fng-extreme-greed';
}

function _cutoff() {
  return Date.now() - NEWS_HISTORY_DAYS * 86400 * 1000;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function _fetchCCPage(beforeTs) {
  const url = beforeTs ? `${CC_BASE}&before_ts=${beforeTs}` : CC_BASE;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`CC ${r.status}`);
  const d = await r.json();
  if (d.Response === 'Error') throw new Error(d.Message || 'CC error');
  return d.Data || [];
}

async function _fetchCC() {
  const items = [];
  let beforeTs = 0;
  const cutoffSec = Math.floor(_cutoff() / 1000);
  try {
    for (let page = 0; page < 6; page++) {
      const batch = await _fetchCCPage(beforeTs || undefined);
      if (!batch.length) break;
      items.push(...batch);
      const oldest = batch[batch.length - 1]?.published_on || 0;
      if (oldest < cutoffSec) break;
      beforeTs = oldest;
      if (batch.length < 50) break;
    }
    const result = items
      .filter(n => n.published_on >= cutoffSec)
      .map(n => ({
        id:      'cc:' + n.id,
        source:  'cryptocompare',
        title:   n.title || '',
        excerpt: _stripTags(n.body || '').slice(0, 220),
        url:     n.url,
        ts:      n.published_on * 1000,
        tags:    (n.categories || '').split('|').map(t => t.trim()).filter(Boolean).slice(0, 5),
      }));
    _newsStatus.cryptocompare = { ok: true, count: result.length };
    return result;
  } catch (e) {
    _newsStatus.cryptocompare = { ok: false, err: e.message };
    return [];
  }
}

async function _fetchMessari() {
  try {
    const r = await fetch(MESSARI_URL, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Messari ${r.status}`);
    const d = await r.json();
    const items = (d.data || [])
      .map(n => ({
        id:      'ms:' + n.id,
        source:  'messari',
        title:   n.title || '',
        excerpt: _stripTags((n.content || '')).slice(0, 220),
        url:     n.url,
        ts:      new Date(n.published_at).getTime(),
        tags:    (n.references || []).map(r => r.name).filter(Boolean).slice(0, 5),
      }))
      .filter(n => n.ts >= _cutoff());
    _newsStatus.messari = { ok: true, count: items.length };
    return items;
  } catch (e) {
    _newsStatus.messari = { ok: false, err: e.message };
    return [];
  }
}

async function _fetchReddit() {
  try {
    const r = await fetch(REDDIT_URL, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Reddit ${r.status}`);
    const d = await r.json();
    const posts = (d?.data?.children || []).map(c => c.data);
    const items = posts
      .filter(p => !p.stickied && p.created_utc * 1000 >= _cutoff())
      .map(p => ({
        id:         'rd:' + p.id,
        source:     'reddit',
        title:      p.title,
        excerpt:    p.selftext ? _stripTags(p.selftext).slice(0, 220) : '',
        url:        p.url?.startsWith('http') ? p.url : 'https://reddit.com' + p.permalink,
        ts:         p.created_utc * 1000,
        tags:       [],
        redditMeta: `↑ ${(p.score||0).toLocaleString()} · ${p.num_comments||0} comments`,
      }));
    _newsStatus.reddit = { ok: true, count: items.length };
    return items;
  } catch (e) {
    _newsStatus.reddit = { ok: false, err: e.message };
    return [];
  }
}

async function _parseRSSXml(xmlStr) {
  try {
    const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    const items = [...doc.querySelectorAll('item, entry')];
    return items.map(item => {
      const g = tag => {
        const el = item.querySelector(tag);
        return el ? (el.textContent || el.getAttribute('href') || '') : '';
      };
      const title   = _stripTags(g('title'));
      const link    = g('link') || item.querySelector('link[rel="alternate"]')?.getAttribute('href') || g('guid');
      const pubDate = g('pubDate') || g('updated') || g('published') || g('dc\\:date') || g('date');
      const desc    = g('description') || g('summary') || g('content');
      const ts      = new Date(pubDate).getTime();
      return { title, link, ts, desc: _stripTags(desc) };
    }).filter(i => i.title && !isNaN(i.ts) && i.ts >= _cutoff());
  } catch { return []; }
}

async function _fetchRSSViaAllOrigins(feed) {
  const r = await fetch(ALLORIGINS + encodeURIComponent(feed.url));
  if (!r.ok) throw new Error(`allorigins ${r.status}`);
  const json = await r.json();
  if (!json.contents) throw new Error('empty allorigins response');
  return _parseRSSXml(json.contents);
}

async function _fetchRSSViaRss2json(feed) {
  const r = await fetch(RSS2JSON + encodeURIComponent(feed.url));
  if (!r.ok) throw new Error(`rss2json ${r.status}`);
  const d = await r.json();
  if (d.status !== 'ok') throw new Error(`rss2json status ${d.status}`);
  return (d.items || [])
    .map(item => ({
      title: _stripTags(item.title || ''),
      link:  item.link || '',
      ts:    new Date(item.pubDate).getTime(),
      desc:  _stripTags(item.description || item.content || ''),
    }))
    .filter(i => i.title && !isNaN(i.ts) && i.ts >= _cutoff());
}

async function _fetchRSS(feed) {
  let parsed = [];
  try {
    parsed = await _fetchRSSViaAllOrigins(feed);
  } catch {
    try { parsed = await _fetchRSSViaRss2json(feed); } catch { /* both failed */ }
  }
  const items = parsed.map(p => ({
    id:      feed.id + ':' + encodeURIComponent(p.link || p.title),
    source:  feed.id,
    title:   p.title,
    excerpt: p.desc.slice(0, 220),
    url:     p.link || '#',
    ts:      p.ts,
    tags:    [],
  }));
  _newsStatus[feed.id] = { ok: items.length > 0, count: items.length };
  return items;
}

async function _fetchFNG() {
  try {
    const r = await fetch(FNG_URL);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).map(e => ({
      value: parseInt(e.value, 10),
      label: e.value_classification,
      ts:    parseInt(e.timestamp, 10) * 1000,
    }));
  } catch { return []; }
}

// ── Aggregate all sources ─────────────────────────────────────────────────────

async function _fetchAllNews() {
  _newsStatus = {};
  const [cc, messari, reddit, fng, ...rssResults] = await Promise.all([
    _fetchCC(),
    _fetchMessari(),
    _fetchReddit(),
    _fetchFNG(),
    ...RSS_FEEDS.map(_fetchRSS),
  ]);

  _newsFng = fng;

  const all = [...cc, ...messari, ...reddit, ...rssResults.flat()];
  const seen = new Set();
  _newsItems = all
    .filter(item => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (!item.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.ts - a.ts);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderFNG() {
  if (!_newsFng.length) return '';
  const labels = ['Today', 'Yst', '2d', '3d', '4d', '5d', '6d'];
  const chips = _newsFng.map((e, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span class="news-fng-chip ${_fngClass(e.value)}${i===0?' today':''}" title="${e.label}">${e.value}</span>
      <span style="font-size:9px;color:var(--text-faint)">${labels[i]||''}</span>
    </div>${i < _newsFng.length-1 ? '<span class="news-fng-arrow">›</span>' : ''}`
  ).join('');
  return `
  <div class="news-fng-bar">
    <span class="news-fng-label">Fear &amp; Greed</span>
    ${chips}
    <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${_newsFng[0].label}</span>
  </div>`;
}

function _renderStatus() {
  const entries = Object.entries(_newsStatus);
  if (!entries.length) return '';
  const total = _newsItems.length;
  const ok = entries.filter(([,v]) => v.ok).length;
  const failed = entries.filter(([,v]) => !v.ok).map(([k]) => NEWS_SOURCES[k]?.label || k);
  const failNote = failed.length ? ` · <span style="color:var(--red)">${failed.join(', ')} unavailable</span>` : '';
  return `<div style="padding:6px 16px;font-size:11px;color:var(--text-faint);border-bottom:1px solid var(--border);background:var(--surface)">
    ${total} articles · ${ok}/${entries.length} sources · last ${NEWS_HISTORY_DAYS} days${failNote}
  </div>`;
}

function _renderFilters() {
  const counts = {};
  _newsItems.forEach(n => { counts[n.source] = (counts[n.source]||0) + 1; });
  const srcs = ['all', ...Object.keys(NEWS_SOURCES).filter(s => (counts[s]||0) > 0)];
  return `
  <div class="filter-bar" style="gap:4px;padding:8px 12px;flex-wrap:wrap">
    ${srcs.map(s => {
      const active = _newsFilter === s ? ' active' : '';
      const lbl = s === 'all' ? `All (${_newsItems.length})` : `${NEWS_SOURCES[s].label} (${counts[s]||0})`;
      return `<button class="btn btn-ghost btn-sm${active}" onclick="newsFilter('${s}')">${lbl}</button>`;
    }).join('')}
    <div style="margin-left:auto">
      <button class="btn btn-ghost btn-sm" id="news-refresh-btn" onclick="newsRefresh()">↺ Refresh</button>
    </div>
  </div>`;
}

function _renderCard(item) {
  const meta = NEWS_SOURCES[item.source] || { label: item.source, cls: '' };
  const tags = item.tags?.length
    ? `<div class="news-tags">${item.tags.map(t=>`<span class="news-tag">${t}</span>`).join('')}</div>`
    : '';
  const reddit = item.redditMeta ? `<div class="news-reddit-meta">${item.redditMeta}</div>` : '';
  return `
  <div class="news-card">
    <div class="news-card-header">
      <span class="news-source-badge ${meta.cls}">${meta.label}</span>
      <span class="news-time">${_timeAgo(item.ts)}</span>
    </div>
    <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-title">${item.title}</a>
    ${item.excerpt ? `<div class="news-excerpt">${item.excerpt}</div>` : ''}
    ${tags}${reddit}
  </div>`;
}

function _renderFeed() {
  const visible = _newsFilter === 'all'
    ? _newsItems
    : _newsItems.filter(n => n.source === _newsFilter);
  const page = visible.slice(0, _newsPage * NEWS_PER_PAGE);
  if (!page.length) return `<div class="news-empty">No articles found. Try refreshing or check your connection.</div>`;
  const more = visible.length > page.length
    ? `<button class="news-load-more" onclick="newsLoadMore()">Load ${Math.min(NEWS_PER_PAGE, visible.length-page.length)} more</button>`
    : '';
  return `<div class="news-feed">${page.map(_renderCard).join('')}${more}</div>`;
}

function _renderNewsPage(loading = false) {
  const el = document.getElementById('news-content');
  if (!el) return;
  if (loading) {
    el.innerHTML = `${_renderFNG()}<div class="loading"><div class="spinner"></div> Fetching from ${RSS_FEEDS.length + 3} sources (last ${NEWS_HISTORY_DAYS} days)…</div>`;
    return;
  }
  el.innerHTML = `${_renderFNG()}${_renderStatus()}${_renderFilters()}${_renderFeed()}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function loadNews() {
  const el = document.getElementById('news-content');
  if (!el) return;
  if (_newsLoaded && _newsItems.length) { _renderNewsPage(false); return; }
  _renderNewsPage(true);
  try {
    await _fetchAllNews();
  } catch (e) {
    console.error('news fetch error:', e);
  }
  _newsLoaded = true;
  _renderNewsPage(false);
  clearInterval(_newsRefreshT);
  _newsRefreshT = setInterval(async () => {
    _newsLoaded = false; _newsPage = 1;
    await _fetchAllNews();
    _newsLoaded = true;
    _renderNewsPage(false);
  }, 5 * 60 * 1000);
}

function newsFilter(src) { _newsFilter = src; _newsPage = 1; _renderNewsPage(false); }
function newsLoadMore()   { _newsPage++; _renderNewsPage(false); }

async function newsRefresh() {
  const btn = document.getElementById('news-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ …'; }
  _newsLoaded = false; _newsPage = 1;
  _renderNewsPage(true);
  await _fetchAllNews();
  _newsLoaded = true;
  _renderNewsPage(false);
}
