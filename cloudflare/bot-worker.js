/**
 * Hype Bot Worker — Cloudflare Worker with cron triggers
 *
 * Crons:
 *   every 15 min  — signal scan (TA + funding gate + sentiment gate)
 *   every 15 min  — funding arb scan
 *   every 4h      — reversal pattern scan (4h candle close)
 *   midnight UTC  — daily snapshot → Supabase + Telegram
 *   Sunday midnight — weekly performance review
 *
 * Secrets (wrangler secret put <NAME> --config wrangler-bot.toml):
 *   WALLET, TG_TOKEN, TG_CHAT, SUPABASE_URL, SUPABASE_KEY
 *
 * KV namespace: ALERT_STATE (dedup cooldowns)
 *
 * Env vars ([vars] in wrangler-bot.toml):
 *   SIGNAL_COINS    — default "BTC,ETH,SOL,HYPE,SUI"
 *   ARB_THRESHOLD   — default "0.001" (0.1% 8h spread)
 *   MAX_FUNDING     — default "0.0020" (max HL 8h rate for long signals)
 *   FG_GREED_GATE   — default "80" (skip bullish signals above this F&G)
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
  const volSpike = cV > avgVol * 1.4; // 40% above average

  // ── Bearish Engulfing
  if (pBull && cBear && cO >= pC && cC <= pO && cBody > pBody && volSpike) {
    patterns.push({ name: 'Bearish Engulfing', direction: 'bearish', emoji: '🔴', strength: 'STRONG' });
  }

  // ── Bullish Engulfing
  if (pBear && cBull && cO <= pC && cC >= pO && cBody > pBody && volSpike) {
    patterns.push({ name: 'Bullish Engulfing', direction: 'bullish', emoji: '🟢', strength: 'STRONG' });
  }

  // ── Dark Cloud Cover (bearish 2-candle)
  if (pBull && cBear && cO > pH && cC < (pO + pC) / 2 && cC > pO && volSpike) {
    patterns.push({ name: 'Dark Cloud Cover', direction: 'bearish', emoji: '🌑', strength: 'MEDIUM' });
  }

  // ── Piercing Line (bullish 2-candle)
  if (pBear && cBull && cO < pL && cC > (pO + pC) / 2 && cC < pO && volSpike) {
    patterns.push({ name: 'Piercing Line', direction: 'bullish', emoji: '🌤️', strength: 'MEDIUM' });
  }

  // ── Shooting Star (bearish — upper wick 2× body, small body at bottom)
  if (cBear && cUpperWick >= cBody * 2 && cLowerWick <= cBody * 0.3 && volSpike) {
    patterns.push({ name: 'Shooting Star', direction: 'bearish', emoji: '💫', strength: 'MEDIUM' });
  }

  // ── Hammer (bullish — lower wick 2× body, small body at top)
  if (cBull && cLowerWick >= cBody * 2 && cUpperWick <= cBody * 0.3 && volSpike) {
    patterns.push({ name: 'Hammer', direction: 'bullish', emoji: '🔨', strength: 'MEDIUM' });
  }

  // ── Inverted Hammer (bullish reversal at bottom)
  if (cBull && cUpperWick >= cBody * 2 && cLowerWick <= cBody * 0.3 && pBear && volSpike) {
    patterns.push({ name: 'Inverted Hammer', direction: 'bullish', emoji: '🔁', strength: 'MEDIUM' });
  }

  // ── Doji (open ≈ close, indecision)
  if (cBody <= cRange * 0.1 && cRange > 0 && volSpike) {
    const dojiType = cUpperWick > cLowerWick * 2 ? 'Gravestone Doji ↘' : cLowerWick > cUpperWick * 2 ? 'Dragonfly Doji ↗' : 'Doji';
    patterns.push({ name: dojiType, direction: 'neutral', emoji: '⚖️', strength: 'WATCH' });
  }

  // ── Evening Star (3-candle bearish reversal)
  const p2Bull = p2C > p2O, p1Small = Math.abs(pC - pO) < Math.abs(p2C - p2O) * 0.5;
  if (p2Bull && p1Small && cBear && cC < (p2O + p2C) / 2 && volSpike) {
    patterns.push({ name: 'Evening Star', direction: 'bearish', emoji: '🌆', strength: 'STRONG' });
  }

  // ── Morning Star (3-candle bullish reversal)
  const p2Bear = p2C < p2O;
  if (p2Bear && p1Small && cBull && cC > (p2O + p2C) / 2 && volSpike) {
    patterns.push({ name: 'Morning Star', direction: 'bullish', emoji: '🌅', strength: 'STRONG' });
  }

  // ── Tweezer Top (2-candle — equal highs after uptrend)
  if (pBull && cBear && Math.abs(cH - pH) <= cRange * 0.02) {
    patterns.push({ name: 'Tweezer Top', direction: 'bearish', emoji: '📍', strength: 'MEDIUM' });
  }

  // ── Tweezer Bottom (2-candle — equal lows after downtrend)
  if (pBear && cBull && Math.abs(cL - pL) <= cRange * 0.02) {
    patterns.push({ name: 'Tweezer Bottom', direction: 'bullish', emoji: '📌', strength: 'MEDIUM' });
  }

  // ── EMA Death Cross (EMA20 crosses below EMA50)
  const closes = candles.map(c => parseFloat(c.c));
  if (closes.length >= 52) {
    const ema20 = iEMA(closes, 20);
    const ema50 = iEMA(closes, 50);
    const crossedUnder = ema20.at(-1) < ema50.at(-1) && ema20.at(-2) >= ema50.at(-2);
    const crossedOver  = ema20.at(-1) > ema50.at(-1) && ema20.at(-2) <= ema50.at(-2);
    if (crossedUnder) patterns.push({ name: 'Death Cross (EMA20/50)', direction: 'bearish', emoji: '💀', strength: 'STRONG' });
    if (crossedOver)  patterns.push({ name: 'Golden Cross (EMA20/50)', direction: 'bullish', emoji: '✨', strength: 'STRONG' });
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

  if (aboveEma20) { score += 2; signals.push('EMA20 ✓'); }
  if (aboveEma50) { score += 2; signals.push('EMA50 ✓'); }
  if (macdCross)  { score += 3; signals.push('MACD cross ✓'); }
  else if (macd > 0) { score += 1; signals.push('MACD pos'); }
  if (rsi > 45 && rsi < 75) { score += 2; signals.push(`RSI ${rsi.toFixed(0)}`); }
  if (rsi < 35)  { score += 2; signals.push(`RSI oversold ${rsi.toFixed(0)}`); }
  if (funding8h < 0) { score += 2; signals.push('Neg funding'); }
  else if (funding8h < 0.0005) { score += 1; signals.push('Low funding'); }
  else if (funding8h > 0.002)  { score -= 2; signals.push('High funding ✗'); }

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
      if (greedBlocked) {
        // Still alert but flag sentiment warning
        const fundingPct = (funding * 100).toFixed(4);
        alerts.push({
          kvKey,
          text: `⚠️ <b>${coin} ${verdict} [${score}/10] — SENTIMENT CAUTION</b>\n` +
            `F&G: ${fg.value} (${fg.label}) — extreme greed, bulls at risk\n` +
            `Price: $${price.toFixed(coin === 'BTC' ? 0 : 4)} | RSI: ${rsi.toFixed(1)} | Funding: ${fundingPct}%\n` +
            `Signals: ${signals.join(', ')}`,
        });
        continue;
      }

      const fundingPct = (funding * 100).toFixed(4);
      const emoji = verdict === 'STRONG' ? '🚀' : '📡';
      alerts.push({
        kvKey,
        text: `${emoji} <b>${coin} ${verdict} [${score}/10]</b>\n` +
          `Price: $${price.toFixed(coin === 'BTC' ? 0 : 4)}\n` +
          `RSI: ${rsi.toFixed(1)} | Funding 8h: ${fundingPct}%\n` +
          `F&G: ${fg.value} (${fg.label})\n` +
          `Signals: ${signals.join(', ')}`,
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

      const patternLines = patterns.map(p =>
        `${p.emoji} <b>${p.name}</b> [${p.strength}] — ${p.direction === 'bullish' ? '↗ Bullish reversal' : p.direction === 'bearish' ? '↘ Bearish reversal' : '⚖️ Indecision'}`
      ).join('\n');

      const overallDir = patterns.filter(p => p.direction === 'bearish').length > patterns.filter(p => p.direction === 'bullish').length ? 'bearish' : 'bullish';
      const headerEmoji = overallDir === 'bearish' ? '🔻' : '🔺';

      alerts.push({
        kvKey,
        text: `${headerEmoji} <b>Reversal Signal: ${coin} (4h)</b>\n\n` +
          `${patternLines}\n\n` +
          `Price: $${price.toFixed(coin === 'BTC' ? 0 : 4)} | RSI: ${rsi.toFixed(1)}\n` +
          `<i>Always confirm with higher timeframe before acting.</i>`,
      });
    } catch (_) { /* skip */ }
  }

  for (const alert of alerts) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, alert.text);
    await setCooldown(env.ALERT_STATE, alert.kvKey);
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
        text: `💰 <b>Funding Arb: ${coin}</b>\n` +
          `HL: ${(hl * 100).toFixed(4)}% | ${best.ex}: ${(best.other * 100).toFixed(4)}%\n` +
          `Spread: ${(best.spread * 100).toFixed(4)}% (8h)\n` +
          `Annualised: ~${(best.spread * 3 * 365 * 100).toFixed(1)}% APR`,
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
  const posLines = positions.map(p =>
    `  ${p.size > 0 ? '🟢' : '🔴'} ${p.coin} ${p.size > 0 ? 'LONG' : 'SHORT'} | Entry $${p.entryPx.toFixed(2)} | PnL $${p.unrealizedPnl.toFixed(2)}`
  ).join('\n') || '  (no open positions)';

  await tgSend(env.TG_TOKEN, env.TG_CHAT,
    `📊 <b>Daily Snapshot — ${new Date(now).toISOString().slice(0, 10)}</b>\n\n` +
    `Account: <b>$${accountValue.toFixed(2)}</b>\n` +
    `Unrealized PnL: <b>${totalPnl >= 0 ? '📈' : '📉'} $${totalPnl.toFixed(2)}</b>\n` +
    `Open positions (${positions.length}):\n${posLines}`
  );
}

