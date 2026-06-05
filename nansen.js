let _nansenCache = null, _nansenCacheTs = 0;
const NANSEN_TTL = 300000;
let _prevFlows = {};
let _nansenTab = 'positions';
let _nansenTimer = null, _nansenCountdown = 300;

function nansenProxyUrl() {
  // Configurable backend URL for the Vercel proxy function.
  // Set via localStorage key "nansen_backend_url", e.g. https://your-app.vercel.app
  const base = (localStorage.getItem('nansen_backend_url') || '').replace(/\/$/, '');
  return base ? `${base}/api/nansen` : null;
}

async function fetchNansenData() {
  const apiKey = localStorage.getItem('nansen_api_key');
  if (!apiKey) return null;

  if (_nansenCache && Date.now() - _nansenCacheTs < NANSEN_TTL) return _nansenCache;

  const proxyUrl = nansenProxyUrl();
  let result;

  if (proxyUrl) {
    // Use Vercel proxy (avoids CORS)
    const resp = await fetch(`${proxyUrl}?key=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Proxy ${resp.status}`);
    }
    result = await resp.json();
  } else {
    // Direct call — only works when CORS is allowed (e.g. local dev)
    const chains = ['ethereum', 'solana', 'base', 'arbitrum', 'optimism', 'bnb', 'hyperevm'];
    const headers = { 'Content-Type': 'application/json', 'apikey': apiKey };

    const [netflowResp, holdingsResp] = await Promise.allSettled([
      fetch('https://api.nansen.ai/api/v1/smart-money/netflow', {
        method: 'POST', headers,
        body: JSON.stringify({ chains, pagination: { page: 1, per_page: 100 } })
      }),
      fetch('https://api.nansen.ai/api/v1/smart-money/holdings', {
        method: 'POST', headers,
        body: JSON.stringify({ chains })
      })
    ]);

    const netflows = netflowResp.status === 'fulfilled' && netflowResp.value.ok
      ? await netflowResp.value.json() : [];
    const holdings = holdingsResp.status === 'fulfilled' && holdingsResp.value.ok
      ? await holdingsResp.value.json() : null;

    result = { netflows, holdings, fetched_at: Date.now() };
  }

  _nansenCache = result;
  _nansenCacheTs = Date.now();
  window._nansenData = _nansenCache;
  return _nansenCache;
}

function checkFlowAlerts(netflows, openPositionSymbols) {
  if (!('Notification' in window)) return;

  (netflows || []).forEach(item => {
    const sym = item?.token?.symbol?.toUpperCase();
    if (!sym || !openPositionSymbols.includes(sym)) return;

    const dir = (item.netflow_usd_1h || 0) >= 0 ? 'in' : 'out';
    const prev = _prevFlows[sym];

    if (prev && prev !== dir) {
      const msg = dir === 'in'
        ? `Smart money BUYING ${sym} — net inflow flipped positive`
        : `Smart money SELLING ${sym} — net outflow flipped negative`;

      if (Notification.permission === 'granted') {
        new Notification('Hype — Flow Alert', { body: msg, icon: '/icons/icon-192.png' });
      }
    }
    _prevFlows[sym] = dir;
  });
}

function fmtFlow(usd) {
  if (usd === null || usd === undefined || usd === 0) return '—';
  const abs = Math.abs(usd);
  const str = abs >= 1e9 ? (abs / 1e9).toFixed(2) + 'B'
    : abs >= 1e6 ? (abs / 1e6).toFixed(2) + 'M'
    : abs >= 1e3 ? (abs / 1e3).toFixed(1) + 'K'
    : abs.toFixed(0);
  return (usd >= 0 ? '+$' : '-$') + str;
}

function flowCls(usd) {
  return usd > 0 ? 'pos' : usd < 0 ? 'neg' : 'muted';
}

function signalBadge(usd24h) {
  if (usd24h > 100000) return '<span class="nansen-badge nansen-accum">ACCUMULATING</span>';
  if (usd24h < -100000) return '<span class="nansen-badge nansen-distrib">DISTRIBUTING</span>';
  return '<span class="nansen-badge nansen-neutral">NEUTRAL</span>';
}

