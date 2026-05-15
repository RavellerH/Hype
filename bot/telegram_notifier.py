"""Telegram notification helper."""

import logging
import requests
from config import TG_TOKEN, TG_CHAT_ID

logger = logging.getLogger(__name__)

_BASE = "https://api.telegram.org/bot{token}/{method}"


def _call(method: str, payload: dict) -> dict | None:
    if not TG_TOKEN:
        return None
    url = _BASE.format(token=TG_TOKEN, method=method)
    try:
        r = requests.post(url, json=payload, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("Telegram error: %s", e)
        return None


def send(text: str, chat_id: str = TG_CHAT_ID) -> bool:
    if not chat_id:
        logger.warning("TG_CHAT_ID not set — skipping notification")
        return False
    result = _call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
    return bool(result and result.get("ok"))


def get_chat_id() -> str | None:
    """Fetch chat ID from the most recent message sent to the bot."""
    result = _call("getUpdates", {"limit": 10, "timeout": 5})
    if not result or not result.get("ok"):
        return None
    updates = result.get("result", [])
    for upd in reversed(updates):
        msg = upd.get("message") or upd.get("channel_post")
        if msg and "chat" in msg:
            cid = str(msg["chat"]["id"])
            logger.info("Found chat_id: %s", cid)
            return cid
    logger.warning("No messages found — send a message to your bot first")
    return None


def notify_entry(coin: str, side: str, entry: float, sz: float,
                 sl: float, tp: float, leverage: int,
                 confidence: float, phase_coin: str, wallet_labels: list[str]) -> None:
    direction = "🟢 LONG" if side == "long" else "🔴 SHORT"
    wallets   = ", ".join(wallet_labels) if wallet_labels else "none"
    msg = (
        f"<b>🤖 BOT ENTRY</b>\n"
        f"{direction} <b>{coin}</b> ×{leverage}\n"
        f"Entry: <code>{entry:.4f}</code>\n"
        f"SL:    <code>{sl:.4f}</code>  (-25%)\n"
        f"TP:    <code>{tp:.4f}</code>  (+75%)\n"
        f"Size:  {sz:.4f} {coin}\n"
        f"Phase: {phase_coin} ACCUM {confidence*100:.0f}%\n"
        f"Smart wallets long: {wallets}"
    )
    send(msg)


def notify_exit(coin: str, side: str, pnl: float, reason: str) -> None:
    emoji = "✅" if pnl >= 0 else "❌"
    msg = (
        f"<b>{emoji} BOT EXIT</b>\n"
        f"{'LONG' if side=='long' else 'SHORT'} <b>{coin}</b> closed\n"
        f"PnL: <code>{'+'if pnl>=0 else ''}{pnl:.2f} USDC</code>\n"
        f"Reason: {reason}"
    )
    send(msg)


def notify_wallet_entry(label: str, coin: str, side: str, entry: float) -> None:
    emoji = "🟢" if side == "long" else "🔴"
    msg = (
        f"<b>👛 Smart Wallet Alert</b>\n"
        f"{emoji} <b>{label}</b> opened {side.upper()} <b>{coin}</b>\n"
        f"Entry: <code>{entry:.4f}</code>"
    )
    send(msg)


def notify_error(context: str, error: str) -> None:
    send(f"<b>⚠️ Bot Error</b>\n{context}\n<code>{error}</code>")
