# Feature Inventory — Hype Dashboard

Complete audit of all dashboard tabs and modules as of 2026-05-31.

---

## Navigation Tabs (26 pages)

| Page ID | Label | Loader | Source File |
|---|---|---|---|
| `overview` | Portfolio | `loadOverview` | app.js |
| `trades` | Trades | `loadTrades` | app.js |
| `funding` | Funding | `loadFunding` | app.js |
| `flows` | Flows | `loadFlows` | app.js |
| `monitor` | Live | `loadMonitor` | app.js |
| `markets` | Markets | `loadMarkets` | app.js |
| `phases` | Phases | `loadPhases` | app.js |
| `intel` | Intel | `loadIntel` | intel.js |
| `mvrv` | MVRV | (inline) | mvrv-ai.js |
| `ai` | AI | `loadAI` | ai.js |
| `watchlist` | Watchlist | `loadWatchlist` | app.js |
| `journal` | Journal | `loadJournal` | journal.js / autojournal.js |
| `indicators` | Indicators | `loadIndicators` | indicators.js |
| `smartmoney` | Smart Money | `loadNansen` | nansen.js |
| `analytics` | Analytics | `loadAnalytics` | analytics.js |
| `kb` | KB | `loadKB` | kb.js |
| `signals` | Signals | `loadSignals` | signals.js + ta-signal.js |
| `news` | News | `loadNews` | news.js |
| `brief` | Brief | `loadDailyBrief` | dailybrief.js |
| `research` | Research | `loadResearch` | research.js |
| `fundamentals` | Fundamentals | `loadFundamentals` | fundamentals.js |
| `defi` | DeFi | `loadDefi` | defillama.js |
| `arb` | Arb | `loadArb` | arb.js |
| `trend` | Trend | `loadTrend` | trend.js |
| `onchain` | On-chain | `loadOnchain` | onchain.js |
| `heatmap` | Heatmap | `loadHeatmap` | heatmap.js |

---

## Tab Details

### Portfolio (`overview`)
- Live positions from Hyperliquid REST API
- Spot balances and margin breakdown
- Unrealized PnL per position + total
- Account health score / margin utilization
- Portfolio growth chart
- Recent PnL widget (24h / 7d collapsible)
- Order scenario analysis (margin impact, liq-before-SL warning)

### Trades
- Full fill history — perps and spot
- Win rate, realized PnL, fee totals
- Per-trade breakdown: coin, side, size, price, PnL, fees

### Funding
- Funding payments by coin
- Daily bar chart of cumulative funding
- Annualized rate per open position

### Flows
- Deposit/withdrawal ledger
- Historical IDR (Indonesian Rupiah) exchange rate conversion

### Live (`monitor`)
- Real-time WebSocket price feed from Hyperliquid
- Order book depth display
- Liquidation tracker

### Markets
- Top coins by open interest
- Funding rate leaderboard
- Market cap dominance stats
- Market detail modal: click any coin → phase, TA signals, L/S ratio, OI sparkline

### Phases
- Wyckoff phase detection: Accumulation / Markup / Distribution / Markdown
- Timeframes: 1h, 4h, 1d
- Applied to all SIGNAL_COINS

### Intel
- Auto-scoring regime engine — 7 weighted signals:

| Signal | Weight | Bullish condition |
|---|---|---|
| MVRV Z-Score | 3× | Z < 1 |
| Fear & Greed | 2× | < 35 |
| BTC Funding APR | 2× | < 5% |
| Alt Breadth | 1× | > 65% top-100 up |
| Global MCap 24h | 1× | > +3% |
| BTC OI Change 24h | 1× | < −8% |
| BTC Dominance | 1× | < 50% |

- Score: normalized ±10 → BUY / BULL / WAIT / CAUTION / SELL verdict
- Radar chart: Macro, Cycle, OnChain, Derivs, Funding, Breadth, Sentiment axes
- Auto-refresh every 3 minutes
- "Generate Setups" button — Claude AI trade suggestions (needs Edge Function)

