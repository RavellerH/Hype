// Shared helpers for the Daily Brief / Weekly Research GitHub Actions scripts.
// Ported from cloudflare/bot-worker.js so the two run identically; kept
// dependency-free (built-in fetch only) since the workflow does no npm install.

export const HL_URL = 'https://api.hyperliquid.xyz/info';

export async function hlPost(body) {
  const r = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json();
}

export async function getFundingRates() {
  const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
  const result = {};
  meta.universe.forEach((u, i) => {
    const ctx = ctxs[i];
    result[u.name] = {
      fundingRate: parseFloat(ctx.funding || 0),
      openInterest: parseFloat(ctx.openInterest || 0),
      markPx: parseFloat(ctx.markPx || 0),
    };
  });
  return result;
}

// ── Positions (ported from app.js hlPost/parsePositions) ─────────────────────
export async function getClearinghouseState(wallet) {
  return hlPost({ type: 'clearinghouseState', user: wallet });
}

export function parsePositions(state) {
  return (state.assetPositions || []).map(pos => {
    const p = pos.position || {};
    const szi = parseFloat(p.szi || 0);
    if (szi === 0) return null;
    const lev = p.leverage || {};
    const posVal = parseFloat(p.positionValue || 0), size = Math.abs(szi);
    return {
      coin: p.coin, side: szi > 0 ? 'long' : 'short', size,
      entry_price: parseFloat(p.entryPx || 0),
      mark_price: size > 0 ? posVal / size : parseFloat(p.entryPx || 0),
      unrealized_pnl: parseFloat(p.unrealizedPnl || 0),
      leverage_type: lev.type || 'cross', leverage_value: lev.value || 1,
      liquidation_price: parseFloat(p.liquidationPx || 0),
      margin_used: parseFloat(p.marginUsed || 0), position_value: posVal,
      cum_funding: parseFloat((p.cumFunding || {}).sinceOpen || 0),
    };
  }).filter(Boolean);
}

// ── Candles + indicators (ported from app.js / ta-signal.js) ─────────────────
export async function getCandles(coin, interval = '1h', days = 15) {
  const endTime = Date.now();
  return hlPost({ type: 'candleSnapshot', req: { coin, interval, startTime: endTime - days * 86400000, endTime } });
}

export function iEMA(arr, p) {
  const k = 2 / (p + 1); let ema = arr[0];
  return arr.map(v => (ema = v * k + ema * (1 - k)));
}

export function iMACD(arr, f = 12, s = 26, sig = 9) {
  const emaF = iEMA(arr, f), emaS = iEMA(arr, s);
  const macd = emaF.map((v, i) => v - emaS[i]);
  const signal = iEMA(macd, sig);
  return { macd, signal, hist: macd.map((v, i) => v - signal[i]) };
}

export function iRSI(arr, p = 14) {
  let gAvg = 0, lAvg = 0;
  for (let i = 1; i <= p; i++) { const d = arr[i] - arr[i - 1]; if (d > 0) gAvg += d; else lAvg -= d; }
  gAvg /= p; lAvg /= p;
  const out = new Array(p).fill(null);
  out.push(lAvg === 0 ? 100 : 100 - 100 / (1 + gAvg / lAvg));
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    gAvg = (gAvg * (p - 1) + Math.max(d, 0)) / p; lAvg = (lAvg * (p - 1) + Math.max(-d, 0)) / p;
    out.push(lAvg === 0 ? 100 : 100 - 100 / (1 + gAvg / lAvg));
  }
  return out;
}

