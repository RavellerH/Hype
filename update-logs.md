# Hype — Update Logs

Detailed session-by-session development log. For the short changelog see [README.md](./README.md).

---

## 2026-06-10 — HL Pulse: Hyperliquid Ecosystem Tab + Content Studio

### What we built
A Hyperliquid-focused intelligence tab plus an AI content pipeline — the dashboard now tracks the HL ecosystem itself (news, HyperEVM TVL, HYPE stats) and drafts English X posts/threads/digests from live data.

### Features
| Feature | Detail |
|---|---|
| HL Pulse tab | HYPE price/funding/OI, HL total perp volume, HyperEVM TVL, top ecosystem protocols by TVL (DeFiLlama) |
| HL news feed | CryptoCompare keyword-filtered + r/hyperliquid + News-tab cache, deduped, 7-day window |
| Content Studio | Generate X thread / single post / daily digest from live context — llm-router first, bot worker Workers AI fallback, edit + copy |
| Daily TG draft | Midnight UTC cron — bot drafts an HL ecosystem digest and sends it to Telegram for review before posting |
| `/hl [style]` | On-demand draft via Telegram: `digest` (default), `post`, `thread` |
| `/draft-hl` | POST endpoint (Workers AI, CORS) used by the dashboard fallback |

### Files
- `hlpulse.js` — new tab module (fetchers, stats, render, content generator)
- `cloudflare/bot-worker.js` — `getHLNews`, `getHLStats`, `draftHL`, `hlDailyDigest`, `/hl` command, `/draft-hl` + `/run-hl-digest` routes, daily cron wiring
- `index.html`, `app.js`, `sw.js` — nav/page/script registration, cache bump to v11

### Notes
- AI prompts are constrained to facts in the fetched context (no invented numbers); drafts are always human-reviewed before posting.
- All sources keyless; redeploy the bot with `wrangler deploy -c wrangler-bot.toml` to activate the digest.

---

## 2026-05-31 — Telegram Bot + Cloudflare Worker

### What we built
A fully autonomous trading bot running on Cloudflare Workers (free tier). No VPS, no server, no maintenance. Sends Telegram alerts automatically and responds to commands on demand.

### Bot features
| Feature | Detail |
|---|---|
| Signal alerts | Every 15 min — scans BTC/ETH/SOL/HYPE/SUI for TA confluence |
| Funding arb alerts | Every 15 min — HL vs Binance/Bybit spread above threshold |
| Daily snapshot | Midnight UTC — portfolio value + open positions → Supabase + Telegram |
| KV deduplication | 4h cooldown per coin — no repeat spam |
| Interactive commands | `/signals` `/snapshot` `/arb` `/status` `/help` via Telegram webhook |

### TA signal scoring (per coin, 0–10)
- EMA20 above price: +2
- EMA50 above price: +2
- MACD bullish crossover: +3 (or +1 if just positive)
- RSI 45–75 (healthy momentum): +2
- RSI <35 (oversold): +2
- Negative funding (uncrowded): +2
- Low funding <0.05%: +1
- High funding >0.2% (crowded longs): −2
- STRONG = 7+, ENTRY = 5+, WATCH = 3+, SKIP = below

### Files added
- `cloudflare/bot-worker.js` — main Worker (TA engine, cron handlers, Telegram webhook, HTTP endpoints)
- `cloudflare/wrangler-bot.toml` — separate wrangler config for the bot (KV binding, cron triggers, env vars)

### Infrastructure
- **Platform**: Cloudflare Workers (free tier — 100k requests/day, unlimited cron)
- **KV namespace**: `ALERT_STATE` — stores last-alert timestamps for dedup
- **Secrets**: `WALLET`, `TG_TOKEN`, `TG_CHAT`, `SUPABASE_URL`, `SUPABASE_KEY`
- **Supabase table**: `hype_snapshots` — daily portfolio snapshots persisted to cloud
- **Live URL**: `https://hype-bot.hype-analyzer.workers.dev`
- **Telegram bot**: `@HypeAnalyz_bot`

### Deploy steps (Windows CMD)
```cmd
cd cloudflare
set CLOUDFLARE_API_TOKEN=<token>
npx wrangler kv namespace create ALERT_STATE --config wrangler-bot.toml
:: paste returned ID into wrangler-bot.toml
npx wrangler secret put WALLET --config wrangler-bot.toml
npx wrangler secret put TG_TOKEN --config wrangler-bot.toml
npx wrangler secret put TG_CHAT --config wrangler-bot.toml
npx wrangler secret put SUPABASE_URL --config wrangler-bot.toml
npx wrangler secret put SUPABASE_KEY --config wrangler-bot.toml
npx wrangler deploy --config wrangler-bot.toml
:: then open /register-webhook in browser
```

