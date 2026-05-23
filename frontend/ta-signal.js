// ── TA Recommendation Engine ──────────────────────────────────────────────────
// Depends on iEMA/iMACD/iRSI/iStoch/iBB/iATR/iMoneyFlow/sig* from app.js

// ── Support / Resistance pivot detection ─────────────────────────────────────
function findSR(highs, lows, closes, lb = 3) {
  const pH = [], pL = [];
  for (let i = lb; i < closes.length - lb; i++) {
    const h = highs[i], l = lows[i];
    if (highs.slice(i-lb,i).every(v=>v<=h) && highs.slice(i+1,i+lb+1).every(v=>v<=h)) pH.push(h);
    if (lows.slice(i-lb,i).every(v=>v>=l)  && lows.slice(i+1,i+lb+1).every(v=>v>=l))  pL.push(l);
  }
  function cluster(arr) {
    const sorted = [...arr].sort((a,b)=>a-b);
    const out = [];
    for (const v of sorted) {
      if (!out.length || (v - out.at(-1)) / out.at(-1) > 0.004) out.push(v);
      else out[out.length-1] = out.at(-1) * 0.55 + v * 0.45;
    }
    return out;
  }
  const price = closes.at(-1);
  return {
    resistance: cluster(pH).filter(l => l > price * 1.002).slice(0, 4),
    support:    cluster(pL).filter(l => l < price * 0.998).slice(-4),
  };
}

// ── Direction scoring (bull/bear/neutral) ─────────────────────────────────────
function scoreDirection(sigsObj) {
  let bull = 0, bear = 0;
  for (const s of Object.values(sigsObj)) {
    if (!s) continue;
    if (s.cls === 'bull') bull += 1;
    else if (s.cls === 'bear') bear += 1;
    else if (s.cls === 'warn') bear += 0.4;   // overbought / high vol
    else if (s.cls === 'info') bull += 0.4;   // oversold / crowded short
  }
  const total = bull + bear || 1;
  const bullPct = bull / total;
  const direction = bullPct >= 0.62 ? 'LONG' : bullPct <= 0.38 ? 'SHORT' : 'NEUTRAL';
  return { direction, bull: +bull.toFixed(1), bear: +bear.toFixed(1), bullPct };
}

// ── Entry / TP / SL from S/R + ATR ───────────────────────────────────────────
function calcTradeSetup(direction, price, sr, atr) {
  const a = atr || price * 0.02;
  const buf = a * 0.35;
  let entry, tp1, tp2, sl;

  if (direction === 'LONG') {
    const sup  = sr.support.length  ? Math.max(...sr.support)  : null;
    const res1 = sr.resistance.length ? Math.min(...sr.resistance) : null;
    const res2 = sr.resistance.length > 1
      ? sr.resistance.slice().sort((a,b)=>a-b)[1] : null;

    entry = sup && sup > price * 0.97 ? sup : price;
    tp1   = res1 || entry + a * 2.5;
    tp2   = res2 || tp1  + a * 1.5;
    sl    = sup  ? sup - buf : entry - a * 1.5;

  } else if (direction === 'SHORT') {
    const res  = sr.resistance.length ? Math.min(...sr.resistance) : null;
    const sup1 = sr.support.length    ? Math.max(...sr.support)    : null;
    const sup2 = sr.support.length > 1
      ? sr.support.slice().sort((a,b)=>b-a)[1] : null;

    entry = res && res < price * 1.03 ? res : price;
    tp1   = sup1 || entry - a * 2.5;
    tp2   = sup2 || tp1  - a * 1.5;
    sl    = res  ? res + buf : entry + a * 1.5;

  } else {
    entry = price;
    tp1   = price + a * 2;
    tp2   = price + a * 3.5;
    sl    = price - a * 1.5;
  }

  const risk = Math.abs(entry - sl);
  const rew  = Math.abs(tp1  - entry);
  const rr   = risk > 0 ? rew / risk : 0;
  return { entry, tp1, tp2, sl, rr };
}

// ── Binance Futures L/S ratio (free, no API key) ──────────────────────────────
const _lsrCache = {};
async function fetchBinanceLSR(coin) {
  const key = coin + '_lsr';
  if (_lsrCache[key] && Date.now() - _lsrCache[key].ts < 120000) return _lsrCache[key].data;
  try {
    const sym = coin.toUpperCase().replace(/^1000/, '') + 'USDT';
    const r = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d) || !d[0]) return null;
    const data = { longPct: parseFloat(d[0].longAccount)*100, shortPct: parseFloat(d[0].shortAccount)*100, ratio: parseFloat(d[0].longShortRatio) };
    _lsrCache[key] = { ts: Date.now(), data };
    return data;
  } catch { return null; }
}

