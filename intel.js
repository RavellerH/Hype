// ── Cryptowatch Research Snapshot ────────────────────────────────────────────
// Update this object whenever you paste fresh research from cryptowatch.id
const INTEL = {
  snapshot_date: '2026-05-14',
  source: 'cryptowatch.id',

  // ── MACRO ─────────────────────────────────────────────────────────────────
  macro: {
    posture: 'WAIT',
    posture_score: -0.5,     // ±10 scale
    posture_confidence: 71,
    cycle_phase: 'Accumulation',
    bottom_proximity_pct: 28,
    capital_flow_30d: '+$6.01B',
    capital_flow_lead: 'Stablecoins INFLOW',
    btc_funding_apr: '+5.0%',
    btc_funding_note: 'Calm · no crowding',
    btc_oi: '$2.25B',
    cycle_today: 'SIDEWAYS',
    cycle_accuracy: '70%',
    bottom_radar: 84,
    bottom_signals: 10,
    neutral_signals: 2,
    top_signals: 2,

    // Regime Radar axes (0–10 scale)
    regime_radar: {
      Macro: 4, Cycle: 6, OnChain: 7,
      Derivs: 5, Funding: 6, ETF: 3, Sentiment: 4,
    },

    // Evidence trail layers
    evidence_layers: [
      { name: 'L1 Macro',     score: 4, max: 10, receipts: 3, verdict: 'NEUTRAL' },
      { name: 'L2 Cycle',     score: 6, max: 10, receipts: 5, verdict: 'BULLISH' },
      { name: 'L3 Capital',   score: 7, max: 10, receipts: 4, verdict: 'BULLISH' },
      { name: 'L4 Execution', score: 5, max: 10, receipts: 3, verdict: 'NEUTRAL' },
    ],

    cohorts: [
      { name: 'LTH',          stance: 'accumulating', detail: '+131,133 BTC · 30d', bull: true },
      { name: 'ETF · TradFi', stance: 'distributing', detail: '−$127M · 7d',        bull: false },
      { name: 'Smart Money',  stance: 'accumulating', detail: 'stable Δ −3.63% · 24h', bull: true },
    ],

    notable_moves: [
      { metric: 'Puell Multiple',  z: '+1.65σ', change: '+17.10%', value: '0.9953',  zNum:  1.65 },
      { metric: 'AHR999',          z: '+1.30σ', change:  '+3.96%', value: '0.5286',  zNum:  1.30 },
      { metric: 'BTC Price',       z: '+0.78σ', change:  '+1.32%', value: '$80.90k', zNum:  0.78 },
      { metric: 'MVRV Z-Score',    z: '+0.73σ', change:  '+3.94%', value: '0.9187',  zNum:  0.73 },
      { metric: 'NUPL',            z: '+0.63σ', change:  '+2.66%', value: '0.3297',  zNum:  0.63 },
      { metric: 'Hot Capital Share', z: '−0.43σ', change: '−0.90%', value: '12.16%', zNum: -0.43 },
    ],
  },

  // ── HUNTER ────────────────────────────────────────────────────────────────
  hunter: {
    regime: 'CAUTION',
    regime_score: 0,
    regime_max: 10,
    heat: 41.8,
    heat_note: 'cool — opportunity zone',
    btc_funding: '+5.0%',
    smart_money: 'IDLE',
    btc_dominance: '60.4%',
    altcoin_breadth: '24%',
    whale_net_flow: '+$202K',
    whale_buy_pressure: 51,
    leading_narrative: 'Privacy',
    narrative_rotation: 'perps_dex → privacy',
    ai_verdict: 'CAUTION',
    ai_confidence: 'medium',
    ai_summary: "ZEC's attention lead is the only clean trade, but a cool tape and idle smart money say keep size small. Privacy is the one narrative where mindshare is leading price — ZEC is the expression, with ROSE already moving and TORN broken.",
    conviction_stack: [
      { signal: 'Morning Verdict',   pass: true  },
      { signal: 'Risk Regime',       pass: true  },
      { signal: 'Narrative Entries', pass: false },
      { signal: 'Smart Money',       pass: true  },
      { signal: 'Concentration',     pass: false },
    ],
    plays: [
      { coin: 'ZEC',  action: 'ENTRY', narrative: 'Privacy', reason: "Highest mindshare (0.24) while 7d price still −2.1% — attention leading price. Starter size." },
      { coin: 'ROSE', action: 'HOLD',  narrative: 'Privacy', reason: "Already +7.7% 7d — confirms the thesis but entry is later than ZEC. Treat as validation." },
      { coin: 'PC',   action: 'ENTRY', narrative: 'Infra',   reason: "Only REAL verdict in CT emergence — Push Chain universal execution layer, no shill signal. Small size." },
    ],
    avoid: [
      { coin: 'AEON', reason: '10x from sub-300k MC, HYPE verdict, strong shill signal — too late.' },
      { coin: 'BXE',  reason: 'HYPE + strong shill on XRPL low-cap riding a Chrome extension headline.' },
      { coin: 'DAD',  reason: 'Solana meme, thin narrative, possible coordinated shilling.' },
    ],
    risk: 'Privacy mindshare fades before price catches up. Watch: ZEC mindshare decaying over 2–3 days + ROSE giving back 7d gains + smart money staying idle.',
    narratives_top: [
      { name: 'desci',        score: 3.5 },
      { name: 'rwa',          score: 3.6 },
      { name: 'sol ecosystem',score: 3.4 },
      { name: 'l2s',          score: 3.5 },
      { name: 'restaking',    score: 3.5 },
    ],
  },

  // ── DESK SETUPS ───────────────────────────────────────────────────────────
  desk: {
    killzone: 'NONE · NY_AM soon',
    market_stats: [
      { label: 'Funding',          value: '0.0046%', sub: 'z 1.58',        coin: 'BTC' },
      { label: 'Open Interest',    value: '$59.77B',  sub: 'Δ4H −0.69%',   coin: 'BTC' },
      { label: 'Liquidations',     value: '$73.5M',   sub: '24H',           coin: 'BTC' },
      { label: 'Options Skew 25Δ', value: '+5.9',     sub: 'mild risk-on',  coin: 'BTC' },
    ],
    setups: [
      {
        coin: 'BTC', htf_bias: 'BULL',
        scalp: 'NO-TRADE', intraday: 'NO-TRADE', swing: 'NO-TRADE',
        quant: null, entries: [],
        note: 'All profiles — no confluence. Wait.',
      },
      {
        coin: 'ETH', htf_bias: 'BEAR',
        scalp: 'SHORT', intraday: 'SHORT', swing: 'NO-TRADE',
        quant: { type: 'stat_arb', detail: 'Short BTC / Long ETH · z=+2.03 (60d) · BTC rich vs ETH' },
        entries: [
          { profile: 'scalp moderate',    dir: 'SHORT', entry: 2262.91, stop: 2266.65, tp1: 2257.29, tp2: 2253.54, tp3: 2249.79, rr: '1:2.5', conf: '5/10' },
          { profile: 'scalp aggressive',  dir: 'SHORT', entry: 2257.36, stop: 2267.07, tp1: 2233.08, tp2: 2218.52, tp3: 2199.09, rr: '1:4.2', conf: '5/10' },
          { profile: 'intraday aggressive', dir: 'SHORT', entry: 2257.36, stop: 2282.63, tp1: 2181.55, tp2: 2131.01, tp3: 2080.46, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close above EMA50 (2277.15)',
      },
      {
        coin: 'SOL', htf_bias: 'BULL',
        scalp: 'LONG', intraday: 'LONG', swing: 'NO-TRADE',
        quant: null,
        entries: [
          { profile: 'scalp aggressive',  dir: 'LONG', entry: 90.76, stop: 90.46, tp1: 91.50, tp2: 91.94, tp3: 92.53,  rr: '1:4.2', conf: '4/10' },
          { profile: 'intraday aggressive', dir: 'LONG', entry: 90.76, stop: 89.39, tp1: 94.87, tp2: 97.60, tp3: 100.34, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close below EMA50 (92.65)',
      },
      {
        coin: 'HYPE', htf_bias: 'BEAR',
        scalp: 'SHORT', intraday: 'SHORT', swing: 'NO-TRADE',
        quant: { type: 'funding_harvest', detail: 'Short perp / Long spot · est +10.9% APR · delta-neutral' },
        entries: [
          { profile: 'scalp moderate',    dir: 'SHORT', entry: 39.03, stop: 39.12, tp1: 38.89, tp2: 38.80, tp3: 38.71, rr: '1:2.5', conf: '5/10' },
          { profile: 'scalp aggressive',  dir: 'SHORT', entry: 38.95, stop: 39.19, tp1: 38.34, tp2: 37.97, tp3: 37.48, rr: '1:4.2', conf: '5/10' },
          { profile: 'intraday aggressive', dir: 'SHORT', entry: 38.95, stop: 39.58, tp1: 37.07, tp2: 35.81, tp3: 34.55, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close above EMA50 (39.67) · Funding harvest: +10.95% APR gross',
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
