# Hype Bot — Cloudflare Worker

Autonomous Telegram alert bot running on Cloudflare Workers. No VPS required.

**File:** `cloudflare/bot-worker.js` (1089 lines)  
**Config:** `cloudflare/wrangler-bot.toml`

---

## Cron Schedule

| Trigger | What runs |
|---|---|
| `*/15 * * * *` (odd 15-min window) | `checkSignals` + `checkFundingFlips` |
| `*/15 * * * *` (even 15-min window) | `checkFundingArb` |
| `0 */4 * * *` | `checkReversals` + `checkTrendAlignment` + `checkOISpikes` + `checkLiqCascade` |
| `0 0 * * *` | `dailySnapshot` |
| `0 0 * * 0` | `weeklyReview` (Sunday midnight UTC) |

The 15-min cron alternates between signal/flip and arb every 15 minutes using `new Date().getMinutes() % 30`.

---

## Alert Functions

### `checkSignals`
- Coins: `SIGNAL_COINS` env var (default: BTC, ETH, SOL, HYPE, SUI)
- Fetches 1h candles (3 days), funding rates, Fear & Greed
- Score 0–10 based on: EMA20/50 alignment, MACD cross, RSI zone, funding gate, F&G sentiment gate
- **Gates:** skips coin if 8h funding > `MAX_FUNDING` (0.0020 default) or F&G > `FG_GREED_GATE` (80)
- Fires alert if score ≥ 7 (ENTRY) or ≥ 6 with strong confirmation (WATCH)
- **Dedup:** 4h KV cooldown per coin (`signal:{coin}` key)

### `checkFundingFlips`
- Checks current funding sign vs last stored sign in KV (`fund:{coin}:sign`)
- Fires alert on positive→negative or negative→positive flip
- **Dedup:** 4h cooldown (`fund:{coin}:sign` stored with 86400s TTL)

### `checkFundingArb`
- Fetches HL + Binance + Bybit funding for all coins
- Fires if spread between any two exchanges > `ARB_THRESHOLD` (0.001 = 0.1%)
- **Dedup:** 4h cooldown per coin

### `checkReversals` (4h)
- Detects candle patterns on 4h candles: Hammer, Engulfing, Doji, Pin Bar, etc.
- Includes volume multiplier (`volMult = cV / avgVol`) per pattern
- **Dedup:** 12h cooldown

### `checkTrendAlignment` (4h)
- Analyzes 1h/4h/1d trend bias per coin via `analyzeTrend()`
- Each timeframe: Supertrend, ADX, market structure, RSI divergence
- Fires when all 3 TFs align (full BULL or full BEAR)
- Also fires on RSI divergence detection (4h)
- Stores current alignment in KV (`{coin}:bias`) to detect changes

### `checkOISpikes` (4h)
- Fetches current HL open interest per coin
- Compares vs previous stored value (`oi:{coin}` in KV)
- Fires SPIKE alert if OI grew > `OI_SPIKE_PCT` (8%), FLUSH if dropped > 8%
- **Dedup:** 12h cooldown

### `checkLiqCascade` (4h)
- Fetches CoinGlass 4h liquidation data for BTC and ETH (requires `COINGLASS_KEY`)
- Sums total USD liquidated across both
- Fires if total ≥ `LIQ_CASCADE_USD` ($150M default)
- **Dedup:** 12h cooldown

### `dailySnapshot`
- Requires `WALLET` secret
- Fetches portfolio positions + account value
- Upserts to Supabase `hype_snapshots` table (if Supabase configured)
- Sends Telegram summary: NAV, position count, position list

### `weeklyReview`
- Requires `WALLET` secret
- Fetches 7-day fill history
- Sends Telegram review: trade count, total PnL, win rate, best/worst trade

---

## Telegram Commands

