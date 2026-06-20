// ── Capital — live spot vs. perps breakdown + detailed trade & fee journal ────
// Pure client-side, reads directly from Hyperliquid (same pattern as the rest of the app).

const CAP_POLL_MS = 12000;
let _capPollId = null;
let _capData = null;
let _capWindow = 30;       // trades window in days (0 = all)
let _capCoinFilter = '';

// ── Live polling ──────────────────────────────────────────────────────────────

function stopCapitalPolling() {
  if (_capPollId) { clearInterval(_capPollId); _capPollId = null; }
}

function startCapitalPolling() {
  stopCapitalPolling();
  _capPollId = setInterval(_capRefreshLive, CAP_POLL_MS);
}

async function _capRefreshLive() {
  if (currentPage !== 'capital' || document.hidden) return;
  try {
    await _capFetchAll();
    _capRenderLiveCards();
    _capSetUpdatedNow();
  } catch (e) {
    console.warn('[Capital] poll failed:', e.message);
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function _capFetchAll() {
  const [state, spotStateRaw, spotMetaRaw, perpMetaRaw, rawFills] = await Promise.all([
    getClearinghouseState(currentWallet),
    getSpotState(currentWallet).catch(() => null),
    getSpotMeta().catch(() => null),
    getMetaAndAssetCtxs().catch(() => null),
    getUserFills(currentWallet).catch(() => []),
  ]);

  const s = parseAccountSummary(state);
  const positions = parsePositions(state);
  const marketCtx = buildMarketCtx(perpMetaRaw);
  const { balances: spotBals, usdcBalance } = parseSpotBalances(spotStateRaw, spotMetaRaw);

  spotBals.forEach(b => {
    if (b.currentPrice > 0) return;
    const px = livePrices[b.coin] || marketCtx[b.coin]?.mark_price || 0;
    if (!px) return;
    b.currentPrice = px;
    b.value = px * b.total;
    if (b.avgEntry > 0) {
      b.unrealizedPnl = (px - b.avgEntry) * b.total;
      b.pnlPct = b.entryNtl > 0 ? b.unrealizedPnl / b.entryNtl * 100 : 0;
    }
  });

  const spotTotalValue = spotBals.reduce((a, b) => a + b.value, 0) + usdcBalance;
  const spotUnrPnl = spotBals.reduce((a, b) => a + b.unrealizedPnl, 0);
  const perpUnrPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);
  // Unified accounts: USDC lives in the spot wallet already; perp side only adds floating PnL.
  // Legacy accounts: separate perp wallet (account_value) + spot wallet.
  const totalPortfolio = s.isUnified ? spotTotalValue + perpUnrPnl : s.account_value + spotTotalValue;

  const spotIndexMap = buildSpotIndexMap(spotMetaRaw);
  const allFills = tagFills(parseFills(rawFills), spotIndexMap);
  const perpFills = allFills.filter(f => !f.isSpot);
  const perpRawFills = (rawFills || []).filter(f => !String(f.coin || '').startsWith('@'));
  const perpTrades = buildTrades(perpRawFills)
    .filter(t => t.closed)
    .sort((a, b) => (b.exit_time || 0) - (a.exit_time || 0));

  _capData = {
    s, positions, spotBals, usdcBalance, spotTotalValue, spotUnrPnl, perpUnrPnl, totalPortfolio,
    perpFills, perpTrades,
  };
}

// ── Page entry point ──────────────────────────────────────────────────────────

async function loadCapital() {
  const el = document.getElementById('capital-content');
  if (!el) return;
  if (!_silentRefresh) el.innerHTML = loading();
  try {
    await _capFetchAll();
    _capRenderShell();
    _capRenderLiveCards();
    _capRenderTradesSection();
    try { await _capRenderHistoryChart(); } catch (chartErr) { console.warn('[Capital] chart render failed:', chartErr.message); }
    _capSetUpdatedNow();
    setRefreshTime();
    startCapitalPolling();
  } catch (e) {
    if (!_silentRefresh) el.innerHTML = err(e);
  }
}

// ── Shell (static structure, rendered once per load) ──────────────────────────

function _capRenderShell() {
  const el = document.getElementById('capital-content');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="cap-live-dot" id="cap-live-dot"></span>
        <span style="font-size:11px;color:var(--text-muted)" id="cap-updated">Live</span>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="loadCapital()">↺ Refresh</button>
    </div>

    <div id="cap-live-cards"></div>

    <div class="card" style="margin-top:14px;margin-bottom:14px">
      <div class="card-title">Capital History — Spot vs. Perps</div>
      <div style="height:160px;position:relative"><canvas id="cap-history-chart"></canvas></div>
      <div class="muted" style="font-size:10px;margin-top:6px">Built from daily snapshots. Spot tracking starts the day this feature was added — older days only show perps equity.</div>
    </div>

    <div id="cap-trades-section"></div>

    <style>
      .cap-live-dot { width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:cap-pulse 1.6s infinite; }
      @keyframes cap-pulse { 0%{box-shadow:0 0 0 0 rgba(74,222,128,.5)} 70%{box-shadow:0 0 0 6px rgba(74,222,128,0)} 100%{box-shadow:0 0 0 0 rgba(74,222,128,0)} }
      .cap-alloc-bar { display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--surface2) }
      .cap-alloc-spot { background:var(--accent) }
      .cap-alloc-perp { background:#a78bfa }
    </style>`;
}

function _capSetUpdatedNow() {
  const elD = document.getElementById('cap-updated');
  if (elD) elD.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Live cards (re-rendered on every poll) ────────────────────────────────────

function _capRenderLiveCards() {
  const wrap = document.getElementById('cap-live-cards');
  if (!wrap || !_capData) return;
  const { s, spotTotalValue, spotUnrPnl, perpUnrPnl, totalPortfolio, usdcBalance, spotBals, positions } = _capData;

  const spotPct = totalPortfolio > 0 ? spotTotalValue / totalPortfolio * 100 : 0;
  const perpPct = totalPortfolio > 0 ? Math.max(totalPortfolio - spotTotalValue, 0) / totalPortfolio * 100 : 0;
  const totalUnr = spotUnrPnl + perpUnrPnl;

  wrap.innerHTML = `
    <div class="grid-4" style="margin-bottom:10px">
      <div class="stat-card">
        <div class="stat-label">Total Capital</div>
        <div class="stat-value">${fmt$(totalPortfolio)}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">Spot ${fmt$(spotTotalValue)} · Perps ${fmt$(s.account_value)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Spot Capital</div>
        <div class="stat-value">${fmt$(spotTotalValue)}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">${spotPct.toFixed(1)}% of total · ${spotBals.length} holding${spotBals.length===1?'':'s'} + USDC ${fmt$(usdcBalance)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Perps Equity</div>
        <div class="stat-value">${fmt$(s.account_value)}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">${perpPct.toFixed(1)}% of total · ${positions.length} open position${positions.length===1?'':'s'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unrealized PnL</div>
        <div class="stat-value ${totalUnr>=0?'pos':'neg'}">${fmt$(totalUnr)}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">Spot ${fmt$(spotUnrPnl)} · Perps ${fmt$(perpUnrPnl)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:0">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:6px">
        <span><span style="color:var(--accent)">●</span> Spot ${spotPct.toFixed(1)}%</span>
        <span><span style="color:#a78bfa">●</span> Perps ${perpPct.toFixed(1)}%</span>
      </div>
      <div class="cap-alloc-bar">
        <div class="cap-alloc-spot" style="width:${spotPct}%"></div>
        <div class="cap-alloc-perp" style="width:${perpPct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:11px">
        <span class="muted">Perp margin used <strong class="mono">${fmt$(s.total_margin_used)}</strong> <span class="muted">(${s.account_value>0?(s.total_margin_used/s.account_value*100).toFixed(1):0}%)</span></span>
        <span class="muted">Withdrawable <strong class="mono">${fmt$(s.withdrawable)}</strong></span>
      </div>
    </div>`;
}

// ── History chart (capital allocation over time) ──────────────────────────────

// Snapshots persisted by the Cloudflare bot (cloudflare/bot-worker.js → hype_snapshots table)
// survive localStorage clears / new devices. Local daily snaps win on date overlap since they
// carry more detail; remote rows only fill in dates missing from local history.
async function _capFetchRemoteSnaps() {
  const url = localStorage.getItem('hype_sb_url') || '';
  const key = localStorage.getItem('hype_sb_anon') || '';
  if (!url || !key || !currentWallet) return [];
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/hype_snapshots?wallet=eq.${encodeURIComponent(currentWallet)}&order=ts.asc&limit=400`;
  const resp = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!resp.ok) return [];
  const rows = await resp.json();
  return rows.map(r => ({
    type: 'daily',
    date: new Date(r.ts).toISOString().slice(0, 10),
    ts: r.ts,
    account_value: r.account_value,
    spot_value: r.spot_value ?? 0,
    total_value: r.total_value ?? null,
  }));
}

