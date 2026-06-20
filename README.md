# Hype — Hyperliquid Portfolio Dashboard

A personal trading dashboard for [Hyperliquid](https://hyperliquid.xyz) — live positions, TA signals, on-chain macro intelligence, crypto news, market fundamentals, and AI-assisted trade staging. Runs entirely in the browser with no backend required.

**[→ Open Dashboard](https://ravellerh.github.io/Hype/)**  &nbsp;|&nbsp;  **[→ Documentation](https://ravellerh.github.io/Hype/docs.html)**

---

## Features

| Tab | What it does |
|---|---|
| **Portfolio** | Live positions, spot balances, unrealized PnL, health score, portfolio growth chart |
| **Capital** | Real-time spot vs. perps capital breakdown, allocation bar, historical allocation chart, detailed closed-trade & fee journal (perps) |
| **Trades** | Full fill history (perp + spot), win rate, realized PnL, fee totals |
| **Funding** | Funding payments by coin, daily bar chart, annualized rate per position |
| **Flows** | Deposit/withdrawal ledger with historical IDR exchange rates |
| **Live** | Real-time WebSocket price feed, order book depth, liquidation tracker |
| **Markets** | Top coins by OI, funding rate leaderboard, market dominance |
| **Phases** | Wyckoff phase detection across timeframes (1h / 4h / 1d) |
| **Intel** | Live market intelligence — auto-scored regime, funding, OI, alt breadth, MVRV Z |
| **MVRV** | Bitcoin MVRV Z-Score cycle indicator with beginner guide and AI commentary |
| **AI** | Trade staging (entry/SL/TP, rationale, Supabase persistence) + Claude AI chat |
| **Watchlist** | Monitor any Hyperliquid wallet address |
| **Journal** | Personal trade journal (localStorage) |
| **Indicators** | Fear & Greed, BMSB, Pi Cycle Top |
| **Smart Money** | On-chain whale tracking (Nansen-style) |
| **Analytics** | PnL curve, trade statistics |
| **KB** | Knowledge base / trading notes |
| **Signals** | Multi-factor confluence scanner (funding + CVD + OI + momentum) |
| **News** | Crypto news from 9 sources (CryptoCompare, Messari, Reddit, 6 RSS feeds) with Fear & Greed |
| **HL Pulse** | Hyperliquid ecosystem intel — HL-filtered news, HYPE stats, HyperEVM TVL, top protocols, AI content studio (X threads / posts / digests) |
| **Fundamentals** | Top 100 coins — price, 24h/7d/30d%, market cap, volume, ATH drawdown |
| **DeFi** | DeFiLlama macro dashboard — total TVL, chain dominance, protocol rankings, stablecoin supply |

---

## Quick Start

No install. No build step. Just open:

```
https://ravellerh.github.io/Hype/
```

Enter your Hyperliquid wallet address when prompted. All data is fetched client-side from public APIs.

---

## Architecture

Pure static SPA — zero build step, deployable on GitHub Pages.

```
Hype/
├── index.html          Entry point, tab shell, navigation
├── app.js              Core: portfolio, trades, funding, flows, live, markets, phases
├── intel.js            Live market intelligence (HL + Binance + Bybit + CoinGecko)
├── ai.js               Trade staging (Supabase) + Claude AI chat (Edge Function)
├── fundamentals.js     CoinGecko top 100 market data
├── news.js             Multi-source crypto news aggregator (progressive loading)
├── hlpulse.js          HL Pulse — Hyperliquid ecosystem news, stats, AI content studio
├── ta-signal.js        TA engine: confluence scanner, CVD, OI, signal scoring
├── mvrv-ai.js          MVRV Z-Score + Supabase client + AI commentary
├── analytics.js        PnL analytics, equity curve
├── indicators.js       Fear & Greed, BMSB, Pi Cycle
├── nansen.js           Smart Money wallet tracking
├── journal.js          Trade journal (localStorage)
├── capital.js          Capital — live spot/perps breakdown, allocation history, trade & fee journal
├── kb.js               Knowledge base
├── position-meta.js    Per-position intent / thesis modal
├── logger.js           Data logger & portfolio snapshots
├── signals.js          Confluence scanner UI (+ Binance L/S ratio)
├── defillama.js        DeFiLlama macro dashboard (TVL, stablecoins, chains)
├── arb.js              Funding arb scanner (HL + Binance + Bybit + OKX)
├── cloudflare/         Cloudflare Worker RSS proxy (deploy with wrangler)
├── styles.css          All styles (single file, CSS variables)
├── sw.js               Service worker (PWA caching)
└── docs.html           Documentation
```

**Data sources (all free, no API keys required by default):**
- Hyperliquid REST + WebSocket API
- Binance Futures public API (OI, funding, L/S ratio)
- Bybit public API (funding)
- OKX public API (funding rates — arb scanner)
- Kraken public API (BTC/ETH spot — CoinGecko fallback)
- CoinGecko public API (markets, global stats, trending) — optional demo key for higher limits
- DeFiLlama API (TVL, stablecoins, chain breakdown) — unlimited, no key
- alternative.me (Fear & Greed)
- CryptoCompare, Messari, Reddit (news)
- RSS feeds: CoinDesk, Cointelegraph, Decrypt, CryptoNews, The Block, Bitcoin Magazine
- blockchain.com (on-chain data for MVRV)

**Optional backend (Supabase — free tier):**
- Trade staging persistence (`staged_trades` table)
- Claude AI chat proxy (Edge Function + `ANTHROPIC_API_KEY` secret)

---

## Intel Tab — Live Regime Scoring

The Intel tab auto-fetches and scores the market regime using 7 weighted signals:

| Signal | Weight | Bullish condition |
|---|---|---|
| MVRV Z-Score | 3× | Z < 1 (undervalued) |
| Fear & Greed | 2× | < 35 (fear zone) |
| BTC Funding APR | 2× | < 5% (uncrowded) |
| Altcoin Breadth | 1× | > 65% of top 100 up |
| Global MCap 24h | 1× | > +3% |
| BTC OI Change 24h | 1× | < −8% (flushed) |
| BTC Dominance | 1× | < 50% (alt season) |

Score normalized to ±10 → **BUY / BULL / WAIT / CAUTION / SELL** verdict.

Radar axes (Macro, Cycle, OnChain, Derivs, Funding, Breadth, Sentiment) all computed from live data, refreshed every 3 minutes.

**Claude desk setups:** click "Generate Setups" — Claude receives the full live data context and suggests 2–3 trade setups. Requires the Edge Function to be configured (see AI tab setup).

---

## AI Tab — Trade Staging + Claude Chat

### Trade Staging
Stage trade ideas with coin, direction, entry/stop/target, rationale, and tags. R:R calculated automatically. Status workflow: `staged → watching → executed / cancelled`. Synced to Supabase.

**One-time Supabase setup** — run in Supabase SQL Editor:
```sql
create table staged_trades (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  coin        text        not null,
  direction   text        not null,
  entry_price numeric, stop_loss numeric, take_profit numeric,
  rationale   text, tags text,
  status      text        default 'staged'
);
alter table staged_trades enable row level security;
create policy "anon_all" on staged_trades for all to anon using (true) with check (true);
```

### Claude AI Chat
Your Anthropic API key stays in Supabase — never exposed in the browser.

**One-time Edge Function setup:**
1. Supabase → Edge Functions → New Function → name it `claude-proxy`
2. Paste the code shown in the AI tab's ⚙ Setup panel
3. Supabase → Settings → Secrets → add `ANTHROPIC_API_KEY`
4. Copy the function URL into the AI tab Setup field

---

## Telegram Notifications

Configure in Settings tab. Paste your bot token (from [@BotFather](https://t.me/BotFather)), click "Auto-detect Chat ID", set a PnL threshold. Notifications fire when unrealized PnL moves beyond the threshold.

---

## Cloudflare Bot Worker

A separate cron Worker (`cloudflare/bot-worker.js`) runs autonomously on Cloudflare's edge — no VPS needed.

| Cron | What it does |
|---|---|
| Every 15 min | Signal check: EMA20/50 + MACD cross + RSI + funding gate → Telegram alert per coin (4h cooldown) |
| Every 15 min | Funding arb check: HL vs Binance/Bybit spread > threshold → Telegram alert |
| Midnight UTC | Daily snapshot → Supabase `hype_snapshots` + Telegram portfolio summary, plus capital drawdown-from-peak and spot/perps allocation-drift alerts |

**One-time setup:**
```bash
cd cloudflare

# Create KV namespace for dedup state
npx wrangler kv:namespace create ALERT_STATE
# Copy the returned ID into wrangler-bot.toml [[kv_namespaces]] id = "..."

# Set secrets
npx wrangler secret put WALLET         --config wrangler-bot.toml
npx wrangler secret put TG_TOKEN       --config wrangler-bot.toml
npx wrangler secret put TG_CHAT        --config wrangler-bot.toml
npx wrangler secret put SUPABASE_URL   --config wrangler-bot.toml
npx wrangler secret put SUPABASE_KEY   --config wrangler-bot.toml

# Deploy
npx wrangler deploy --config wrangler-bot.toml
```

**Telegram commands** (after webhook registration):

| Command | Action |
|---|---|
| `/signals` | Run signal scan instantly |
| `/snapshot` | Portfolio snapshot now |
| `/arb` | Funding arb check now |
| `/hl [digest\|post\|thread]` | AI draft of a Hyperliquid ecosystem update |
| `/status` | Bot health + BTC funding |
| `/help` | Show command menu |

**Register webhook** (one-time, open in browser after deploy):
```
https://hype-bot.<your-subdomain>.workers.dev/register-webhook
```

**Manual trigger endpoints:**
```
GET https://hype-bot.<your-subdomain>.workers.dev/run-signals
GET https://hype-bot.<your-subdomain>.workers.dev/run-arb
GET https://hype-bot.<your-subdomain>.workers.dev/run-snapshot
GET https://hype-bot.<your-subdomain>.workers.dev/health
```

**Supabase table for snapshots:**
```sql
CREATE TABLE hype_snapshots (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  ts BIGINT,
  account_value NUMERIC,
  spot_value NUMERIC,
  total_value NUMERIC,
  position_count INTEGER,
  positions_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

If the table already exists from before spot/total tracking was added, run instead:
```sql
ALTER TABLE hype_snapshots ADD COLUMN IF NOT EXISTS spot_value NUMERIC;
ALTER TABLE hype_snapshots ADD COLUMN IF NOT EXISTS total_value NUMERIC;
```

Env vars in `wrangler-bot.toml [vars]`: `SIGNAL_COINS`, `ARB_THRESHOLD`, `MAX_FUNDING`, `DRAWDOWN_ALERT_PCT` (default 10), `ALLOC_DRIFT_PCT` (default 80).

---

## Changelog

### 2026-06-20 (latest — Capital tab)
- **New Capital tab** — live spot vs. perps capital breakdown with allocation bar, polled every ~12s (`capital.js`).
- **Capital history chart** — stacked spot/perps allocation over time, built from daily snapshots.
- **Detailed perps trade & fee journal** — closed trades with avg entry/exit, hold time, gross/fee/net PnL, plus a recent fills & fees table, filterable by coin and time window.
- **Daily snapshots now include spot value** (`autojournal.js`) — `spot_value` / `total_value` alongside existing perps `account_value`, powering the new history chart going forward.

### 2026-05-31 (telegram bot + webhook)
- **Telegram command bot** — bot now responds to `/signals`, `/snapshot`, `/arb`, `/status`, `/help` commands interactively via Telegram webhook. Commands execute instantly on demand without waiting for the next cron.
- **Webhook registration endpoint** — `/register-webhook` auto-registers the Cloudflare Worker URL with Telegram. One-time setup.
- **BotFather config** — command menu, description, and about text registered via BotFather for clean UX.

### 2026-05-31 (bot worker)
- **Cloudflare Bot Worker** — autonomous cron Worker (`cloudflare/bot-worker.js`) with KV dedup. Signal alerts (EMA/MACD/RSI + funding gate), funding arb alerts (HL vs Binance/Bybit), daily portfolio snapshot to Supabase + Telegram. No VPS required.
- **KV deduplication** — 4h cooldown per coin prevents alert spam across both signal and arb scanners.

### 2026-05-30 (auto-journal)
- **Auto-Journal** — detects closed trades automatically from Hyperliquid fills (runs on load + every 10 min). Each entry gets: coin, side, PnL, hold time, open/close dates.
- **Outcome tagging** — tag each trade: Textbook / Disciplined / FOMO / Tilted. Tags toggle inline.
- **AI lesson per trade** — Claude AI writes a one-line lesson for each closed trade when API key is configured. Runs in background, non-blocking.
- **Weekly AI pattern review** — Monday review button summarises last 7 days of trades, tags, and lessons into 2-3 actionable sentences.
- **Daily snapshot** — auto-captures account value + open positions at midnight each day. Last 120 days retained.
- **JSON export** — download all journal entries + snapshots as a JSON file anytime.
- **GitHub Gist backup** — one-click backup to a private GitHub Gist (enter PAT once; updates the same Gist on subsequent runs).
- **Supabase sync** — journal entries sync to `hype_journal` table when Supabase is configured. SQL: `CREATE TABLE hype_journal (id TEXT PRIMARY KEY, wallet TEXT, coin TEXT, side TEXT, entry_time BIGINT, exit_time BIGINT, pnl NUMERIC, fees NUMERIC, net_pnl NUMERIC, hold_ms BIGINT, tag TEXT, notes TEXT, lesson TEXT, created_at BIGINT, source TEXT);`
- **Git version tag** — `v2026-05-30-pre-autojournal` marks the stable state before this feature.

### 2026-05-30
- **DeFi Macro tab** — new Analysis tab powered by DeFiLlama (free, unlimited). Shows total DeFi TVL with 24h change, stablecoin supply breakdown (USDT/USDC/DAI/USDe), top 20 protocols by TVL, chain dominance bar chart. Plain-language regime banner (EXPANSION / GROWING / STABLE / COOLING / CONTRACTION).
- **OKX added to Funding Arb** — cross-exchange basis table now includes OKX alongside Binance and Bybit (4-exchange comparison).
- **Long/Short ratio in Signals** — Binance global L/S account ratio column added to signal scanner. Crowded-longs warning (>1.8 ratio) shown inline. No API key required.
- **Signal → AI wiring** — Daily Regime Briefing in Analytics now includes current signal scanner results (entry coins, scores) when a scan has been run.
- **Indicators: Regime Summary** — plain-language assessment card at the top of the Indicators tab synthesizes F&G + BMSB + Pi Cycle + MVRV Z into a single RISK-ON / RISK-OFF / RISK-CAUTIOUS / TRANSITIONAL verdict with bullet explanations.
- **News: 3rd CORS proxy** — corsproxy.io added as third option in RSS fetch race alongside allorigins.win and rss2json.com. Reduces silent failures.
- **Shared price cache** — `getCGSimplePrices()` centralises CoinGecko simple-price calls with Kraken fallback (BTC/ETH/SOL) when CoinGecko rate-limits. Reduces CoinGecko calls by ~60%.
- **Cloudflare Worker** — `cloudflare/` directory with ready-to-deploy RSS proxy Worker. `npx wrangler deploy` from that directory, then paste URL into Settings → RSS Proxy.
- **Sidebar nav bug fix** — `#page-fundamentals { display:flex }` was overriding `.page { display:none }` due to CSS specificity. Fixed: display moved to `#page-fundamentals.active`.

### 2026-05-30
- **Intel tab rebuilt** — replaced static Cryptowatch paste with fully automated live data. Auto-scoring engine from 7 signals (MVRV Z, F&G, BTC funding, alt breadth, OI change, mcap, BTC dom). Regime radar, evidence trail, and cycle score all computed live. Claude "AI Synthesis" and "Generate Setups" buttons added. Auto-refreshes every 3 minutes. Sources: HL + Binance Futures + Bybit + CoinGecko.
- **News tab rewrite** — progressive rendering (first articles in < 500ms), RSS proxies raced in parallel (`Promise.any`), history cut to 3 days for faster load, sessionStorage 5-min cache for instant tab switching. Sources: CryptoCompare, Messari, Reddit, CoinDesk, Cointelegraph, Decrypt, CryptoNews, The Block, Bitcoin Magazine.
- **Fundamentals tab** — new tab with CoinGecko top 100 coins. Global bar (total mcap, BTC/ETH dom, trending), sortable table (price, 24h/7d/30d%, mcap, volume, vol/mcap ratio, ATH drawdown). 5-min auto-refresh.
- **AI tab** — trade staging panel (coin, direction, entry/SL/TP, rationale, tags, R:R auto-calc). Status workflow persisted to Supabase. Claude AI chat via Edge Function (API key stays server-side). Staged trades visible in Intel tab.

### 2026-05-17
- **MVRV beginner guide** — expandable explainer on the MVRV tab for new users unfamiliar with on-chain metrics.
- **News tab (initial)** — crypto news monitor with Fear & Greed widget. CryptoCompare + Reddit + 4 RSS feeds (CoinDesk, Cointelegraph, Decrypt, CryptoNews).

### Earlier
- Signals tab — multi-factor confluence scanner (funding z-score, CVD, OI momentum, trend)
- Recent PnL widget — collapsible 24h/7d PnL summary on Portfolio tab
- Order scenario analysis — margin impact and liq-before-SL warning on Portfolio tab
- Market detail modal — click any coin for phase, TA signals, L/S ratio, OI sparkline
- Cloudflare Worker proxy — edge-cached API responses for low-latency connections
- PWA support — installable on iOS/Android, offline static asset caching
- Telegram alerts — threshold-based PnL notifications via Telegram bot
- IDR conversion — all values shown in USD and Rupiah simultaneously
- Smart Money tracking — on-chain whale wallet monitoring
- Analytics tab — equity curve, trade statistics, performance breakdown

---

## License

Personal use. Not affiliated with Hyperliquid.