// ── Weekly Review ─────────────────────────────────────────────────────────────

async function weeklyReview(env) {
  if (!env.WALLET) return;

  const fills = await getRecentFills(env.WALLET, 7);
  if (!fills.length) {
    await tgSend(env.TG_TOKEN, env.TG_CHAT, '📅 <b>Weekly Review</b>\n\nNo fills in the last 7 days.');
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
    .slice(0, 5)
    .map(([coin, pnl]) => `  ${pnl >= 0 ? '✅' : '❌'} ${coin}: $${pnl.toFixed(2)}`)
    .join('\n');

  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '—';
  const net = totalPnl - fees;

  await tgSend(env.TG_TOKEN, env.TG_CHAT,
    `📅 <b>Weekly Review — ${new Date().toISOString().slice(0, 10)}</b>\n\n` +
    `Fills: ${fills.length} | W/L: ${wins}/${losses} | WR: ${wr}%\n` +
    `Gross PnL: $${totalPnl.toFixed(2)} | Fees: $${fees.toFixed(2)}\n` +
    `Net PnL: <b>${net >= 0 ? '📈' : '📉'} $${net.toFixed(2)}</b>\n\n` +
    `Top coins:\n${topCoins}`
  );
}

// ── Telegram Commands ─────────────────────────────────────────────────────────

async function handleTgCommand(cmd, arg, env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());

  if (cmd === '/start' || cmd === '/help') {
    return `🤖 <b>Hype Bot</b>\n\n` +
      `<b>Commands:</b>\n` +
      `/signals — Run signal scan now\n` +
      `/snapshot — Portfolio snapshot\n` +
      `/positions — Open positions detail\n` +
      `/price &lt;coin&gt; — Price + RSI + funding + patterns\n` +
      `/arb — Funding arb check\n` +
      `/status — Bot status\n` +
      `/help — Show this menu\n\n` +
      `<b>Auto alerts:</b>\n` +
      `• Signals every 15 min (4h cooldown)\n` +
      `• Reversal patterns every 4h (12h cooldown)\n` +
      `• Arb every 15 min (4h cooldown)\n` +
      `• Daily snapshot at midnight UTC\n` +
      `• Weekly review every Sunday`;
  }

  if (cmd === '/signals') {
    const count = await checkSignals(env);
    return count > 0 ? `✅ Scan done — ${count} alert(s) sent above` : `📡 Scan done — no entries right now (WATCH/SKIP or on cooldown)`;
  }

  if (cmd === '/arb') {
    const count = await checkFundingArb(env);
    return count > 0 ? `✅ Arb scan — ${count} opportunity(s) sent above` : `💤 Arb scan — no spreads above threshold`;
  }

  if (cmd === '/snapshot') {
    await dailySnapshot(env);
    return null;
  }

  if (cmd === '/positions') {
    if (!env.WALLET) return '❌ WALLET secret not set';
    const { positions, accountValue } = await getPortfolioState(env.WALLET);
    if (!positions.length) return `📭 No open positions\nAccount: $${accountValue.toFixed(2)}`;
    const lines = positions.map(p => {
      const side = p.size > 0 ? '🟢 LONG' : '🔴 SHORT';
      const pnlSign = p.unrealizedPnl >= 0 ? '+' : '';
      return `${side} <b>${p.coin}</b> ${p.leverage}x\nEntry: $${p.entryPx.toFixed(2)} | PnL: ${pnlSign}$${p.unrealizedPnl.toFixed(2)}` +
        (p.liquidationPx ? ` | Liq: $${p.liquidationPx.toFixed(2)}` : '');
    }).join('\n\n');
    return `📂 <b>Open Positions</b>\nAccount: $${accountValue.toFixed(2)}\n\n${lines}`;
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
        ? patterns.map(p => `${p.emoji} ${p.name} [${p.strength}]`).join('\n')
        : '  No patterns detected on 4h';

      return `💹 <b>${coin}</b>\n` +
        `Price: $${price.toFixed(coin === 'BTC' ? 0 : 4)}\n` +
        `RSI (1h): ${rsi.toFixed(1)}\n` +
        `Funding 8h: ${fundingPct}%\n` +
        `OI: $${(oi / 1e6).toFixed(0)}M\n\n` +
        `<b>4h Patterns:</b>\n${patternLines}`;
    } catch (e) {
      return `❌ Could not fetch ${coin}: ${e.message}`;
    }
  }

  if (cmd === '/status') {
    const [hlFunding, fg] = await Promise.all([getFundingRates(), getFearGreed()]);
    const btcFunding = (((hlFunding['BTC']?.fundingRate) ?? 0) * 100).toFixed(4);
    return `⚙️ <b>Bot Status</b>\n\n` +
      `Time: ${new Date().toUTCString()}\n` +
      `F&G: ${fg.value} (${fg.label})\n` +
      `BTC funding 8h: ${btcFunding}%\n` +
      `Watching: ${coins.join(', ')}\n` +
      `Sentiment gate: F&G > ${env.FG_GREED_GATE || 80} = caution mode\n` +
      `Signal threshold: 5/10 | Reversal cooldown: 12h`;
  }

  return `❓ Unknown command. Send /help for the menu.`;
}

// ── Request Handler ───────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    if (cron === '*/15 * * * *') {
      const minute = new Date().getMinutes();
      if (minute % 30 < 15) {
        ctx.waitUntil(checkSignals(env));
      } else {
        ctx.waitUntil(checkFundingArb(env));
      }
    } else if (cron === '0 */4 * * *') {
      ctx.waitUntil(checkReversals(env));
    } else if (cron === '0 0 * * *') {
      ctx.waitUntil(dailySnapshot(env));
    } else if (cron === '0 0 * * 0') {
      ctx.waitUntil(weeklyReview(env));
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
    if (url.pathname === '/run-reversals'){ ctx.waitUntil(checkReversals(env)); return new Response('Reversal scan triggered', { status: 202 }); }
    if (url.pathname === '/run-weekly')   { ctx.waitUntil(weeklyReview(env));   return new Response('Weekly review triggered', { status: 202 }); }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      'Hype Bot Worker\n\nEndpoints:\n  /run-signals\n  /run-arb\n  /run-snapshot\n  /run-reversals\n  /run-weekly\n  /register-webhook\n  /health',
      { status: 200 }
    );
  },
};