function _capMergeSnaps(local, remote) {
  const byDate = new Map();
  remote.forEach(s => byDate.set(s.date, s));
  local.forEach(s => byDate.set(s.date, s));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function _capRenderHistoryChart() {
  const ctx = document.getElementById('cap-history-chart');
  if (!ctx || typeof _ajLoadSnaps !== 'function' || typeof Chart === 'undefined') return;
  const local = _ajLoadSnaps().filter(s => s.type === 'daily');
  let remote = [];
  try { remote = await _capFetchRemoteSnaps(); } catch (e) { console.warn('[Capital] remote snapshot fetch failed:', e.message); }
  const snaps = _capMergeSnaps(local, remote).slice(-60);
  if (ctx._chart) ctx._chart.destroy();
  if (snaps.length === 0) return;

  ctx._chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: snaps.map(s => s.date.slice(5)),
      datasets: [
        {
          label: 'Spot',
          data: snaps.map(s => s.spot_value ?? 0),
          backgroundColor: 'rgba(56,189,248,0.55)',
          borderColor: 'rgba(56,189,248,0.9)', borderWidth: 1, stack: 'cap',
        },
        {
          label: 'Perps',
          data: snaps.map(s => s.account_value ?? 0),
          backgroundColor: 'rgba(167,139,250,0.55)',
          borderColor: 'rgba(167,139,250,0.9)', borderWidth: 1, stack: 'cap',
        },
      ],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: 'var(--text-muted)', font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt$(c.raw)}` } } },
      scales: {
        x: { stacked: true, ticks: { color: 'var(--text-muted)', font: { size: 9 } }, grid: { display: false } },
        y: { stacked: true, ticks: { color: 'var(--text-muted)', font: { size: 9 }, callback: v => fmt$(v) }, grid: { color: 'var(--border)' } },
      },
    },
  });
}

// ── Trades & fees section ──────────────────────────────────────────────────────

function switchCapitalWindow(days) {
  _capWindow = days;
  _capRenderTradesSection();
}

function _capWindowFilter(items, timeKey) {
  if (!_capWindow) return items;
  const cutoff = Date.now() - _capWindow * 86400000;
  return items.filter(t => (t[timeKey] || 0) >= cutoff);
}

function _capRenderTradesSection() {
  const wrap = document.getElementById('cap-trades-section');
  if (!wrap || !_capData) return;
  const { perpTrades, perpFills } = _capData;

  const trades = _capWindowFilter(perpTrades, 'exit_time');
  const fills = _capWindowFilter(perpFills, 'time');
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const totalNet = trades.reduce((s, t) => s + t.net_pnl, 0);

  const windowBtns = [7, 30, 90, 0].map((days) => {
    const label = days === 0 ? 'All' : `${days}d`;
    const on = days === _capWindow;
    return `<button onclick="switchCapitalWindow(${days})"
      style="padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};border-radius:var(--radius-sm);background:${on ? 'var(--accent)' : 'var(--surface2)'};color:${on ? '#fff' : 'var(--text-muted)'};margin-right:4px">${label}</button>`;
  }).join('');

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-bottom:11px;border-bottom:1px solid var(--border);margin-bottom:12px;margin-top:6px">
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;align-items:center">
        <span class="muted">Closed trades <strong>${trades.length}</strong></span>
        <span class="muted">Net PnL <strong class="${totalNet>=0?'pos':'neg'}">${fmt$(totalNet)}</strong></span>
        <span class="muted">Fees paid <strong class="neg">−${fmt$(totalFees)}</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div>${windowBtns}</div>
        <input id="cap-coin-filter" type="text" placeholder="Filter coin…" value="${_capEsc(_capCoinFilter)}"
          oninput="_capCoinFilter=this.value;_capRefreshFilteredViews()"
          style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:5px 10px;font-size:12px;outline:none;width:120px">
      </div>
    </div>

    <div id="cap-stats-section" style="margin-bottom:18px"></div>

    <div class="card-title">Closed Trades</div>
    <div id="cap-trades-table" class="table-wrap" style="margin-bottom:18px"></div>

    <div class="card-title">Recent Fills &amp; Fees</div>
    <div id="cap-fills-table" class="table-wrap"></div>`;

  _capRefreshFilteredViews();
}

