/**
 * Hype Bot Worker — Cloudflare Worker with cron triggers
 *
 * Crons:
 *   every 15 min     — signal scan (TA + funding gate + sentiment gate)
 *   every 15 min     — funding arb scan
 *   every 4h         — reversal pattern scan (4h candle close)
 *   every 4h         — multi-TF trend alignment check
 *   midnight UTC     — daily snapshot → Supabase + Telegram
 *   Sunday midnight  — weekly performance review
 *
 * Secrets: WALLET, TG_TOKEN, TG_CHAT, SUPABASE_URL, SUPABASE_KEY, COINGLASS_KEY
 * KV namespace: ALERT_STATE
 * Env vars: SIGNAL_COINS, ARB_THRESHOLD, MAX_FUNDING, FG_GREED_GATE
 */

// ── TA Helpers ────────────────────────────────────────────────────────────────

function iEMA(arr, p) {
  const k = 2 / (p + 1); let ema = arr[0];
  return arr.map(v => (ema = v * k + ema * (1 - k)));
}

function iMACD(arr, f = 12, s = 26, sig = 9) {
  const emaF = iEMA(arr, f), emaS = iEMA(arr, s);
  const macd = emaF.map((v, i) => v - emaS[i]);
  const signal = iEMA(macd, sig);
  return { macd, signal, hist: macd.map((v, i) => v - signal[i]) };
}

function iRSI(arr, p = 14) {
  let gAvg = 0, lAvg = 0;
  for (let i = 1; i <= p; i++) { const d = arr[i] - arr[i - 1]; if (d > 0) gAvg += d; else lAvg -= d; }
  gAvg /= p; lAvg /= p;
  const out = new Array(p).fill(null);
  out.push(lAvg === 0 ? 100 : 100 - 100 / (1 + gAvg / lAvg));
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    gAvg = (gAvg * (p - 1) + Math.max(d, 0)) / p;
    lAvg = (lAvg * (p - 1) + Math.max(-d, 0)) / p;
    out.push(lAvg === 0 ? 100 : 100 - 100 / (1 + gAvg / lAvg));
  }
  return out;
}

// ── Candle Pattern Detection ──────────────────────────────────────────────────

