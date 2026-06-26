// ── Intel Tab — Live Market Intelligence ─────────────────────────────────────
// Replaces the static Cryptowatch paste. All data auto-fetched.
//
// Sources (all free, no API key):
//   • Hyperliquid:     prices, funding, OI for tracked coins
//   • Binance Futures: BTC/ETH OI (market-wide), funding, 24h OI history
//   • Bybit:           BTC funding rate (cross-exchange average)
//   • CoinGecko:       BTC dominance, altcoin breadth, global mcap
//   • alternative.me:  Fear & Greed Index
//   • _mvrvData global (mvrv-ai.js): MVRV Z-Score
//
// Auto-scores: regime verdict, radar axes, evidence trail
// Claude:       synthesis paragraph + desk setups via Edge Function

// ── Endpoints ─────────────────────────────────────────────────────────────────

const _IL = {
  BN_OI:      'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
  BN_FUND:    'https://fapi.binance.com/fapi/v1/premiumIndex',
  BN_OI_HIST: 'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25',
  BY_FUND:    'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1',
  FNG:        'https://api.alternative.me/fng/?limit=1',
};

const INTEL_TRACK = ['BTC', 'ETH', 'SOL', 'HYPE'];

let _intelData     = null;
let _intelRegime   = null;
let _intelSetups   = null;      // Claude-generated desk setups (persisted per session)
let _intelSynth    = null;      // Claude synthesis text
let _intelTimer    = null;
let _intelGenState = { setups: false, synth: false }; // loading flags

let _apiuData  = null;   // { asset, daily_verdict, regime_state, fetched_at, ts }
let _apiuState = 'idle';  // idle | loading | error | unconfigured

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function _ilFetchHL() {
  const [meta, ctxs] = await getMetaAndAssetCtxs();
  const map = {};
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    map[u.name] = {
      price:   parseFloat(c.markPx   || 0),
      funding: parseFloat(c.funding  || 0),   // per 1h (HL is hourly)
      oiCoins: parseFloat(c.openInterest || 0),
      get oi()   { return this.oiCoins * this.price; },
      get aprHL(){ return this.funding * 24 * 365 * 100; },
    };
  });
  return map;
}

async function _ilFetchBinance() {
  const [oiR, fundBtcR, fundEthR, oiHistR] = await Promise.allSettled([
    fetch(_IL.BN_OI).then(r => r.json()),
    fetch(_IL.BN_FUND + '?symbol=BTCUSDT').then(r => r.json()),
    fetch(_IL.BN_FUND + '?symbol=ETHUSDT').then(r => r.json()),
    fetch(_IL.BN_OI_HIST).then(r => r.json()),
  ]);

  const btcOiCoins   = oiR.status === 'fulfilled'     ? parseFloat(oiR.value.openInterest   || 0) : null;
  const btcFund8h    = fundBtcR.status === 'fulfilled' ? parseFloat(fundBtcR.value.lastFundingRate || 0) : null;
  const ethFund8h    = fundEthR.status === 'fulfilled' ? parseFloat(fundEthR.value.lastFundingRate || 0) : null;
  const btcMarkPx    = fundBtcR.status === 'fulfilled' ? parseFloat(fundBtcR.value.markPrice || 0) : null;

  let oiChange24h = null;
  if (oiHistR.status === 'fulfilled' && Array.isArray(oiHistR.value) && oiHistR.value.length >= 24) {
    const h = oiHistR.value;
    const newest = parseFloat(h[h.length - 1].sumOpenInterestValue || 0);
    const oldest = parseFloat(h[0].sumOpenInterestValue || 0);
    oiChange24h = oldest > 0 ? ((newest - oldest) / oldest) * 100 : null;
    // sumOpenInterestValue is in USD
    var btcOiUsd = newest;
  }

  return {
    btcOiCoins,
    btcOiUsd:   typeof btcOiUsd !== 'undefined' ? btcOiUsd : (btcOiCoins && btcMarkPx ? btcOiCoins * btcMarkPx : null),
    btcFund8h,              // decimal (e.g. 0.0001 = 0.01%/8h)
    btcFundApr: btcFund8h != null ? btcFund8h * 3 * 365 * 100 : null,  // annualised %
    ethFundApr: ethFund8h != null ? ethFund8h * 3 * 365 * 100 : null,
    oiChange24h,
  };
}

async function _ilFetchBybit() {
  const r = await fetch(_IL.BY_FUND);
  const d = await r.json();
  const rate = parseFloat(d.result?.list?.[0]?.fundingRate || 0);  // 8h rate
  return rate * 3 * 365 * 100;   // APR %
}

async function _ilFetchCG() {
  const [gR, mR] = await Promise.allSettled([
    getCGGlobal(),
    getCGMarkets(),
  ]);
  let btcDom = null, mcapChange24h = null, totalMcap = null, totalVol = null, altBreadth = null;
  let cgCoins = [];

  if (gR.status === 'fulfilled') {
    const g = gR.value;
    btcDom        = g.market_cap_percentage?.btc ?? null;
    mcapChange24h = g.market_cap_change_percentage_24h_usd ?? null;
    totalMcap     = g.total_market_cap?.usd ?? null;
    totalVol      = g.total_volume?.usd ?? null;
  }
  if (mR.status === 'fulfilled' && Array.isArray(mR.value)) {
    cgCoins = mR.value.filter(c => !['usdt','usdc','dai','busd','tusd','usdd'].includes(c.symbol));
    const up = cgCoins.filter(c => (c.price_change_percentage_24h || 0) > 0).length;
    altBreadth = cgCoins.length ? Math.round(up / cgCoins.length * 100) : null;
  }
  return { btcDom, mcapChange24h, totalMcap, totalVol, altBreadth, cgCoins };
}

