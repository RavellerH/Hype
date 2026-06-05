// ── Analytics — ML & Data Analysis ────────────────────────────────────────────

let _analyticsCache = null, _analyticsTs = 0;
let _analyticsCharts = {};
const ANALYTICS_TTL = 300000;

// ── Statistics helpers ────────────────────────────────────────────────────────

function holdBucket(ms) {
  const h = ms / 3600000;
  if (h < 4)   return 'Scalp (<4h)';
  if (h < 24)  return 'Day (4–24h)';
  if (h < 168) return 'Swing (1–7d)';
  return 'Position (>7d)';
}

const _DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function _dayName(ts) { return _DAYS[new Date(ts).getUTCDay()]; }
function _hourBucket(ts) {
  const h = new Date(ts).getUTCHours();
  if (h < 6)  return '00–06 UTC';
  if (h < 12) return '06–12 UTC';
  if (h < 18) return '12–18 UTC';
  return '18–24 UTC';
}

function _groupStats(trades, keyFn) {
  const g = {};
  for (const t of trades) {
    const k = keyFn(t);
    if (!g[k]) g[k] = [];
    g[k].push(t);
  }
  return Object.entries(g).map(([key, arr]) => {
    const wins   = arr.filter(t => t.net_pnl > 0);
    const losses = arr.filter(t => t.net_pnl <= 0);
    const sumW   = wins.reduce((s, t) => s + t.net_pnl, 0);
    const sumL   = losses.reduce((s, t) => s + t.net_pnl, 0);
    return {
      key,
      count:    arr.length,
      wins:     wins.length,
      losses:   losses.length,
      winRate:  arr.length ? wins.length / arr.length : 0,
      totalPnl: arr.reduce((s, t) => s + t.net_pnl, 0),
      avgPnl:   arr.reduce((s, t) => s + t.net_pnl, 0) / arr.length,
      avgWin:   wins.length   ? sumW / wins.length   : 0,
      avgLoss:  losses.length ? sumL / losses.length : 0,
      pf:       Math.abs(sumL) > 0 ? sumW / Math.abs(sumL) : null,
    };
  }).sort((a, b) => b.count - a.count);
}

function _computeKelly(closed) {
  const wins   = closed.filter(t => t.net_pnl > 0);
  const losses = closed.filter(t => t.net_pnl <= 0);
  if (!wins.length || !losses.length) return null;
  const p    = wins.length / closed.length;
  const avgW = wins.reduce((s, t) => s + t.net_pnl, 0) / wins.length;
  const avgL = Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0) / losses.length);
  const b    = avgW / avgL;
  const k    = (b * p - (1 - p)) / b;
  return { p, avgWin: avgW, avgLoss: avgL, b, kelly: k, halfKelly: k / 2, quarterKelly: k / 4 };
}

function _pnlDist(closed) {
  if (!closed.length) return [];
  const vals   = closed.map(t => t.net_pnl);
  const mn     = Math.min(...vals), mx = Math.max(...vals);
  const range  = mx - mn || 1;
  const bins   = Math.min(20, Math.ceil(Math.sqrt(closed.length)));
  const size   = range / bins;
  const out    = Array.from({length: bins}, (_, i) => ({
    label: '$' + (mn + i * size).toFixed(0),
    from:  mn + i * size,
    to:    mn + (i + 1) * size,
    count: 0,
  }));
  for (const v of vals) {
    const i = Math.min(bins - 1, Math.floor((v - mn) / size));
    out[i].count++;
  }
  out.forEach(b => b.win = (b.from + b.to) / 2 > 0);
  return out;
}