// ── CoinGecko 24h / 7d change (free, no API key) ──────────────────────────────
const CG_IDS = {
  BTC:'bitcoin',ETH:'ethereum',SOL:'solana',HYPE:'hyperliquid',BNB:'binancecoin',
  ADA:'cardano',AVAX:'avalanche-2',DOT:'polkadot',MATIC:'matic-network',LINK:'chainlink',
  ARB:'arbitrum',OP:'optimism',INJ:'injective-protocol',SUI:'sui',APT:'aptos',
  DOGE:'dogecoin',SHIB:'shiba-inu',WIF:'dogwifcoin',PEPE:'pepe',NEAR:'near',
  ATOM:'cosmos',FTM:'fantom',LTC:'litecoin',XRP:'ripple',TRX:'tron',
  AAVE:'aave',UNI:'uniswap',MKR:'maker',TAO:'bittensor',RENDER:'render-token',
  JTO:'jito-governance-token',TON:'the-open-network',NOT:'notcoin',
  BONK:'bonk',PYTH:'pyth-network',TIA:'celestia',SEI:'sei-network',
  STRK:'starknet',IMX:'immutable-x',BLUR:'blur',GMX:'gmx',
};
const _cgCache = {};
async function fetchCGData(coin) {
  const id = CG_IDS[coin.toUpperCase()];
  if (!id) return null;
  if (_cgCache[id] && Date.now() - _cgCache[id].ts < 180000) return _cgCache[id].data;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true`);
    if (!r.ok) return null;
    const d = (await r.json())[id];
    if (!d) return null;
    const data = { change24h: d.usd_24h_change, change7d: d.usd_7d_change, marketCap: d.usd_market_cap };
    _cgCache[id] = { ts: Date.now(), data };
    return data;
  } catch { return null; }
}

// ── Signal constructors for external data ─────────────────────────────────────
function sigLSR(lsr) {
  if (!lsr) return null;
  let label, cls;
  if      (lsr.ratio > 2.5) { label = 'LONGS CROWDED';   cls = 'warn'; }
  else if (lsr.ratio > 1.4) { label = 'LONG BIASED';     cls = 'bull'; }
  else if (lsr.ratio < 0.6) { label = 'SHORTS CROWDED';  cls = 'info'; }
  else if (lsr.ratio < 0.8) { label = 'SHORT BIASED';    cls = 'bear'; }
  else                      { label = 'BALANCED';         cls = 'neut'; }
  return { label, cls, sub: `L ${lsr.longPct.toFixed(0)}% / S ${lsr.shortPct.toFixed(0)}% · Ratio ${lsr.ratio.toFixed(2)}`,
    detail: lsr.ratio > 2.5 ? 'Longs very crowded — forced long liquidations can cascade down'
          : lsr.ratio < 0.6 ? 'Shorts very crowded — short squeeze risk elevated'
          : lsr.ratio > 1.4 ? 'More longs than shorts — mild bullish positioning'
          : lsr.ratio < 0.8 ? 'More shorts than longs — mild bearish positioning'
          : 'Balanced positioning — no directional crowding signal' };
}

function sigCG(cg) {
  if (!cg) return null;
  const c = cg.change24h || 0;
  let label, cls;
  if      (c >  6) { label = 'STRONG RALLY';   cls = 'bull'; }
  else if (c >  2) { label = 'BULLISH 24H';    cls = 'bull'; }
  else if (c < -6) { label = 'STRONG SELLOFF'; cls = 'bear'; }
  else if (c < -2) { label = 'BEARISH 24H';    cls = 'bear'; }
  else             { label = 'FLAT 24H';        cls = 'neut'; }
  const w = cg.change7d;
  return { label, cls,
    sub: `24h ${c>=0?'+':''}${c.toFixed(2)}%${w!=null?' · 7d '+(w>=0?'+':'')+w.toFixed(2)+'%':''}`,
    detail: `${Math.abs(c).toFixed(1)}% move in 24h on CoinGecko — ${c>0?'buy-side pressure dominant':'sell-side pressure dominant'}` };
}

function sigNansenFlow(coin) {
  const data = window._nansenData?.netflows;
  if (!data?.length) return null;
  const entry = data.find(d => d.token?.symbol?.toUpperCase() === coin.toUpperCase());
  if (!entry) return null;
  const flow = entry.netflow_usd_24h;
  if (flow == null) return null;
  let label, cls;
  if      (flow >  500000) { label = 'SMART MONEY BUY';   cls = 'bull'; }
  else if (flow >  100000) { label = 'INFLOW';             cls = 'bull'; }
  else if (flow < -500000) { label = 'SMART MONEY SELL';  cls = 'bear'; }
  else if (flow < -100000) { label = 'OUTFLOW';            cls = 'bear'; }
  else                     { label = 'NEUTRAL FLOW';       cls = 'neut'; }
  const fmt = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
  return { label, cls, sub: `24h ${flow>=0?'+':''}${fmt(flow)} smart money`,
    detail: `${flow>0?'Smart money is buying':'Smart money is selling'} — Nansen wallet flow ${fmt(Math.abs(flow))} net in 24h` };
}

function sigFGGlobal() {
  const fg = window._indData?.fear_greed;
  if (!fg) return null;
  const v = fg.value;
  let label, cls;
  if      (v >= 75) { label = 'EXTREME GREED'; cls = 'warn'; }
  else if (v >= 60) { label = 'GREED';          cls = 'bull'; }
  else if (v <= 25) { label = 'EXTREME FEAR';   cls = 'info'; }
  else if (v <= 40) { label = 'FEAR';            cls = 'bear'; }
  else              { label = 'NEUTRAL';         cls = 'neut'; }
  return { label, cls, sub: `F&G ${v} — ${fg.classification}`,
    detail: v >= 75 ? 'Market euphoria — historically high-risk zone for longs, potential distribution'
          : v <= 25 ? 'Market panic — historically good accumulation zone, watch for capitulation end'
          : v >= 60 ? 'Greed present — momentum favors longs but watch for exhaustion'
          : 'Neutral to fearful sentiment — pick direction carefully' };
}

// ── Signal detail (explanation) map ──────────────────────────────────────────
const SIG_DETAIL = {
  ema:  { bull: 'Price above all major EMAs — clear uptrend, dip-buys are valid', bear: 'Price below key EMAs — downtrend in force, rallies are sell opps', warn: 'Mixed EMA stack — wait for a cleaner structure before entry', neut: 'Price at EMA level — potential support/resistance, watch reaction' },
  macd: { bull: 'MACD histogram expanding above zero — buy-side momentum accelerating', bear: 'MACD expanding below zero — sell-side momentum increasing', warn: 'Bullish momentum fading — potential local top, tighten stops', neut: 'MACD near zero — no momentum edge, avoid chasing' },
  rsi:  { bull: 'RSI 60–70 — bullish without being overbought, good for entries', bear: 'RSI 30–40 — sell pressure dominant, bounces are likely short-lived', warn: 'RSI >70 — overbought zone, profit-taking risk elevated', info: 'RSI <30 — oversold, watch for reversal candle before entering long', neut: 'RSI neutral (40–60) — no directional edge from momentum' },
  stoch:{ bull: 'Stoch K>D above 50 — momentum aligned with bulls', bear: 'Stoch K<D below 50 — momentum with bears', warn: 'Stochastic overbought >80 — exhaustion area, reduce longs', info: 'Stochastic oversold <20 — potential bounce zone', neut: 'Stochastic midrange — no clear bias' },
  bb:   { bull: 'Price in upper half of Bollinger Bands — trend strength', bear: 'Price in lower half — weakness, selling pressure', warn: 'Price at/above upper band — stretched, mean reversion risk', info: 'Price at/below lower band — oversold extreme, snap-back likely', neut: 'Price at midband — equilibrium, watch for breakout direction' },
  atr:  { bull: 'Low volatility — positions can use tighter stops, lower noise', bear: 'Low volatility may precede a sharp move — stay alert', warn: 'High volatility — widen stops, reduce position size, not ideal entry', neut: 'Normal volatility — standard sizing and stop placement OK' },
  funding: { bull: 'Mild positive funding — modest long bias, not yet crowded', bear: 'Negative funding — shorts paying longs, selling pressure present', warn: 'High positive funding — crowded longs, squeeze risk if price drops', info: 'Very negative funding — crowded shorts, long squeeze risk elevated', neut: 'Near-zero funding — balanced positioning, no crowding signal' },
  oi:   { bull: 'Rising OI — new money entering, potential for sustained move', bear: 'Falling OI — positions closing, move may be exhausting', warn: 'OI rising very fast — leverage building, fragile', neut: 'Stable OI — no strong conviction signal from positioning' },
  mf:   { bull: 'Strong buy flow — aggressive buys outpacing sells on candles', bear: 'Strong sell flow — sellers more aggressive, bearish pressure', warn: 'Buy flow slightly elevated — mildly bullish, not conclusive', neut: 'Balanced buy/sell flow — no directional edge' },
};

function addDetail(sig, name) {
  if (!sig) return sig;
  const map = SIG_DETAIL[name];
  if (!map) return sig;
  const detail = map[sig.cls] || map.neut || '';
  return { ...sig, detail };
}

// ── CVD (Candle Volume Delta) ─────────────────────────────────────────────────
function calcCVD(opens, closes, highs, lows, volumes) {
  let cvd = 0;
  return closes.map((_, i) => {
    const range = highs[i] - lows[i];
    if (range > 0) cvd += volumes[i] * ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    return cvd;
  });
}

// ── OI history (localStorage, per-coin) ──────────────────────────────────────
const _OI_HIST_KEY = 'hype_oi_hist_v1';
function _oiHistGet() {
  try { return JSON.parse(localStorage.getItem(_OI_HIST_KEY) || '{}'); } catch { return {}; }
}
function saveOIPoint(coin, oi) {
  if (!oi || oi <= 0) return;
  const h = _oiHistGet();
  if (!h[coin]) h[coin] = [];
  h[coin].push({ ts: Date.now(), oi });
  if (h[coin].length > 96) h[coin] = h[coin].slice(-96);
  try { localStorage.setItem(_OI_HIST_KEY, JSON.stringify(h)); } catch {}
}
function getPrevOI(coin, lookbackMs = 3600000) {
  const h = _oiHistGet();
  const arr = h[coin] || [];
  if (!arr.length) return null;
  // Exclude entries saved in the last 3 minutes (to avoid comparing with freshly-saved point)
  const candidates = arr.filter(e => Date.now() - e.ts > 180000);
  if (!candidates.length) return arr.length > 1 ? arr[arr.length - 2].oi : null;
  const target = Date.now() - lookbackMs;
  let best = candidates[0];
  for (const e of candidates) {
    if (Math.abs(e.ts - target) < Math.abs(best.ts - target)) best = e;
  }
  return best.oi;
}

// ── CVD + OI combined signal ──────────────────────────────────────────────────
function sigCVDOI(priceChg, recentCVD, oiChgPct) {
  const pUp = priceChg >  0.2;
  const pDn = priceChg < -0.2;
  const cUp = recentCVD > 0;
  const oUp = oiChgPct != null && oiChgPct >  1.5;
  const oDn = oiChgPct != null && oiChgPct < -1.5;
  const oNa = oiChgPct == null;
  let label, cls, detail;

  if (pUp && cUp && (oUp || oNa)) {
    label = 'STRONG BULL';    cls = 'bull';
    detail = 'Price up + net buying CVD + OI expanding — real demand with new longs, continuation likely';
  } else if (pUp && cUp) {
    label = 'SPOT DRIVEN';    cls = 'bull';
    detail = 'Price and CVD rising, OI flat/down — spot buyers driving move, shorts likely covering';
  } else if (pUp && !cUp && oUp) {
    label = 'SUSPECT PUMP';   cls = 'warn';
    detail = 'Price up but sellers dominate CVD — move driven by short squeeze, not real demand';
  } else if (pUp && !cUp) {
    label = 'WEAK RALLY';     cls = 'warn';
    detail = 'Price up with net selling CVD and falling OI — fragile move, likely reversal ahead';
  } else if (pDn && !cUp && (oDn || oNa)) {
    label = 'STRONG BEAR';    cls = 'bear';
    detail = 'Price, CVD and OI all falling — real selling with longs exiting, continuation likely';
  } else if (pDn && !cUp && oUp) {
    label = 'LEVERAGED SELL'; cls = 'bear';
    detail = 'Price and CVD down but OI rising — shorts adding leverage, squeeze risk if wrong';
  } else if (pDn && cUp && oDn) {
    label = 'ACCUMULATION';   cls = 'info';
    detail = 'Price falling but net buyers absorb — dip buying while longs reduce exposure';
  } else if (pDn && cUp) {
    label = 'BULL DIVERGENCE';cls = 'info';
    detail = 'Price down but buyers dominating CVD — hidden accumulation, watch for reversal';
  } else {
    label = 'NEUTRAL';        cls = 'neut';
    detail = 'Price sideways or CVD/OI signals mixed — no clear directional edge';
  }

  const oStr = oNa ? 'OI N/A' : `OI ${oiChgPct >= 0 ? '+' : ''}${oiChgPct.toFixed(1)}%`;
  return { label, cls,
    sub: `Price ${priceChg >= 0 ? '+' : ''}${priceChg.toFixed(2)}% · CVD ${cUp ? '▲ buying' : '▼ selling'} · ${oStr}`,
    detail };
}

// ── CVD+OI multi-coin overview table ─────────────────────────────────────────
function renderCVDOITable(rows) {
  if (!rows.length) return '<div style="font-size:12px;color:var(--text-muted);padding:8px">No data</div>';
  return `
  <div class="cvd-table">
    <div class="cvd-head">
      <span>Coin</span><span>4c Chg</span><span>CVD</span><span>OI</span><span>Signal</span>
    </div>
    ${rows.map(r => {
      const oiAbs = r.currentOI > 0 ? fmtB(r.currentOI) : '—';
      const oiChgStr = r.oiChgPct != null
        ? `<span class="${r.oiChgPct >= 0 ? 'pos' : 'neg'}" style="font-size:9px;display:block">${r.oiChgPct >= 0 ? '+' : ''}${r.oiChgPct.toFixed(1)}%</span>`
        : `<span style="font-size:9px;display:block;color:var(--text-muted)">tracking</span>`;
      return `<div class="cvd-row${r.hasPosition ? ' cvd-pos-row' : ''}">
        <span class="cvd-coin">${r.coin}${r.hasPosition ? '<span class="cvd-dot">◆</span>' : ''}</span>
        <span class="${r.priceChg >= 0 ? 'pos' : 'neg'}">${r.priceChg >= 0 ? '+' : ''}${r.priceChg.toFixed(2)}%</span>
        <span class="${r.cvdUp ? 'pos' : 'neg'}" style="font-size:11px">${r.cvdUp ? '▲ BUY' : '▼ SELL'}</span>
        <span>${oiAbs}${oiChgStr}</span>
        <span class="ta-sig-badge ta-${r.sig.cls}" style="font-size:10px">${r.sig.label}</span>
      </div>`;
    }).join('')}
  </div>
  <div class="cvd-legend">◆ = open position · CVD = 4-candle volume delta · OI vs ~1h ago</div>`;
}

// ── Binance historical OI (free, no API key) ──────────────────────────────────
const _binanceOICache = {};
async function fetchBinanceOI(coin, tf = '1h', limit = 60) {
  const sym = coin.toUpperCase().replace(/^1000/, '') + 'USDT';
  const period = tf === '4h' ? '4h' : tf === '1d' ? '1d' : '1h';
  const key = `${sym}_${period}`;
  if (_binanceOICache[key] && Date.now() - _binanceOICache[key].ts < 300000) return _binanceOICache[key].data;
  try {
    const r = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) return null;
    const data = d.map(e => ({ ts: e.timestamp, oi: parseFloat(e.sumOpenInterestValue) }));
    _binanceOICache[key] = { ts: Date.now(), data };
    return data;
  } catch { return null; }
}

// ── Chart instance registry ───────────────────────────────────────────────────
const _cvdCharts = {};
function _destroyCVDCharts() {
  for (const k of Object.keys(_cvdCharts)) {
    try { _cvdCharts[k].destroy(); } catch {}
    delete _cvdCharts[k];
  }
}

function _miniOpts(tooltipFmt) {
  return {
    animation: false, responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: tooltipFmt
        ? { callbacks: { label: ctx => tooltipFmt(ctx.raw), title: () => '' } }
        : { enabled: false },
    },
    scales: { x: { display: false }, y: { display: false } },
  };
}

// ── Combined CVD+OI chart cards (Price / CVD / OI per coin) ───────────────────
function renderCVDOICharts(rows) {
  return `<div class="cvd-charts-grid">${rows.map(r => {
    const oiAbs   = r.currentOI > 0 ? fmtB(r.currentOI) : '—';
    const oiChgHtml = r.oiChgPct != null
      ? `<span class="${r.oiChgPct >= 0 ? 'pos' : 'neg'}">${r.oiChgPct >= 0 ? '+' : ''}${r.oiChgPct.toFixed(1)}%</span>`
      : `<span class="cvd-track">tracking…</span>`;
    return `<div class="cvd-chart-card${r.hasPosition ? ' cvd-chart-pos' : ''}">
      <div class="cvd-chart-hdr cvd-chart-toggle" onclick="toggleCVDCard('${r.coin}')">
        <div class="cvd-chart-left">
          <span class="cvd-chart-coin">${r.coin}${r.hasPosition ? '<span class="cvd-dot">◆</span>' : ''}</span>
          <span class="${r.priceChg >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${r.priceChg >= 0 ? '+' : ''}${r.priceChg.toFixed(2)}%</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="ta-sig-badge ta-${r.sig.cls}">${r.sig.label}</span>
          <span id="cvd-tog-${r.coin}" class="cvd-toggle-icon">▼</span>
        </div>
      </div>
      <div id="cvd-body-${r.coin}" class="cvd-chart-body">
        <div class="cvd-panel-label">Price · <span style="font-family:var(--mono)">${fmtPrice(r.price)}</span></div>
        <div class="cvd-panel"><canvas id="cvdp-${r.coin}"></canvas></div>
        <div class="cvd-panel-label">CVD · ${r.cvdUp ? '<span class="pos">▲ net buying</span>' : '<span class="neg">▼ net selling</span>'}</div>
        <div class="cvd-panel"><canvas id="cvdc-${r.coin}"></canvas></div>
        <div class="cvd-panel-label">Open Interest · ${oiAbs} ${oiChgHtml}</div>
        <div class="cvd-panel" id="cvdo-wrap-${r.coin}"><canvas id="cvdo-${r.coin}"></canvas></div>
        <div class="cvd-analysis">${r.sig.detail || '—'}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function toggleCVDCard(coin) {
  const body = document.getElementById(`cvd-body-${coin}`);
  const icon = document.getElementById(`cvd-tog-${coin}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (icon) icon.textContent = open ? '▶' : '▼';
  if (!open) {
    setTimeout(() => {
      ['p_','c_','o_'].forEach(p => _cvdCharts[p + coin]?.resize?.());
    }, 50);
  }
}

// ── Smart Money Flow (Binance L/S + taker, CoinGecko dominance) ──────────────

const _lsCache = {};
const _LS_TTL = 5 * 60 * 1000;

async function _lsFetch(endpoint, sym, period = '1h', limit = 2) {
  const key = `${endpoint}_${sym}_${period}`;
  const now = Date.now();
  if (_lsCache[key] && now - _lsCache[key].ts < _LS_TTL) return _lsCache[key].data;
  try {
    const url = `https://fapi.binance.com/futures/data/${endpoint}?symbol=${sym}&period=${period}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    _lsCache[key] = { ts: now, data };
    return data;
  } catch { return null; }
}

const _BINANCE_PERP_COINS = new Set(['BTC','ETH','SOL','BNB','XRP','DOGE','AVAX','ADA','SUI',
  'ARB','OP','INJ','TIA','ATOM','LTC','LINK','MATIC','FTM','APT','SEI','WIF','PEPE','BONK','FET']);

async function fetchMoneyFlow(coin) {
  if (!_BINANCE_PERP_COINS.has(coin)) return null;
  const sym = coin + 'USDT';
  const [glsR, topR, tkrR] = await Promise.allSettled([
    _lsFetch('globalLongShortAccountRatio', sym, '1h', 2),
    _lsFetch('topLongShortAccountRatio',    sym, '1h', 2),
    _lsFetch('takerlongshortRatio',         sym, '1h', 2),
  ]);
  const gls = glsR.value?.at(-1);
  const tls = topR.value?.at(-1);
  const tkr = tkrR.value?.at(-1);
  if (!gls && !tls && !tkr) return null;
  return {
    coin,
    lsRatio:    gls ? parseFloat(gls.longShortRatio) : null,
    topRatio:   tls ? parseFloat(tls.longShortRatio) : null,
    takerRatio: tkr ? parseFloat(tkr.buySellRatio)   : null,
  };
}

async function fetchBTCDom() {
  const key = 'cg_global';
  const now = Date.now();
  if (_lsCache[key] && now - _lsCache[key].ts < _LS_TTL) return _lsCache[key].data;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return null;
    const { data: d } = await res.json();
    const mp = d.market_cap_percentage || {};
    const result = {
      btcDom:    mp.btc || 0,
      ethDom:    mp.eth || 0,
      stablePct: (mp.usdt || 0) + (mp.usdc || 0),
      mcap24h:   d.market_cap_change_percentage_24h_usd || 0,
    };
    _lsCache[key] = { ts: now, data: result };
    return result;
  } catch { return null; }
}

function _signalLS({ lsRatio, topRatio, takerRatio }) {
  const topBull       = topRatio != null && topRatio > 1.1;
  const topBear       = topRatio != null && topRatio < 0.9;
  const crowdedLong   = lsRatio  != null && lsRatio  > 1.55;
  const crowdedShort  = lsRatio  != null && lsRatio  < 0.7;
  const takerBuy      = takerRatio != null && takerRatio > 1.08;
  const takerSell     = takerRatio != null && takerRatio < 0.92;

  if (topBull  && takerBuy  && !crowdedLong)  return { label:'SMART ACCUM', cls:'bull', detail:'Top traders long + buy aggression — high quality setup' };
  if (topBear  && takerSell && !crowdedShort) return { label:'SMART DIST',  cls:'bear', detail:'Top traders short + sell aggression — distribution signal' };
  if (topBull  && crowdedShort)               return { label:'SQUEEZE ↑',   cls:'bull', detail:'Retail heavily short, smart money long — short squeeze risk' };
  if (topBear  && crowdedLong)                return { label:'SQUEEZE ↓',   cls:'bear', detail:'Retail overleveraged long, smart money short — long squeeze risk' };
  if (topBear  && takerBuy)                   return { label:'FAKE PUMP',   cls:'warn', detail:'Retail buying aggressor, top traders positioned short — potential trap' };
  if (topBull  && takerSell)                  return { label:'DEGEN SELL',  cls:'warn', detail:'Smart money holding long but sell pressure mounting' };
  if (crowdedLong  && !topBull)               return { label:'CROWDED LONG',cls:'warn', detail:'Retail overleveraged long without smart money confirmation' };
  if (crowdedShort && !topBear)               return { label:'CROWDED SHORT',cls:'info', detail:'Retail heavily short — watch for squeeze if catalyst appears' };
  if (topBull)  return { label:'TOP BULL',  cls:'bull', detail:'Smart money (top 20%) positioned net long' };
  if (topBear)  return { label:'TOP BEAR',  cls:'bear', detail:'Smart money (top 20%) positioned net short' };
  if (takerBuy) return { label:'BUY PRESS', cls:'bull', detail:'Aggressive buyers dominating taker volume' };
  if (takerSell)return { label:'SELL PRESS',cls:'bear', detail:'Aggressive sellers dominating taker volume' };
  return { label:'NEUTRAL', cls:'neut', detail:'No strong directional bias from L/S or taker data' };
}

function renderMoneyFlowCard() {
  return `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">💸 Smart Money Flow</div>
      <span id="mf-risk" class="muted" style="font-size:11px">loading…</span>
    </div>
    <div id="mf-dom-bar" style="margin-bottom:10px"></div>
    <div id="mf-table"><div class="loading" style="padding:10px 0">${spinnerHtml()} fetching L/S &amp; taker data…</div></div>
    <div style="font-size:10px;color:var(--text-muted);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)">
      <b>L/S All</b> = all retail accounts · <b>L/S Top</b> = top 20% by volume (smart money) · <b>Taker</b> = buy/sell aggressor ratio · source: Binance Futures
    </div>
  </div>`;
}

async function loadMoneyFlowSignals(coins) {
  const riskEl = document.getElementById('mf-risk');
  const domBarEl = document.getElementById('mf-dom-bar');
  const tblEl = document.getElementById('mf-table');
  if (!tblEl) return;

  // BTC dominance + global market data
  fetchBTCDom().then(dom => {
    if (!dom) return;
    const risk = dom.btcDom > 54 ? 'RISK OFF' : dom.btcDom < 47 ? 'RISK ON' : 'NEUTRAL';
    const rCls = risk === 'RISK ON' ? 'pos' : risk === 'RISK OFF' ? 'neg' : 'muted';
    if (riskEl) riskEl.innerHTML = `BTC.D <b style="color:var(--yellow)">${dom.btcDom.toFixed(1)}%</b> · Stable <b>${dom.stablePct.toFixed(1)}%</b> · MCap <span class="${dom.mcap24h>=0?'pos':'neg'}">${dom.mcap24h>=0?'+':''}${dom.mcap24h.toFixed(1)}%</span> · <span class="${rCls}" style="font-weight:600">${risk}</span>`;
    if (domBarEl) domBarEl.innerHTML = `
      <div style="display:flex;gap:0;height:6px;border-radius:3px;overflow:hidden">
        <div style="flex:${dom.btcDom.toFixed(0)};background:var(--yellow)" title="BTC ${dom.btcDom.toFixed(1)}%"></div>
        <div style="flex:${dom.ethDom.toFixed(0)};background:var(--blue)" title="ETH ${dom.ethDom.toFixed(1)}%"></div>
        <div style="flex:${dom.stablePct.toFixed(0)};background:var(--green)" title="Stables ${dom.stablePct.toFixed(1)}%"></div>
        <div style="flex:${Math.max(1,100-dom.btcDom-dom.ethDom-dom.stablePct).toFixed(0)};background:var(--surface2)" title="Others"></div>
      </div>
      <div style="display:flex;gap:10px;font-size:9px;color:var(--text-muted);margin-top:3px">
        <span style="color:var(--yellow)">■ BTC ${dom.btcDom.toFixed(1)}%</span>
        <span style="color:var(--blue)">■ ETH ${dom.ethDom.toFixed(1)}%</span>
        <span style="color:var(--green)">■ Stables ${dom.stablePct.toFixed(1)}%</span>
        <span>■ Others</span>
      </div>`;
  });

  // Per-coin L/S + taker from Binance
  const tracked = coins.filter(c => _BINANCE_PERP_COINS.has(c));
  if (!tracked.length) {
    if (tblEl) tblEl.innerHTML = '<div class="muted" style="font-size:12px;padding:8px 0">No tracked coins available on Binance Futures (positions are Hyperliquid-only)</div>';
    return;
  }

  const flows = await Promise.all(tracked.map(fetchMoneyFlow));
  if (!tblEl) return;

  const fmtR = (v, lowGood = false) => {
    if (v == null) return '<span class="muted">—</span>';
    const hi = lowGood ? v < 0.9 : v > 1.1;
    const lo = lowGood ? v > 1.1 : v < 0.9;
    const cls = hi ? 'pos' : lo ? 'neg' : 'muted';
    return `<span class="${cls} mono">${v.toFixed(2)}</span>`;
  };

  const hasAny = flows.some(Boolean);
  if (!hasAny) {
    tblEl.innerHTML = '<div class="muted" style="font-size:12px;padding:8px 0">Binance API unavailable — try again shortly</div>';
    return;
  }

  tblEl.innerHTML = `
    <div class="cvd-head" style="grid-template-columns:52px 60px 60px 55px 1fr">
      <span>Coin</span><span title="All accounts long/short ratio">L/S All</span><span title="Top 20% accounts">L/S Top</span><span title="Taker buy/sell ratio">Taker</span><span>Signal</span>
    </div>
    ${flows.map(f => {
      if (!f) return '';
      const sig = _signalLS(f);
      return `<div class="cvd-row cvd-mf-row" style="grid-template-columns:52px 60px 60px 55px 1fr">
        <span class="cvd-coin accent">${f.coin}</span>
        <span>${fmtR(f.lsRatio)}</span>
        <span>${fmtR(f.topRatio)}</span>
        <span>${fmtR(f.takerRatio)}</span>
        <span class="ta-sig-badge ta-${sig.cls}" title="${sig.detail}">${sig.label}</span>
      </div>`;
    }).join('')}`;
}

// ── HYPE Intelligence ─────────────────────────────────────────────────────────

const HYPE_SUPPLY = 1_000_000_000;

function _fundingSignal(f8h) {
  if (f8h > 0.0005)  return { label:'OVERLEVERAGED LONG', cls:'warn',  detail:'Longs paying a lot → flush risk on pullbacks' };
  if (f8h > 0.0001)  return { label:'BULLISH POSITIONING', cls:'bull', detail:'Longs paying → market expects higher' };
  if (f8h < -0.0005) return { label:'EXTREME SHORT BIAS',  cls:'info', detail:'Shorts paying heavily → squeeze candidate' };
  if (f8h < -0.0001) return { label:'BEARISH POSITIONING', cls:'bear', detail:'Shorts paying → market expects lower' };
  return { label:'NEUTRAL FUNDING', cls:'neut', detail:'Balanced positioning, no extreme leverage bias' };
}

function _revenueSignal(rev) {
  if (rev > 5e6)  return { label:'HIGH REVENUE', cls:'bull', detail:'Strong fee income → active buyback pressure' };
  if (rev > 1.5e6) return { label:'NORMAL REVENUE', cls:'neut', detail:'Healthy platform activity' };
  return { label:'LOW REVENUE', cls:'warn', detail:'Reduced trading activity → lower buyback pressure' };
}

function _stakeSignal(pct) {
  if (pct > 40) return { label:'HIGH LOCK', cls:'bull', detail:`${pct.toFixed(1)}% staked → tight float, reduced sell pressure` };
  if (pct > 20) return { label:'MODERATE', cls:'neut', detail:`${pct.toFixed(1)}% staked — normal distribution` };
  return { label:'LOW STAKE', cls:'warn', detail:`Only ${pct.toFixed(1)}% staked → more circulating supply` };
}

function renderHYPECard() {
  return `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <div class="card-title" style="margin:0">⚡ HYPE Intelligence</div>
      <span class="muted" style="font-size:10px">Platform health · HL-native signals · staking float</span>
    </div>
    <div id="hype-intel-body"><div class="loading" style="padding:10px 0">${spinnerHtml()} loading platform &amp; staking data…</div></div>
  </div>`;
}

async function loadHYPEIntel(phaseMeta) {
  const el = document.getElementById('hype-intel-body');
  if (!el) return;
  try {
    // ── Platform stats from phaseMeta (already fetched in loadPhases) ───────────
    let platformVol = 0, platformOI = 0, hype = null;
    if (phaseMeta) {
      const [meta, ctxs] = phaseMeta;
      (meta?.universe || []).forEach((asset, i) => {
        const ctx = ctxs[i] || {};
        const mark = parseFloat(ctx.markPx || ctx.midPx || 0);
        const vol  = parseFloat(ctx.dayNtlVlm || 0);
        const oi   = parseFloat(ctx.openInterest || 0) * mark;
        platformVol += vol;
        platformOI  += oi;
        if (asset.name === 'HYPE') {
          hype = {
            price:    mark,
            prevPx:   parseFloat(ctx.prevDayPx || mark),
            oi,
            vol,
            funding:  parseFloat(ctx.funding || 0),
          };
        }
      });
    }

    if (!hype) {
      el.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0">HYPE not found in market data — try refreshing</div>';
      return;
    }

    const priceChg24h  = hype.prevPx > 0 ? (hype.price - hype.prevPx) / hype.prevPx * 100 : 0;
    const estRevenue   = platformVol * 0.0003;   // ~0.03% avg fee (maker+taker blended)
    const hypeVolShare = platformVol > 0 ? hype.vol / platformVol * 100 : 0;
    const revSig       = _revenueSignal(estRevenue);
    const fundSig      = _fundingSignal(hype.funding);

    // ── HYPE OI vs price divergence (using our localStorage history) ─────────
    const prevOI   = getPrevOI('HYPE');
    if (hype.oi > 0) saveOIPoint('HYPE', hype.oi);
    const oiChgPct = prevOI > 0 && hype.oi > 0 ? (hype.oi - prevOI) / prevOI * 100 : null;
    const oiSig    = sigCVDOI(priceChg24h, 0, oiChgPct);

    // ── Staking / validator data ─────────────────────────────────────────────
    let stakingHtml = '';
    try {
      const validators = await (typeof hlPost === 'function'
        ? hlPost({ type: 'validatorSummaries' })
        : null);
      if (Array.isArray(validators) && validators.length) {
        // Try several possible field names for stake amount
        const stakeFields = ['stake', 'stkd', 'totalStake', 'stakedHype', 'delegatedStake'];
        let raw = 0, usedField = null;
        for (const f of stakeFields) {
          const s = validators.reduce((a, v) => a + parseFloat(v[f] || 0), 0);
          if (s > 1e6 && s < 2e12) { raw = s; usedField = f; break; }
        }
        // If values look like they're in raw units (>1B for total), divide by 1e8
        let staked = raw > HYPE_SUPPLY * 2 ? raw / 1e8 : raw;
        if (staked > 0 && staked <= HYPE_SUPPLY) {
          const stakePct = staked / HYPE_SUPPLY * 100;
          const stakeSig = _stakeSignal(stakePct);
          stakingHtml = `
            <div style="padding-top:10px;margin-top:10px;border-top:1px solid var(--border)">
              <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Staking / Float</div>
              <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
                <div>
                  <div class="stat-label">Total Staked</div>
                  <div style="font-family:var(--mono);font-size:17px;font-weight:700">${fmtB(staked)}</div>
                  <div class="stat-sub">${stakePct.toFixed(1)}% of 1B supply · ${validators.length} validators</div>
                </div>
                <div>
                  <span class="ta-sig-badge ta-${stakeSig.cls}">${stakeSig.label}</span>
                  <div style="font-size:10px;color:var(--text-muted);margin-top:3px;max-width:200px">${stakeSig.detail}</div>
                </div>
              </div>
              <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(stakePct,100)}%"></div></div>
            </div>`;
        }
      }
    } catch(_) {}
    if (!stakingHtml) {
      stakingHtml = `
        <div style="padding-top:10px;margin-top:10px;border-top:1px solid var(--border)">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Staking / Float</div>
          <div class="muted" style="font-size:11px">Validator data unavailable from this context — check <a href="https://app.hyperliquid.xyz/staking" target="_blank" style="color:var(--accent)">HL staking page</a></div>
        </div>`;
    }

    // ── Render ───────────────────────────────────────────────────────────────
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:12px">
        <div style="background:var(--surface);padding:10px 12px">
          <div class="stat-label">HL 24h Volume</div>
          <div style="font-family:var(--mono);font-size:16px;font-weight:700">${fmtB(platformVol)}</div>
          <div style="margin-top:3px"><span class="ta-sig-badge ta-${revSig.cls}" style="font-size:9px">${revSig.label}</span></div>
        </div>
        <div style="background:var(--surface);padding:10px 12px">
          <div class="stat-label">Est. Daily Revenue</div>
          <div style="font-family:var(--mono);font-size:16px;font-weight:700">${fmtB(estRevenue)}</div>
          <div class="stat-sub">~0.03% avg fee</div>
        </div>
        <div style="background:var(--surface);padding:10px 12px">
          <div class="stat-label">Total Platform OI</div>
          <div style="font-family:var(--mono);font-size:16px;font-weight:700">${fmtB(platformOI)}</div>
          <div class="stat-sub">all perp markets</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding-bottom:12px;border-bottom:1px solid var(--border)">
        <div>
          <div class="stat-label">HYPE Price</div>
          <div style="font-family:var(--mono);font-size:20px;font-weight:800">${fmtPrice(hype.price)}</div>
          <div style="font-size:12px" class="${priceChg24h>=0?'pos':'neg'}">${priceChg24h>=0?'+':''}${priceChg24h.toFixed(2)}% 24h</div>
        </div>
        <div>
          <div class="stat-label">HYPE Perp OI</div>
          <div style="font-family:var(--mono);font-size:17px;font-weight:700">${fmtB(hype.oi)}</div>
          ${oiChgPct != null
            ? `<div style="font-size:11px" class="${oiChgPct>=0?'pos':'neg'}">${oiChgPct>=0?'+':''}${oiChgPct.toFixed(1)}% vs prev</div>`
            : '<div class="muted" style="font-size:10px">tracking OI…</div>'}
        </div>
        <div>
          <div class="stat-label">Funding /8h</div>
          <div style="font-family:var(--mono);font-size:17px;font-weight:700;color:${hype.funding>=0?'var(--green)':'var(--red)'}">${(hype.funding*100).toFixed(4)}%</div>
          <div style="font-size:10px" class="muted">${hype.funding>0?'longs paying':'shorts paying'}</div>
        </div>
        <div>
          <div class="stat-label">HYPE Vol Share</div>
          <div style="font-family:var(--mono);font-size:17px;font-weight:700">${hypeVolShare.toFixed(1)}%</div>
          <div class="stat-sub">${fmtB(hype.vol)} / platform</div>
        </div>
        <div style="margin-left:auto;display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <div>
            <div class="stat-label" style="text-align:right">Price+OI Signal</div>
            <span class="ta-sig-badge ta-${oiSig.cls}">${oiSig.label}</span>
          </div>
          <div>
            <div class="stat-label" style="text-align:right">Funding Signal</div>
            <span class="ta-sig-badge ta-${fundSig.cls}">${fundSig.label}</span>
          </div>
        </div>
      </div>
      ${stakingHtml}`;
  } catch(e) {
    if (el) el.innerHTML = `<div class="muted" style="font-size:11px">Error loading HYPE data: ${e.message}</div>`;
  }
}
  _destroyCVDCharts();

  // Fetch Binance OI for all coins in parallel
  const oiResults = await Promise.allSettled(
    rows.map(r => fetchBinanceOI(r.coin, 'h1', Math.min(r.cvdArr?.length || 60, 200)))
  );

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = r.cvdArr?.length || 0;

    // ── Price chart ──────────────────────────────────────────────────────────
    const priceC = document.getElementById(`cvdp-${r.coin}`);
    if (priceC && r.closes?.length) {
      _cvdCharts[`p_${r.coin}`] = new Chart(priceC, {
        type: 'line',
        data: {
          labels: r.closes.map((_, j) => j),
          datasets: [{ data: r.closes,
            borderColor: 'rgba(148,163,184,0.9)', backgroundColor: 'rgba(148,163,184,0.06)',
            borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 }],
        },
        options: _miniOpts(v => fmtPrice(v)),
      });
    }

    // ── CVD chart ────────────────────────────────────────────────────────────
    const cvdC = document.getElementById(`cvdc-${r.coin}`);
    if (cvdC && r.cvdArr?.length) {
      const col  = r.cvdUp ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)';
      const bg   = r.cvdUp ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)';
      _cvdCharts[`c_${r.coin}`] = new Chart(cvdC, {
        type: 'line',
        data: {
          labels: r.cvdArr.map((_, j) => j),
          datasets: [
            { data: r.cvdArr, borderColor: col, backgroundColor: bg,
              borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 },
            { data: r.cvdArr.map(() => 0), borderColor: 'rgba(100,100,100,0.35)',
              borderWidth: 1, borderDash: [3, 3], fill: false, pointRadius: 0 },
          ],
        },
        options: _miniOpts(v => `CVD: ${Math.round(v).toLocaleString()}`),
      });
    }

    // ── OI chart — Binance history or localStorage fallback ───────────────────
    const oiC = document.getElementById(`cvdo-${r.coin}`);
    const binanceOI = oiResults[i].status === 'fulfilled' ? oiResults[i].value : null;
    const localOI   = (_oiHistGet()[r.coin] || []).map(e => ({ ts: e.ts, oi: e.oi }));
    const oiSrc     = binanceOI || (localOI.length > 1 ? localOI : null);

    if (oiC && oiSrc?.length) {
      const oiVals = oiSrc.map(e => e.oi).slice(-Math.max(n, 30));
      const oiUp   = oiVals.at(-1) > oiVals[0];
      _cvdCharts[`o_${r.coin}`] = new Chart(oiC, {
        type: 'line',
        data: {
          labels: oiVals.map((_, j) => j),
          datasets: [{ data: oiVals,
            borderColor: oiUp ? 'rgba(251,191,36,0.9)' : 'rgba(156,163,175,0.8)',
            backgroundColor: oiUp ? 'rgba(251,191,36,0.07)' : 'rgba(156,163,175,0.05)',
            borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0 }],
        },
        options: _miniOpts(v => `OI: ${fmtB(v)}`),
      });
    } else if (oiC) {
      // No OI data yet — show placeholder
      const wrap = document.getElementById(`cvdo-wrap-${r.coin}`);
      if (wrap) wrap.innerHTML = '<div class="cvd-oi-empty">OI data loading from Binance…</div>';
    }
  }
}

