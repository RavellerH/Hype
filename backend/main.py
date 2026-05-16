import asyncio
import json
import time
from contextlib import asynccontextmanager
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import hyperliquid as hl
from config import (
    POLL_INTERVAL, PRIMARY_WALLET, PHASE_RECORD_INTERVAL,
    WHATSAPP_PHONE, WHATSAPP_APIKEY,
)
from knowledge_base import kb
from phase_detector import detect_phase, phase_to_dict
from phase_log import record_phases, read_log, PHASE_LOG_CSV
from telegram_bot import dispatch_wallet_events
from wallet_tracker import (
    add_wallet,
    get_all_snapshots,
    load_watchlist,
    poll_all_wallets,
    remove_wallet,
    snapshot_wallet,
)
from whatsapp import send_whatsapp

# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active = [c for c in self.active if c != ws]

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
scheduler = AsyncIOScheduler()

# ── In-memory notification store ──────────────────────────────────────────────

notifications: list[dict] = []

def push_notification(event_type: str, message: str, data: dict | None = None):
    notif = {
        "id": int(time.time() * 1000),
        "type": event_type,
        "message": message,
        "data": data or {},
        "time": int(time.time()),
        "read": False,
    }
    notifications.insert(0, notif)
    if len(notifications) > 100:
        notifications.pop()
    return notif


# ── Background polling task ───────────────────────────────────────────────────

async def polling_task():
    try:
        events = await poll_all_wallets()
        if events:
            await dispatch_wallet_events(events)
            for e in events:
                notif = push_notification(e.get("type", "CHANGE"), str(e), e)
                await manager.broadcast({"event": "wallet_change", "notification": notif})

        # Broadcast updated primary wallet snapshot
        state = await hl.get_clearinghouse_state(PRIMARY_WALLET)
        summary = hl.parse_account_summary(state)
        positions = hl.parse_positions(state)
        await manager.broadcast({
            "event": "positions_update",
            "summary": summary,
            "positions": positions,
            "timestamp": int(time.time() * 1000),
        })
    except Exception as e:
        print(f"[poll] error: {e}")


# ── App lifecycle ─────────────────────────────────────────────────────────────