// Tier 2: detect statistically meaningful patterns
function _findPatterns(closed) {
  if (closed.length < 8) return [];
  const overallWr = closed.filter(t => t.net_pnl > 0).length / closed.length;

  const dims = [
    { name: 'Side',          fn: t => t.side },
    { name: 'Hold Duration', fn: t => holdBucket(t.hold_ms) },
    { name: 'Day of Week',   fn: t => _dayName(t.entry_time) },
    { name: 'Time (UTC)',    fn: t => _hourBucket(t.entry_time) },
  ];

  const patterns = [];
  for (const d of dims) {
    for (const g of _groupStats(closed, d.fn)) {
      if (g.count < 3) continue;
      const se   = Math.sqrt(overallWr * (1 - overallWr) / g.count);
      const z    = se > 0 ? (g.winRate - overallWr) / se : 0;
      const edge = g.winRate - overallWr;
      patterns.push({ ...g, dimension: d.name, edge, z });
    }
  }
  return patterns
    .filter(p => Math.abs(p.z) >= 0.5)
    .sort((a, b) => b.edge * b.count - a.edge * a.count)
    .slice(0, 6);
}

function buildAnalytics(trades) {
  const closed = trades.filter(t => t.closed);
  if (!closed.length) return null;

  const wins   = closed.filter(t => t.net_pnl > 0);
  const losses = closed.filter(t => t.net_pnl <= 0);
  const total  = closed.reduce((s, t) => s + t.net_pnl, 0);
  const gw     = wins.reduce((s, t) => s + t.net_pnl, 0);
  const gl     = Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0));

  const sorted = [...closed].sort((a, b) => (a.exit_time || 0) - (b.exit_time || 0));
  let cum = 0;
  const cumSeries = sorted.map(t => ({ t: t.exit_time, v: (cum += t.net_pnl), coin: t.coin, pnl: t.net_pnl }));

  return {
    overall: {
      count: closed.length, winCount: wins.length, lossCount: losses.length,
      winRate: wins.length / closed.length,
      profitFactor: gl > 0 ? gw / gl : null,
      totalPnl: total, avgPnl: total / closed.length,
      avgWin:  wins.length   ? gw / wins.length   : 0,
      avgLoss: losses.length ? -gl / losses.length : 0,
      avgHoldMs:    closed.reduce((s, t) => s + t.hold_ms, 0) / closed.length,
      maxWin:  wins.length   ? Math.max(...wins.map(t => t.net_pnl))   : 0,
      maxLoss: losses.length ? Math.min(...losses.map(t => t.net_pnl)) : 0,
    },
    bySide:     _groupStats(closed, t => t.side),
    byDuration: _groupStats(closed, t => holdBucket(t.hold_ms)),
    byDay:      _groupStats(closed, t => _dayName(t.entry_time)),
    byHour:     _groupStats(closed, t => _hourBucket(t.entry_time)),
    byCoin:     _groupStats(closed, t => t.coin),
    kelly:    _computeKelly(closed),
    cumSeries,
    pnlDist:  _pnlDist(closed),
    patterns: _findPatterns(closed),
    raw:      closed,
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

function _fmtUsd(n, sign = true) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? (abs / 1e6).toFixed(2) + 'M'
          : abs >= 1e3 ? (abs / 1e3).toFixed(1) + 'K'
          : abs.toFixed(2);
  if (!sign) return '$' + s;
  return (n >= 0 ? '+$' : '-$') + s;
}
function _fmtPct(r) { return (r * 100).toFixed(1) + '%'; }
function _pnlCls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted'; }
function _wrCls(r)  { return r >= 0.55 ? 'pos' : r <= 0.45 ? 'neg' : ''; }

// ── Breakdown table ───────────────────────────────────────────────────────────