// ── Full TA build (async) ─────────────────────────────────────────────────────
async function buildFullTA(coin, tf, candles, rawMarketCtx) {
  const opens  = candles.map(c=>parseFloat(c.o));
  const closes = candles.map(c=>parseFloat(c.c));
  const highs  = candles.map(c=>parseFloat(c.h));
  const lows   = candles.map(c=>parseFloat(c.l));
  const vols   = candles.map(c=>parseFloat(c.v));
  const price  = closes.at(-1);

  const ema20  = iEMA(closes, 20);
  const ema50  = iEMA(closes, 50);
  const ema200 = closes.length >= 200 ? iEMA(closes, 200) : null;
  const { hist, macd } = iMACD(closes);
  const rsiArr = iRSI(closes);
  const rsiVal = rsiArr.filter(v=>v!==null).at(-1);
  const { k: stochK, d: stochD } = iStoch(highs, lows, closes);
  const kVal = stochK.filter(v=>v!==null).at(-1);
  const dVal = stochD.filter(v=>v!==null).at(-1);
  const bbArr = iBB(closes);
  const bb    = bbArr.filter(v=>v!==null).at(-1);
  const atrArr = iATR(highs, lows, closes);
  const atr    = atrArr.filter(v=>v!==null).at(-1);
  const mf     = iMoneyFlow(opens, closes, vols);

  const fr  = rawMarketCtx ? parseFloat(rawMarketCtx.funding || 0) : 0;
  const oi  = rawMarketCtx ? parseFloat(rawMarketCtx.openInterest || 0) * price : 0;
  const oiPrev = taOIPrev?.[coin + tf] ?? null;
  if (typeof taOIPrev !== 'undefined') taOIPrev[coin + tf] = oi;

  // CVD + OI
  const cvdArr    = calcCVD(opens, closes, highs, lows, vols);
  const lb        = 4;
  const recentCVD = cvdArr.at(-1) - (cvdArr.length > lb ? cvdArr[cvdArr.length - 1 - lb] : 0);
  const priceChg4 = closes.length > lb ? (closes.at(-1) - closes[closes.length - 1 - lb]) / closes[closes.length - 1 - lb] * 100 : 0;
  const prevOI    = getPrevOI(coin);
  if (oi > 0) saveOIPoint(coin, oi);
  const oiChgPct  = (prevOI && prevOI > 0 && oi > 0) ? (oi - prevOI) / prevOI * 100 : null;

  const sigs = {
    ema:     addDetail(sigEMA(price, ema20.at(-1), ema50.at(-1), ema200?ema200.at(-1):null), 'ema'),
    macd:    addDetail(sigMACD(hist, macd), 'macd'),
    rsi:     rsiVal!=null ? addDetail(sigRSI(rsiVal), 'rsi') : null,
    stoch:   kVal!=null&&dVal!=null ? addDetail(sigStoch(kVal,dVal), 'stoch') : null,
    bb:      bb  ? addDetail(sigBB(bb), 'bb') : null,
    atr:     atr ? addDetail(sigATR(atr, price), 'atr') : null,
    funding: addDetail(sigFunding(fr), 'funding'),
    oi:      addDetail(sigOI(oi, oiPrev), 'oi'),
    mf:      addDetail(sigFlow(mf.buyPct), 'mf'),
  };

  // External data (parallel, no-fail)
  const [lsr, cg] = await Promise.allSettled([
    fetchBinanceLSR(coin),
    fetchCGData(coin),
  ]).then(rs => rs.map(r => r.status==='fulfilled' ? r.value : null));

  sigs.lsr     = sigLSR(lsr);
  sigs.cg      = sigCG(cg);
  sigs.nansen  = sigNansenFlow(coin);
  sigs.fg      = sigFGGlobal();
  sigs.cvdoi   = sigCVDOI(priceChg4, recentCVD, oiChgPct);

  const sr    = findSR(highs, lows, closes);
  const dir   = scoreDirection(sigs);
  const setup = calcTradeSetup(dir.direction, price, sr, atr);

  return { sigs, dir, setup, price, coin, tf, atr, sr };
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function _dirCls(d) { return d === 'LONG' ? 'pos' : d === 'SHORT' ? 'neg' : 'muted'; }
function _pct(a, b) { return b > 0 ? ((a - b) / b * 100) : 0; }

function _checkRow(icon, name, sig) {
  if (!sig) return '';
  const clsMap = { bull:'ta-ck-bull', bear:'ta-ck-bear', warn:'ta-ck-warn', info:'ta-ck-info', neut:'ta-ck-neut' };
  const iconMap = { bull:'✅', bear:'🔴', warn:'⚠️', info:'🟦', neut:'⬜' };
  return `<div class="ta-ck-row">
    <span class="ta-ck-icon">${iconMap[sig.cls]||'⬜'}</span>
    <div class="ta-ck-body">
      <div class="ta-ck-head">
        <span class="ta-ck-name">${name}</span>
        <span class="ta-sig-badge ta-${sig.cls}">${sig.label}</span>
      </div>
      <div class="ta-ck-sub">${sig.sub}${sig.detail ? ` — <span class="ta-ck-exp">${sig.detail}</span>` : ''}</div>
    </div>
  </div>`;
}

function renderTARec(ta) {
  const { sigs: s, dir, setup, price, coin, tf, sr } = ta;
  const { direction, bull, bear, bullPct } = dir;
  const { entry, tp1, tp2, sl, rr } = setup;
  const dirCls = _dirCls(direction);
  const total = bull + bear;
  const barW  = Math.round(bullPct * 100);

  const fmtSetup = (v, ref) => {
    if (!v || !ref) return fmtPrice(v);
    const p = _pct(v, ref);
    return `${fmtPrice(v)} <span class="${p>=0?'pos':'neg'}" style="font-size:11px">${p>=0?'+':''}${p.toFixed(1)}%</span>`;
  };

  const entryNote = direction === 'LONG'
    ? (entry < price * 0.999 ? `Ideal entry on pullback` : `Current price is entry zone`)
    : direction === 'SHORT'
    ? (entry > price * 1.001 ? `Ideal entry on bounce` : `Current price is entry zone`)
    : 'Neutral — wait for clearer direction';

  const srHtml = (sr.support.length || sr.resistance.length) ? `
    <div class="ta-sr-row">
      <span class="ta-sr-label">Support</span>
      <span>${sr.support.length ? sr.support.map(v=>fmtPrice(v)).join(' · ') : '—'}</span>
    </div>
    <div class="ta-sr-row">
      <span class="ta-sr-label">Resistance</span>
      <span>${sr.resistance.length ? sr.resistance.map(v=>fmtPrice(v)).join(' · ') : '—'}</span>
    </div>` : '';

  return `
  <div class="ta-rec-card ta-rec-${direction.toLowerCase()}">
    <div class="ta-rec-top">
      <div>
        <div class="ta-rec-dir ${dirCls}">${direction}</div>
        <div class="ta-rec-meta">${coin} · ${tf} · ${fmtPrice(price)} · ${new Date().toLocaleTimeString()}</div>
      </div>
      <div class="ta-rec-score-wrap">
        <div class="ta-rec-score-label">${bull.toFixed(0)}/${total.toFixed(0)} signals bullish</div>
        <div class="ta-rec-bar"><div class="ta-rec-bar-fill" style="width:${barW}%"></div></div>
        <div class="ta-rec-score-subs"><span class="pos">${bull.toFixed(0)} bull</span> <span class="neg">${bear.toFixed(0)} bear</span></div>
      </div>
    </div>

    <div class="ta-setup-grid">
      <div class="ta-setup-cell">
        <div class="ta-setup-label">💵 Entry</div>
        <div class="ta-setup-val">${fmtSetup(entry, price)}</div>
        <div class="ta-setup-note">${entryNote}</div>
      </div>
      <div class="ta-setup-cell">
        <div class="ta-setup-label">🎯 TP1</div>
        <div class="ta-setup-val pos">${fmtSetup(tp1, entry)}</div>
        <div class="ta-setup-note">First target</div>
      </div>
      <div class="ta-setup-cell">
        <div class="ta-setup-label">🎯 TP2</div>
        <div class="ta-setup-val pos">${fmtSetup(tp2, entry)}</div>
        <div class="ta-setup-note">Extended target</div>
      </div>
      <div class="ta-setup-cell">
        <div class="ta-setup-label">🛡 Stop Loss</div>
        <div class="ta-setup-val neg">${fmtSetup(sl, entry)}</div>
        <div class="ta-setup-note">R/R ${rr > 0 ? rr.toFixed(1) + ':1' : '—'}</div>
      </div>
    </div>

    ${srHtml ? `<div class="ta-sr-block">${srHtml}</div>` : ''}

    <div class="ta-ck-section">
      <div class="ta-ck-title">Signal Checklist</div>
      ${_checkRow('📏','EMA Bias',         s.ema)}
      ${_checkRow('〰️','MACD',             s.macd)}
      ${_checkRow('⚡','RSI (14)',           s.rsi)}
      ${_checkRow('🔁','Stochastic',        s.stoch)}
      ${_checkRow('🎯','Bollinger Bands',   s.bb)}
      ${_checkRow('📐','Volatility (ATR)',  s.atr)}
      ${_checkRow('💰','Funding Rate',      s.funding)}
      ${_checkRow('📊','Open Interest',     s.oi)}
      ${_checkRow('🌊','Buy/Sell Flow',     s.mf)}
      ${_checkRow('⚖️','L/S Ratio (Binance)',s.lsr)}
      ${_checkRow('📈','24h Change (CG)',   s.cg)}
      ${_checkRow('🏦','Smart Money',       s.nansen)}
      ${_checkRow('😱','Fear & Greed',      s.fg)}
      ${_checkRow('🔄','CVD + OI',          s.cvdoi)}
    </div>
  </div>`;
}

// ── Modal Signal tab helper ───────────────────────────────────────────────────
async function loadModalSignal(coin) {
  const el = document.getElementById('pm-signal-body');
  if (!el) return;
  el.innerHTML = `<div class="loading" style="padding:20px"><div class="spinner"></div> Analysing ${coin}…</div>`;
  try {
    const tf = '1h';
    const days = 15;
    const [candles, meta] = await Promise.all([
      getCandles(coin, tf, days),
      getMetaAndAssetCtxs(),
    ]);
    const universe = meta[0]?.universe || [];
    const ctxs     = meta[1] || [];
    const idx = universe.findIndex(a => a.name === coin);
    const rawCtx = idx >= 0 ? ctxs[idx] : null;

    const ta  = await buildFullTA(coin, tf, candles, rawCtx);
    const pos = typeof _pmGetPos === 'function' ? _pmGetPos(coin) : null;

    let conflictBanner = '';
    if (pos) {
      const posDir = pos.side === 'long' ? 'LONG' : 'SHORT';
      const taDir  = ta.dir.direction;
      if (taDir !== 'NEUTRAL' && taDir !== posDir) {
        conflictBanner = `<div class="ta-conflict-banner">
          ⚠️ TA recommends <strong>${taDir}</strong> but your position is <strong>${posDir}</strong>.
          Consider reviewing your thesis or reducing size.
        </div>`;
      } else if (taDir === posDir) {
        conflictBanner = `<div class="ta-aligned-banner">
          ✅ TA aligns with your <strong>${posDir}</strong> position.
        </div>`;
      }
    }

    // Offer to pre-fill stop price
    const slBtn = pos ? `<button class="pos-save-btn" style="margin-top:8px;font-size:11px"
      onclick="pmSet('${coin}',{stop_price:${ta.setup.sl.toFixed(4)}});_renderPmModal();_showToast('SL set to ${fmtPrice(ta.setup.sl)}')">
      Use TA Stop Loss (${fmtPrice(ta.setup.sl)})</button>` : '';

    el.innerHTML = conflictBanner + renderTARec(ta) + slBtn;
  } catch(e) {
    el.innerHTML = `<div style="padding:16px;color:var(--red);font-size:12px">Analysis failed: ${e.message}</div>`;
  }
}
