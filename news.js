// ── Crypto News Monitor ───────────────────────────────────────────────────────
// Sources: CryptoCompare (no key) · Reddit r/CryptoCurrency · RSS via rss2json
// Fear & Greed Index: alternative.me/fng

const NEWS_SOURCES = {
  cryptocompare: { label: 'CryptoCompare', cls: 'src-cryptocompare' },
  reddit:        { label: 'Reddit',        cls: 'src-reddit' },
  coindesk:      { label: 'CoinDesk',      cls: 'src-coindesk' },
  cointelegraph: { label: 'Cointelegraph', cls: 'src-cointelegraph' },
  decrypt:       { label: 'Decrypt',       cls: 'src-decrypt' },
  cryptonews:    { label: 'CryptoNews',    cls: 'src-cryptonews' },
  theblock:      { label: 'The Block',     cls: 'src-theblock' },
};

const RSS_FEEDS = [
  { id: 'coindesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt',       url: 'https://decrypt.co/feed' },
  { id: 'cryptonews',    url: 'https://cryptonews.com/news/feed/' },
  { id: 'theblock',      url: 'https://www.theblock.co/rss/all' },
];

const RSS2JSON = 'https://api.rss2json.com/v1/api.json?count=12&rss_url=';
const FNG_URL  = 'https://api.alternative.me/fng/?limit=7';
const CC_URL   = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular';
const REDDIT_URL = 'https://www.reddit.com/r/CryptoCurrency/hot.json?limit=20&raw_json=1';

let _newsItems    = [];
let _newsFng      = [];
let _newsFilter   = 'all';
let _newsLoaded   = false;
let _newsRefreshT = null;
let _newsPage     = 1;
const NEWS_PER_PAGE = 30;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function _fetchCC() {
  try {
    const r = await fetch(CC_URL);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.Data || []).map(n => ({
      id:      'cc:' + n.id,
      source:  'cryptocompare',
      title:   n.title,
      excerpt: _stripHtmlTags(n.body || '').slice(0, 200),
      url:     n.url,
      ts:      n.published_on * 1000,
      tags:    (n.categories || '').split('|').map(t => t.trim()).filter(Boolean).slice(0, 5),
    }));
  } catch { return []; }
}

