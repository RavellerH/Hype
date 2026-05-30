# Hype — Hyperliquid Portfolio Dashboard

A personal trading dashboard for [Hyperliquid](https://hyperliquid.xyz) — live positions, TA signals, on-chain macro intelligence, crypto news, market fundamentals, and AI-assisted trade staging. Runs entirely in the browser with no backend required.

**[→ Open Dashboard](https://ravellerh.github.io/Hype/)**  &nbsp;|&nbsp;  **[→ Documentation](https://ravellerh.github.io/Hype/docs.html)**

---

## Features

| Tab | What it does |
|---|---|
| **Portfolio** | Live positions, spot balances, unrealized PnL, health score, portfolio growth chart |
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
| **Fundamentals** | Top 100 coins — price, 24h/7d/30d%, market cap, volume, ATH drawdown |

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
├── ta-signal.js        TA engine: confluence scanner, CVD, OI, signal scoring
├── mvrv-ai.js          MVRV Z-Score + Supabase client + AI commentary
├── analytics.js        PnL analytics, equity curve
├── indicators.js       Fear & Greed, BMSB, Pi Cycle
├── nansen.js           Smart Money wallet tracking
├── journal.js          Trade journal (localStorage)
├── kb.js               Knowledge base
├── position-meta.js    Per-position intent / thesis modal
├── logger.js           Data logger & portfolio snapshots
├── signals.js          Confluence scanner UI
├── styles.css          All styles (single file, CSS variables)
├── sw.js               Service worker (PWA caching)
└── docs.html           Documentation
```

**Data sources (all free, no API keys required):**
- Hyperliquid REST + WebSocket API
- Binance Futures public API (OI, funding)
- Bybit public API (funding)
- CoinGecko public API (markets, global stats, trending)
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

## Changelog

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