async function _ilFetchFNG() {
  const r = await fetch(_IL.FNG);
  const d = await r.json();
  const e = d.data?.[0];
  return e ? { value: parseInt(e.value), label: e.value_classification } : null;
}

async function _fetchIntelData() {
  const [hl, bn, bybitApr, cg, fng] = await Promise.all([
    _ilFetchHL().catch(() => ({})),
    _ilFetchBinance().catch(() => ({})),
    _ilFetchBybit().catch(() => null),
    _ilFetchCG().catch(() => ({})),
    _ilFetchFNG().catch(() => null),
  ]);

  const btc  = hl['BTC']  || {};
  const eth  = hl['ETH']  || {};
  const sol  = hl['SOL']  || {};
  const hype = hl['HYPE'] || {};

  // Cross-exchange BTC funding average (HL + Binance + Bybit)
  const fundSamples = [btc.aprHL, bn.btcFundApr, bybitApr].filter(f => f != null);
  const btcFundApr  = fundSamples.length ? fundSamples.reduce((a, b) => a + b, 0) / fundSamples.length : null;

  // MVRV Z from mvrv-ai.js global
  const mvrvZ = (typeof _mvrvData !== 'undefined' && _mvrvData?.summary?.z_score != null)
    ? _mvrvData.summary.z_score : null;

  return {
    ts:           Date.now(),
    prices:       { BTC: btc.price, ETH: eth.price, SOL: sol.price, HYPE: hype.price },
    hlFundApr:    { BTC: btc.aprHL, ETH: eth.aprHL, SOL: sol.aprHL, HYPE: hype.aprHL },
    hlOI:         { BTC: btc.oi, ETH: eth.oi, SOL: sol.oi, HYPE: hype.oi },
    btcFundApr,                        // cross-exchange avg, annualised %
    ethFundApr:   bn.ethFundApr,
    bnBtcOiUsd:   bn.btcOiUsd,        // Binance BTC perp OI in USD (market-wide)
    oiChange24h:  bn.oiChange24h,
    btcDom:       cg.btcDom,
    mcapChange24h: cg.mcapChange24h,
    totalMcap:    cg.totalMcap,
    totalVol:     cg.totalVol,
    altBreadth:   cg.altBreadth,
    cgCoins:      cg.cgCoins,
    fng:          fng,
    mvrvZ,
  };
}

// ── Scoring Engine ────────────────────────────────────────────────────────────

