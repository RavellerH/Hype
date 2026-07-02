// ── MVRV + AI Knowledge Base (client-side, gh-pages) ────────────────────────

// ── MVRV ─────────────────────────────────────────────────────────────────────

const MVRV_ZONE_META = {
  OVERHEATED:  { label: 'Overheated',  cls: 'mvrv-zone-hot',     color: 'var(--red)',        desc: 'Price well above 90d avg — elevated risk' },
  BULLISH:     { label: 'Bullish',     cls: 'mvrv-zone-bull',    color: 'var(--yellow)',     desc: 'Above average — uptrend, watch for reversal' },
  NEUTRAL:     { label: 'Neutral',     cls: 'mvrv-zone-neutral', color: 'var(--text-muted)', desc: 'Near 90d avg — fair value range' },
  UNDERVALUED: { label: 'Undervalued', cls: 'mvrv-zone-under',   color: 'var(--green)',      desc: 'Below 90d avg — potential accumulation zone' },
};

let _mvrvLearnOpen = false;

function mvrvToggleLearn() {
  _mvrvLearnOpen = !_mvrvLearnOpen;
  const body = document.getElementById('mvrv-learn-body');
  const icon = document.getElementById('mvrv-learn-icon');
  if (body) body.style.display = _mvrvLearnOpen ? 'block' : 'none';
  if (icon) icon.style.transform = _mvrvLearnOpen ? 'rotate(180deg)' : 'rotate(0deg)';
}

function _mvrvLearnHtml(coins) {
  const belowOne = Object.values(coins).filter(c => c.mvrv < 1.0);

  const zones = [
    { range: '> 2.0',       label: 'Danger Zone',  cls: 'mvrv-zone-hot',     meaning: 'Price far above realized value — historically near major market tops.', action: 'Consider reducing exposure significantly. Strong distribution territory.' },
    { range: '1.40 – 2.0',  label: 'Overheated',   cls: 'mvrv-zone-hot',     meaning: 'Price well above average holder cost basis. Risk is elevated.', action: 'Stay cautious. Tighten trailing stops. Consider partial profit-taking.' },
    { range: '1.15 – 1.40', label: 'Bullish',       cls: 'mvrv-zone-bull',    meaning: 'Momentum phase — holders on average are in profit.', action: 'Trend is your friend. Trail stops up. Watch for reversal signals at resistance.' },
    { range: '0.85 – 1.15', label: 'Fair Value',    cls: 'mvrv-zone-neutral', meaning: 'Price near the average holder\'s cost basis. Neutral, wait-and-see zone.', action: 'Look for confluence with other signals (phase, volume, TA) before entering.' },
    { range: '0.50 – 0.85', label: 'Undervalued',   cls: 'mvrv-zone-under',   meaning: 'Below average cost basis. Buyers have a statistical edge here.', action: 'Dollar-cost averaging makes sense. Scale in slowly with defined risk.' },
    { range: '< 0.50',      label: 'Capitulation',  cls: 'mvrv-zone-under',   meaning: 'Extreme undervaluation. Very rare — everyone on average is deeply in loss.', action: 'Maximum historical accumulation zone. Requires patience but odds are strongly in your favor.' },
  ];

  const belowOneAlert = belowOne.length > 0 ? `
    <div class="mvrv-alert-below1">
      <div class="mvrv-alert-icon">📉</div>
      <div>
        <strong>${belowOne.map(c => c.symbol).join(', ')} ${belowOne.length > 1 ? 'are' : 'is'} below MVRV 1.0 — Accumulation Signal</strong>
        <div style="margin-top:5px;font-size:12px;color:var(--text-muted);line-height:1.55">
          The current price is <em style="color:var(--green);font-style:normal">below the average cost basis</em> of all market participants —
          the average holder is sitting at a loss. In Bitcoin's history MVRV has only dropped below 1 three times:
          the Dec 2018 bottom (~$3,200 → +1,800% over 2 years), the March 2020 COVID crash (~$4,000 → +1,400% over 12 months),
          and the Nov 2022 post-FTX collapse (~$16,000 → +400% over 18 months).
          Not a guaranteed signal, but historically one of the strongest long-term buy zones.
        </div>
      </div>
    </div>` : '';

  return `
  <div class="mvrv-learn">
    <button class="mvrv-learn-toggle" onclick="mvrvToggleLearn()">
      <span>📚 What is MVRV? — Beginner Guide</span>
      <span id="mvrv-learn-icon" style="transition:transform 0.2s;display:inline-block;font-size:12px">▼</span>
    </button>
    <div id="mvrv-learn-body" style="display:${_mvrvLearnOpen ? 'block' : 'none'}">
      <div class="mvrv-learn-content">
        ${belowOneAlert}

        <div class="mvrv-learn-section">
          <h4>What is MVRV?</h4>
          <p>MVRV stands for <strong>Market Value to Realized Value</strong>. It compares the current market price of a coin to the average price at which all existing coins were last moved on-chain — essentially everyone's average <strong>cost basis</strong>.</p>
          <ul>
            <li><strong>Market Value</strong> — current price × circulating supply (what the network is worth right now)</li>
            <li><strong>Realized Value</strong> — each coin valued at the price it last moved (what everyone paid on average)</li>
            <li><strong>MVRV Ratio</strong> = Market Value ÷ Realized Value</li>
          </ul>
          <p style="font-size:12px;color:var(--text-muted)">⚠ Hype uses an approximation: Current Price ÷ 90-day average price, since true on-chain realized value requires blockchain data. Treat this as a directional signal, not precise MVRV.</p>
        </div>

        <div class="mvrv-learn-section">
          <h4>What does MVRV below 1.0 mean?</h4>
          <p>When MVRV drops below <strong>1.0</strong>, the current price is below the average cost basis of all holders. In plain English: <em>the average person holding this coin is at a loss</em>.</p>
          <p>This matters because:</p>
          <ul>
            <li><strong>Weak hands have already sold</strong> — only committed long-term holders remain</li>
            <li><strong>Statistical edge for new buyers</strong> — you're entering below the "average break-even" level</li>
            <li><strong>Capitulation is priced in</strong> — the worst of the selling pressure has typically already passed</li>
            <li><strong>Risk/reward skews favorably</strong> — downside is limited (everyone's already at a loss), upside can be large</li>
          </ul>
          <div class="mvrv-historical">
            <div class="mvrv-hist-item"><span class="mvrv-zone-badge mvrv-zone-under">Dec 2018</span>&nbsp; BTC ~$3,200 → +1,800% over the next 2 years</div>
            <div class="mvrv-hist-item"><span class="mvrv-zone-badge mvrv-zone-under">Mar 2020</span>&nbsp; BTC ~$4,000 (COVID crash) → +1,400% over 12 months</div>
            <div class="mvrv-hist-item"><span class="mvrv-zone-badge mvrv-zone-under">Nov 2022</span>&nbsp; BTC ~$16,000 (post-FTX) → +400% over 18 months</div>
          </div>
        </div>

        <div class="mvrv-learn-section">
          <h4>Zone Reference Guide</h4>
          <div class="mvrv-zone-table">
            ${zones.map(z => `
            <div class="mvrv-zone-row">
              <div class="mvrv-zone-row-left">
                <span class="mvrv-zone-badge ${z.cls}">${z.label}</span>
                <span class="mvrv-zone-range">${z.range}</span>
              </div>
              <div class="mvrv-zone-row-right">
                <div class="mvrv-zone-meaning">${z.meaning}</div>
                <div class="mvrv-zone-action">→ ${z.action}</div>
              </div>
            </div>`).join('')}
          </div>
        </div>

        <div class="mvrv-learn-section">
          <h4>How to use MVRV in this dashboard</h4>
          <ul>
            <li>Use MVRV as a <strong>macro backdrop</strong>, not a direct trade trigger</li>
            <li>In the <strong>Signals tab</strong>, MVRV zone is one factor in the confluence score (undervalued = positive, overheated = negative for longs)</li>
            <li>Best combined with: phase detector, TA signals (EMA/MACD/RSI), and funding rate</li>
            <li><strong>Overheated MVRV + overbought RSI + high funding</strong> = avoid new longs</li>
            <li><strong>Undervalued MVRV + bull phase + low funding</strong> = strong confluence for entry</li>
            <li>Data refreshes from CoinGecko (free tier, rate-limited) — use the refresh button manually</li>
          </ul>
        </div>
      </div>
    </div>
  </div>`;
}
const MVRV_COIN_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', HYPE: 'Hyperliquid' };
const MVRV_CG_IDS     = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', HYPE: 'hyperliquid' };
const MVRV_ORDER      = ['BTC', 'ETH', 'SOL', 'HYPE'];

