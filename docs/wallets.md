# Wallet monitor — Rabby (EVM) & Phantom (Solana)

Read-only tracking of public wallet addresses. Nothing connects to the wallet
extension and nothing is signed — **never paste a seed phrase or private key**.

## What is tracked

| Wallet | Coverage | Source (keyless) |
|---|---|---|
| Rabby / any `0x…` | Ethereum, Base, Arbitrum, Optimism, Polygon, Gnosis — native + ERC-20 | Blockscout v2 (`<chain>.blockscout.com`) |
| | HyperEVM native HYPE | `rpc.hyperliquid.xyz/evm` |
| | Hyperliquid account of the same address (perps equity + spot) | Hyperliquid info API |
| Phantom / Solana | SOL + SPL and Token-2022 tokens | Solana JSON-RPC + Jupiter Price v3 |

Tokens without a USD price are hidden (mostly spam airdrops). Not covered yet:
BNB Chain / Avalanche, ERC-20s on HyperEVM, DeFi positions (LP, lending),
Solana native stake accounts, NFTs.

## Dashboard — Wallets tab

Add addresses in the tab (stored in this browser's localStorage only). It
refreshes every 5 minutes while open and keeps a local net-worth history.
Solana reads try your own RPC (if set in the tab) first, then PublicNode,
OnFinality and the official endpoint — the official one returns 403 to browsers.
A free Helius key is the most reliable option. Blockscout 5xx/429 responses
(599 = upstream timeout) are retried twice; a chain that still fails is shown
as a warning and the total is marked incomplete.

## Telegram alerts — bot worker

1. In the Wallets tab click **Copy WATCH_WALLETS for the bot**.
2. `cd cloudflare && npx wrangler secret put WATCH_WALLETS --config wrangler-bot.toml` and paste.
   Format: `Rabby main:0xabc…,Phantom:7xyz…` (kept as a secret so addresses stay out of the repo).
3. Redeploy: `npx wrangler deploy --config wrangler-bot.toml` (adds the hourly `10 * * * *` cron).

Hourly check (`checkWallets`):

- **Value move** — total changed ≥ `WALLET_ALERT_PCT` (default 5%) since the last alert.
- **In/outflow** — a token's *amount* (not price) changed ≥ 10% and ≥ `WALLET_MIN_USD`
  (default $100), or a holding disappeared → transfer or swap.
- **Daily summary** at 00:10 UTC with the 24h change.
- No alert is sent when any source failed that hour — a failed chain would otherwise look like funds leaving.

Commands / endpoints: `/wallets` (Telegram), `GET /run-wallets` (manual check).
Optional vars: `WALLET_CHAINS` (e.g. `Ethereum,Base,Arbitrum` to cut subrequests), `SOLANA_RPC`.
Each EVM wallet costs ~15 subrequests and each Solana wallet ~3 per run; the free
Workers plan allows 50 per invocation, so with more than ~3 EVM wallets set `WALLET_CHAINS`.