| Command | Action |
|---|---|
| `/start` or `/help` | Show command menu with auto-alert schedule |
| `/signals` | Run signal scan now, returns count of alerts fired |
| `/arb` | Run arb scan now |
| `/snapshot` | Run daily snapshot now |
| `/positions` | Show open positions with entry, PnL, liq price |
| `/trend [coin]` | 1h/4h/1d bias · ADX · Supertrend · market structure · RSI |
| `/price [coin]` | Price · RSI · funding rate · OI · 4h candle patterns |
| `/status` | Market pulse: BTC/ETH funding, OI, F&G, liq data |

---

## HTTP Endpoints

All endpoints return immediately; heavy work runs via `ctx.waitUntil()`.

| Endpoint | Method | Action |
|---|---|---|
| `/webhook` | POST | Telegram webhook receiver |
| `/register-webhook` | GET | Auto-registers bot URL with Telegram |
| `/run-signals` | GET | Trigger signal scan (202 response) |
| `/run-arb` | GET | Trigger arb scan (202 response) |
| `/run-snapshot` | GET | Trigger daily snapshot (202 response) |
| `/run-reversals` | GET | Trigger reversal scan (202 response) |
| `/run-trend` | GET | Trigger trend alignment check (202 response) |
| `/run-weekly` | GET | Trigger weekly review (202 response) |
| `/health` | GET | Bot health: timestamp + BTC price |
| `/analyze-news` | POST | AI analysis of news articles (Workers AI) |
| `/` | GET | Endpoint listing |

---

## AI News Analysis (`/analyze-news`)

- **Model:** `@cf/meta/llama-3.1-8b-instruct-fast` via Cloudflare Workers AI (`[ai]` binding)
- **Input:** JSON array of articles `{ id, title, body }`
- **Output:** `{ analyses: [{ id, sentiment, coins, reasoning, timeframe }] }`
- Sentiments: `BULL`, `BEAR`, `NEUTRAL`
- Processes up to 10 articles per request
- Free on Cloudflare Workers free tier (~31k tokens/day)
- CORS headers enabled for browser calls from the dashboard

---

## Secrets (set via `wrangler secret put`)

| Secret | Required | Description |
|---|---|---|
| `WALLET` | Yes (snapshot/positions) | Hyperliquid wallet address |
| `TG_TOKEN` | Yes | Telegram bot token from BotFather |
| `TG_CHAT` | Yes | Telegram chat ID for alerts |
| `SUPABASE_URL` | Optional | Supabase project URL |
| `SUPABASE_KEY` | Optional | Supabase anon key |
| `COINGLASS_KEY` | Optional | CoinGlass API key (liquidation data) |

---

## Environment Variables (`wrangler-bot.toml [vars]`)

| Variable | Default | Description |
|---|---|---|
| `SIGNAL_COINS` | `BTC,ETH,SOL,HYPE,SUI` | Coins to scan for TA signals |
| `ARB_THRESHOLD` | `0.001` | Min 8h funding spread for arb alert (0.1%) |
| `MAX_FUNDING` | `0.0020` | Max HL 8h funding — coins above this excluded from signal alerts |
| `BTC_GATE_PCT` | `-5` | Min BTC 24h% for bullish macro gate (reserved — not yet wired) |
| `FG_GREED_GATE` | `80` | F&G above this adds caution warning to signal alerts |
| `OI_SPIKE_PCT` | `0.08` | OI % change to trigger spike/flush alert (8%) |
| `LIQ_CASCADE_USD` | `150000000` | Total 24h liq in USD to trigger cascade alert ($150M) |

---

## KV Namespace

**Binding:** `ALERT_STATE`  
**ID:** configured in `wrangler-bot.toml [[kv_namespaces]]`

Keys stored:

| Key pattern | TTL | Purpose |
|---|---|---|
| `signal:{coin}` | 4h (14400s) | Signal alert dedup per coin |
| `arb:{coin}` | 4h | Arb alert dedup per coin |
| `reversal:{coin}` | 12h | Reversal/pattern alert dedup |
| `fund:{coin}:sign` | 24h | Last funding sign (pos/neg/flat) for flip detection |
| `oi:{coin}` | 24h | Last OI value for spike detection |
| `{coin}:bias` | 24h | Last TF alignment state (BULL/BEAR/MIXED) |
| `{coin}:div` | 12h | RSI divergence alert dedup |