let _mvrvCache = null, _mvrvCacheTs = 0;

function _mvrvZone(r) {
  if (r >= 1.4)  return 'OVERHEATED';
  if (r >= 1.15) return 'BULLISH';
  if (r >= 0.85) return 'NEUTRAL';
  return 'UNDERVALUED';
}

async function fetchMVRVData() {
  if (_mvrvCache && Date.now() - _mvrvCacheTs < 300000) return _mvrvCache;
  const CG  = 'https://api.coingecko.com/api/v3';
  const ids = Object.values(MVRV_CG_IDS).join(',');
  const cgH = typeof _cgDemoKey !== 'undefined' && _cgDemoKey ? { 'x-cg-demo-api-key': _cgDemoKey } : {};
  let pricesNow = {};
  try {
    const r = await fetch(`${CG}/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`, { headers: cgH });
    pricesNow = await r.json();
  } catch(e) {}

  const coinEntries = await Promise.all(Object.entries(MVRV_CG_IDS).map(async ([sym, cgId]) => {
    const now = pricesNow[cgId] || {};
    const currentPrice = now.usd || 0;
    const marketCap    = now.usd_market_cap || 0;
    const change24h    = now.usd_24h_change || 0;
    let chart = [], mvrv = 1.0, avg90d = currentPrice;
    try {
      const rh = await fetch(`${CG}/coins/${cgId}/market_chart?vs_currency=usd&days=90&interval=daily`, { headers: cgH });
      if (rh.ok) {
        const raw = (await rh.json()).prices || [];
        if (raw.length >= 10) {
          const tss = raw.map(p => p[0]), prices = raw.map(p => p[1]);
          avg90d = prices.reduce((a, b) => a + b, 0) / prices.length;
          mvrv   = prices[prices.length - 1] / avg90d;
          for (let i = 30; i < prices.length; i++) {
            const w = prices.slice(i - 30, i);
            const aw = w.reduce((a, b) => a + b, 0) / w.length;
            chart.push({ t: tss[i], v: +(prices[i] / aw).toFixed(4) });
          }
        }
      }
    } catch(e) {}
    return [sym, { symbol: sym, price: currentPrice, market_cap: marketCap,
      change_24h: +change24h.toFixed(2), mvrv: +mvrv.toFixed(4),
      avg_90d: +avg90d.toFixed(4), zone: _mvrvZone(mvrv), chart }];
  }));
  const coins = Object.fromEntries(coinEntries);
  _mvrvCache   = { coins, source: 'CoinGecko · approx MVRV = price ÷ 90-day avg', updated: Math.floor(Date.now()/1000) };
  _mvrvCacheTs = Date.now();
  return _mvrvCache;
}

