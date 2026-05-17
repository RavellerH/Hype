// ── Cryptowatch Research Snapshot ────────────────────────────────────────────
// Update this object whenever you paste fresh research from cryptowatch.id
const INTEL = {
  snapshot_date: '2026-05-17',
  source: 'cryptowatch.id',

  // ── MACRO ─────────────────────────────────────────────────────────────────
  macro: {
    posture: 'WAIT',
    posture_score: -1,       // ±10 scale
    posture_confidence: 70,
    cycle_phase: 'Accumulation',
    bottom_proximity_pct: 28,
    capital_flow_30d: '+$8.47B',
    capital_flow_lead: 'Stablecoins INFLOW',
    btc_funding_apr: '+2.8%',
    btc_funding_note: 'Calm · no crowding · OI $2.24B',
    btc_oi: '$2.24B',
    cycle_today: 'SIDEWAYS',
    cycle_accuracy: '40%',
    bottom_radar: 84,
    bottom_signals: 10,
    neutral_signals: 2,
    top_signals: 2,

    // Regime Radar axes (0–10 scale)
    regime_radar: {
      Macro: 5, Cycle: 6, OnChain: 7,
      Derivs: 4, Funding: 6, ETF: 3, Sentiment: 3,
    },

    // Evidence trail layers
    evidence_layers: [
      { name: 'L1 Macro',     score: 6, max: 10, receipts: 8,  verdict: 'NEUTRAL' },
      { name: 'L2 Cycle',     score: 5, max: 10, receipts: 5,  verdict: 'NEUTRAL' },
      { name: 'L3 Capital',   score: 5, max: 10, receipts: 10, verdict: 'NEUTRAL' },
      { name: 'L4 Execution', score: 3, max: 10, receipts: 5,  verdict: 'BEARISH' },
    ],

    cohorts: [
      { name: 'LTH',          stance: 'accumulating', detail: '+131,133 BTC · 30d',         bull: true  },
      { name: 'ETF · TradFi', stance: 'distributing', detail: '−$1,410M · 7d',              bull: false },
      { name: 'Smart Money',  stance: 'neutral',       detail: 'Nansen sub cancelled 05-15', bull: false },
    ],

    notable_moves: [
      { metric: 'Puell Multiple',      z: '+1.65σ', change: '+17.10%', value: '0.9953',    zNum:  1.65 },
      { metric: 'AHR999',              z: '+1.30σ', change:  '+3.96%', value: '0.5286',    zNum:  1.30 },
      { metric: 'BTC Price',           z: '+0.78σ', change:  '+1.32%', value: '$80.90k',   zNum:  0.78 },
      { metric: 'MVRV Z-Score',        z: '+0.73σ', change:  '+3.94%', value: '0.9187',    zNum:  0.73 },
      { metric: 'Reserve Risk',        z: '+0.72σ', change:  '+1.23%', value: '0.001214',  zNum:  0.72 },
      { metric: 'NUPL',                z: '+0.63σ', change:  '+2.66%', value: '0.3297',    zNum:  0.63 },
      { metric: 'Hot Capital Share',   z: '−0.08σ', change:  '−0.17%', value: '12.07%',   zNum: -0.08 },
    ],
  },

  // ── HUNTER ────────────────────────────────────────────────────────────────
  hunter: {
    regime: 'CAUTION',
    regime_score: -1,
    regime_max: 10,
    heat: 41.8,
    heat_note: 'cool — opportunity zone',
    btc_funding: '+2.8%',
    smart_money: 'IDLE',
    btc_dominance: '60.4%',
    altcoin_breadth: '16%',
    whale_net_flow: '-$1.19M',
    whale_buy_pressure: 46,
    leading_narrative: 'RWA',
    narrative_rotation: 'none → rwa',
    ai_verdict: 'CAUTION',
    ai_confidence: 'medium',
    ai_summary: "ONDO is down 18% in 7d while RWA mindshare leads — buy the bleed, not the breakout. Attention is rotating into RWA before price has caught up, and ONDO is the only ticker in the cohort with real mindshare against a deeply discounted tape. Smart money is idle and heat is cool — patient accumulation setup, not a chase. Size small until BTC.D rolls or smart money confirms.",
    conviction_stack: [
      { signal: 'Morning Verdict',   pass: true  },
      { signal: 'Risk Regime',       pass: true  },
      { signal: 'Narrative Entries', pass: false },
      { signal: 'Smart Money',       pass: true  },
      { signal: 'Concentration',     pass: false },
    ],
    plays: [
      { coin: 'ONDO',  action: 'ENTRY', narrative: 'RWA', reason: "Mindshare 0.24 in cohort, 7d −18% — attention/price gap is the entry. Scale in, don't chase a green candle." },
      { coin: 'ENA',   action: 'HOLD',  narrative: 'RWA', reason: "−17.8% in 7d but zero mindshare — cheap beta if RWA confirms. Wait for ONDO to lead before adding." },
      { coin: 'POLYX', action: 'HOLD',  narrative: 'RWA', reason: "Already +3.1% in 7d — easy entry is behind us. Monitor for continuation as thesis confirmation." },
    ],
    avoid: [
      { coin: 'BIOHACK', reason: 'CT emergence MIXED with possible shill signal — no confirmed flows, no confirmation.' },
      { coin: 'GAMBLE',  reason: 'CT HYPE with strong shill signal tied to Toshi.bet promo — reflexive only, not a narrative.' },
    ],
    risk: 'BTC.D is 60.4% and rising (day 1). If dominance grinds above 61%, RWA mindshare stays trapped and prices keep bleeding. Cut entry if ONDO fails to hold current range over 3–5 days or BTC.D pushes through 61%.',
    narratives_top: [
      { name: 'rwa',          score: 11 },
      { name: 'l1s',          score: 19 },
      { name: 'memecoins',    score: 16 },
      { name: 'perps dex',    score: 14 },
      { name: 'btc ecosystem',score: 14 },
    ],
  },

  // ── DESK SETUPS ───────────────────────────────────────────────────────────
  desk: {
    killzone: 'ASIA · 01:39 UTC',
    market_stats: [
      { label: 'Funding',          value: '0.0026%', sub: 'z 0.46',         coin: 'BTC' },
      { label: 'Open Interest',    value: '$58.33B',  sub: 'Δ4H −0.46%',    coin: 'BTC' },
      { label: 'Options Skew 25Δ', value: '−13.8',   sub: 'mild risk-off',  coin: 'BTC' },
      { label: 'DVOL',             value: '40.5',     sub: 'steep contango', coin: 'BTC' },
    ],
    setups: [
      {
        coin: 'BTC', htf_bias: 'BULL',
        scalp: 'LONG', intraday: 'LONG', swing: 'NO-TRADE',
        quant: { type: 'stat_arb', detail: 'Short BTC / Long ETH · z=+2.20 (60d) · BTC rich vs ETH · mean-revert 3–10 days · delta-flat' },
        entries: [
          { profile: 'scalp moderate',    dir: 'LONG', entry: 78120.42, stop: 78026.55, tp1: 78261.23, tp2: 78355.10, tp3: 78448.97, rr: '1:2.5', conf: '6/10' },
          { profile: 'intraday moderate', dir: 'LONG', entry: 78634.17, stop: 78248.77, tp1: 79404.96, tp2: 79790.35, tp3: 80175.75, rr: '1:3.0', conf: '5/10' },
        ],
        note: 'Scalp inv: price below 77,812. Intraday inv: 1H close below EMA50 (78,928)',
      },
      {
        coin: 'ETH', htf_bias: 'BEAR',
        scalp: 'SHORT', intraday: 'SHORT', swing: 'NO-TRADE',
        quant: { type: 'stat_arb', detail: 'Short BTC / Long ETH · z=+2.20 (60d) · ETH cheap vs BTC · delta-flat' },
        entries: [
          { profile: 'scalp moderate',    dir: 'SHORT', entry: 2180.22, stop: 2183.16, tp1: 2175.80, tp2: 2172.86, tp3: 2169.92, rr: '1:2.5', conf: '8/10' },
          { profile: 'intraday moderate', dir: 'SHORT', entry: 2199.69, stop: 2213.56, tp1: 2171.94, tp2: 2158.07, tp3: 2144.20, rr: '1:3.0', conf: '5/10' },
        ],
        note: 'Invalidation: 1H close above EMA50 (2,211.43)',
      },
      {
        coin: 'SOL', htf_bias: 'BEAR',
        scalp: 'SHORT', intraday: 'NO-TRADE', swing: 'NO-TRADE',
        quant: { type: 'funding_harvest', detail: 'Short perp / Long spot · +10.95% APR gross (~7.1% net) · delta-neutral' },
        entries: [
          { profile: 'scalp moderate',   dir: 'SHORT', entry: 86.34, stop: 86.54, tp1: 86.05, tp2: 85.85, tp3: 85.65, rr: '1:2.5', conf: '7/10' },
          { profile: 'scalp aggressive', dir: 'SHORT', entry: 85.84, stop: 86.80, tp1: 83.44, tp2: 81.99, tp3: 80.07, rr: '1:4.2', conf: '7/10' },
        ],
        note: 'Inv: price above 86.72. Intraday confluence 4/10 — no-trade.',
      },
      {
        coin: 'HYPE', htf_bias: 'BULL',
        scalp: 'LONG', intraday: 'NO-TRADE', swing: 'NO-TRADE',
        quant: { type: 'funding_harvest', detail: 'Long perp / Short spot · −11.94% APR gross (~7.8% net) · delta-neutral' },
        entries: [
          { profile: 'scalp moderate',   dir: 'LONG', entry: 41.77, stop: 41.59, tp1: 42.05, tp2: 42.23, tp3: 42.41, rr: '1:2.5', conf: '5/10' },
          { profile: 'scalp aggressive', dir: 'LONG', entry: 41.54, stop: 41.27, tp1: 42.22, tp2: 42.63, tp3: 43.18, rr: '1:4.2', conf: '5/10' },
        ],
        note: 'Inv: price below 41.35. Intraday confluence 4/10 — no-trade.',
      },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _postureColor(p) {
  return p === 'BUY' || p === 'BULL'   ? 'var(--green)'      :
         p === 'SELL' || p === 'BEAR'  ? 'var(--red)'        :
         p === 'CAUTION'               ? 'var(--yellow)'     : 'var(--text-muted)';
}

function _verdictCls(v) {
  return v === 'BULLISH' ? 'pos' : v === 'BEARISH' ? 'neg' : 'muted';
}

// ── Render Intel Page ─────────────────────────────────────────────────────────

function intelIndicatorStrip() {
  const ind = window._indData;
  if (!ind) return `<div class="ind-strip-loading">Loading indicators… <span class="muted">(visit Indicators tab first or wait)</span></div>`;
  const fg = ind.fear_greed, bmsb = ind.bmsb, pi = ind.pi_cycle;
  const fgCls = fg ? (fg.value < 30 ? 'neg' : fg.value > 70 ? 'pos' : 'muted') : 'muted';
  const bmsbCls = bmsb ? (bmsb.signal === 'BULL' ? 'pos' : bmsb.signal === 'BEAR' ? 'neg' : 'yellow') : 'muted';
  const piCls = pi ? (pi.signal === 'TOP' ? 'neg' : pi.signal === 'WARNING' ? 'yellow' : 'pos') : 'muted';
  return `<div class="ind-strip">
    <div class="ind-chip"><span class="ind-label">F&G</span><span class="${fgCls} mono">${fg ? fg.value : '—'}</span><span class="ind-badge ind-${fg?.zone?.toLowerCase()||'neutral'}">${fg ? fg.classification : 'N/A'}</span></div>
    <div class="ind-chip"><span class="ind-label">BMSB</span><span class="${bmsbCls} mono">${bmsb ? bmsb.signal : '—'}</span></div>
    <div class="ind-chip"><span class="ind-label">Pi Cycle</span><span class="${piCls} mono">${pi ? pi.proximity+'%' : '—'}</span><span class="ind-badge ind-${pi?.signal?.toLowerCase()||'normal'}">${pi ? pi.signal : 'N/A'}</span></div>
    <div class="ind-chip"><span class="ind-label">MVRV Z</span><span class="mono">${typeof _mvrvData !== 'undefined' && _mvrvData?.summary?.z_score ? _mvrvData.summary.z_score.toFixed(2) : '—'}</span></div>
  </div>`;
}

function loadIntel() {
  const el = document.getElementById('intel-content');
  if (!el) return;
  const m = INTEL.macro;
  const h = INTEL.hunter;
  const d = INTEL.desk;

  // Score bar: posture_score on ±10 scale → 0–100%
  const scorePct    = ((m.posture_score + 10) / 20) * 100;
  const scoreColor  = m.posture_score > 2 ? 'var(--green)' : m.posture_score < -2 ? 'var(--red)' : 'var(--yellow)';
  const heatColor   = h.heat > 60 ? 'var(--red)' : h.heat > 40 ? 'var(--yellow)' : 'var(--green)';
  const altNum      = parseInt(h.altcoin_breadth);
  const btcDomNum   = parseFloat(h.btc_dominance);

  // Evidence trail overall
  const evTotal = m.evidence_layers.reduce((a, l) => a + l.score, 0);
  const evMax   = m.evidence_layers.reduce((a, l) => a + l.max,   0);
  const evPct   = Math.round((evTotal / evMax) * 100);

  el.innerHTML = `
    ${intelIndicatorStrip()}

    <!-- ─── Portfolio Posture Banner ──────────────────────────────────── -->
    <div class="intel-posture-banner">
      <div class="intel-posture-main">
        <div>
          <div class="intel-posture-label">PORTFOLIO POSTURE</div>
          <div class="regime-pill regime-${m.posture} intel-posture-verdict">${m.posture}</div>
        </div>
        <div class="intel-posture-score-wrap">
          <div class="intel-posture-score-label">
            Score <span style="font-family:var(--mono);color:${scoreColor}">${m.posture_score > 0 ? '+' : ''}${m.posture_score}</span> / ±10
          </div>
          <div class="intel-score-track">
            <div class="intel-score-fill" style="width:${scorePct}%;background:${scoreColor}"></div>
            <div class="intel-score-mid"></div>
          </div>
          <div class="intel-posture-conf">${m.posture_confidence}% confidence</div>
        </div>
        <div class="intel-posture-meta">
          <div><span class="intel-meta-label">Cycle</span><span class="intel-meta-val accent">${m.cycle_phase}</span></div>
          <div><span class="intel-meta-label">Today</span><span class="intel-meta-val">${m.cycle_today} <span class="muted" style="font-size:10px">${m.cycle_accuracy}</span></span></div>
          <div><span class="intel-meta-label">Snap</span><span class="intel-meta-val muted">${INTEL.snapshot_date}</span></div>
        </div>
      </div>
      <div class="intel-posture-badges">
        <span class="regime-pill regime-${h.regime}">Hunter: ${h.regime}</span>
        <span class="regime-pill regime-${m.posture}">Macro: ${m.posture}</span>
      </div>
    </div>

    <!-- ─── Key Metrics Strip ─────────────────────────────────────────── -->
    <div class="stat-strip">
      <div class="stat-cell">
        <div class="stat-label">Market Heat</div>
        <div class="stat-value" style="color:${heatColor}">${h.heat}</div>
        <div class="stat-sub">${h.heat_note}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">BTC Funding APR</div>
        <div class="stat-value ${m.btc_funding_apr.startsWith('+') ? 'pos' : 'neg'}">${m.btc_funding_apr}</div>
        <div class="stat-sub">${m.btc_funding_note}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Alt Breadth</div>
        <div class="stat-value ${altNum < 30 ? 'neg' : altNum > 60 ? 'pos' : ''}">${h.altcoin_breadth}</div>
        <div class="stat-sub">% alts up</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">BTC Dominance</div>
        <div class="stat-value">${h.btc_dominance}</div>
        <div class="stat-sub">alt season ${btcDomNum > 55 ? 'far' : 'near'}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">Smart Money</div>
        <div class="stat-value" style="color:${h.smart_money === 'ACTIVE' ? 'var(--green)' : 'var(--text-muted)'}">${h.smart_money}</div>
        <div class="stat-sub">Whale ${h.whale_net_flow}</div>
      </div>
      <div class="stat-cell">
        <div class="stat-label">30D Capital</div>
        <div class="stat-value pos">${m.capital_flow_30d}</div>
        <div class="stat-sub">${m.capital_flow_lead}</div>
      </div>
    </div>

    <!-- ─── Main 2-col grid ───────────────────────────────────────────── -->
    <div class="intel-main-grid">

      <!-- LEFT: Radar + Notable Moves -->
      <div class="intel-col">

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="card-title" style="margin:0">Regime Radar</div>
            <span class="muted" style="font-size:10px">0 – 10 per axis</span>
          </div>
          <div class="intel-radar-wrap">
            <canvas id="regime-radar-chart" width="240" height="240"></canvas>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
            ${Object.entries(m.regime_radar).map(([k, v]) => {
              const color = v >= 7 ? 'var(--green)' : v >= 5 ? 'var(--yellow)' : 'var(--red)';
              return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;padding:2px 7px;background:var(--surface2);border-radius:var(--radius-pill);border:1px solid var(--border)">
                <span style="color:var(--text-muted)">${k}</span>
                <span style="font-family:var(--mono);font-weight:700;color:${color}">${v}</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-title">What Changed Today</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Metric</th><th class="num">Z-Score</th><th style="width:72px">Δ Magnitude</th><th class="num">Δ%</th><th class="num">Value</th></tr></thead>
              <tbody>
                ${m.notable_moves.map(mv => {
                  const pos    = mv.zNum >= 0;
                  const barPct = Math.min(Math.abs(mv.zNum) / 3 * 100, 100);
                  return `<tr>
                    <td>${mv.metric}</td>
                    <td class="num ${pos ? 'pos' : 'neg'}">${mv.z}</td>
                    <td>
                      <div class="intel-zbar">
                        <div class="intel-zbar-fill ${pos ? 'pos-fill' : 'neg-fill'}" style="width:${barPct}%"></div>
                      </div>
                    </td>
                    <td class="num ${mv.change.startsWith('+') ? 'pos' : 'neg'}">${mv.change}</td>
                    <td class="num muted">${mv.value}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div><!-- /intel-col left -->

      <!-- RIGHT: Bottom Radar + Evidence + Cohorts -->
      <div class="intel-col">

        <div class="card">
          <div class="card-title">Cycle Bottom Radar</div>
          <div class="intel-bottom-score">
            <span class="intel-radar-score" style="color:var(--green)">${m.bottom_radar}</span>
            <span class="muted" style="font-size:13px;margin-left:2px">/100</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);text-align:center;margin-bottom:10px">Strong bottom cluster</div>
          <div class="progress-bar" style="margin-bottom:12px">
            <div class="progress-fill" style="width:${m.bottom_radar}%;background:var(--green)"></div>
          </div>
          <div class="intel-vote-row">
            <div class="intel-vote-cell" style="background:var(--green-bg)">
              <div style="font-size:20px;font-weight:800;color:var(--green)">${m.bottom_signals}</div>
              <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Bottom</div>
            </div>
            <div class="intel-vote-cell" style="background:var(--surface2)">
              <div style="font-size:20px;font-weight:800;color:var(--text-muted)">${m.neutral_signals}</div>
              <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Neutral</div>
            </div>
            <div class="intel-vote-cell" style="background:var(--red-bg)">
              <div style="font-size:20px;font-weight:800;color:var(--red)">${m.top_signals}</div>
              <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Top</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="card-title" style="margin:0">Evidence Trail</div>
            <span style="font-family:var(--mono);font-size:12px;color:var(--accent)">${evPct}%</span>
          </div>
          ${m.evidence_layers.map(l => {
            const pct   = Math.round((l.score / l.max) * 100);
            const color = l.score >= 7 ? 'var(--green)' : l.score >= 5 ? 'var(--yellow)' : 'var(--red)';
            return `<div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:11px;font-weight:600">${l.name}</span>
                <div style="display:flex;gap:6px;align-items:center">
                  <span class="${_verdictCls(l.verdict)}" style="font-size:10px;font-weight:600">${l.verdict}</span>
                  <span style="font-family:var(--mono);font-size:11px;color:${color}">${l.score}/${l.max}</span>
                  <span class="muted" style="font-size:9px">${l.receipts} sigs</span>
                </div>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
              </div>
            </div>`;
          }).join('')}
        </div>

        <div class="card">
          <div class="card-title">Cohort Confluence</div>
          ${m.cohorts.map(c => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:12px;font-weight:600">${c.name}</div>
              <div class="muted" style="font-size:10px;margin-top:2px">${c.detail}</div>
            </div>
            <span class="side-badge ${c.bull ? 'long' : 'short'}">${c.stance.toUpperCase()}</span>
          </div>`).join('')}
        </div>

      </div><!-- /intel-col right -->
    </div><!-- /intel-main-grid -->

    <!-- ─── AI Synthesis ──────────────────────────────────────────────── -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div class="card-title" style="margin:0">AI Synthesis · Cryptowatch</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="regime-pill regime-${h.ai_verdict}">${h.ai_verdict}</span>
          <span class="muted" style="font-size:10px">${h.ai_confidence} confidence</span>
        </div>
      </div>
      <blockquote class="intel-quote">${h.ai_summary}</blockquote>

      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">
        ${h.conviction_stack.map(s => `
        <div class="intel-conviction ${s.pass ? 'conv-pass' : 'conv-fail'}">
          ${s.pass ? '✓' : '✗'} ${s.signal}
        </div>`).join('')}
        <span class="muted" style="font-size:11px;padding:4px 4px;align-self:center">
          ${h.conviction_stack.filter(s => s.pass).length}/${h.conviction_stack.length} agree
        </span>
      </div>

      <div class="intel-narrative-bar">
        <span class="muted" style="font-size:11px">Rotation:</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--yellow)">${h.narrative_rotation}</span>
        <span class="muted" style="font-size:11px">Leading: <b style="color:var(--accent)">${h.leading_narrative}</b></span>
      </div>

      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px">
        ${h.narratives_top.map(n => `
        <div class="intel-narrative-chip">${n.name} <span class="muted">${n.score}</span></div>`).join('')}
      </div>
    </div>

    <!-- ─── Plays & Avoid ─────────────────────────────────────────────── -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title" style="color:var(--green)">▲ Plays</div>
        ${h.plays.map(p => `
        <div class="play-card play-${p.action}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-weight:700;font-size:14px;font-family:var(--mono)">${p.coin}</span>
            <div style="display:flex;gap:5px">
              <span class="play-action-badge action-${p.action}">${p.action}</span>
              <span style="font-size:10px;color:var(--text-muted);padding:2px 6px;background:var(--surface2);border-radius:4px">${p.narrative}</span>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.5">${p.reason}</div>
        </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-title" style="color:var(--red)">▼ Avoid</div>
        ${h.avoid.map(a => `
        <div class="intel-avoid-card">
          <div style="font-weight:700;font-size:13px;font-family:var(--mono);color:var(--red);margin-bottom:4px">${a.coin}</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.5">${a.reason}</div>
        </div>`).join('')}
        <div class="intel-risk-box">
          <div style="font-size:10px;font-weight:700;color:var(--yellow);margin-bottom:4px">⚠ RISK TO THESIS</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.5">${h.risk}</div>
        </div>
      </div>
    </div>

    <!-- ─── Desk Setups ───────────────────────────────────────────────── -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
        <div class="card-title" style="margin:0">Desk Setups · Active Entries</div>
        <span class="muted" style="font-size:11px">${d.killzone}</span>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
        ${d.market_stats.map(ms => `
        <div class="intel-desk-stat">
          <div class="intel-desk-stat-label">${ms.coin} ${ms.label}</div>
          <div class="intel-desk-stat-value">${ms.value}</div>
          <div class="muted" style="font-size:10px">${ms.sub}</div>
        </div>`).join('')}
      </div>

      ${d.setups.map(s => deskSetupBlock(s)).join('')}
    </div>
  `;

  // Kick off radar chart after DOM is ready
  setTimeout(renderRegimeRadar, 0);
}

// ── Regime Radar Chart ────────────────────────────────────────────────────────

function renderRegimeRadar() {
  const canvas = document.getElementById('regime-radar-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const data   = INTEL.macro.regime_radar;
  const labels = Object.keys(data);
  const values = Object.values(data);
  new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor:   'rgba(56,189,248,0.08)',
        borderColor:       '#38bdf8',
        borderWidth:       1.5,
        pointBackgroundColor: '#38bdf8',
        pointBorderColor:     '#0a0a0a',
        pointRadius:       3,
        pointHoverRadius:  4,
      }],
    },
    options: {
      animation: false,
      scales: {
        r: {
          min: 0, max: 10,
          ticks: { display: false, stepSize: 2 },
          grid:        { color: 'rgba(36,36,36,0.9)' },
          angleLines:  { color: 'rgba(36,36,36,0.9)' },
          pointLabels: { color: '#6b7280', font: { size: 10, family: "'Inter', sans-serif" } },
        },
      },
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
    },
  });
}

// ── Desk Setup Block ──────────────────────────────────────────────────────────

function deskSetupBlock(s) {
  const biasColor  = s.htf_bias === 'BULL' ? 'var(--green)' : s.htf_bias === 'BEAR' ? 'var(--red)' : 'var(--text-muted)';
  const hasEntries = s.entries.length > 0;
  const quant      = s.quant;
  return `
  <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-weight:700;font-size:15px;font-family:var(--mono)">${s.coin}</span>
      <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${biasColor}1a;color:${biasColor}">HTF ${s.htf_bias}</span>
      ${s.scalp    !== 'NO-TRADE' ? `<span class="side-badge ${s.scalp    === 'LONG' ? 'long' : 'short'}" style="font-size:10px">SCALP ${s.scalp}</span>`    : ''}
      ${s.intraday !== 'NO-TRADE' ? `<span class="side-badge ${s.intraday === 'LONG' ? 'long' : 'short'}" style="font-size:10px">INTRADAY ${s.intraday}</span>` : ''}
      ${s.swing    !== 'NO-TRADE' ? `<span class="side-badge ${s.swing    === 'LONG' ? 'long' : 'short'}" style="font-size:10px">SWING ${s.swing}</span>`    : ''}
      ${!hasEntries ? `<span class="muted" style="font-size:11px">No-trade all profiles</span>` : ''}
    </div>
    ${hasEntries ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Profile</th><th>Dir</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">TP1</th><th class="num">TP2</th><th class="num">TP3</th><th class="num">R:R</th><th class="num">Conf</th></tr></thead>
        <tbody>
          ${s.entries.map(e => `<tr>
            <td class="muted">${e.profile}</td>
            <td><span class="side-badge ${e.dir === 'LONG' ? 'long' : 'short'}" style="font-size:10px">${e.dir}</span></td>
            <td class="num" style="color:var(--accent)">${e.entry}</td>
            <td class="num neg">${e.stop}</td>
            <td class="num pos">${e.tp1}</td>
            <td class="num pos">${e.tp2}</td>
            <td class="num pos">${e.tp3}</td>
            <td class="num" style="font-weight:600">${e.rr}</td>
            <td class="num muted">${e.conf}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
    ${quant ? `<div style="margin-top:8px;padding:8px 10px;background:var(--accent-subtle);border:1px solid rgba(56,189,248,0.2);border-radius:var(--radius-md);font-size:11px">
      <span style="color:var(--accent);font-weight:600">QUANT ·</span> ${quant.detail}
    </div>` : ''}
    ${s.note ? `<div class="muted" style="font-size:10px;margin-top:6px">ℹ ${s.note}</div>` : ''}
  </div>`;
}