function _breakdownTable(rows, title) {
  if (!rows.length) return '';
  return `<div class="an-section">
    <div class="an-title">${title}</div>
    <div class="an-table-wrap">
    <table class="an-table">
      <thead><tr>
        <th>Segment</th><th>Trades</th><th>Win%</th>
        <th>Total P&L</th><th>Avg P&L</th><th>Avg Win</th><th>Avg Loss</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${r.key}</td>
          <td>${r.count}</td>
          <td class="${_wrCls(r.winRate)}">${_fmtPct(r.winRate)}</td>
          <td class="${_pnlCls(r.totalPnl)}">${_fmtUsd(r.totalPnl)}</td>
          <td class="${_pnlCls(r.avgPnl)}">${_fmtUsd(r.avgPnl)}</td>
          <td class="pos">${_fmtUsd(r.avgWin)}</td>
          <td class="neg">${_fmtUsd(r.avgLoss)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderAnalytics(an) {
  const o = an.overall;
  const rr = o.avgLoss !== 0 ? (o.avgWin / Math.abs(o.avgLoss)).toFixed(2) : '—';

  const cards = `<div class="an-cards">
    ${[
      ['Closed Trades', o.count, ''],
      ['Win Rate',     _fmtPct(o.winRate), _wrCls(o.winRate)],
      ['Profit Factor', o.profitFactor ? o.profitFactor.toFixed(2) : '—', o.profitFactor > 1 ? 'pos' : 'neg'],
      ['Total Net P&L', _fmtUsd(o.totalPnl), _pnlCls(o.totalPnl)],
      ['Avg Win',  _fmtUsd(o.avgWin), 'pos'],
      ['Avg Loss', _fmtUsd(o.avgLoss), 'neg'],
      ['Avg Hold', fmtHold(o.avgHoldMs), ''],
      ['R:R Ratio', rr, ''],
    ].map(([label, val, cls]) => `<div class="an-card">
      <div class="an-card-label">${label}</div>
      <div class="an-card-value ${cls}">${val}</div>
    </div>`).join('')}
  </div>`;

  const charts = `<div class="an-charts-row">
    <div class="an-chart-box">
      <div class="an-chart-title">Cumulative P&L</div>
      <canvas id="an-cum-chart" height="160"></canvas>
    </div>
    <div class="an-chart-box">
      <div class="an-chart-title">P&L Distribution</div>
      <canvas id="an-dist-chart" height="160"></canvas>
    </div>
  </div>`;

  const kelly = an.kelly ? `<div class="an-section">
    <div class="an-title">Kelly Criterion — Optimal Position Sizing</div>
    <div class="an-kelly-body">
      <div class="an-kelly-formula">f* = (b×p − (1−p)) / b = <strong>${_fmtPct(an.kelly.kelly)}</strong></div>
      <div class="an-kelly-grid">
        <div>Win rate (p) <strong>${_fmtPct(an.kelly.p)}</strong></div>
        <div>Avg win <strong>${_fmtUsd(an.kelly.avgWin)}</strong></div>
        <div>Avg loss <strong>${_fmtUsd(an.kelly.avgLoss)}</strong></div>
        <div>Win/loss ratio (b) <strong>${an.kelly.b.toFixed(2)}×</strong></div>
      </div>
      <div class="an-kelly-recs">
        <div class="an-kelly-rec ${an.kelly.kelly > 0 ? 'pos' : 'neg'}">Full Kelly: <strong>${_fmtPct(an.kelly.kelly)}</strong> of account</div>
        <div class="an-kelly-rec">Half Kelly (recommended): <strong>${_fmtPct(an.kelly.halfKelly)}</strong></div>
        <div class="an-kelly-rec muted">Quarter Kelly (conservative): <strong>${_fmtPct(an.kelly.quarterKelly)}</strong></div>
      </div>
      <div class="an-kelly-note">Use half/quarter Kelly — full Kelly maximises growth but has very high variance.</div>
    </div>
  </div>` : '';

  const overallWr = o.winRate;
  const patterns = an.patterns.length ? `<div class="an-section">
    <div class="an-title">Entry Patterns with Statistical Edge <span class="an-title-sub">— segments where your win rate diverges from your average</span></div>
    <div class="an-patterns-grid">
      ${an.patterns.map((p, i) => `<div class="an-pattern-card ${p.edge >= 0 ? 'good' : 'bad'}">
        <div class="an-pattern-rank">#${i + 1}</div>
        <div class="an-pattern-dim">${p.dimension}</div>
        <div class="an-pattern-val">${p.key}</div>
        <div class="an-pattern-wr ${_wrCls(p.winRate)}">${_fmtPct(p.winRate)} WR</div>
        <div class="an-pattern-meta">${p.count} trades · avg ${_fmtUsd(p.avgPnl)}</div>
        <div class="an-pattern-edge ${_pnlCls(p.edge)}">${p.edge >= 0 ? '+' : ''}${_fmtPct(p.edge)} vs avg</div>
      </div>`).join('')}
    </div>
  </div>` : '';

  return `<div class="an-wrap">
    ${cards}
    ${charts}
    <div class="an-breakdowns">
      ${_breakdownTable(an.bySide, 'By Side')}
      ${_breakdownTable(an.byDuration, 'By Hold Duration')}
      ${_breakdownTable(an.byDay, 'By Day of Week')}
      ${_breakdownTable(an.byHour, 'By Time of Day (UTC)')}
      ${_breakdownTable(an.byCoin.slice(0, 12), 'By Coin (top 12)')}
    </div>
    ${kelly}
    ${patterns}
    ${_renderAiSection(an)}
  </div>`;
}

// ── Charts ────────────────────────────────────────────────────────────────────

function _renderAnalyticsCharts(an) {
  const gridColor = '#1e1e1e', tickColor = '#666';

  const cumCtx = document.getElementById('an-cum-chart');
  if (cumCtx && an.cumSeries.length > 1) {
    if (_analyticsCharts.cum) _analyticsCharts.cum.destroy();
    const last = an.cumSeries[an.cumSeries.length - 1].v;
    _analyticsCharts.cum = new Chart(cumCtx, {
      type: 'line',
      data: {
        labels: an.cumSeries.map(p => fmtDate(p.t)),
        datasets: [{
          data: an.cumSeries.map(p => p.v),
          borderColor: last >= 0 ? '#4ade80' : '#f87171',
          backgroundColor: 'transparent',
          pointRadius: an.cumSeries.length < 30 ? 3 : 0,
          borderWidth: 2, tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tickColor, maxTicksLimit: 6 }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor, callback: v => '$' + v.toFixed(0) }, grid: { color: gridColor } }
        }
      }
    });
  }

  const distCtx = document.getElementById('an-dist-chart');
  if (distCtx && an.pnlDist.length) {
    if (_analyticsCharts.dist) _analyticsCharts.dist.destroy();
    _analyticsCharts.dist = new Chart(distCtx, {
      type: 'bar',
      data: {
        labels: an.pnlDist.map(b => b.label),
        datasets: [{
          data: an.pnlDist.map(b => b.count),
          backgroundColor: an.pnlDist.map(b => b.win ? 'rgba(74,222,128,0.75)' : 'rgba(248,113,113,0.75)'),
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tickColor, maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: tickColor }, grid: { color: gridColor } }
        }
      }
    });
  }
}

// ── AI Debrief ────────────────────────────────────────────────────────────────

function _renderAiSection(an) {
  return `<div class="an-section an-ai-section">
    <div class="an-title">AI Trade Debrief <span class="an-title-sub">— auto-routed via LLM router</span></div>
    <div class="an-ai-form">
      <div class="an-ai-btns">
        <button class="an-ai-btn primary" onclick="runAnalyticsDebrief()">Analyze My Trades</button>
        <button class="an-ai-btn" onclick="runRegimeBriefing()">Daily Regime Briefing</button>
      </div>
    </div>
    <div id="an-ai-result" class="an-ai-result" style="display:none"></div>
  </div>`;
}

async function runAnalyticsDebrief() {
  if (!_analyticsCache) { alert('Analytics not loaded yet.'); return; }
  _showAiLoading('Analyzing your trades…');
  const text = await _callLLM('debrief', _buildDebriefPrompt(_analyticsCache), { maxTokens: 1024 });
  if (text) _showAiResult(text);
  else _showAiError('LLM router unavailable — set hype_edge_fn_url in AI tab settings.');
}

async function runRegimeBriefing() {
  _showAiLoading('Generating regime briefing…');
  const text = await _callLLM('synthesis', _buildRegimePrompt(), { maxTokens: 512 });
  if (text) _showAiResult(text);
  else _showAiError('LLM router unavailable — set hype_edge_fn_url in AI tab settings.');
}

function _showAiLoading(msg) {
  const el = document.getElementById('an-ai-result');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div class="loading"><div class="spinner"></div> ${msg}</div>`;
}
function _showAiResult(text) {
  const el = document.getElementById('an-ai-result');
  if (!el) return;
  el.innerHTML = `<div class="an-ai-response">${_md(text)}</div>
    <button class="an-ai-btn" style="margin-top:10px" onclick="document.getElementById('an-ai-result').style.display='none'">Close</button>`;
}
function _showAiError(msg) {
  const el = document.getElementById('an-ai-result');
  if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px 0">Error: ${msg}</div>`;
}

