const API = '';  // same origin
const PRIMARY_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';

let ws = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => setStatus(true);
  ws.onclose = () => { setStatus(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => setStatus(false);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'positions_update') {
      if (document.getElementById('page-overview').classList.contains('active')) {
        renderOverview(msg.summary, msg.positions);
      }
    }
    if (msg.event === 'notification' || msg.event === 'wallet_change') {
      addNotification(msg.notification);
    }
  };
}

function setStatus(online) {
  document.getElementById('ws-status').className = 'status-dot' + (online ? '' : ' off');
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Update topbar tabs
  document.querySelectorAll('.topbar-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.topbar-tab[data-page="${page}"]`);
  if (activeTab) activeTab.classList.add('active');

  // Update sidebar icons
  document.querySelectorAll('.nav-icon-btn').forEach(n => n.classList.remove('active'));
  const activeIcon = document.querySelector(`.nav-icon-btn[data-page="${page}"]`);
  if (activeIcon) activeIcon.classList.add('active');

  const loaders = { overview: loadOverview, trades: loadTrades, funding: loadFunding, flows: loadFlows, phases: loadPhases, watchlist: loadWatchlist, mvrv: loadMVRV, ai: loadAI, settings: loadSettings };
  if (loaders[page]) loaders[page]();
}

// ── Shared components ─────────────────────────────────────────────────────────

function statStrip(cells) {
  return `<div class="stat-strip">${cells.map(c => `
    <div class="stat-cell">
      <div class="s-label">${c.label}</div>
      <div class="s-value${c.cls ? ' ' + c.cls : ''}">${c.value}</div>
      ${c.sub ? `<div class="s-sub">${c.sub}</div>` : ''}
    </div>`).join('')}</div>`;
}

function filterBar(groups) {
  // groups: [{chips: [{label, value, active}], key}]
  const chips = groups.map((g, gi) => {
    const chipHtml = g.chips.map(c =>
      `<button class="chip${c.active ? ' active' : ''}" onclick="${g.onclick}('${c.value}',this,${gi})">${c.label}</button>`
    ).join('');
    return chipHtml;
  }).join('<div class="filter-sep"></div>');
  return `<div class="filter-bar">${chips}</div>`;
}

function tableCard(title, tableHtml, headerRight = '') {
  return `<div class="table-wrap">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface)">
      <span style="font-size:13px;font-weight:600;color:var(--text)">${title}</span>
      <span>${headerRight}</span>
    </div>
    ${tableHtml}
  </div>`;
}

function skeletonRows(n = 6, cols = 7) {
  const ws = ['40%','60%','30%','50%','45%','35%','55%'];
  return Array.from({length: n}, () =>
    `<tr>${Array.from({length: cols}, (_,i) =>
      `<td><div class="skeleton skeleton-cell" style="height:11px;width:${ws[i%ws.length]};border-radius:3px"></div></td>`
    ).join('')}</tr>`
  ).join('');
}

function emptyState(msg = 'No data') {
  return `<div class="loading" style="color:var(--text-muted)">${msg}</div>`;
}

function sparkline(data, isPos) {
  if (!data || data.length < 2) return '<span class="muted" style="font-size:11px">—</span>';
  const W = 60, H = 24, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = isPos ? 'var(--green)' : 'var(--red)';
  return `<svg width="${W}" height="${H}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ── Overview ──────────────────────────────────────────────────────────────────

let _overviewFilter = 'all';

async function loadOverview() {
  const el = document.getElementById('overview-content');
  el.innerHTML = `<div class="stat-strip">${[...Array(4)].map(() => `<div class="stat-cell"><div class="skeleton" style="height:11px;width:60%;margin-bottom:6px"></div><div class="skeleton" style="height:20px;width:80%"></div></div>`).join('')}</div>
    <div class="table-wrap">${'<div style="padding:12px 16px;border-bottom:1px solid var(--border)"><div class="skeleton" style="height:11px;width:30%"></div></div>'}<table><tbody>${skeletonRows(8)}</tbody></table></div>`;
  try {
    const data = await fetch(`${API}/api/positions?wallet=${PRIMARY_WALLET}`).then(r => r.json());
    renderOverview(data.summary, data.positions);
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderOverview(summary, positions) {
  const totalPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);
  const marginPct = summary.account_value > 0
    ? ((summary.total_margin_used / summary.account_value) * 100).toFixed(1) + '%'
    : '0%';

  let filtered = positions;
  if (_overviewFilter === 'long')  filtered = positions.filter(p => p.side === 'long');
  if (_overviewFilter === 'short') filtered = positions.filter(p => p.side === 'short');

  const chips = [
    {label: 'All',   value: 'all',   active: _overviewFilter === 'all'},
    {label: 'Long',  value: 'long',  active: _overviewFilter === 'long'},
    {label: 'Short', value: 'short', active: _overviewFilter === 'short'},
  ];

  const rows = filtered.length === 0
    ? `<tr><td colspan="8">${emptyState('No open positions')}</td></tr>`
    : filtered.map(p => `
      <tr>
        <td class="coin-cell">${p.coin}</td>
        <td><span class="side-badge ${p.side}">${p.side.toUpperCase()}</span></td>
        <td class="num">${p.size}</td>
        <td class="num">${fmt$(p.entry_price)}</td>
        <td class="num ${p.liquidation_price > 0 ? 'neg' : 'muted'}">${p.liquidation_price > 0 ? fmt$(p.liquidation_price) : '—'}</td>
        <td class="num ${p.unrealized_pnl >= 0 ? 'pos' : 'neg'}">${fmt$(p.unrealized_pnl)}</td>
        <td class="num ${p.cum_funding >= 0 ? 'pos' : 'neg'}">${p.cum_funding.toFixed(4)}</td>
        <td class="num muted">${p.leverage_value}× ${p.leverage_type}</td>
      </tr>`).join('');

  document.getElementById('overview-content').innerHTML = `
    ${statStrip([
      {label: 'Account Value',   value: fmt$(summary.account_value),      sub: `Withdrawable: ${fmt$(summary.withdrawable)}`},
      {label: 'Total Notional',  value: fmt$(summary.total_ntl_pos),      sub: `${positions.length} position${positions.length !== 1 ? 's' : ''}`},
      {label: 'Margin Used',     value: fmt$(summary.total_margin_used),  sub: marginPct + ' of account'},
      {label: 'Unrealized PnL',  value: fmt$(totalPnl), cls: totalPnl >= 0 ? 'pos' : 'neg'},
    ])}
    <div class="filter-bar">
      ${chips.map(c => `<button class="chip${c.active?' active':''}" onclick="setOverviewFilter('${c.value}')">${c.label}</button>`).join('')}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Coin</th><th>Side</th>
          <th class="num">Size</th><th class="num">Entry</th>
          <th class="num">Liq. Price</th><th class="num">Unr. PnL</th>
          <th class="num">Funding</th><th class="num">Leverage</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setOverviewFilter(val) {
  _overviewFilter = val;
  // Re-fetch is lightweight since data is already in the WS; just reload
  loadOverview();
}

// ── Trades ────────────────────────────────────────────────────────────────────

let _tradesFilter = 'all';
let _tradesData = [];

async function loadTrades() {
  const el = document.getElementById('trades-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading trades…</div>';
  try {
    const data = await fetch(`${API}/api/trades?wallet=${PRIMARY_WALLET}&limit=200`).then(r => r.json());
    _tradesData = data.trades;
    _tradesFilter = 'all';
    renderTrades();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderTrades() {
  const trades = _tradesData;
  let filtered = trades;
  if (_tradesFilter === 'wins')  filtered = trades.filter(t => t.closed_pnl > 0);
  if (_tradesFilter === 'losses')filtered = trades.filter(t => t.closed_pnl < 0);
  if (_tradesFilter === 'buy')   filtered = trades.filter(t => t.side === 'B');
  if (_tradesFilter === 'sell')  filtered = trades.filter(t => t.side === 'A');

  const totalPnl  = trades.reduce((a, t) => a + t.closed_pnl, 0);
  const wins      = trades.filter(t => t.closed_pnl > 0).length;
  const wr        = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0.0';
  const avgSize   = trades.length > 0 ? trades.reduce((a, t) => a + Math.abs(parseFloat(t.size)), 0) / trades.length : 0;

  const chips = [
    {label: 'All',    value: 'all'},
    {label: 'Wins',   value: 'wins'},
    {label: 'Losses', value: 'losses'},
    {label: 'Buy',    value: 'buy'},
    {label: 'Sell',   value: 'sell'},
  ];

  const rows = filtered.length === 0
    ? `<tr><td colspan="7">${emptyState('No trades found')}</td></tr>`
    : filtered.slice(0, 150).map(t => `
      <tr>
        <td class="muted" style="font-family:var(--mono);font-size:12px">${fmtTime(t.time)}</td>
        <td class="coin-cell">${t.coin}</td>
        <td><span class="side-badge ${t.side === 'B' ? 'long' : 'short'}">${t.side === 'B' ? 'BUY' : 'SELL'}</span></td>
        <td class="num">${fmt$(t.price)}</td>
        <td class="num">${t.size}</td>
        <td class="num neg">${t.fee > 0 ? '−' + t.fee.toFixed(4) : t.fee.toFixed(4)}</td>
        <td class="num ${t.closed_pnl >= 0 ? 'pos' : 'neg'}">${t.closed_pnl !== 0 ? fmt$(t.closed_pnl) : '—'}</td>
      </tr>`).join('');

  document.getElementById('trades-content').innerHTML = `
    ${statStrip([
      {label: 'Total Trades',  value: trades.length},
      {label: 'Realized PnL', value: fmt$(totalPnl), cls: totalPnl >= 0 ? 'pos' : 'neg'},
      {label: 'Win Rate',      value: wr + '%',       sub: `${wins}W / ${trades.length - wins}L`},
      {label: 'Avg Trade Size',value: avgSize > 0 ? avgSize.toFixed(4) : '—'},
    ])}
    <div class="filter-bar">
      ${chips.map(c => `<button class="chip${_tradesFilter === c.value ? ' active' : ''}" onclick="setTradesFilter('${c.value}')">${c.label}</button>`).join('')}
      <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">Showing ${Math.min(filtered.length, 150)} of ${filtered.length}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Time</th><th>Coin</th><th>Side</th>
          <th class="num">Price</th><th class="num">Size</th>
          <th class="num">Fee</th><th class="num">Closed PnL</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setTradesFilter(val) {
  _tradesFilter = val;
  renderTrades();
}

// ── Funding ───────────────────────────────────────────────────────────────────

let _fundingTab = 'coin';
let _fundingData = null;

async function loadFunding() {
  const el = document.getElementById('funding-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading funding…</div>';
  try {
    const data = await fetch(`${API}/api/funding?wallet=${PRIMARY_WALLET}&days=30`).then(r => r.json());
    _fundingData = data;
    renderFunding();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderFunding() {
  const data = _fundingData;
  const byCoin = data.by_coin;
  const coinRows = Object.entries(byCoin).sort((a, b) => a[1] - b[1]);
  const mostCostly = coinRows.length ? coinRows[0] : null;
  const avgDaily = data.funding.length > 0
    ? (data.total_usdc / 30).toFixed(4)
    : '—';

  const coinTable = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Coin</th><th class="num">Total USDC</th><th class="num">Avg Rate</th>
        </tr></thead>
        <tbody>${coinRows.length === 0 ? `<tr><td colspan="3">${emptyState('No funding data')}</td></tr>` :
          coinRows.map(([coin, usdc]) => {
            const payments = data.funding.filter(f => f.coin === coin);
            const avgRate = payments.length > 0
              ? (payments.reduce((a, f) => a + f.funding_rate, 0) / payments.length * 100).toFixed(4) + '%'
              : '—';
            return `<tr>
              <td class="coin-cell">${coin}</td>
              <td class="num ${usdc >= 0 ? 'pos' : 'neg'}">${fmt$(usdc)}</td>
              <td class="num ${usdc >= 0 ? 'pos' : 'neg'}">${avgRate}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const recentTable = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Time</th><th>Coin</th>
          <th class="num">Rate</th><th class="num">USDC</th>
        </tr></thead>
        <tbody>${data.funding.slice(0, 100).map(f => `
          <tr>
            <td class="muted" style="font-family:var(--mono);font-size:12px">${fmtTime(f.time)}</td>
            <td class="coin-cell">${f.coin || '?'}</td>
            <td class="num ${f.funding_rate >= 0 ? 'pos' : 'neg'}">${(f.funding_rate * 100).toFixed(4)}%</td>
            <td class="num ${f.usdc >= 0 ? 'pos' : 'neg'}">${f.usdc.toFixed(4)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('funding-content').innerHTML = `
    ${statStrip([
      {label: 'Total Funding (30d)', value: fmt$(data.total_usdc), cls: data.total_usdc >= 0 ? 'pos' : 'neg', sub: 'Positive = received'},
      {label: 'Most Costly',         value: mostCostly ? mostCostly[0] : '—', sub: mostCostly ? fmt$(mostCostly[1]) : ''},
      {label: 'Avg Daily',           value: avgDaily,     sub: '30-day average'},
      {label: 'Total Events',        value: data.funding.length},
    ])}
    <div class="filter-bar">
      <button class="chip${_fundingTab === 'coin' ? ' active' : ''}" onclick="setFundingTab('coin')">By Coin</button>
      <button class="chip${_fundingTab === 'recent' ? ' active' : ''}" onclick="setFundingTab('recent')">Recent Payments</button>
    </div>
    ${_fundingTab === 'coin' ? coinTable : recentTable}
  `;
}

function setFundingTab(tab) {
  _fundingTab = tab;
  renderFunding();
}

// ── Flows ─────────────────────────────────────────────────────────────────────

let _flowsFilter = 'all';
let _flowsData = null;

async function loadFlows() {
  const el = document.getElementById('flows-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading flows…</div>';
  try {
    const data = await fetch(`${API}/api/flows?wallet=${PRIMARY_WALLET}&days=90`).then(r => r.json());
    _flowsData = data;
    _flowsFilter = 'all';
    renderFlows();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderFlows() {
  const data = _flowsData;
  let filtered = data.flows;
  if (_flowsFilter === 'inflow')  filtered = data.flows.filter(f => f.direction === 'inflow');
  if (_flowsFilter === 'outflow') filtered = data.flows.filter(f => f.direction === 'outflow');

  const chips = [
    {label: 'All',      value: 'all'},
    {label: 'Inflow',   value: 'inflow'},
    {label: 'Outflow',  value: 'outflow'},
  ];

  const rows = filtered.length === 0
    ? `<tr><td colspan="5">${emptyState('No flows found')}</td></tr>`
    : filtered.map(f => `
      <tr>
        <td class="muted" style="font-family:var(--mono);font-size:12px">${fmtTime(f.time)}</td>
        <td><span class="side-badge ${f.direction}">${f.direction.toUpperCase()}</span></td>
        <td class="muted">${f.type}</td>
        <td class="num ${f.usdc >= 0 ? 'pos' : 'neg'}">${fmt$(Math.abs(f.usdc))}</td>
        <td class="muted" style="font-family:var(--mono);font-size:11px">${f.hash ? f.hash.slice(0, 12) + '…' : '—'}</td>
      </tr>`).join('');

  document.getElementById('flows-content').innerHTML = `
    ${statStrip([
      {label: 'Total Inflow (90d)',  value: fmt$(data.total_inflow),  cls: 'pos'},
      {label: 'Total Outflow',       value: fmt$(data.total_outflow), cls: 'neg'},
      {label: 'Net Flow',            value: fmt$(data.net), cls: data.net >= 0 ? 'pos' : 'neg'},
      {label: 'Total Events',        value: data.flows.length},
    ])}
    <div class="filter-bar">
      ${chips.map(c => `<button class="chip${_flowsFilter === c.value ? ' active' : ''}" onclick="setFlowsFilter('${c.value}')">${c.label}</button>`).join('')}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Time</th><th>Direction</th><th>Type</th>
          <th class="num">Amount</th><th>Tx Hash</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setFlowsFilter(val) {
  _flowsFilter = val;
  renderFlows();
}

// ── Phases ────────────────────────────────────────────────────────────────────

let _phaseInterval = '1h';
let _phaseTab = 'current';

async function loadPhases() {
  const el = document.getElementById('phases-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Detecting phases…</div>';
  try {
    const data = await fetch(`${API}/api/phase?wallet=${PRIMARY_WALLET}&interval=${_phaseInterval}`).then(r => r.json());
    renderPhases(data.phases);
    loadPhaseHistory();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderPhases(phases) {
  const statPhaseCounts = {};
  phases.forEach(p => { statPhaseCounts[p.phase] = (statPhaseCounts[p.phase] || 0) + 1; });
  const dominant = Object.entries(statPhaseCounts).sort((a, b) => b[1] - a[1])[0];
  const avgConf = phases.length > 0
    ? Math.round(phases.reduce((a, p) => a + (p.confidence || 0), 0) / phases.length * 100) + '%'
    : '—';

  const phaseRows = phases.length === 0
    ? `<tr><td colspan="7">${emptyState('No positions to analyze')}</td></tr>`
    : phases.map(p => {
        const conf = Math.round((p.confidence || 0) * 100);
        const confBar = `<div class="conf-inline">
          <div class="conf-track"><div class="conf-fill" style="width:${conf}%"></div></div>
          <span class="conf-label">${conf}%</span>
        </div>`;
        const scoreVal = parseFloat(p.score || 0);
        return `<tr>
          <td class="coin-cell">${p.coin}</td>
          <td><span class="phase-badge phase-${p.phase}">${p.phase}</span></td>
          <td class="num">${confBar}</td>
          <td class="num ${scoreVal >= 0 ? 'pos' : 'neg'}" style="font-family:var(--mono)">${scoreVal > 0 ? '+' : ''}${scoreVal.toFixed(2)}</td>
          <td class="muted">${p.price_trend || '—'}</td>
          <td class="muted">${p.volume_trend || '—'}</td>
          <td class="muted" style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(p.signals || []).join('; ')}">${(p.signals || []).slice(0, 1).join('') || '—'}</td>
        </tr>`;
      }).join('');

  const keyHtml = `
    <div class="phase-legend">
      <span class="phase-badge phase-ACCUMULATION">Accumulation — quiet buying, tight range</span>
      <span class="phase-badge phase-MARKUP">Markup — uptrend with volume</span>
      <span class="phase-badge phase-DISTRIBUTION">Distribution — topping, smart money selling</span>
      <span class="phase-badge phase-MARKDOWN">Markdown — downtrend with volume</span>
      <span class="phase-badge phase-NEUTRAL">Neutral — no clear signal</span>
    </div>`;

  const historySection = `<div id="phase-history-body"><div class="loading"><div class="spinner"></div></div></div>`;

  document.getElementById('phases-content').innerHTML = `
    ${statStrip([
      {label: 'Positions Analyzed', value: phases.length},
      {label: 'Dominant Phase',     value: dominant ? dominant[0] : '—', sub: dominant ? dominant[1] + ' position(s)' : ''},
      {label: 'Avg Confidence',     value: avgConf},
      {label: 'Interval',           value: _phaseInterval.toUpperCase()},
    ])}

    <div class="filter-bar">
      ${['1h','4h','1d'].map(iv =>
        `<button class="chip${_phaseInterval === iv ? ' active' : ''}" onclick="setPhaseInterval('${iv}')">${iv}</button>`
      ).join('')}
      <div class="filter-sep"></div>
      <div id="phase-history-coin-bar" style="display:contents">
        <button class="chip active" onclick="setPhaseHistoryCoin('',this)">All coins</button>
        <button class="chip" onclick="setPhaseHistoryCoin('BTC',this)">BTC</button>
        <button class="chip" onclick="setPhaseHistoryCoin('ETH',this)">ETH</button>
        <button class="chip" onclick="setPhaseHistoryCoin('SOL',this)">SOL</button>
        <button class="chip" onclick="setPhaseHistoryCoin('HYPE',this)">HYPE</button>
        <button class="chip" onclick="setPhaseHistoryCoin('SUI',this)">SUI</button>
      </div>
      <div class="filter-sep"></div>
      <a class="chip" href="${API}/api/phase/history/export" download="phase_log.csv">⬇ CSV</a>
    </div>

    <div class="table-wrap">
      <div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface)">
        <span style="font-size:13px;font-weight:600;color:var(--text)">Current Phases</span>
      </div>
      <table>
        <thead><tr>
          <th>Coin</th><th>Phase</th>
          <th class="num">Confidence</th><th class="num">Score</th>
          <th>Price Trend</th><th>Volume</th><th>Signal</th>
        </tr></thead>
        <tbody>${phaseRows}</tbody>
      </table>
    </div>

    ${keyHtml}

    <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:13px;font-weight:600;color:var(--text)">Phase History <span class="muted" style="font-size:11px;font-weight:400">(14-day rolling, recorded hourly)</span></span>
      <button class="btn btn-ghost btn-sm" onclick="loadPhaseHistory()">↺ Refresh</button>
    </div>
    ${historySection}
  `;
}

let _phaseHistoryCoin = '';

function setPhaseInterval(iv) {
  _phaseInterval = iv;
  loadPhases();
}

function setPhaseHistoryCoin(coin, btn) {
  _phaseHistoryCoin = coin;
  document.querySelectorAll('#phase-history-coin-bar .chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadPhaseHistory();
}

async function loadPhaseHistory() {
  const el = document.getElementById('phase-history-body');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const coin = _phaseHistoryCoin;
    const url  = `${API}/api/phase/history${coin ? `?coin=${coin}` : ''}`;
    const data = await fetch(url).then(r => r.json());
    const rows = data.rows || [];

    if (!rows.length) {
      el.innerHTML = '<div class="loading" style="color:var(--text-muted)">No history yet — recordings start automatically every hour.</div>';
      return;
    }

    const stats = buildPhaseDurationStats(rows);
    const LABELS = {ACCUMULATION:'Accumulation',MARKUP:'Markup',DISTRIBUTION:'Distribution',MARKDOWN:'Markdown',NEUTRAL:'Neutral'};

    let statsHtml = '';
    if (Object.keys(stats).length) {
      statsHtml = `
        <div class="table-wrap" style="border-bottom:1px solid var(--border)">
          <div style="padding:8px 16px;background:var(--surface2);border-bottom:1px solid var(--border)">
            <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted)">Duration Stats</span>
          </div>
          <table>
            <thead><tr>
              <th>Phase</th>
              <th class="num">Runs</th><th class="num">Min</th><th class="num">Median</th>
              <th class="num">P75</th><th class="num">Max</th><th class="num">Accuracy →</th>
            </tr></thead>
            <tbody>
              ${Object.entries(stats).map(([ph, s]) => `
                <tr>
                  <td><span class="phase-badge phase-${ph}">${LABELS[ph] || ph}</span></td>
                  <td class="num muted">${s.count}</td>
                  <td class="num muted">${fmtHours(s.min_h)}</td>
                  <td class="num" style="font-weight:600">${fmtHours(s.median_h)}</td>
                  <td class="num muted">${fmtHours(s.p75_h)}</td>
                  <td class="num muted">${fmtHours(s.max_h)}</td>
                  <td class="num muted">${s.accuracy_pct !== null ? `${s.accuracy_pct}% → ${s.expected_next || '?'}` : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

    const display = rows.slice(0, 200);
    const histTableHtml = `
      <div class="table-wrap" style="max-height:360px;overflow-y:auto">
        <table>
          <thead><tr>
            <th>Time</th><th>Coin</th><th>Phase</th>
            <th class="num">Conf</th><th class="num">Score</th><th class="num">Price</th>
          </tr></thead>
          <tbody>
            ${display.map(r => {
              const ph = r.phase;
              return `<tr>
                <td class="muted" style="font-family:var(--mono);font-size:12px">${r.timestamp.slice(0, 16)}</td>
                <td class="coin-cell">${r.coin}</td>
                <td><span class="phase-badge phase-${ph}" style="font-size:10px;padding:1px 6px">${LABELS[ph] || ph}</span></td>
                <td class="num muted">${Math.round(r.confidence * 100)}%</td>
                <td class="num ${parseFloat(r.score) >= 0 ? 'pos' : 'neg'}">${parseFloat(r.score) > 0 ? '+' : ''}${r.score}</td>
                <td class="num" style="font-family:var(--mono)">${r.price ? parseFloat(r.price).toLocaleString() : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > 200 ? `<div class="muted" style="font-size:11px;padding:8px 16px">Showing 200 of ${rows.length} rows — download CSV for full data</div>` : ''}`;

    el.innerHTML = statsHtml + histTableHtml;
  } catch(e) {
    el.innerHTML = `<div class="loading" style="color:var(--text-muted)">Error: ${e.message}</div>`;
  }
}

function fmtHours(h) {
  if (h == null) return '—';
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function buildPhaseDurationStats(rows) {
  const EXPECTED = {ACCUMULATION:'MARKUP',MARKUP:'DISTRIBUTION',DISTRIBUTION:'MARKDOWN',MARKDOWN:'ACCUMULATION'};
  const byCoin = {};
  for (const r of [...rows].reverse()) {
    if (!byCoin[r.coin]) byCoin[r.coin] = [];
    byCoin[r.coin].push(r);
  }

  const allRuns = [];
  for (const coinRows of Object.values(byCoin)) {
    let runPhase = coinRows[0].phase, runStart = coinRows[0].timestamp;
    for (let i = 1; i < coinRows.length; i++) {
      if (coinRows[i].phase !== runPhase) {
        allRuns.push({phase: runPhase, start: runStart, end: coinRows[i].timestamp,
                      duration_h: (new Date(coinRows[i].timestamp) - new Date(runStart)) / 3600000,
                      next_phase: coinRows[i].phase});
        runPhase = coinRows[i].phase; runStart = coinRows[i].timestamp;
      }
    }
  }

  const byPhase = {};
  for (const run of allRuns) {
    if (!byPhase[run.phase]) byPhase[run.phase] = [];
    byPhase[run.phase].push(run);
  }

  const stats = {};
  for (const [phase, runs] of Object.entries(byPhase)) {
    if (runs.length < 2) continue;
    const durs = runs.map(r => r.duration_h).sort((a, b) => a - b);
    const n = durs.length;
    const correct = runs.filter(r => r.next_phase === EXPECTED[phase]).length;
    stats[phase] = {
      count:        n,
      min_h:        durs[0],
      median_h:     durs[Math.floor(n / 2)],
      p75_h:        durs[Math.floor(n * 0.75)],
      max_h:        durs[n - 1],
      accuracy_pct: EXPECTED[phase] ? Math.round(correct / n * 100) : null,
      expected_next: EXPECTED[phase] || null,
    };
  }
  return stats;
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

async function loadWatchlist() {
  const el = document.getElementById('watchlist-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading watchlist…</div>';
  try {
    const data = await fetch(`${API}/api/watchlist`).then(r => r.json());
    const rows = data.wallets.length === 0
      ? `<tr><td colspan="6">${emptyState('No wallets in watchlist')}</td></tr>`
      : data.wallets.map(w => walletRow(w)).join('');

    el.innerHTML = `
      <div class="add-bar">
        <input class="input" id="add-addr" placeholder="0x… wallet address" style="max-width:360px">
        <input class="input" id="add-label" placeholder="Label (optional)" style="max-width:200px">
        <button class="btn btn-primary btn-sm" onclick="addWallet()">Add Wallet</button>
      </div>
      <div class="table-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface)">
          <span style="font-size:13px;font-weight:600;color:var(--text)">Tracked Wallets</span>
          <span class="muted" style="font-size:12px">${data.wallets.length} wallet${data.wallets.length !== 1 ? 's' : ''}</span>
        </div>
        <table>
          <thead><tr>
            <th>Label</th><th>Address</th>
            <th class="num">Account Value</th><th class="num">Positions</th>
            <th>Coins</th><th class="num">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function walletRow(w) {
  const snap = w.snapshot || {};
  const summary = snap.summary || {};
  const positions = snap.positions || [];
  const isPrimary = w.address.toLowerCase() === PRIMARY_WALLET.toLowerCase();
  return `
    <tr>
      <td class="coin-cell">
        ${w.label}
        ${isPrimary ? '<span style="margin-left:6px;font-size:10px;background:var(--blue-bg);color:var(--blue);padding:1px 6px;border-radius:var(--radius-pill);font-weight:600">PRIMARY</span>' : ''}
      </td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${w.address.slice(0, 6)}…${w.address.slice(-4)}</td>
      <td class="num">${fmt$(summary.account_value || 0)}</td>
      <td class="num muted">${positions.length}</td>
      <td class="muted" style="font-size:12px">${(snap.coins || []).slice(0, 5).join(', ') || '—'}</td>
      <td class="num">
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="refreshWallet('${w.address}')">↺</button>
          ${!isPrimary ? `<button class="btn btn-danger btn-sm" onclick="removeWallet('${w.address}')">✕</button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

async function addWallet() {
  const addr  = document.getElementById('add-addr').value.trim();
  const label = document.getElementById('add-label').value.trim();
  if (!addr) return;
  try {
    await fetch(`${API}/api/watchlist`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({address: addr, label}) });
    loadWatchlist();
  } catch(e) { alert('Error: ' + e.message); }
}

async function removeWallet(addr) {
  if (!confirm('Remove this wallet from watchlist?')) return;
  await fetch(`${API}/api/watchlist/${addr}`, { method: 'DELETE' });
  loadWatchlist();
}

async function refreshWallet(addr) {
  try {
    await fetch(`${API}/api/watchlist/${addr}/snapshot`).then(r => r.json());
    loadWatchlist();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const el = document.getElementById('settings-content');
  const [tgStatus, waStatus] = await Promise.all([
    fetch(`${API}/api/telegram/status`).then(r => r.json()),
    fetch(`${API}/api/whatsapp/status`).then(r => r.json()).catch(() => ({enabled: false, phone: ''})),
  ]);
  el.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Telegram Alerts</div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Status</div>
        </div>
        <div>
          <span class="tg-status ${tgStatus.enabled ? 'on' : 'off'}">${tgStatus.enabled ? '✓ Connected' : '✗ Not configured'}</span>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Bot Token</div>
          <div class="settings-row-desc">From @BotFather on Telegram</div>
        </div>
        <input class="input" id="tg-token" placeholder="1234567890:ABCDef…" type="password">
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Chat ID</div>
          <div class="settings-row-desc">Your chat or channel ID</div>
        </div>
        <input class="input" id="tg-chat" placeholder="-100xxxxxxxxx or @username">
      </div>
      <div class="settings-row">
        <div></div>
        <div>
          <button class="btn btn-primary btn-sm" onclick="saveTelegram()">Save & Test</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">WhatsApp Alerts (CallMeBot)</div>
      <div class="settings-row">
        <div><div class="settings-row-label">Status</div></div>
        <div><span class="tg-status ${waStatus.enabled ? 'on' : 'off'}">${waStatus.enabled ? '✓ Connected · ' + waStatus.phone : '✗ Not configured'}</span></div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Setup</div>
          <div class="settings-row-desc">Add +34 644 59 78 53 on WhatsApp, then send:<br><code style="font-size:11px">I allow callmebot to send me messages</code></div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);padding-top:8px">You'll receive your API key by WhatsApp within seconds</div>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">Your Phone</div><div class="settings-row-desc">International format</div></div>
        <input class="input" id="wa-phone" placeholder="+1234567890" value="${waStatus.phone||''}">
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">API Key</div><div class="settings-row-desc">Received from CallMeBot</div></div>
        <input class="input" id="wa-key" placeholder="1234567" type="password">
      </div>
      <div class="settings-row">
        <div></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="saveWhatsApp()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="testWhatsApp()">Send Test</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Primary Wallet</div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Address</div>
          <div class="settings-row-desc">Set via PRIMARY_WALLET in .env</div>
        </div>
        <div style="font-family:var(--mono);font-size:12px;color:var(--text-muted);padding-top:8px;word-break:break-all">${PRIMARY_WALLET}</div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">App Info</div>
      <div class="settings-row">
        <div><div class="settings-row-label">Version</div></div>
        <div style="padding-top:8px;color:var(--text-muted);font-size:13px">Hype Trade Analyzer v2</div>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">Connection</div></div>
        <div style="padding-top:8px;font-size:13px" id="settings-ws-status">${ws && ws.readyState === 1 ? '<span class="pos">Connected</span>' : '<span class="neg">Disconnected</span>'}</div>
      </div>
    </div>
  `;
}

async function saveTelegram() {
  const token = document.getElementById('tg-token').value.trim();
  const chat  = document.getElementById('tg-chat').value.trim();
  if (!token || !chat) { alert('Enter both bot token and chat ID'); return; }
  try {
    const res  = await fetch(`${API}/api/telegram/configure`, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({bot_token: token, chat_id: chat})});
    const data = await res.json();
    if (data.configured) { alert('Telegram configured!'); loadSettings(); }
  } catch(e) { alert('Error: ' + e.message); }
}

async function saveWhatsApp() {
  const phone = document.getElementById('wa-phone')?.value?.trim();
  const key   = document.getElementById('wa-key')?.value?.trim();
  if (!phone || !key) { alert('Enter phone and API key'); return; }
  const res  = await fetch(`${API}/api/whatsapp/configure`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({phone, apikey: key})});
  const data = await res.json();
  if (data.configured) { alert('WhatsApp saved!'); loadSettings(); }
}

async function testWhatsApp() {
  const res  = await fetch(`${API}/api/whatsapp/test`, {method:'POST'}).then(r => r.json());
  alert(res.ok ? '✅ Test message sent!' : `❌ Failed: ${res.status}`);
}

// ── Notifications ─────────────────────────────────────────────────────────────

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) loadNotifications();
}

async function loadNotifications() {
  const el   = document.getElementById('notif-list');
  const data = await fetch(`${API}/api/notifications`).then(r => r.json());
  const notifs = data.notifications;
  updateNotifBadge(notifs.filter(n => !n.read).length);
  if (notifs.length === 0) {
    el.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead(${n.id})">
      <div class="notif-type">${n.type}</div>
      <div class="notif-msg">${n.message}</div>
      <div class="notif-time">${fmtTime(n.time * 1000)}</div>
    </div>
  `).join('');
}

function addNotification(notif) {
  const panel = document.getElementById('notif-panel');
  if (panel.classList.contains('open')) loadNotifications();
  const current = parseInt(document.getElementById('notif-count').textContent || '0');
  updateNotifBadge(current + 1);
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-count');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

async function markRead(id) {
  await fetch(`${API}/api/notifications/${id}/read`, {method: 'POST'});
  loadNotifications();
}

async function markAllRead() {
  await fetch(`${API}/api/notifications/read-all`, {method: 'POST'});
  loadNotifications();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n === undefined || n === null) return '—';
  const abs  = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + abs.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return sign + '$' + abs.toFixed(2);
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}

// ── AI Knowledge Base ─────────────────────────────────────────────────────────

let _aiSubTab = 'chat';
let _chatHistory = [];
let _kbStats = null;

async function loadAI() {
  const el = document.getElementById('ai-content');
  try {
    _kbStats = await fetch(`${API}/api/kb/stats`).then(r => r.json());
  } catch(e) { _kbStats = null; }
  renderAIShell();
  if (_aiSubTab === 'chat')  renderChatTab();
  if (_aiSubTab === 'graph') loadGraph();
  if (_aiSubTab === 'wiki')  loadWiki();
  if (_aiSubTab === 'notes') loadNotes();
}

function renderAIShell() {
  const s = _kbStats;
  const docs  = s ? s.total_documents : '—';
  const code  = s ? (s.by_type?.code || 0) : '—';
  const fns   = s ? (s.by_type?.function || 0) : '—';
  const market= s ? (s.by_type?.market_data || 0) : '—';
  const idxAt = s?.indexed_at ? new Date(s.indexed_at * 1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  document.getElementById('ai-content').innerHTML = `
    ${statStrip([
      {label: 'Documents', value: docs, sub: `${code} files · ${fns} functions`},
      {label: 'Market Snapshots', value: market, sub: 'auto-collected hourly'},
      {label: 'Notes', value: s?.notes ?? '—', sub: 'custom research'},
      {label: 'Last Indexed', value: idxAt || '—'},
    ])}

    <div class="filter-bar" style="justify-content:space-between">
      <div style="display:flex;gap:6px">
        ${['chat','graph','wiki','notes'].map(t =>
          `<button class="chip${_aiSubTab===t?' active':''}" onclick="setAITab('${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
        ).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="reindexKB()">↺ Re-index</button>
    </div>

    <div id="ai-sub-content"></div>
  `;
}

function setAITab(tab) {
  _aiSubTab = tab;
  renderAIShell();
  if (tab === 'chat')  renderChatTab();
  if (tab === 'graph') loadGraph();
  if (tab === 'wiki')  loadWiki();
  if (tab === 'notes') loadNotes();
}

async function reindexKB() {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Indexing…';
  try {
    _kbStats = await fetch(`${API}/api/kb/index`, {method:'POST'}).then(r => r.json());
    renderAIShell();
    if (_aiSubTab === 'chat')  renderChatTab();
  } finally {
    btn.disabled = false;
  }
}

// ── Chat sub-tab ──────────────────────────────────────────────────────────────

function renderChatTab() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;

  const historyHtml = _chatHistory.length === 0
    ? `<div class="chat-empty">Ask anything about the codebase, market data, or trading history.</div>`
    : _chatHistory.map(m => m.role === 'user'
        ? `<div class="chat-bubble user">${escHtml(m.content)}</div>`
        : `<div class="chat-bubble assistant">
            <div class="chat-answer">${markdownToHtml(m.content)}</div>
            ${m.sources?.length ? `<div class="chat-sources">
              <div class="chat-sources-label">Sources</div>
              ${m.sources.map(s => `
                <div class="chat-source">
                  <span class="chat-source-type">${s.type}</span>
                  <span class="chat-source-title">${escHtml(s.title)}</span>
                  <span class="chat-source-score">score ${s.score}</span>
                </div>`).join('')}
            </div>` : ''}
            ${m.powered_by ? `<div class="chat-powered-by">powered by ${m.powered_by}</div>` : ''}
           </div>`
      ).join('');

  el.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-history" id="chat-history">${historyHtml}</div>
      <div class="chat-input-row">
        <input class="input chat-input" id="chat-input" placeholder="Ask about the code, MVRV, phases, trades…" onkeydown="if(event.key==='Enter')sendChat()">
        <button class="btn btn-primary" onclick="sendChat()">Send</button>
        ${_chatHistory.length ? `<button class="btn btn-ghost btn-sm" onclick="clearChat()">Clear</button>` : ''}
      </div>
    </div>
  `;
  const h = document.getElementById('chat-history');
  if (h) h.scrollTop = h.scrollHeight;
  document.getElementById('chat-input')?.focus();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const q = input?.value?.trim();
  if (!q) return;
  input.value = '';
  input.disabled = true;

  _chatHistory.push({role:'user', content: q});
  renderChatTab();

  try {
    const res = await fetch(`${API}/api/kb/ask`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({question: q}),
    }).then(r => r.json());
    _chatHistory.push({role:'assistant', content: res.answer, sources: res.sources, powered_by: res.powered_by});
  } catch(e) {
    _chatHistory.push({role:'assistant', content: `Error: ${e.message}`});
  }
  renderChatTab();
}

function clearChat() {
  _chatHistory = [];
  renderChatTab();
}

// ── Graph sub-tab ─────────────────────────────────────────────────────────────

async function loadGraph() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Building knowledge graph…</div>';
  try {
    const data = await fetch(`${API}/api/kb/graph`).then(r => r.json());
    renderGraph(data);
  } catch(e) {
    el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

const TYPE_COLORS = {
  file:     '#38bdf8',
  function: '#818cf8',
  coin:     '#4ade80',
  phase:    '#fbbf24',
  note:     '#fb923c',
};
const TYPE_RADIUS = { file:10, function:6, coin:14, phase:9, note:8 };

function renderGraph(data) {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const W = el.clientWidth || 900, H = 560;

  const nodes = data.nodes.map(n => ({
    ...n,
    x: W/2 + (Math.random()-0.5)*W*0.7,
    y: H/2 + (Math.random()-0.5)*H*0.7,
    vx: 0, vy: 0,
  }));
  const idMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const links = data.links.filter(l => idMap[l.source] && idMap[l.target]);

  // Simple force simulation
  const k = Math.sqrt(W * H / Math.max(nodes.length, 1)) * 0.9;
  for (let iter = 0; iter < 120; iter++) {
    for (const n of nodes) { n.fx = 0; n.fy = 0; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x || 0.1;
        const dy = nodes[i].y - nodes[j].y || 0.1;
        const d  = Math.sqrt(dx*dx+dy*dy) || 1;
        const f  = (k*k) / d;
        nodes[i].fx += dx/d*f; nodes[i].fy += dy/d*f;
        nodes[j].fx -= dx/d*f; nodes[j].fy -= dy/d*f;
      }
    }
    for (const l of links) {
      const s = idMap[l.source], t = idMap[l.target];
      if (!s||!t) continue;
      const dx=t.x-s.x, dy=t.y-s.y, d=Math.sqrt(dx*dx+dy*dy)||1;
      const f=(d*d)/k*0.08;
      s.fx+=dx/d*f; s.fy+=dy/d*f; t.fx-=dx/d*f; t.fy-=dy/d*f;
    }
    const cx=W/2, cy=H/2;
    for (const n of nodes) {
      n.fx+=(cx-n.x)*0.015; n.fy+=(cy-n.y)*0.015;
      n.vx=(n.vx+n.fx)*0.8; n.vy=(n.vy+n.fy)*0.8;
      n.x=Math.max(18,Math.min(W-18,n.x+n.vx));
      n.y=Math.max(18,Math.min(H-18,n.y+n.vy));
    }
  }

  const edgeSvg = links.map(l => {
    const s=idMap[l.source], t=idMap[l.target];
    if(!s||!t) return '';
    return `<line x1="${s.x.toFixed(0)}" y1="${s.y.toFixed(0)}" x2="${t.x.toFixed(0)}" y2="${t.y.toFixed(0)}" stroke="#383838" stroke-width="1" opacity="0.6"/>`;
  }).join('');

  const nodeSvg = nodes.map(n => {
    const c = TYPE_COLORS[n.type]||'#6b7280';
    const r = TYPE_RADIUS[n.type]||6;
    const lbl = (n.label||'').length > 12 ? n.label.slice(0,11)+'…' : n.label;
    return `<g class="kgraph-node" data-id="${escHtml(n.id)}" data-type="${n.type}" onclick="kgraphClick(this)" style="cursor:pointer">
      <circle cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="${r}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"/>
      <text x="${n.x.toFixed(0)}" y="${(n.y+r+9).toFixed(0)}" fill="#6b7280" font-size="8.5" text-anchor="middle" font-family="monospace">${escHtml(lbl)}</text>
    </g>`;
  }).join('');

  const legend = Object.entries(TYPE_COLORS).map(([t,c]) =>
    `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">
      <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="1.5"/></svg>${t}
    </div>`
  ).join('');

  el.innerHTML = `
    <div style="background:var(--surface);border-bottom:1px solid var(--border)">
      <svg id="kgraph-svg" width="${W}" height="${H}" style="display:block">
        <g id="kg-edges">${edgeSvg}</g>
        <g id="kg-nodes">${nodeSvg}</g>
      </svg>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border)">
      ${legend}
      <span style="margin-left:auto;font-size:11px;color:var(--text-faint)">${nodes.length} nodes · ${links.length} links</span>
    </div>
    <div id="kgraph-detail" style="padding:12px 16px;background:var(--surface2);min-height:40px;font-size:12px;color:var(--text-muted)">Click a node to see details</div>
  `;
}

function kgraphClick(el) {
  const id   = el.dataset.id;
  const type = el.dataset.type;
  const lbl  = el.querySelector('text')?.textContent || id;
  document.getElementById('kgraph-detail').innerHTML =
    `<strong style="color:var(--text)">${lbl}</strong>
     <span class="chat-source-type" style="margin-left:8px">${type}</span>
     <span style="color:var(--text-faint);margin-left:8px;font-size:11px">${id}</span>`;
}

// ── Wiki sub-tab ──────────────────────────────────────────────────────────────

let _wikiData = null;
let _wikiFilter = '';

async function loadWiki() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Generating wiki…</div>';
  try {
    const data = await fetch(`${API}/api/kb/wiki`).then(r => r.json());
    _wikiData = data.wiki;
    renderWiki();
  } catch(e) {
    el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function renderWiki() {
  const el = document.getElementById('ai-sub-content');
  if (!el || !_wikiData) return;
  const q = _wikiFilter.toLowerCase();
  const filtered = _wikiData.filter(f =>
    !q || f.filename.toLowerCase().includes(q) ||
    f.entries.some(e => e.name.toLowerCase().includes(q))
  );

  el.innerHTML = `
    <div class="filter-bar">
      <input class="input" style="max-width:280px;padding:4px 10px;font-size:12px"
        placeholder="Filter files or functions…" value="${escHtml(_wikiFilter)}"
        oninput="setWikiFilter(this.value)">
      <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">${filtered.length} files</span>
    </div>
    <div class="wiki-list">
      ${filtered.map((f, fi) => `
        <div class="wiki-file">
          <div class="wiki-file-header" onclick="toggleWikiFile(${fi})">
            <div>
              <span class="wiki-filename">${escHtml(f.filename)}</span>
              <span class="wiki-lang">${f.language}</span>
              <span class="wiki-path">${escHtml(f.path)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:var(--text-faint)">${f.entries.length} symbols</span>
              <span class="wiki-chevron" id="wiki-chev-${fi}">▶</span>
            </div>
          </div>
          <div class="wiki-entries" id="wiki-entries-${fi}" style="display:none">
            ${f.entries.length === 0
              ? '<div style="padding:8px 16px;font-size:12px;color:var(--text-faint)">No symbols extracted</div>'
              : f.entries.map(e => `
                <div class="wiki-entry">
                  <span class="wiki-entry-type ${e.type}">${e.type}</span>
                  <span class="wiki-entry-name">${escHtml(e.name)}</span>
                  <span class="wiki-entry-line">L${e.line}</span>
                  <pre class="wiki-snippet">${escHtml(e.snippet)}</pre>
                </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  `;
}

function toggleWikiFile(fi) {
  const entries = document.getElementById(`wiki-entries-${fi}`);
  const chev    = document.getElementById(`wiki-chev-${fi}`);
  if (!entries) return;
  const open = entries.style.display !== 'none';
  entries.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▶' : '▼';
}

function setWikiFilter(val) {
  _wikiFilter = val;
  renderWiki();
}

// ── Notes sub-tab ─────────────────────────────────────────────────────────────

let _notesData = [];

async function loadNotes() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  try {
    const data = await fetch(`${API}/api/kb/notes`).then(r => r.json());
    _notesData = data.notes;
    renderNotes();
  } catch(e) {
    el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function renderNotes() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const rows = _notesData.length === 0
    ? '<div class="chat-empty">No notes yet. Add your first research note below.</div>'
    : _notesData.map(n => `
        <div class="note-card">
          <div class="note-header">
            <strong class="note-title">${escHtml(n.title)}</strong>
            <span style="font-size:10px;color:var(--text-faint)">${n.metadata?.created || ''}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteNote('${escHtml(n.id)}')">✕</button>
          </div>
          <div class="note-body">${escHtml(n.content)}</div>
        </div>`).join('');

  el.innerHTML = `
    <div class="notes-wrap">
      <div class="note-add">
        <input class="input" id="note-title" placeholder="Title (e.g. BTC thesis)" style="max-width:280px">
        <textarea class="input note-textarea" id="note-content" placeholder="Your research notes, strategy, observations…" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="addNote()">Add Note</button>
      </div>
      <div class="notes-list">${rows}</div>
    </div>
  `;
}

async function addNote() {
  const title   = document.getElementById('note-title')?.value?.trim();
  const content = document.getElementById('note-content')?.value?.trim();
  if (!title || !content) return;
  await fetch(`${API}/api/kb/notes`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({title, content}),
  });
  await loadNotes();
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await fetch(`${API}/api/kb/notes/${encodeURIComponent(id)}`, {method:'DELETE'});
  await loadNotes();
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function markdownToHtml(md) {
  return String(md||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\n/g,'<br>');
}

// ── MVRV Monitor ─────────────────────────────────────────────────────────────

const MVRV_ZONE_META = {
  OVERHEATED:  { label: 'Overheated',  cls: 'mvrv-zone-hot',     color: 'var(--red)',    desc: 'Price well above 90d avg — elevated risk' },
  BULLISH:     { label: 'Bullish',     cls: 'mvrv-zone-bull',    color: 'var(--yellow)', desc: 'Above average — uptrend, watch for reversal' },
  NEUTRAL:     { label: 'Neutral',     cls: 'mvrv-zone-neutral', color: 'var(--text-muted)', desc: 'Near 90d avg — fair value range' },
  UNDERVALUED: { label: 'Undervalued', cls: 'mvrv-zone-under',   color: 'var(--green)',  desc: 'Below 90d avg — potential accumulation zone' },
};

const COIN_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', HYPE: 'Hyperliquid' };

let _mvrvData = null;

async function loadMVRV() {
  const el = document.getElementById('mvrv-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Fetching MVRV data…</div>';
  try {
    const data = await fetch(`${API}/api/mvrv`).then(r => r.json());
    _mvrvData = data;
    renderMVRV(data);
  } catch(e) {
    el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function mvrvSparkline(chart) {
  if (!chart || chart.length < 2) return '<span class="muted" style="font-size:11px">—</span>';
  const vals = chart.map(p => p.v);
  const W = 120, H = 36, pad = 3;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.01;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = vals[vals.length - 1];
  const first = vals[0];
  const color = last >= first ? 'var(--green)' : 'var(--red)';
  // baseline at MVRV=1
  const baseY = pad + (1 - (1 - min) / range) * (H - pad * 2);
  const baseClipped = Math.max(pad, Math.min(H - pad, baseY));
  return `<svg width="${W}" height="${H}" style="display:block">
    <line x1="${pad}" y1="${baseClipped.toFixed(1)}" x2="${W - pad}" y2="${baseClipped.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3,3"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderMVRV(data) {
  const coins = data.coins || {};
  const ORDER = ['BTC', 'ETH', 'SOL', 'HYPE'];

  const stripCells = ORDER.map(sym => {
    const c = coins[sym];
    if (!c) return { label: sym, value: '—' };
    const meta = MVRV_ZONE_META[c.zone] || MVRV_ZONE_META.NEUTRAL;
    return {
      label: sym,
      value: `<span style="color:${meta.color}">${c.mvrv.toFixed(3)}</span>`,
      sub: meta.label,
    };
  });

  const cards = ORDER.map(sym => {
    const c = coins[sym];
    if (!c) return `<div class="mvrv-card"><div class="muted">No data for ${sym}</div></div>`;
    const meta = MVRV_ZONE_META[c.zone] || MVRV_ZONE_META.NEUTRAL;
    const chg = c.change_24h;
    const chgCls = chg >= 0 ? 'pos' : 'neg';
    const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    const mcStr = c.market_cap >= 1e9
      ? '$' + (c.market_cap / 1e9).toFixed(2) + 'B'
      : c.market_cap >= 1e6 ? '$' + (c.market_cap / 1e6).toFixed(0) + 'M' : '—';

    return `
      <div class="mvrv-card">
        <div class="mvrv-card-header">
          <div>
            <div class="mvrv-coin">${sym}</div>
            <div class="mvrv-coin-name">${COIN_NAMES[sym] || sym}</div>
          </div>
          <span class="mvrv-zone-badge ${meta.cls}">${meta.label}</span>
        </div>

        <div class="mvrv-ratio" style="color:${meta.color}">${c.mvrv.toFixed(3)}</div>
        <div class="mvrv-ratio-label">MVRV Ratio</div>

        <div class="mvrv-sparkline">${mvrvSparkline(c.chart)}</div>

        <div class="mvrv-stats">
          <div class="mvrv-stat">
            <div class="mvrv-stat-label">Price</div>
            <div class="mvrv-stat-val">${fmt$(c.price)}</div>
          </div>
          <div class="mvrv-stat">
            <div class="mvrv-stat-label">24h</div>
            <div class="mvrv-stat-val ${chgCls}">${chgStr}</div>
          </div>
          <div class="mvrv-stat">
            <div class="mvrv-stat-label">90d Avg</div>
            <div class="mvrv-stat-val">${fmt$(c.avg_90d)}</div>
          </div>
          <div class="mvrv-stat">
            <div class="mvrv-stat-label">Mkt Cap</div>
            <div class="mvrv-stat-val">${mcStr}</div>
          </div>
        </div>

        <div class="mvrv-desc">${meta.desc}</div>
      </div>`;
  }).join('');

  const updatedStr = data.updated
    ? new Date(data.updated * 1000).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})
    : '—';

  document.getElementById('mvrv-content').innerHTML = `
    ${statStrip(stripCells)}

    <div class="filter-bar" style="justify-content:space-between">
      <span style="font-size:12px;color:var(--text-muted)">Source: ${data.source || 'CoinGecko'}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--text-faint)">Updated ${updatedStr}</span>
        <button class="btn btn-ghost btn-sm" onclick="loadMVRV()">↺ Refresh</button>
      </div>
    </div>

    <div class="mvrv-grid">${cards}</div>

    <div class="mvrv-legend">
      ${Object.entries(MVRV_ZONE_META).map(([k, m]) =>
        `<div class="mvrv-legend-item">
          <span class="mvrv-zone-badge ${m.cls}">${m.label}</span>
          <span class="mvrv-legend-desc">${m.desc}</span>
        </div>`
      ).join('')}
      <div class="mvrv-legend-item" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;grid-column:1/-1">
        <span style="font-size:11px;color:var(--text-faint)">
          ⓘ Approx MVRV = Current Price ÷ 90-day rolling average price. Not the true on-chain realized cap. Chart shows 30-day rolling window MVRV.
        </span>
      </div>
    </div>
  `;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectWS();
  navigate('overview');
  setInterval(() => {
    const panel = document.getElementById('notif-panel');
    if (!panel.classList.contains('open')) {
      fetch(`${API}/api/notifications`).then(r => r.json()).then(d => {
        updateNotifBadge(d.notifications.filter(n => !n.read).length);
      });
    }
  }, 60000);
});

document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const btn   = document.getElementById('notif-toggle-btn');
  if (!panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});
