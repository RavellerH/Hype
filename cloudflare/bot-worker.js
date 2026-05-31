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
      ? (s / total > 0.65 ? '🟢 Short squeeze' : s / total < 0.35 ? '🔴 Long flush' : '⚪ Balanced')
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

// ── Formatting Helpers ────────────────────────────────────────────────────────

const _px  = (coin, p) => coin === 'BTC' ? (+p).toFixed(0) : +p >= 100 ? (+p).toFixed(2) : (+p).toFixed(4);
const _f8  = r => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`;
const _fmtM = n => n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${(+n).toFixed(0)}`;
const _adxStr = v => v > 40 ? 'STRONG' : v > 25 ? 'TREND' : 'RANGE';
const _hr = (n = 30) => '─'.repeat(n);

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

  if (aboveEma20) { score += 2; signals.push('EMA20✓'); }
  if (aboveEma50) { score += 2; signals.push('EMA50✓'); }
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
          text: `⚠ SIGNAL ${dir} ${coin}  ${score}/10  ${verdict}  F&G ${fg.value}\n` +
            `$${_px(coin,price)} · RSI ${rsi.toFixed(1)} · ${_f8(funding)} · OI ${_fmtM(oi)}\n` +
            `${signals.join('  ')} · reduce size`,
        });
        continue;
      }

      alerts.push({
        kvKey,
        text: `SIGNAL ${dir} ${coin}  ${score}/10  ${verdict}\n` +
          `$${_px(coin,price)} · RSI ${rsi.toFixed(1)} · ${_f8(funding)} · OI ${_fmtM(oi)}\n` +
          `${signals.join('  ')}`,
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

      const patternLines = patterns.map(p => {
        const dir = p.direction === 'bullish' ? '▲' : p.direction === 'bearish' ? '▼' : '◈';
        const vol = p.volRatio ? `  vol×${p.volRatio.toFixed(1)}` : '';
        return `${dir} ${p.name}${vol}  ${p.strength}`;
      }).join('\n');

      const bearCount = patterns.filter(p => p.direction === 'bearish').length;
      const overallDir = bearCount > patterns.filter(p => p.direction === 'bullish').length ? '▼' : '▲';

      alerts.push({
        kvKey,
        text: `REVERSAL ${overallDir} ${coin} · 4h · $${_px(coin,price)}  RSI ${rsi.toFixed(1)}\n` +
          `${_hr(32)}\n` +
          patternLines,
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
      const { aligned, bullCount, bearCount, divs4h, price, r4h } = await analyzeTrend(coin);

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
          text: `RSI DIV ${dir} ${coin} · 4h\n` +
            `${d.label}  ${d.strength}\n` +
            `$${_px(coin,price)} · RSI ${r4h?.rsi?.toFixed(1)} · ${aligned}`,
        });
      }

      if (hasAlignAlert) {
        const dir = aligned === 'FULL BULL' ? '▲' : '▼';
        const adxLine = r4h ? `ADX ${r4h.adxVal.toFixed(0)} (${_adxStr(r4h.adxVal)})` : '';
        alerts.push({
          key: kvKey,
          text: `TREND FLIP ${dir} ${coin}\n` +
            `1h + 4h + 1d → ${aligned}\n` +
            `$${_px(coin,price)} · ${adxLine}`,
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
        text: `ARB ${coin}  ${(best.spread*100).toFixed(4)}%  ~${(best.spread*3*365*100).toFixed(1)}% APR\n` +
          `HL ${_f8(hl)}  ·  ${best.ex} ${_f8(best.other)}`,
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
  const posLines = positions.map(p => {
    const dir = p.size > 0 ? '▲' : '▼';
    const side = p.size > 0 ? 'LONG' : 'SHORT';
    const pnlSign = p.unrealizedPnl >= 0 ? '+' : '';
    const liqStr = p.liquidationPx ? `  liq $${p.liquidationPx.toFixed(2)}` : '';
    return `${dir} ${p.coin}  ${p.leverage}x  ${side}  entry $${p.entryPx.toFixed(2)}  PnL ${pnlSign}$${p.unrealizedPnl.toFixed(2)}${liqStr}`;
  }).join('\n') || '  —';

  const pnlSign = totalPnl >= 0 ? '+' : '';
  await tgSend(env.TG_TOKEN, env.TG_CHAT,
    `SNAP ${new Date(now).toISOString().slice(0,10)}\n` +
    `NAV $${accountValue.toFixed(2)}  ·  uPnL ${pnlSign}$${totalPnl.toFixed(2)}\n` +
    `${_hr(30)}\n` +
    posLines
  );
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
      const pctStr = `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
      alerts.push({
        kvKey,
        text: `OI ${type} ${dir} ${coin}  ${pctStr}\n` +
          `${_fmtM(oi * markPx)}  ·  prev ${_fmtM(prevOI * markPx)}\n` +
          `fund ${_f8(rate)}`,
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
        text: `FUND FLIP ${dir} ${coin}\n` +
          `${fromLabel} → ${toLabel}  ${_f8(rate)}\n` +
          `$${_px(coin, markPx)}`,
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
        text: `LIQ CASCADE ${dir} ${name}  ${_fmtM(liq.longs + liq.shorts)}\n` +
          `longs ${_fmtM(liq.longs)}  ·  shorts ${_fmtM(liq.shorts)}\n` +
          `${liq.bias}`,
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

async function handleTgCommand(cmd, arg, env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());

  if (cmd === '/start' || cmd === '/help') {
    return `<b>HYPE-BOT</b>\n` +
      `${_hr(28)}\n` +
      `/signals          TA scan now\n` +
      `/snapshot         portfolio state\n` +
      `/positions        open positions\n` +
      `/trend [coin]     1h/4h/1d · ADX · ST · struct\n` +
      `/price [coin]     price · RSI · funding · patterns\n` +
      `/arb              funding spread scan\n` +
      `/status           market pulse\n` +
      `/help             this menu\n` +
      `${_hr(28)}\n` +
      `<b>auto-alerts</b>\n` +
      `signal    15m scan  ·  4h cooldown\n` +
      `fund flip 15m scan  ·  4h cooldown\n` +
      `reversal  4h close  ·  12h cooldown\n` +
      `OI spike  4h scan   ·  12h cooldown\n` +
      `liq       4h scan   ·  12h cooldown\n` +
      `flip      all-TF alignment change\n` +
      `arb       15m scan  ·  4h cooldown\n` +
      `snap      00:00 UTC daily\n` +
      `review    Sunday 00:00 UTC`;
  }

  if (cmd === '/signals') {
    const count = await checkSignals(env);
    return count > 0 ? `scan done · ${count} alert(s) above` : `scan done · no ENTRY/STRONG signals (cooldown or filtered)`;
  }

  if (cmd === '/arb') {
    const count = await checkFundingArb(env);
    return count > 0 ? `arb scan · ${count} spread(s) above` : `arb scan · no spreads above threshold`;
  }

  if (cmd === '/snapshot') {
    await dailySnapshot(env);
    return null;
  }

  if (cmd === '/positions') {
    if (!env.WALLET) return 'WALLET secret not set';
    const { positions, accountValue } = await getPortfolioState(env.WALLET);
    const totalPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
    if (!positions.length) return `POSITIONS · NAV $${accountValue.toFixed(2)}\n—`;
    const lines = positions.map(p => {
      const dir = p.size > 0 ? '▲' : '▼';
      const side = p.size > 0 ? 'LONG' : 'SHORT';
      const pnlSign = p.unrealizedPnl >= 0 ? '+' : '';
      const liqStr = p.liquidationPx ? `  liq $${p.liquidationPx.toFixed(2)}` : '';
      return `${dir} ${p.coin}  ${p.leverage}x  ${side}\n  entry $${p.entryPx.toFixed(2)}  ·  PnL ${pnlSign}$${p.unrealizedPnl.toFixed(2)}${liqStr}`;
    }).join('\n');
    const uPnlSign = totalPnl >= 0 ? '+' : '';
    return `POSITIONS · NAV $${accountValue.toFixed(2)}  uPnL ${uPnlSign}$${totalPnl.toFixed(2)}\n${_hr(32)}\n${lines}`;
  }

  if (cmd === '/trend') {
    const coin = (arg || 'BTC').toUpperCase();
    try {
      const { r1h, r4h, r1d, aligned, price, divs4h } = await analyzeTrend(coin);
      const tfRow = (r, label) => {
        if (!r) return `${label}  —`;
        const bias = r.bias === 'BULL' ? '▲' : r.bias === 'BEAR' ? '▼' : '◈';
        const st   = r.stBull ? '↑ST' : '↓ST';
        const str  = r.structure === 'UPTREND' ? 'HH/HL' : r.structure === 'DOWNTREND' ? 'LH/LL' : r.structure.slice(0,4);
        return `${label}  ${bias} ${r.bias.padEnd(4)}  ADX ${r.adxVal.toFixed(0)} ${_adxStr(r.adxVal).padEnd(6)}  ${st}  ${str}  RSI ${r.rsi.toFixed(0)}`;
      };
      const alignDir = aligned.includes('BULL') ? '▲' : aligned.includes('BEAR') ? '▼' : '◈';
      const divLine  = divs4h.length
        ? divs4h.map(d => `${d.type==='BEARISH'?'▼':'▲'} ${d.label}  ${d.strength}`).join('\n')
        : 'none';
      const breakLine = r4h?.breakout ? `\nBREAK  ${r4h.breakout.type}  $${r4h.breakout.level.toFixed(2)}` : '';
      return `TREND · ${coin} · $${_px(coin,price)}\n` +
        `${_hr(36)}\n` +
        `<code>${tfRow(r1h,'1h')}\n${tfRow(r4h,'4h')}\n${tfRow(r1d,'1d')}</code>\n` +
        `${_hr(36)}\n` +
        `ALIGN  ${alignDir} ${aligned}\n` +
        `4h DIV  ${divLine}` +
        breakLine;
    } catch(e) {
      return `trend error ${coin}: ${e.message}`;
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
      const patternLines = patterns.length
        ? patterns.map(p => {
            const dir = p.direction === 'bullish' ? '▲' : p.direction === 'bearish' ? '▼' : '◈';
            const vol = p.volMult ? `  vol×${p.volMult.toFixed(1)}` : '';
            return `${dir} ${p.name}${vol}  ${p.strength}`;
          }).join('\n')
        : '  —';

      const fundLabel = parseFloat(fundingPct) > 0.03 ? 'high' : parseFloat(fundingPct) < 0 ? 'neg' : 'ok';
      const rsiLabel  = rsi > 70 ? 'OB' : rsi < 30 ? 'OS' : 'ok';
      return `${coin} · $${_px(coin,price)}\n` +
        `${_hr(28)}\n` +
        `RSI 1h    ${rsi.toFixed(1)}  ${rsiLabel}\n` +
        `Fund 8h   ${fundingPct}%  ${fundLabel}\n` +
        `OI        ${_fmtM(oi)}\n` +
        `${_hr(28)}\n` +
        `4h Patterns\n${patternLines}`;
    } catch (e) {
      return `price error ${coin}: ${e.message}`;
    }
  }

  if (cmd === '/status') {
    const [hlFunding, fg, cgLiq, storedBtcOIStr, storedEthOIStr] = await Promise.all([
      getFundingRates(),
      getFearGreed(),
      getCoinGlassLiq(env.COINGLASS_KEY, 'BTCUSDT'),
      env.ALERT_STATE.get('oi:BTC'),
      env.ALERT_STATE.get('oi:ETH'),
    ]);
    const btcFunding = (((hlFunding['BTC']?.fundingRate) ?? 0) * 100).toFixed(4);
    const liqLine = cgLiq
      ? `liq 24h   L ${_fmtM(cgLiq.longs)} / S ${_fmtM(cgLiq.shorts)}  ${cgLiq.bias}\n`
      : '';
    const btcOI   = hlFunding['BTC']?.openInterest ?? 0;
    const fundLabel = parseFloat(btcFunding) > 0.03 ? 'high' : parseFloat(btcFunding) < 0 ? 'neg' : 'ok';
    const btcMarkPx = hlFunding['BTC']?.markPx ?? 0;
    const ethMarkPx = hlFunding['ETH']?.markPx ?? 0;
    const oiKvLine = (storedBtcOIStr || storedEthOIStr)
      ? `OI KV     BTC ${storedBtcOIStr ? _fmtM(parseFloat(storedBtcOIStr) * btcMarkPx) : '—'}  ·  ETH ${storedEthOIStr ? _fmtM(parseFloat(storedEthOIStr) * ethMarkPx) : '—'}\n`
      : '';
    return `STATUS · ${new Date().toUTCString().slice(0,16)}\n` +
      `${_hr(32)}\n` +
      `F&G       ${fg.value}  ${fg.label}\n` +
      `BTC fund  ${btcFunding}%  ${fundLabel}\n` +
      `BTC OI    ${_fmtM(btcOI)}\n` +
      liqLine +
      oiKvLine +
      `${_hr(32)}\n` +
      `scan   ${coins.join(' ')}\n` +
      `gate   F&G>${env.FG_GREED_GATE||80}=caution  ·  fund>${env.MAX_FUNDING||'0.0020'}=skip\n` +
      `crons  15m signal/arb  ·  4h rev/trend  ·  00:00 snap`;
  }

  return `unknown command · /help for menu`;
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
      } else {
        ctx.waitUntil(checkFundingArb(env));
      }
    } else if (cron === '0 */4 * * *') {
      ctx.waitUntil(checkReversals(env));
      ctx.waitUntil(checkTrendAlignment(env));
      ctx.waitUntil(checkOISpikes(env));
      ctx.waitUntil(checkLiqCascade(env));
    } else if (cron === '0 0 * * *') {
      ctx.waitUntil(dailySnapshot(env));
      // Sunday (getDay() === 0) → also run weekly review
      if (new Date().getDay() === 0) ctx.waitUntil(weeklyReview(env));
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
        const arg = parts[1] || '';
        ctx.waitUntil((async () => {
          const reply = await handleTgCommand(cmd, arg, env);
          if (reply) await tgSend(env.TG_TOKEN, chatId, reply);
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
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      'Hype Bot Worker\n\nEndpoints:\n  /run-signals\n  /run-arb\n  /run-snapshot\n  /run-reversals\n  /run-trend\n  /run-weekly\n  /register-webhook\n  /health',
      { status: 200 }
    );
  },
};