async function loadMVRV() {
  const el = document.getElementById('mvrv-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Fetching MVRV from CoinGecko…</div>';
  try { renderMVRV(await fetchMVRVData()); }
  catch(e) { el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

function mvrvSparkline(chart) {
  if (!chart || chart.length < 2) return '<span style="color:var(--text-faint);font-size:11px">—</span>';
  const vals = chart.map(p => p.v), W = 120, H = 36, pad = 3;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 0.01;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = vals[vals.length-1] >= vals[0] ? 'var(--green)' : 'var(--red)';
  const baseY = Math.max(pad, Math.min(H - pad, pad + (1 - (1 - min) / range) * (H - pad * 2)));
  return `<svg width="${W}" height="${H}" style="display:block">
    <line x1="${pad}" y1="${baseY.toFixed(1)}" x2="${W-pad}" y2="${baseY.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3,3"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderMVRV(data) {
  const el = document.getElementById('mvrv-content');
  if (!el) return;
  const coins = data.coins || {};

  const stripHtml = `<div class="stat-strip">${MVRV_ORDER.map(sym => {
    const c = coins[sym]; if (!c) return `<div class="stat-cell"><div class="s-label">${sym}</div><div class="s-value">—</div></div>`;
    const meta = MVRV_ZONE_META[c.zone];
    return `<div class="stat-cell"><div class="s-label">${sym}</div><div class="s-value" style="color:${meta.color}">${c.mvrv.toFixed(3)}</div><div class="s-sub">${meta.label}</div></div>`;
  }).join('')}</div>`;

  const cards = MVRV_ORDER.map(sym => {
    const c = coins[sym]; if (!c) return `<div class="mvrv-card"><div class="muted">No data for ${sym}</div></div>`;
    const meta = MVRV_ZONE_META[c.zone];
    const chg = c.change_24h, chgCls = chg >= 0 ? 'pos' : 'neg', chgStr = (chg>=0?'+':'') + chg.toFixed(2) + '%';
    const mcStr = c.market_cap >= 1e9 ? '$'+(c.market_cap/1e9).toFixed(2)+'B' : c.market_cap >= 1e6 ? '$'+(c.market_cap/1e6).toFixed(0)+'M' : '—';
    return `<div class="mvrv-card">
      <div class="mvrv-card-header">
        <div><div class="mvrv-coin">${sym}</div><div class="mvrv-coin-name">${MVRV_COIN_NAMES[sym]||sym}</div></div>
        <span class="mvrv-zone-badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="mvrv-ratio" style="color:${meta.color}">${c.mvrv.toFixed(3)}</div>
      <div class="mvrv-ratio-label">MVRV Ratio</div>
      <div class="mvrv-sparkline">${mvrvSparkline(c.chart)}</div>
      <div class="mvrv-stats">
        <div><div class="mvrv-stat-label">Price</div><div class="mvrv-stat-val">${fmt$(c.price)}</div></div>
        <div><div class="mvrv-stat-label">24h</div><div class="mvrv-stat-val ${chgCls}">${chgStr}</div></div>
        <div><div class="mvrv-stat-label">90d Avg</div><div class="mvrv-stat-val">${fmt$(c.avg_90d)}</div></div>
        <div><div class="mvrv-stat-label">Mkt Cap</div><div class="mvrv-stat-val">${mcStr}</div></div>
      </div>
      <div class="mvrv-desc">${meta.desc}</div>
    </div>`;
  }).join('');

  const updatedStr = data.updated ? new Date(data.updated*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  el.innerHTML = `
    ${stripHtml}
    ${_mvrvLearnHtml(coins)}
    <div class="filter-bar" style="justify-content:space-between">
      <span style="font-size:12px;color:var(--text-muted)">${data.source}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--text-faint)">Updated ${updatedStr}</span>
        <button class="btn btn-ghost btn-sm" onclick="_mvrvCacheTs=0;loadMVRV()">↺ Refresh</button>
      </div>
    </div>
    <div class="mvrv-grid">${cards}</div>
    <div class="mvrv-legend">
      ${Object.entries(MVRV_ZONE_META).map(([,m])=>`<div class="mvrv-legend-item"><span class="mvrv-zone-badge ${m.cls}">${m.label}</span><span class="mvrv-legend-desc">${m.desc}</span></div>`).join('')}
      <div class="mvrv-legend-item" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;grid-column:1/-1">
        <span style="font-size:11px;color:var(--text-faint)">ⓘ Approx MVRV = Current Price ÷ 90-day rolling average. Not true on-chain realized cap. Chart shows 30-day rolling window.</span>
      </div>
    </div>`;
}

// ── AI Knowledge Base ─────────────────────────────────────────────────────────

let _aiSubTab = 'intel';
let _chatHistory = [];
let _intelLog = [];
let _intelLoaded = false;

// Supabase — fill in your project URL and anon key from supabase.com → Project Settings → API
const _SUPABASE_URL      = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';
const _db = (_SUPABASE_URL.startsWith('https://') && window.supabase)
  ? window.supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY)
  : null;

async function loadIntelFromDB() {
  if (_intelLoaded) return;
  _intelLoaded = true;
  try {
    // Migrate hype_kb_notes → hype_intel_log (legacy one-time)
    const oldNotes = JSON.parse(localStorage.getItem('hype_kb_notes') || '[]');
    if (oldNotes.length) {
      const migrated = oldNotes.map(n => ({
        id: n.id || 'intel::' + Date.now() + Math.random(),
        timestamp: Date.now(), source: 'note',
        raw: (n.title ? n.title + '\n' : '') + (n.content || ''),
        coins: [], signals: [], phase: null,
      }));
      const prev = JSON.parse(localStorage.getItem('hype_intel_log') || '[]');
      localStorage.setItem('hype_intel_log', JSON.stringify([...prev, ...migrated]));
      localStorage.removeItem('hype_kb_notes');
    }

    if (_db) {
      // One-time migration: push any localStorage intel → Supabase
      const local = JSON.parse(localStorage.getItem('hype_intel_log') || '[]');
      if (local.length > 0) {
        await _db.from('intel_log').upsert(
          local.map(e => ({ id: e.id, timestamp: e.timestamp, source: e.source || 'manual',
            raw: e.raw || '', coins: e.coins || [], signals: e.signals || [], phase: e.phase || null })),
          { onConflict: 'id' }
        );
        localStorage.removeItem('hype_intel_log');
      }
      const { data } = await _db.from('intel_log')
        .select('id,timestamp,source,raw,coins,signals,phase')
        .order('timestamp', { ascending: false });
      _intelLog = data || [];
      if (_intelLog.length === 0) await _seedDefaultIntel();
    } else {
      _intelLog = JSON.parse(localStorage.getItem('hype_intel_log') || '[]');
      if (_intelLog.length === 0) await _seedDefaultIntel();
    }
  } catch(e) {
    console.error('Intel load:', e);
    _intelLog = JSON.parse(localStorage.getItem('hype_intel_log') || '[]');
  }
}

async function _saveIntel(entry) {
  if (_db) {
    await _db.from('intel_log').upsert({
      id: entry.id, timestamp: entry.timestamp, source: entry.source,
      raw: entry.raw, coins: entry.coins, signals: entry.signals, phase: entry.phase || null,
    });
  } else {
    localStorage.setItem('hype_intel_log', JSON.stringify(_intelLog));
  }
}

// Pre-seed with Cryptowatch intel on first load
async function _seedDefaultIntel() {
  const T = 1778942400000; // 2026-05-16 14:44 UTC
  const seeds = [
    {
      id: 'intel::1778942400003',
      timestamp: T,
      source: 'cryptowatch.id/desk',
      raw: `CRYPTOWATCH DESK · 2026-05-16 14:44 UTC · Killzone NY_AM

MARKET CONDITIONS:
Funding 0.0026% (z 0.50) · OI $58.33B (Δ4H -0.46%) · Liq 24H $28.2M
Options Skew 25Δ: -12.9 (mild risk-off) · VWAP +0.23% · CVD 4H 383.32
MSAC Tail Risk: ELEVATED (Confluence 79.6)
ETF Dump scenario: $95,000 → $88,000 (-7.4%)

BTC — HTF 1D BULL
Scalp LONG: moderate entry 78,010 · stop 77,924 · tp1 78,140 · tp2 78,227 · tp3 78,313 · R:R 1:2.5 · conf 8/10
Intraday LONG: moderate entry 79,027 · stop 78,542 · tp1 79,998 · tp2 80,484 · R:R 1:3.0 · conf 5/10 · invalidation 1H EMA50 79,355
Swing: NO-TRADE (Regime RANGE — no directional edge)
Quant stat-arb: SHORT BTC / LONG ETH · z=+2.34 (60d) · BTC rich vs ETH · delta-flat · mean revert 3-10d

ETH — HTF 1D BEAR
Scalp SHORT: moderate entry 2,176 · stop 2,179 · tp1 2,171 · R:R 1:2.5 · conf 6/10 · invalidation above 2,180.99
Intraday SHORT: moderate entry 2,216 · stop 2,234 · tp1 2,181 · R:R 1:3.0 · conf 5/10 · invalidation 1H EMA50 2,229
Swing: NO-TRADE (Regime RANGE)

SOL — HTF 1D BEAR · Funding +10.9% APR (z 1.63 elevated — longs paying) · OI $0.36B
Scalp SHORT: moderate 86.24 · stop 86.39 · tp1 86.01 · R:R 1:2.5 · conf 5/10 · invalidation above 86.41
Intraday: NO-TRADE (Confluence 4/10 — below 5+ minimum)
Quant: Funding harvest SHORT perp / LONG spot · est +10.9% APR gross / ~7.1% net · delta-neutral

HYPE — HTF 1D BULL · Funding -11.9% APR (z -1.92 — shorts paying longs) · OI $0.90B
Scalp LONG: moderate 41.02 · stop 40.87 · tp1 41.24 · R:R 1:2.5 · conf 6/10 · invalidation below 40.69
Intraday LONG: aggressive 41.12 · stop 39.74 · tp1 45.27 · tp2 48.03 · R:R 1:5.0 · conf 4/10 · invalidation 1H EMA50 42.67
Quant: Funding harvest LONG perp / SHORT spot · est +11.9% APR gross / ~7.8% net · delta-neutral

SMART MONEY TOP WALLETS (Solana-dominant):
#1 Whale $21.1M · Quality 89.1 · Perf 70.2
#2 Whale $5.7M · Quality 64.4 · Perf 83.3
#3 Diversified Trader 22 tokens $6.8M · Quality 87.6

KEY ALERTS TODAY:
btc_ecosystem entered top 3 narratives (score 3.1) · 23:31 UTC
perps_dex entered top 3 (score 3.2) · 19:47 UTC
Smart Ape #1 bought BABYMANYU, SCHWAB1000, MILF SEX (new tokens, <1d old)`,
      coins: ['BTC', 'ETH', 'SOL', 'HYPE'],
      signals: ['funding', 'OI', 'EMA', 'VWAP', 'support', 'resistance', 'RSI'],
      phase: null,
    },
    {
      id: 'intel::1778942400002',
      timestamp: T - 14400000, // 10:44 UTC
      source: 'cryptowatch.id/macro',
      raw: `CRYPTOWATCH MACRO · 2026-05-16

BTC Price: ~$78,195–$80,900
Portfolio Posture: WAIT · score -1 · 71% confidence
Cycle Phase: ACCUMULATION · Bottom Proximity +28% (far from bottom)
Net Capital Flow 30D: +$6.01B (Stablecoins leading · INFLOW)
BTC Funding: +2.8% APR (calm · no crowding · OI $2.20B)
Today Call: SIDEWAYS · Cycle calls accuracy 70% since 2015
Evidence: 26 receipts · 6 bull / 7 bear / 13 flat · 27% agreement

REGIME RADAR: Accumulation · BTC Season (not Altseason)
Evidence trail:
L1 Macro +1 · 7/7 scored
L2 Cycle 0 · 5/5 scored
L3 Capital/On-Chain 0 · 9/9 scored
L4 Execution -3 · 5/5 scored

ON-CHAIN z-SCORE MOVES (notable):
Puell Multiple +1.65σ (0.9953) — accumulation range
AHR999 +1.30σ (0.5286) — DCA zone
BTC price +0.78σ (+1.32%) $80.90k
MVRV Z-Score +0.73σ (0.9187) — accumulation
Reserve Risk +0.72σ (0.001214) — buy zone
Active Supply 1y+ +0.72σ (0.60%)
LTH-MVRV +0.68σ (1.685) — accumulation
NUPL +0.63σ (0.3297) — hope/fear transition
Hot Capital Share -0.11σ (12.09%) — extreme cap distribution

CYCLE BOTTOM RADAR: 84/100 (Strong bottom cluster — multi-indicator confluence)
Bottom signals active (10/14): Puell 0.87 (accumulation) · 2Y MA -7% (buy) · AHR999 0.51 (DCA) · Mayer 0.99 (discount) · Hash Ribbons aligned · Reserve Risk 0.0012 (buy) · MVRV-Z 0.92 (accumulation) · LTH-MVRV 1.69 (accumulation) · NUPL 0.33 (hope/fear) · HCS 12.1% (extreme cap)
Top signals (2): NVT Cross 15.4 (death cross) · Active 1y+ 59.9% (active cohort)
30d trajectory: +8 (bottom score improving)

COHORTS:
LTH: ACCUMULATING +131,133 BTC 30d
ETF/TradFi: DISTRIBUTING -$541M 7d
Smart Money: ACCUMULATING (stable · Δ -3.63% 24h)
Alignment: 2/3 cohorts accumulating — contrarian-bull setup; ETF disagreeing

CYCLE POSITION:
24.9 months since halving · 706 days to next
AVIV 1.035 (fair value)
LTH SOPR 0.94 (loss-taking → constructive)
MA Compression Index 30.9% — tight bands · big move building · 10th pct 20% / 90th pct 78%
Price/EMA50W velocity divergence +0.114 (neutral · bottom extreme below -1.0)
Weekly RSI 49.4 — transition zone · MA Stack 2/4

HISTORICAL at 20-40 proximity (n=79):
7d median +0.52% (range -2.56% to +3.89%)
30d median +2.73% (range -0.53% to +7.18%)
90d median -8.18% (range -22.23% to +1.62%)

RISK: NVT death cross + ETF distributing -$541M. If smart money stays idle 48h and BTC fails to reclaim 7d range → accumulation read was wrong, cut quickly.`,
      coins: ['BTC'],
      signals: ['MVRV', 'RSI', 'EMA', 'funding', 'OI', 'support', 'dominance', 'divergence', 'volume', 'higher low'],
      phase: 'ACCUMULATION',
    },
    {
      id: 'intel::1778942400001',
      timestamp: T - 18000000, // 09:44 UTC
      source: 'cryptowatch.id/hunter',
      raw: `CRYPTOWATCH HUNTER · 2026-05-16

MARKET REGIME: CAUTION · Score 0/+10 (max ±10)
Heat: 41.8 (cool/opportunity range — threshold 55 for confirmation)
BTC Dominance: 60.4% (day 1 neutral)
Altcoin Breadth: 21% (most alts down)
Smart Money: IDLE · $0 volume · 0 trades
BTC Funding: +2.8% APR (calm)
Fear & Greed 7d: unavailable — re-check tomorrow

NARRATIVE ROTATION:
Leading narrative rotated: perps_dex → btc_ecosystem
Hottest narrative: RWA (ONDO lead · 7d -10.3%)
BTC Ecosystem: mindshare leading price on -9% basket (BTC -2.6%, ORDI -25%, SATS -14.8%)
→ Textbook early-rotation setup — attention front-running beaten-down basket
→ BUT: smart money flat-out idle, heat cool → NO confirmation yet

VERDICT: CAUTION — BTC Ecosystem attention leading price but smart money won't confirm
Conviction 3/5 (60%) · signals: Morning Verdict ✓ · Risk Regime ✓ · Smart Money ✓
Signals disagreeing: Narrative Entries ✗ · Concentration ✗

AI SYNTHESIS:
"Stay small, scale into BTC on confirmation. Treat ORDI/SATS as second-leg trades only if BTC leads first. Ignore CT shill noise around Mirage Narrative and Last Man Standing — exit liquidity."

PLAYS:
BTC: ENTRY (small) — low-beta leader of BTC Ecosystem rotation, -2.6% 7d
ORDI: HOLD/WATCH — -25% 7d deepest drawdown, second-leg beta if BTC confirms
SATS: HOLD/WATCH — -14.8% 7d, sympathy candidate, not a leader

AVOID:
GAMBLE — CT emergence + strong shill signal + Toshi.bet casino promo = exit liquidity
BIOHACK — MIXED CT, possible shill, no smart money or price confirmation
Mirage Narrative / XRP conspiracy — no ticker, pure noise

WATCH TRIGGERS (CAUTION → HUNT flip):
1. Smart money inflow into BTC Ecosystem names ($0 → any = biggest tell)
2. BTC breaks higher + ORDI/SATS catch bid within 24-48h → rotation confirmed
3. Heat score returns above 55 with stable BTC.D → confirmation
4. AI/AI_agents correlation r=1.00 — if BTC Ecosystem fails, AI basket is next candidate

WHALE FLOW (last 50 min):
Net: +$1.27M · 200 trades · Buy $9.82M (109 trades) · Sell $8.55M (91 trades)
Buy pressure 54% · Token: WETH dominant

SMART APE ALERTS:
Smart Ape #1 bought large MUSK (5d old) — 15 May 14:46
Smart Ape #1 bought large GPT (5d old) — 15 May 14:13

SPOTLIGHT (5 aligned):
SOL: -3.5% 24h · Smart money #1 accumulation · EDGE 2.9/10 · hot L1s
SUI: -4.9% 24h · L1s narrative · EDGE 4.7/10 · Conviction 2/5
DOGE: -3.2% 24h · memecoins narrative · EDGE 3.1/10
SHIB: -3.9% 24h · memecoins narrative
PEPE: -3.9% 24h · memecoins narrative

RISK TO THESIS: Smart money stays idle + BTC.D grinds higher without follow-through → rotation is attention noise on a still-bleeding basket. Concentration: 2 narratives (top 60%) — no forced-rebalance pressure, patience is cheap.`,
      coins: ['BTC', 'ETH', 'SOL', 'SUI', 'DOGE', 'PEPE'],
      signals: ['funding', 'dominance', 'RSI', 'OI', 'volume', 'bullish', 'bearish', 'support'],
      phase: 'ACCUMULATION',
    },
  ];
  _intelLog = seeds;
  if (_db) {
    await _db.from('intel_log').upsert(
      seeds.map(e => ({ id: e.id, timestamp: e.timestamp, source: e.source,
        raw: e.raw, coins: e.coins, signals: e.signals, phase: e.phase || null }))
    );
  } else {
    localStorage.setItem('hype_intel_log', JSON.stringify(_intelLog));
  }
}