### MVRV
- Bitcoin MVRV Z-Score cycle indicator
- Historical chart with cycle top/bottom zones
- Beginner guide (expandable explainer)
- AI commentary via Supabase Edge Function (optional)

### AI
- Trade staging panel: coin, direction, entry/SL/TP, rationale, tags, auto R:R
- Status workflow: `staged → watching → executed / cancelled`
- Synced to Supabase `staged_trades` table
- Claude AI chat via Edge Function (API key stays server-side)
- Staged trades visible in Intel tab context

### Watchlist
- Monitor any Hyperliquid wallet address
- Position list, unrealized PnL, account value

### Journal
Two implementations coexist:

**autojournal.js** — Auto-Journal (primary):
- Detects closed trades from Hyperliquid fills automatically
- Runs on load + every 10 minutes
- Each entry: coin, side, PnL, hold time, open/close dates
- Outcome tagging: Textbook / Disciplined / FOMO / Tilted
- AI lesson per trade (Claude, when configured)
- Weekly AI pattern review (Mondays)
- Daily snapshot at midnight (120-day retention)
- JSON export + GitHub Gist backup
- Supabase sync to `hype_journal` table

**journal.js** — Manual Trade Journal (Supabase-backed):
- Manual trade entry form: coin, direction, entry/exit price, dates, setup type
- Auto-PnL calculation
- Stats: total PnL, win rate, trade count, avg PnL
- Filter by coin and setup type
- Credentials stored in localStorage: `hype_sb_url`, `hype_sb_anon`

### Indicators
- Fear & Greed Index (alternative.me) — 7-day chart
- BMSB (Bull Market Support Band) — 20-week SMA vs 21-week EMA
- Pi Cycle Top indicator — 111-day MA vs 2× 350-day MA
- MVRV Z-Score widget
- **Regime Summary card** — synthesizes all 4 indicators:
  - RISK-ON / RISK-OFF / RISK-CAUTIOUS / TRANSITIONAL verdict
  - Bullet-point explanation per signal

### Smart Money (`smartmoney`)
- On-chain whale wallet tracking (Nansen-style)
- Monitor large wallet activity on-chain

### Analytics
- PnL equity curve
- Trade statistics and performance breakdown
- Signal → AI wiring: includes current signal results in Daily Regime Briefing

### KB (Knowledge Base)
- Personal trading notes and rules
- 911-line knowledge base module

### Signals
- Multi-factor confluence scanner
- Factors: funding z-score, CVD, OI momentum, trend alignment
- Binance global Long/Short account ratio column
- Crowded-longs warning (ratio > 1.8)
- Score per coin → ranked list

### News
- Progressive rendering: first articles < 500ms
- 9 data sources (see APIs doc)
- 3-day history cutoff, 5-min sessionStorage cache
- Source filter tabs
- **AI Analysis** (Cloudflare Workers AI):
  - Analyzes top 10 articles via `/analyze-news` endpoint on bot worker
  - Per-article badges: BULL / BEAR / NEUTRAL + timeframe + coin chips + reasoning
  - Settings: enter bot worker URL in ⚙ panel → stored in `hype_bot_url` localStorage
  - Cache TTL: 30 minutes

### Daily Brief (`brief`)
- Auto-generated every day at UTC midnight by a GitHub Actions workflow (`.github/workflows/daily-brief.yml` → `scripts/daily-brief.mjs`)
- Pulls HYPE price/funding/OI/volume, HyperEVM TVL, Fear & Greed, per-coin funding/OI, and Hyperliquid-tagged news
- Drafted via the Supabase `llm-router` Edge Function (`task: 'debrief'`, Tier 2 chain: Gemini Pro → Claude Sonnet → OpenRouter → Groq 70B) — prompted for a critical, cross-checked, well-written read (not a bullet dump), with a `confidence` rating reflecting how well the data actually supports it
- **No database** — each run commits `briefs/<date>.md` (human-readable) and prepends an entry to `briefs/index.json` straight into the `gh-pages` branch; the dashboard reads the index directly from `raw.githubusercontent.com`
- "Generate Now" button POSTs to `/api/trigger-workflow` (Vercel serverless function), which calls GitHub's `workflow_dispatch` REST API server-side using a `GH_PAT` Vercel environment variable — the PAT never reaches the browser
- History list of past briefs below the latest card, each with its confidence badge and a link to the source markdown on GitHub
- Requires GitHub repo secret `LLM_ROUTER_URL` (the Supabase Edge Function URL; optional `TG_TOKEN`/`TG_CHAT` for Telegram push); requires Vercel env var `GH_PAT` (token with `repo`+`workflow` scope) for the "Generate Now" button

