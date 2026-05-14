"""
Telegram alert dispatcher.
Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to activate.
"""

import httpx
from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID


def _enabled() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


async def send_message(text: str) -> bool:
    if not _enabled():
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload)
            return r.status_code == 200
    except Exception:
        return False


async def alert_position_opened(coin: str, side: str, size: float, entry: float, wallet: str = "") -> None:
    prefix = f"👛 <b>{wallet[:8]}...</b>\n" if wallet else ""
    direction = "🟢 LONG" if side == "long" else "🔴 SHORT"
    await send_message(
        f"{prefix}📂 Position Opened\n"
        f"{direction} <b>{coin}</b>\n"
        f"Size: {size:.4f}  Entry: ${entry:,.2f}"
    )


async def alert_position_closed(coin: str, wallet: str = "") -> None:
    prefix = f"👛 <b>{wallet[:8]}...</b>\n" if wallet else ""
    await send_message(f"{prefix}📁 Position Closed: <b>{coin}</b>")


async def alert_size_change(coin: str, prev: float, curr: float, delta_pct: float, wallet: str = "") -> None:
    prefix = f"👛 <b>{wallet[:8]}...</b>\n" if wallet else ""
    arrow = "⬆️" if curr > prev else "⬇️"
    await send_message(
        f"{prefix}{arrow} Size Change: <b>{coin}</b>\n"
        f"{prev:.4f} → {curr:.4f} ({delta_pct:+.1f}%)"
    )


async def alert_flow(direction: str, usdc: float, tx_type: str) -> None:
    icon = "💵" if direction == "inflow" else "💸"
    await send_message(
        f"{icon} <b>{direction.upper()}</b>\n"
        f"${abs(usdc):,.2f}  [{tx_type}]"
    )


async def alert_phase_change(coin: str, phase: str, confidence: float) -> None:
    icons = {
        "ACCUMULATION": "🔵", "MARKUP": "🚀",
        "DISTRIBUTION": "🟡", "MARKDOWN": "🔻", "NEUTRAL": "⚪"
    }
    icon = icons.get(phase, "⚪")
    await send_message(
        f"{icon} Phase Detected: <b>{coin}</b>\n"
        f"Phase: {phase}  Confidence: {confidence:.0%}"
    )


async def dispatch_wallet_events(events: list[dict]) -> None:
    for event in events:
        t = event.get("type")
        wallet = event.get("wallet", "")
        if t == "POSITION_OPENED":
            await alert_position_opened(
                event["coin"], event.get("side", ""), event.get("size", 0),
                event.get("entry_price", 0), wallet
            )
        elif t == "POSITION_CLOSED":
            await alert_position_closed(event["coin"], wallet)
        elif t == "SIZE_CHANGED":
            await alert_size_change(
                event["coin"], event["prev_size"], event["curr_size"],
                event["delta_pct"], wallet
            )