function setNansenTab(tab, btn) {
  _nansenTab = tab;
  document.querySelectorAll('.nansen-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderNansenTab();
}

function startNansenRefresh() {
  if (_nansenTimer) clearInterval(_nansenTimer);
  _nansenCountdown = 300;
  _nansenTimer = setInterval(() => {
    _nansenCountdown--;
    const el = document.getElementById('nansen-countdown');
    if (el) el.textContent = _nansenCountdown + 's';
    if (_nansenCountdown <= 0) {
      _nansenCache = null;
      _nansenCacheTs = 0;
      loadNansen();
    }
  }, 1000);
}

function requestNansenNotifPerms() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function nansenKeyForm() {
  const savedKey = localStorage.getItem('nansen_api_key') || '';
  const savedBackend = localStorage.getItem('nansen_backend_url') || '';
  return `<div class="nansen-key-form">
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Nansen Smart Money Setup</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
      Enter your Nansen API key and the URL of your deployed Vercel app (needed because Nansen blocks direct browser requests).
    </div>
    <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">Nansen API Key</label>
    <input id="nansen-key-input" type="text" value="${savedKey}" placeholder="nsn_..." autocomplete="off" spellcheck="false" style="margin-bottom:10px">
    <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">Vercel App URL <span style="opacity:0.6">(proxy, e.g. https://hype-xyz.vercel.app)</span></label>
    <input id="nansen-backend-input" type="text" value="${savedBackend}" placeholder="https://your-app.vercel.app" autocomplete="off" spellcheck="false" style="margin-bottom:12px">
    <button class="nansen-save-key-btn" onclick="nansenSaveKey()">Save &amp; Load</button>
  </div>`;
}

function nansenSaveKey() {
  const key = (document.getElementById('nansen-key-input')?.value || '').trim();
  const backend = (document.getElementById('nansen-backend-input')?.value || '').trim();
  if (!key) return;
  localStorage.setItem('nansen_api_key', key);
  if (backend) localStorage.setItem('nansen_backend_url', backend);
  else localStorage.removeItem('nansen_backend_url');
  _nansenCache = null;
  _nansenCacheTs = 0;
  loadNansen();
}

function nansenGetPositionSymbols() {
  return (window._ovData?.positions || []).map(p => (p.coin || '').toUpperCase());
}

function nansenFindToken(netflows, sym) {
  const s = sym.toUpperCase();
  return (netflows || []).find(item => (item?.token?.symbol || '').toUpperCase() === s) || null;
}

function nansenMinsAgo(ts) {
  if (!ts) return '?';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  return `${mins} min ago`;
}

function renderNansenPositionsTab(netflows) {
  const positions = window._ovData?.positions || [];
  if (!positions.length) {
    return '<div class="nansen-no-data">No open positions found. Open a position to see Smart Money context here.</div>';
  }

  const cards = positions.map(p => {
    const sym = (p.coin || '').toUpperCase();
    const item = nansenFindToken(netflows, sym);
    if (!item) {
      return `<div class="nansen-pos-card pos-neutral">
        <div class="nansen-pos-header">
          <span class="nansen-pos-coin">${sym}</span>
          <span class="side-badge ${p.side}">${(p.side || '').toUpperCase()}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">No Nansen data for ${sym}</div>
      </div>`;
    }

    const f1h = item.netflow_usd_1h ?? null;
    const f24h = item.netflow_usd_24h ?? null;
    const f7d = item.netflow_usd_7d ?? null;
    const holders = item.smart_money_holder_count ?? null;
    const priceCh = item.price_change_24h_pct ?? null;

    const cardCls = f24h > 100000 ? 'pos-accum' : f24h < -100000 ? 'pos-distrib' : 'pos-neutral';

    return `<div class="nansen-pos-card ${cardCls}">
      <div class="nansen-pos-header">
        <span class="nansen-pos-coin">${sym}</span>
        <span class="side-badge ${p.side}">${(p.side || '').toUpperCase()}</span>
        ${signalBadge(f24h)}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
        ${item.token?.name ? item.token.name + ' · ' : ''}${item.token?.chain || ''}
        ${holders !== null ? ` · <span style="color:var(--text)">${holders} SM holders</span>` : ''}
        ${priceCh !== null ? ` · <span class="${priceCh >= 0 ? 'pos' : 'neg'}">${priceCh >= 0 ? '+' : ''}${priceCh.toFixed(2)}% 24h</span>` : ''}
      </div>
      <div class="nansen-flows">
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">1h Flow</div>
          <div class="nansen-flow-val ${flowCls(f1h)}">${fmtFlow(f1h)}</div>
        </div>
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">24h Flow</div>
          <div class="nansen-flow-val ${flowCls(f24h)}">${fmtFlow(f24h)}</div>
        </div>
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">7d Flow</div>
          <div class="nansen-flow-val ${flowCls(f7d)}">${fmtFlow(f7d)}</div>
        </div>
      </div>
    </div>`;
  });

  return `<div class="nansen-pos-grid">${cards.join('')}</div>`;
}

function renderNansenTopMoversTab(netflows) {
  const openSyms = new Set(nansenGetPositionSymbols());

  const items = (netflows || []).slice(0, 50);

  let filterChips = `<div style="display:flex;gap:6px;padding:10px 14px;border-bottom:1px solid var(--border)">
    <button class="chip active" id="nansen-mover-chip-inflow" onclick="nansenSetMoverFilter('inflow',this)">Inflow 24h</button>
    <button class="chip" id="nansen-mover-chip-outflow" onclick="nansenSetMoverFilter('outflow',this)">Outflow 24h</button>
    <button class="chip" id="nansen-mover-chip-holders" onclick="nansenSetMoverFilter('holders',this)">Top Holders</button>
  </div>`;

  const sorted = [...items].sort((a, b) => (b.netflow_usd_24h || 0) - (a.netflow_usd_24h || 0));

  const rows = sorted.map((item, i) => {
    const sym = item?.token?.symbol?.toUpperCase() || '?';
    const chain = item?.token?.chain || '';
    const isOpen = openSyms.has(sym);
    const f1h = item.netflow_usd_1h ?? null;
    const f24h = item.netflow_usd_24h ?? null;
    const f7d = item.netflow_usd_7d ?? null;
    const holders = item.smart_money_holder_count ?? null;
    const priceCh = item.price_change_24h_pct ?? null;

    return `<tr class="${isOpen ? 'nansen-pos-open' : ''}" style="${isOpen ? 'border-left:2px solid var(--accent)' : ''}">
      <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
      <td>
        <div style="font-weight:600;font-size:12px">${sym}</div>
        <div style="font-size:10px;color:var(--text-muted)">${item.token?.name || ''}</div>
      </td>
      <td style="font-size:11px;color:var(--text-muted)">${chain}</td>
      <td class="${flowCls(f1h)}" style="font-family:var(--mono);font-size:11px">${fmtFlow(f1h)}</td>
      <td class="${flowCls(f24h)}" style="font-family:var(--mono);font-size:11px;font-weight:700">${fmtFlow(f24h)}</td>
      <td class="${flowCls(f7d)}" style="font-family:var(--mono);font-size:11px">${fmtFlow(f7d)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${holders !== null ? holders.toLocaleString() : '—'}</td>
      <td class="${priceCh !== null ? (priceCh >= 0 ? 'pos' : 'neg') : 'muted'}" style="font-family:var(--mono);font-size:11px">${priceCh !== null ? (priceCh >= 0 ? '+' : '') + priceCh.toFixed(2) + '%' : '—'}</td>
      <td>${signalBadge(f24h)}</td>
    </tr>`;
  }).join('');

  return `${filterChips}
  <div style="overflow-x:auto">
  <table class="data-table" id="nansen-movers-table">
    <thead><tr>
      <th>#</th><th>Token</th><th>Chain</th>
      <th>SM Flow 1h</th><th>SM Flow 24h</th><th>SM Flow 7d</th>
      <th>Holders</th><th>Price Chg</th><th>Signal</th>
    </tr></thead>
    <tbody id="nansen-movers-tbody">${rows}</tbody>
  </table>
  </div>`;
}

function nansenSetMoverFilter(filter, btn) {
  document.querySelectorAll('[id^="nansen-mover-chip-"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const netflows = _nansenCache?.netflows || [];
  const openSyms = new Set(nansenGetPositionSymbols());
  let sorted;
  if (filter === 'inflow') {
    sorted = [...netflows].sort((a, b) => (b.netflow_usd_24h || 0) - (a.netflow_usd_24h || 0));
  } else if (filter === 'outflow') {
    sorted = [...netflows].sort((a, b) => (a.netflow_usd_24h || 0) - (b.netflow_usd_24h || 0));
  } else {
    sorted = [...netflows].sort((a, b) => (b.smart_money_holder_count || 0) - (a.smart_money_holder_count || 0));
  }

  const tbody = document.getElementById('nansen-movers-tbody');
  if (!tbody) return;
  tbody.innerHTML = sorted.slice(0, 50).map((item, i) => {
    const sym = item?.token?.symbol?.toUpperCase() || '?';
    const chain = item?.token?.chain || '';
    const isOpen = openSyms.has(sym);
    const f1h = item.netflow_usd_1h ?? null;
    const f24h = item.netflow_usd_24h ?? null;
    const f7d = item.netflow_usd_7d ?? null;
    const holders = item.smart_money_holder_count ?? null;
    const priceCh = item.price_change_24h_pct ?? null;

    return `<tr style="${isOpen ? 'border-left:2px solid var(--accent)' : ''}">
      <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
      <td>
        <div style="font-weight:600;font-size:12px">${sym}</div>
        <div style="font-size:10px;color:var(--text-muted)">${item.token?.name || ''}</div>
      </td>
      <td style="font-size:11px;color:var(--text-muted)">${chain}</td>
      <td class="${flowCls(f1h)}" style="font-family:var(--mono);font-size:11px">${fmtFlow(f1h)}</td>
      <td class="${flowCls(f24h)}" style="font-family:var(--mono);font-size:11px;font-weight:700">${fmtFlow(f24h)}</td>
      <td class="${flowCls(f7d)}" style="font-family:var(--mono);font-size:11px">${fmtFlow(f7d)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${holders !== null ? holders.toLocaleString() : '—'}</td>
      <td class="${priceCh !== null ? (priceCh >= 0 ? 'pos' : 'neg') : 'muted'}" style="font-family:var(--mono);font-size:11px">${priceCh !== null ? (priceCh >= 0 ? '+' : '') + priceCh.toFixed(2) + '%' : '—'}</td>
      <td>${signalBadge(f24h)}</td>
    </tr>`;
  }).join('');
}

function nansenGetWatchlist() {
  try { return JSON.parse(localStorage.getItem('nansen_watchlist') || '[]'); } catch { return []; }
}
function nansenSaveWatchlist(list) {
  localStorage.setItem('nansen_watchlist', JSON.stringify(list));
}

function nansenAddToWatchlist() {
  const input = document.getElementById('nansen-wl-input');
  const sym = (input?.value || '').trim().toUpperCase();
  if (!sym) return;
  const list = nansenGetWatchlist();
  if (!list.includes(sym)) {
    list.push(sym);
    nansenSaveWatchlist(list);
  }
  if (input) input.value = '';
  renderNansenTab();
}

function nansenRemoveFromWatchlist(sym) {
  const list = nansenGetWatchlist().filter(s => s !== sym);
  nansenSaveWatchlist(list);
  renderNansenTab();
}

function renderNansenWatchlistTab(netflows) {
  const list = nansenGetWatchlist();

  const inputRow = `<div class="nansen-watchlist-input">
    <input id="nansen-wl-input" type="text" placeholder="Add token symbol (e.g. ETH)" onkeydown="if(event.key==='Enter')nansenAddToWatchlist()">
    <button class="nansen-add-btn" onclick="nansenAddToWatchlist()">Add</button>
  </div>`;

  if (!list.length) {
    return inputRow + '<div class="nansen-no-data">No symbols in watchlist. Add one above.</div>';
  }

  const cards = list.map(sym => {
    const item = nansenFindToken(netflows, sym);
    const removeBtn = `<button class="nansen-wl-remove" onclick="nansenRemoveFromWatchlist('${sym}')" title="Remove">×</button>`;

    if (!item) {
      return `<div class="nansen-wl-item" style="padding:10px 14px;border-bottom:1px solid var(--border)">
        ${removeBtn}
        <span style="font-weight:600">${sym}</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px">No Nansen data</span>
      </div>`;
    }

    const f1h = item.netflow_usd_1h ?? null;
    const f24h = item.netflow_usd_24h ?? null;
    const f7d = item.netflow_usd_7d ?? null;
    const holders = item.smart_money_holder_count ?? null;
    const cardCls = f24h > 100000 ? 'pos-accum' : f24h < -100000 ? 'pos-distrib' : 'pos-neutral';

    return `<div class="nansen-pos-card ${cardCls}" style="margin:8px 14px">
      <div class="nansen-pos-header">
        ${removeBtn}
        <span class="nansen-pos-coin">${sym}</span>
        ${signalBadge(f24h)}
        ${holders !== null ? `<span style="font-size:11px;color:var(--text-muted)">${holders} holders</span>` : ''}
      </div>
      <div class="nansen-flows">
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">1h Flow</div>
          <div class="nansen-flow-val ${flowCls(f1h)}">${fmtFlow(f1h)}</div>
        </div>
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">24h Flow</div>
          <div class="nansen-flow-val ${flowCls(f24h)}">${fmtFlow(f24h)}</div>
        </div>
        <div class="nansen-flow-cell">
          <div class="nansen-flow-label">7d Flow</div>
          <div class="nansen-flow-val ${flowCls(f7d)}">${fmtFlow(f7d)}</div>
        </div>
      </div>
    </div>`;
  });

  return inputRow + cards.join('');
}

function renderNansenTab() {
  const content = document.getElementById('smartmoney-content');
  if (!content) return;

  const netflows = _nansenCache?.netflows || [];
  const fetchedAt = _nansenCache?.fetched_at || null;

  const header = `<div class="nansen-header">
    <span class="nansen-status">Last updated: ${fetchedAt ? nansenMinsAgo(fetchedAt) : '—'}</span>
    <span class="nansen-status">Auto-refresh in: <span class="nansen-countdown" id="nansen-countdown">${_nansenCountdown}s</span></span>
    <button class="nansen-refresh-btn" onclick="nansenForceRefresh()">Refresh Now</button>
    <button class="nansen-refresh-btn" onclick="nansenShowSettings()">Settings</button>
  </div>
  <div class="nansen-tabs">
    <button class="nansen-tab${_nansenTab === 'positions' ? ' active' : ''}" onclick="setNansenTab('positions',this)">Positions</button>
    <button class="nansen-tab${_nansenTab === 'movers' ? ' active' : ''}" onclick="setNansenTab('movers',this)">Top Movers</button>
    <button class="nansen-tab${_nansenTab === 'watchlist' ? ' active' : ''}" onclick="setNansenTab('watchlist',this)">Watchlist</button>
  </div>`;

  let tabContent = '';
  if (_nansenTab === 'positions') tabContent = renderNansenPositionsTab(netflows);
  else if (_nansenTab === 'movers') tabContent = renderNansenTopMoversTab(netflows);
  else tabContent = renderNansenWatchlistTab(netflows);

  content.innerHTML = header + tabContent;
}

function nansenForceRefresh() {
  _nansenCache = null;
  _nansenCacheTs = 0;
  loadNansen();
}

function nansenClearKey() {
  localStorage.removeItem('nansen_api_key');
  _nansenCache = null;
  _nansenCacheTs = 0;
  loadNansen();
}

async function loadNansen() {
  const content = document.getElementById('smartmoney-content');
  if (!content) return;

  const apiKey = localStorage.getItem('nansen_api_key');
  if (!apiKey) {
    content.innerHTML = nansenKeyForm();
    return;
  }

  requestNansenNotifPerms();

  if (!_nansenCache) {
    content.innerHTML = '<div class="loading"><div class="spinner"></div> Loading Smart Money data…</div>';
  }

  try {
    const data = await fetchNansenData();
    if (!data) {
      content.innerHTML = nansenKeyForm();
      return;
    }

    const openSyms = nansenGetPositionSymbols();
    checkFlowAlerts(data.netflows, openSyms);

    renderNansenTab();
    startNansenRefresh();
  } catch (err) {
    const proxyConfigured = !!localStorage.getItem('nansen_backend_url');
    const hint = !proxyConfigured
      ? '<div style="font-size:11px;color:var(--yellow);margin-top:6px">Tip: Nansen blocks direct browser requests. Open Settings and enter your Vercel app URL to use the proxy.</div>'
      : '';
    content.innerHTML = `<div class="nansen-no-data">
      <div style="color:var(--red);font-weight:600;margin-bottom:8px">Failed to load Nansen data</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${err.message}</div>
      ${hint}
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="nansen-refresh-btn" onclick="nansenForceRefresh()">Try Again</button>
        <button class="nansen-refresh-btn" onclick="nansenShowSettings()">Settings</button>
        <button class="nansen-refresh-btn" onclick="nansenClearKey()">Clear Key</button>
      </div>
    </div>`;
  }
}

function nansenShowSettings() {
  const content = document.getElementById('smartmoney-content');
  if (content) content.innerHTML = nansenKeyForm();
}
