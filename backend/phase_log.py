"""
Phase log recorder — writes one CSV row per coin per hour and trims
records older than PHASE_RETENTION_DAYS.

CSV columns:
  timestamp, coin, interval, phase, confidence, score, price, signals
"""

import csv
import os
from datetime import datetime, timezone, timedelta

import hyperliquid as hl
from config import (WATCH_COINS, PHASE_LOG_CSV,
                    PHASE_RETENTION_DAYS, HL_API_URL)
from phase_detector import detect_phase, phase_to_dict

FIELDNAMES = ["timestamp", "coin", "interval", "phase",
              "confidence", "score", "price", "signals"]


# ── Read / write helpers
def _ensure_file():
    if not os.path.exists(PHASE_LOG_CSV):
        with open(PHASE_LOG_CSV, "w", newline="") as f:
            csv.DictWriter(f, fieldnames=FIELDNAMES).writeheader()


def read_log(coin: str | None = None) -> list[dict]:
    """Return all rows, optionally filtered by coin."""
    _ensure_file()
    rows = []
    with open(PHASE_LOG_CSV, newline="") as f:
        for row in csv.DictReader(f):
            if coin is None or row["coin"] == coin:
                rows.append(row)
    return rows


def _append_rows(rows: list[dict]):
    _ensure_file()
    with open(PHASE_LOG_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        for row in rows:
            w.writerow(row)


def trim_log(days: int = PHASE_RETENTION_DAYS):
    """Remove rows older than `days` from the CSV."""
    _ensure_file()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept, removed = [], 0
    with open(PHASE_LOG_CSV, newline="") as f:
        for row in csv.DictReader(f):
            try:
                ts = datetime.fromisoformat(row["timestamp"])
                if ts >= cutoff:
                    kept.append(row)
                else:
                    removed += 1
            except Exception:
                kept.append(row)   # keep malformed rows
    with open(PHASE_LOG_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(kept)
    if removed:
        print(f"[phase_log] trimmed {removed} old rows, kept {len(kept)}")
    return len(kept)


# ── Main recording task (called by scheduler every hour)
async def record_phases(coins: list[str] = WATCH_COINS, interval: str = "4h"):
    ts   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows = []

    for coin in coins:
        try:
            candles = await hl.get_candles(coin, interval, days_back=60)
            if not candles or len(candles) < 40:
                continue
            result = detect_phase(candles)
            pd     = phase_to_dict(result)

            # Get current price
            try:
                mids  = await hl.get_all_mids()
                price = mids.get(coin, "")
            except Exception:
                price = ""

            rows.append({
                "timestamp":  ts,
                "coin":       coin,
                "interval":   interval,
                "phase":      pd["phase"],
                "confidence": round(pd["confidence"], 4),
                "score":      round(pd.get("score", 0), 4),
                "price":      price,
                "signals":    "|".join(pd.get("signals", [])),
            })
            print(f"[phase_log] {coin:<6} {pd['phase']:<14} conf={pd['confidence']:.0%}")

        except Exception as e:
            print(f"[phase_log] {coin} error: {e}")

    if rows:
        _append_rows(rows)
        trim_log()

    return rows