export function iATR(highs, lows, closes, p = 14) {
  const tr = closes.map((c, i) => i === 0 ? highs[0] - lows[0] : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  let atr = tr.slice(0, p).reduce((a, b) => a + b) / p;
  const out = [...new Array(p - 1).fill(null), atr];
  for (let i = p; i < tr.length; i++) { atr = (atr * (p - 1) + tr[i]) / p; out.push(atr); }
  return out;
}

// Wyckoff-style phase detector — ported verbatim from app.js:detectPhase.
// Combines EMA20/50/200 stack+slope, MACD histogram, RSI, price change,
// volume trend, ATR range compression and consecutive-close streak into one
// weighted score in [-1, 1], bucketed into a phase label.
export function detectPhase(candles) {
  if (!candles || candles.length < 20) return { phase: 'NEUTRAL', confidence: 0, price_trend: 'flat', volume_trend: 'neutral', range_compression: false, signals: ['Not enough data'], score: 0 };
  const closes = candles.map(c => parseFloat(c.c)), volumes = candles.map(c => parseFloat(c.v));
  const highs = candles.map(c => parseFloat(c.h)), lows = candles.map(c => parseFloat(c.l));
  const n = candles.length, price = closes.at(-1);

  const ema20 = iEMA(closes, 20);
  const ema50 = closes.length >= 50 ? iEMA(closes, 50) : null;
  const ema200 = closes.length >= 200 ? iEMA(closes, 200) : null;
  const e20 = ema20.at(-1), e20p = ema20.at(-Math.min(6, n));
  const e50 = ema50 ? ema50.at(-1) : null, e50p = ema50 ? ema50.at(-Math.min(6, n)) : null;
  const e200 = ema200 ? ema200.at(-1) : null;
  const aboveE20 = price > e20, aboveE50 = ema50 ? price > e50 : aboveE20;
  const aboveE200 = e200 ? price > e200 : null;
  const e20Slope = (e20 - e20p) / e20p;
  const e50Slope = e50 && e50p ? (e50 - e50p) / e50p : 0;

  const lb = Math.max(5, Math.floor(n * 0.2));
  const pctChg = (price - closes[n - lb - 1]) / (closes[n - lb - 1] || 1);

  const q = Math.max(4, Math.floor(n / 4));
  const avgV = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const volRatio = avgV(volumes.slice(-q)) / Math.max(avgV(volumes.slice(0, q)), 1);

  const atrArr = iATR(highs, lows, closes, 14);
  const atrNow = atrArr.at(-1) || 0;
  const atrEarly = avgV(atrArr.slice(0, Math.floor(n / 4)).filter(Boolean)) || atrNow || 1;
  const atrRatio = atrNow / atrEarly;
  const rangeCompressed = atrRatio < 0.65;

  const rsiVal = iRSI(closes).filter(v => v !== null).at(-1) || 50;
  const { hist: macdHist } = iMACD(closes);
  const mh = macdHist.at(-1), mhPrev = macdHist.at(-2);

  const last5 = closes.slice(-5);
  const consecUp = last5.every((c, i) => i === 0 || c >= last5[i - 1]);
  const consecDn = last5.every((c, i) => i === 0 || c <= last5[i - 1]);

  const signals = [];
  let score = 0;
  let bullCount = 0, bearCount = 0;

  if (aboveE20 && aboveE50) { score += 0.25; bullCount++; signals.push('Above EMA 20 & 50 — bullish structure'); }
  else if (!aboveE20 && !aboveE50) { score -= 0.25; bearCount++; signals.push('Below EMA 20 & 50 — bearish structure'); }
  else { score += aboveE20 ? 0.05 : -0.05; signals.push('Mixed EMA alignment'); }

  if (aboveE200 === true) { score += 0.12; bullCount++; signals.push('Above EMA 200 — long-term bullish'); }
  else if (aboveE200 === false) { score -= 0.12; bearCount++; signals.push('Below EMA 200 — long-term bearish'); }

  if (e20Slope > 0.004) { score += 0.15; bullCount++; signals.push('EMA 20 rising — momentum building'); }
  else if (e20Slope < -0.004) { score -= 0.15; bearCount++; signals.push('EMA 20 declining — momentum fading'); }
  if (e50 && e50Slope > 0.002) { score += 0.08; bullCount++; }
  else if (e50 && e50Slope < -0.002) { score -= 0.08; bearCount++; }

  if (mh > 0 && mh > mhPrev) { score += 0.2; bullCount++; signals.push(`MACD expanding bullish (hist +${mh.toFixed(5)})`); }
  else if (mh > 0) { score += 0.08; signals.push(`MACD bullish fading (hist +${mh.toFixed(5)})`); }
  else if (mh < 0 && mh < mhPrev) { score -= 0.2; bearCount++; signals.push(`MACD expanding bearish (hist ${mh.toFixed(5)})`); }
  else if (mh < 0) { score -= 0.08; signals.push(`MACD bearish fading (hist ${mh.toFixed(5)})`); }

  if (rsiVal > 60) { score += 0.12; bullCount++; signals.push(`RSI ${rsiVal.toFixed(0)} — bullish momentum`); }
  else if (rsiVal < 40) { score -= 0.12; bearCount++; signals.push(`RSI ${rsiVal.toFixed(0)} — bearish momentum`); }
  else { signals.push(`RSI ${rsiVal.toFixed(0)} — neutral zone`); }
  if (rsiVal > 75) { score -= 0.08; signals.push('RSI overbought — caution'); }
  else if (rsiVal < 25) { score += 0.08; signals.push('RSI oversold — potential reversal'); }

  if (pctChg > 0.04) { score += 0.18; bullCount++; signals.push(`Price +${(pctChg * 100).toFixed(1)}% recent`); }
  else if (pctChg < -0.04) { score -= 0.18; bearCount++; signals.push(`Price ${(pctChg * 100).toFixed(1)}% recent`); }
  else { signals.push(`Price flat (${(pctChg * 100).toFixed(1)}%)`); }

  const volTrend = volRatio > 1.3 ? 'expanding' : volRatio < 0.75 ? 'contracting' : 'neutral';
  if (aboveE20 && volTrend === 'expanding') { score += 0.18; bullCount++; signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in uptrend (markup)`); }
  else if (!aboveE20 && volTrend === 'expanding') { score -= 0.18; bearCount++; signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in downtrend (markdown)`); }
  else if (volTrend === 'contracting' && Math.abs(pctChg) < 0.03) { score += 0.15; bullCount++; signals.push('Low vol + tight range — accumulation zone'); }
  else if (volTrend === 'contracting' && pctChg < -0.02) { score -= 0.08; signals.push('Shrinking vol on drop — exhaustion / base'); }

  if (consecUp) { score += 0.1; bullCount++; signals.push('5 consecutive up closes — strong momentum'); }
  else if (consecDn) { score -= 0.1; bearCount++; signals.push('5 consecutive down closes — strong selling'); }

  if (rangeCompressed) {
    signals.push(`ATR at ${(atrRatio * 100).toFixed(0)}% of avg — compressed range`);
    if (Math.abs(score) < 0.3) { score += 0.08; signals.push('Coiling inside tight range — breakout approaching'); }
  }

  const agreement = Math.max(bullCount, bearCount);
  const alignBonus = agreement >= 5 ? 0.1 : agreement >= 4 ? 0.06 : agreement >= 3 ? 0.03 : 0;
  score = Math.max(-1, Math.min(1, score)) * (1 + alignBonus * (score > 0 ? 1 : -1));
  score = Math.max(-1, Math.min(1, score));

  const phase = score >= 0.45 ? 'MARKUP' : score >= 0.12 ? 'ACCUMULATION' : score <= -0.45 ? 'MARKDOWN' : score <= -0.12 ? 'DISTRIBUTION' : 'NEUTRAL';
  const price_trend = pctChg > 0.03 ? 'up' : pctChg < -0.03 ? 'down' : 'flat';
  const candleBonus = 0.04 * Math.min(n / 60, 1);
  return { phase, confidence: +Math.min(Math.abs(score) + candleBonus, 1).toFixed(3), price_trend, volume_trend: volTrend, range_compression: rangeCompressed, signals, score: +score.toFixed(4) };
}

