/**
 * Hype Bot Worker — Cloudflare Worker with cron triggers
 *
 * Cron 1 (every 15 min): Signal check — TA + funding gate → Telegram
 * Cron 2 (every 15 min): Funding arb check — HL vs Binance spread → Telegram
 * Cron 3 (midnight UTC): Daily snapshot → Supabase + Telegram summary
 *
 * Secrets (set with: wrangler secret put <NAME>):
 *   WALLET          — Hyperliquid wallet address
 *   TG_TOKEN        — Telegram bot token
 *   TG_CHAT         — Telegram chat ID
 *   SUPABASE_URL    — Supabase project URL
 *   SUPABASE_KEY    — Supabase anon key
 *
 * KV namespace binding: ALERT_STATE (4h dedup cooldown per coin)
 *
 * Env vars (in wrangler-bot.toml [vars]):
 *   SIGNAL_COINS    — comma-separated list, default "BTC,ETH,SOL,HYPE,SUI"
 *   ARB_THRESHOLD   — min spread to alert (annualised 8h rate diff), default "0.001" (0.1%)
 *   MAX_FUNDING     — max HL funding to consider (8h rate), default "0.0020"
 *   BTC_GATE_PCT    — min BTC 24h% for bullish macro gate, default "-5"
 */

// ── TA Helpers (ported from app.js) ─────────────────────────────────────────

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

// ── Hyperliquid API ──────────────────────────────────────────────────────────

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
    };
  });
  return result;
}

async function getPortfolioState(wallet) {
  const [clearingHouse, spotState] = await Promise.all([
    hlPost({ type: 'clearinghouseState', user: wallet }),
    hlPost({ type: 'spotClearinghouseState', user: wallet }),
  ]);
  const positions = (clearingHouse.assetPositions || [])
    .filter(p => parseFloat(p.position.szi) !== 0)
    .map(p => ({
      coin: p.position.coin,
      size: parseFloat(p.position.szi),
      entryPx: parseFloat(p.position.entryPx || 0),
      unrealizedPnl: parseFloat(p.position.unrealizedPnl || 0),
      leverage: parseFloat(p.position.leverage?.value || 1),
    }));
  const accountValue = parseFloat(clearingHouse.marginSummary?.accountValue || 0);
  return { positions, accountValue };
}

// ── Binance API ──────────────────────────────────────────────────────────────

async function getBinanceFunding() {
  const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
  if (!r.ok) return {};
  const data = await r.json();
  const result = {};
  for (const item of data) {
    const sym = item.symbol;
    if (!sym.endsWith('USDT')) continue;
    const coin = sym.slice(0, -4);
    result[coin] = parseFloat(item.lastFundingRate || 0);
  }
  return result;
}

// ── Bybit API ────────────────────────────────────────────────────────────────

async function getBybitFunding() {
  const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
  if (!r.ok) return {};
  const data = await r.json();
  const result = {};
  for (const item of (data.result?.list || [])) {
    if (!item.symbol.endsWith('USDT')) continue;
    const coin = item.symbol.slice(0, -4);
    result[coin] = parseFloat(item.fundingRate || 0);
  }
  return result;
}

// ── Telegram ─────────────────────────────────────────────────────────────────