---

## TA Implementations (in bot-worker.js)

All computed server-side on Cloudflare edge — no external TA library.

| Function | Algorithm |
|---|---|
| `iEMA(arr, p)` | Exponential Moving Average |
| `iMACD(arr, f, s, sig)` | MACD (12/26/9 default) |
| `iRSI(arr, p)` | RSI with Wilder smoothing (14 default) |
| `iATR(highs, lows, closes, p)` | Average True Range |
| `iADX(highs, lows, closes, p)` | ADX + +DI / −DI (Wilder) |
| `iSupertrend(highs, lows, closes, period, mult)` | Supertrend (10/3 default) |
| `detectMarketStructure(candles)` | HH/HL (uptrend), LH/LL (downtrend), NEUTRAL |
| `detectRSIDivergence(closes, p)` | Bullish / bearish divergence |
| `detectCandlePatterns(candles)` | Hammer, Engulfing, Doji, Pin Bar + volMult |
| `avgVolume(candles, period)` | 20-period average volume |

---

## Deployment

```bash
cd cloudflare

# Create KV namespace (one-time)
npx wrangler kv:namespace create ALERT_STATE
# Paste returned ID into wrangler-bot.toml [[kv_namespaces]] id = "..."

# Set secrets (one-time)
npx wrangler secret put WALLET         --config wrangler-bot.toml
npx wrangler secret put TG_TOKEN       --config wrangler-bot.toml
npx wrangler secret put TG_CHAT        --config wrangler-bot.toml
npx wrangler secret put SUPABASE_URL   --config wrangler-bot.toml
npx wrangler secret put SUPABASE_KEY   --config wrangler-bot.toml
npx wrangler secret put COINGLASS_KEY  --config wrangler-bot.toml

# Deploy
npx wrangler deploy --config wrangler-bot.toml

# Register webhook (one-time, open in browser after deploy)
https://hype-bot.<subdomain>.workers.dev/register-webhook
```

---

## Supabase Tables

```sql
-- Snapshot table (daily portfolio snapshots)
CREATE TABLE hype_snapshots (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  ts BIGINT,
  account_value NUMERIC,
  position_count INTEGER,
  positions_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-journal table (closed trades from autojournal.js)
CREATE TABLE hype_journal (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  coin TEXT,
  side TEXT,
  entry_time BIGINT,
  exit_time BIGINT,
  pnl NUMERIC,
  fees NUMERIC,
  net_pnl NUMERIC,
  hold_ms BIGINT,
  tag TEXT,
  notes TEXT,
  lesson TEXT,
  created_at BIGINT,
  source TEXT
);

-- Staged trades table (AI tab)
CREATE TABLE staged_trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  coin TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price NUMERIC, stop_loss NUMERIC, take_profit NUMERIC,
  rationale TEXT, tags TEXT,
  status TEXT DEFAULT 'staged'
);
ALTER TABLE staged_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON staged_trades FOR ALL TO anon USING (true) WITH CHECK (true);
```

---

## BotFather Commands (current)

```
signals - TA scan now
snapshot - portfolio state
positions - open positions
trend - 1h/4h/1d · ADX · ST · struct
price - price · RSI · funding · patterns
arb - funding spread scan
status - market pulse
help - show command menu
```

Update via BotFather → `/setcommands` → select your bot → paste the list.

---

## Message Format

All Telegram messages use terminal-style compact formatting:

- Direction prefixes: `▲` (bullish), `▼` (bearish), `◈` (neutral)
- Dividers: `─` repeated (via `_hr(n)` helper)
- HTML parse mode with `<code>` blocks for tabular data
- Key formatting helpers:
  - `_px(coin, p)` — price decimals by coin (BTC=0, ≥100=2, else 4)
  - `_f8(r)` — funding rate as `±0.0000%`
  - `_fmtM(n)` — millions/billions shorthand (1.2M, 3.4B)
  - `_adxStr(v)` — ADX label (RANGE/TREND/STRONG)
  - `_hr(n)` — horizontal rule of `─` × n
