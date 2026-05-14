"""
Wallet watchlist — tracks multiple wallets and detects significant changes.
Stored in-memory for the session; persist via wallets.json for across restarts.
"""

import json
import os
import time
from typing import Any
from hyperliquid import get_clearinghouse_state, parse_positions, parse_account_summary

WATCHLIST_FILE = os.path.join(os.path.dirname(__file__), "wallets.json")

# In-memory state: wallet -> last snapshot
_snapshots: dict[str, dict] = {}


def load_watchlist() -> list[dict]:
    if not os.path.exists(WATCHLIST_FILE):
        return []
    with open(WATCHLIST_FILE) as f:
        return json.load(f)


def save_watchlist(wallets: list[dict]) -> None:
    with open(WATCHLIST_FILE, "w") as f:
        json.dump(wallets, f, indent=2)


def add_wallet(address: str, label: str = "") -> dict:
    wallets = load_watchlist()
    address = address.lower()
    existing = next((w for w in wallets if w["address"] == address), None)
    if existing:
        return existing
    entry = {"address": address, "label": label or address[:8] + "...", "added_at": int(time.time())}
    wallets.append(entry)
    save_watchlist(wallets)
    return entry


def remove_wallet(address: str) -> bool:
    wallets = load_watchlist()
    address = address.lower()
    before = len(wallets)
    wallets = [w for w in wallets if w["address"] != address]
    if len(wallets) < before:
        save_watchlist(wallets)
        return True
    return False


async def snapshot_wallet(address: str) -> dict:
    state = await get_clearinghouse_state(address)
    summary = parse_account_summary(state)
    positions = parse_positions(state)
    snap = {
        "address": address,
        "timestamp": int(time.time() * 1000),
        "summary": summary,
        "positions": positions,
        "position_count": len(positions),
        "coins": [p["coin"] for p in positions],
    }
    return snap


def diff_snapshots(prev: dict, curr: dict) -> list[dict]:
    """Return list of meaningful changes between two snapshots."""
    changes: list[dict] = []

    prev_coins = set(prev.get("coins", []))
    curr_coins = set(curr.get("coins", []))

    for coin in curr_coins - prev_coins:
        pos = next((p for p in curr["positions"] if p["coin"] == coin), {})
        changes.append({
            "type": "POSITION_OPENED",
            "coin": coin,
            "side": pos.get("side"),
            "size": pos.get("size"),
            "entry_price": pos.get("entry_price"),
        })

    for coin in prev_coins - curr_coins:
        changes.append({"type": "POSITION_CLOSED", "coin": coin})

    for coin in curr_coins & prev_coins:
        prev_pos = next((p for p in prev["positions"] if p["coin"] == coin), {})
        curr_pos = next((p for p in curr["positions"] if p["coin"] == coin), {})
        prev_size = prev_pos.get("size", 0)
        curr_size = curr_pos.get("size", 0)
        if abs(curr_size - prev_size) / max(prev_size, 1e-9) > 0.1:
            changes.append({
                "type": "SIZE_CHANGED",
                "coin": coin,
                "prev_size": prev_size,
                "curr_size": curr_size,
                "delta_pct": round((curr_size - prev_size) / prev_size * 100, 2),
            })

    prev_val = prev.get("summary", {}).get("account_value", 0)
    curr_val = curr.get("summary", {}).get("account_value", 0)
    if prev_val > 0 and abs(curr_val - prev_val) / prev_val > 0.05:
        changes.append({
            "type": "ACCOUNT_VALUE_CHANGE",
            "prev_value": prev_val,
            "curr_value": curr_val,
            "delta_pct": round((curr_val - prev_val) / prev_val * 100, 2),
        })

    return changes


async def poll_all_wallets() -> list[dict]:
    """Poll every wallet in the watchlist, return list of change events."""
    wallets = load_watchlist()
    events: list[dict] = []

    for w in wallets:
        addr = w["address"]
        try:
            curr = await snapshot_wallet(addr)
            prev = _snapshots.get(addr)
            if prev:
                diffs = diff_snapshots(prev, curr)
                for d in diffs:
                    events.append({**d, "wallet": addr, "label": w.get("label", "")})
            _snapshots[addr] = curr
        except Exception as e:
            events.append({"type": "ERROR", "wallet": addr, "error": str(e)})

    return events


def get_all_snapshots() -> dict[str, Any]:
    return dict(_snapshots)
