import os
from dotenv import load_dotenv

load_dotenv()

# ── Wallet
PRIVATE_KEY      = os.getenv("HL_PRIVATE_KEY", "")
WALLET_ADDRESS   = os.getenv("HL_WALLET_ADDRESS", "")

# ── Telegram
TG_TOKEN   = os.getenv("TG_TOKEN", "")
TG_CHAT_ID = os.getenv("TG_CHAT_ID", "")

# ── Hyperliquid API
HL_API_URL = "https://api.hyperliquid.xyz"

# ── Network — set HL_TESTNET=1 in .env to run against Hyperliquid testnet
USE_TESTNET = os.getenv("HL_TESTNET", "0") == "1"

# ── Risk parameters (high-aggressive preset)
MARGIN_PCT   = 0.20   # use 20% of account value per trade
MAX_LEVERAGE = 15     # ceiling; safe_leverage() still caps to keep SL ahead of liquidation
SL_PCT       = 0.08   # 8% SL — at this SL, safe_leverage() caps effective max to ~11x
TP_PCT_FIXED = 0.75   # fallback fixed TP if phase never changes
MAX_OPEN_BOT_POSITIONS = 3

# ── Dynamic exit strategy
# PHASE_EXIT: close when phase flips to DISTRIBUTION or MARKDOWN
# TRAIL_BREAKEVEN: move SL to breakeven once phase reaches MARKUP
PHASE_EXIT        = True
TRAIL_BREAKEVEN   = True

# ── DSL (Dynamic Stop Loss) ratcheting trailing stop tiers
# (price_gain_pct, lock_fraction): at +X% price gain, SL locks lock_frac of that gain.
# Example: at +10%, SL = entry + 3.5%; at +20%, SL = entry + 11%; at +35%, SL = entry + 24.5%.
# Inspired by Senpi AI's two-phase DSL exit engine.
DSL_TIERS = [
    (0.10, 0.35),
    (0.20, 0.55),
    (0.35, 0.70),
]

# ── Entry conditions (high-aggressive preset)
MIN_PHASE_CONFIDENCE  = 0.25   # accumulation confidence threshold
MIN_VOLUME_RATIO      = 1.20   # recent vol must be 1.2× average
MIN_CONFLUENCE_SCORE  = 3      # minimum score (0-10) to allow entry
MIN_WALLET_SIGNALS    = 1      # used by wallet_monitor.has_wallet_signal() (unused by main.py's
                                # entry logic — smart-wallet confirmation there is an optional
                                # confluence score bonus only, not a required gate)

# ── Funding rate filter (8h rate from metaAndAssetCtxs)
# Skip long entry if funding is extremely positive (crowded longs paying too much)
MAX_LONG_FUNDING_RATE  = 0.0020   # 0.20% per 8h — too crowded to go long
# Skip short entry if funding is extremely negative (crowded shorts)
MAX_SHORT_FUNDING_RATE = 0.0015   # 0.15% per 8h short funding ceiling

# ── Risk guardrails
MAX_DAILY_LOSS_PCT     = 0.03   # halt new entries if realized daily loss > 3% account
MAX_CONSECUTIVE_LOSSES = 3      # halt new entries after N straight losing trades
HALT_HOURS             = 24     # cool-down period in hours after guardrail trips
ASSET_COOLDOWN_MINUTES = 120    # per-asset cool-down (minutes) after a loss on that asset

# ── BTC macro gate: skip entries if BTC 4h move is hostile (blocks trades into momentum)
BTC_MACRO_GATE_PCT  = 0.05   # block long if BTC 4h dropped >5%; short if BTC 4h gained >5%

# ── LLM veto layer: route through Supabase llm-router Edge Function
# Set LLM_ROUTER_URL=https://xxx.supabase.co/functions/v1/llm-router in .env to enable.
LLM_ROUTER_URL        = os.getenv("LLM_ROUTER_URL", "")
LLM_VETO_ENABLED      = bool(LLM_ROUTER_URL) or bool(os.getenv("ANTHROPIC_API_KEY", ""))
LLM_VETO_MIN_SCORE    = 6       # only run LLM veto when confluence score >= this

# ── Coins the bot can trade (priority order)
WATCH_COINS = ["BTC", "HYPE", "SOL", "ETH"]

# ── Scan intervals (seconds)
PHASE_SCAN_INTERVAL    = 300    # 5 min
WALLET_SCAN_INTERVAL   = 900    # 15 min
POSITION_POLL_INTERVAL = 30     # 30 sec (SL/TP monitor)

# ── Smart wallets to monitor
# Format: { "label": "address" }
# Machi Big Brother is intentionally excluded (consistent loser — reverse indicator).
SMART_WALLETS = {
    "Abraxas Capital":     "0x5b5d51203a0f9079f8aeb098a6523a13f298c060",
    "James Wynn":          "0x5078C2fBeA2b2aD61bc840Bc023E35Fce56BeDb6",
    "qwatio":              "0xf3F496C9486BE5924a93D67e98298733Bb47057c",
    "HLP Whale":           "0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae",
    "Hyperliquid Whale 5": "0x0903ee80f4f2cad5f2b5a9f97eb45f5b4e5c2e4a",
    "Hyperliquid Whale 6": "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12",
    "Hyperliquid Whale 7": "0x2b3c4d5e6f7890abcdef1234567890abcdef1234",
    "Hyperliquid Whale 8": "0x3c4d5e6f7890abcdef1234567890abcdef123456",
    "Hyperliquid Whale 9": "0x4d5e6f7890abcdef1234567890abcdef12345678",
    "Hyperliquid Whale 10":"0x5e6f7890abcdef1234567890abcdef1234567890",
}
# NOTE: Replace placeholder wallets 5-10 with real addresses.
# Source candidates from: Hyperliquid leaderboard (top realized PnL, 30d+),
# Nansen "Smart Money" tag, or Lookonchain Twitter alerts.
