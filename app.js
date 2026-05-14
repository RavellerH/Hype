// ── Config ────────────────────────────────────────────────────────────────────
const HL = 'https://api.hyperliquid.xyz/info';
const DEFAULT_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';
let currentWallet = localStorage.getItem('hype_wallet') || DEFAULT_WALLET;
let autoRefreshTimer = null;
let currentPage = 'overview';

// ── Hyperliquid API ───────────────────────────────────────────────────────────
async function hlPost(payload) {
  const r = await fetch(HL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`HL API ${r.status}`);
  return r.json();
}

async function getClearinghouseState(wallet) {
  return hlPost({ type: 'clearinghouseState', user: wallet });
}
async function getUserFills(wallet) {
  return hlPost({ type: 'userFills', user: wallet });
}
async function getUserFunding(wallet, daysBack = 30) {
  const startTime = Date.now() - daysBack * 86400000;
  return hlPost({ type: 'userFunding', user: wallet, startTime });
}
async function getLedgerUpdates(wallet, daysBack = 90) {
  const startTime = Date.now() - daysBack * 86400000;
  return hlPost({ type: 'userNonFundingLedgerUpdates', user: wallet, startTime });
}
async function getCandles(coin, interval = '1h', daysBack = 7) {
  const endTime = Date.now();
  const startTime = endTime - daysBack * 86400000;
  return hlPost({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } });
}
async function getOpenOrders(wallet) {
  return hlPost({ type: 'openOrders', user: wallet });
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function parsePositions(state) {
  const positions = [];
  for (const pos of (state.assetPositions || [])) {
    const p = pos.position || {};
    const szi = parseFloat(p.szi || 0);
    if (szi === 0) continue;
    const lev = p.leverage || {};
    positions.push({
      coin: p.coin,
      side: szi > 0 ? 'long' : 'short',
      size: Math.abs(szi),
      entry_price: parseFloat(p.entryPx || 0),
      unrealized_pnl: parseFloat(p.unrealizedPnl || 0),
      leverage_type: lev.type || 'cross',
      leverage_value: lev.value || 1,
      liquidation_price: parseFloat(p.liquidationPx || 0),
      margin_used: parseFloat(p.marginUsed || 0),
      position_value: parseFloat(p.positionValue || 0),
      cum_funding: parseFloat((p.cumFunding || {}).sinceOpen || 0),
    });
  }
  return positions;
}

function parseAccountSummary(state) {
  const m = state.marginSummary || {};
  return {
    account_value: parseFloat(m.accountValue || 0),
    total_margin_used: parseFloat(m.totalMarginUsed || 0),
    total_ntl_pos: parseFloat(m.totalNtlPos || 0),
    withdrawable: parseFloat(state.withdrawable || 0),
  };
}

function parseFills(fills) {
  return (fills || []).map(f => ({
    time: f.time,
    coin: f.coin,
    side: f.side,
    price: parseFloat(f.px || 0),
    size: parseFloat(f.sz || 0),
    fee: parseFloat(f.fee || 0),
    closed_pnl: parseFloat(f.closedPnl || 0),
  })).sort((a, b) => b.time - a.time);
}

function parseFunding(funding) {
  return (funding || []).map(f => ({
    time: f.time,
    coin: (f.delta || {}).coin,
    funding_rate: parseFloat((f.delta || {}).fundingRate || 0),
    usdc: parseFloat((f.delta || {}).usdc || 0),
  })).sort((a, b) => b.time - a.time);
}

function parseLedger(ledger) {
  return (ledger || []).map(e => {
    const d = e.delta || {};
    const usdc = parseFloat(d.usdc || 0);
    return {
      time: e.time,
      type: d.type || '',
      usdc,
      direction: usdc >= 0 ? 'inflow' : 'outflow',
      hash: d.hash || '',
    };
  }).sort((a, b) => b.time - a.time);
}

// ── Phase Detector (Wyckoff) ──────────────────────────────────────────────────
function detectPhase(candles) {
  if (!candles || candles.length < 10) {
    return { phase: 'NEUTRAL', confidence: 0, price_trend: 'flat', volume_trend: 'neutral', range_compression: false, signals: ['Not enough data'], score: 0 };
  }
  const closes = candles.map(c => parseFloat(c.c));
  const volumes = candles.map(c => parseFloat(c.v));
  const highs = candles.map(c => parseFloat(c.h));
  const lows = candles.map(c => parseFloat(c.l));
  const n = candles.length;
  const half = Math.floor(n / 2);
  const qtr = Math.max(Math.floor(n / 4), 1);

  const earlyClose = closes.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const lateClose = closes.slice(half).reduce((a, b) => a + b, 0) / (n - half);
  const priceChangePct = earlyClose ? (lateClose - earlyClose) / earlyClose : 0;
  const price_trend = priceChangePct > 0.03 ? 'up' : priceChangePct < -0.03 ? 'down' : 'flat';

  const earlyVol = volumes.slice(0, qtr).reduce((a, b) => a + b, 0) / qtr;
  const lateVol = volumes.slice(-qtr).reduce((a, b) => a + b, 0) / qtr;
  const volChangePct = earlyVol ? (lateVol - earlyVol) / earlyVol : 0;
  const volume_trend = volChangePct > 0.2 ? 'expanding' : volChangePct < -0.2 ? 'contracting' : 'neutral';

  const fullRange = Math.max(...highs) - Math.min(...lows) || 1;
  const recentRange = Math.max(...highs.slice(-qtr)) - Math.min(...lows.slice(-qtr));
  const range_compression = (recentRange / fullRange) < 0.35;

  const signals = [];
  let score = 0;

  if (price_trend === 'up') { score += 0.3; signals.push('Price trending up'); }
  else if (price_trend === 'down') { score -= 0.3; signals.push('Price trending down'); }
  else { signals.push('Price flat / sideways'); }

  if (price_trend === 'flat' && volume_trend === 'contracting' && range_compression) {
    score += 0.4; signals.push('Tight range + low volume → possible accumulation');
  } else if (price_trend === 'up' && volume_trend === 'expanding') {
    score += 0.35; signals.push('Price up + volume expanding → markup/breakout');
  } else if (price_trend === 'flat' && volume_trend === 'expanding') {
    score -= 0.15; signals.push('Flat price + rising volume → possible absorption or distribution');
  } else if (price_trend === 'down' && volume_trend === 'expanding') {
    score -= 0.4; signals.push('Price down + volume expanding → markdown/selling pressure');
  } else if (price_trend === 'down' && volume_trend === 'contracting') {
    score -= 0.2; signals.push('Price down + volume drying up → exhaustion');
  }

  if (range_compression) signals.push('Price range compressed (potential breakout setup)');

  const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(volumes.length - 1, 1);
  const lastVol = volumes[volumes.length - 1];
  if (lastVol > avgVol * 2) {
    signals.push(`Volume spike on last candle (${(lastVol / avgVol).toFixed(1)}x avg)`);
    score += closes[closes.length - 1] > closes[closes.length - 2] ? 0.1 : -0.1;
  }

  score = Math.max(-1, Math.min(1, score));
  const phase = score >= 0.55 ? 'MARKUP' : score >= 0.2 ? 'ACCUMULATION' : score <= -0.55 ? 'MARKDOWN' : score <= -0.2 ? 'DISTRIBUTION' : 'NEUTRAL';
  const confidence = Math.min(Math.abs(score) + 0.1 * Math.min(n / 50, 1), 1);

  return { phase, confidence: +confidence.toFixed(3), price_trend, volume_trend, range_compression, signals, score: +score.toFixed(4) };
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  currentPage = page;
  const loaders = { overview: loadOverview, trades: loadTrades, funding: loadFunding, flows: loadFlows, phases: loadPhases, watchlist: loadWatchlist };
  if (loaders[page]) loaders[page]();
}

function refreshAll() { navigate(currentPage); }

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  const el = document.getElementById('overview-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading positions…</div>';
  try {
    setStatus(true);
    const [state, orders] = await Promise.all([getClearinghouseState(currentWallet), getOpenOrders(currentWallet)]);
    const summary = parseAccountSummary(state);
    const positions = parsePositions(state);
    const totalUnrPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);
    el.innerHTML = `
      <div class="grid-4">
        <div class="stat-card">
          <div class="stat-label">Account Value</div>
          <div class="stat-value">${fmt$(summary.account_value)}</div>
          <div class="stat-sub">Withdrawable: ${fmt$(summary.withdrawable)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Notional</div>
          <div class="stat-value">${fmt$(summary.total_ntl_pos)}</div>
          <div class="stat-sub">Positions: ${positions.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Margin Used</div>
          <div class="stat-value">${fmt$(summary.total_margin_used)}</div>
          <div class="stat-sub">${summary.account_value > 0 ? ((summary.total_margin_used / summary.account_value) * 100).toFixed(1) : 0}% of account</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Unrealized PnL</div>
          <div class="stat-value ${totalUnrPnl >= 0 ? 'pos' : 'neg'}">${fmt$(totalUnrPnl)}</div>
          <div class="stat-sub">Across ${positions.length} position(s)</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Open Positions</div>
        ${positions.length === 0 ? '<div class="empty-state">No open positions</div>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Liq Price</th><th>Unr. PnL</th><th>Funding</th><th>Leverage</th></tr></thead>
          <tbody>
            ${positions.map(p => `<tr>
              <td class="accent">${p.coin}</td>
              <td><span class="side-badge ${p.side}">${p.side.toUpperCase()}</span></td>
              <td>${p.size}</td>
              <td>${fmt$(p.entry_price)}</td>
              <td class="${p.liquidation_price > 0 ? 'neg' : 'muted'}">${p.liquidation_price > 0 ? fmt$(p.liquidation_price) : '—'}</td>
              <td class="${p.unrealized_pnl >= 0 ? 'pos' : 'neg'}">${fmt$(p.unrealized_pnl)}</td>
              <td class="${p.cum_funding >= 0 ? 'pos' : 'neg'}">${p.cum_funding.toFixed(4)}</td>
              <td>${p.leverage_value}x ${p.leverage_type}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
      ${orders.length > 0 ? `
      <div class="card" style="margin-top:16px">
        <div class="card-title">Open Orders</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Coin</th><th>Side</th><th>Type</th><th>Size</th><th>Limit</th></tr></thead>
          <tbody>
            ${orders.map(o => `<tr>
              <td class="accent">${o.coin}</td>
              <td><span class="side-badge ${o.side === 'B' ? 'long' : 'short'}">${o.side === 'B' ? 'BUY' : 'SELL'}</span></td>
              <td class="muted">${o.orderType || '—'}</td>
              <td>${o.sz}</td>
              <td>${o.limitPx ? fmt$(parseFloat(o.limitPx)) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
    `;
    setRefreshTime();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; setStatus(false); }
}

// ── Trades ────────────────────────────────────────────────────────────────────
async function loadTrades() {
  const el = document.getElementById('trades-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading trades…</div>';
  try {
    const fills = parseFills(await getUserFills(currentWallet));
    const totalPnl = fills.reduce((a, f) => a + f.closed_pnl, 0);
    const totalFees = fills.reduce((a, f) => a + f.fee, 0);
    const wins = fills.filter(f => f.closed_pnl > 0).length;
    const losses = fills.filter(f => f.closed_pnl < 0).length;
    const wr = fills.length > 0 ? (wins / fills.length * 100).toFixed(1) : 0;
    el.innerHTML = `
      <div class="grid-4">
        <div class="stat-card"><div class="stat-label">Total Fills</div><div class="stat-value">${fills.length}</div></div>
        <div class="stat-card"><div class="stat-label">Realized PnL</div><div class="stat-value ${totalPnl >= 0 ? 'pos' : 'neg'}">${fmt$(totalPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${wr}%</div><div class="stat-sub">${wins}W / ${losses}L</div></div>
        <div class="stat-card"><div class="stat-label">Total Fees</div><div class="stat-value neg">−${fmt$(totalFees)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Fill History</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Price</th><th>Size</th><th>Fee</th><th>Closed PnL</th></tr></thead>
          <tbody>
            ${fills.slice(0, 200).map(f => `<tr>
              <td class="muted">${fmtTime(f.time)}</td>
              <td class="accent">${f.coin}</td>
              <td><span class="side-badge ${f.side === 'B' ? 'long' : 'short'}">${f.side === 'B' ? 'BUY' : 'SELL'}</span></td>
              <td>${fmt$(f.price)}</td>
              <td>${f.size}</td>
              <td class="neg">${f.fee.toFixed(4)}</td>
              <td class="${f.closed_pnl >= 0 ? 'pos' : 'neg'}">${f.closed_pnl !== 0 ? fmt$(f.closed_pnl) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
    setRefreshTime();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Funding ───────────────────────────────────────────────────────────────────
async function loadFunding() {
  const el = document.getElementById('funding-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading funding…</div>';
  try {
    const funding = parseFunding(await getUserFunding(currentWallet, 30));
    const totalUsdc = funding.reduce((a, f) => a + f.usdc, 0);
    const byCoin = {};
    for (const f of funding) { const c = f.coin || '?'; byCoin[c] = (byCoin[c] || 0) + f.usdc; }
    const coinRows = Object.entries(byCoin).sort((a, b) => a[1] - b[1]);
    el.innerHTML = `
      <div class="grid-3">
        <div class="stat-card"><div class="stat-label">Total Funding (30d)</div><div class="stat-value ${totalUsdc >= 0 ? 'pos' : 'neg'}">${fmt$(totalUsdc)}</div><div class="stat-sub">+ received, − paid</div></div>
        <div class="stat-card"><div class="stat-label">Most Costly</div><div class="stat-value accent">${coinRows[0]?.[0] || '—'}</div><div class="stat-sub">${coinRows[0] ? fmt$(coinRows[0][1]) : ''}</div></div>
        <div class="stat-card"><div class="stat-label">Coins Tracked</div><div class="stat-value">${coinRows.length}</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Funding by Coin</div>
          <div class="table-wrap"><table>
            <thead><tr><th>Coin</th><th>Total USDC</th></tr></thead>
            <tbody>${coinRows.map(([c, u]) => `<tr><td class="accent">${c}</td><td class="${u >= 0 ? 'pos' : 'neg'}">${fmt$(u)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-title">Recent Payments</div>
          <div class="table-wrap"><table>
            <thead><tr><th>Time</th><th>Coin</th><th>Rate</th><th>USDC</th></tr></thead>
            <tbody>${funding.slice(0, 60).map(f => `<tr>
              <td class="muted">${fmtTime(f.time)}</td>
              <td class="accent">${f.coin || '?'}</td>
              <td class="${f.funding_rate >= 0 ? 'pos' : 'neg'}">${(f.funding_rate * 100).toFixed(4)}%</td>
              <td class="${f.usdc >= 0 ? 'pos' : 'neg'}">${f.usdc.toFixed(4)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
    setRefreshTime();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Flows ─────────────────────────────────────────────────────────────────────
async function loadFlows() {
  const el = document.getElementById('flows-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading flows…</div>';
  try {
    const flows = parseLedger(await getLedgerUpdates(currentWallet, 90));
    const totalIn = flows.filter(f => f.usdc > 0).reduce((a, f) => a + f.usdc, 0);
    const totalOut = flows.filter(f => f.usdc < 0).reduce((a, f) => a + f.usdc, 0);
    const net = totalIn + totalOut;
    el.innerHTML = `
      <div class="grid-3">
        <div class="stat-card"><div class="stat-label">Total Inflow (90d)</div><div class="stat-value pos">${fmt$(totalIn)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Outflow (90d)</div><div class="stat-value neg">−${fmt$(Math.abs(totalOut))}</div></div>
        <div class="stat-card"><div class="stat-label">Net Flow</div><div class="stat-value ${net >= 0 ? 'pos' : 'neg'}">${fmt$(net)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Flow History</div>
        ${flows.length === 0 ? '<div class="empty-state">No deposit/withdrawal activity in 90 days</div>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Direction</th><th>Type</th><th>Amount</th><th>Tx Hash</th></tr></thead>
          <tbody>${flows.map(f => `<tr>
            <td class="muted">${fmtTime(f.time)}</td>
            <td><span class="side-badge ${f.direction === 'inflow' ? 'long' : 'short'}">${f.direction.toUpperCase()}</span></td>
            <td class="muted">${f.type}</td>
            <td class="${f.usdc >= 0 ? 'flow-in' : 'flow-out'}">${fmt$(Math.abs(f.usdc))}</td>
            <td class="muted" style="font-size:10px">${f.hash ? f.hash.slice(0, 14) + '…' : '—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>`;
    setRefreshTime();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Phases ────────────────────────────────────────────────────────────────────
let phaseInterval = '1h';
async function loadPhases(interval) {
  if (interval) phaseInterval = interval;
  const el = document.getElementById('phases-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Detecting phases…</div>';
  try {
    const state = await getClearinghouseState(currentWallet);
    const positions = parsePositions(state);
    if (positions.length === 0) {
      el.innerHTML = phasesShell(`<div class="empty-state">No open positions to analyze. Phase detection uses your current open positions.</div>`);
      return;
    }
    const results = await Promise.allSettled(positions.map(async p => {
      const candles = await getCandles(p.coin, phaseInterval, 7);
      return { coin: p.coin, ...detectPhase(candles) };
    }));
    const phases = results.map((r, i) => r.status === 'fulfilled' ? r.value : { coin: positions[i].coin, phase: 'NEUTRAL', confidence: 0, signals: ['fetch failed'] });
    el.innerHTML = phasesShell(`
      <div class="grid-3" id="phase-cards">
        ${phases.map(phaseCard).join('')}
      </div>
      <div class="card">
        <div class="card-title">Phase Key</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:4px 0">
          <span class="phase-badge phase-ACCUMULATION">🔵 Accumulation — quiet buying, tight range</span>
          <span class="phase-badge phase-MARKUP">🚀 Markup — uptrend with volume</span>
          <span class="phase-badge phase-DISTRIBUTION">🟡 Distribution — topping, selling pressure</span>
          <span class="phase-badge phase-MARKDOWN">🔻 Markdown — downtrend with volume</span>
          <span class="phase-badge phase-NEUTRAL">⚪ Neutral — no clear signal</span>
        </div>
      </div>`);
    setRefreshTime();
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function phasesShell(inner) {
  return `
    <div class="section-header">
      <div class="section-title">Market Phase Detection</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="muted" style="font-size:12px">Interval:</span>
        <div class="tabs" style="margin:0">
          ${['1h','4h','1d'].map(iv => `<button class="tab ${phaseInterval === iv ? 'active' : ''}" onclick="loadPhases('${iv}')">${iv}</button>`).join('')}
        </div>
      </div>
    </div>
    ${inner}`;
}

function phaseCard(p) {
  const icons = { ACCUMULATION: '🔵', MARKUP: '🚀', DISTRIBUTION: '🟡', MARKDOWN: '🔻', NEUTRAL: '⚪' };
  const conf = Math.round((p.confidence || 0) * 100);
  return `
    <div class="card">
      <div class="card-title">${p.coin}</div>
      <div style="margin-bottom:10px"><span class="phase-badge phase-${p.phase}">${icons[p.phase] || '⚪'} ${p.phase}</span></div>
      <div style="margin-bottom:8px">
        <div class="conf-bar"><span class="muted" style="font-size:11px">Confidence</span><span class="conf-val">${conf}%</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${conf}%"></div></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Price: <span style="color:var(--text)">${p.price_trend}</span> &nbsp; Volume: <span style="color:var(--text)">${p.volume_trend}</span></div>
      <ul style="font-size:11px;color:var(--text-muted);padding-left:14px;line-height:1.7">${(p.signals || []).map(s => `<li>${s}</li>`).join('')}</ul>
    </div>`;
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function getWatchlist() { try { return JSON.parse(localStorage.getItem('hype_watchlist') || '[]'); } catch { return []; } }
function saveWatchlist(wl) { localStorage.setItem('hype_watchlist', JSON.stringify(wl)); }

async function loadWatchlist() {
  const el = document.getElementById('watchlist-content');
  const wallets = getWatchlist();
  el.innerHTML = `
    <div class="section-header"><div class="section-title">Wallet Watchlist</div></div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Add Wallet</div>
      <div class="input-group">
        <input class="input" id="add-addr" placeholder="0x… address" style="flex:2">
        <input class="input" id="add-label" placeholder="Label (optional)" style="flex:1">
        <button class="btn btn-primary" onclick="addWatchWallet()">Add</button>
      </div>
    </div>
    <div id="wallet-list">
      ${wallets.length === 0 ? '<div class="empty-state">No wallets added. Add a wallet address above to track it.</div>' : '<div class="loading"><div class="spinner"></div> Loading snapshots…</div>'}
    </div>`;
  if (wallets.length > 0) {
    const snaps = await Promise.allSettled(wallets.map(async w => {
      const state = await getClearinghouseState(w.address);
      return { ...w, summary: parseAccountSummary(state), positions: parsePositions(state) };
    }));
    document.getElementById('wallet-list').innerHTML = snaps.map((r, i) => {
      if (r.status === 'rejected') return walletRow(wallets[i], null);
      return walletRow(r.value, r.value);
    }).join('');
  }
}

function walletRow(w, snap) {
  const isPrimary = w.address.toLowerCase() === DEFAULT_WALLET.toLowerCase();
  const summary = snap?.summary || {};
  const positions = snap?.positions || [];
  const coins = positions.map(p => p.coin);
  return `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <span style="font-weight:600">${w.label || w.address.slice(0,10)+'…'}</span>
          ${isPrimary ? '<span style="margin-left:8px;font-size:10px;background:rgba(124,106,255,0.15);color:var(--accent);padding:2px 8px;border-radius:10px">PRIMARY</span>' : ''}
          <div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${w.address}</div>
        </div>
        ${!isPrimary ? `<button class="btn btn-danger btn-sm" onclick="removeWatchWallet('${w.address}')">Remove</button>` : ''}
      </div>
      ${snap ? `
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div><div class="stat-label">Account Value</div><div style="font-family:var(--mono)">${fmt$(summary.account_value || 0)}</div></div>
        <div><div class="stat-label">Positions</div><div style="font-family:var(--mono)">${positions.length}</div></div>
        <div><div class="stat-label">Coins</div><div style="font-family:var(--mono);font-size:12px">${coins.join(', ') || '—'}</div></div>
        <div><div class="stat-label">Unr. PnL</div><div style="font-family:var(--mono)" class="${positions.reduce((a,p)=>a+p.unrealized_pnl,0)>=0?'pos':'neg'}">${fmt$(positions.reduce((a,p)=>a+p.unrealized_pnl,0))}</div></div>
      </div>` : '<div class="muted" style="font-size:12px">Failed to load snapshot</div>'}
    </div>`;
}

function addWatchWallet() {
  const addr = document.getElementById('add-addr').value.trim().toLowerCase();
  const label = document.getElementById('add-label').value.trim();
  if (!addr || !addr.startsWith('0x')) { alert('Enter a valid 0x address'); return; }
  const wl = getWatchlist();
  if (wl.find(w => w.address === addr)) { alert('Already in watchlist'); return; }
  wl.push({ address: addr, label: label || addr.slice(0, 8) + '…', added_at: Date.now() });
  saveWatchlist(wl);
  loadWatchlist();
}

function removeWatchWallet(addr) {
  if (!confirm('Remove this wallet?')) return;
  saveWatchlist(getWatchlist().filter(w => w.address !== addr));
  loadWatchlist();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n === undefined || n === null) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sign + '$' + abs.toFixed(2);
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setStatus(ok) {
  document.getElementById('ws-status').className = 'status-dot' + (ok ? '' : ' off');
}

function setRefreshTime() {
  document.getElementById('refresh-info').textContent = 'Updated ' + new Date().toLocaleTimeString();
  setStatus(true);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Add primary wallet to watchlist if not already there
  const wl = getWatchlist();
  if (!wl.find(w => w.address === DEFAULT_WALLET.toLowerCase())) {
    wl.unshift({ address: DEFAULT_WALLET.toLowerCase(), label: 'My Wallet', added_at: Date.now() });
    saveWatchlist(wl);
  }
  navigate('overview');
  // Auto-refresh every 30s
  autoRefreshTimer = setInterval(() => { navigate(currentPage); }, 30000);
});