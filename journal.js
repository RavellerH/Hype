// ── Journal — Realized P&L Analysis ──────────────────────────────────────────

let _journalChart = null;

function buildTrades(rawFills) {
  const fills = (rawFills || []).map(f => ({
    time: f.time,
    coin: f.coin && f.coin.startsWith('@') ? f.coin : f.coin,
    side: f.dir || f.side,
    price: parseFloat(f.px || 0),
    size: parseFloat(f.sz || 0),
    fee: parseFloat(f.fee || 0),
    closedPnl: parseFloat(f.closedPnl || 0),
  })).filter(f => f.coin && !f.coin.startsWith('@'));

  const byCoin = {};
  for (const f of fills) {
    if (!byCoin[f.coin]) byCoin[f.coin] = [];
    byCoin[f.coin].push(f);
  }

  const trades = [];
  for (const [coin, coinFills] of Object.entries(byCoin)) {
    const sorted = [...coinFills].sort((a, b) => a.time - b.time);
    let netPos = 0;
    let entryTime = null;
    let side = null;
    let pnl = 0;
    let fees = 0;
    let entryFills = [];

    for (const f of sorted) {
      const isBuy = f.side === 'B' || f.side === 'buy';
      const delta = isBuy ? f.size : -f.size;

      if (netPos === 0) {
        entryTime = f.time;
        side = isBuy ? 'long' : 'short';
        pnl = 0;
        fees = 0;
      }

      netPos += delta;
      pnl += f.closedPnl;
      fees += f.fee;

      if (Math.abs(netPos) < 1e-9) {
        trades.push({
          coin,
          side,
          entry_time: entryTime,
          exit_time: f.time,
          pnl,
          fees,
          net_pnl: pnl - fees,
          hold_ms: f.time - entryTime,
          closed: true,
        });
        netPos = 0;
        entryTime = null;
        side = null;
        pnl = 0;
        fees = 0;
      }
    }

    if (Math.abs(netPos) > 1e-9 && entryTime !== null) {
      trades.push({
        coin,
        side,
        entry_time: entryTime,
        exit_time: null,
        pnl,
        fees,
        net_pnl: pnl - fees,
        hold_ms: Date.now() - entryTime,
        closed: false,
      });
    }
  }

  return trades.sort((a, b) => (b.exit_time || b.entry_time) - (a.exit_time || a.entry_time));
}

