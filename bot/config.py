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

# ── Risk parameters
MARGIN_PCT   = 0.10   # use 10% of account value per trade
MAX_LEVERAGE = 10     # hard cap (safe calc will lower this)
SL_PCT       = 0.25   # 25% stop-loss from entry
TP_PCT       = 0.75   # 75% take-profit from entry
MAX_OPEN_BOT_POSITIONS = 3

# ── Entry conditions
MIN_PHASE_CONFIDENCE = 0.40   # accumulation confidence threshold
MIN_VOLUME_RATIO     = 1.20   # recent vol must be 1.2× average
MIN_WALLET_SIGNALS   = 1      # at least 1 smart wallet must be long

# ── Coins the bot can trade
WATCH_COINS = ["BTC", "ETH", "SOL", "HYPE", "SUI", "AVAX"]

# ── Scan intervals (seconds)
PHASE_SCAN_INTERVAL  = 300    # 5 min
WALLET_SCAN_INTERVAL = 900    # 15 min
POSITION_POLL_INTERVAL = 30   # 30 sec (SL/TP monitor)

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