// Support/resistance pivots + entry/TP/SL, ported from ta-signal.js.
export function findSR(highs, lows, closes, lb = 3) {
  const pH = [], pL = [];
  for (let i = lb; i < closes.length - lb; i++) {
    const h = highs[i], l = lows[i];
    if (highs.slice(i - lb, i).every(v => v <= h) && highs.slice(i + 1, i + lb + 1).every(v => v <= h)) pH.push(h);
    if (lows.slice(i - lb, i).every(v => v >= l) && lows.slice(i + 1, i + lb + 1).every(v => v >= l)) pL.push(l);
  }
  function cluster(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const out = [];
    for (const v of sorted) {
      if (!out.length || (v - out.at(-1)) / out.at(-1) > 0.004) out.push(v);
      else out[out.length - 1] = out.at(-1) * 0.55 + v * 0.45;
    }
    return out;
  }
  const price = closes.at(-1);
  return {
    resistance: cluster(pH).filter(l => l > price * 1.002).slice(0, 4),
    support: cluster(pL).filter(l => l < price * 0.998).slice(-4),
  };
}

export function calcTradeSetup(direction, price, sr, atr) {
  const a = atr || price * 0.02;
  const buf = a * 0.35;
  let entry, tp1, tp2, sl;

  if (direction === 'LONG') {
    const sup = sr.support.length ? Math.max(...sr.support) : null;
    const res1 = sr.resistance.length ? Math.min(...sr.resistance) : null;
    const res2 = sr.resistance.length > 1 ? sr.resistance.slice().sort((a, b) => a - b)[1] : null;
    entry = sup && sup > price * 0.97 ? sup : price;
    tp1 = res1 || entry + a * 2.5;
    tp2 = res2 || tp1 + a * 1.5;
    sl = sup ? sup - buf : entry - a * 1.5;
  } else if (direction === 'SHORT') {
    const res = sr.resistance.length ? Math.min(...sr.resistance) : null;
    const sup1 = sr.support.length ? Math.max(...sr.support) : null;
    const sup2 = sr.support.length > 1 ? sr.support.slice().sort((a, b) => b - a)[1] : null;
    entry = res && res < price * 1.03 ? res : price;
    tp1 = sup1 || entry - a * 2.5;
    tp2 = sup2 || tp1 - a * 1.5;
    sl = res ? res + buf : entry + a * 1.5;
  } else {
    entry = price; tp1 = price + a * 2; tp2 = price + a * 3.5; sl = price - a * 1.5;
  }

  const risk = Math.abs(entry - sl);
  const rew = Math.abs(tp1 - entry);
  const rr = risk > 0 ? rew / risk : 0;
  return { entry, tp1, tp2, sl, rr };
}