// ── Intel parsing ─────────────────────────────────────────────────────────────

const KNOWN_COINS = ['BTC','ETH','SOL','HYPE','SUI','AVAX','DOGE','WIF','PEPE','ARB','OP','INJ','LINK','ATOM','DOT','ADA','BNB','XRP','TON','TRX','SEI','APT','NEAR','FTM','STX','RNDR','ORDI','SATS'];

const PHASE_KW = {
  ACCUMULATION: ['accumulation','accumulate','accumulating','wyckoff bottom','spring','reaccumulation','phase b','phase c','shakeout','lps','last point of support'],
  MARKUP:       ['markup','uptrend','breakout','break out','bull run','rally','pump','impulse','higher high','higher low','upside'],
  DISTRIBUTION: ['distribution','distributing','lower high','lfh','wyckoff top','redistribution','phase d','buying climax','bcx','utad'],
  MARKDOWN:     ['markdown','downtrend','breakdown','break down','bear','dump','capitulation','flush','lower low','downside'],
};

const SIGNAL_KW = [
  'RSI','MACD','EMA','SMA','volume','OI','open interest','funding','dominance',
  'support','resistance','divergence','golden cross','death cross','squeeze',
  'oversold','overbought','bullish','bearish','consolidat','higher low',
  'lower high','higher high','lower low','liquidity','order block','fair value gap',
  'FVG','OB','imbalance','HTF','LTF','weekly','daily','4h','1h','MVRV','NUPL',
];