function _buildDebriefPrompt(an) {
  const o = an.overall;
  const bySide = an.bySide.map(r => `  ${r.key}: ${r.count} trades, ${_fmtPct(r.winRate)} WR, ${_fmtUsd(r.totalPnl)}`).join('\n');
  const byDur  = an.byDuration.map(r => `  ${r.key}: ${r.count} trades, ${_fmtPct(r.winRate)} WR, ${_fmtUsd(r.avgPnl)} avg`).join('\n');
  const byDay  = an.byDay.map(r => `  ${r.key}: ${r.count} trades, ${_fmtPct(r.winRate)} WR`).join('\n');
  const coins  = an.byCoin.slice(0, 6).map(r => `  ${r.key}: ${r.count} trades, ${_fmtPct(r.winRate)} WR, ${_fmtUsd(r.totalPnl)}`).join('\n');
  const topPat = an.patterns[0];

  return `You are analyzing a crypto perps trader's Hyperliquid history. Be concise and data-driven — no generic advice.

PERFORMANCE:
- Closed trades: ${o.count} | Win rate: ${_fmtPct(o.winRate)} | Profit factor: ${o.profitFactor?.toFixed(2) ?? 'N/A'}
- Total P&L: ${_fmtUsd(o.totalPnl)} | Avg win: ${_fmtUsd(o.avgWin)} | Avg loss: ${_fmtUsd(o.avgLoss)}
- R:R: ${o.avgLoss ? (o.avgWin / Math.abs(o.avgLoss)).toFixed(2) : 'N/A'} | Avg hold: ${fmtHold(o.avgHoldMs)}

BY SIDE:\n${bySide}
BY DURATION:\n${byDur}
BY DAY:\n${byDay}
TOP COINS:\n${coins}
Kelly: ${an.kelly ? _fmtPct(an.kelly.kelly) + ' (half: ' + _fmtPct(an.kelly.halfKelly) + ')' : 'N/A'}
${topPat ? `Strongest pattern: ${topPat.dimension} → ${topPat.key} (${_fmtPct(topPat.winRate)} WR, ${topPat.edge >= 0 ? '+' : ''}${_fmtPct(topPat.edge)} vs avg)` : ''}

Provide ONLY these four sections (use ## headings):

## Key Patterns
2–3 bullet points of what the data clearly shows.

## Rules to Implement
2–3 specific, concrete trading rules this data suggests.

## Risk Management
1–2 bullets on sizing and loss management based on the Kelly number and loss stats.

## Contrarian Insight
One surprising or non-obvious observation from this data.`;
}