async def kb_snapshot_task():
    """Periodically snapshot live market data into the knowledge base."""
    try:
        state  = await hl.get_clearinghouse_state(PRIMARY_WALLET)
        summary = hl.parse_account_summary(state)
        positions = hl.parse_positions(state)
        kb.add_market_snapshot({"summary": summary, "positions": positions,
                                 "source": "hyperliquid", "timestamp": int(time.time())})
    except Exception as e:
        print(f"[kb_snapshot] error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    add_wallet(PRIMARY_WALLET, "My Wallet")

    # Index codebase on startup (runs in thread to avoid blocking)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, kb.index_codebase)
    print(f"[kb] indexed {kb.stats()['total_documents']} documents")

    scheduler.add_job(polling_task,   "interval", seconds=POLL_INTERVAL,          id="poller")
    scheduler.add_job(record_phases,  "interval", seconds=PHASE_RECORD_INTERVAL,  id="phase_recorder")
    scheduler.add_job(kb_snapshot_task, "interval", seconds=3600,                 id="kb_snapshot")
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="Hype Trade Analyzer", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend
import os
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def serve_dashboard():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse(os.path.join(FRONTEND_DIR, "manifest.json"), media_type="application/manifest+json")


@app.get("/sw.js")
async def serve_sw():
    return FileResponse(os.path.join(FRONTEND_DIR, "sw.js"), media_type="application/javascript")


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Wallet endpoints ──────────────────────────────────────────────────────────

@app.get("/api/positions")
async def get_positions(wallet: str = PRIMARY_WALLET):
    state = await hl.get_clearinghouse_state(wallet)
    return {
        "summary": hl.parse_account_summary(state),
        "positions": hl.parse_positions(state),
        "open_orders": await hl.get_open_orders(wallet),
    }


@app.get("/api/trades")
async def get_trades(wallet: str = PRIMARY_WALLET, limit: int = 100):
    fills = await hl.get_user_fills(wallet)
    parsed = hl.parse_fills(fills)
    return {"trades": parsed[:limit], "total": len(parsed)}


@app.get("/api/funding")
async def get_funding(wallet: str = PRIMARY_WALLET, days: int = 30):
    raw = await hl.get_user_funding(wallet, days_back=days)
    parsed = hl.parse_funding(raw)
    total_paid = sum(f["usdc"] for f in parsed)
    by_coin: dict[str, float] = {}
    for f in parsed:
        coin = f["coin"] or "?"
        by_coin[coin] = by_coin.get(coin, 0) + f["usdc"]
    return {
        "funding": parsed[:200],
        "total_usdc": round(total_paid, 4),
        "by_coin": by_coin,
    }


@app.get("/api/flows")
async def get_flows(wallet: str = PRIMARY_WALLET, days: int = 90):
    raw = await hl.get_ledger_updates(wallet, days_back=days)
    parsed = hl.parse_ledger(raw)
    total_in = sum(f["usdc"] for f in parsed if f["usdc"] > 0)
    total_out = sum(f["usdc"] for f in parsed if f["usdc"] < 0)
    return {
        "flows": parsed,
        "total_inflow": round(total_in, 2),
        "total_outflow": round(abs(total_out), 2),
        "net": round(total_in + total_out, 2),
    }


# ── Phase detection ───────────────────────────────────────────────────────────

@app.get("/api/phase/{coin}")
async def get_phase(coin: str, interval: str = "1h", days: int = 7):
    candles = await hl.get_candles(coin, interval, days_back=days)
    if not candles:
        raise HTTPException(404, f"No candle data for {coin}")
    result = detect_phase(candles)
    return {
        "coin": coin,
        "interval": interval,
        **phase_to_dict(result),
        "candle_count": len(candles),
    }


@app.get("/api/phase")
async def get_phases_for_positions(wallet: str = PRIMARY_WALLET, interval: str = "1h"):
    state = await hl.get_clearinghouse_state(wallet)
    positions = hl.parse_positions(state)
    results = []
    for pos in positions:
        coin = pos["coin"]
        try:
            candles = await hl.get_candles(coin, interval, days_back=7)
            result = detect_phase(candles)
            results.append({"coin": coin, **phase_to_dict(result)})
        except Exception:
            results.append({"coin": coin, "phase": "NEUTRAL", "error": "fetch failed"})
    return {"phases": results}


# ── Phase history ────────────────────────────────────────────────────────────

@app.get("/api/phase/history")
async def get_phase_history(coin: str | None = None, days: int = 14):
    """Return recorded phase log rows as JSON, newest first."""
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = read_log(coin)
    filtered = []
    for r in rows:
        try:
            ts = datetime.fromisoformat(r["timestamp"].replace(" ", "T") + "+00:00")
            if ts >= cutoff:
                filtered.append(r)
        except Exception:
            filtered.append(r)
    return {"rows": list(reversed(filtered)), "total": len(filtered)}


@app.get("/api/phase/history/export")
async def export_phase_csv():
    """Download the full phase_log.csv file."""
    from fastapi.responses import FileResponse
    if not os.path.exists(PHASE_LOG_CSV):
        raise HTTPException(404, "No phase log yet — wait for the first hourly recording")
    return FileResponse(
        PHASE_LOG_CSV,
        media_type="text/csv",
        filename="phase_log.csv",
    )


# ── Market data ───────────────────────────────────────────────────────────────

@app.get("/api/mids")
async def get_mids():
    return await hl.get_all_mids()


@app.get("/api/candles/{coin}")
async def get_candles_endpoint(coin: str, interval: str = "1h", days: int = 7):
    candles = await hl.get_candles(coin, interval, days_back=days)
    return {"coin": coin, "interval": interval, "candles": candles}


# ── MVRV Monitor (approx via CoinGecko free API) ──────────────────────────────

import httpx as _httpx

_mvrv_cache: dict = {}
_mvrv_cache_ts: float = 0.0
_MVRV_TTL = 300  # 5-minute cache to stay within CoinGecko free-tier rate limits

_MVRV_COINS = {
    "BTC":  "bitcoin",
    "ETH":  "ethereum",
    "SOL":  "solana",
    "HYPE": "hyperliquid",
}


def _mvrv_zone(ratio: float) -> str:
    if ratio >= 1.4:  return "OVERHEATED"
    if ratio >= 1.15: return "BULLISH"
    if ratio >= 0.85: return "NEUTRAL"
    return "UNDERVALUED"


@app.get("/api/mvrv")
async def get_mvrv():
    global _mvrv_cache, _mvrv_cache_ts
    if _mvrv_cache and (time.time() - _mvrv_cache_ts) < _MVRV_TTL:
        return _mvrv_cache

    results: dict[str, Any] = {}
    cg_base = "https://api.coingecko.com/api/v3"

    async with _httpx.AsyncClient(timeout=20.0) as client:
        try:
            ids_str = ",".join(_MVRV_COINS.values())
            r = await client.get(
                f"{cg_base}/simple/price",
                params={"ids": ids_str, "vs_currencies": "usd",
                        "include_market_cap": "true", "include_24hr_change": "true"},
            )
            prices_now = r.json() if r.status_code == 200 else {}
        except Exception:
            prices_now = {}

        for symbol, cg_id in _MVRV_COINS.items():
            now = prices_now.get(cg_id, {})
            current_price = now.get("usd") or 0.0
            market_cap    = now.get("usd_market_cap") or 0.0
            change_24h    = now.get("usd_24h_change") or 0.0

            chart: list[dict] = []
            mvrv    = 1.0
            avg_90d = current_price

            try:
                rh = await client.get(
                    f"{cg_base}/coins/{cg_id}/market_chart",
                    params={"vs_currency": "usd", "days": "90", "interval": "daily"},
                )
                if rh.status_code == 200:
                    raw = rh.json().get("prices", [])  # [[ts_ms, price], ...]
                    if len(raw) >= 10:
                        tss    = [p[0] for p in raw]
                        prices = [p[1] for p in raw]
                        avg_90d = sum(prices) / len(prices)
                        mvrv    = prices[-1] / avg_90d if avg_90d else 1.0
                        # Rolling 30-day window MVRV for the chart
                        for i in range(30, len(prices)):
                            window = prices[i - 30: i]
                            avg_w  = sum(window) / len(window)
                            chart.append({
                                "t": tss[i],
                                "v": round(prices[i] / avg_w, 4) if avg_w else 1.0,
                            })
            except Exception:
                pass

            results[symbol] = {
                "symbol":     symbol,
                "price":      current_price,
                "market_cap": market_cap,
                "change_24h": round(change_24h, 2),
                "mvrv":       round(mvrv, 4),
                "avg_90d":    round(avg_90d, 4),
                "zone":       _mvrv_zone(mvrv),
                "chart":      chart,
            }

    payload: dict[str, Any] = {
        "coins":   results,
        "source":  "CoinGecko · approx MVRV = price ÷ 90-day avg",
        "updated": int(time.time()),
    }
    _mvrv_cache    = payload
    _mvrv_cache_ts = time.time()
    return payload


# ── Watchlist ────────────────────────────────────────────────────────────────

class WalletBody(BaseModel):
    address: str
    label: str = ""


@app.get("/api/watchlist")
async def get_watchlist():
    wallets = load_watchlist()
    snapshots = get_all_snapshots()
    result = []
    for w in wallets:
        snap = snapshots.get(w["address"], {})
        result.append({**w, "snapshot": snap})
    return {"wallets": result}


@app.post("/api/watchlist")
async def add_to_watchlist(body: WalletBody):
    entry = add_wallet(body.address, body.label)
    # take initial snapshot
    try:
        snap = await snapshot_wallet(body.address)
        notif = push_notification("WALLET_ADDED", f"Watching {entry['label']}", snap)
        await manager.broadcast({"event": "notification", "notification": notif})
    except Exception:
        pass
    return entry


@app.delete("/api/watchlist/{address}")
async def remove_from_watchlist(address: str):
    ok = remove_wallet(address)
    if not ok:
        raise HTTPException(404, "Wallet not in watchlist")
    return {"removed": address}


@app.get("/api/watchlist/{address}/snapshot")
async def get_wallet_snapshot(address: str):
    snap = await snapshot_wallet(address)
    return snap


# ── Notifications ─────────────────────────────────────────────────────────────

@app.get("/api/notifications")
async def get_notifications():
    return {"notifications": notifications}


@app.post("/api/notifications/{notif_id}/read")
async def mark_read(notif_id: int):
    for n in notifications:
        if n["id"] == notif_id:
            n["read"] = True
            return n
    raise HTTPException(404, "Notification not found")


@app.post("/api/notifications/read-all")
async def mark_all_read():
    for n in notifications:
        n["read"] = True
    return {"ok": True}


# ── Telegram config ───────────────────────────────────────────────────────────

class TelegramConfig(BaseModel):
    bot_token: str
    chat_id: str


@app.post("/api/telegram/configure")
async def configure_telegram(body: TelegramConfig):
    import config as cfg
    cfg.TELEGRAM_BOT_TOKEN = body.bot_token
    cfg.TELEGRAM_CHAT_ID = body.chat_id

    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    lines = []
    keys_written = set()
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    lines.append(f"TELEGRAM_BOT_TOKEN={body.bot_token}\n")
                    keys_written.add("TELEGRAM_BOT_TOKEN")
                elif line.startswith("TELEGRAM_CHAT_ID="):
                    lines.append(f"TELEGRAM_CHAT_ID={body.chat_id}\n")
                    keys_written.add("TELEGRAM_CHAT_ID")
                else:
                    lines.append(line)
    if "TELEGRAM_BOT_TOKEN" not in keys_written:
        lines.append(f"TELEGRAM_BOT_TOKEN={body.bot_token}\n")
    if "TELEGRAM_CHAT_ID" not in keys_written:
        lines.append(f"TELEGRAM_CHAT_ID={body.chat_id}\n")
    with open(env_path, "w") as f:
        f.writelines(lines)
    return {"configured": True}


@app.get("/api/telegram/status")
async def telegram_status():
    from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
    return {"enabled": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)}