function parseIntel(text) {
  const upper = text.toUpperCase();
  const coins = KNOWN_COINS.filter(c => new RegExp(`\\b${c}\\b`).test(upper));
  const signals = [...new Set(SIGNAL_KW.filter(s => text.toLowerCase().includes(s.toLowerCase())))];
  let phase = null;
  for (const [p, kws] of Object.entries(PHASE_KW)) {
    if (kws.some(kw => text.toLowerCase().includes(kw))) { phase = p; break; }
  }
  return { coins, signals, phase };
}

function intelToMD(entry) {
  const dt = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19);
  const tags = [
    entry.coins.length ? `**Coins:** ${entry.coins.join(', ')}` : '',
    entry.phase ? `**Phase:** ${entry.phase}` : '',
    entry.signals.length ? `**Signals:** ${entry.signals.slice(0, 6).join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  return `## [${entry.source}] ${dt} UTC\n\n${entry.raw}\n\n${tags ? `> ${tags}` : ''}`;
}

// ── Live prices (for graph) ───────────────────────────────────────────────────

let _liveCache = null, _liveCacheTs = 0;

async function fetchLivePricesForGraph() {
  if (_liveCache && Date.now() - _liveCacheTs < 30000) return _liveCache;
  if (typeof livePrices !== 'undefined' && Object.keys(livePrices).length > 4) {
    const pd = typeof livePrevDay !== 'undefined' ? livePrevDay : {};
    _liveCache = { prices: { ...livePrices }, prevDay: { ...pd } };
    _liveCacheTs = Date.now();
    return _liveCache;
  }
  try {
    const [mids, ctx] = await Promise.all([
      fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }) }).then(r => r.json()),
      fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) }).then(r => r.json()),
    ]);
    const prices = {}, prevDay = {};
    if (mids) for (const [c, p] of Object.entries(mids)) prices[c] = parseFloat(p);
    if (ctx?.[0]?.universe && ctx?.[1]) {
      ctx[0].universe.forEach((a, i) => {
        if (ctx[1][i]?.prevDayPx) prevDay[a.name] = parseFloat(ctx[1][i].prevDayPx);
      });
    }
    _liveCache = { prices, prevDay };
    _liveCacheTs = Date.now();
  } catch(e) {
    _liveCache = { prices: {}, prevDay: {} };
    _liveCacheTs = Date.now();
  }
  return _liveCache;
}

function pctChange(coin, prices, prevDay) {
  const now = prices[coin], prev = prevDay[coin];
  if (!now || !prev) return null;
  return (now - prev) / prev * 100;
}

function coinNodeColor(pct) {
  if (pct === null)  return '#6b7280';
  if (pct >  3)      return '#4ade80';
  if (pct >  0.5)    return '#86efac';
  if (pct < -3)      return '#f87171';
  if (pct < -0.5)    return '#fca5a5';
  return '#6b7280';
}

// ── AI shell ──────────────────────────────────────────────────────────────────