// ── Regime score (ported from intel.js _scoreIntel) ───────────────────────────
// NOTE: the live dashboard's MVRV Z-Score input (_mvrvData.summary.z_score) is
// dead code today — nothing in the app ever sets that field, so the Intel tab's
// regime score always silently skips it. We do the same here rather than
// fabricate a Z-score from an unrelated approximation.
export function scoreRegime(d) {
  const signals = [];
  const sig = (name, score, note, value) => signals.push({ name, score, note, value });

  if (d.fng?.value != null) {
    const fg = d.fng.value;
    if (fg < 15) sig('Fear & Greed', 2, 'Extreme fear — historical buy zone', fg);
    else if (fg < 35) sig('Fear & Greed', 1, 'Fear — opportunistic zone', fg);
    else if (fg < 55) sig('Fear & Greed', 0, 'Neutral', fg);
    else if (fg < 75) sig('Fear & Greed', -1, 'Greed — tighten stops', fg);
    else sig('Fear & Greed', -2, 'Extreme greed — reduce exposure', fg);
  }
  if (d.btcFundApr != null) {
    const f = d.btcFundApr;
    if (f < 0) sig('BTC Funding', 2, 'Negative — strong setup for longs', f.toFixed(1) + '%');
    else if (f < 5) sig('BTC Funding', 1, 'Low — no crowding', f.toFixed(1) + '%');
    else if (f < 15) sig('BTC Funding', 0, 'Neutral', f.toFixed(1) + '%');
    else if (f < 30) sig('BTC Funding', -1, 'Elevated — longs crowding', f.toFixed(1) + '%');
    else sig('BTC Funding', -2, 'Very high — crowded, flush risk', f.toFixed(1) + '%');
  }
  if (d.altBreadth != null) {
    const b = d.altBreadth;
    if (b > 65) sig('Alt Breadth', 1, 'Broad rally — risk appetite healthy', b + '%');
    else if (b > 45) sig('Alt Breadth', 0, 'Mixed — selective strength', b + '%');
    else sig('Alt Breadth', -1, 'Broad weakness — risk-off', b + '%');
  }
  if (d.mcapChange24h != null) {
    const m = d.mcapChange24h;
    if (m > 3) sig('MCap 24h', 1, 'Rising — inflows present', (m > 0 ? '+' : '') + m.toFixed(1) + '%');
    else if (m > -3) sig('MCap 24h', 0, 'Flat', m.toFixed(1) + '%');
    else sig('MCap 24h', -1, 'Falling — outflows present', m.toFixed(1) + '%');
  }
  if (d.oiChange24h != null) {
    const o = d.oiChange24h;
    if (o < -8) sig('BTC OI 24h', 1, 'Flushed — reset complete', o.toFixed(1) + '%');
    else if (o < 5) sig('BTC OI 24h', 0, 'Stable', o.toFixed(1) + '%');
    else sig('BTC OI 24h', -1, 'Rising fast — crowding building', o.toFixed(1) + '%');
  }
  if (d.btcDom != null) {
    const dom = d.btcDom;
    if (dom < 50) sig('BTC Dom', 1, 'Alt season conditions', dom.toFixed(1) + '%');
    else if (dom < 58) sig('BTC Dom', 0, 'Neutral — BTC/Alt balance', dom.toFixed(1) + '%');
    else sig('BTC Dom', -1, 'BTC dominance suppressing alts', dom.toFixed(1) + '%');
  }

  const raw = signals.reduce((sum, s) => sum + s.score, 0);
  const maxRaw = 8; // 2+2+1+1+1+1 (MVRV Z's weight-3 slot excluded — see note above)
  const normScore = Math.max(-10, Math.min(10, Math.round(raw * 10 / maxRaw)));
  const confidence = signals.length ? Math.round(40 + (Math.abs(normScore) / 10) * 50) : 50;

  let verdict;
  if (normScore >= 6) verdict = 'BUY';
  else if (normScore >= 3) verdict = 'BULL';
  else if (normScore >= -2) verdict = 'WAIT';
  else if (normScore >= -5) verdict = 'CAUTION';
  else verdict = 'SELL';

  return { signals, raw, normScore, confidence, verdict };
}

