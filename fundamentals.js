// ── Fundamentals — CoinGecko public API (no key) ─────────────────────────────

const CG_BASE     = 'https://api.coingecko.com/api/v3';
const CG_MARKETS  = (p) => `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${p}&sparkline=false&price_change_percentage=24h,7d,30d`;
const CG_GLOBAL   = `${CG_BASE}/global`;
const CG_TRENDING = `${CG_BASE}/search/trending`;

let _fundCoins    = [];
let _fundGlobal   = null;
let _fundTrending = [];
let _fundSort     = { col: 'market_cap_rank', dir: 1 };
let _fundSearch   = '';
let _fundLoaded   = false;
let _fundTimer    = null;

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function loadFundamentals() {
  const el = document.getElementById('fundamentals-content');
  if (!el) return;
  if (_fundLoaded && _fundCoins.length) { _renderFund(); return; }
  el.innerHTML = `<div class="loading"><div class="spinner"></div> Loading market data…</div>`;
  await _fetchFund();
  _renderFund();
  clearInterval(_fundTimer);
  _fundTimer = setInterval(async () => { await _fetchFund(); _renderFund(); }, 5 * 60 * 1000);
}

async function _fetchFund() {
  const [coinsR, globalR, trendR] = await Promise.allSettled([
    fetch(CG_MARKETS(1)),
    fetch(CG_GLOBAL),
    fetch(CG_TRENDING),
  ]);
  if (coinsR.status === 'fulfilled' && coinsR.value.ok)  _fundCoins    = await coinsR.value.json();
  if (globalR.status === 'fulfilled' && globalR.value.ok) _fundGlobal  = (await globalR.value.json()).data;
  if (trendR.status === 'fulfilled'  && trendR.value.ok)  _fundTrending = ((await trendR.value.json()).coins || []).slice(0, 7).map(c => c.item);
  _fundLoaded = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fShort(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  return n?.toLocaleString() || '—';
}

function _fPct(v) {
  if (v == null) return '<span style="color:var(--text-faint)">—</span>';
  const cls = v >= 0 ? 'pos' : 'neg';
  return `<span class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

function _fPrice(p) {
  if (p == null) return '—';
  const dec = p < 0.01 ? 6 : p < 1 ? 4 : 2;
  return '$' + p.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderFund() {
  const el = document.getElementById('fundamentals-content');
  if (!el) return;
  el.innerHTML = _renderFundGlobalBar() + _renderFundToolbar() + _renderFundTable();
}

function _renderFundGlobalBar() {
  if (!_fundGlobal) return '';
  const g    = _fundGlobal;
  const mcap = g.total_market_cap?.usd || 0;
  const vol  = g.total_volume?.usd || 0;
  const chg  = g.market_cap_change_percentage_24h_usd || 0;
  const btcD = (g.market_cap_percentage?.btc || 0).toFixed(1);
  const ethD = (g.market_cap_percentage?.eth || 0).toFixed(1);
  const trend = _fundTrending.length
    ? `<span class="fund-stat-label">Trending:</span> ${_fundTrending.map(t => `<span class="fund-chip">${t.symbol}</span>`).join('')}`
    : '';
  return `
  <div class="fund-global-bar">
    <span class="fund-stat"><span class="fund-stat-label">Total MCap</span> <strong>$${_fShort(mcap)}</strong> <span class="${chg >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span></span>
    <span class="fund-sep">|</span>
    <span class="fund-stat"><span class="fund-stat-label">24h Vol</span> <strong>$${_fShort(vol)}</strong></span>
    <span class="fund-sep">|</span>
    <span class="fund-stat"><span class="fund-stat-label">BTC Dom</span> <strong>${btcD}%</strong></span>
    <span class="fund-stat"><span class="fund-stat-label">ETH Dom</span> <strong>${ethD}%</strong></span>
    <span class="fund-sep">|</span>
    <span class="fund-stat"><span class="fund-stat-label">Coins</span> <strong>${(g.active_cryptocurrencies || 0).toLocaleString()}</strong></span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${trend}</div>
  </div>`;
}

function _renderFundToolbar() {
  const ts = _fundLoaded ? `updated ${new Date().toLocaleTimeString()}` : '';
  return `
  <div class="fund-toolbar">
    <input class="input" placeholder="Search…" value="${_fundSearch.replace(/"/g,'&quot;')}" oninput="fundSearch(this.value)" style="width:160px">
    <span style="font-size:11px;color:var(--text-faint)">${_fundCoins.length} coins · ${ts}</span>
    <button class="btn btn-ghost btn-sm" onclick="fundRefresh()" style="margin-left:auto">↺ Refresh</button>
  </div>`;
}

function _renderFundTable() {
  if (!_fundCoins.length) return `<div class="news-empty">No data — CoinGecko may be rate-limited, try refreshing in a moment.</div>`;

  let coins = [..._fundCoins];
  if (_fundSearch) {
    const q = _fundSearch.toLowerCase();
    coins = coins.filter(c => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }
  const { col, dir } = _fundSort;
  coins.sort((a, b) => {
    const av = a[col] ?? (dir > 0 ? Infinity : -Infinity);
    const bv = b[col] ?? (dir > 0 ? Infinity : -Infinity);
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });

  const si = (c) => _fundSort.col === c ? (_fundSort.dir > 0 ? ' ↑' : ' ↓') : '';
  const th = (c, lbl, align = '') =>
    `<th onclick="fundSort('${c}')" style="cursor:pointer;user-select:none${align ? ';text-align:' + align : ''}">${lbl}${si(c)}</th>`;

  const rows = coins.map(c => {
    const vm = c.total_volume && c.market_cap ? (c.total_volume / c.market_cap * 100) : null;
    const athPct = c.ath_change_percentage;
    return `<tr>
      <td class="num" style="color:var(--text-faint)">${c.market_cap_rank || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:7px">
          <img src="${c.image}" width="20" height="20" style="border-radius:50%;flex-shrink:0" loading="lazy" onerror="this.style.display='none'">
          <span style="font-weight:600">${c.symbol.toUpperCase()}</span>
          <span style="color:var(--text-faint);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px">${c.name}</span>
        </div>
      </td>
      <td class="num">${_fPrice(c.current_price)}</td>
      <td class="num">${_fPct(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h)}</td>
      <td class="num">${_fPct(c.price_change_percentage_7d_in_currency)}</td>
      <td class="num">${_fPct(c.price_change_percentage_30d_in_currency)}</td>
      <td class="num">$${_fShort(c.market_cap || 0)}</td>
      <td class="num">$${_fShort(c.total_volume || 0)}</td>
      <td class="num">${vm != null ? `<span style="color:${vm > 20 ? 'var(--yellow)' : 'var(--text-muted)'}">${vm.toFixed(1)}%</span>` : '—'}</td>
      <td class="num">${_fPct(athPct)}</td>
    </tr>`;
  }).join('');

  return `
  <div style="overflow:auto;flex:1">
    <table class="fund-table">
      <thead><tr>
        ${th('market_cap_rank', '#')}
        ${th('name', 'Coin')}
        ${th('current_price', 'Price', 'right')}
        ${th('price_change_percentage_24h', '24h', 'right')}
        ${th('price_change_percentage_7d_in_currency', '7d', 'right')}
        ${th('price_change_percentage_30d_in_currency', '30d', 'right')}
        ${th('market_cap', 'Mkt Cap', 'right')}
        ${th('total_volume', '24h Vol', 'right')}
        ${th('total_volume', 'Vol/MCap', 'right')}
        ${th('ath_change_percentage', 'ATH %', 'right')}
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-faint)">No results</td></tr>'}</tbody>
    </table>
  </div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function fundSort(col) {
  if (_fundSort.col === col) _fundSort.dir *= -1;
  else { _fundSort.col = col; _fundSort.dir = 1; }
  _renderFund();
}
function fundSearch(q) { _fundSearch = q; _renderFund(); }
async function fundRefresh() {
  _fundLoaded = false;
  const el = document.getElementById('fundamentals-content');
  if (el) el.innerHTML = `<div class="loading"><div class="spinner"></div> Refreshing…</div>`;
  await _fetchFund();
  _renderFund();
}