async function tgSend(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ── Supabase ─────────────────────────────────────────────────────────────────

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

// ── KV dedup helpers ─────────────────────────────────────────────────────────

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

async function isOnCooldown(kv, key) {
  const val = await kv.get(key);
  if (!val) return false;
  return Date.now() - parseInt(val) < COOLDOWN_MS;
}

async function setCooldown(kv, key) {
  await kv.put(key, String(Date.now()), { expirationTtl: COOLDOWN_MS / 1000 });
}

// ── Signal scoring ───────────────────────────────────────────────────────────

function scoreSignals(closes, funding8h) {
  const signals = [];
  let score = 0;

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
  const rsiMid = rsi > 45 && rsi < 75;

  if (aboveEma20) { score += 2; signals.push('EMA20 ✓'); }
  if (aboveEma50) { score += 2; signals.push('EMA50 ✓'); }
  if (macdCross)  { score += 3; signals.push('MACD cross ✓'); }
  else if (macd > 0) { score += 1; signals.push('MACD pos'); }
  if (rsiMid)     { score += 2; signals.push(`RSI ${rsi.toFixed(0)}`); }
  if (rsi < 35)   { score += 2; signals.push(`RSI oversold ${rsi.toFixed(0)}`); }

  // Funding gate: negative or very low = uncrowded longs (bullish)
  if (funding8h < 0) { score += 2; signals.push('Neg funding'); }
  else if (funding8h < 0.0005) { score += 1; signals.push('Low funding'); }
  else if (funding8h > 0.002)  { score -= 2; signals.push('High funding ✗'); }

  const verdict = score >= 7 ? 'STRONG' : score >= 5 ? 'ENTRY' : score >= 3 ? 'WATCH' : 'SKIP';
  return { score, verdict, signals, rsi, macdCross, aboveEma20, aboveEma50 };
}

// ── Check Signals ─────────────────────────────────────────────────────────────

async function checkSignals(env) {
  const coins = (env.SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const maxFunding = parseFloat(env.MAX_FUNDING || '0.0020');

  let [hlFunding] = await Promise.all([getFundingRates()]);

  const alerts = [];

  for (const coin of coins) {
    try {
      const kvKey = `sig:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey)) continue;

      const funding = hlFunding[coin]?.fundingRate ?? 0;
      if (Math.abs(funding) > maxFunding && funding > 0) continue; // skip crowded longs

      const candles = await getCandles(coin, '1h', 3);
      if (candles.length < 50) continue;
      const closes = candles.map(c => parseFloat(c.c));

      const { score, verdict, signals, rsi } = scoreSignals(closes, funding);
      if (verdict === 'SKIP' || verdict === 'WATCH') continue;

      const price = closes.at(-1);
      const fundingPct = (funding * 100).toFixed(4);
      const emoji = verdict === 'STRONG' ? '🚀' : '📡';

      alerts.push({
        kvKey,
        text: `${emoji} <b>${coin} ${verdict}</b> [${score}/10]\n` +
          `Price: $${price.toFixed(coin === 'BTC' ? 0 : 4)}\n` +
          `RSI: ${rsi.toFixed(1)} | Funding 8h: ${fundingPct}%\n` +
          `Signals: ${signals.join(', ')}`,
      });
    } catch (_) { /* skip coin on error */ }
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
    getFundingRates(),
    getBinanceFunding(),
    getBybitFunding(),
  ]);

  const alerts = [];
  const coins = Object.keys(hlFunding);

  for (const coin of coins) {
    try {
      const kvKey = `arb:${coin}`;
      if (await isOnCooldown(env.ALERT_STATE, kvKey)) continue;

      const hl = hlFunding[coin]?.fundingRate ?? 0;
      const bn = bnFunding[coin] ?? null;
      const bb = bbFunding[coin] ?? null;

      const spreads = [];
      if (bn !== null) spreads.push({ ex: 'Binance', spread: Math.abs(hl - bn), hl, other: bn });
      if (bb !== null) spreads.push({ ex: 'Bybit',   spread: Math.abs(hl - bb), hl, other: bb });

      const best = spreads.sort((a, b) => b.spread - a.spread)[0];
      if (!best || best.spread < threshold) continue;

      const hlPct   = (hl * 100).toFixed(4);
      const otherPct = (best.other * 100).toFixed(4);
      const spreadPct = (best.spread * 100).toFixed(4);

      alerts.push({
        kvKey,
        text: `💰 <b>Funding Arb: ${coin}</b>\n` +
          `HL: ${hlPct}% | ${best.ex}: ${otherPct}%\n` +
          `Spread: ${spreadPct}% (8h rate)\n` +
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
  const snapshotRow = {
    id: `snap-${now}`,
    wallet: env.WALLET,
    ts: now,
    account_value: accountValue,
    position_count: positions.length,
    positions_json: JSON.stringify(positions),
  };

  // Persist to Supabase
  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    await sbUpsert(env.SUPABASE_URL, env.SUPABASE_KEY, 'hype_snapshots', [snapshotRow]);
  }

  // Telegram summary
  const totalPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const pnlEmoji = totalPnl >= 0 ? '📈' : '📉';
  const posLines = positions.map(p =>
    `  ${p.size > 0 ? '🟢' : '🔴'} ${p.coin} ${p.size > 0 ? 'LONG' : 'SHORT'} $${p.unrealizedPnl.toFixed(2)}`
  ).join('\n') || '  (no open positions)';

  const date = new Date(now).toISOString().slice(0, 10);
  const msg = `📊 <b>Daily Snapshot — ${date}</b>\n\n` +
    `Account: <b>$${accountValue.toFixed(2)}</b>\n` +
    `Unrealized PnL: <b>${pnlEmoji} $${totalPnl.toFixed(2)}</b>\n` +
    `Open positions (${positions.length}):\n${posLines}`;

  await tgSend(env.TG_TOKEN, env.TG_CHAT, msg);
}

// ── Request Handler ───────────────────────────────────────────────────────────

export default {
  // Cron dispatcher
  async scheduled(event, env, ctx) {
    const cron = event.cron;

    if (cron === '*/15 * * * *') {
      // Alternate between signals and arb on each 15-min tick
      // Use minute to decide: even = signals, odd = arb
      const minute = new Date().getMinutes();
      if (minute % 30 < 15) {
        ctx.waitUntil(checkSignals(env));
      } else {
        ctx.waitUntil(checkFundingArb(env));
      }
    } else if (cron === '0 0 * * *') {
      ctx.waitUntil(dailySnapshot(env));
    }
  },

  // Manual HTTP trigger endpoints
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/run-signals') {
      ctx.waitUntil(checkSignals(env));
      return new Response('Signal check triggered', { status: 202 });
    }
    if (url.pathname === '/run-arb') {
      ctx.waitUntil(checkFundingArb(env));
      return new Response('Arb check triggered', { status: 202 });
    }
    if (url.pathname === '/run-snapshot') {
      ctx.waitUntil(dailySnapshot(env));
      return new Response('Snapshot triggered', { status: 202 });
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Hype Bot Worker\n\nEndpoints:\n  /run-signals\n  /run-arb\n  /run-snapshot\n  /health', {
      status: 200,
    });
  },
};