# ── Knowledge Base ────────────────────────────────────────────────────────────

class AskBody(BaseModel):
    question: str

class NoteBody(BaseModel):
    title: str
    content: str

class WhatsAppConfig(BaseModel):
    phone: str
    apikey: str


@app.get("/api/kb/stats")
async def kb_stats():
    return kb.stats()


@app.post("/api/kb/index")
async def kb_reindex():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, kb.index_codebase)
    return kb.stats()


@app.get("/api/kb/search")
async def kb_search(q: str, types: str = ""):
    doc_types = [t.strip() for t in types.split(",") if t.strip()] or None
    return {"results": kb.search(q, top_k=8, doc_types=doc_types)}


@app.post("/api/kb/ask")
async def kb_ask(body: AskBody):
    return await kb.ask(body.question)


@app.get("/api/kb/graph")
async def kb_graph():
    return kb.build_graph()


@app.get("/api/kb/wiki")
async def kb_wiki():
    return {"wiki": kb.generate_wiki()}


@app.get("/api/kb/notes")
async def kb_get_notes():
    return {"notes": kb.notes}


@app.post("/api/kb/notes")
async def kb_add_note(body: NoteBody):
    note = kb.add_note(body.title, body.content)
    return note


@app.delete("/api/kb/notes/{note_id:path}")
async def kb_delete_note(note_id: str):
    ok = kb.delete_note(note_id)
    if not ok:
        raise HTTPException(404, "Note not found")
    return {"deleted": note_id}