### Weekly Research (`research`)
- Auto-generated every Sunday (1h after the daily brief) by a GitHub Actions workflow (`.github/workflows/weekly-research.yml` → `scripts/weekly-research.mjs`), aggregating the last 7 days from `briefs/index.json` (already in the checked-out repo — no fetch needed)
- Drafted via the same `llm-router` Edge Function (`task: 'weekly_review'`, same Tier 2 chain), prompted to read trend across the week rather than restate each day, with its own `confidence` rating
- **No database** — commits `research/<week>.md` + `research/index.json` into `gh-pages`, read by the dashboard from `raw.githubusercontent.com`
- "Generate This Week" button uses the same `/api/trigger-workflow` proxy as the Daily Brief tab

### Fundamentals
- CoinGecko top 100 coins
- Global bar: total mcap, BTC/ETH dominance, trending coins
- Sortable table: price, 24h/7d/30d%, mcap, volume, vol/mcap ratio, ATH drawdown
- 5-minute auto-refresh

### DeFi
- DeFiLlama macro dashboard (free, unlimited API)
- Total DeFi TVL with 24h change
- Stablecoin supply breakdown: USDT / USDC / DAI / USDe
- Top 20 protocols by TVL
- Chain dominance bar chart
- Plain-language regime banner: EXPANSION / GROWING / STABLE / COOLING / CONTRACTION

### Arb
- Funding arb scanner: HL vs Binance vs Bybit vs OKX
- 4-exchange funding rate comparison table
- Highlights spreads above threshold

### Trend
- Multi-timeframe trend alignment scanner (1h, 4h, 1d)
- Per-coin grid showing:
  - Bias (BULL / BEAR / NEUTRAL)
  - ADX value + label (RANGE / TREND / STRONG)
  - Supertrend direction
  - Market structure (HH/HL, LH/LL, NEUTRAL)
  - RSI divergence badge
  - OI direction from Binance
- Coins: configurable via `SIGNAL_COINS`
- Each coin analyzed in parallel, progressive render

### On-chain (`onchain`)
- Regime signal score from on-chain data
- **Network section** (blockchain.com / mempool.space):
  - Mempool transaction count
  - Fee rates (fastest / 30-min / 1-hour)
  - BTC hash rate, difficulty
- **CoinGlass section** (requires API key in Settings):
  - BTC and ETH 24h liquidation data
  - Long vs short liq bias → bull/bear signal
  - OI change data
- **CryptoQuant section** (requires API key in Settings):
  - Exchange reserve flows → bull/bear signal
- **Hyperliquid on-chain**:
  - BTC and ETH open interest
  - Funding rates
  - Stablecoin supply stats from DeFiLlama
- Signal array: bull/bear/neutral per metric → regime verdict
- Settings panel: CoinGlass key + CryptoQuant key (stored in localStorage)

### Heatmap
- All Hyperliquid perps fetched via `metaAndAssetCtxs`
- Color-coded grid by funding rate:
  - Red = high positive (crowded longs)
  - Green = negative (short squeeze risk)
- Sort modes: |Fund|, Fund↑, Fund↓, OI, Name
- Filter by coin name
- Stats bar: positive count, negative count, total OI
- 60-second cache TTL
- Auto-refresh on load

---

## PWA / Infrastructure

- Service worker (`sw.js`): offline static asset caching
- Installable on iOS/Android
- Single-file CSS (`styles.css`) with CSS custom properties
- No build step — pure static HTML/JS/CSS
- GitHub Pages deployment on `gh-pages` branch
- Cloudflare Worker RSS proxy for CORS bypass (`cloudflare/worker.js`)