function fmtHold(ms) {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return `${h}h`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

async function loadJournal() {
  const el = document.getElementById('journal-content');
  el.innerHTML = loading();
  try {
    // Auto-journal panel (enriched entries with tags + lessons)
    const ajHtml = typeof renderAutoJournalPanel === 'function' ? await renderAutoJournalPanel() : '';

    const rawFills = await getUserFills(currentWallet);
    const trades = buildTrades(rawFills);
    const closed = trades.filter(t => t.closed);
    const wins = closed.filter(t => t.net_pnl > 0);
    const losses = closed.filter(t => t.net_pnl < 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.net_pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.net_pnl, 0) / losses.length : 0;
    const rr = avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : '—';
    const totalPnl = closed.reduce((a, t) => a + t.net_pnl, 0);

    const avgWinHold = wins.length > 0 ? wins.reduce((a, t) => a + t.hold_ms, 0) / wins.length : 0;
    const avgLossHold = losses.length > 0 ? losses.reduce((a, t) => a + t.hold_ms, 0) / losses.length : 0;
    const avgWinH = Math.round(avgWinHold / 3600000);
    const avgLossH = Math.round(avgLossHold / 3600000);
    const holdWarning = avgLossHold > 2 * avgWinHold && avgWinHold > 0;
    const maxHold = Math.max(avgWinHold, avgLossHold) || 1;
    const winBarPct = Math.round(avgWinHold / maxHold * 100);
    const lossBarPct = Math.round(avgLossHold / maxHold * 100);

    const byCoin = {};
    for (const t of closed) {
      if (!byCoin[t.coin]) byCoin[t.coin] = { trades: 0, wins: 0, pnl: 0 };
      byCoin[t.coin].trades++;
      if (t.net_pnl > 0) byCoin[t.coin].wins++;
      byCoin[t.coin].pnl += t.net_pnl;
    }
    const coinRows = Object.entries(byCoin)
      .map(([coin, d]) => ({ coin, ...d, wr: (d.wins / d.trades * 100).toFixed(0) }))
      .sort((a, b) => b.pnl - a.pnl);

    const cumData = [...closed]
      .filter(t => t.exit_time)
      .sort((a, b) => a.exit_time - b.exit_time);
    let cum = 0;
    const cumPoints = cumData.map(t => { cum += t.net_pnl; return { x: new Date(t.exit_time), y: parseFloat(cum.toFixed(2)) }; });

    el.innerHTML = ajHtml + `
      <div class="aj-section-title" style="padding:14px 14px 6px;margin-top:8px">Trade Log (${trades.length} total)</div>
      <div class="stat-strip" style="margin-bottom:14px">
        <div class="stat-cell"><div class="s-label">Total Trades</div><div class="s-value">${closed.length}</div></div>
        <div class="stat-cell"><div class="s-label">Win Rate</div><div class="s-value">${winRate}%</div><div class="s-sub">${wins.length}W / ${losses.length}L</div></div>
        <div class="stat-cell"><div class="s-label">Avg Winner / Loser</div><div class="s-value">${avgWin > 0 ? fmt$(avgWin) : '—'} / <span class="neg">${avgLoss < 0 ? fmt$(avgLoss) : '—'}</span></div></div>
        <div class="stat-cell"><div class="s-label">R:R Ratio</div><div class="s-value">${rr}</div></div>
        <div class="stat-cell"><div class="s-label">Total Closed P&L</div><div class="s-value ${totalPnl >= 0 ? 'pos' : 'neg'}">${fmt$(totalPnl)}</div></div>
      </div>

      <div class="journal-insight-grid">
        <div class="journal-insight-card">
          <div class="card-title">Hold Time Pattern</div>
          <div class="journal-hold-comparison">
            <div style="margin-bottom:8px">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Winners — avg ${avgWinH}h</div>
              <div class="journal-hold-bar" style="width:${winBarPct}%;background:var(--green)"></div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Losers — avg ${avgLossH}h</div>
              <div class="journal-hold-bar" style="width:${lossBarPct}%;background:var(--red)"></div>
            </div>
          </div>
          ${holdWarning ? `<div style="margin-top:10px;font-size:12px;color:var(--red);font-weight:600">You hold losers ${avgLossH - avgWinH}h longer than winners</div>` : `<div style="margin-top:10px;font-size:12px;color:var(--text-muted)">Hold time looks balanced</div>`}
        </div>
        <div class="journal-insight-card">
          <div class="card-title">Best / Worst Coins</div>
          ${coinRows.length === 0 ? '<div class="empty-state">No closed trades</div>' : `
          <div class="journal-coin-table">
            <table>
              <thead><tr><th>Coin</th><th>Trades</th><th>WR%</th><th>P&L</th></tr></thead>
              <tbody>${coinRows.map(r => `<tr>
                <td class="accent">${r.coin}</td>
                <td class="mono">${r.trades}</td>
                <td>${r.wr}%</td>
                <td class="${r.pnl >= 0 ? 'pos' : 'neg'} mono">${fmt$(r.pnl)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`}
        </div>
      </div>

      ${cumPoints.length > 1 ? `
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Cumulative P&L</div>
        <div style="position:relative;height:200px"><canvas id="journal-chart"></canvas></div>
      </div>` : ''}

      <div class="card">
        <div class="card-title">Trade Log (${trades.length})</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Coin</th><th>Side</th><th>Open</th><th>Close</th><th>Hold</th><th>P&L</th><th>Fees</th><th>Net</th></tr></thead>
          <tbody>${trades.slice(0, 200).map(t => `<tr>
            <td class="accent">${t.coin}</td>
            <td><span class="side-badge ${t.side}">${t.side.toUpperCase()}</span></td>
            <td class="muted" style="font-size:11px">${fmtDate(t.entry_time)}</td>
            <td class="muted" style="font-size:11px">${t.exit_time ? fmtDate(t.exit_time) : '<span style="color:var(--accent)">OPEN</span>'}</td>
            <td class="mono">${fmtHold(t.hold_ms)}</td>
            <td class="${t.pnl >= 0 ? 'pos' : 'neg'} mono">${fmt$(t.pnl)}</td>
            <td class="neg mono">${t.fees > 0 ? '−' + fmt$(t.fees) : '—'}</td>
            <td class="${t.net_pnl >= 0 ? 'pos' : 'neg'} mono">${fmt$(t.net_pnl)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    if (cumPoints.length > 1) {
      requestAnimationFrame(() => {
        const ctx = document.getElementById('journal-chart');
        if (!ctx) return;
        if (_journalChart) { _journalChart.destroy(); _journalChart = null; }
        _journalChart = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [{
              data: cumPoints,
              borderColor: totalPnl >= 0 ? '#4ade80' : '#f87171',
              backgroundColor: totalPnl >= 0 ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              borderWidth: 2,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: {
              callbacks: { label: ctx => fmt$(ctx.parsed.y) }
            }},
            scales: {
              x: { type: 'time', ticks: { color: '#666', maxTicksLimit: 6 }, grid: { color: '#1f1f1f' } },
              y: { ticks: { color: '#666', callback: v => fmt$(v) }, grid: { color: '#1f1f1f' } },
            }
          }
        });
      });
    }

    setRefreshTime();
  } catch(e) { el.innerHTML = err(e); }
}