async function loadAI() {
  const el = document.getElementById('ai-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading intel…</div>';
  await loadIntelFromDB();
  renderAIShell();
}

function renderAIShell() {
  const el = document.getElementById('ai-content');
  if (!el) return;
  const coinCount = [...new Set(_intelLog.flatMap(e => e.coins))].length;
  const lastDate  = _intelLog.length ? new Date(_intelLog[0].timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  el.innerHTML = `
    <div class="ai-stat-strip">
      <div class="ai-stat-cell"><div class="ai-stat-label">Intel Entries</div><div class="ai-stat-val">${_intelLog.length}</div></div>
      <div class="ai-stat-cell"><div class="ai-stat-label">Coins Tracked</div><div class="ai-stat-val">${coinCount}</div></div>
      <div class="ai-stat-cell"><div class="ai-stat-label">AI Engine</div><div class="ai-stat-val" style="color:var(--green)">Claude</div></div>
      <div class="ai-stat-cell"><div class="ai-stat-label">Last Intel</div><div class="ai-stat-val" style="font-size:12px">${lastDate}</div></div>
    </div>
    <div class="filter-bar" style="flex-wrap:wrap;gap:6px">
      <div style="display:flex;gap:6px">
        ${['intel', 'graph', 'chat'].map(t => {
          const icons  = { intel: '📋', graph: '🕸', chat: '💬' };
          const labels = { intel: 'Intel Log', graph: 'Graph', chat: 'Chat' };
          return `<button class="chip${_aiSubTab === t ? ' active' : ''}" onclick="setAITab('${t}')">${icons[t]} ${labels[t]}</button>`;
        }).join('')}
      </div>
      <div class="filter-sep"></div>
      <span style="font-size:11px;color:var(--text-muted)">Powered by Claude · key secured server-side</span>
    </div>
    <div id="ai-sub-content"></div>`;

  if (_aiSubTab === 'intel') renderIntelTab();
  if (_aiSubTab === 'graph') renderKGraph();
  if (_aiSubTab === 'chat')  renderChatTab();
}

function setAITab(tab) { _aiSubTab = tab; renderAIShell(); }

// ── Intel Log tab ─────────────────────────────────────────────────────────────

function renderIntelTab() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;

  const rows = _intelLog.length === 0
    ? '<div class="chat-empty" style="padding:32px">No intel yet. Paste analysis from cryptowatch.id or anywhere else.</div>'
    : _intelLog.map(entry => {
        const dt = new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const coinBadges = entry.coins.map(c =>
          `<span style="background:rgba(80,210,193,0.10);color:var(--accent);border:1px solid rgba(80,210,193,0.2);border-radius:100px;font-size:10px;font-weight:700;padding:1px 7px">${c}</span>`
        ).join('');
        const phaseBadge = entry.phase
          ? `<span class="phase-badge phase-${entry.phase}" style="font-size:10px;padding:1px 7px">${entry.phase}</span>`
          : '';
        const preview = entry.raw.slice(0, 300).replace(/\n+/g, ' ');
        const hasMore = entry.raw.length > 300;
        return `<div class="note-card" style="margin-bottom:8px">
          <div class="note-header" style="align-items:flex-start">
            <div style="display:flex;flex-direction:column;gap:5px;flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:12px;font-weight:700;color:var(--text)">${aiEsc(entry.source)}</span>
                <span style="font-size:10px;color:var(--text-faint);font-family:var(--mono)">${dt}</span>
                ${phaseBadge}
              </div>
              ${coinBadges ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${coinBadges}</div>` : ''}
              ${entry.signals.length ? `<div style="font-size:10px;color:var(--text-muted)">${aiEsc(entry.signals.slice(0, 6).join(' · '))}</div>` : ''}
            </div>
            <button class="btn btn-danger btn-sm" style="flex-shrink:0;margin-left:8px" onclick="deleteIntel('${aiEsc(entry.id)}')" title="Delete">✕</button>
          </div>
          <div id="intel-preview-${entry.id}" class="note-body" style="font-size:12px;margin-top:6px;cursor:${hasMore ? 'pointer' : ''}" ${hasMore ? `onclick="toggleIntelExpand('${aiEsc(entry.id)}')"` : ''}>${aiEsc(preview)}${hasMore ? ' <span style="color:var(--accent);font-size:11px">[more]</span>' : ''}</div>
          <div id="intel-full-${entry.id}" style="display:none;margin-top:8px">
            <pre style="white-space:pre-wrap;font-size:11px;color:var(--text-muted);font-family:var(--mono);line-height:1.6;background:var(--bg);border-radius:var(--radius-md);padding:10px 12px;border:1px solid var(--border)">${aiEsc(entry.raw)}</pre>
            <details style="margin-top:6px">
              <summary style="font-size:10px;color:var(--text-faint);cursor:pointer;padding:4px 0">View as Markdown</summary>
              <pre style="white-space:pre-wrap;font-size:10px;color:var(--text-faint);font-family:var(--mono);margin-top:4px;padding:8px 10px;background:var(--surface2);border-radius:var(--radius-sm)">${aiEsc(intelToMD(entry))}</pre>
            </details>
          </div>
        </div>`;
      }).join('');

  el.innerHTML = `
    <div class="notes-wrap">
      <div class="note-add">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" id="intel-source" placeholder="Source (e.g. cryptowatch.id)" value="cryptowatch.id" style="max-width:220px">
          <span style="font-size:11px;color:var(--text-faint)">Coins, phases & signals auto-extracted</span>
        </div>
        <textarea class="input note-textarea" id="intel-text"
          placeholder="Paste market analysis, narratives, macro intel, desk setups…"
          rows="5" style="min-height:100px"></textarea>
        <button class="btn btn-primary" onclick="addIntel()" style="align-self:flex-start">📋 Save Intel</button>
      </div>
      ${_intelLog.length > 0 ? `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px">
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${_intelLog.length} entries · newest first</span>
        <button class="btn btn-ghost btn-sm" onclick="exportIntel()">⬇ Export MD</button>
      </div>` : ''}
      <div class="notes-list">${rows}</div>
    </div>`;
}

function toggleIntelExpand(id) {
  const full    = document.getElementById(`intel-full-${id}`);
  const preview = document.getElementById(`intel-preview-${id}`);
  if (!full) return;
  const open = full.style.display !== 'none';
  full.style.display    = open ? 'none' : 'block';
  if (preview) preview.style.display = open ? '' : 'none';
}

async function addIntel() {
  const source = document.getElementById('intel-source')?.value?.trim() || 'manual';
  const raw    = document.getElementById('intel-text')?.value?.trim();
  if (!raw) return;
  const parsed = parseIntel(raw);
  const entry  = { id: 'intel::' + Date.now(), timestamp: Date.now(), source, raw, ...parsed };
  _intelLog.unshift(entry);
  await _saveIntel(entry);
  document.getElementById('intel-text').value = '';
  renderIntelTab();
}

async function deleteIntel(id) {
  if (!confirm('Delete this intel entry? It cannot be recovered.')) return;
  _intelLog = _intelLog.filter(e => e.id !== id);
  if (_db) {
    await _db.from('intel_log').delete().eq('id', id);
  } else {
    localStorage.setItem('hype_intel_log', JSON.stringify(_intelLog));
  }
  renderIntelTab();
}

function exportIntel() {
  const md   = _intelLog.map(intelToMD).join('\n\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `hype-intel-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
}

// ── Knowledge Graph with live prices ─────────────────────────────────────────

async function renderKGraph() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading live prices…</div>';

  let prices = {}, prevDay = {};
  try { ({ prices, prevDay } = await fetchLivePricesForGraph()); } catch(e) {}

  const W = Math.min(el.clientWidth || 900, window.innerWidth - 16);
  const H = 560;

  const GRAPH_COINS = ['BTC', 'ETH', 'SOL', 'HYPE'];
  const TYPE_COLOR  = { coin: null, intel: '#818cf8', phase: '#fbbf24', signal: '#fb923c', narrative: '#34d399' };
  const TYPE_R      = { coin: 22,   intel: 11,        phase: 13,        signal: 9,         narrative: 10 };

  const nodes = [];
  const idMap = {};

  // Coin nodes with live price
  for (const coin of GRAPH_COINS) {
    const pct   = pctChange(coin, prices, prevDay);
    const color = coinNodeColor(pct);
    const price = prices[coin];
    nodes.push({
      id: `c:${coin}`, label: coin, type: 'coin', color,
      price, pct,
      priceStr: price ? fmt$(price) : '—',
      pctStr: pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : '',
      r: TYPE_R.coin,
      x: W / 2 + (Math.random() - .5) * 180,
      y: H / 2 + (Math.random() - .5) * 130,
      vx: 0, vy: 0,
    });
  }

  // Intel nodes (last 20)
  const recentIntel = _intelLog.slice(0, 20);
  for (const entry of recentIntel) {
    const dt = new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    nodes.push({
      id: entry.id, label: dt, sublabel: entry.source.slice(0, 16),
      type: 'intel', color: TYPE_COLOR.intel, r: TYPE_R.intel,
      x: W / 2 + (Math.random() - .5) * W * .68,
      y: H / 2 + (Math.random() - .5) * H * .55,
      vx: 0, vy: 0, _entry: entry,
    });
  }

  // Phase nodes
  const PHASE_COLORS = { ACCUMULATION: '#50d2c1', MARKUP: '#4ade80', DISTRIBUTION: '#fbbf24', MARKDOWN: '#f87171' };
  const phasesUsed = [...new Set(_intelLog.map(e => e.phase).filter(Boolean))];
  for (const phase of phasesUsed) {
    nodes.push({
      id: `p:${phase}`, label: phase.slice(0, 5), sublabel: phase,
      type: 'phase', color: PHASE_COLORS[phase] || '#6b7280', r: TYPE_R.phase,
      x: W / 2 + (Math.random() - .5) * W * .4,
      y: H / 2 + (Math.random() - .5) * H * .4,
      vx: 0, vy: 0,
    });
  }

  // Narrative nodes (extracted from intel: btc_ecosystem, perps_dex, RWA, l1s, memecoins)
  const NARRATIVES_KW = { 'btc_ecosystem': ['btc ecosystem','ordi','sats'], 'perps_dex': ['perps dex','perps_dex'], 'RWA': ['rwa','ondo'], 'l1s': ['l1s','l1 narrative'], 'memecoins': ['memecoin','doge','pepe','shib'] };
  const narrativesUsed = new Set();
  for (const entry of _intelLog) {
    for (const [name, kws] of Object.entries(NARRATIVES_KW)) {
      if (kws.some(kw => entry.raw.toLowerCase().includes(kw))) narrativesUsed.add(name);
    }
  }
  for (const narr of narrativesUsed) {
    nodes.push({
      id: `n:${narr}`, label: narr.slice(0, 10), sublabel: narr,
      type: 'narrative', color: TYPE_COLOR.narrative, r: TYPE_R.narrative,
      x: W / 2 + (Math.random() - .5) * W * .5,
      y: H / 2 + (Math.random() - .5) * H * .45,
      vx: 0, vy: 0,
    });
  }

  // Signal nodes (top 8)
  const sigCount = {};
  for (const entry of _intelLog) for (const s of entry.signals) sigCount[s] = (sigCount[s] || 0) + 1;
  const topSignals = Object.entries(sigCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  for (const sig of topSignals) {
    nodes.push({
      id: `s:${sig}`, label: sig.slice(0, 9), sublabel: `${sig} ×${sigCount[sig]}`,
      type: 'signal', color: TYPE_COLOR.signal, r: TYPE_R.signal,
      x: W / 2 + (Math.random() - .5) * W * .55,
      y: H / 2 + (Math.random() - .5) * H * .5,
      vx: 0, vy: 0,
    });
  }

  for (const n of nodes) idMap[n.id] = n;

  // ── Build edges ──
  const edges = [];
  const edgeSet = new Set();
  function addEdge(a, b, strength = 1) {
    const key = [a, b].sort().join('||');
    if (!edgeSet.has(key) && idMap[a] && idMap[b]) {
      edgeSet.add(key);
      edges.push({ source: idMap[a], target: idMap[b], strength });
    }
  }

  for (const entry of recentIntel) {
    for (const coin of entry.coins.filter(c => GRAPH_COINS.includes(c))) addEdge(entry.id, `c:${coin}`, 2);
    if (entry.phase) addEdge(entry.id, `p:${entry.phase}`, 1.5);
    for (const sig of entry.signals.filter(s => topSignals.includes(s))) addEdge(entry.id, `s:${sig}`, 0.6);
    // Intel ↔ narrative
    for (const [name, kws] of Object.entries(NARRATIVES_KW)) {
      if (narrativesUsed.has(name) && kws.some(kw => entry.raw.toLowerCase().includes(kw))) addEdge(entry.id, `n:${name}`, 1);
    }
    // Intel ↔ Intel (shared 2+ tracked coins)
    for (const other of recentIntel) {
      if (other.id <= entry.id) continue;
      const shared = entry.coins.filter(c => other.coins.includes(c) && GRAPH_COINS.includes(c));
      if (shared.length >= 2) addEdge(entry.id, other.id, 0.5);
    }
  }

  // Coin → phase / signal / narrative
  for (const coin of GRAPH_COINS) {
    const match = recentIntel.find(e => e.coins.includes(coin) && e.phase);
    if (match) addEdge(`c:${coin}`, `p:${match.phase}`, 2);
    const matches = recentIntel.filter(e => e.coins.includes(coin));
    const coinSigs = [...new Set(matches.flatMap(e => e.signals).filter(s => topSignals.includes(s)))].slice(0, 2);
    for (const sig of coinSigs) addEdge(`c:${coin}`, `s:${sig}`, 1);
  }
  // Narrative → coin (if mentioned together)
  for (const [name] of Object.entries(NARRATIVES_KW)) {
    if (!narrativesUsed.has(name)) continue;
    const nEntry = recentIntel.find(e => e.raw.toLowerCase().includes(name.replace('_', ' ')));
    if (nEntry) for (const coin of nEntry.coins.filter(c => GRAPH_COINS.includes(c))) addEdge(`n:${name}`, `c:${coin}`, 1);
  }

  // ── Force-directed layout ──
  const k = Math.sqrt(W * H / Math.max(nodes.length, 1)) * 0.92;
  for (let iter = 0; iter < 160; iter++) {
    for (const n of nodes) { n.fx = 0; n.fy = 0; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x || .1, dy = nodes[i].y - nodes[j].y || .1;
        const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (k * k) / d;
        nodes[i].fx += dx / d * f; nodes[i].fy += dy / d * f;
        nodes[j].fx -= dx / d * f; nodes[j].fy -= dy / d * f;
      }
    }
    for (const e of edges) {
      const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d * d) / k * 0.07 * e.strength;
      e.source.fx += dx / d * f; e.source.fy += dy / d * f;
      e.target.fx -= dx / d * f; e.target.fy -= dy / d * f;
    }
    for (const n of nodes) {
      n.fx += (W / 2 - n.x) * .013; n.fy += (H / 2 - n.y) * .013;
      n.vx = (n.vx + n.fx) * .78;   n.vy = (n.vy + n.fy) * .78;
      n.x = Math.max(n.r + 6, Math.min(W - n.r - 6, n.x + n.vx));
      n.y = Math.max(n.r + 6, Math.min(H - n.r - 6, n.y + n.vy));
    }
  }

  // ── Render ──
  const edgeSvg = edges.map(e => {
    const w  = e.strength >= 1.5 ? '2' : e.strength >= 1 ? '1.3' : '0.7';
    const op = e.strength >= 1.5 ? '0.6' : e.strength >= 1 ? '0.45' : '0.25';
    return `<line x1="${e.source.x.toFixed(0)}" y1="${e.source.y.toFixed(0)}" x2="${e.target.x.toFixed(0)}" y2="${e.target.y.toFixed(0)}" stroke="#383838" stroke-width="${w}" opacity="${op}"/>`;
  }).join('');

  const nodesSvg = nodes.map(n => {
    const x = n.x.toFixed(0), y = n.y.toFixed(0), r = n.r;
    if (n.type === 'coin') {
      return `<g onclick="kgClick(this)" data-id="${aiEsc(n.id)}" data-label="${aiEsc(n.label)}" data-type="coin" data-price="${aiEsc(n.priceStr)}" data-pct="${aiEsc(n.pctStr)}" style="cursor:pointer">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${n.color}" fill-opacity="0.20" stroke="${n.color}" stroke-width="2.5"/>
        <text x="${x}" y="${(+y + 4).toFixed(0)}" fill="${n.color}" font-size="11" font-weight="700" text-anchor="middle" font-family="monospace">${aiEsc(n.label)}</text>
        <text x="${x}" y="${(+y + r + 12).toFixed(0)}" fill="${n.color}" font-size="8.5" text-anchor="middle" font-family="monospace">${aiEsc(n.priceStr)}</text>
        <text x="${x}" y="${(+y + r + 22).toFixed(0)}" fill="${n.color}" font-size="8" text-anchor="middle" font-family="monospace">${aiEsc(n.pctStr)}</text>
      </g>`;
    }
    const lbl = (n.label || '').slice(0, 10);
    return `<g onclick="kgClick(this)" data-id="${aiEsc(n.id)}" data-label="${aiEsc(n.sublabel || n.label)}" data-type="${n.type}" style="cursor:pointer">
      <circle cx="${x}" cy="${y}" r="${r}" fill="${n.color}" fill-opacity="0.15" stroke="${n.color}" stroke-width="1.5"/>
      <text x="${x}" y="${(+y + 3.5).toFixed(0)}" fill="${n.color}" font-size="${n.type === 'phase' ? '8' : '7'}" text-anchor="middle" font-family="monospace" font-weight="600">${aiEsc(lbl)}</text>
    </g>`;
  }).join('');

  const legend = [
    { c: '#50d2c1',                l: 'Coin (live)' },
    { c: TYPE_COLOR.intel,         l: 'Intel entry' },
    { c: TYPE_COLOR.phase,         l: 'Phase' },
    { c: TYPE_COLOR.narrative,     l: 'Narrative' },
    { c: TYPE_COLOR.signal,        l: 'Signal' },
  ].map(({ c, l }) => `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="1.5"/></svg>${l}</div>`).join('');

  el.innerHTML = `
    <svg id="kg-svg" width="${W}" height="${H}" style="display:block;background:var(--surface);border-bottom:1px solid var(--border)">${edgeSvg}${nodesSvg}</svg>
    <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 16px;background:var(--surface);border-bottom:1px solid var(--border);align-items:center">
      ${legend}
      <span style="margin-left:auto;font-size:11px;color:var(--text-faint)">${nodes.length} nodes · ${edges.length} edges</span>
      <button class="btn btn-ghost btn-sm" onclick="_liveCacheTs=0;setAITab('graph')">↺ Prices</button>
    </div>
    <div id="kg-detail" style="padding:10px 16px;background:var(--surface2);font-size:12px;color:var(--text-muted);min-height:42px;line-height:1.6">Click a node to inspect · Coin nodes show live price from Hyperliquid</div>`;
}