function _buildRegimePrompt() {
  const ind    = window._indData;
  const fg     = ind?.fearGreed;
  const bmsb   = ind?.bmsb;
  const pi     = ind?.piCycle;
  const flows  = window._nansenData?.netflows;
  const pos    = window._ovData?.positions || [];

  let indText = '';
  if (fg)    indText += `- Fear & Greed: ${fg.value} (${fg.classification})\n`;
  if (bmsb)  indText += `- BMSB: ${bmsb.signal} — BTC ${bmsb.signal === 'BULL' ? 'above' : 'below'} 20W SMA + 21W EMA\n`;
  if (pi)    indText += `- Pi Cycle: ${pi.signal} — 111d vs 350d×2 at ${pi.proximity?.toFixed(1)}% proximity\n`;
  if (flows?.length) {
    const top3 = flows.slice(0, 3).map(t => `${t.token?.symbol}: ${fmtFlow(t.netflow_usd_24h)}`).join(', ');
    indText += `- Smart money 24h flows: ${top3}\n`;
  }
  if (!indText) indText = '- Indicator data not loaded\n';

  const posText = pos.length
    ? pos.slice(0, 5).map(p => `${p.coin} ${(p.szi || 0) > 0 ? 'LONG' : 'SHORT'}`).join(', ')
    : 'none';

  let sigText = '';
  const sigResults = window._sigLastResults;
  if (sigResults?.length) {
    const entries = sigResults.filter(r => r.verdict === 'ENTRY');
    if (entries.length) {
      sigText = `- Signal scanner ENTRY: ${entries.map(r => `${r.coin} score ${r.score}/10 phase ${r.phase}`).join(', ')}\n`;
    } else {
      sigText = `- Signal scanner: no entries — ${sigResults.map(r => `${r.coin} ${r.score}/10`).join(', ')}\n`;
    }
  }

  return `You are a brief market analyst for a crypto perps trader on Hyperliquid. Today: ${new Date().toDateString()}.

INDICATORS:\n${indText}${sigText}OPEN POSITIONS: ${posText}

Write a 3–4 sentence daily regime briefing covering:
1. Current regime classification (risk-on / risk-off / transitional)
2. Key risk to watch in the next 24–48h
3. One tactical suggestion for the current setup

Be direct. No disclaimers.`;
}