function _scoreIntel(d) {
  const signals = [];

  // Helper: add signal with weighted score
  const sig = (name, score, note, value) => signals.push({ name, score, note, value });

  // MVRV Z-Score (weight 3)
  if (d.mvrvZ != null) {
    const z = d.mvrvZ;
    if      (z <  0) sig('MVRV Z',   3, 'Undervalued — historical buy zone', z.toFixed(2));
    else if (z <  1) sig('MVRV Z',   2, 'Below fair value',                  z.toFixed(2));
    else if (z <  2) sig('MVRV Z',   1, 'Fair value range',                  z.toFixed(2));
    else if (z <  4) sig('MVRV Z',   0, 'Neutral — watch closely',           z.toFixed(2));
    else if (z <  6) sig('MVRV Z',  -1, 'Elevated — late cycle',             z.toFixed(2));
    else             sig('MVRV Z',  -3, 'Danger zone — distribution risk',   z.toFixed(2));
  }

  // Fear & Greed (weight 2)
  if (d.fng?.value != null) {
    const fg = d.fng.value;
    if      (fg < 15) sig('Fear & Greed',  2, 'Extreme fear — historical buy zone', fg);
    else if (fg < 35) sig('Fear & Greed',  1, 'Fear — opportunistic zone',           fg);
    else if (fg < 55) sig('Fear & Greed',  0, 'Neutral',                             fg);
    else if (fg < 75) sig('Fear & Greed', -1, 'Greed — tighten stops',               fg);
    else              sig('Fear & Greed', -2, 'Extreme greed — reduce exposure',      fg);
  }

  // BTC Funding APR (weight 2)
  if (d.btcFundApr != null) {
    const f = d.btcFundApr;
    if      (f <  0)  sig('BTC Funding',  2, 'Negative — strong setup for longs', f.toFixed(1) + '%');
    else if (f <  5)  sig('BTC Funding',  1, 'Low — no crowding',                 f.toFixed(1) + '%');
    else if (f < 15)  sig('BTC Funding',  0, 'Neutral',                           f.toFixed(1) + '%');
    else if (f < 30)  sig('BTC Funding', -1, 'Elevated — longs crowding',         f.toFixed(1) + '%');
    else              sig('BTC Funding', -2, 'Very high — crowded, flush risk',    f.toFixed(1) + '%');
  }

  // Alt Breadth (weight 1)
  if (d.altBreadth != null) {
    const b = d.altBreadth;
    if      (b > 65) sig('Alt Breadth',  1, 'Broad rally — risk appetite healthy',  b + '%');
    else if (b > 45) sig('Alt Breadth',  0, 'Mixed — selective strength',           b + '%');
    else             sig('Alt Breadth', -1, 'Broad weakness — risk-off',            b + '%');
  }

  // Global MCap 24h (weight 1)
  if (d.mcapChange24h != null) {
    const m = d.mcapChange24h;
    if      (m >  3) sig('MCap 24h',  1, 'Rising — inflows present',  (m > 0 ? '+' : '') + m.toFixed(1) + '%');
    else if (m > -3) sig('MCap 24h',  0, 'Flat',                       m.toFixed(1) + '%');
    else             sig('MCap 24h', -1, 'Falling — outflows present', m.toFixed(1) + '%');
  }

  // OI Change 24h (weight 1)
  if (d.oiChange24h != null) {
    const o = d.oiChange24h;
    if      (o < -8) sig('BTC OI 24h',  1, 'Flushed — reset complete',         o.toFixed(1) + '%');
    else if (o <  5) sig('BTC OI 24h',  0, 'Stable',                           o.toFixed(1) + '%');
    else             sig('BTC OI 24h', -1, 'Rising fast — crowding building',   o.toFixed(1) + '%');
  }

  // BTC Dominance (weight 1)
  if (d.btcDom != null) {
    const dom = d.btcDom;
    if      (dom < 50) sig('BTC Dom',  1, 'Alt season conditions',                 dom.toFixed(1) + '%');
    else if (dom < 58) sig('BTC Dom',  0, 'Neutral — BTC/Alt balance',             dom.toFixed(1) + '%');
    else               sig('BTC Dom', -1, 'BTC dominance suppressing alts',        dom.toFixed(1) + '%');
  }

  // Aggregate
  const raw       = signals.reduce((sum, s) => sum + s.score, 0);
  const maxRaw    = 11;   // 3+2+2+1+1+1+1
  const normScore = Math.max(-10, Math.min(10, Math.round(raw * 10 / maxRaw)));

  const bullish  = signals.filter(s => s.score > 0).length;
  const bearish  = signals.filter(s => s.score < 0).length;
  const neutral  = signals.filter(s => s.score === 0).length;
  const agree    = Math.max(bullish, bearish);
  const confidence = signals.length
    ? Math.round(40 + (Math.abs(normScore) / 10) * 50)
    : 50;

  let verdict;
  if      (normScore >= 6)  verdict = 'BUY';
  else if (normScore >= 3)  verdict = 'BULL';
  else if (normScore >= -2) verdict = 'WAIT';
  else if (normScore >= -5) verdict = 'CAUTION';
  else                      verdict = 'SELL';

  // Radar axes (0–10, higher = more bullish)
  const radar = {
    Macro:     _r(5 + (d.mcapChange24h ?? 0) / 2),
    Cycle:     d.mvrvZ != null ? _r(Math.max(0, 10 - d.mvrvZ * 1.4)) : 5,
    OnChain:   d.mvrvZ != null ? _r(Math.max(0, 10 - d.mvrvZ * 1.2)) : 5,
    Derivs:    d.oiChange24h != null ? _r(5 - d.oiChange24h / 3) : 5,
    Funding:   d.btcFundApr  != null ? _r(8 - d.btcFundApr / 5)  : 5,
    Breadth:   d.altBreadth  != null ? _r(d.altBreadth / 10)      : 5,
    Sentiment: d.fng         != null ? _r((100 - d.fng.value) / 10) : 5,
  };

  // Evidence layers (auto-grouped)
  const layers = [
    _layer('L1 Macro',    [signals.find(s => s.name === 'MCap 24h'), signals.find(s => s.name === 'BTC Dom')]),
    _layer('L2 Cycle',    [signals.find(s => s.name === 'MVRV Z')]),
    _layer('L3 Derivs',   [signals.find(s => s.name === 'BTC Funding'), signals.find(s => s.name === 'BTC OI 24h')]),
    _layer('L4 Sentiment',[signals.find(s => s.name === 'Fear & Greed'), signals.find(s => s.name === 'Alt Breadth')]),
  ];

  return { score: normScore, verdict, confidence, signals, bullish, bearish, neutral, radar, layers };
}

function _r(v) { return Math.round(Math.max(0, Math.min(10, v))); }

