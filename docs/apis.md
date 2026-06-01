# API Integrations

All external data sources used by the dashboard and bot.

---

## Free APIs (no key required)

| Source | Used by | Data |
|---|---|---|
| Hyperliquid REST | app.js, intel.js, trend.js, onchain.js, bot | Positions, fills, funding rates, OI, candles, perp meta |
| Hyperliquid WebSocket | app.js (monitor tab) | Real-time price feed, order book |
| Binance Futures | app.js, intel.js, arb.js, trend.js, signals.js, bot | OI, funding, L/S ratio |
| Bybit | arb.js, bot | Funding rates |
| OKX | arb.js | Funding rates |
| CoinGecko (public) | intel.js, fundamentals.js | Markets top 100, global stats, trending, BTC/ETH/SOL price |
| Kraken | intel.js | BTC/ETH spot prices (CoinGecko fallback) |
| DeFiLlama | defillama.js, onchain.js | TVL, stablecoins, chains, protocols |
| alternative.me | news.js, indicators.js, bot | Fear & Greed Index |
| blockchain.com | onchain.js | BTC mempool stats, hash rate, difficulty |
| mempool.space | onchain.js | Mempool transaction count, fee rates |
| CryptoCompare | news.js | Crypto news articles (50 per request) |
| Messari | news.js | Crypto news articles (50 per request) |
| Reddit (`r/CryptoCurrency`) | news.js | Community posts (50 per request) |

### RSS Feeds (news.js)

Proxied via CORS relays (allorigins.win / corsproxy.io / rss2json.com):

| Source | Feed URL |
|---|---|
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/` |
| Cointelegraph | `https://cointelegraph.com/rss` |
| Decrypt | `https://decrypt.co/feed` |
| CryptoNews | `https://cryptonews.com/news/feed/` |
| The Block | `https://www.theblock.co/rss/all` |
| Bitcoin Magazine | `https://bitcoinmagazine.com/.rss/full/` |

---

## Keyed APIs (optional, entered in-app)

### CoinGlass

- **Header:** `coinglassSecret: <key>`
- **Base URL:** `https://open-api.coinglass.com/public/v2/`
- **Endpoints used:**
  - `liquidation_ex_chart?ex=Binance&pair=BTCUSDT&interval=4h`
  - `liquidation_ex_chart?ex=Binance&pair=ETHUSDT&interval=4h`
- **Used by:** onchain.js (browser), bot-worker.js (server-side)
- **Dashboard setting:** On-chain tab → Settings → CoinGlass API Key → saved to `localStorage['hype_coinglass_key']`
- **Bot secret:** `COINGLASS_KEY` (set via `wrangler secret put`)
- **Note:** Browser requests may fail due to CORS. Bot calls work fine server-side. The dashboard shows a notice if CORS blocks the call.

### CryptoQuant

- **Header:** `Authorization: Bearer <key>`
- **Used by:** onchain.js (browser only — not in bot)
- **Data:** Exchange reserve flows (bull/bear signal)
- **Dashboard setting:** On-chain tab → Settings → CryptoQuant API Key → saved to `localStorage['hype_cryptoquant_key']`

### CoinGecko Demo Key (optional)

- **Used by:** fundamentals.js, intel.js via `getCGSimplePrices()`
- **Purpose:** Higher rate limits on public endpoints
- **Setting:** Settings tab → CoinGecko API key (if wired — check settings panel)

---

## Supabase (optional backend)

- **Used by:** ai.js (trade staging, Claude proxy), autojournal.js (sync), bot (snapshots)
- **Auth:** anon key in localStorage (`hype_sb_url`, `hype_sb_anon`) or bot secrets
- **Tables:** `staged_trades`, `hype_snapshots`, `hype_journal`
- **Edge Function:** `claude-proxy` — routes Claude AI chat (keeps API key server-side)

---

## Cloudflare Workers AI

- **Binding:** `[ai]` in `wrangler-bot.toml`
- **Model:** `@cf/meta/llama-3.1-8b-instruct-fast`
- **Used by:** `/analyze-news` endpoint in bot-worker.js
- **Called by:** news.js → fetches `${hype_bot_url}/analyze-news`
- **Cost:** Free on Cloudflare Workers free tier (~31k tokens/day limit)
- **Input:** Top 10 news articles (title + body)
- **Output:** `{ sentiment: 'BULL'|'BEAR'|'NEUTRAL', coins: [], reasoning, timeframe }`

---

## Cloudflare Worker RSS Proxy

- **File:** `cloudflare/worker.js`
- **Config:** `cloudflare/wrangler.toml`
- **Purpose:** CORS proxy for RSS feeds that block direct browser fetches
- **Setting:** Settings tab → RSS Proxy URL → set after deploying

---

## CORS Relay Cascade (news.js)

RSS feeds are fetched via a 3-way race:

1. `https://api.allorigins.win/get?url=<feed>`
2. `https://corsproxy.io/?url=<feed>`
3. `https://api.rss2json.com/v1/api.json?rss_url=<feed>`

`Promise.any()` takes whichever resolves first. If all fail, source shows as failed in the status bar.

---

## Hyperliquid API Details

- **Base URL:** `https://api.hyperliquid.xyz/info`
- **Method:** POST with JSON body
- **Key request types:**

| `type` field | Returns |
|---|---|
| `metaAndAssetCtxs` | All perp metadata + asset contexts (OI, funding, mark price) |
| `clearinghouseState` | Positions, margin, account value for wallet |
| `userFills` | Trade fills for wallet |
| `candleSnapshot` | OHLCV candles for coin/interval |
| `userFundingHistory` | Funding payments for wallet |
| `historicalOrders` | Order history |

---

## Rate Limits & Caching

| Source | Cache | Notes |
|---|---|---|
| News articles | 5-min sessionStorage | Per-tab, cleared on page reload |
| AI news analysis | 30-min localStorage | `hype_news_ai_cache` key |
| Heatmap data | 60-second in-memory | `_hmCache` object |
| CoinGecko prices | Shared in-memory | `getCGSimplePrices()` with Kraken fallback |
| Intel tab | 3-min auto-refresh | Interval-based |
| Trend tab | Per-load | No cache, parallel coin fetches |

---

## localStorage Keys

| Key | Set by | Content |
|---|---|---|
| `hype_wallet` | Portfolio setup | Hyperliquid wallet address |
| `hype_tg_token` | Settings | Telegram bot token (dashboard alerts) |
| `hype_tg_chat` | Settings | Telegram chat ID |
| `hype_tg_threshold` | Settings | PnL alert threshold |
| `hype_coinglass_key` | On-chain settings | CoinGlass API key |
| `hype_cryptoquant_key` | On-chain settings | CryptoQuant API key |
| `hype_sb_url` | AI / Journal settings | Supabase project URL |
| `hype_sb_anon` | AI / Journal settings | Supabase anon key |
| `hype_bot_url` | News AI settings | Cloudflare bot worker URL |
| `hype_news_ai_cache` | news.js | Cached AI analysis results |
| `hype_rss_proxy` | Settings | Cloudflare RSS proxy URL |
