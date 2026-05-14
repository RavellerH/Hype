// ── Cryptowatch Research Snapshot ────────────────────────────────────────────────────────────
// Update this object whenever you paste fresh research from cryptowatch.id
const INTEL = {
  snapshot_date: '2026-05-14',
  source: 'cryptowatch.id',

  // ── MACRO ───────────────────────────────────────────────────────────────
  macro: {
    posture: 'WAIT',
    posture_score: -0.5,
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
    cohorts: [
      { name: 'LTH', stance: 'accumulating', detail: '+131,133 BTC · 30d', bull: true },
      { name: 'ETF · TradFi', stance: 'distributing', detail: '−$127M · 7d', bull: false },
      { name: 'Smart Money', stance: 'accumulating', detail: 'stable Δ −3.63% · 24h', bull: true },
    ],
    notable_moves: [
      { metric: 'Puell Multiple', z: '+1.65σ', change: '+17.10%', value: '0.9953' },
      { metric: 'AHR999', z: '+1.30σ', change: '+3.96%', value: '0.5286' },
      { metric: 'BTC Price', z: '+0.78σ', change: '+1.32%', value: '$80.90k' },
      { metric: 'MVRV Z-Score', z: '+0.73σ', change: '+3.94%', value: '0.9187' },
      { metric: 'NUPL', z: '+0.63σ', change: '+2.66%', value: '0.3297' },
      { metric: 'Hot Capital Share', z: '−0.43σ', change: '−0.90%', value: '12.16%' },
    ],
  },

  // ── HUNTER ──────────────────────────────────────────────────────────────
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
      { signal: 'Morning Verdict', pass: true },
      { signal: 'Risk Regime', pass: true },
      { signal: 'Narrative Entries', pass: false },
      { signal: 'Smart Money', pass: true },
      { signal: 'Concentration', pass: false },
    ],
    plays: [
      { coin: 'ZEC', action: 'ENTRY', narrative: 'Privacy', reason: 'Highest mindshare (0.24) while 7d price still -2.1% — attention leading price. Starter size.' },
      { coin: 'ROSE', action: 'HOLD', narrative: 'Privacy', reason: 'Already +7.7% 7d — confirms the thesis but entry is later than ZEC. Treat as validation.' },
      { coin: 'PC', action: 'ENTRY', narrative: 'Infra', reason: 'Only REAL verdict in CT emergence — Push Chain universal execution layer, no shill signal. Small size.' },
    ],
    avoid: [
      { coin: 'AEON', reason: '10x from sub-300k MC, HYPE verdict, strong shill signal — too late.' },
      { coin: 'BXE', reason: 'HYPE + strong shill on XRPL low-cap riding a Chrome extension headline.' },
      { coin: 'DAD', reason: 'Solana meme, thin narrative, possible coordinated shilling.' },
    ],
    risk: 'Privacy mindshare fades before price catches up. Watch: ZEC mindshare decaying over 2–3 days + ROSE giving back 7d gains + smart money staying idle.',
    narratives_top: [
      { name: 'desci', score: 3.5 },
      { name: 'rwa', score: 3.6 },
      { name: 'sol ecosystem', score: 3.4 },
      { name: 'l2s', score: 3.5 },
      { name: 'restaking', score: 3.5 },
    ],
  },

  // ── DESK SETUPS ───────────────────────────────────────────────────────────
  desk: {
    killzone: 'NONE · NY_AM soon',
    market_stats: [
      { label: 'Funding', value: '0.0046%', sub: 'z 1.58', coin: 'BTC' },
      { label: 'Open Interest', value: '$59.77B', sub: 'Δ4H −0.69%', coin: 'BTC' },
      { label: 'Liquidations', value: '$73.5M', sub: '24H', coin: 'BTC' },
      { label: 'Options Skew 25Δ', value: '+5.9', sub: 'mild risk-on', coin: 'BTC' },
    ],
    setups: [
      {
        coin: 'BTC',
        htf_bias: 'BULL',
        scalp: 'NO-TRADE',
        intraday: 'NO-TRADE',
        swing: 'NO-TRADE',
        quant: null,
        entries: [],
        note: 'All profiles — no confluence. Wait.',
      },
      {
        coin: 'ETH',
        htf_bias: 'BEAR',
        scalp: 'SHORT',
        intraday: 'SHORT',
        swing: 'NO-TRADE',
        quant: { type: 'stat_arb', detail: 'Short BTC / Long ETH · z=+2.03 (60d) · BTC rich vs ETH' },
        entries: [
          { profile: 'scalp moderate', dir: 'SHORT', entry: 2262.91, stop: 2266.65, tp1: 2257.29, tp2: 2253.54, tp3: 2249.79, rr: '1:2.5', conf: '5/10' },
          { profile: 'scalp aggressive', dir: 'SHORT', entry: 2257.36, stop: 2267.07, tp1: 2233.08, tp2: 2218.52, tp3: 2199.09, rr: '1:4.2', conf: '5/10' },
          { profile: 'intraday aggressive', dir: 'SHORT', entry: 2257.36, stop: 2282.63, tp1: 2181.55, tp2: 2131.01, tp3: 2080.46, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close above EMA50 (2277.15)',
      },
      {
        coin: 'SOL',
        htf_bias: 'BULL',
        scalp: 'LONG',
        intraday: 'LONG',
        swing: 'NO-TRADE',
        quant: null,
        entries: [
          { profile: 'scalp aggressive', dir: 'LONG', entry: 90.76, stop: 90.46, tp1: 91.50, tp2: 91.94, tp3: 92.53, rr: '1:4.2', conf: '4/10' },
          { profile: 'intraday aggressive', dir: 'LONG', entry: 90.76, stop: 89.39, tp1: 94.87, tp2: 97.60, tp3: 100.34, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close below EMA50 (92.65)',
      },
      {
        coin: 'HYPE',
        htf_bias: 'BEAR',
        scalp: 'SHORT',
        intraday: 'SHORT',
        swing: 'NO-TRADE',
        quant: { type: 'funding_harvest', detail: 'Short perp / Long spot · est +10.9% APR · delta-neutral' },
        entries: [
          { profile: 'scalp moderate', dir: 'SHORT', entry: 39.03, stop: 39.12, tp1: 38.89, tp2: 38.80, tp3: 38.71, rr: '1:2.5', conf: '5/10' },
          { profile: 'scalp aggressive', dir: 'SHORT', entry: 38.95, stop: 39.19, tp1: 38.34, tp2: 37.97, tp3: 37.48, rr: '1:4.2', conf: '5/10' },
          { profile: 'intraday aggressive', dir: 'SHORT', entry: 38.95, stop: 39.58, tp1: 37.07, tp2: 35.81, tp3: 34.55, rr: '1:5.0', conf: '4/10' },
        ],
        note: 'Invalidation: 1H close above EMA50 (39.67) · Funding harvest: +10.95% APR gross',
      },
    ],
  },
};

// ── Render Intel Page ────────────────────────────────────────────────────────────────────
function loadIntel() {
  const el = document.getElementById('intel-content');
  const m = INTEL.macro;
  const h = INTEL.hunter;
  const d = INTEL.desk;

  el.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <div class="section-title">📡 Intel</div>
        <div class="muted" style="font-size:11px;margin-top:2px">Source: cryptowatch.id · Snapshot ${INTEL.snapshot_date}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="regime-pill regime-${h.regime}">${h.regime}</span>
        <span class="regime-pill regime-${m.posture}">${m.posture}</span>
      </div>
    </div>

    <!-- Row 1: Key signals -->
    <div class="grid-4" style="margin-bottom:14px">
      <div class="stat-card">
        <div class="stat-label">Market Heat</div>
        <div class="stat-value" style="color:${h.heat>60?'var(--red)':h.heat>40?'var(--yellow)':'var(--green)'}">${h.heat}</div>
        <div class="stat-sub">${h.heat_note}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Smart Money</div>
        <div class="stat-value" style="color:${h.smart_money==='ACTIVE'?'var(--green)':'var(--text-muted)'}">${h.smart_money}</div>
        <div class="stat-sub">BTC.D ${h.btc_dominance}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Alt Breadth</div>
        <div class="stat-value ${parseInt(h.altcoin_breadth)<30?'neg':'pos'}">${h.altcoin_breadth}</div>
        <div class="stat-sub">Altcoins up</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Whale Flow</div>
        <div class="stat-value pos">${h.whale_net_flow}</div>
        <div class="stat-sub">${h.whale_buy_pressure}% buy pressure</div>
      </div>
    </div>

    <!-- Row 2: Macro + Bottom Radar -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title">🌐 Macro Context</div>
        <div class="intel-row"><span class="intel-label">Posture</span><span class="intel-val" style="color:${m.posture==='WAIT'?'var(--yellow)':m.posture==='BUY'?'var(--green)':'var(--red)'}">${m.posture} (${m.posture_confidence}% conf)</span></div>
        <div class="intel-row"><span class="intel-label">Cycle Phase</span><span class="intel-val accent">${m.cycle_phase}</span></div>
        <div class="intel-row"><span class="intel-label">Bottom Proximity</span><span class="intel-val">+${m.bottom_proximity_pct}% from bottom</span></div>
        <div class="intel-row"><span class="intel-label">30D Capital Flow</span><span class="intel-val pos">${m.capital_flow_30d}</span></div>
        <div class="intel-row"><span class="intel-label">Flow Lead</span><span class="intel-val">${m.capital_flow_lead}</span></div>
        <div class="intel-row"><span class="intel-label">BTC Funding APR</span><span class="intel-val">${m.btc_funding_apr} · ${m.btc_funding_note}</span></div>
        <div class="intel-row"><span class="intel-label">Today’s Bias</span><span class="intel-val muted">${m.cycle_today} (${m.cycle_accuracy} accuracy)</span></div>
        <div style="margin-top:10px">
          <div class="card-title" style="margin-bottom:8px">Cohort Confluence</div>
          ${m.cohorts.map(c=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(42,45,54,0.4)">
            <span style="font-size:12px;font-weight:500">${c.name}</span>
            <div style="text-align:right">
              <span class="side-badge ${c.bull?'long':'short'}" style="font-size:10px">${c.stance.toUpperCase()}</span>
              <div class="muted" style="font-size:10px;margin-top:2px">${c.detail}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">📊 Cycle Bottom Radar</div>
        <div style="text-align:center;margin-bottom:12px">
          <div style="font-size:36px;font-weight:800;font-family:var(--mono);color:var(--green)">${m.bottom_radar}</div>
          <div style="font-size:11px;color:var(--text-muted)">/100 · Strong bottom cluster</div>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--green)">${m.bottom_signals}</div><div style="font-size:10px;color:var(--text-muted)">Bottom</div></div>
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--text-muted)">${m.neutral_signals}</div><div style="font-size:10px;color:var(--text-muted)">Neutral</div></div>
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:var(--red)">${m.top_signals}</div><div style="font-size:10px;color:var(--text-muted)">Top</div></div>
          </div>
        </div>
        <div class="card-title" style="margin-bottom:8px">Notable On-Chain Moves</div>
        ${m.notable_moves.map(mv=>{
          const pos = mv.z.startsWith('+');
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(42,45,54,0.3)">
            <span style="font-size:11px">${mv.metric}</span>
            <div style="text-align:right">
              <span style="font-family:var(--mono);font-size:11px;color:${pos?'var(--green)':'var(--red)'}">${mv.z}</span>
              <span class="muted" style="font-size:10px;margin-left:6px">${mv.value}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- AI Synthesis -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div class="card-title" style="margin:0">🤖 AI Synthesis · Cryptowatch</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="regime-pill regime-${h.ai_verdict}" style="font-size:10px">${h.ai_verdict}</span>
          <span class="muted" style="font-size:10px">${h.ai_confidence} confidence</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.65;margin-bottom:12px;padding:10px;background:var(--surface2);border-radius:8px">${h.ai_summary}</div>

      <!-- Conviction stack -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${h.conviction_stack.map(s=>`
        <div style="display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:6px;background:${s.pass?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)'};color:${s.pass?'var(--green)':'var(--red)'}">
          ${s.pass?'✓':'✗'} ${s.signal}
        </div>`).join('')}
        <span class="muted" style="font-size:11px;padding:3px 6px">${h.conviction_stack.filter(s=>s.pass).length}/${h.conviction_stack.length} signals agree</span>
      </div>

      <!-- Narrative rotation -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;background:var(--surface2);border-radius:8px">
        <span style="font-size:11px;color:var(--text-muted)">Narrative rotation:</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--yellow)">${h.narrative_rotation}</span>
        <span style="font-size:10px;color:var(--text-muted)">Leading: <b style="color:var(--accent)">${h.leading_narrative}</b></span>
      </div>

      <!-- Active narratives -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        ${h.narratives_top.map(n=>`<div style="padding:4px 10px;border-radius:20px;background:rgba(124,106,255,0.1);border:1px solid rgba(124,106,255,0.2);font-size:11px;color:var(--accent)">${n.name} <span style="opacity:0.6">${n.score}</span></div>`).join('')}
      </div>
    </div>

    <!-- Plays & Avoid -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title" style="color:var(--green)">▲ Plays</div>
        ${h.plays.map(p=>`
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
        ${h.avoid.map(a=>`
        <div style="padding:10px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:8px;margin-bottom:8px">
          <div style="font-weight:700;font-size:13px;font-family:var(--mono);color:var(--red);margin-bottom:4px">${a.coin}</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.5">${a.reason}</div>
        </div>`).join('')}
        <div style="margin-top:10px;padding:10px;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.2);border-radius:8px">
          <div style="font-size:10px;font-weight:600;color:var(--yellow);margin-bottom:4px">⚠ RISK TO THESIS</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.5">${h.risk}</div>
        </div>
      </div>
    </div>

    <!-- Desk Setups -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
        <div class="card-title" style="margin:0">💼 Desk Setups · Active Entries</div>
        <span class="muted" style="font-size:11px">${d.killzone}</span>
      </div>
      ${d.setups.map(s=>deskSetupBlock(s)).join('')}
    </div>
  `;
}

function deskSetupBlock(s) {
  const biasColor = s.htf_bias==='BULL'?'var(--green)':s.htf_bias==='BEAR'?'var(--red)':'var(--text-muted)';
  const hasEntries = s.entries.length > 0;
  const quant = s.quant;
  return `
  <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-weight:700;font-size:15px;font-family:var(--mono)">${s.coin}</span>
      <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${biasColor}1a;color:${biasColor}">HTF ${s.htf_bias}</span>
      ${s.scalp!=='NO-TRADE'?`<span class="side-badge ${s.scalp==='LONG'?'long':'short'}" style="font-size:10px">SCALP ${s.scalp}</span>`:''}
      ${s.intraday!=='NO-TRADE'?`<span class="side-badge ${s.intraday==='LONG'?'long':'short'}" style="font-size:10px">INTRADAY ${s.intraday}</span>`:''}
      ${s.swing!=='NO-TRADE'?`<span class="side-badge ${s.swing==='LONG'?'long':'short'}" style="font-size:10px">SWING ${s.swing}</span>`:''}
      ${!hasEntries?`<span class="muted" style="font-size:11px">No-trade all profiles</span>`:''}
    </div>
    ${hasEntries?`
    <div class="table-wrap">
      <table>
        <thead><tr><th>Profile</th><th>Dir</th><th>Entry</th><th>Stop</th><th>TP1</th><th>TP2</th><th>TP3</th><th>R:R</th><th>Conf</th></tr></thead>
        <tbody>
          ${s.entries.map(e=>`<tr>
            <td class="muted">${e.profile}</td>
            <td><span class="side-badge ${e.dir==='LONG'?'long':'short'}" style="font-size:10px">${e.dir}</span></td>
            <td style="color:var(--accent)">${e.entry}</td>
            <td class="neg">${e.stop}</td>
            <td class="pos">${e.tp1}</td>
            <td class="pos">${e.tp2}</td>
            <td class="pos">${e.tp3}</td>
            <td style="font-family:var(--mono);font-weight:600">${e.rr}</td>
            <td class="muted">${e.conf}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`:''}
    ${quant?`<div style="margin-top:8px;padding:8px 10px;background:rgba(124,106,255,0.08);border:1px solid rgba(124,106,255,0.2);border-radius:8px;font-size:11px">
      <span style="color:var(--accent);font-weight:600">QUANT ·</span> ${quant.detail}
    </div>`:''}
    ${s.note?`<div class="muted" style="font-size:10px;margin-top:6px">ℹ ${s.note}</div>`:''}
  </div>`;
}