### Ideas for future improvement
- [ ] Add BTC macro gate — skip signal alerts when BTC is in a downtrend
- [ ] Per-coin thresholds — tighter RSI/funding rules for altcoins vs BTC
- [ ] Alert on position PnL milestones (e.g. +10%, −5% from entry)
- [ ] Weekly performance summary every Sunday via cron
- [ ] Add `/price <coin>` command — quick price + funding check on demand
- [ ] Add `/positions` command — show current open positions from HL
- [ ] Bybit + OKX funding in arb scanner (currently only HL vs Binance/Bybit)
- [ ] Sentiment gate — skip longs when Fear & Greed > 80 (extreme greed)

---

## 2026-05-30 — Auto-Journal + AI Lessons

### What we built
Automatic trade journal that detects closed trades from Hyperliquid fills, tags them by psychology (Textbook / Disciplined / FOMO / Tilted), generates AI lessons per trade via Claude, and backs up to Supabase + GitHub Gist.

### Features
- Auto-detects closed trades on page load + every 10 minutes
- Per-trade outcome tagging (toggles inline, persisted to localStorage)
- Claude AI writes a one-line lesson for each closed trade (background, non-blocking)
- Weekly AI pattern review — Monday button summarises last 7 days of trades
- Daily portfolio snapshot at midnight (last 120 days retained in localStorage)
- JSON export — full journal + snapshots download anytime
- GitHub Gist backup — one-click private backup using a Personal Access Token
- Supabase sync — `hype_journal` table for cloud persistence

### Files added/modified
- `autojournal.js` (new) — full auto-journal engine
- `journal.js` — updated to prepend auto-journal panel above the raw trade log

### Ideas for future improvement
- [ ] Monthly P&L calendar heatmap in the journal view
- [ ] Streak tracking — consecutive winning/losing days
- [ ] Per-tag win rate breakdown (does "Textbook" actually outperform "FOMO"?)
- [ ] Export to CSV in addition to JSON
- [ ] Shareable trade card (image) for each closed trade

---

## 2026-05-30 — Data Source Upgrades + New Tabs

### What we built
Major data source expansion, three new tabs, and several reliability fixes.

### Changes
- **DeFi Macro tab** — DeFiLlama integration (TVL, stablecoins, protocol rankings, chain dominance, regime banner)
- **OKX added to Funding Arb** — 4-exchange comparison (HL / Binance / Bybit / OKX)
- **Binance L/S ratio in Signals** — crowded-longs warning when ratio >1.8
- **Signal → AI wiring** — regime briefing in Analytics now includes live signal scan results
- **Indicators: Regime Summary** — synthesises F&G + BMSB + Pi Cycle + MVRV Z into single RISK-ON/OFF/CAUTIOUS/TRANSITIONAL verdict
- **Shared CoinGecko price cache** — `getCGSimplePrices()` with Kraken fallback, reduces CG calls ~60%
- **3rd RSS proxy** — corsproxy.io added to `Promise.any` race (alongside allorigins + rss2json)
- **CSS specificity fix** — ID selector `display:flex` was overriding `.page { display:none }`. Fixed across fundamentals, defi, arb pages.

### Ideas for future improvement
- [ ] DeFi tab: add protocol TVL sparklines (7d trend)
- [ ] Arb scanner: add OKX to the bot worker (currently browser-only)
- [ ] Regime score history — track how the Intel score changes over time

---

## 2026-05-30 — Intel Tab Rebuild + Fundamentals + AI Tab

### What we built
Complete overhaul of the Intel tab from a static paste to a fully automated live engine. Added Fundamentals tab and AI trade staging.

### Changes
- **Intel tab** — 7-signal auto-scoring engine, regime radar, evidence trail, Claude "Generate Setups" button, 3-min auto-refresh
- **Fundamentals tab** — CoinGecko top 100 with global stats bar, sortable table (price, %, mcap, volume, ATH drawdown)
- **News tab rewrite** — progressive rendering (<500ms first articles), parallel RSS proxy race, 3-day history, 5-min sessionStorage cache
- **AI tab** — trade staging (entry/SL/TP, R:R auto-calc), status workflow (staged→watching→executed/cancelled), Claude chat via Supabase Edge Function

---

## 2026-05-17 — Foundation

### What we built
Initial public version with core Hyperliquid portfolio tracking.

### Features shipped
- Portfolio tab — live positions, PnL, health score, growth chart
- Trades tab — full fill history, win rate, realized PnL
- Funding tab — payments by coin, bar chart, annualized rate
- Flows tab — deposit/withdrawal ledger with IDR rates
- Live tab — WebSocket price feed, order book, liquidation tracker
- Markets tab — OI, funding leaderboard, dominance
- Phases tab — Wyckoff phase detection (1h/4h/1d)
- MVRV tab — Bitcoin cycle indicator with beginner guide
- Signals tab — multi-factor confluence scanner
- Analytics tab — equity curve, trade statistics
- Journal tab — personal trade journal (localStorage)
- PWA support — installable, offline caching
- Telegram alerts — PnL threshold notifications
- IDR conversion — all values in USD + Rupiah

---

*Built by [@Raveller](https://github.com/RavellerH) with Claude AI assistance.*