function _capRefreshFilteredViews() {
  _capRenderTradesTables();
  _capRenderStats();
}

// ── Journal stats (win rate, profit factor, R:R, max drawdown, equity curve) ──

function _capMaxDrawdown(cumSeries) {
  let peak = 0, maxDD = 0;
  for (const pt of cumSeries) {
    if (pt.v > peak) peak = pt.v;
    maxDD = Math.max(maxDD, peak - pt.v);
  }
  return maxDD;
}

function _capRenderStats() {
  const wrap = document.getElementById('cap-stats-section');
  if (!wrap || !_capData) return;
  const q = (_capCoinFilter || '').toUpperCase().trim();
  const match = t => !q || t.coin.toUpperCase().includes(q);
  const trades = _capWindowFilter(_capData.perpTrades, 'exit_time').filter(match);

  if (typeof buildAnalytics !== 'function' || trades.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  const an = buildAnalytics(trades);
  if (!an) { wrap.innerHTML = ''; return; }

  const o = an.overall;
  const rr = o.avgLoss !== 0 ? Math.abs(o.avgWin / o.avgLoss) : null;
  const maxDD = _capMaxDrawdown(an.cumSeries);

  wrap.innerHTML = `
    <div class="card-title">Journal Stats</div>
    <div class="grid-4" style="margin-bottom:10px">
      <div class="stat-card">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value ${o.winRate>=0.5?'pos':'neg'}">${(o.winRate*100).toFixed(1)}%</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">${o.winCount}W / ${o.lossCount}L</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value ${o.profitFactor>1?'pos':'neg'}">${o.profitFactor ? o.profitFactor.toFixed(2) : '—'}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">R:R ${rr ? rr.toFixed(2) : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Win / Loss</div>
        <div class="stat-value" style="font-size:16px"><span class="pos">${fmt$(o.avgWin)}</span> / <span class="neg">${fmt$(o.avgLoss)}</span></div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">Avg hold ${_capFmtHold(o.avgHoldMs)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Max Drawdown</div>
        <div class="stat-value neg">−${fmt$(maxDD)}</div>
        <div class="stat-sub muted" style="font-size:10px;margin-top:2px">Peak-to-trough, closed-trade PnL</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:0">
      <div style="height:120px;position:relative"><canvas id="cap-equity-chart"></canvas></div>
    </div>`;

  try { _capRenderEquityChart(an.cumSeries); } catch (e) { console.warn('[Capital] equity chart failed:', e.message); }
}

function _capRenderEquityChart(cumSeries) {
  const ctx = document.getElementById('cap-equity-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (ctx._chart) ctx._chart.destroy();
  if (!cumSeries || cumSeries.length === 0) return;

  ctx._chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: cumSeries.map(p => fmtTime(p.t)),
      datasets: [{
        data: cumSeries.map(p => p.v),
        borderColor: 'rgba(74,222,128,0.9)',
        backgroundColor: 'rgba(74,222,128,0.12)',
        borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.15,
      }],
    },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `Cumulative: ${fmt$(c.raw)}` } } },
      scales: {
        x: { display: false },
        y: { ticks: { color: 'var(--text-muted)', font: { size: 9 }, callback: v => fmt$(v) }, grid: { color: 'var(--border)' } },
      },
    },
  });
}