// Very small markdown → HTML (only what Claude outputs)
function _md(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm,  '<h4 class="an-ai-h">$1</h4>')
    .replace(/^### (.+)$/gm, '<h5 class="an-ai-h">$1</h5>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?=\n*(?:<h|$))/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^([^<\n].+)$/gm, (m) => m.startsWith('<') ? m : `<p>${m}</p>`)
    .replace(/<p><\/p>/g, '');
}

// ── Load ──────────────────────────────────────────────────────────────────────

let _analyticsTab = 'stats';

function setAnalyticsTab(tab, btn) {
  _analyticsTab = tab;
  document.querySelectorAll('.an-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('analytics-content');
  if (!el) return;
  if (tab === 'logger') {
    _renderLoggerTab(el);
  } else {
    _renderStatsTab(el);
  }
}

function _renderTabBar() {
  return `<div class="an-tabbar">
    <button class="an-tab${_analyticsTab === 'stats'  ? ' active' : ''}" onclick="setAnalyticsTab('stats',this)">Stats &amp; ML</button>
    <button class="an-tab${_analyticsTab === 'logger' ? ' active' : ''}" onclick="setAnalyticsTab('logger',this)">Data Logger</button>
  </div>`;
}

function _renderLoggerTab(el) {
  el.innerHTML = _renderTabBar() + (typeof renderLoggerSettings === 'function'
    ? renderLoggerSettings()
    : '<div style="padding:24px;color:var(--text-muted)">Logger not loaded.</div>');
}

function _renderStatsTab(el) {
  if (!_analyticsCache) {
    el.innerHTML = _renderTabBar() + '<div style="padding:24px;color:var(--text-muted)">No closed trades found yet.</div>';
    return;
  }
  el.innerHTML = _renderTabBar() + renderAnalytics(_analyticsCache);
  requestAnimationFrame(() => _renderAnalyticsCharts(_analyticsCache));
}

async function loadAnalytics() {
  const el = document.getElementById('analytics-content');
  if (!el) return;

  if (_analyticsTab === 'logger') {
    _renderLoggerTab(el);
    return;
  }

  if (!currentWallet) {
    el.innerHTML = _renderTabBar() + '<div style="padding:24px;color:var(--text-muted)">Connect a wallet to view analytics.</div>';
    return;
  }

  if (!_analyticsCache || Date.now() - _analyticsTs > ANALYTICS_TTL) {
    el.innerHTML = _renderTabBar() + '<div class="loading"><div class="spinner"></div> Building analytics…</div>';
    try {
      const rawFills = await getUserFills(currentWallet);
      const trades   = typeof buildTrades === 'function' ? buildTrades(rawFills) : [];
      _analyticsCache = buildAnalytics(trades);
      _analyticsTs    = Date.now();
    } catch (err) {
      el.innerHTML = _renderTabBar() + `<div style="padding:24px;color:var(--red)">Failed to load fills: ${err.message}</div>`;
      return;
    }
  }

  _renderStatsTab(el);
}