# ── WhatsApp config & alerts ──────────────────────────────────────────────────

def _write_env_keys(updates: dict[str, str]):
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    lines: list[str] = []
    written: set[str] = set()
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                key = line.split("=")[0]
                if key in updates:
                    lines.append(f"{key}={updates[key]}\n")
                    written.add(key)
                else:
                    lines.append(line)
    for key, val in updates.items():
        if key not in written:
            lines.append(f"{key}={val}\n")
    with open(env_path, "w") as f:
        f.writelines(lines)


@app.get("/api/whatsapp/status")
async def whatsapp_status():
    import config as cfg
    return {"enabled": bool(cfg.WHATSAPP_PHONE and cfg.WHATSAPP_APIKEY),
            "phone": cfg.WHATSAPP_PHONE or ""}


@app.post("/api/whatsapp/configure")
async def configure_whatsapp(body: WhatsAppConfig):
    import config as cfg
    cfg.WHATSAPP_PHONE  = body.phone
    cfg.WHATSAPP_APIKEY = body.apikey
    _write_env_keys({"WHATSAPP_PHONE": body.phone, "WHATSAPP_APIKEY": body.apikey})
    return {"configured": True}


@app.post("/api/whatsapp/test")
async def test_whatsapp():
    import config as cfg
    ok, status = await send_whatsapp(cfg.WHATSAPP_PHONE, cfg.WHATSAPP_APIKEY,
                                      "Hype alert test ✅ WhatsApp connected!")
    return {"ok": ok, "status": status}