function avgVolume(candles, period = 20) {
  const vols = candles.slice(-period - 1, -1).map(c => parseFloat(c.v));
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

function iATR(highs, lows, closes, p=14) {
  const tr=closes.map((c,i)=>i===0?highs[0]-lows[0]:Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  let atr=tr.slice(0,p).reduce((a,b)=>a+b)/p;
  const out=[...new Array(p-1).fill(null),atr];
  for(let i=p;i<tr.length;i++){atr=(atr*(p-1)+tr[i])/p;out.push(atr);}
  return out;
}

function iADX(highs, lows, closes, p=14) {
  if(highs.length<p+2) return {adx:[],pdi:[],mdi:[]};
  const tr=[],pDM=[],mDM=[];
  for(let i=1;i<highs.length;i++){
    const h=highs[i]-highs[i-1],l=lows[i-1]-lows[i];
    pDM.push(h>l&&h>0?h:0); mDM.push(l>h&&l>0?l:0);
    tr.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  }
  const ws=arr=>{const o=[arr.slice(0,p).reduce((a,b)=>a+b,0)];for(let i=p;i<arr.length;i++)o.push(o.at(-1)-o.at(-1)/p+arr[i]);return o;};
  const aTR=ws(tr),sPDM=ws(pDM),sMDM=ws(mDM);
  const pdi=sPDM.map((v,i)=>aTR[i]?100*v/aTR[i]:0);
  const mdi=sMDM.map((v,i)=>aTR[i]?100*v/aTR[i]:0);
  const adx=ws(pdi.map((v,i)=>{const s=v+mdi[i];return s?100*Math.abs(v-mdi[i])/s:0;}));
  return {adx,pdi,mdi};
}

function iSupertrend(highs, lows, closes, period=10, mult=3) {
  const atr=iATR(highs,lows,closes,period);
  const out=[];let trend=1,pU=Infinity,pL=-Infinity;
  for(let i=0;i<closes.length;i++){
    if(!atr[i]){out.push(null);continue;}
    const mid=(highs[i]+lows[i])/2;
    let u=mid+mult*atr[i],l=mid-mult*atr[i];
    if(out.length&&out.at(-1)){l=Math.max(l,pL);u=Math.min(u,pU);}
    if(closes[i]>pU)trend=1;else if(closes[i]<pL)trend=-1;
    pU=u;pL=l;out.push({trend,line:trend===1?l:u});
  }
  return out;
}

function detectMarketStructure(candles, lb=5) {
  if(candles.length<lb*2+2) return {structure:'NEUTRAL',details:[],breakout:null};
  const H=candles.map(c=>parseFloat(c.h)),L=candles.map(c=>parseFloat(c.l)),C=candles.map(c=>parseFloat(c.c));
  const sH=[],sL=[];
  for(let i=lb;i<candles.length-lb;i++){
    if(H.slice(i-lb,i).every(h=>h<=H[i])&&H.slice(i+1,i+lb+1).every(h=>h<=H[i]))sH.push({i,price:H[i]});
    if(L.slice(i-lb,i).every(l=>l>=L[i])&&L.slice(i+1,i+lb+1).every(l=>l>=L[i]))sL.push({i,price:L[i]});
  }
  let structure='NEUTRAL',details=[];
  if(sH.length>=2&&sL.length>=2){
    const hh=sH.at(-1).price>sH.at(-2).price,hl=sL.at(-1).price>sL.at(-2).price;
    const lh=sH.at(-1).price<sH.at(-2).price,ll=sL.at(-1).price<sL.at(-2).price;
    if(hh&&hl){structure='UPTREND';details=['HH','HL'];}
    else if(lh&&ll){structure='DOWNTREND';details=['LH','LL'];}
    else if(hh&&ll){structure='EXPANDING';details=['HH','LL'];}
    else if(lh&&hl){structure='CONTRACTING';details=['LH','HL'];}
  }
  const cur=C.at(-1);
  let breakout=null;
  if(sH.at(-1)&&cur>sH.at(-1).price&&structure!=='UPTREND')breakout={type:'BULLISH_BREAK',level:sH.at(-1).price};
  else if(sL.at(-1)&&cur<sL.at(-1).price&&structure!=='DOWNTREND')breakout={type:'BEARISH_BREAK',level:sL.at(-1).price};
  return {structure,details,breakout,swingHighs:sH,swingLows:sL};
}

function detectRSIDivergence(closes,p=14){
  const rsi=iRSI(closes,p),pH=[],pL=[],divs=[];
  for(let i=3;i<closes.length-3;i++){
    if(rsi[i]===null)continue;
    if(closes.slice(i-3,i).every(c=>c<=closes[i])&&closes.slice(i+1,i+4).every(c=>c<=closes[i]))pH.push({i,price:closes[i],rsi:rsi[i]});
    if(closes.slice(i-3,i).every(c=>c>=closes[i])&&closes.slice(i+1,i+4).every(c=>c>=closes[i]))pL.push({i,price:closes[i],rsi:rsi[i]});
  }
  if(pH.length>=2){const[a,b]=[pH.at(-2),pH.at(-1)];if(b.price>a.price&&b.rsi<a.rsi&&b.rsi>55)divs.push({type:'BEARISH',label:'Price HH / RSI LH',strength:b.rsi>68?'STRONG':'MEDIUM'});}
  if(pL.length>=2){const[a,b]=[pL.at(-2),pL.at(-1)];if(b.price<a.price&&b.rsi>a.rsi&&b.rsi<45)divs.push({type:'BULLISH',label:'Price LL / RSI HL',strength:b.rsi<32?'STRONG':'MEDIUM'});}
  return divs;
}

function detectCandlePatterns(candles) {
  if (candles.length < 4) return [];
  const patterns = [];

  const c  = candles.at(-1);  // current (just closed)
  const p1 = candles.at(-2);  // previous
  const p2 = candles.at(-3);  // 2 back
  const p3 = candles.at(-4);  // 3 back

  const cO = parseFloat(c.o),  cC = parseFloat(c.c),  cH = parseFloat(c.h),  cL = parseFloat(c.l),  cV = parseFloat(c.v);
  const pO = parseFloat(p1.o), pC = parseFloat(p1.c), pH = parseFloat(p1.h), pL = parseFloat(p1.l), pV = parseFloat(p1.v);
  const p2O = parseFloat(p2.o), p2C = parseFloat(p2.c);
  const p3O = parseFloat(p3.o), p3C = parseFloat(p3.c);

  const cBull = cC > cO, cBear = cC < cO;
  const pBull = pC > pO, pBear = pC < pO;
  const cBody = Math.abs(cC - cO), pBody = Math.abs(pC - pO);
  const cRange = cH - cL, pRange = pH - pL;
  const cUpperWick = cH - Math.max(cO, cC);
  const cLowerWick = Math.min(cO, cC) - cL;
  const avgVol = avgVolume(candles);
  const volSpike = cV > avgVol * 1.4;
  const vm = avgVol > 0 ? cV / avgVol : 1; // volume multiplier

  const push = (name, direction, strength) => patterns.push({ name, direction, strength, volMult: vm });

  if (pBull && cBear && cO >= pC && cC <= pO && cBody > pBody && volSpike)                          push('Bearish Engulfing',  'bearish', 'STRONG');
  if (pBear && cBull && cO <= pC && cC >= pO && cBody > pBody && volSpike)                          push('Bullish Engulfing',  'bullish', 'STRONG');
  if (pBull && cBear && cO > pH && cC < (pO + pC) / 2 && cC > pO && volSpike)                      push('Dark Cloud Cover',   'bearish', 'MEDIUM');
  if (pBear && cBull && cO < pL && cC > (pO + pC) / 2 && cC < pO && volSpike)                      push('Piercing Line',      'bullish', 'MEDIUM');
  if (cBear && cUpperWick >= cBody * 2 && cLowerWick <= cBody * 0.3 && volSpike)                    push('Shooting Star',      'bearish', 'MEDIUM');
  if (cBull && cLowerWick >= cBody * 2 && cUpperWick <= cBody * 0.3 && volSpike)                    push('Hammer',             'bullish', 'MEDIUM');
  if (cBull && cUpperWick >= cBody * 2 && cLowerWick <= cBody * 0.3 && pBear && volSpike)           push('Inverted Hammer',    'bullish', 'MEDIUM');
  if (cBody <= cRange * 0.1 && cRange > 0 && volSpike) {
    const dojiType = cUpperWick > cLowerWick * 2 ? 'Gravestone Doji' : cLowerWick > cUpperWick * 2 ? 'Dragonfly Doji' : 'Doji';
    push(dojiType, 'neutral', 'WATCH');
  }

  const p2Bull = p2C > p2O, p1Small = Math.abs(pC - pO) < Math.abs(p2C - p2O) * 0.5;
  const p2Bear = p2C < p2O;
  if (p2Bull && p1Small && cBear && cC < (p2O + p2C) / 2 && volSpike)  push('Evening Star',    'bearish', 'STRONG');
  if (p2Bear && p1Small && cBull && cC > (p2O + p2C) / 2 && volSpike)  push('Morning Star',    'bullish', 'STRONG');
  if (pBull && cBear && Math.abs(cH - pH) <= cRange * 0.02)             push('Tweezer Top',     'bearish', 'MEDIUM');
  if (pBear && cBull && Math.abs(cL - pL) <= cRange * 0.02)             push('Tweezer Bottom',  'bullish', 'MEDIUM');

  // ── EMA Death Cross (EMA20 crosses below EMA50)
  const closes = candles.map(c => parseFloat(c.c));
  if (closes.length >= 52) {
    const ema20 = iEMA(closes, 20);
    const ema50 = iEMA(closes, 50);
    const crossedUnder = ema20.at(-1) < ema50.at(-1) && ema20.at(-2) >= ema50.at(-2);
    const crossedOver  = ema20.at(-1) > ema50.at(-1) && ema20.at(-2) <= ema50.at(-2);
    if (crossedUnder) push('Death Cross (EMA20/50)',  'bearish', 'STRONG');
    if (crossedOver)  push('Golden Cross (EMA20/50)', 'bullish', 'STRONG');
  }

  return patterns;
}

// ── Hyperliquid API ───────────────────────────────────────────────────────────

const HL_URL = 'https://api.hyperliquid.xyz/info';

async function hlPost(body) {
  const r = await fetch(HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json();
}

async function getCandles(coin, interval = '1h', days = 3) {
  const end = Date.now();
  const start = end - days * 86400000;
  const data = await hlPost({
    type: 'candleSnapshot',
    req: { coin, interval, startTime: start, endTime: end },
  });
  return Array.isArray(data) ? data : [];
}

async function getFundingRates() {
  const data = await hlPost({ type: 'metaAndAssetCtxs' });
  const [meta, ctxs] = data;
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

async function getPortfolioState(wallet) {
  const [clearingHouse] = await Promise.all([
    hlPost({ type: 'clearinghouseState', user: wallet }),
  ]);
  const positions = (clearingHouse.assetPositions || [])
    .filter(p => parseFloat(p.position.szi) !== 0)
    .map(p => ({
      coin: p.position.coin,
      size: parseFloat(p.position.szi),
      entryPx: parseFloat(p.position.entryPx || 0),
      markPx: parseFloat(p.position.returnOnEquity ? p.position.positionValue / Math.abs(p.position.szi) : 0),
      unrealizedPnl: parseFloat(p.position.unrealizedPnl || 0),
      leverage: parseFloat(p.position.leverage?.value || 1),
      liquidationPx: parseFloat(p.position.liquidationPx || 0),
    }));
  const accountValue = parseFloat(clearingHouse.marginSummary?.accountValue || 0);
  return { positions, accountValue };
}

async function getRecentFills(wallet, days = 7) {
  const since = Date.now() - days * 86400000;
  const fills = await hlPost({ type: 'userFills', user: wallet, startTime: since });
  return Array.isArray(fills) ? fills : [];
}

// ── External APIs ─────────────────────────────────────────────────────────────

async function getBinanceFunding() {
  const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  if (!r.ok) return {};
  const data = await r.json();
  const result = {};
  for (const item of data) {
    if (!item.symbol.endsWith('USDT')) continue;
    result[item.symbol.slice(0, -4)] = parseFloat(item.lastFundingRate || 0);
  }
  return result;
}

async function getBybitFunding() {
  const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  if (!r.ok) return {};
  const data = await r.json();
  const result = {};
  for (const item of (data.result?.list || [])) {
    if (!item.symbol.endsWith('USDT')) continue;
    result[item.symbol.slice(0, -4)] = parseFloat(item.fundingRate || 0);
  }
  return result;
}

async function getBinance24h(symbol = 'BTCUSDT') {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
    if (!r.ok) return null;
    const d = await r.json();
    return { price: parseFloat(d.lastPrice), change24h: parseFloat(d.priceChangePercent) / 100 };
  } catch { return null; }
}

async function getFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
  } catch (_) { return { value: 50, label: 'Neutral' }; }
}

async function getCoinGlassLiq(cgKey, pair = 'BTCUSDT') {
  if (!cgKey) return null;
  try {
    const r = await fetch(
      `https://open-api.coinglass.com/public/v2/liquidation_ex_chart?ex=Binance&pair=${pair}&interval=4h`,
      { headers: { 'coinglassSecret': cgKey } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (j.code !== '0' || !j.data) return null;
    const { longLiquidationUsd24h: longs, shortLiquidationUsd24h: shorts } = j.data;
    const l = parseFloat(longs || 0), s = parseFloat(shorts || 0);
    const total = l + s;
    const bias = total > 0
      ? (s / total > 0.65 ? 'Short squeeze' : s / total < 0.35 ? 'Long flush' : 'Balanced')
      : '—';
    return { longs: l, shorts: s, bias };
  } catch (_) { return null; }
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function tgSend(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ── Supabase ──────────────────────────────────────────────────────────────────

async function sbUpsert(url, key, table, rows) {
  const r = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  return r.ok;
}

async function sbSelect(url, key, table, query) {
  try {
    const r = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────
const _px   = (coin, p) => coin === 'BTC' ? (+p).toFixed(0) : +p >= 100 ? (+p).toFixed(2) : (+p).toFixed(4);
const _f8   = r => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
const _fmtM = n => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : `${(+n).toFixed(0)}`;
const _adxStr = v => v > 40 ? 'STRONG' : v > 25 ? 'TREND' : 'RANGE';
const _hr = (n = 30) => '─'.repeat(n);

const BAR = '━'.repeat(26);
const _hdr = t => `<b>░▒▓ ${t} ▓▒░</b>`;
const _row = (k, v, tag = '') => `  ${k.padEnd(8)}${String(v).padEnd(15)}${tag}`;
const _blk = rows => `<pre>${BAR}\n${rows.join('\n')}\n${BAR}</pre>`;
const _fundT = f => f > 0.002 ? '[HIGH]' : f < -0.0001 ? '[NEG→BULL]' : f < 0.0005 ? '[LOW]' : '[NORM]';
const _rsiT  = v => v > 75 ? '[OB!]' : v > 60 ? '[BULL]' : v < 25 ? '[OS!]' : v < 40 ? '[BEAR]' : '[NEUT]';
const _pnlT  = v => v >= 0 ? '[PROFIT]' : '[LOSS]';
const _scoreT= v => v >= 8 ? '[STRONG]' : v >= 6 ? '[ENTRY]' : v >= 4 ? '[WATCH]' : '[SKIP]';
const _biasT = b => b === 'BULL' ? '[▲BULL]' : b === 'BEAR' ? '[▼BEAR]' : '[◈FLAT]';
const _oiT   = v => Math.abs(v) > 0.08 ? (v > 0 ? '[SPIKE!]' : '[FLUSH!]') : (v > 0 ? '[+OI]' : '[-OI]');

// ── KV Dedup ──────────────────────────────────────────────────────────────────

const COOLDOWNS = { signal: 4 * 3600000, reversal: 12 * 3600000, arb: 4 * 3600000 };

async function isOnCooldown(kv, key, type = 'signal') {
  const val = await kv.get(key);
  if (!val) return false;
  return Date.now() - parseInt(val) < (COOLDOWNS[type] || COOLDOWNS.signal);
}

async function setCooldown(kv, key) {
  const ttl = Math.max(...Object.values(COOLDOWNS)) / 1000;
  await kv.put(key, String(Date.now()), { expirationTtl: ttl });
}

// ── Signal Scoring ────────────────────────────────────────────────────────────

function scoreSignals(closes, funding8h) {
  let score = 0;
  const signals = [];
  const ema20 = iEMA(closes, 20);
  const ema50 = closes.length >= 50 ? iEMA(closes, 50) : null;
  const { hist: macdHist } = iMACD(closes);
  const rsiArr = iRSI(closes).filter(v => v !== null);
  const price = closes.at(-1);
  const rsi = rsiArr.at(-1) ?? 50;
  const macd = macdHist.at(-1) ?? 0;
  const macdPrev = macdHist.at(-2) ?? 0;
  const aboveEma20 = price > ema20.at(-1);
  const aboveEma50 = ema50 ? price > ema50.at(-1) : null;
  const macdCross = macd > 0 && macdPrev <= 0;

  if (aboveEma20) { score += 2; signals.push('EMA20'); }
  if (aboveEma50) { score += 2; signals.push('EMA50'); }
  if (macdCross)  { score += 3; signals.push('MACD-X'); }
  else if (macd > 0) { score += 1; signals.push('MACD+'); }
  if (rsi > 45 && rsi < 75) { score += 2; signals.push(`RSI ${rsi.toFixed(0)}`); }
  if (rsi < 35)  { score += 2; signals.push(`RSI-OS ${rsi.toFixed(0)}`); }
  if (funding8h < 0) { score += 2; signals.push('FUND-'); }
  else if (funding8h < 0.0005) { score += 1; signals.push('FUND~'); }
  else if (funding8h > 0.002)  { score -= 2; signals.push('FUND+!'); }

  const verdict = score >= 7 ? 'STRONG' : score >= 5 ? 'ENTRY' : score >= 3 ? 'WATCH' : 'SKIP';
  return { score, verdict, signals, rsi, price };
}

// ── New Utility Functions ─────────────────────────────────────────────────────

function calcCVD(candles) {
  if (!candles.length) return { cvd: 0, recent: 0, trend: 'FLAT' };
  let cvd = 0;
  const deltas = candles.map(c => {
    const h = parseFloat(c.h), l = parseFloat(c.l), cl = parseFloat(c.c), v = parseFloat(c.v);
    const range = h - l || 0.0001;
    const delta = v * (2 * (cl - l) / range - 1);
    cvd += delta;
    return delta;
  });
  const recent = deltas.slice(-8).reduce((a, b) => a + b, 0);
  const recentVol = candles.slice(-8).reduce((a, c) => a + parseFloat(c.v), 0) || 1;
  const trend = Math.abs(recent / recentVol) > 0.1 ? (recent > 0 ? 'BUY' : 'SELL') : 'FLAT';
  return { cvd, recent, trend };
}

function findSRLevels(candles, lb = 4) {
  const H = candles.map(c => parseFloat(c.h));
  const L = candles.map(c => parseFloat(c.l));
  const price = parseFloat(candles.at(-1).c);
  const resistance = [], support = [];
  for (let i = lb; i < candles.length - lb; i++) {
    if (H.slice(i-lb,i).every(h=>h<=H[i]) && H.slice(i+1,i+lb+1).every(h=>h<=H[i])) resistance.push(H[i]);
    if (L.slice(i-lb,i).every(l=>l>=L[i]) && L.slice(i+1,i+lb+1).every(l=>l>=L[i])) support.push(L[i]);
  }
  return {
    resistance: resistance.filter(r => r > price).sort((a,b)=>a-b)[0] || null,
    support:    support.filter(s => s < price).sort((a,b)=>b-a)[0]    || null,
    price,
  };
}

function positionAdvice(isLong, pnlPct, rsi1h, funding, bias1h, bias4h, cvdTrend) {
  const aligned  = isLong ? (bias1h==='BULL'||bias4h==='BULL') : (bias1h==='BEAR'||bias4h==='BEAR');
  const fullAlign= isLong ? (bias1h==='BULL'&&bias4h==='BULL') : (bias1h==='BEAR'&&bias4h==='BEAR');
  const extended = isLong ? rsi1h > 75 : rsi1h < 25;
  const fundCost = isLong ? funding > 0.002 : funding < -0.002;
  const momentum = cvdTrend === (isLong ? 'BUY' : 'SELL');

  if (!aligned && pnlPct > 0.03) return { action: 'REDUCE', reason: 'trend weakening, lock profits' };
  if (!aligned && extended)      return { action: 'CLOSE',  reason: 'trend flip + RSI extended' };
  if (fundCost  && pnlPct > 0.02) return { action: 'REDUCE', reason: 'high funding cost' };
  if (fullAlign && !extended && momentum && pnlPct > 0) return { action: 'ADD', reason: 'all signals aligned' };
  return { action: 'HOLD', reason: aligned ? 'trend intact' : 'wait for re-alignment' };
}

async function checkPriceAlerts(env) {
  const rates = await getFundingRates();
  const keys = await env.ALERT_STATE.list({ prefix: 'palert:' });
  let fired = 0;
  for (const { name } of keys.keys) {
    try {
      const val = await env.ALERT_STATE.get(name);
      if (!val) continue;
      const { coin, target, dir, chatId } = JSON.parse(val);
      const price = rates[coin]?.markPx ?? 0;
      if (!price) continue;
      const hit = dir === 'above' ? price >= target : price <= target;
      if (!hit) continue;
      await env.ALERT_STATE.delete(name);
      await tgSend(env.TG_TOKEN, chatId || env.TG_CHAT,
        _hdr('PRICE ALERT TRIGGERED') + '\n' +
        _blk([
          _row('COIN',   coin),
          _row('TARGET', `$${_px(coin, target)}`),
          _row('PRICE',  `$${_px(coin, price)}`, '[HIT]'),
          _row('DIR',    dir.toUpperCase()),
        ])
      );
      fired++;
    } catch (_) {}
  }
  return fired;
}

async function checkPositionAdvisor(env) {
  if (!env.WALLET) return;
  const { positions } = await getPortfolioState(env.WALLET);
  if (!positions.length) return;

  const [rates] = await Promise.all([getFundingRates()]);

  for (const pos of positions) {
    try {
      const isLong = pos.size > 0;
      const pnlPct = pos.entryPx ? (pos.unrealizedPnl / Math.abs(pos.entryPx * pos.size)) : 0;
      const funding = rates[pos.coin]?.fundingRate ?? 0;
      const price   = rates[pos.coin]?.markPx ?? pos.entryPx;

      const [c1h, c4h] = await Promise.all([
        getCandles(pos.coin, '1h', 3),
        getCandles(pos.coin, '4h', 14),
      ]);

      const analyze = (candles) => {
        if (candles.length < 30) return { bias: 'NEUTRAL', rsi: 50 };
        const C = candles.map(c=>parseFloat(c.c));
        const ema20=iEMA(C,20), ema50=iEMA(C,Math.min(50,C.length-1));
        const p=C.at(-1);
        const emaBull = p>ema20.at(-1) && ema20.at(-1)>ema50.at(-1);
        const emaBear = p<ema20.at(-1) && ema20.at(-1)<ema50.at(-1);
        const rsiArr = iRSI(C,14).filter(v=>v!==null);
        const rsi = rsiArr.at(-1) ?? 50;
        const bias = emaBull?'BULL':emaBear?'BEAR':'NEUTRAL';
        return { bias, rsi };
      };

      const t1h = analyze(c1h);
      const t4h = analyze(c4h);
      const cvd = calcCVD(c4h);

      const { action, reason } = positionAdvice(isLong, pnlPct, t1h.rsi, funding, t1h.bias, t4h.bias, cvd.trend);

      // Only alert on non-HOLD or on significant PnL changes
      const kvKey = `padv:${pos.coin}:${action}`;
      if (action === 'HOLD') continue;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'reversal')) continue;

      const dir = isLong ? '▲' : '▼';
      const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
      const liqDist = pos.liquidationPx ? Math.abs((price - pos.liquidationPx) / price * 100).toFixed(1) + '%' : 'N/A';

      await tgSend(env.TG_TOKEN, env.TG_CHAT,
        _hdr(`POSITION ${action}`) + '\n' +
        _blk([
          _row('COIN',   `${dir} ${pos.coin}`, isLong ? '[LONG]' : '[SHORT]'),
          _row('ENTRY',  `$${_px(pos.coin, pos.entryPx)}`),
          _row('PRICE',  `$${_px(pos.coin, price)}`, `${pnlPct>=0?'+':''}${(pnlPct*100).toFixed(2)}%`),
          _row('uPNL',   `${pnlSign}$${pos.unrealizedPnl.toFixed(2)}`, _pnlT(pos.unrealizedPnl)),
          _row('LIQ',    pos.liquidationPx ? `$${_px(pos.coin,pos.liquidationPx)}` : 'N/A', `DIST:${liqDist}`),
          _row('FUND',   _f8(funding), _fundT(funding)),
          _row('TREND',  `1H:${t1h.bias} 4H:${t4h.bias}`),
          _row('RSI_1H', t1h.rsi.toFixed(1), _rsiT(t1h.rsi)),
          _row('CVD',    cvd.trend),
          BAR,
          _row('ADVICE', action, `[${reason.toUpperCase().slice(0,16)}]`),
        ])
      );
      await setCooldown(env.ALERT_STATE, kvKey);
    } catch (_) {}
  }
}

// ── Check Signals (with sentiment gate) ──────────────────────────────────────

async function checkSignals(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const maxFunding = parseFloat(env.MAX_FUNDING || '0.0020');
  const fgGate = parseInt(env.FG_GREED_GATE || '80');

  const [hlFunding, fg] = await Promise.all([getFundingRates(), getFearGreed()]);

  // Sentiment gate: skip bullish signals in extreme greed
  const greedBlocked = fg.value >= fgGate;

  const alerts = [];
  for (const coin of coins) {
    try {
      const kvKey = `sig:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'signal')) continue;

      const funding = hlFunding[coin]?.fundingRate ?? 0;
      if (Math.abs(funding) > maxFunding && funding > 0) continue;

      const candles = await getCandles(coin, '1h', 3);
      if (candles.length < 50) continue;
      const closes = candles.map(c => parseFloat(c.c));
      const { score, verdict, signals, rsi, price } = scoreSignals(closes, funding);

      if (verdict === 'SKIP' || verdict === 'WATCH') continue;
      const oi = hlFunding[coin]?.openInterest ?? 0;
      const dir = funding < 0 || score >= 6 ? '▲' : '▼';

      if (greedBlocked) {
        alerts.push({
          kvKey,
          text: _hdr('SIGNAL CAUTION') + '\n' + _blk([
            _row('COIN',  `${dir} ${coin}`, '[LONG]'),
            _row('SCORE', `${score}/10`,    _scoreT(score)),
            _row('PRICE', `$${_px(coin,price)}`),
            _row('RSI',   rsi.toFixed(1),   _rsiT(rsi)),
            _row('FUND',  _f8(funding),     _fundT(funding)),
            _row('OI',    _fmtM(oi)+'B' ),
            _row('F_G',   fg.value,         '[GREED GATE]'),
            BAR,
            '  ' + signals.join('  '),
          ]),
        });
        continue;
      }

      alerts.push({
        kvKey,
        text: _hdr('SIGNAL DETECTED') + '\n' + _blk([
          _row('COIN',  `${dir} ${coin}`, '[LONG]'),
          _row('SCORE', `${score}/10`,    _scoreT(score)),
          _row('PRICE', `$${_px(coin,price)}`),
          _row('RSI',   rsi.toFixed(1),   _rsiT(rsi)),
          _row('FUND',  _f8(funding),     _fundT(funding)),
          _row('OI',    _fmtM(oi)),
          BAR,
          '  ' + signals.join('  '),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Check Reversals (4h candles) ──────────────────────────────────────────────

async function checkReversals(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const alerts = [];

  for (const coin of coins) {
    try {
      const kvKey = `rev:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'reversal')) continue;

      // 30 days of 4h candles (~180 candles)
      const candles = await getCandles(coin, '4h', 30);
      if (candles.length < 10) continue;

      const patterns = detectCandlePatterns(candles);
      if (patterns.length === 0) continue;

      const closes = candles.map(c => parseFloat(c.c));
      const rsiArr = iRSI(closes).filter(v => v !== null);
      const rsi = rsiArr.at(-1) ?? 50;
      const price = closes.at(-1);

      const bearCount = patterns.filter(p => p.direction === 'bearish').length;
      const overallDir = bearCount > patterns.filter(p => p.direction === 'bullish').length ? '▼' : '▲';
      const dir = overallDir;

      alerts.push({
        kvKey,
        text: _hdr(`REVERSAL PATTERN`) + '\n' + _blk([
          _row('COIN',  `${dir} ${coin}`),
          _row('TF',    '4H'),
          _row('PRICE', `$${_px(coin,price)}`),
          _row('RSI',   rsi.toFixed(1), _rsiT(rsi)),
          BAR,
          ...patterns.map(p => {
            const d = p.direction === 'bullish' ? '▲' : p.direction === 'bearish' ? '▼' : '◈';
            const vol = p.volRatio ? `  VOL×${p.volRatio.toFixed(1)}` : '';
            return `  ${d} ${p.name}${vol}  [${p.strength.toUpperCase()}]`;
          }),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Multi-TF Trend Alignment ──────────────────────────────────────────────────

async function analyzeTrend(coin) {
  const [c1h, c4h, c1d] = await Promise.all([
    getCandles(coin, '1h', 7),
    getCandles(coin, '4h', 60),
    getCandles(coin, '1d', 200),
  ]);

  const analyze = (candles, tf) => {
    if (candles.length < 52) return null;
    const H=candles.map(c=>parseFloat(c.h)), L=candles.map(c=>parseFloat(c.l)), C=candles.map(c=>parseFloat(c.c));
    const ema20=iEMA(C,20), ema50=iEMA(C,50);
    const price=C.at(-1);
    const emaBull = price>ema20.at(-1) && ema20.at(-1)>ema50.at(-1);
    const emaBear = price<ema20.at(-1) && ema20.at(-1)<ema50.at(-1);
    const {adx} = iADX(H,L,C,14);
    const adxVal = adx.at(-1) ?? 0;
    const st = iSupertrend(H,L,C,10,3);
    const stBull = st.at(-1)?.trend === 1;
    const ms = detectMarketStructure(candles);
    const rsiArr = iRSI(C,14).filter(v=>v!==null);
    const rsi = rsiArr.at(-1) ?? 50;
    const div = detectRSIDivergence(C,14);
    const bullScore = (emaBull?1:0)+(stBull?1:0)+(ms.structure==='UPTREND'?1:0);
    const bearScore = (emaBear?1:0)+(!stBull?1:0)+(ms.structure==='DOWNTREND'?1:0);
    const bias = bullScore>bearScore?'BULL':bearScore>bullScore?'BEAR':'NEUTRAL';
    return {tf, bias, emaBull, emaBear, adxVal, stBull, structure:ms.structure, rsi, div, breakout:ms.breakout};
  };

  const [r1h, r4h, r1d] = [analyze(c1h,'1h'), analyze(c4h,'4h'), analyze(c1d,'1d')];
  const results = [r1h, r4h, r1d].filter(Boolean);
  const bullCount = results.filter(r=>r.bias==='BULL').length;
  const bearCount = results.filter(r=>r.bias==='BEAR').length;
  const aligned = bullCount===3?'FULL BULL':bearCount===3?'FULL BEAR':bullCount===2?'BULL LEAN':bearCount===2?'BEAR LEAN':'MIXED';
  const divs4h = r4h?.div ?? [];
  const price = c4h.length ? parseFloat(c4h.at(-1).c) : 0;
  return {coin, price, r1h, r4h, r1d, aligned, bullCount, bearCount, divs4h};
}

async function checkTrendAlignment(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c=>c.trim());
  const alerts = [];

  for (const coin of coins) {
    try {
      const kvKey = `trend:${coin}`;
      const prev = await env.ALERT_STATE.get(`${kvKey}:bias`);
      const { aligned, bullCount, bearCount, divs4h, price, r4h, r1h, r1d } = await analyzeTrend(coin);

      // Alert only on full alignment flip or new divergence
      const isFullAlign = aligned === 'FULL BULL' || aligned === 'FULL BEAR';
      const prevWasFullAlign = prev === 'FULL BULL' || prev === 'FULL BEAR';
      const alignChanged = prev && prev !== aligned;

      // Save current bias
      await env.ALERT_STATE.put(`${kvKey}:bias`, aligned, { expirationTtl: 86400 });

      const hasDivAlert = divs4h.length > 0 && !(await isOnCooldown(env.ALERT_STATE, `${kvKey}:div`, 'reversal'));
      const hasAlignAlert = isFullAlign && alignChanged && !(await isOnCooldown(env.ALERT_STATE, kvKey, 'reversal'));

      if (hasDivAlert) {
        const d = divs4h[0];
        const dir = d.type === 'BEARISH' ? '▼' : '▲';
        alerts.push({
          key: `${kvKey}:div`,
          text: _hdr('TREND FLIP') + '\n' + _blk([
            _row('COIN',  coin),
            _row('ALIGN', aligned, _biasT(aligned.includes('BULL') ? 'BULL' : aligned.includes('BEAR') ? 'BEAR' : 'NEUTRAL')),
            _row('PRICE', `$${_px(coin, price)}`),
            BAR,
            r1h ? `  1H  ${_biasT(r1h.bias)}  ADX:${r1h.adxVal.toFixed(0).padStart(2)}  RSI:${r1h.rsi.toFixed(0)}` : '  1H  N/A',
            r4h ? `  4H  ${_biasT(r4h.bias)}  ADX:${r4h.adxVal.toFixed(0).padStart(2)}  RSI:${r4h.rsi.toFixed(0)}` : '  4H  N/A',
            r1d ? `  1D  ${_biasT(r1d.bias)}  ADX:${r1d.adxVal.toFixed(0).padStart(2)}  RSI:${r1d.rsi.toFixed(0)}` : '  1D  N/A',
          ]),
        });
      }

      if (hasAlignAlert) {
        alerts.push({
          key: kvKey,
          text: _hdr('TREND FLIP') + '\n' + _blk([
            _row('COIN',  coin),
            _row('ALIGN', aligned, _biasT(aligned.includes('BULL') ? 'BULL' : aligned.includes('BEAR') ? 'BEAR' : 'NEUTRAL')),
            _row('PRICE', `$${_px(coin, price)}`),
            BAR,
            r1h ? `  1H  ${_biasT(r1h.bias)}  ADX:${r1h.adxVal.toFixed(0).padStart(2)}  RSI:${r1h.rsi.toFixed(0)}` : '  1H  N/A',
            r4h ? `  4H  ${_biasT(r4h.bias)}  ADX:${r4h.adxVal.toFixed(0).padStart(2)}  RSI:${r4h.rsi.toFixed(0)}` : '  4H  N/A',
            r1d ? `  1D  ${_biasT(r1d.bias)}  ADX:${r1d.adxVal.toFixed(0).padStart(2)}  RSI:${r1d.rsi.toFixed(0)}` : '  1D  N/A',
          ]),
        });
      }
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.key);
  }
  return alerts.length;
}

// ── Check Funding Arb ─────────────────────────────────────────────────────────

async function checkFundingArb(env) {
  const threshold = parseFloat(env.ARB_THRESHOLD || '0.001');
  const [hlFunding, bnFunding, bbFunding] = await Promise.all([
    getFundingRates(), getBinanceFunding(), getBybitFunding(),
  ]);
  const alerts = [];

  for (const coin of Object.keys(hlFunding)) {
    try {
      const kvKey = `arb:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'arb')) continue;

      const hl = hlFunding[coin]?.fundingRate ?? 0;
      const bn = bnFunding[coin] ?? null;
      const bb = bbFunding[coin] ?? null;

      const spreads = [];
      if (bn !== null) spreads.push({ ex: 'Binance', spread: Math.abs(hl - bn), hl, other: bn });
      if (bb !== null) spreads.push({ ex: 'Bybit',   spread: Math.abs(hl - bb), hl, other: bb });
      const best = spreads.sort((a, b) => b.spread - a.spread)[0];
      if (!best || best.spread < threshold) continue;

      alerts.push({
        kvKey,
        text: _hdr('FUNDING ARB') + '\n' + _blk([
          _row('COIN',   coin),
          _row('SPREAD', `${(best.spread*100).toFixed(4)}%`),
          _row('APR',    `~${(best.spread*3*365*100).toFixed(1)}%`),
          _row('HL',     _f8(hl)),
          _row(best.ex.toUpperCase(), _f8(best.other)),
          _row('SIDE',   hl > best.other ? 'SHORT_HL / LONG_'+best.ex : 'LONG_HL / SHORT_'+best.ex),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Daily Snapshot ────────────────────────────────────────────────────────────

async function dailySnapshot(env) {
  if (!env.WALLET) return;
  const { positions, accountValue } = await getPortfolioState(env.WALLET);
  const now = Date.now();

  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    await sbUpsert(env.SUPABASE_URL, env.SUPABASE_KEY, 'hype_snapshots', [{
      id: `snap-${now}`, wallet: env.WALLET, ts: now,
      account_value: accountValue, position_count: positions.length,
      positions_json: JSON.stringify(positions),
    }]);
  }

  const totalPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const pnlSign = totalPnl >= 0 ? '+' : '';
  const header = _hdr(`SNAP ${new Date(now).toISOString().slice(0,10)}`);
  const summary = _blk([
    _row('NAV',   `$${accountValue.toFixed(2)}`),
    _row('uPNL',  `${pnlSign}$${totalPnl.toFixed(2)}`, _pnlT(totalPnl)),
    _row('OPEN',  positions.length),
  ]);
  const posBlock = positions.length ? positions.map(p => {
    const d = p.size>0?'▲':'▼'; const side=p.size>0?'LONG':'SHORT';
    const ps = p.unrealizedPnl>=0?'+':'';
    return `  ${d} ${p.coin.padEnd(5)} ${p.leverage}x ${side.padEnd(5)}  ENTRY:$${_px(p.coin,p.entryPx)}  PNL:${ps}$${p.unrealizedPnl.toFixed(2)}`;
  }).join('\n') : '  NO OPEN POSITIONS';
  await tgSend(env.TG_TOKEN, env.TG_CHAT, `${header}\n${summary}\n<pre>${BAR}\n${posBlock}\n${BAR}</pre>`);
}

// ── Weekly Review ─────────────────────────────────────────────────────────────

async function weeklyReview(env) {
  if (!env.WALLET) return;

  const fills = await getRecentFills(env.WALLET, 7);
  if (!fills.length) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, `REVIEW ${new Date().toISOString().slice(0,10)}\nNo fills in the last 7 days.`);
    return;
  }

  // Build simple trade stats from fills
  let totalPnl = 0, wins = 0, losses = 0, fees = 0;
  const byCoin = {};
  for (const f of fills) {
    const pnl = parseFloat(f.closedPnl || 0);
    const fee = parseFloat(f.fee || 0);
    totalPnl += pnl; fees += fee;
    if (pnl > 0) wins++; else if (pnl < 0) losses++;
    const coin = f.coin;
    if (!byCoin[coin]) byCoin[coin] = 0;
    byCoin[coin] += pnl;
  }

  const topCoins = Object.entries(byCoin)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 6)
    .map(([coin, pnl]) => `${pnl >= 0 ? '▲' : '▼'} ${coin}  ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`)
    .join('  ');

  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '—';
  const net = totalPnl - fees;
  const netSign = net >= 0 ? '+' : '';
  const wk = `W${Math.ceil((new Date().getDate()) / 7)}`;

  await tgSend(env.TG_TOKEN, env.TG_CHAT,
    `REVIEW ${wk} · ${new Date().toISOString().slice(0,10)}\n` +
    `Fills ${fills.length}  ·  W/L ${wins}/${losses}  ·  WR ${wr}%\n` +
    `Gross ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}  ·  Fees $${fees.toFixed(2)}  ·  Net ${netSign}$${net.toFixed(2)}\n` +
    `${_hr(30)}\n` +
    topCoins
  );
}

// ── Check OI Spikes ───────────────────────────────────────────────────────────

async function checkOISpikes(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const threshold = parseFloat(env.OI_SPIKE_PCT || '0.08');
  const rates = await getFundingRates();
  const alerts = [];

  for (const coin of coins) {
    try {
      const info = rates[coin];
      if (!info) continue;
      const { openInterest: oi, markPx, fundingRate: rate } = info;
      const prevStr = await env.ALERT_STATE.get(`oi:${coin}`);
      await env.ALERT_STATE.put(`oi:${coin}`, String(oi), { expirationTtl: 86400 });
      const prevOI = prevStr ? parseFloat(prevStr) : 0;
      if (prevOI <= 0) continue;
      const change = (oi - prevOI) / prevOI;
      if (Math.abs(change) < threshold) continue;

      const kvKey = `oi:alert:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'reversal')) continue;

      const dir = change > 0 ? '▲' : '▼';
      const type = change > 0 ? 'SPIKE' : 'FLUSH';

      const candles4h = await getCandles(coin, '4h', 7).catch(() => []);
      const { trend: cvdTrend } = calcCVD(candles4h);

      alerts.push({
        kvKey,
        text: _hdr(`OI ${type}`) + '\n' + _blk([
          _row('COIN',   coin),
          _row('CHG',    `${change>=0?'+':''}${(change*100).toFixed(1)}%`, _oiT(change)),
          _row('OI_NOW', _fmtM(oi * markPx)),
          _row('OI_PRV', _fmtM(prevOI * markPx)),
          _row('FUND',   _f8(rate), _fundT(rate)),
          _row('CVD',    cvdTrend, cvdTrend === 'BUY' ? '[BUY PRESS]' : cvdTrend === 'SELL' ? '[SELL PRESS]' : '[FLAT]'),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Check Funding Flips ───────────────────────────────────────────────────────

async function checkFundingFlips(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const rates = await getFundingRates();
  const alerts = [];

  for (const coin of coins) {
    try {
      const info = rates[coin];
      if (!info) continue;
      const { fundingRate: rate, markPx } = info;
      const sign = rate > 0.00005 ? 'pos' : rate < -0.00005 ? 'neg' : 'flat';
      const prevSign = await env.ALERT_STATE.get(`fund:${coin}:sign`);
      await env.ALERT_STATE.put(`fund:${coin}:sign`, sign, { expirationTtl: 86400 });

      if (!prevSign || prevSign === sign || prevSign === 'flat') continue;

      const kvKey = `fund:${coin}:flip`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'signal')) continue;

      const dir = sign === 'neg' ? '▼' : '▲';
      const fromLabel = prevSign.toUpperCase();
      const toLabel   = sign.toUpperCase();
      alerts.push({
        kvKey,
        text: _hdr('FUNDING FLIP') + '\n' + _blk([
          _row('COIN',  coin),
          _row('FROM',  fromLabel),
          _row('TO',    toLabel,  sign === 'neg' ? '[▼BEAR SIGNAL]' : '[▲BULL SIGNAL]'),
          _row('RATE',  _f8(rate), _fundT(rate)),
          _row('PRICE', `$${_px(coin, markPx)}`),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Check Liq Cascade ─────────────────────────────────────────────────────────

async function checkLiqCascade(env) {
  if (!env.COINGLASS_KEY) return 0;
  const threshold = parseFloat(env.LIQ_CASCADE_USD || '150000000');
  const pairs = [{ pair: 'BTCUSDT', name: 'BTC' }, { pair: 'ETHUSDT', name: 'ETH' }];
  const alerts = [];

  for (const { pair, name } of pairs) {
    try {
      const liq = await getCoinGlassLiq(env.COINGLASS_KEY, pair);
      if (!liq) continue;
      if (liq.longs + liq.shorts < threshold) continue;

      const kvKey = `liq:cascade:${name}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey, 'reversal')) continue;

      const dir = liq.longs > liq.shorts ? '▼' : '▲';
      alerts.push({
        kvKey,
        text: _hdr('LIQ CASCADE') + '\n' + _blk([
          _row('COIN',   name),
          _row('TOTAL',  _fmtM(liq.longs + liq.shorts)),
          _row('LONGS',  _fmtM(liq.longs)),
          _row('SHORTS', _fmtM(liq.shorts)),
          _row('BIAS',   liq.bias),
        ]),
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
  }
  return alerts.length;
}

// ── Telegram Commands ─────────────────────────────────────────────────────────

async function handleTgCommand(cmd, arg, env, msg) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());

  if (cmd === '/start' || cmd === '/help') {
    return _hdr('HYPE-BOT v2') + '\n' + _blk([
      '  COMMANDS',
      '  /pnl              positions + advice',
      '  /market           market pulse',
      '  /research [coin]  full TA + levels',
      '  /watch            confluence scan',
      '  /signals          signal scan now',
      '  /trend [coin]     multi-TF trend',
      '  /price [coin]     price + patterns',
      '  /alert C P [a|b]  set price alert',
      '  /alerts           list your alerts',
      '  /arb              funding arb scan',
      '  /hl [style]       HL ecosystem draft',
      '                    digest|post|thread',
      '  /snapshot         daily snapshot',
      '  /status           market status',
      BAR,
      '  AUTO MONITORS',
      '  signal    15m · 4h cooldown',
      '  fund flip 15m · 4h cooldown',
      '  OI spike  4h · CVD context',
      '  trend     4h · full TF flip',
      '  reversal  4h · candle patterns',
      '  liq       4h · cascade alert',
      '  position  4h · close/hold/add',
      '  snap      00:00 UTC daily',
      '  hl pulse  00:00 UTC daily draft',
    ]);
  }

  if (cmd === '/signals') {
    const count = await checkSignals(env);
    return count > 0
      ? _hdr('SCAN DONE') + '\n<pre>' + count + ' alert(s) sent above</pre>'
      : _hdr('SCAN DONE') + '\n<pre>  no ENTRY/STRONG signals\n  (cooldown or filtered)</pre>';
  }

  if (cmd === '/arb') {
    const count = await checkFundingArb(env);
    return count > 0
      ? _hdr('ARB SCAN') + '\n<pre>' + count + ' spread(s) above threshold</pre>'
      : _hdr('ARB SCAN') + '\n<pre>  no spreads above threshold</pre>';
  }

  if (cmd === '/snapshot') {
    await dailySnapshot(env);
    return null;
  }

  if (cmd === '/positions') return handleTgCommand('/pnl', arg, env, msg);

  if (cmd === '/pnl') {
    if (!env.WALLET) return _hdr('ERROR') + '\n<pre>WALLET secret not set</pre>';
    const { positions, accountValue } = await getPortfolioState(env.WALLET);
    const rates = await getFundingRates();
    const totalPnl = positions.reduce((a,p)=>a+p.unrealizedPnl, 0);

    const summary = _blk([
      _row('NAV',  `$${accountValue.toFixed(2)}`),
      _row('uPNL', `${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)}`, _pnlT(totalPnl)),
      _row('OPEN', positions.length),
    ]);

    if (!positions.length) return _hdr('POSITIONS') + '\n' + summary;

    const posBlocks = await Promise.all(positions.map(async p => {
      const isLong = p.size > 0;
      const price  = rates[p.coin]?.markPx ?? p.entryPx;
      const fund   = rates[p.coin]?.fundingRate ?? 0;
      const pnlPct = p.entryPx ? p.unrealizedPnl / Math.abs(p.entryPx * p.size) : 0;
      const liqDist= p.liquidationPx ? Math.abs((price - p.liquidationPx)/price*100).toFixed(1)+'%' : 'N/A';

      const [c1h, c4h] = await Promise.all([
        getCandles(p.coin,'1h',2).catch(()=>[]),
        getCandles(p.coin,'4h',7).catch(()=>[]),
      ]);
      const t1hBias = c1h.length>25?(() => { const C=c1h.map(c=>parseFloat(c.c));const e20=iEMA(C,20),e50=iEMA(C,Math.min(50,C.length-1));const pr=C.at(-1);return pr>e20.at(-1)&&e20.at(-1)>e50.at(-1)?'BULL':pr<e20.at(-1)&&e20.at(-1)<e50.at(-1)?'BEAR':'NEUT'; })() : 'NEUT';
      const t4hBias = c4h.length>25?(() => { const C=c4h.map(c=>parseFloat(c.c));const e20=iEMA(C,20),e50=iEMA(C,Math.min(50,C.length-1));const pr=C.at(-1);return pr>e20.at(-1)&&e20.at(-1)>e50.at(-1)?'BULL':pr<e20.at(-1)&&e20.at(-1)<e50.at(-1)?'BEAR':'NEUT'; })() : 'NEUT';
      const rsi1h   = (() => { if(c1h.length<15) return 50; const v=iRSI(c1h.map(c=>parseFloat(c.c)),14).filter(x=>x!==null); return v.at(-1)??50; })();
      const cvd4h   = calcCVD(c4h);
      const { action, reason } = positionAdvice(isLong, pnlPct, rsi1h, fund, t1hBias, t4hBias, cvd4h.trend);

      const dir = isLong ? '▲' : '▼';
      return [
        `  ${dir} ${p.coin}  ${p.leverage}x  ${isLong?'LONG':'SHORT'}`,
        _row('  ENTRY', `$${_px(p.coin,p.entryPx)}`),
        _row('  PRICE', `$${_px(p.coin,price)}`, `${pnlPct>=0?'+':''}${(pnlPct*100).toFixed(2)}%`),
        _row('  uPNL',  `${p.unrealizedPnl>=0?'+':''}$${p.unrealizedPnl.toFixed(2)}`, _pnlT(p.unrealizedPnl)),
        _row('  LIQ',   p.liquidationPx?`$${_px(p.coin,p.liquidationPx)}`:'N/A', `DIST:${liqDist}`),
        _row('  FUND',  _f8(fund), _fundT(fund)),
        _row('  TREND', `1H:${t1hBias} 4H:${t4hBias}`),
        _row('  RSI',   rsi1h.toFixed(0), _rsiT(rsi1h)),
        _row('  CVD',   cvd4h.trend),
        _row('  ADVICE',action, `[${reason.toUpperCase().slice(0,20)}]`),
      ].join('\n');
    }));

    return _hdr('POSITIONS') + '\n' + summary + '\n<pre>' + BAR + '\n' + posBlocks.join('\n' + BAR + '\n') + '\n' + BAR + '</pre>';
  }

  if (cmd === '/alert') {
    // usage: /alert BTC 95000 [above|below]
    const parts = (arg||'').trim().split(/\s+/);
    if (parts.length < 2) return _hdr('USAGE') + '\n<pre>/alert BTC 95000 above\n/alert BTC 90000 below</pre>';
    const [coin, targetStr, dirRaw] = parts;
    const target = parseFloat(targetStr);
    if (isNaN(target)) return '<pre>invalid price</pre>';
    const rates = await getFundingRates();
    const price = rates[coin.toUpperCase()]?.markPx ?? 0;
    const dir = dirRaw === 'below' ? 'below' : 'above';
    const key = `palert:${coin.toUpperCase()}:${target}:${dir}`;
    await env.ALERT_STATE.put(key, JSON.stringify({ coin: coin.toUpperCase(), target, dir, chatId: String(msg?.chat?.id || env.TG_CHAT) }), { expirationTtl: 86400 * 7 });
    return _hdr('ALERT SET') + '\n' + _blk([
      _row('COIN',   coin.toUpperCase()),
      _row('TARGET', `$${_px(coin.toUpperCase(), target)}`),
      _row('DIR',    dir.toUpperCase()),
      _row('NOW',    price ? `$${_px(coin.toUpperCase(), price)}` : 'N/A'),
      _row('TTL',    '7 days'),
    ]);
  }

  if (cmd === '/alerts') {
    const list = await env.ALERT_STATE.list({ prefix: 'palert:' });
    if (!list.keys.length) return _hdr('ALERTS') + '\n<pre>  NO ACTIVE ALERTS</pre>';
    const rows = [];
    for (const { name } of list.keys) {
      const v = await env.ALERT_STATE.get(name);
      if (!v) continue;
      const { coin, target, dir } = JSON.parse(v);
      rows.push(_row(`${coin}`, `$${_px(coin,target)}`, `[${dir.toUpperCase()}]`));
    }
    return _hdr('ACTIVE ALERTS') + '\n' + _blk(rows);
  }

  if (cmd === '/market') {
    const [hlFunding, fg, btc24h] = await Promise.all([
      getFundingRates(),
      getFearGreed(),
      getBinance24h('BTCUSDT'),
    ]);
    const btcRate = hlFunding['BTC']?.fundingRate ?? 0;
    const btcOI   = hlFunding['BTC']?.openInterest ?? 0;
    const btcPx   = hlFunding['BTC']?.markPx ?? 0;
    const ethPx   = hlFunding['ETH']?.markPx ?? 0;
    const solPx   = hlFunding['SOL']?.markPx ?? 0;
    const fg_tag  = fg.value > 75 ? '[EXTREME GREED]' : fg.value > 55 ? '[GREED]' : fg.value < 25 ? '[FEAR]' : '[NEUTRAL]';

    // Top funding coins by rate magnitude
    const topFund = Object.entries(hlFunding)
      .map(([c, d]) => ({ coin: c, rate: d.fundingRate ?? 0 }))
      .sort((a,b) => Math.abs(b.rate) - Math.abs(a.rate))
      .slice(0, 4);

    const rows = [
      _row('F_G',    `${fg.value}/100`, fg_tag),
      _row('BTC',    `$${_px('BTC',btcPx)}`, btc24h ? `${btc24h.change24h>=0?'+':''}${(btc24h.change24h*100).toFixed(2)}%` : ''),
      _row('ETH',    `$${_px('ETH',ethPx)}`),
      _row('SOL',    `$${_px('SOL',solPx)}`),
      _row('BTC_OI', _fmtM(btcOI)+'  coins'),
      _row('BTC_FND',_f8(btcRate), _fundT(btcRate)),
      BAR,
      '  TOP FUNDING',
      ...topFund.map(f => _row(f.coin, _f8(f.rate), f.rate > 0.002 ? '[CROWDED]' : f.rate < -0.001 ? '[OPPORT]' : '[OK]')),
    ];
    return _hdr('MARKET PULSE') + '\n' + _blk(rows);
  }

  if (cmd === '/watch') {
    const [hlFunding] = await Promise.all([getFundingRates()]);
    const results = [];
    for (const coin of coins) {
      try {
        const candles = await getCandles(coin, '1h', 3);
        if (candles.length < 50) continue;
        const closes = candles.map(c => parseFloat(c.c));
        const funding = hlFunding[coin]?.fundingRate ?? 0;
        const { score, verdict, signals } = scoreSignals(closes, funding);
        results.push({ coin, score, verdict, signals, price: closes.at(-1), funding });
      } catch (_) {}
    }
    results.sort((a,b) => b.score - a.score);
    const rows = results.map(r =>
      _row(r.coin, `${r.score}/10`, _scoreT(r.score)) + '\n  ' + r.signals.slice(0,4).join(' ')
    );
    return _hdr('CONFLUENCE SCAN') + '\n' + _blk(rows.length ? rows : ['  NO DATA']);
  }

  if (cmd === '/research') {
    const coin = (arg || 'BTC').split(/\s+/)[0].toUpperCase();
    try {
      const [c1h, c4h, c1d, hlFunding] = await Promise.all([
        getCandles(coin, '1h', 3),
        getCandles(coin, '4h', 30),
        getCandles(coin, '1d', 60),
        getFundingRates(),
      ]);
      const { r1h, r4h, r1d, aligned, price } = await analyzeTrend(coin);
      const funding = hlFunding[coin]?.fundingRate ?? 0;
      const oi      = hlFunding[coin]?.openInterest ?? 0;
      const rsi1h   = r1h?.rsi ?? 50;
      const rsi4h   = r4h?.rsi ?? 50;
      const cvd4h   = calcCVD(c4h);
      const { resistance, support } = findSRLevels(c4h);
      const patterns4h = detectCandlePatterns(c4h);
      const scores1h = scoreSignals(c1h.map(c=>parseFloat(c.c)), funding);

      const resDistPct = resistance ? ((resistance-price)/price*100).toFixed(1)+'%' : 'N/A';
      const supDistPct = support    ? ((price-support)/price*100).toFixed(1)+'%'    : 'N/A';

      // Scalp: use 1h bias + RSI. Swing: use 4h/1d alignment
      const scalpBias = r1h?.bias === 'BULL' ? 'LONG' : r1h?.bias === 'BEAR' ? 'SHORT' : 'WAIT';
      const swingBias = (r4h?.bias === 'BULL' && r1d?.bias === 'BULL') ? 'ACCUMULATE' :
                        (r4h?.bias === 'BEAR' && r1d?.bias === 'BEAR') ? 'DISTRIBUTE' : 'NEUTRAL';

      const rows = [
        _row('PRICE',  `$${_px(coin,price)}`),
        _row('ALIGN',  aligned, _biasT(aligned.includes('BULL') ? 'BULL' : aligned.includes('BEAR') ? 'BEAR' : 'NEUTRAL')),
        _row('RSI_1H', rsi1h.toFixed(1), _rsiT(rsi1h)),
        _row('RSI_4H', rsi4h.toFixed(1), _rsiT(rsi4h)),
        _row('FUND',   _f8(funding), _fundT(funding)),
        _row('OI',     _fmtM(oi)),
        _row('CVD_4H', cvd4h.trend, cvd4h.trend==='BUY'?'[BUY PRESS]':cvd4h.trend==='SELL'?'[SELL PRESS]':'[FLAT]'),
        BAR,
        '  TIMEFRAMES',
        r1h ? `  1H  ${_biasT(r1h.bias)}  ADX:${r1h.adxVal.toFixed(0)}  RSI:${r1h.rsi.toFixed(0)}` : '  1H  N/A',
        r4h ? `  4H  ${_biasT(r4h.bias)}  ADX:${r4h.adxVal.toFixed(0)}  RSI:${r4h.rsi.toFixed(0)}` : '  4H  N/A',
        r1d ? `  1D  ${_biasT(r1d.bias)}  ADX:${r1d.adxVal.toFixed(0)}  RSI:${r1d.rsi.toFixed(0)}` : '  1D  N/A',
        BAR,
        '  KEY LEVELS (4H)',
        _row('RES',    resistance ? `$${_px(coin,resistance)}` : 'N/A', `+${resDistPct}`),
        _row('SUP',    support    ? `$${_px(coin,support)}`    : 'N/A', `-${supDistPct}`),
      ];
      if (patterns4h.length) {
        rows.push(BAR, '  PATTERNS (4H)');
        patterns4h.slice(0,3).forEach(p => {
          const d = p.direction==='bullish'?'▲':p.direction==='bearish'?'▼':'◈';
          rows.push(`  ${d} ${p.name}  [${p.strength.toUpperCase()}]`);
        });
      }
      rows.push(BAR);
      rows.push(_row('SCALP',  scalpBias));
      rows.push(_row('SWING',  swingBias));

      return _hdr(`RESEARCH · ${coin}`) + '\n' + _blk(rows);
    } catch(e) {
      return `<pre>research error: ${e.message}</pre>`;
    }
  }

  if (cmd === '/trend') {
    const coin = (arg || 'BTC').toUpperCase();
    try {
      const { r1h, r4h, r1d, aligned, price, divs4h } = await analyzeTrend(coin);
      return _hdr(`TREND · ${coin}`) + '\n' + _blk([
        _row('PRICE', `$${_px(coin,price)}`),
        _row('ALIGN', aligned, _biasT(aligned.includes('BULL')?'BULL':aligned.includes('BEAR')?'BEAR':'NEUTRAL')),
        BAR,
        r1h ? `  1H  ${_biasT(r1h.bias)}  ADX:${r1h.adxVal.toFixed(0).padStart(2)} ${_adxStr(r1h.adxVal).padEnd(6)}  RSI:${r1h.rsi.toFixed(0)}` : '  1H  N/A',
        r4h ? `  4H  ${_biasT(r4h.bias)}  ADX:${r4h.adxVal.toFixed(0).padStart(2)} ${_adxStr(r4h.adxVal).padEnd(6)}  RSI:${r4h.rsi.toFixed(0)}` : '  4H  N/A',
        r1d ? `  1D  ${_biasT(r1d.bias)}  ADX:${r1d.adxVal.toFixed(0).padStart(2)} ${_adxStr(r1d.adxVal).padEnd(6)}  RSI:${r1d.rsi.toFixed(0)}` : '  1D  N/A',
        ...(divs4h.length ? [BAR, '  DIVERGENCES', ...divs4h.map(d=>`  ${d.type==='BEARISH'?'▼':'▲'} ${d.label}  [${d.strength.toUpperCase()}]`)] : []),
        ...(r4h?.breakout ? [BAR, _row('BREAK', r4h.breakout.type, `$${r4h.breakout.level.toFixed(2)}`)] : []),
      ]);
    } catch(e) {
      return `<pre>trend error ${coin}: ${e.message}</pre>`;
    }
  }

  if (cmd === '/price') {
    const coin = (arg || 'BTC').toUpperCase();
    try {
      const [candles4h, candles1h, hlFunding] = await Promise.all([
        getCandles(coin, '4h', 30),
        getCandles(coin, '1h', 3),
        getFundingRates(),
      ]);

      const closes1h = candles1h.map(c => parseFloat(c.c));
      const rsiArr = iRSI(closes1h).filter(v => v !== null);
      const rsi = rsiArr.at(-1) ?? 50;
      const price = closes1h.at(-1) ?? 0;

      const funding = hlFunding[coin]?.fundingRate ?? 0;
      const oi = hlFunding[coin]?.openInterest ?? 0;
      const fundingPct = (funding * 100).toFixed(4);

      const patterns = detectCandlePatterns(candles4h);

      const fundLabel = parseFloat(fundingPct) > 0.03 ? 'high' : parseFloat(fundingPct) < 0 ? 'neg' : 'ok';

      return _hdr(`PRICE · ${coin}`) + '\n' + _blk([
        _row('PRICE', `$${_px(coin,price)}`),
        _row('RSI_1H', rsi.toFixed(1), _rsiT(rsi)),
        _row('FUND_8H', fundingPct+'%', fundLabel==='high'?'[HIGH]':fundLabel==='neg'?'[NEG→BULL]':'[OK]'),
        _row('OI', _fmtM(oi)),
        BAR,
        '  PATTERNS (4H)',
        ...(patterns.length ? patterns.map(p => {
          const d = p.direction==='bullish'?'▲':p.direction==='bearish'?'▼':'◈';
          return `  ${d} ${p.name}${p.volMult?'  VOL×'+p.volMult.toFixed(1):''}  [${p.strength.toUpperCase()}]`;
        }) : ['  NONE']),
      ]);
    } catch (e) {
      return `<pre>price error ${coin}: ${e.message}</pre>`;
    }
  }

  if (cmd === '/status') {
    const [hlFunding, fg, cgLiq] = await Promise.all([
      getFundingRates(),
      getFearGreed(),
      getCoinGlassLiq(env.COINGLASS_KEY, 'BTCUSDT'),
    ]);
    const btcFunding = (((hlFunding['BTC']?.fundingRate) ?? 0) * 100).toFixed(4);
    const btcOI   = hlFunding['BTC']?.openInterest ?? 0;
    const fundLabel = parseFloat(btcFunding) > 0.03 ? 'high' : parseFloat(btcFunding) < 0 ? 'neg' : 'ok';

    return _hdr(`STATUS`) + '\n' + _blk([
      _row('TIME',   new Date().toUTCString().slice(0,16)),
      _row('F_G',    `${fg.value}/100`, fg.value>75?'[EXTREME GREED]':fg.value>55?'[GREED]':fg.value<25?'[FEAR]':'[NEUTRAL]'),
      _row('BTC_FND', btcFunding+'%', fundLabel==='high'?'[HIGH]':fundLabel==='neg'?'[NEG→BULL]':'[OK]'),
      _row('BTC_OI',  _fmtM(btcOI)),
      ...(cgLiq ? [_row('LIQ_24H', `L:${_fmtM(cgLiq.longs)} S:${_fmtM(cgLiq.shorts)}`)] : []),
      BAR,
      '  SCAN COINS: ' + coins.join(' '),
      `  GATES  FG>${env.FG_GREED_GATE||80}=caution  FUND>${env.MAX_FUNDING||'0.0020'}=skip`,
      '  CRONS  15m:signal/arb  4h:rev/trend  00:00:snap',
    ]);
  }

  if (cmd === '/hl') {
    const style = ['thread', 'post', 'digest'].includes(arg.toLowerCase()) ? arg.toLowerCase() : 'digest';
    try {
      const text = await draftHL(env, style);
      const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return _hdr(`HL PULSE · ${style.toUpperCase()}`) + `\n<pre>${esc}</pre>`;
    } catch (e) {
      return `<pre>hl draft error: ${e.message}</pre>`;
    }
  }

  return _hdr('ERROR') + '\n<pre>  unknown command\n  /help for menu</pre>';
}

// ── HL Pulse — Hyperliquid ecosystem news digest (Workers AI) ─────────────────

function _hlpMatch(txt = '') {
  return /hyperliquid|hyperevm|hypercore|hyperbft|hyperunit|\bhip-\d+/i.test(txt) || /\$HYPE\b|\bHYPE\b/.test(txt);
}

async function getHLNews(limit = 12) {
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

async function getHLStats() {
  const stats = {};
  try {
    const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
    const idx = meta.universe.findIndex(u => u.name === 'HYPE');
    const c = idx >= 0 ? ctxs[idx] : null;
    if (c) {
      stats.hypePx      = parseFloat(c.markPx);
      stats.hype24h     = c.prevDayPx ? (stats.hypePx / parseFloat(c.prevDayPx) - 1) * 100 : null;
      stats.hypeFunding = parseFloat(c.funding);
      stats.hypeOI      = parseFloat(c.openInterest) * stats.hypePx;
    }
    stats.hlVolume24h = ctxs.reduce((s, x) => s + (parseFloat(x.dayNtlVlm) || 0), 0);
  } catch {}
  try {
    const chains = await fetch('https://api.llama.fi/v2/chains').then(r => r.ok ? r.json() : []);
    stats.evmTvl = chains.filter(ch => /hyperliquid/i.test(ch.name || '')).reduce((s, ch) => s + (ch.tvl || 0), 0) || null;
  } catch {}
  return stats;
}

function _hlpContext(news, stats) {
  const lines = ['HYPERLIQUID ECOSYSTEM SNAPSHOT — ' + new Date().toUTCString().slice(0, 16)];
  if (stats.hypePx != null)      lines.push(`HYPE price: $${stats.hypePx.toFixed(2)}${stats.hype24h != null ? ` (${stats.hype24h >= 0 ? '+' : ''}${stats.hype24h.toFixed(2)}% 24h)` : ''}`);
  if (stats.hypeFunding != null) lines.push(`HYPE funding (8h): ${(stats.hypeFunding * 100).toFixed(4)}%`);
  if (stats.hypeOI)              lines.push(`HYPE open interest: $${_fmtM(stats.hypeOI)}`);
  if (stats.hlVolume24h)         lines.push(`Hyperliquid total perp volume 24h: $${_fmtM(stats.hlVolume24h)}`);
  if (stats.evmTvl)              lines.push(`HyperEVM TVL (DeFiLlama): $${_fmtM(stats.evmTvl)}`);
  if (news.length) {
    lines.push('', 'RECENT HEADLINES:');
    news.forEach(n => lines.push(`- [${n.age} ago] ${n.title}`));
  }
  return lines.join('\n');
}

const HLP_STYLES = {
  thread: 'Write an X (Twitter) thread of 4-6 tweets about what is happening in the Hyperliquid ecosystem right now. Strong hook tweet first, one idea per tweet, numbered "1/", "2/" etc. Each tweet under 270 characters. Plain text, at most one hashtag total.',
  post:   'Write ONE X (Twitter) post (under 270 characters) summarizing the most interesting thing happening in the Hyperliquid ecosystem right now. Strong hook, no hashtag spam.',
  digest: 'Write a concise daily Hyperliquid ecosystem digest: a one-line headline, then 4-6 short bullet points covering price/funding/TVL and the most important headlines, then a one-line takeaway. Under 900 characters total.',
};

const HLP_SYSTEM = 'You are a sharp crypto content writer focused on the Hyperliquid ecosystem (HYPE, HyperCore, HyperEVM). Write in English. Use ONLY facts and numbers from the provided context — never invent data, prices, or events. No financial advice, no "DYOR" boilerplate.';

async function draftHL(env, style = 'digest', context = null) {
  if (!env.AI) throw new Error('AI binding not enabled');
  if (!context) {
    const [news, stats] = await Promise.all([getHLNews(), getHLStats()]);
    context = _hlpContext(news, stats);
  }
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: HLP_SYSTEM },
      { role: 'user', content: `${HLP_STYLES[style] || HLP_STYLES.digest}\n\nCONTEXT:\n${context}` },
    ],
    max_tokens: 800,
  });
  return (result.response || '').trim();
}

async function hlDailyDigest(env) {
  try {
    const [news, stats] = await Promise.all([getHLNews(), getHLStats()]);
    if (!news.length && stats.hypePx == null) return;   // nothing to report
    const text = await draftHL(env, 'digest', _hlpContext(news, stats));
    if (!text) return;
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await tgSend(env.TG_TOKEN, env.TG_CHAT,
      _hdr('HL PULSE · DAILY DRAFT') + `\n<pre>${esc}</pre>\n<i>review &amp; edit before posting · /hl thread for a thread version</i>`);
  } catch (e) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, `<b>hl digest error</b>\n<code>${e.message}</code>`).catch(() => {});
  }
}

// ── Daily Brief / Weekly Research ─────────────────────────────────────────────

const BRIEF_SYSTEM = 'You are a Hyperliquid (HYPE) market analyst. Use ONLY the facts and numbers given in the context — never invent data. Write neutral, analytical English. No financial advice, no hype-speak, no "DYOR" boilerplate.';

function _isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function _extractJSON(text) {
  const match = (text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object in model response: ${(text || '').slice(0, 80)}`);
  return JSON.parse(match[0]);
}

async function draftDailyBrief(env, context) {
  if (!env.AI) throw new Error('AI binding not enabled');
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: BRIEF_SYSTEM },
      { role: 'user', content: `Based on the context below, return ONLY a JSON object with this exact shape:\n` +
        `{"headline":"<one line>","onchain_summary":"<2-3 sentences on price/funding/OI/TVL>",` +
        `"risks":["<short risk>","<short risk>","<short risk>"],"opportunities":["<short opportunity>","<short opportunity>"],` +
        `"news_summary":"<2-3 sentences synthesizing the headlines>","takeaway":"<one neutral, non-advice sentence>"}\n` +
        `No text outside the JSON object.\n\nCONTEXT:\n${context}` },
    ],
    max_tokens: 1000,
  });
  return _extractJSON((result.response || '').trim());
}

async function dailyBrief(env) {
  try {
    const [news, stats, fng, funding] = await Promise.all([
      getHLNews(), getHLStats(), getFearGreed(), getFundingRates(),
    ]);
    const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
    const fundingLines = coins
      .filter(c => funding[c])
      .map(c => `${c} funding(8h): ${_f8(funding[c].fundingRate)}  OI: $${_fmtM(funding[c].openInterest * funding[c].markPx)}`);

    const today = new Date().toISOString().slice(0, 10);
    const lines = [`HYPERLIQUID DAILY BRIEF DATA — ${today}`];
    if (stats.hypePx != null)      lines.push(`HYPE price: $${stats.hypePx.toFixed(2)}${stats.hype24h != null ? ` (${stats.hype24h >= 0 ? '+' : ''}${stats.hype24h.toFixed(2)}% 24h)` : ''}`);
    if (stats.hypeFunding != null) lines.push(`HYPE funding (8h): ${_f8(stats.hypeFunding)}`);
    if (stats.hypeOI)              lines.push(`HYPE open interest: $${_fmtM(stats.hypeOI)}`);
    if (stats.hlVolume24h)         lines.push(`Hyperliquid total perp volume 24h: $${_fmtM(stats.hlVolume24h)}`);
    if (stats.evmTvl)              lines.push(`HyperEVM TVL: $${_fmtM(stats.evmTvl)}`);
    if (fng)                       lines.push(`Fear & Greed Index: ${fng.value} (${fng.label})`);
    if (fundingLines.length)       lines.push('', 'FUNDING / OI BY COIN:', ...fundingLines);
    if (news.length)               lines.push('', 'RECENT HEADLINES:', ...news.map(n => `- [${n.age} ago] ${n.title}`));
    const context = lines.join('\n');

    if (!stats.hypePx && !news.length) return; // nothing to report

    const brief = await draftDailyBrief(env, context);
    const now = Date.now();

    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      await sbUpsert(env.SUPABASE_URL, env.SUPABASE_KEY, 'daily_briefs', [{
        id: `brief-${today}`, date: today, headline: brief.headline,
        onchain_summary: brief.onchain_summary, risks: brief.risks || [],
        opportunities: brief.opportunities || [], news_summary: brief.news_summary,
        takeaway: brief.takeaway, raw_context: context, created_at: now,
      }]);
      // Auto-feed the KB wiki so daily briefs accumulate into the knowledge base
      const tags = coins.filter(c => context.includes(c));
      await sbUpsert(env.SUPABASE_URL, env.SUPABASE_KEY, 'kb_wiki', [{
        id: `kbw-brief-${today}`, category: 'brief', title: brief.headline, summary: brief.takeaway,
        content: `${brief.onchain_summary || ''}\n\nRISKS:\n${(brief.risks || []).map(r => '- ' + r).join('\n')}` +
          `\n\nOPPORTUNITIES:\n${(brief.opportunities || []).map(o => '- ' + o).join('\n')}\n\nNEWS:\n${brief.news_summary || ''}`,
        coins: tags, tags: ['daily-brief'], source: 'daily-brief', created_at: now,
      }]);
    }

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await tgSend(env.TG_TOKEN, env.TG_CHAT,
      _hdr('DAILY BRIEF') + `\n<b>${esc(brief.headline)}</b>\n<pre>${esc(brief.takeaway)}</pre>\n<i>full brief in dashboard → Brief tab</i>`);
  } catch (e) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, `<b>daily brief error</b>\n<code>${e.message}</code>`).catch(() => {});
  }
}

async function draftWeeklyResearch(env, context) {
  if (!env.AI) throw new Error('AI binding not enabled');
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: BRIEF_SYSTEM },
      { role: 'user', content: `Based on a week of daily Hyperliquid briefs below, write a weekly research report. Return ONLY a JSON object with this exact shape:\n` +
        `{"title":"<one line>","summary":"<3-4 sentence executive summary>","market_structure":"<2-4 sentences>",` +
        `"onchain_trends":"<2-4 sentences>","risks":["<risk>","<risk>","<risk>"],"opportunities":["<opportunity>","<opportunity>"],` +
        `"outlook":"<2-3 sentence forward-looking, non-financial-advice outlook>"}\n` +
        `No text outside the JSON object.\n\nWEEK CONTEXT:\n${context}` },
    ],
    max_tokens: 1400,
  });
  return _extractJSON((result.response || '').trim());
}

async function weeklyResearch(env) {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const rows = await sbSelect(env.SUPABASE_URL, env.SUPABASE_KEY, 'daily_briefs',
      `select=*&date=gte.${since}&order=date.asc`);
    if (!rows.length) return;

    const context = rows.map(r =>
      `### ${r.date} — ${r.headline}\n${r.onchain_summary || ''}\n` +
      `Risks: ${(r.risks || []).join('; ')}\nOpportunities: ${(r.opportunities || []).join('; ')}\nTakeaway: ${r.takeaway || ''}`
    ).join('\n\n');

    const report = await draftWeeklyResearch(env, context);
    const now = Date.now();
    const weekId = _isoWeek(new Date());

    await sbUpsert(env.SUPABASE_URL, env.SUPABASE_KEY, 'weekly_research', [{
      id: `wr-${weekId}`, week_start: rows[0].date, week_end: rows[rows.length - 1].date,
      title: report.title, summary: report.summary,
      market_structure: report.market_structure, onchain_trends: report.onchain_trends,
      risks: report.risks || [], opportunities: report.opportunities || [],
      outlook: report.outlook, created_at: now,
    }]);

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await tgSend(env.TG_TOKEN, env.TG_CHAT,
      _hdr('WEEKLY RESEARCH') + `\n<b>${esc(report.title)}</b>\n<pre>${esc(report.summary)}</pre>\n<i>full report in dashboard → Research tab</i>`);
  } catch (e) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, `<b>weekly research error</b>\n<code>${e.message}</code>`).catch(() => {});
  }
}

// ── Request Handler ───────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    if (cron === '*/15 * * * *') {
      const minute = new Date().getMinutes();
      if (minute % 30 < 15) {
        ctx.waitUntil(checkSignals(env));
        ctx.waitUntil(checkFundingFlips(env));
        ctx.waitUntil(checkPriceAlerts(env));
      } else {
        ctx.waitUntil(checkFundingArb(env));
      }
    } else if (cron === '0 */4 * * *') {
      ctx.waitUntil(checkReversals(env));
      ctx.waitUntil(checkTrendAlignment(env));
      ctx.waitUntil(checkOISpikes(env));
      ctx.waitUntil(checkLiqCascade(env));
      ctx.waitUntil(checkPositionAdvisor(env));
    } else if (cron === '0 0 * * *') {
      ctx.waitUntil(dailySnapshot(env));
      ctx.waitUntil(hlDailyDigest(env));
      ctx.waitUntil(dailyBrief(env));
      // Sunday (getDay() === 0) → also run weekly review + weekly research
      if (new Date().getDay() === 0) {
        ctx.waitUntil(weeklyReview(env));
        ctx.waitUntil(weeklyResearch(env));
      }
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Telegram webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const msg = body?.message;
      if (msg?.text && msg.chat?.id) {
        const chatId = String(msg.chat.id);
        const parts = msg.text.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase().split('@')[0]; // strip @botname suffix
        const arg = parts.slice(1).join(' ') || '';
        ctx.waitUntil((async () => {
          try {
            const reply = await handleTgCommand(cmd, arg, env, msg);
            if (reply) await tgSend(env.TG_TOKEN, chatId, reply);
          } catch (e) {
            // Surface errors to chat instead of silently dropping them
            await tgSend(env.TG_TOKEN, chatId, `<b>bot error</b>\n<code>${e.message}</code>`).catch(() => {});
          }
        })());
      }
      return new Response('ok');
    }

    // Register webhook (one-time)
    if (url.pathname === '/register-webhook') {
      const workerUrl = `${url.protocol}//${url.host}/webhook`;
      const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: workerUrl, allowed_updates: ['message'] }),
      });
      const data = await r.json();
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    }

    // Manual triggers
    if (url.pathname === '/run-signals')  { ctx.waitUntil(checkSignals(env));   return new Response('Signal check triggered', { status: 202 }); }
    if (url.pathname === '/run-arb')      { ctx.waitUntil(checkFundingArb(env)); return new Response('Arb check triggered', { status: 202 }); }
    if (url.pathname === '/run-snapshot') { ctx.waitUntil(dailySnapshot(env));  return new Response('Snapshot triggered', { status: 202 }); }
    if (url.pathname === '/run-reversals'){ ctx.waitUntil(checkReversals(env));      return new Response('Reversal scan triggered', { status: 202 }); }
    if (url.pathname === '/run-trend')    { ctx.waitUntil(checkTrendAlignment(env)); return new Response('Trend alignment check triggered', { status: 202 }); }
    if (url.pathname === '/run-weekly')   { ctx.waitUntil(weeklyReview(env));        return new Response('Weekly review triggered', { status: 202 }); }
    if (url.pathname === '/run-hl-digest'){ ctx.waitUntil(hlDailyDigest(env));       return new Response('HL digest triggered', { status: 202 }); }
    if (url.pathname === '/run-daily-brief')     { ctx.waitUntil(dailyBrief(env));      return new Response('Daily brief triggered', { status: 202 }); }
    if (url.pathname === '/run-weekly-research') { ctx.waitUntil(weeklyResearch(env));  return new Response('Weekly research triggered', { status: 202 }); }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Debug — check env bindings + Telegram webhook status ──────────────────
    if (url.pathname === '/debug') {
      const envCheck = {
        TG_TOKEN:      !!env.TG_TOKEN,
        TG_CHAT:       !!env.TG_CHAT,
        WALLET:        !!env.WALLET,
        SUPABASE_URL:  !!env.SUPABASE_URL,
        SUPABASE_KEY:  !!env.SUPABASE_KEY,
        COINGLASS_KEY: !!env.COINGLASS_KEY,
        ALERT_STATE_KV: !!env.ALERT_STATE,
        AI_BINDING:    !!env.AI,
      };
      let webhookInfo = null;
      try {
        const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getWebhookInfo`);
        webhookInfo = await r.json();
      } catch (e) {
        webhookInfo = { error: e.message };
      }
      // KV read test
      let kvTest = 'ok';
      try {
        await env.ALERT_STATE.get('__debug_probe__');
      } catch (e) {
        kvTest = `ERROR: ${e.message}`;
      }
      return new Response(JSON.stringify({ envCheck, webhookInfo, kvTest }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── HL Pulse draft (Cloudflare Workers AI — free) ──────────────────────────
    if (url.pathname === '/draft-hl') {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST' } });
      if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
      if (!env.AI) return new Response(JSON.stringify({ error: 'AI binding not enabled — add [ai] to wrangler-bot.toml and redeploy' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });

      const body = await request.json().catch(() => ({}));
      try {
        const text = await draftHL(env, body.style || 'digest', typeof body.context === 'string' ? body.context.slice(0, 6000) : null);
        return new Response(JSON.stringify({ text }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    // ── News Analysis (Cloudflare Workers AI — free) ──────────────────────────
    if (url.pathname === '/analyze-news') {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST' } });
      if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
      if (!env.AI) return new Response(JSON.stringify({ error: 'AI binding not enabled — add [ai] to wrangler-bot.toml and redeploy' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });

      const body = await request.json().catch(() => ({}));
      const articles = (body.articles || []).slice(0, 10);
      if (!articles.length) return new Response(JSON.stringify({ analyses: [] }), { headers: { ...cors, 'Content-Type': 'application/json' } });

      const numbered = articles.map((a, i) => `${i + 1}. [${a.id}] ${a.title}. ${(a.excerpt || '').slice(0, 120)}`).join('\n');

      const system = `You are a crypto market analyst. For each headline return a JSON array:
[{"id":"same as input","sentiment":"BULL"|"BEAR"|"NEUTRAL","coins":["BTC"],"reasoning":"<90 chars, plain english mechanism","timeframe":"immediate"|"short-term"|"long-term"}]
BULL=likely price positive, BEAR=likely price negative, NEUTRAL=minimal impact.
immediate=hours, short-term=days-weeks, long-term=months+.
coins=up to 4 most impacted tickers. Return ONLY the JSON array, no other text.`;

      try {
        const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Analyse ${articles.length} articles:\n${numbered}` },
          ],
          max_tokens: 1024,
        });
        const text = (result.response || '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error(`No JSON array in model response: ${text.slice(0, 80)}`);
        const analyses = JSON.parse(match[0]);
        return new Response(JSON.stringify({ analyses }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, analyses: [] }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(
      'Hype Bot Worker\n\nEndpoints:\n  /run-signals\n  /run-arb\n  /run-snapshot\n  /run-reversals\n  /run-trend\n  /run-weekly\n  /run-hl-digest\n  /run-daily-brief\n  /run-weekly-research\n  /register-webhook\n  /analyze-news\n  /draft-hl\n  /health',
      { status: 200 }
    );
  },
};