// ── Macro fetchers (ported from app.js / intel.js) ────────────────────────────
export async function getCGGlobal() {
  const r = await fetch('https://api.coingecko.com/api/v3/global');
  if (!r.ok) throw new Error('CG global ' + r.status);
  return (await r.json()).data;
}

export async function getCGMarkets() {
  const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h');
  if (!r.ok) throw new Error('CG markets ' + r.status);
  return r.json();
}

export async function getRegimeInputs() {
  const [fng, cgGlobal, cgMarkets, bnOi, bnFundBtc, bnOiHist, byFund] = await Promise.allSettled([
    getFearGreed(),
    getCGGlobal(),
    getCGMarkets(),
    fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT').then(r => r.json()),
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT').then(r => r.json()),
    fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25').then(r => r.json()),
    fetch('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1').then(r => r.json()),
  ]);

  const g = cgGlobal.status === 'fulfilled' ? cgGlobal.value : {};
  const btcDom = g.market_cap_percentage?.btc ?? null;
  const mcapChange24h = g.market_cap_change_percentage_24h_usd ?? null;

  let altBreadth = null;
  if (cgMarkets.status === 'fulfilled' && Array.isArray(cgMarkets.value)) {
    const coins = cgMarkets.value.filter(c => !['usdt', 'usdc', 'dai', 'busd', 'tusd', 'usdd'].includes(c.symbol));
    const up = coins.filter(c => (c.price_change_percentage_24h || 0) > 0).length;
    altBreadth = coins.length ? Math.round(up / coins.length * 100) : null;
  }

  const btcFund8h = bnFundBtc.status === 'fulfilled' ? parseFloat(bnFundBtc.value.lastFundingRate || 0) : null;
  const btcFundApr8hOnly = btcFund8h != null ? btcFund8h * 3 * 365 * 100 : null;
  const bybitRate = byFund.status === 'fulfilled' ? parseFloat(byFund.value.result?.list?.[0]?.fundingRate || 0) : null;
  const bybitApr = bybitRate != null ? bybitRate * 3 * 365 * 100 : null;
  const fundSamples = [btcFundApr8hOnly, bybitApr].filter(f => f != null);
  const btcFundApr = fundSamples.length ? fundSamples.reduce((a, b) => a + b, 0) / fundSamples.length : null;

  let oiChange24h = null;
  if (bnOiHist.status === 'fulfilled' && Array.isArray(bnOiHist.value) && bnOiHist.value.length >= 24) {
    const h = bnOiHist.value;
    const newest = parseFloat(h[h.length - 1].sumOpenInterestValue || 0);
    const oldest = parseFloat(h[0].sumOpenInterestValue || 0);
    oiChange24h = oldest > 0 ? ((newest - oldest) / oldest) * 100 : null;
  }

  return {
    fng: fng.status === 'fulfilled' ? fng.value : null,
    btcDom, mcapChange24h, altBreadth, btcFundApr, oiChange24h,
  };
}