function _layer(name, sigs) {
  const valid = sigs.filter(Boolean);
  if (!valid.length) return { name, score: 5, max: 10, receipts: 0, verdict: 'NEUTRAL' };
  const raw  = valid.reduce((sum, s) => sum + s.score, 0);
  const max  = valid.length * 3;
  const score = Math.round(((raw + max) / (2 * max)) * 10);
  const verdict = score >= 7 ? 'BULLISH' : score >= 4 ? 'NEUTRAL' : 'BEARISH';
  return { name, score, max: 10, receipts: valid.length, verdict };
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function _ilFmt$(n) {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString();
}
function _ilFmtP(n, dp = 2) {
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(dp) + '%';
}
function _ilFmtPrice(n) {
  if (!n) return '—';
  const dp = n < 1 ? 4 : n < 100 ? 2 : 0;
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function _postureColor(p) {
  return p === 'BUY' || p === 'BULL'   ? 'var(--green)'
       : p === 'SELL' || p === 'BEAR'  ? 'var(--red)'
       : p === 'CAUTION'               ? 'var(--yellow)'
       : 'var(--text-muted)';
}
function _verdictCls(v) {
  return v === 'BULLISH' ? 'pos' : v === 'BEARISH' ? 'neg' : 'muted';
}

// ── Load & Render ─────────────────────────────────────────────────────────────

async function loadIntel() {
  const el = document.getElementById('intel-content');
  if (!el) return;

  // If we have data < 3 min old, just re-render
  if (_intelData && Date.now() - _intelData.ts < 3 * 60 * 1000) {
    _renderIntel(el, _intelData, _intelRegime);
    _loadApiuCard();
    return;
  }

  el.innerHTML = `<div class="loading"><div class="spinner"></div> Fetching live market data…</div>`;

  try {
    _intelData   = await _fetchIntelData();
    _intelRegime = _scoreIntel(_intelData);
  } catch (e) {
    el.innerHTML = `<div class="news-empty">Failed to load intel data: ${e.message}<br><button class="btn btn-ghost btn-sm" onclick="loadIntel()" style="margin-top:8px">Retry</button></div>`;
    return;
  }

  _renderIntel(el, _intelData, _intelRegime);
  _loadApiuCard();

  clearInterval(_intelTimer);
  _intelTimer = setInterval(async () => {
    _intelData   = await _fetchIntelData().catch(() => _intelData);
    _intelRegime = _scoreIntel(_intelData);
    _renderIntel(document.getElementById('intel-content'), _intelData, _intelRegime);
    _loadApiuCard();
  }, 3 * 60 * 1000);
}

function _renderIntel(el, d, r) {
  if (!el) return;
  const scorePct   = ((r.score + 10) / 20) * 100;
  const scoreColor = r.score > 2 ? 'var(--green)' : r.score < -2 ? 'var(--red)' : 'var(--yellow)';
  const heatColor  = r.score > 4 ? 'var(--green)' : r.score < -3 ? 'var(--red)' : 'var(--yellow)';
  const btcDomNum  = d.btcDom ?? 0;
  const evTotal    = r.layers.reduce((a, l) => a + l.score, 0);
  const evMax      = r.layers.reduce((a, l) => a + l.max,   0);
  const evPct      = Math.round(evTotal / evMax * 100);
  const fgVal      = d.fng?.value ?? null;
  const updStr     = new Date(d.ts).toLocaleTimeString();

  el.innerHTML = `
  <!-- Indicator strip (reuse existing) -->
  ${typeof intelIndicatorStrip === 'function' ? intelIndicatorStrip() : ''}

  <!-- ── Posture Banner ──────────────────────────────────────────────────────── -->
  <div class="intel-posture-banner">
    <div class="intel-posture-main">
      <div>
        <div class="intel-posture-label">PORTFOLIO POSTURE <span style="font-size:9px;color:var(--text-faint);margin-left:4px">LIVE · ${updStr}</span></div>
        <div class="regime-pill regime-${r.verdict} intel-posture-verdict">${r.verdict}</div>
      </div>
      <div class="intel-posture-score-wrap">
        <div class="intel-posture-score-label">
          Score <span style="font-family:var(--mono);color:${scoreColor}">${r.score > 0 ? '+' : ''}${r.score}</span> / ±10
        </div>
        <div class="intel-score-track">
          <div class="intel-score-fill" style="width:${scorePct}%;background:${scoreColor}"></div>
          <div class="intel-score-mid"></div>
        </div>
        <div class="intel-posture-conf">${r.confidence}% confidence · ${r.bullish} bull / ${r.neutral} neutral / ${r.bearish} bear signals</div>
      </div>
      <div class="intel-posture-meta">
        <div><span class="intel-meta-label">MVRV Z</span><span class="intel-meta-val ${d.mvrvZ != null && d.mvrvZ < 2 ? 'pos' : d.mvrvZ != null && d.mvrvZ > 5 ? 'neg' : ''}">${d.mvrvZ != null ? d.mvrvZ.toFixed(2) : '—'}</span></div>
        <div><span class="intel-meta-label">F&G</span><span class="intel-meta-val">${fgVal ?? '—'} <span class="muted" style="font-size:10px">${d.fng?.label ?? ''}</span></span></div>
        <div><span class="intel-meta-label">Sources</span><span class="intel-meta-val muted">HL · BN · BY · CG</span></div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
      <button class="btn btn-ghost btn-sm" onclick="intelRefresh()" id="intel-refresh-btn">↺ Refresh</button>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSynth()" id="intel-synth-btn">✦ AI Synthesis</button>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSetups()" id="intel-setups-btn">✦ Generate Setups</button>
    </div>
  </div>

  <!-- ── APIU Macro Card (optional, requires proxy URL in Settings) ──────────── -->
  <div id="apiu-card-wrap">${_renderApiuCard()}</div>

  <!-- ── Key Metrics Strip ────────────────────────────────────────────────── -->
  <div class="stat-strip">
    ${_renderMetricCell('BTC Price', _ilFmtPrice(d.prices.BTC), d.cgCoins?.find(c => c.symbol === 'btc')?.price_change_percentage_24h, 'vs 24h ago')}
    ${_renderMetricCell('BTC Funding APR', d.btcFundApr != null ? (d.btcFundApr > 0 ? '+' : '') + d.btcFundApr.toFixed(1) + '%' : '—', null, d.btcFundApr != null ? (d.btcFundApr < 5 ? 'low · uncrowded' : d.btcFundApr > 20 ? 'very crowded' : 'elevated') : 'HL + BN + BY avg', false)}
    ${_renderMetricCell('BTC OI (Binance)', _ilFmt$(d.bnBtcOiUsd), d.oiChange24h, 'vs 24h ago')}
    ${_renderMetricCell('Alt Breadth', d.altBreadth != null ? d.altBreadth + '%' : '—', null, 'top 100 coins up 24h', false, d.altBreadth != null && d.altBreadth > 60, d.altBreadth != null && d.altBreadth < 35)}
    ${_renderMetricCell('BTC Dominance', d.btcDom != null ? d.btcDom.toFixed(1) + '%' : '—', null, `alt season ${btcDomNum > 55 ? 'far' : 'near'}`, false)}
    ${_renderMetricCell('Total MCap', _ilFmt$(d.totalMcap), d.mcapChange24h, 'vs 24h ago')}
  </div>

  <!-- ── Coin Funding Table ────────────────────────────────────────────────── -->
  <div class="card" style="padding:12px 14px">
    <div class="card-title" style="margin-bottom:8px">Live Funding & OI</div>
    <div style="overflow:auto">
      <table>
        <thead><tr><th>Coin</th><th class="num">Price</th><th class="num">HL Funding APR</th><th class="num">HL OI</th><th class="num">ETH Funding APR (BN)</th></tr></thead>
        <tbody>
          ${INTEL_TRACK.map(coin => {
            const apr = d.hlFundApr[coin];
            const aprCls = apr != null ? (apr < 0 ? 'pos' : apr > 20 ? 'neg' : '') : '';
            return `<tr>
              <td style="font-weight:700;font-family:var(--mono)">${coin}</td>
              <td class="num">${_ilFmtPrice(d.prices[coin])}</td>
              <td class="num ${aprCls}">${apr != null ? (apr > 0 ? '+' : '') + apr.toFixed(1) + '%' : '—'}</td>
              <td class="num">${_ilFmt$(d.hlOI[coin])}</td>
              <td class="num">${coin === 'ETH' ? (d.ethFundApr != null ? (d.ethFundApr > 0 ? '+' : '') + d.ethFundApr.toFixed(1) + '%' : '—') : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── Main 2-col Grid ───────────────────────────────────────────────────── -->
  <div class="intel-main-grid">

    <!-- LEFT: Radar + Signal Table -->
    <div class="intel-col">

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">Regime Radar</div>
          <span class="muted" style="font-size:10px">0–10 per axis · auto-scored</span>
        </div>
        <div class="intel-radar-wrap">
          <canvas id="regime-radar-chart" width="240" height="240"></canvas>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
          ${Object.entries(r.radar).map(([k, v]) => {
            const color = v >= 7 ? 'var(--green)' : v >= 5 ? 'var(--yellow)' : 'var(--red)';
            return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;padding:2px 7px;background:var(--surface2);border-radius:var(--radius-pill);border:1px solid var(--border)">
              <span style="color:var(--text-muted)">${k}</span>
              <span style="font-family:var(--mono);font-weight:700;color:${color}">${v}</span>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Signal Breakdown</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Signal</th><th>Reading</th><th style="width:80px">Weight</th><th class="num">Note</th></tr></thead>
            <tbody>
              ${r.signals.map(s => {
                const bar = Math.abs(s.score) / 3 * 100;
                const cls = s.score > 0 ? 'pos' : s.score < 0 ? 'neg' : 'muted';
                return `<tr>
                  <td>${s.name}</td>
                  <td class="num" style="font-family:var(--mono)">${s.value ?? '—'}</td>
                  <td>
                    <div class="intel-zbar">
                      <div class="intel-zbar-fill ${s.score > 0 ? 'pos-fill' : s.score < 0 ? 'neg-fill' : ''}" style="width:${bar}%"></div>
                    </div>
                  </td>
                  <td class="num ${cls}" style="font-size:11px">${s.note}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

    </div><!-- /intel-col left -->

    <!-- RIGHT: Evidence + Bottom Radar + Top Movers -->
    <div class="intel-col">

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div class="card-title" style="margin:0">Evidence Trail</div>
          <span style="font-family:var(--mono);font-size:12px;color:var(--accent)">${evPct}%</span>
        </div>
        ${r.layers.map(l => {
          const pct   = Math.round(l.score / l.max * 100);
          const color = l.score >= 7 ? 'var(--green)' : l.score >= 4 ? 'var(--yellow)' : 'var(--red)';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600">${l.name}</span>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="${_verdictCls(l.verdict)}" style="font-size:10px;font-weight:600">${l.verdict}</span>
                <span style="font-family:var(--mono);font-size:11px;color:${color}">${l.score}/${l.max}</span>
                <span class="muted" style="font-size:9px">${l.receipts} sig${l.receipts !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>`;
        }).join('')}
      </div>

      ${_renderTopMovers(d.cgCoins)}

      <div class="card">
        <div class="card-title">Cycle Score</div>
        <div class="intel-bottom-score">
          <span class="intel-radar-score" style="color:${r.score > 3 ? 'var(--green)' : r.score < -3 ? 'var(--red)' : 'var(--yellow)'}">${Math.round((r.score + 10) / 20 * 100)}</span>
          <span class="muted" style="font-size:13px;margin-left:2px">/100</span>
        </div>
        <div class="progress-bar" style="margin:8px 0 12px">
          <div class="progress-fill" style="width:${(r.score + 10) / 20 * 100}%;background:${scoreColor}"></div>
        </div>
        <div class="intel-vote-row">
          <div class="intel-vote-cell" style="background:var(--green-bg)">
            <div style="font-size:20px;font-weight:800;color:var(--green)">${r.bullish}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Bull</div>
          </div>
          <div class="intel-vote-cell" style="background:var(--surface2)">
            <div style="font-size:20px;font-weight:800;color:var(--text-muted)">${r.neutral}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Neutral</div>
          </div>
          <div class="intel-vote-cell" style="background:var(--red-bg)">
            <div style="font-size:20px;font-weight:800;color:var(--red)">${r.bearish}</div>
            <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Bear</div>
          </div>
        </div>
      </div>

    </div><!-- /intel-col right -->
  </div><!-- /intel-main-grid -->

  <!-- ── AI Synthesis ──────────────────────────────────────────────────────── -->
  <div class="card" id="intel-synth-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">AI Synthesis</div>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSynth()" id="intel-synth-btn2">✦ Regenerate</button>
    </div>
    ${_intelSynth
      ? `<blockquote class="intel-quote">${_intelSynth}</blockquote>`
      : `<div class="muted" style="font-size:12px;font-style:italic;padding:10px 0">Click "AI Synthesis" above to generate market analysis.</div>`
    }
  </div>

  <!-- ── Desk Setups ────────────────────────────────────────────────────────── -->
  <div class="card" id="intel-setups-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">Desk Setups</div>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSetups()" id="intel-setups-btn2">✦ Generate Setups</button>
    </div>
    ${_intelSetups ? _renderParsedSetups(_intelSetups) : `<div class="muted" style="font-size:12px;font-style:italic;padding:10px 0">Click "Generate Setups" above — AI will analyse live funding, OI, and price data to suggest entries.</div>`}
  </div>

  <!-- ── Staged Trades (from AI tab) ──────────────────────────────────────── -->
  ${_renderStagedInIntel()}
  `;

  setTimeout(_renderIntelRadar, 0);
}

// ── Sub-renders ───────────────────────────────────────────────────────────────

function _renderMetricCell(label, value, pctChange, sub, colorPct = true, isPos = false, isNeg = false) {
  const changePart = pctChange != null
    ? `<div class="stat-sub ${colorPct ? (pctChange >= 0 ? 'pos' : 'neg') : ''}">${_ilFmtP(pctChange)} ${sub || ''}</div>`
    : `<div class="stat-sub">${sub || ''}</div>`;
  const valueColor = isPos ? 'color:var(--green)' : isNeg ? 'color:var(--red)' : '';
  return `<div class="stat-cell">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="${valueColor}">${value}</div>
    ${changePart}
  </div>`;
}

function _renderTopMovers(cgCoins) {
  if (!cgCoins?.length) return '';
  const sorted = [...cgCoins].sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0));
  const movers = sorted.slice(0, 8);
  return `<div class="card">
    <div class="card-title">Top Movers (24h)</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Coin</th><th class="num">Price</th><th class="num">24h</th><th class="num">7d</th></tr></thead>
        <tbody>
          ${movers.map(c => {
            const p24 = c.price_change_percentage_24h || 0;
            const p7  = c.price_change_percentage_7d_in_currency;
            return `<tr>
              <td class="muted">${c.market_cap_rank}</td>
              <td><strong>${c.symbol.toUpperCase()}</strong> <span class="muted" style="font-size:10px">${c.name}</span></td>
              <td class="num">${_ilFmtPrice(c.current_price)}</td>
              <td class="num ${p24 >= 0 ? 'pos' : 'neg'}">${_ilFmtP(p24)}</td>
              <td class="num ${p7 != null ? (p7 >= 0 ? 'pos' : 'neg') : ''}">${p7 != null ? _ilFmtP(p7) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function _intelEdgeUrl() {
  return localStorage.getItem('hype_edge_fn_url') || '';
}

// ── APIU Macro Card (apiu.ai second-opinion verdict + regime) ───────────────

let _apiuError = '';

function _apiuProxyUrl() {
  return localStorage.getItem('hype_apiu_proxy_url') || '';
}

async function _loadApiuCard() {
  const proxyUrl = _apiuProxyUrl();
  if (!proxyUrl) { _apiuState = 'unconfigured'; return; } // no card update — render() already shows nothing

  // 15 min cache, same as the worker's edge cache
  if (_apiuData && Date.now() - _apiuData.ts < 15 * 60 * 1000) return;

  _apiuState = 'loading';
  const wrap = document.getElementById('apiu-card-wrap');
  if (wrap && !_apiuData) wrap.innerHTML = _renderApiuCard();

  try {
    const r = await fetch(`${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}asset=BTC`);
    if (!r.ok) throw new Error(`proxy ${r.status}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    _apiuData  = { ...data, ts: Date.now() };
    _apiuState = 'ok';
  } catch (e) {
    _apiuState = 'error';
    _apiuError = e.message;
  }

  const wrap2 = document.getElementById('apiu-card-wrap');
  if (wrap2) wrap2.innerHTML = _renderApiuCard();
}

function _renderApiuCard() {
  const proxyUrl = _apiuProxyUrl();
  if (!proxyUrl) return ''; // not configured — card simply doesn't appear

  if (_apiuState === 'loading' && !_apiuData) {
    return `<div class="card" style="padding:12px 14px">
      <div class="card-title">🔮 APIU Macro Verdict</div>
      <div class="loading" style="padding:8px 0"><div class="spinner"></div> Fetching second opinion…</div>
    </div>`;
  }

  if (_apiuState === 'error' && !_apiuData) {
    return `<div class="card" style="padding:12px 14px">
      <div class="card-title">🔮 APIU Macro Verdict</div>
      <div class="news-empty" style="padding:8px 0">Failed to load: ${_apiuError || 'unknown error'}<br>
        <button class="btn btn-ghost btn-sm" onclick="_loadApiuCard()" style="margin-top:6px">Retry</button>
      </div>
    </div>`;
  }

  if (!_apiuData) return '';

  const verdictRaw = _apiuData.daily_verdict;
  const regime     = _apiuData.regime_state;

  // apiu.daily_verdict occasionally fails server-side (upstream dependency
  // error) — detect that distinctly so we surface it instead of a blank card.
  const verdictFailed = typeof verdictRaw === 'string' && /^Error executing tool/i.test(verdictRaw);
  const verdictText = verdictFailed
    ? null
    : typeof verdictRaw === 'string'
      ? verdictRaw
      : _apiuPick(verdictRaw, ['verdict', 'brief', 'summary', 'text']);

  // Defensive field extraction — fall back to alternate key names / raw JSON
  // in case APIU changes the regime_state schema.
  const regimeLabel = _apiuPick(regime, ['regime', 'state', 'label']);
  const regimeNote  = regime && typeof regime.note === 'string' ? regime.note : null;
  const keyLevels   = regime && regime.key_levels && typeof regime.key_levels === 'object' ? regime.key_levels : null;
  const confidence  = regime && regime.confidence != null ? regime.confidence : null;
  const durable     = regime && typeof regime.durable === 'boolean' ? regime.durable : null;
  const asOf        = regime && regime.as_of ? regime.as_of : null;

  const narrative   = verdictText || regimeNote;
  const regimeColor = /bull|buy/i.test(regimeLabel || '') ? 'var(--green)'
    : /bear|sell/i.test(regimeLabel || '') ? 'var(--red)'
    : regimeLabel ? 'var(--yellow)' : 'var(--text-muted)';

  const age = _apiuData.ts ? Math.round((Date.now() - _apiuData.ts) / 60000) : null;

  return `<div class="card" style="padding:12px 14px">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>🔮 APIU Macro Verdict <span class="muted" style="font-size:10px;font-weight:400">— second opinion, ${_apiuData.asset || 'BTC'}${asOf ? ` · as of ${asOf}` : ''}</span></span>
      <button class="btn btn-ghost btn-sm" onclick="_apiuData=null;_loadApiuCard()" style="padding:2px 8px;font-size:10px">↺</button>
    </div>
    ${regimeLabel ? `<div style="display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap">
      <span class="regime-pill" style="display:inline-block;background:var(--surface2);color:${regimeColor};border:1px solid ${regimeColor}">${regimeLabel}</span>
      ${confidence != null ? `<span class="muted" style="font-size:10px">confidence ${confidence}</span>` : ''}
      ${durable != null ? `<span class="muted" style="font-size:10px">${durable ? 'durable' : 'transient'}</span>` : ''}
    </div>` : ''}
    ${keyLevels ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px;font-size:11px">
      ${Object.entries(keyLevels).map(([k, v]) => `<div><span class="muted" style="font-size:9px;text-transform:uppercase;letter-spacing:.03em;display:block">${k.replace(/_/g, ' ')}</span><span style="font-family:var(--mono)">${typeof v === 'number' ? _ilFmtPrice(v) : v}</span></div>`).join('')}
    </div>` : ''}
    ${narrative ? `<div style="font-size:12px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap">${String(narrative)}</div>` : ''}
    ${verdictFailed ? `<div class="muted" style="font-size:10px;margin-top:6px">⚠ daily_verdict tool unavailable upstream (apiu.ai-side error)</div>` : ''}
    ${!narrative && !regimeLabel ? `<details style="margin-top:4px">
      <summary class="muted" style="font-size:10px;cursor:pointer">Raw response (unrecognized schema)</summary>
      <pre style="font-size:10px;white-space:pre-wrap;color:var(--text-muted);margin-top:4px">${JSON.stringify(_apiuData, null, 2)}</pre>
    </details>` : ''}
    ${age != null ? `<div class="muted" style="font-size:9px;margin-top:6px">via apiu.ai · ${age}m ago</div>` : ''}
  </div>`;
}

function _apiuPick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return null;
}

function _renderStagedInIntel() {
  if (typeof _stageTrades === 'undefined' || !Array.isArray(_stageTrades) || !_stageTrades.length) return '';
  const active = _stageTrades.filter(t => t.status === 'staged' || t.status === 'watching');
  if (!active.length) return '';
  return `<div class="card">
    <div class="card-title">Staged Trades (from AI tab)</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${active.map(t => {
        const cls = (t.direction === 'Long' || t.direction === 'Spot Buy') ? 'pos' : 'neg';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border-radius:var(--radius-md);border:1px solid var(--border)">
          <span style="font-weight:700;font-family:var(--mono)">${t.coin}</span>
          <span class="${cls}" style="font-size:11px;font-weight:600">${t.direction.toUpperCase()}</span>
          ${t.entry_price ? `<span class="muted" style="font-size:11px">Entry ${(+t.entry_price).toLocaleString()}</span>` : ''}
          ${t.rationale ? `<span style="font-size:11px;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.rationale}</span>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function _renderParsedSetups(text) {
  return `<div style="font-size:12px;color:var(--text-muted);line-height:1.7;white-space:pre-wrap">${text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code style="background:var(--surface2);padding:1px 4px;border-radius:3px">$1</code>')}</div>`;
}

// ── Regime Radar Chart ────────────────────────────────────────────────────────

function _renderIntelRadar() {
  const canvas = document.getElementById('regime-radar-chart');
  if (!canvas || typeof Chart === 'undefined' || !_intelRegime) return;
  // Destroy existing chart instance if any
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const data   = _intelRegime.radar;
  const labels = Object.keys(data);
  const values = Object.values(data);
  new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor:      'rgba(56,189,248,0.08)',
        borderColor:          '#38bdf8',
        borderWidth:          1.5,
        pointBackgroundColor: '#38bdf8',
        pointBorderColor:     '#0a0a0a',
        pointRadius:          3,
        pointHoverRadius:     4,
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
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

// ── Claude Actions ────────────────────────────────────────────────────────────

function _intelClaudeCtx() {
  if (!_intelData || !_intelRegime) return null;
  const d = _intelData, r = _intelRegime;
  return `Live market snapshot (${new Date(d.ts).toUTCString()}):
- Regime verdict: ${r.verdict} (score ${r.score}/±10, ${r.confidence}% confidence)
- BTC price: ${_ilFmtPrice(d.prices.BTC)}, ETH: ${_ilFmtPrice(d.prices.ETH)}, SOL: ${_ilFmtPrice(d.prices.SOL)}, HYPE: ${_ilFmtPrice(d.prices.HYPE)}
- BTC funding APR (cross-exchange avg): ${d.btcFundApr != null ? d.btcFundApr.toFixed(2) + '%' : 'N/A'}
- Binance BTC OI: ${_ilFmt$(d.bnBtcOiUsd)}, 24h change: ${d.oiChange24h != null ? _ilFmtP(d.oiChange24h) : 'N/A'}
- BTC dominance: ${d.btcDom != null ? d.btcDom.toFixed(1) + '%' : 'N/A'}
- Altcoin breadth: ${d.altBreadth != null ? d.altBreadth + '%' : 'N/A'} of top 100 coins up 24h
- Fear & Greed: ${d.fng ? d.fng.value + ' (' + d.fng.label + ')' : 'N/A'}
- MVRV Z-Score: ${d.mvrvZ != null ? d.mvrvZ.toFixed(2) : 'N/A'}
- Total market cap: ${_ilFmt$(d.totalMcap)}, 24h change: ${d.mcapChange24h != null ? _ilFmtP(d.mcapChange24h) : 'N/A'}
- Signal breakdown: ${r.signals.map(s => `${s.name} ${s.value} (${s.score > 0 ? '+' : ''}${s.score})`).join(', ')}

HL per-coin funding APR: ${INTEL_TRACK.map(c => `${c} ${d.hlFundApr[c] != null ? d.hlFundApr[c].toFixed(1) + '%' : 'N/A'}`).join(', ')}`;
}

async function intelGenSynth() {
  const ctx = _intelClaudeCtx();
  if (!ctx) { alert('Data not loaded yet — wait for the page to finish loading.'); return; }

  const btn = document.getElementById('intel-synth-btn') || document.getElementById('intel-synth-btn2');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }

  const prompt = `Based on this live market data, write a concise 3-4 sentence trading posture synthesis. Include: current regime assessment, key risk or opportunity, and one actionable note. Be direct and specific.\n\n${ctx}`;
  _intelSynth = await _callLLM('synthesis', prompt, { maxTokens: 512 }) || 'LLM router unavailable — set hype_edge_fn_url in AI tab settings.';

  // Update just the synthesis card
  const card = document.getElementById('intel-synth-card');
  if (card) {
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">AI Synthesis</div>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSynth()" id="intel-synth-btn2">✦ Regenerate</button>
    </div>
    <blockquote class="intel-quote">${_intelSynth}</blockquote>`;
  }
}

async function intelGenSetups() {
  const ctx = _intelClaudeCtx();
  if (!ctx) { alert('Data not loaded yet.'); return; }

  const btn = document.getElementById('intel-setups-btn') || document.getElementById('intel-setups-btn2');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }

  const prompt = `Based on this live market data, suggest 2-3 specific trade setups. For each: coin, direction (Long/Short), approximate entry price (% from current), stop loss, take profit, and a 1-sentence rationale grounded in the data. Format clearly with **COIN** headers.\n\n${ctx}`;
  _intelSetups = await _callLLM('setups', prompt, { maxTokens: 768 }) || 'LLM router unavailable — set hype_edge_fn_url in AI tab settings.';

  const card = document.getElementById('intel-setups-card');
  if (card) {
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">Desk Setups</div>
      <button class="btn btn-ghost btn-sm" onclick="intelGenSetups()" id="intel-setups-btn2">✦ Regenerate</button>
    </div>
    ${_renderParsedSetups(_intelSetups)}`;
  }
}

async function intelRefresh() {
  _intelData = null;
  await loadIntel();
}

// ── Keep backward-compat strip (uses mvrv-ai.js + indicators.js globals) ──────

function intelIndicatorStrip() {
  const ind  = window._indData;
  const fg   = ind?.fear_greed;
  const bmsb = ind?.bmsb;
  const pi   = ind?.pi_cycle;
  const fgCls   = fg   ? (fg.value   < 30  ? 'neg' : fg.value   > 70 ? 'pos' : 'muted') : 'muted';
  const bmsbCls = bmsb ? (bmsb.signal === 'BULL' ? 'pos' : bmsb.signal === 'BEAR' ? 'neg' : 'yellow') : 'muted';
  const piCls   = pi   ? (pi.signal === 'TOP' ? 'neg' : pi.signal === 'WARNING' ? 'yellow' : 'pos') : 'muted';
  return `<div class="ind-strip">
    <div class="ind-chip"><span class="ind-label">F&G</span><span class="${fgCls} mono">${fg ? fg.value : '—'}</span><span class="ind-badge ind-${fg?.zone?.toLowerCase()||'neutral'}">${fg ? fg.classification : 'N/A'}</span></div>
    <div class="ind-chip"><span class="ind-label">BMSB</span><span class="${bmsbCls} mono">${bmsb ? bmsb.signal : '—'}</span></div>
    <div class="ind-chip"><span class="ind-label">Pi Cycle</span><span class="${piCls} mono">${pi ? pi.proximity + '%' : '—'}</span><span class="ind-badge ind-${pi?.signal?.toLowerCase()||'normal'}">${pi ? pi.signal : 'N/A'}</span></div>
    <div class="ind-chip"><span class="ind-label">MVRV Z</span><span class="mono">${typeof _mvrvData !== 'undefined' && _mvrvData?.summary?.z_score ? _mvrvData.summary.z_score.toFixed(2) : '—'}</span></div>
  </div>`;
}
