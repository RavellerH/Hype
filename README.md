# ⚡ Hype — Hyperliquid Trade Analyzer & Bot

A full-stack platform for monitoring, analyzing, and auto-trading perpetuals on [Hyperliquid](https://hyperliquid.xyz). It combines a real-time web dashboard, a Wyckoff market-phase detector, smart-wallet tracking, and an optional automated trading bot.

---

## Features

- **Live portfolio dashboard** — positions, P&L, open orders, all updating over WebSocket
- **Trade history** — every fill, filterable and paginated
- **Funding tracker** — funding paid/received by coin over any date range
- **Inflow / Outflow** — ledger-level deposit/withdrawal analysis
- **Wyckoff phase detector** — classifies each coin as Accumulation / Markup / Distribution / Markdown / Neutral in real time and records hourly history to CSV
- **Wallet watchlist** — monitor any Hyperliquid address and get change alerts
- **Smart-wallet signals** — tracks known top traders (Abraxas Capital, James Wynn, qwatio …) to use as entry confirmation
- **Telegram notifications** — wallet changes and bot trades pushed straight to your chat
- **PWA** — installable on mobile / desktop, works offline
- **Trading bot** (optional) — phase-based auto-entry with smart-wallet confirmation, dynamic stop-loss, and backtesting

---

## Architecture

```
Hype/
├── backend/          # FastAPI server + Hyperliquid data layer
│   ├── main.py           # REST API, WebSocket hub, scheduler
│   ├── hyperliquid.py    # Hyperliquid API client
│   ├── phase_detector.py # Wyckoff phase logic
│   ├── phase_log.py      # Hourly phase recording (CSV)
│   ├── wallet_tracker.py # Watchlist polling
│   ├── telegram_bot.py   # Telegram alert dispatcher
│   ├── config.py         # Env-driven config
│   └── requirements.txt
│
├── bot/              # Autonomous trading bot (optional)
│   ├── main.py           # Main trading loop
│   ├── phase_analyzer.py # Entry-signal logic
│   ├── phase_detector.py # Phase detection (bot copy)
│   ├── phase_recorder.py # Phase history for the bot
│   ├── risk_manager.py   # Position sizing & SL/TP
│   ├── indicators.py     # Technical indicators
│   ├── backtest.py       # Backtester
│   ├── wallet_monitor.py # Smart-wallet watcher
│   ├── telegram_notifier.py
│   ├── config.py         # Risk params & smart-wallet list
│   └── requirements.txt
│
├── frontend/         # Vanilla JS/CSS single-page PWA
│   ├── index.html
│   ├── js/app.js
│   ├── css/styles.css
│   ├── manifest.json
│   └── sw.js
│
├── start.sh          # One-command local startup
├── vercel.json       # Frontend deployment config
└── .env.example      # Environment variable template
```

---

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/ravellerh/hype.git
cd hype
cp .env.example .env
```

Edit `.env`:

```env
PRIMARY_WALLET=0xYourHyperliquidAddress
TELEGRAM_BOT_TOKEN=          # optional — get from @BotFather
TELEGRAM_CHAT_ID=            # optional — your Telegram chat/group ID
POLL_INTERVAL=30             # wallet polling interval in seconds
```

### 2. Run the dashboard

```bash
chmod +x start.sh
./start.sh
```

This creates a virtualenv, installs dependencies, and starts the server at **http://localhost:8000**.

### 3. (Optional) Run the trading bot

```bash
cd bot
cp .env.example .env   # fill in HL_PRIVATE_KEY, HL_WALLET_ADDRESS, TG_TOKEN, TG_CHAT_ID
pip install -r requirements.txt
python main.py
```

---

## API Reference

All endpoints are served by the FastAPI backend.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/positions` | Account summary + open positions |
| `GET` | `/api/trades` | Fill history (`?limit=100`) |
| `GET` | `/api/funding` | Funding paid/received (`?days=30`) |
| `GET` | `/api/flows` | Inflow/outflow ledger (`?days=90`) |
| `GET` | `/api/phase/{coin}` | Phase for a single coin (`?interval=1h&days=7`) |
| `GET` | `/api/phase` | Phase for all open positions |
| `GET` | `/api/phase/history` | Recorded phase log (`?coin=BTC&days=14`) |
| `GET` | `/api/phase/history/export` | Download full phase_log.csv |
| `GET` | `/api/mids` | All current mark prices |
| `GET` | `/api/candles/{coin}` | OHLCV candles (`?interval=1h&days=7`) |
| `GET` | `/api/watchlist` | All watched wallets + snapshots |
| `POST` | `/api/watchlist` | Add wallet `{ address, label }` |
| `DELETE` | `/api/watchlist/{address}` | Remove wallet |
| `GET` | `/api/notifications` | In-memory notification list |
| `POST` | `/api/notifications/{id}/read` | Mark one notification read |
| `POST` | `/api/notifications/read-all` | Mark all read |
| `POST` | `/api/telegram/configure` | Save Telegram credentials |
| `GET` | `/api/telegram/status` | Check Telegram enabled |
| `WS` | `/ws` | Real-time push (positions, wallet changes, notifications) |

---

## Trading Bot

The bot in `bot/` runs independently and trades on your behalf.

### Entry conditions (all must pass)

| Condition | Default |
|-----------|---------|
| Coin phase | Accumulation |
| Phase confidence | ≥ 40 % |
| Recent volume vs average | ≥ 1.2× |
| Smart-wallet longs | ≥ 1 |

### Risk parameters

| Parameter | Default |
|-----------|---------|
| Margin per trade | 10 % of account |
| Leverage | 10× |
| Stop-loss | 8 % |
| Fixed take-profit | 75 % |
| Max open bot positions | 3 |

### Exit strategy

- **Phase exit** — close when the coin flips to Distribution or Markdown
- **Trail to breakeven** — move SL to entry once Markup is confirmed
- Both can be toggled in `bot/config.py`

### Smart wallets monitored

Configurable in `bot/config.py`. Defaults include Abraxas Capital, James Wynn, qwatio, and several HLP whales. Replace placeholder addresses with real ones sourced from the Hyperliquid leaderboard or Nansen.

### Backtesting

```bash
cd bot
python backtest.py
```

---

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `PRIMARY_WALLET` | `.env` (root) | Hyperliquid address to monitor |
| `TELEGRAM_BOT_TOKEN` | `.env` (root) | Dashboard Telegram bot token |
| `TELEGRAM_CHAT_ID` | `.env` (root) | Dashboard Telegram chat ID |
| `POLL_INTERVAL` | `.env` (root) | Wallet poll interval (seconds, default 30) |
| `HL_PRIVATE_KEY` | `bot/.env` | Private key for bot trading |
| `HL_WALLET_ADDRESS` | `bot/.env` | Bot wallet address |
| `TG_TOKEN` | `bot/.env` | Bot Telegram token |
| `TG_CHAT_ID` | `bot/.env` | Bot Telegram chat ID |

---

## Deployment

### Frontend (Vercel)

The `frontend/` directory is ready to deploy. `vercel.json` points Vercel at it with catch-all rewrites:

```bash
vercel --prod
```

### Backend (any Linux server)

```bash
cd backend
python3 -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

Use nginx + systemd for production.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, uvicorn, APScheduler |
| Data | httpx, pandas, numpy |
| Notifications | python-telegram-bot |
| Bot SDK | hyperliquid-python-sdk |
| Frontend | Vanilla JS, CSS custom properties |
| PWA | Web App Manifest, Service Worker |
| Deploy | Vercel (frontend), uvicorn (backend) |

---

## License

MIT
