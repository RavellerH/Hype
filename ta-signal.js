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
