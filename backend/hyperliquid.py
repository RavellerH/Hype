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


async def get_token_balances(wallet: str) -> list:
    return await _post({"type": "tokenBalances", "user": wallet})


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
        positions.append({
            "coin": p.get("coin"),
            "side": "long" if szi > 0 else "short",
            "size": abs(szi),
            "entry_price": entry,
            "unrealized_pnl": unrealized_pnl,
            "leverage_type": leverage.get("type", "cross"),
            "leverage_value": leverage.get("value", 1),
            "liquidation_price": float(p.get("liquidationPx") or 0),
            "margin_used": float(p.get("marginUsed", 0) or 0),
            "position_value": float(p.get("positionValue", 0) or 0),
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
