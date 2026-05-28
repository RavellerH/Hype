# Hype — Hyperliquid Dashboard

A personal trading dashboard for [Hyperliquid](https://hyperliquid.xyz). Runs entirely in the browser — no backend required for the web UI. Directly queries the Hyperliquid public API and connects over WebSocket for live price feeds.

**Live:** [ravellerh.github.io/Hype](https://ravellerh.github.io/Hype)

---

## Tabs

| Tab | What it does |
|-----|-------------|
| **Portfolio** | Account value, open perp positions, spot holdings, unrealized PnL, open orders, portfolio growth chart, health score with risk flags. Supports unified accounts. |
| **Trades** | Fill history split into Perp / Spot sub-tabs. Coin filter, realized PnL, win rate, fees. Sorted latest-first, 100 rows per view. |
| **Funding** | Funding paid/received over 7 / 30 / 90 days. Daily bar chart, by-coin breakdown with avg rate, cost-alert pills for positions bleeding funding. |
| **Flows** | Deposit & withdrawal history with historical USD/IDR rate at the exact transaction date (fetched from frankfurter.app), running balance, cumulative flow chart. |
| **Live** | WebSocket price monitor — live mark prices and 24h change for all perp markets. |
| **Markets** | Global market overview — volume, OI, funding, 24h change across all Hyperliquid perps. |
| **Phases** | Wyckoff market-phase detector (Accumulation / Markup / Distribution / Markdown / Neutral) per coin and interval. |
| **Intel** | Smart-money wallet tracking — open positions and recent trades of known top traders. |
| **MVRV** | On-chain MVRV-Z score and market cycle context. |
| **AI** | AI-assisted trade analysis and market commentary. |
| **Watchlist** | Monitor any Hyperliquid address. Get alerts on position changes. |
| **Journal** | Personal trade journal — log entries, notes, outcome tagging. |
| **Indicators** | Technical indicator dashboard — RSI, MACD, Bollinger Bands across timeframes. |
| **Smart Money** | Aggregated signal feed from tracked whale wallets. |
| **Analytics** | PnL analytics, fee breakdown, win/loss streaks, equity curve. |
| **KB** | Personal knowledge base for trading notes and playbooks. |

---

## Key Features

- **Unified account support** — correctly reads `crossMarginSummary` vs `marginSummary` for accounts where spot USDC is perp collateral
- **IDR conversion** — all monetary values can be viewed in Indonesian Rupiah using live and historical rates; Flows tab shows the exact IDR value at the time of each deposit/withdrawal
- **Real-time WebSocket** — live prices, position updates, and wallet-change alerts without polling; exponential backoff reconnect (3 s → 30 s max) prevents hammering the server during outages
- **Portfolio health score** — composite risk score with per-position flags (leverage, liquidation distance, smart-money divergence, BMSB)
- **PWA** — installable on iOS, Android, and desktop; works offline for cached views
- **No sign-in** — enter any wallet address; read-only, no keys required

---

## Architecture

```
Hype/
├── frontend/           # Static SPA — the main dashboard (no backend needed)
│   ├── js/app.js           # All UI logic, API calls, WebSocket, charts
│   └── css/styles.css
│
├── index.html          # Entry point (gh-pages root)
├── styles.css
├── app.js
├── *.js                # Feature modules (intel, analytics, journal, kb, …)
│
├── backend/            # Optional FastAPI server (Telegram alerts, phase scheduling)
│   ├── main.py
│   ├── phase_detector.py
│   ├── wallet_tracker.py
│   ├── telegram_bot.py
│   └── requirements.txt
│
├── bot/                # Optional autonomous trading bot
│   ├── main.py             # Trading loop
│   ├── phase_analyzer.py
│   ├── risk_manager.py
│   ├── backtest.py
│   └── requirements.txt
│
└── vercel.json         # Frontend deploy config
```

The frontend calls the Hyperliquid public API (`api.hyperliquid.xyz`) and `frankfurter.app` (exchange rates) directly from the browser. The backend and bot are optional extras for Telegram notifications and automated trading.

The backend uses a shared persistent `httpx.AsyncClient` (connection pooling) for all Hyperliquid API calls, and parallelises independent fetches with `asyncio.gather` where possible.

---

## Quick Start

### Dashboard only (no backend)

Open [ravellerh.github.io/Hype](https://ravellerh.github.io/Hype) in a browser, or self-host the static files anywhere.

### Self-host on Vercel

```bash
git clone https://github.com/ravellerh/hype.git
cd hype
vercel --prod
```

### Run with backend (Telegram alerts + phase scheduling)

```bash
git clone https://github.com/ravellerh/hype.git
cd hype
cp .env.example .env
# fill in PRIMARY_WALLET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
chmod +x start.sh
./start.sh          # starts FastAPI at http://localhost:8000
```

### Trading bot (optional, trades on your behalf)

```bash
cd bot
cp .env.example .env    # fill in HL_PRIVATE_KEY, HL_WALLET_ADDRESS
pip install -r requirements.txt
python main.py
```

---

## Trading Bot

Entry requires all of:

| Condition | Default |
|-----------|---------|
| Coin phase | Accumulation |
| Phase confidence | ≥ 40 % |
| Volume vs average | ≥ 1.2× |
| Smart-wallet longs | ≥ 1 |

Risk defaults:

| Parameter | Value |
|-----------|-------|
| Margin per trade | 10 % of account |
| Leverage | 10× |
| Stop-loss | 8 % |
| Take-profit | 75 % |
| Max open bot positions | 3 |

Exit: phase flip to Distribution / Markdown, or trail to breakeven on Markup confirmation. Configurable in `bot/config.py`.

Backtest: `cd bot && python backtest.py`

---

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `PRIMARY_WALLET` | `.env` | Hyperliquid address to monitor |
| `TELEGRAM_BOT_TOKEN` | `.env` | Dashboard Telegram bot token |
| `TELEGRAM_CHAT_ID` | `.env` | Dashboard Telegram chat ID |
| `POLL_INTERVAL` | `.env` | Wallet poll interval in seconds (default 30) |
| `ALLOWED_ORIGINS` | `.env` | Comma-separated CORS origins (default `http://localhost:8000,http://127.0.0.1:8000`) |
| `HL_PRIVATE_KEY` | `bot/.env` | Private key for bot trading |
| `HL_WALLET_ADDRESS` | `bot/.env` | Bot wallet address |
| `TG_TOKEN` | `bot/.env` | Bot Telegram token |
| `TG_CHAT_ID` | `bot/.env` | Bot Telegram chat ID |

---

## Reliability & Security Notes

| Area | Detail |
|------|--------|
| **WS reconnect** | Exponential backoff — 3 s, 6 s, 12 s, 24 s, 30 s max. Retry counter resets on successful connect. |
| **Silent refresh** | 60 s auto-refresh is concurrency-guarded; a second call while one is in flight is a no-op. Scroll position is preserved if the user hasn't moved. |
| **Market modal** | Stale-request cancellation — clicking a coin while the previous modal is still loading discards the old result. |
| **Chart.js** | Indicator sparklines destroy the previous Chart instance before re-creating to prevent canvas memory leaks. |
| **Backend HTTP** | Single shared `httpx.AsyncClient` with connection pooling replaces per-call client construction. |
| **MVRV endpoint** | CoinGecko chart fetches for all coins are parallelised; previously ran sequentially. |
| **Polling failures** | Backend counts consecutive poll errors and sends a Telegram alert after 5 in a row. |
| **CORS** | Restricted to `localhost` by default; override via `ALLOWED_ORIGINS` env var for custom deployments. |
| **Telegram config** | Bot token validated against `<id>:<hash>` format before being written to `.env`. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, CSS custom properties, Chart.js |
| Real-time | Hyperliquid WebSocket API |
| Exchange rates | frankfurter.app (historical USD/IDR) |
| PWA | Web App Manifest + Service Worker |
| Backend (optional) | Python 3.11+, FastAPI, APScheduler |
| Bot SDK | hyperliquid-python-sdk |
| Notifications | python-telegram-bot |
| Deploy | GitHub Pages (frontend), Vercel, or any static host |

---

## License

MIT
