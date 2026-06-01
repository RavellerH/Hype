"""
Smart wallet monitor — polls Hyperliquid positions for tracked wallets.
Returns bullish signal if >= MIN_WALLET_SIGNALS wallets are long a coin.
"""

import logging
import requests
from config import HL_API_URL, SMART_WALLETS, MIN_WALLET_SIGNALS

logger = logging.getLogger(__name__)

_hl_session = requests.Session()
_hl_session.headers.update({"Content-Type": "application/json"})

_prev_positions: dict[str, dict] = {}   # wallet_label → {coin: {"side", "sz", "entry"}}
_new_entries:    list[dict]      = []    # buffer of fresh signals for main loop


def _hl_post(payload: dict) -> dict | list | None:
    try:
        r = _hl_session.post(f"{HL_API_URL}/info", json=payload, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("HL request failed: %s", e)
        return None


def fetch_wallet_positions(wallet_address: str) -> dict[str, dict]:
    """Returns {coin: {"side": "long"|"short", "sz": float, "entry": float}} for all open perp positions."""
    state = _hl_post({"type": "clearinghouseState", "user": wallet_address})
    if not state:
        return {}
    positions = {}
    for p in (state.get("assetPositions") or []):
        pos = p.get("position", {})
        sz  = float(pos.get("szi", 0))
        if sz == 0:
            continue
        coin = pos.get("coin", "")
        positions[coin] = {
            "side":  "long" if sz > 0 else "short",
            "sz":    abs(sz),
            "entry": float(pos.get("entryPx", 0)),
        }
    return positions


def scan_all_wallets() -> list[dict]:
    """
    Scans all SMART_WALLETS. Returns list of new-entry events:
    {"label": str, "wallet": str, "coin": str, "side": str, "sz": float, "entry": float}
    """
    global _prev_positions, _new_entries
    new_events = []

    for label, address in SMART_WALLETS.items():
        current = fetch_wallet_positions(address)
        prev    = _prev_positions.get(label, {})

        for coin, pos in current.items():
            if coin not in prev:
                event = {"label": label, "wallet": address, "coin": coin, **pos}
                new_events.append(event)
                logger.info("New wallet entry: %s opened %s %s", label, pos["side"], coin)

        _prev_positions[label] = current

    _new_entries = new_events
    return new_events


def get_wallet_longs(coin: str) -> list[str]:
    """Returns list of wallet labels currently long the given coin."""
    long_labels = []
    for label, positions in _prev_positions.items():
        if coin in positions and positions[coin]["side"] == "long":
            long_labels.append(label)
    return long_labels


def has_wallet_signal(coin: str) -> bool:
    """True if at least MIN_WALLET_SIGNALS wallets are long this coin."""
    return len(get_wallet_longs(coin)) >= MIN_WALLET_SIGNALS


def wallet_summary(coin: str) -> str:
    longs = get_wallet_longs(coin)
    if not longs:
        return "no smart wallet longs"
    return f"{len(longs)} wallet(s) long: {', '.join(longs)}"
