// ── Journal — Realized P&L Analysis ──────────────────────────────────────────

let _journalChart = null;

function buildTradesFromFills(fills) {
  const perp = (fills || []).filter(f => f.coin && !f.coin.startsWith('@'));

  const byCoin = {};
  for (const f of perp) {
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

    for (const f of sorted) {
      const isBuy = f.side === 'B' || f.side === 'buy';
      const delta = isBuy ? f.size : -f.size;
      const fPnl = f.closed_pnl !== undefined ? f.closed_pnl : (f.closedPnl || 0);

      if (netPos === 0) {
        entryTime = f.time;
        side = isBuy ? 'long' : 'short';
        pnl = 0;
        fees = 0;
      }

      netPos += delta;
      pnl += fPnl;
      fees += f.fee || 0;

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

function _fmtHold(ms) {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return `${h}h`;
}

function _fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

async function loadJournal() {
  const el = document.getElementById('journal-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading journal…</div>';
  try {
    const data = await fetch(`${API}/api/trades?wallet=${PRIMARY_WALLET}&limit=2000`).then(r => r.json());
    const rawFills = data.trades || [];
    const trades = buildTradesFromFills(rawFills);
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

    el.innerHTML = `
      <div class="stat-strip" style="margin-bottom:14px">
        <div class="stat-cell"><div class="s-label">Total Trades</div><div class="s-value">${closed.length}</div></div>
        <div class="stat-cell"><div class="s-label">Win Rate</div><div class="s-value">${winRate}%</div><div class="s-sub">${wins.length}W / ${losses.length}L</div></div>
        <div class="stat-cell"><div class="s-label">Avg Winner / Loser</div><div class="s-value">${avgWin > 0 ? fmt$(avgWin) : '—'} / <span class="neg">${avgLoss < 0 ? fmt$(avgLoss) : '—'}</span></div></div>
        <div class="stat-cell"><div class="s-label">R:R Ratio</div><div class="s-value">${rr}</div></div>
        <div class="stat-cell"><div class="s-label">Total Closed P&L</div><div class="s-value ${totalPnl >= 0 ? 'pos' : 'neg'}">${fmt$(totalPnl)}</div></div>
      </div>

      <div class="journal-insight-grid">
        <div class="journal-insight-card">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px">Hold Time Pattern</div>
          <div class="journal-hold-comparison">
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Winners — avg ${avgWinH}h</div>
              <div class="journal-hold-bar" style="width:${winBarPct}%;background:var(--green)"></div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Losers — avg ${avgLossH}h</div>
              <div class="journal-hold-bar" style="width:${lossBarPct}%;background:var(--red)"></div>
            </div>
          </div>
          ${holdWarning
            ? `<div style="margin-top:10px;font-size:12px;color:var(--red);font-weight:600">You hold losers ${avgLossH - avgWinH}h longer than winners</div>`
            : `<div style="margin-top:10px;font-size:12px;color:var(--text-muted)">Hold time looks balanced</div>`}
        </div>
        <div class="journal-insight-card">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px">Best / Worst Coins</div>
          ${coinRows.length === 0 ? '<div style="color:var(--text-muted);font-size:12px">No closed trades</div>' : `
          <div class="journal-coin-table">
            <table>
              <thead><tr><th>Coin</th><th>Trades</th><th>WR%</th><th>P&L</th></tr></thead>
              <tbody>${coinRows.map(r => `<tr>
                <td style="color:var(--accent)">${r.coin}</td>
                <td style="font-family:var(--mono)">${r.trades}</td>
                <td>${r.wr}%</td>
                <td class="${r.pnl >= 0 ? 'pos' : 'neg'}" style="font-family:var(--mono)">${fmt$(r.pnl)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>`}
        </div>
      </div>

      ${cumPoints.length > 1 ? `
      <div class="table-wrap" style="margin-bottom:14px;padding:14px 16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">Cumulative P&L</div>
        <div style="position:relative;height:200px"><canvas id="journal-chart"></canvas></div>
      </div>` : ''}

      <div class="table-wrap">
        <div style="font-size:13px;font-weight:600;padding:10px 16px;border-bottom:1px solid var(--border)">Trade Log (${trades.length})</div>
        <table>
          <thead><tr><th>Coin</th><th>Side</th><th>Open</th><th>Close</th><th>Hold</th><th class="num">P&L</th><th class="num">Fees</th><th class="num">Net</th></tr></thead>
          <tbody>${trades.slice(0, 200).map(t => `<tr>
            <td style="color:var(--accent);font-weight:600">${t.coin}</td>
            <td><span class="side-badge ${t.side}">${t.side.toUpperCase()}</span></td>
            <td style="font-size:11px;color:var(--text-muted)">${_fmtDate(t.entry_time)}</td>
            <td style="font-size:11px;color:var(--text-muted)">${t.exit_time ? _fmtDate(t.exit_time) : '<span style="color:var(--accent)">OPEN</span>'}</td>
            <td style="font-family:var(--mono)">${_fmtHold(t.hold_ms)}</td>
            <td class="num ${t.pnl >= 0 ? 'pos' : 'neg'}">${fmt$(t.pnl)}</td>
            <td class="num neg">${t.fees > 0 ? '−' + fmt$(t.fees) : '—'}</td>
            <td class="num ${t.net_pnl >= 0 ? 'pos' : 'neg'}">${fmt$(t.net_pnl)}</td>
          </tr>`).join('')}</tbody>
        </table>
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
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}
