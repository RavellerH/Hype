import httpx
import time
from typing import Any
from config import HL_API_URL


async def _post(payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(HL_API_URL, json=payload)
        r.raise_for_status()
        return r.json()


# ── Perp positions & account state ───────────────────────────────────────────

async def get_clearinghouse_state(wallet: str) -> dict:
    return await _post({"type": "clearinghouseState", "user": wallet})


async def get_spot_state(wallet: str) -> dict:
    return await _post({"type": "spotClearinghouseState", "user": wallet})


async def get_spot_meta() -> dict:
    return await _post({"type": "spotMetaAndAssetCtxs"})


def parse_spot_balances(state: dict, spot_meta: dict, fills: list) -> dict:
    """Return spot balances with avg entry computed from entryNtl or fill history."""
    if not state or "balances" not in state:
        return {"balances": [], "usdc_balance": 0.0}

    meta_universe = (spot_meta[0].get("universe") if spot_meta and len(spot_meta) > 0 else None) or []
    asset_ctxs    = (spot_meta[1] if spot_meta and len(spot_meta) > 1 else None) or []

    # Build price map: coin → current price
    price_map: dict[str, float] = {}
    for i, u in enumerate(meta_universe):
        base = u.get("name", "").split("/")[0]
        px = float((asset_ctxs[i].get("midPx") or asset_ctxs[i].get("markPx") or 0) if i < len(asset_ctxs) else 0)
        if px > 0:
            price_map[base] = px

    # Build spot index map: "@N" → coin name
    spot_idx_map: dict[str, str] = {f"@{i}": u.get("name", "").split("/")[0] for i, u in enumerate(meta_universe)}

    # Compute avg entry per coin from fills (average cost method)
    holdings: dict[str, dict] = {}
    spot_fills = sorted(
        [f for f in (fills or []) if isinstance(f.get("coin"), str) and f["coin"].startswith("@")],
        key=lambda f: f.get("time", 0),
    )
    for f in spot_fills:
        coin = spot_idx_map.get(f["coin"])
        if not coin:
            continue
        size  = float(f.get("sz",  0) or 0)
        price = float(f.get("px",  0) or 0)
        if size <= 0 or price <= 0:
            continue
        if coin not in holdings:
            holdings[coin] = {"shares": 0.0, "cost": 0.0}
        h = holdings[coin]
        if f.get("side") == "B":
            h["cost"]   += size * price
            h["shares"] += size
        elif h["shares"] > 0:
            frac = min(size / h["shares"], 1.0)
            h["cost"]  *= (1.0 - frac)
            h["shares"] = max(h["shares"] - size, 0.0)

    usdc_entry = next((b for b in state["balances"] if b.get("coin") == "USDC"), None)
    usdc_balance = float(usdc_entry.get("total", 0) if usdc_entry else 0)

    balances = []
    for b in state["balances"]:
        if b.get("coin") == "USDC":
            continue
        total = float(b.get("total", 0) or 0)
        if total <= 0:
            continue
        coin  = b["coin"]
        # Prefer entryNtl from API; fall back to fill-computed avg
        entry_ntl = float(b.get("entryNtl", 0) or 0)
        avg_entry  = entry_ntl / total if (entry_ntl > 0 and total > 0) else 0.0

        if avg_entry == 0.0 and coin in holdings:
            h = holdings[coin]
            if h["shares"] > 1e-9:
                avg_entry  = h["cost"] / h["shares"]
                entry_ntl  = avg_entry * total

        current_price  = price_map.get(coin, 0.0)
        value          = current_price * total
        unrealized_pnl = (current_price - avg_entry) * total if (avg_entry > 0 and current_price > 0) else 0.0
        pnl_pct        = unrealized_pnl / entry_ntl * 100 if entry_ntl > 0 else 0.0

        if value > 0.01 or entry_ntl > 0:
            balances.append({
                "coin": coin, "total": total,
                "avg_entry": round(avg_entry, 6),
                "current_price": round(current_price, 6),
                "value": round(value, 4),
                "unrealized_pnl": round(unrealized_pnl, 4),
                "pnl_pct": round(pnl_pct, 4),
            })

    balances.sort(key=lambda b: b["value"], reverse=True)
    return {"balances": balances, "usdc_balance": round(usdc_balance, 4)}


# ── Trade fills ───────────────────────────────────────────────────────────────

async def get_user_fills(wallet: str) -> list:
    return await _post({"type": "userFills", "user": wallet})


async def get_user_fills_by_time(wallet: str, start_ms: int, end_ms: int | None = None) -> list:
    payload: dict = {"type": "userFillsByTime", "user": wallet, "startTime": start_ms}
    if end_ms:
        payload["endTime"] = end_ms
    return await _post(payload)


# ── Funding ───────────────────────────────────────────────────────────────────

async def get_user_funding(wallet: str, days_back: int = 30) -> list:
    start_ms = int((time.time() - days_back * 86400) * 1000)
    return await _post({"type": "userFunding", "user": wallet, "startTime": start_ms})


# ── Inflow / outflow (ledger) ─────────────────────────────────────────────────

async def get_ledger_updates(wallet: str, days_back: int = 90) -> list:
    start_ms = int((time.time() - days_back * 86400) * 1000)
    return await _post({"type": "userNonFundingLedgerUpdates", "user": wallet, "startTime": start_ms})


# ── Market data ───────────────────────────────────────────────────────────────

async def get_all_mids() -> dict:
    return await _post({"type": "allMids"})


async def get_meta() -> dict:
    return await _post({"type": "meta"})


async def get_candles(coin: str, interval: str = "1h", days_back: int = 7) -> list:
    end_ms = int(time.time() * 1000)
    start_ms = int((time.time() - days_back * 86400) * 1000)
    return await _post({
        "type": "candleSnapshot",
        "req": {"coin": coin, "interval": interval, "startTime": start_ms, "endTime": end_ms}
    })


async def get_orderbook(coin: str) -> dict:
    return await _post({"type": "l2Book", "coin": coin})


async def get_open_orders(wallet: str) -> list:
    return await _post({"type": "openOrders", "user": wallet})


async def get_meta_and_asset_ctxs() -> list:
    return await _post({"type": "metaAndAssetCtxs"})


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_positions(state: dict) -> list[dict]:
    positions = []
    for pos in state.get("assetPositions", []):
        p = pos.get("position", {})
        szi = float(p.get("szi", 0))
        if szi == 0:
            continue
        entry = float(p.get("entryPx", 0) or 0)
        unrealized_pnl = float(p.get("unrealizedPnl", 0) or 0)
        leverage = p.get("leverage", {})
        pos_value = float(p.get("positionValue", 0) or 0)
        size = abs(szi)
        mark_price = pos_value / size if size > 0 else entry
        positions.append({
            "coin": p.get("coin"),
            "side": "long" if szi > 0 else "short",
            "size": size,
            "entry_price": entry,
            "mark_price": round(mark_price, 6),
            "unrealized_pnl": unrealized_pnl,
            "leverage_type": leverage.get("type", "cross"),
            "leverage_value": leverage.get("value", 1),
            "liquidation_price": float(p.get("liquidationPx") or 0),
            "margin_used": float(p.get("marginUsed", 0) or 0),
            "position_value": pos_value,
            "cum_funding": float((p.get("cumFunding") or {}).get("sinceOpen", 0) or 0),
        })
    return positions


def parse_account_summary(state: dict) -> dict:
    margin = state.get("marginSummary", {})
    cross = state.get("crossMarginSummary", {})
    return {
        "account_value": float(margin.get("accountValue", 0) or 0),
        "total_margin_used": float(margin.get("totalMarginUsed", 0) or 0),
        "total_ntl_pos": float(margin.get("totalNtlPos", 0) or 0),
        "total_raw_usd": float(margin.get("totalRawUsd", 0) or 0),
        "cross_account_value": float(cross.get("accountValue", 0) or 0),
        "cross_margin_used": float(cross.get("totalMarginUsed", 0) or 0),
        "withdrawable": float(state.get("withdrawable", 0) or 0),
    }


def parse_fills(fills: list) -> list[dict]:
    result = []
    for f in fills:
        result.append({
            "time": f.get("time"),
            "coin": f.get("coin"),
            "side": f.get("side"),
            "price": float(f.get("px", 0)),
            "size": float(f.get("sz", 0)),
            "fee": float(f.get("fee", 0)),
            "closed_pnl": float(f.get("closedPnl", 0)),
            "order_id": f.get("oid"),
            "trade_id": f.get("tid"),
            "crossed": f.get("crossed", False),
        })
    return sorted(result, key=lambda x: x["time"], reverse=True)


def parse_funding(funding: list) -> list[dict]:
    result = []
    for f in funding:
        delta = f.get("delta", {})
        result.append({
            "time": f.get("time"),
            "coin": delta.get("coin"),
            "funding_rate": float(delta.get("fundingRate", 0)),
            "usdc": float(delta.get("usdc", 0)),
        })
    return sorted(result, key=lambda x: x["time"], reverse=True)


def parse_ledger(ledger: list) -> list[dict]:
    result = []
    for entry in ledger:
        delta = entry.get("delta", {})
        t = delta.get("type", "")
        usdc = float(delta.get("usdc", 0) or 0)
        result.append({
            "time": entry.get("time"),
            "type": t,
            "usdc": usdc,
            "direction": "inflow" if usdc > 0 else "outflow",
            "hash": delta.get("hash", ""),
        })
    return sorted(result, key=lambda x: x["time"], reverse=True)