async function _fetchReddit() {
  try {
    const r = await fetch(REDDIT_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const d = await r.json();
    const posts = (d?.data?.children || []).map(c => c.data);
    return posts
      .filter(p => !p.stickied)
      .map(p => ({
        id:      'rd:' + p.id,
        source:  'reddit',
        title:   p.title,
        excerpt: p.selftext ? _stripHtmlTags(p.selftext).slice(0, 200) : `↑ ${p.score.toLocaleString()} pts · ${p.num_comments} comments`,
        url:     p.url.startsWith('http') ? p.url : 'https://reddit.com' + p.permalink,
        ts:      p.created_utc * 1000,
        tags:    [],
        redditMeta: `↑ ${p.score.toLocaleString()} · ${p.num_comments} comments`,
      }));
  } catch { return []; }
}

async function _fetchRSS(feed) {
  try {
    const r = await fetch(RSS2JSON + encodeURIComponent(feed.url));
    if (!r.ok) return [];
    const d = await r.json();
    if (d.status !== 'ok') return [];
    return (d.items || []).map(item => ({
      id:      feed.id + ':' + encodeURIComponent(item.link || item.title),
      source:  feed.id,
      title:   item.title || '',
      excerpt: _stripHtmlTags(item.description || item.content || '').slice(0, 200),
      url:     item.link || '#',
      ts:      new Date(item.pubDate).getTime() || 0,
      tags:    (item.categories || []).slice(0, 5),
    }));
  } catch { return []; }
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

function _stripHtmlTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function _timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function _fngClass(v) {
  if (v <= 25)  return 'fng-extreme-fear';
  if (v <= 45)  return 'fng-fear';
  if (v <= 55)  return 'fng-neutral';
  if (v <= 75)  return 'fng-greed';
  return 'fng-extreme-greed';
}

// ── Fetch all sources in parallel ────────────────────────────────────────────

async function _fetchAllNews() {
  const rssFetches = RSS_FEEDS.map(f => _fetchRSS(f));
  const [cc, reddit, fng, ...rssResults] = await Promise.all([
    _fetchCC(),
    _fetchReddit(),
    _fetchFNG(),
    ...rssFetches,
  ]);

  _newsFng = fng;

  const all = [...cc, ...reddit, ...rssResults.flat()];
  const seen = new Set();
  _newsItems = all
    .filter(item => {
      if (!item.title || seen.has(item.title.toLowerCase())) return false;
      seen.add(item.title.toLowerCase());
      return true;
    })
    .sort((a, b) => b.ts - a.ts);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _renderFNG() {
  if (!_newsFng.length) return '';
  const today = _newsFng[0];
  const history = _newsFng.slice(1);
  const todayCls = _fngClass(today.value);
  const dayLabels = ['Today', 'Yst', '2d', '3d', '4d', '5d', '6d'];
  const chips = [today, ...history].map((e, i) => {
    const cls = _fngClass(e.value);
    const isToday = i === 0;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span class="news-fng-chip ${cls}${isToday ? ' today' : ''}" title="${e.label}">${e.value}</span>
      <span style="font-size:9px;color:var(--text-faint)">${dayLabels[i]||''}</span>
    </div>`;
  }).join('<span class="news-fng-arrow">›</span>');

  return `
  <div class="news-fng-bar">
    <span class="news-fng-label">Fear &amp; Greed</span>
    ${chips}
    <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${today.label}</span>
  </div>`;
}

function _renderFilters() {
  const srcs = ['all', ...Object.keys(NEWS_SOURCES)];
  const counts = {};
  _newsItems.forEach(n => { counts[n.source] = (counts[n.source] || 0) + 1; });
  return `
  <div class="filter-bar">
    ${srcs.map(s => {
      const active = _newsFilter === s ? ' active' : '';
      const lbl = s === 'all' ? `All (${_newsItems.length})` : `${NEWS_SOURCES[s].label} (${counts[s] || 0})`;
      return `<button class="btn btn-ghost btn-sm${active}" onclick="newsFilter('${s}')">${lbl}</button>`;
    }).join('')}
    <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
      <button class="btn btn-ghost btn-sm" id="news-refresh-btn" onclick="newsRefresh()">↺ Refresh</button>
    </div>
  </div>`;
}

function _renderCard(item) {
  const meta = NEWS_SOURCES[item.source] || { label: item.source, cls: '' };
  const tags = item.tags.length
    ? `<div class="news-tags">${item.tags.map(t => `<span class="news-tag">${t}</span>`).join('')}</div>`
    : '';
  const redditMeta = item.redditMeta
    ? `<div class="news-reddit-meta">${item.redditMeta}</div>`
    : '';
  return `
  <div class="news-card">
    <div class="news-card-header">
      <span class="news-source-badge ${meta.cls}">${meta.label}</span>
      <span class="news-time">${_timeAgo(item.ts)}</span>
    </div>
    <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="news-title">${item.title}</a>
    ${item.excerpt ? `<div class="news-excerpt">${item.excerpt}</div>` : ''}
    ${tags}${redditMeta}
  </div>`;
}

function _renderFeed() {
  const visible = _newsFilter === 'all'
    ? _newsItems
    : _newsItems.filter(n => n.source === _newsFilter);

  const page = visible.slice(0, _newsPage * NEWS_PER_PAGE);
  const hasMore = visible.length > page.length;

  if (!page.length) {
    return `<div class="news-empty">No news from this source yet.</div>`;
  }

  const cards = page.map(_renderCard).join('');
  const loadMore = hasMore
    ? `<button class="news-load-more" onclick="newsLoadMore()">Load ${Math.min(NEWS_PER_PAGE, visible.length - page.length)} more</button>`
    : '';
  return `<div class="news-feed">${cards}${loadMore}</div>`;
}

function _renderNewsPage(loading = false) {
  const el = document.getElementById('news-content');
  if (!el) return;

  if (loading) {
    el.innerHTML = `
      ${_renderFNG()}
      <div class="loading"><div class="spinner"></div> Fetching from ${RSS_FEEDS.length + 2} sources…</div>`;
    return;
  }

  el.innerHTML = `
    ${_renderFNG()}
    ${_renderFilters()}
    ${_renderFeed()}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function loadNews() {
  const el = document.getElementById('news-content');
  if (!el) return;

  if (_newsLoaded && _newsItems.length) {
    _renderNewsPage(false);
    return;
  }

  _renderNewsPage(true);

  try {
    await _fetchAllNews();
    _newsLoaded = true;
    _renderNewsPage(false);
  } catch (e) {
    el.innerHTML = `<div class="news-empty" style="color:var(--red)">Error loading news: ${e.message}</div>`;
  }

  // Auto-refresh every 5 minutes
  clearInterval(_newsRefreshT);
  _newsRefreshT = setInterval(async () => {
    _newsLoaded = false;
    _newsPage = 1;
    await _fetchAllNews();
    _newsLoaded = true;
    _renderNewsPage(false);
  }, 5 * 60 * 1000);
}

function newsFilter(src) {
  _newsFilter = src;
  _newsPage = 1;
  _renderNewsPage(false);
}

function newsLoadMore() {
  _newsPage++;
  _renderNewsPage(false);
}

async function newsRefresh() {
  const btn = document.getElementById('news-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ …'; }
  _newsLoaded = false;
  _newsPage   = 1;
  await _fetchAllNews();
  _newsLoaded = true;
  _renderNewsPage(false);
}
