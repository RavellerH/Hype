# Known Gaps & TODOs

Audit findings: stubs, partially wired features, and future work identified as of 2026-05-31.

---

## Unwired Environment Variables

### `BTC_GATE_PCT`
- **Defined in:** `wrangler-bot.toml [vars]` (default: `-5`)
- **Intent:** Skip bullish signal alerts if BTC 24h change is below this threshold (macro gate)
- **Status:** Variable is declared but never read in `checkSignals()` or any bot function
- **Fix:** In `checkSignals`, fetch BTC 24h change from Binance/HL and skip coin loop if below threshold

---

## Dashboard Stubs (nav items with partial/no implementation)

### Binance L/S Ratio History
- `signals.js` shows current L/S ratio per coin in the signal scanner table
- No historical chart or trend line — just the current snapshot value

### Binance OI History
- OI is shown as a current value and 24h change in several tabs
- No historical OI chart (sparkline or full chart) — referenced comments exist in app.js but functions are not implemented

---

## Modules with Unclear/Partial Status

### `nansen.js` — Smart Money
- 501 lines of wallet tracking code
- Loads via `loadNansen()` in the Smart Money tab
- Nansen is a paid on-chain analytics service — unclear if this uses the real Nansen API or a free simulation
- Check: does this require a Nansen API key? If so, it should be listed in the APIs doc and the settings panel

### `position-meta.js`
- 334 lines — per-position intent/thesis modal
- Wired into portfolio positions as a click-to-annotate feature
- Storage: unclear whether this persists to localStorage, Supabase, or is ephemeral per session

### `logger.js`
- 480 lines — data logger and portfolio snapshots
- Separate from the `dailySnapshot` in the bot and the `autojournal.js` daily snapshot
- Unclear if this creates redundant snapshots or handles a distinct use case (e.g. more frequent logging)
- Check: does it conflict with `autojournal.js` daily capture?

### `mvrv-ai.js` (1090 lines)
- Includes full Supabase client implementation
- Also contains AI commentary integration
- Very large file — likely contains functionality beyond just the MVRV tab (check for shared utilities used elsewhere)

---

## CORS Issues

### CoinGlass (browser)
- The CoinGlass API does not send CORS headers for browser requests
- Dashboard shows a notice: "Data loads normally from the Telegram bot"
- **Workaround options:**
  1. Route through the Cloudflare RSS proxy worker (extend it to proxy CoinGlass)
  2. Add a `/coinglass-proxy` endpoint to the bot worker with CORS headers

---

## Cooldown Asymmetry

- `checkReversals`, `checkOISpikes`, `checkLiqCascade`, `checkTrendAlignment` all use the `reversal` cooldown type (12h)
- `checkSignals` and `checkFundingArb` use their own cooldown types (4h)
- `checkFundingFlips` uses direct KV put with 86400s TTL (24h) — does not go through `isOnCooldown`/`setCooldown`
- Inconsistency: funding flip cooldown is effectively 24h vs 4h for other alerts. May result in missed flips if funding oscillates within a day

---

## Weekly Review Fires on All Sundays
- `weeklyReview` is triggered by cron `0 0 * * 0` (Sunday midnight UTC)
- But in `scheduled()`, the cron dispatcher checks `cron === '0 0 * * *'` (daily midnight) and calls `dailySnapshot`
- There is no separate `0 0 * * 0` branch in the cron dispatcher — both daily and weekly run on the daily midnight cron
- **Verify:** `weeklyReview` may never fire automatically unless the cron string in the dispatcher matches exactly

---

## AI News Analysis — Bot URL Dependency

- The dashboard's AI news analysis (`/analyze-news`) requires the user to manually enter their bot worker URL in the News tab settings
- If the URL is not set, `_analyzeTopArticles()` silently returns without analyzing
- No onboarding prompt or hint for new users — they may not know to set this

---

## BotFather Commands Outdated

- `/positions`, `/trend`, `/price`, `/status` were added to `handleTgCommand` but may not be listed in BotFather's command menu yet
- BotFather command list must be updated manually via `/setcommands`
- Current recommended list is in `docs/bot.md`

---

## Journal Duplication

- Two journal implementations exist: `autojournal.js` (auto-detection) and `journal.js` (manual Supabase)
- Both render into `#page-journal`
- The `navigate()` dispatcher calls `loadJournal` which maps to whichever `loadJournal` is defined last in script load order
- **Risk:** One may silently shadow the other depending on script tag order in `index.html`

---

## `BTC_GATE_PCT` Implementation Path

If you want to wire it in:

```js
// In checkSignals(env), before the coin loop:
const btcGatePct = parseFloat(env.BTC_GATE_PCT || '-5');
const btcCtx = (await getFundingRates())['BTC'];
if (btcCtx) {
  // Approximate 24h change from funding/price — or fetch Binance 24h ticker
  // If BTC 24h change < btcGatePct, skip bullish alerts (still allow bearish)
}
```

Full implementation requires a 24h BTC price change fetch (Binance `/fapi/v1/ticker/24hr?symbol=BTCUSDT`).

---

## Future Ideas (not yet planned)

- Portfolio heat map: color positions by PnL% in a grid view
- Delta-neutral arb P&L tracker: track cumulative funding collected on arb positions
- Alert configurability: per-coin thresholds in dashboard settings (vs global env vars)
- Telegram `/alerts` command: show/toggle which alert types are enabled
- On-chain regime score card in bot `/status` output
- CoinGlass CORS proxy: route browser CoinGlass calls through bot worker