function kgClick(el) {
  const type  = el.dataset.type;
  const label = el.dataset.label;
  let html = `<strong style="color:var(--text)">${aiEsc(label)}</strong> <span class="chat-source-type" style="margin-left:6px">${type}</span>`;

  if (type === 'coin') {
    html += ` <span style="font-family:var(--mono);font-size:12px;color:var(--text);margin-left:8px">${aiEsc(el.dataset.price)}</span>`;
    const pct = parseFloat(el.dataset.pct);
    if (!isNaN(pct)) html += ` <span class="${pct >= 0 ? 'pos' : 'neg'}" style="font-family:var(--mono);font-size:12px">${aiEsc(el.dataset.pct)}</span>`;
    const coinId = el.dataset.id?.replace('c:', '') || label;
    const coinIntel = _intelLog.filter(e => e.coins.includes(coinId)).slice(0, 3);
    if (coinIntel.length) {
      html += '<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">' +
        coinIntel.map(e => `<div style="font-size:11px;padding:4px 8px;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border)"><span style="color:var(--text-faint);font-size:10px">${new Date(e.timestamp).toLocaleDateString()} · ${aiEsc(e.source)}</span><br>${aiEsc(e.raw.slice(0, 130))}…</div>`).join('') +
        '</div>';
    }
  }

  if (type === 'intel') {
    const id    = el.dataset.id;
    const entry = _intelLog.find(e => e.id === id);
    if (entry) {
      const dt = new Date(entry.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      html += `<div style="margin-top:5px;font-size:11px;color:var(--text-muted)">${dt} · ${aiEsc(entry.source)}</div>`;
      if (entry.coins.length) html += `<div style="margin-top:3px;font-size:11px"><span style="color:var(--text-faint)">Coins: </span>${entry.coins.map(c => `<span style="color:var(--accent)">${c}</span>`).join(' ')}</div>`;
      html += `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${aiEsc(entry.raw.slice(0, 220))}${entry.raw.length > 220 ? '…' : ''}</div>`;
    }
  }

  if (type === 'phase' || type === 'signal' || type === 'narrative') {
    const related = _intelLog.filter(e =>
      type === 'phase'     ? e.phase === label.toUpperCase() :
      type === 'signal'    ? e.signals.some(s => s.toLowerCase() === label.toLowerCase()) :
      e.raw.toLowerCase().includes(label.toLowerCase().replace('_', ' '))
    ).slice(0, 3);
    if (related.length) {
      html += `<div style="margin-top:5px;font-size:11px;color:var(--text-faint)">${related.length} intel entr${related.length > 1 ? 'ies' : 'y'}:</div>` +
        '<div style="margin-top:4px;display:flex;flex-direction:column;gap:3px">' +
        related.map(e => `<div style="font-size:10px;color:var(--text-muted);padding:3px 6px;background:var(--surface);border-radius:var(--radius-sm)">${new Date(e.timestamp).toLocaleDateString()} · ${aiEsc(e.source)} — ${aiEsc(e.raw.slice(0, 80))}…</div>`).join('') +
        '</div>';
    }
  }

  document.getElementById('kg-detail').innerHTML = html;
}

// ── Chat tab ──────────────────────────────────────────────────────────────────

function renderChatTab() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const histHtml = _chatHistory.length === 0
    ? `<div class="chat-empty">Ask anything about your intel, MVRV signals, or setups.<br><br><span style="color:var(--text-faint)">Intel log used as context · Add Anthropic API key above to enable Claude</span></div>`
    : _chatHistory.map(m => m.role === 'user'
        ? `<div class="chat-bubble user">${aiEsc(m.content)}</div>`
        : `<div class="chat-bubble assistant"><div class="chat-answer">${mdToHtml(m.content)}</div></div>`
      ).join('');
  el.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-history" id="chat-history">${histHtml}</div>
      <div class="chat-input-row">
        <input class="input chat-input" id="chat-input" placeholder="Ask about your intel, setups, MVRV…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat();}">
        <button class="btn btn-primary" onclick="sendChat()">Send</button>
        ${_chatHistory.length ? `<button class="btn btn-ghost btn-sm" onclick="_chatHistory=[];renderChatTab()">Clear</button>` : ''}
      </div>
    </div>`;
  const h = document.getElementById('chat-history');
  if (h) h.scrollTop = h.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const q = input?.value?.trim();
  if (!q) return;
  input.value = ''; input.disabled = true;
  _chatHistory.push({ role: 'user', content: q });
  renderChatTab();

  let intelCtx = '', ctxLen = 0;
  for (const entry of _intelLog) {
    const line = `[${new Date(entry.timestamp).toLocaleDateString()} · ${entry.source}]\n${entry.raw}\n\n`;
    if (ctxLen + line.length > 3000) break;
    intelCtx += line; ctxLen += line.length;
  }

  const mvrvCtx = _mvrvCache
    ? 'MVRV: ' + MVRV_ORDER.map(s => { const c = _mvrvCache.coins[s]; return c ? `${s}=${c.mvrv.toFixed(3)}(${c.zone})` : ''; }).join(' ')
    : '';

  const system = [
    'You are an AI trading research assistant for the Hype crypto dashboard.',
    'Analyze BTC, ETH, SOL, HYPE using the saved intel log below.',
    'MVRV zones: >1.4 overheated, 1.15–1.4 bullish, 0.85–1.15 neutral, <0.85 undervalued.',
    mvrvCtx,
    intelCtx ? `\nIntel Log (newest first):\n${intelCtx}` : '',
    'Be concise. Reference specific intel entries when relevant. Flag when signals conflict.',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages: _chatHistory.map(m => ({ role: m.role, content: m.content })) }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    _chatHistory.push({ role: 'assistant', content: d.content || JSON.stringify(d) });
  } catch(e) {
    _chatHistory.push({ role: 'assistant', content: `Error: ${e.message}` });
  }
  renderChatTab();
  if (input) input.disabled = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function aiEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdToHtml(md) {
  return String(md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--surface2);padding:1px 4px;border-radius:3px;font-family:var(--mono);font-size:12px">$1</code>')
    .replace(/\n/g, '<br>');
}

// ── Patch navigate() ──────────────────────────────────────────────────────────

(function patchNavigate() {
  const _orig = window.navigate;
  if (!_orig) return;
  window.navigate = function(page) {
    _orig(page);
    if (page === 'mvrv') loadMVRV();
    if (page === 'ai')   loadAI();
  };
})();
