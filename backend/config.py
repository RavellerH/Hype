import os
from dotenv import load_dotenv

load_dotenv()

PRIMARY_WALLET = os.getenv("PRIMARY_WALLET", "0x6e4c6da09f06690cc4db53d42ab539d3d4882015")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))

# WhatsApp via CallMeBot (free — add +34 644 59 78 53 on WhatsApp and send: I allow callmebot to send me messages)
WHATSAPP_PHONE  = os.getenv("WHATSAPP_PHONE", "")   # international format: +1234567890
WHATSAPP_APIKEY = os.getenv("WHATSAPP_APIKEY", "")  # received from CallMeBot after above step

# Anthropic API — optional, enables LLM-powered answers in the AI/KB tab
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

HL_API_URL = "https://api.hyperliquid.xyz/info"
HL_WS_URL = "wss://api.hyperliquid.xyz/ws"

WATCH_COINS = ["BTC", "ETH", "SOL", "HYPE", "SUI", "AVAX"]
PHASE_RECORD_INTERVAL = 3600   # record every hour (seconds)
PHASE_RETENTION_DAYS  = 14     # keep 2 weeks of history
PHASE_LOG_CSV         = os.path.join(os.path.dirname(__file__), "phase_log.csv")