// ── Journal history (optional — only if SUPABASE_URL/SUPABASE_ANON_KEY set) ──
export async function getJournalSummary(supabaseUrl, supabaseKey, limit = 20) {
  const endpoint = supabaseUrl.replace(/\/$/, '') + `/rest/v1/hype_journal?order=created_at.desc&limit=${limit}`;
  const r = await fetch(endpoint, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text().catch(() => r.statusText)}`);
  return r.json();
}

export async function getFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
  } catch {
    return { value: 50, label: 'Neutral' };
  }
}

function _hlpMatch(txt = '') {
  return /hyperliquid|hyperevm|hypercore|hyperbft|hyperunit|\bhip-\d+/i.test(txt) || /\$HYPE\b|\bHYPE\b/.test(txt);
}

export async function getHLNews(limit = 12) {
  const out = [];
  const cutSec = Math.floor(Date.now() / 1000) - 7 * 86400;
  let beforeTs = null;
  try {
    for (let page = 0; page < 3; page++) {
      const base = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest&limit=50';
      const r = await fetch(beforeTs ? `${base}&before_ts=${beforeTs}` : base);
      if (!r.ok) break;
      const arts = (await r.json())?.Data || [];
      if (!arts.length) break;
      for (const a of arts) {
        if (a.published_on < cutSec) return out.slice(0, limit);
        if (_hlpMatch(`${a.title} ${a.body || ''}`)) {
          const ageH = Math.floor((Date.now() / 1000 - a.published_on) / 3600);
          out.push({ title: a.title, age: ageH < 24 ? `${ageH}h` : `${Math.floor(ageH / 24)}d` });
        }
      }
      beforeTs = arts.at(-1)?.published_on;
      if (!beforeTs) break;
    }
  } catch {}
  return out.slice(0, limit);
}

export async function getHLStats() {
  const stats = {};
  try {
    const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
    const idx = meta.universe.findIndex(u => u.name === 'HYPE');
    const c = idx >= 0 ? ctxs[idx] : null;
    if (c) {
      stats.hypePx = parseFloat(c.markPx);
      stats.hype24h = c.prevDayPx ? (stats.hypePx / parseFloat(c.prevDayPx) - 1) * 100 : null;
      stats.hypeFunding = parseFloat(c.funding);
      stats.hypeOI = parseFloat(c.openInterest) * stats.hypePx;
    }
    stats.hlVolume24h = ctxs.reduce((s, x) => s + (parseFloat(x.dayNtlVlm) || 0), 0);
  } catch {}
  try {
    const chains = await fetch('https://api.llama.fi/v2/chains').then(r => (r.ok ? r.json() : []));
    stats.evmTvl = chains.filter(ch => /hyperliquid/i.test(ch.name || '')).reduce((s, ch) => s + (ch.tvl || 0), 0) || null;
  } catch {}
  return stats;
}

export const _f8 = r => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
export const _fmtM = n =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${(+n).toFixed(0)}`;

export async function tgSend(token, chatId, text) {
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Closes whatever a truncated response left open (unterminated string, dangling
// "key": with no value, trailing comma, unclosed braces/brackets) so JSON.parse
// can accept it.
function _repairJSON(text) {
  let inStr = false, escaped = false;
  const stack = [];
  for (const ch of text) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inStr) out += '"';
  out = out.replace(/"[^"\n]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

export function extractJSON(text) {
  // Models often wrap output in ```json fences and thinking models sometimes
  // hit the token cap mid-object, so tolerate both instead of requiring a
  // clean {...} block.
  let t = String(text || '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*(?:```|$)/i);
  if (fence && fence[1].includes('{')) t = fence[1];
  const start = t.indexOf('{');
  if (start === -1) throw new Error(`No JSON object in model response: ${String(text || '').slice(0, 120)}`);
  t = t.slice(start).trim();

  try { return JSON.parse(t); } catch {}
  const last = t.lastIndexOf('}');
  if (last !== -1) { try { return JSON.parse(t.slice(0, last + 1)); } catch {} }
  try { return JSON.parse(_repairJSON(t)); } catch {}
  // Drop trailing members one comma at a time until what's left parses.
  let cut = t;
  for (let i = cut.lastIndexOf(','); i !== -1; i = cut.lastIndexOf(',')) {
    cut = cut.slice(0, i);
    try { return JSON.parse(_repairJSON(cut)); } catch {}
  }
  throw new Error(`Unparseable JSON in model response: ${t.slice(0, 120)}`);
}

// Calls the Supabase llm-router Edge Function (supabase/functions/llm-router) —
// the same multi-provider gateway the dashboard's AI tabs use. Tier-2 tasks
// ('debrief', 'weekly_review') route through Gemini Pro → Claude Sonnet →
// OpenRouter → Groq 70B, in that order, for the highest-quality draft available.
export async function routedDraft(routerUrl, task, system, user, maxTokens = 1200) {
  const r = await fetch(routerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, system, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.text) throw new Error(`llm-router (${task}) failed: ${d.error || r.status} ${(d.details || []).join('; ')}`);
  console.log(`[llm-router] ${task} -> ${d.provider}/${d.model}`);
  return d.text.trim();
}

// Writes one markdown entry to disk and prepends it to a capped JSON index —
// both get committed straight into the repo by the workflow, so there's no
// database for Daily Brief / Weekly Research at all.
export async function writeEntry({ dir, file, md, indexPath, indexEntry, maxEntries = 120 }) {
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${file}`, md, 'utf8');
  let index = [];
  try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch {}
  index = [indexEntry, ...index.filter(e => e.file !== indexEntry.file)].slice(0, maxEntries);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

export async function readIndex(indexPath) {
  const fs = await import('node:fs/promises');
  try { return JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch { return []; }
}

export function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