function _capRenderTradesTables() {
  if (!_capData) return;
  const q = (_capCoinFilter || '').toUpperCase().trim();
  const match = t => !q || t.coin.toUpperCase().includes(q);

  const trades = _capWindowFilter(_capData.perpTrades, 'exit_time').filter(match).slice(0, 100);
  const fills  = _capWindowFilter(_capData.perpFills, 'time').filter(match).slice(0, 100);

  const tradesEl = document.getElementById('cap-trades-table');
  if (tradesEl) {
    tradesEl.innerHTML = `<table class="mobile-cards">
      <thead><tr>
        <th>Closed</th><th>Coin</th><th>Side</th><th>Avg Entry</th><th>Avg Exit</th><th>Size</th>
        <th>Hold</th><th>Gross PnL</th><th>Fees</th><th>Net PnL</th>
      </tr></thead>
      <tbody>${trades.length === 0
        ? `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">No closed trades${q ? ' for ' + _capEsc(q) : ''} in this window</td></tr>`
        : trades.map(t => `<tr>
            <td data-label="Closed" class="muted">${fmtTime(t.exit_time)}</td>
            <td data-label="Coin" class="accent" style="font-weight:600">${_capEsc(t.coin)}</td>
            <td data-label="Side"><span class="side-badge ${t.side}">${t.side.toUpperCase()}</span></td>
            <td data-label="Avg Entry" class="mono">${fmtPrice(t.avg_entry)}</td>
            <td data-label="Avg Exit" class="mono">${fmtPrice(t.avg_exit)}</td>
            <td data-label="Size" class="mono">${t.size}</td>
            <td data-label="Hold" class="muted">${_capFmtHold(t.hold_ms)}</td>
            <td data-label="Gross PnL" class="${t.pnl>0?'pos':t.pnl<0?'neg':'muted'} mono">${fmt$(t.pnl)}</td>
            <td data-label="Fees" class="neg mono">${t.fees>0?'−'+fmt$(t.fees):'—'}</td>
            <td data-label="Net PnL" class="${t.net_pnl>0?'pos':t.net_pnl<0?'neg':'muted'} mono" style="font-weight:600">${fmt$(t.net_pnl)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  }

  const fillsEl = document.getElementById('cap-fills-table');
  if (fillsEl) {
    fillsEl.innerHTML = `<table class="mobile-cards">
      <thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Price</th><th>Size</th><th>Realized PnL</th><th>Fee</th></tr></thead>
      <tbody>${fills.length === 0
        ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No fills${q ? ' for ' + _capEsc(q) : ''} in this window</td></tr>`
        : fills.map(f => `<tr>
            <td data-label="Time" class="muted">${fmtTime(f.time)}</td>
            <td data-label="Coin" class="accent" style="font-weight:600">${_capEsc(f.coin)}</td>
            <td data-label="Side"><span class="side-badge ${f.side==='B'?'long':'short'}">${f.side==='B'?'BUY':'SELL'}</span></td>
            <td data-label="Price" class="mono">${fmtPrice(f.price)}</td>
            <td data-label="Size" class="mono">${f.size}</td>
            <td data-label="Realized PnL" class="${f.closed_pnl>0?'pos':f.closed_pnl<0?'neg':'muted'} mono">${f.closed_pnl!==0?fmt$(f.closed_pnl):'—'}</td>
            <td data-label="Fee" class="neg mono">${f.fee>0?'−'+fmt$(f.fee):'—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  }
}

function _capFmtHold(ms) {
  if (!ms) return '—';
  const h = ms / 3600000;
  if (h < 1) return Math.round(ms / 60000) + 'm';
  if (h < 24) return h.toFixed(1) + 'h';
  return (h / 24).toFixed(1) + 'd';
}

function _capEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
