"""
Phase recorder — appends a phase snapshot for each WATCH_COIN every hour
to phase_log.jsonl (JSON Lines format, one record per line).

Called automatically from main.py every RECORD_INTERVAL seconds.
Can also run standalone:  python phase_recorder.py
"""

import json
import time
import logging
import requests
from datetime import datetime, timezone

from config import HL_API_URL, WATCH_COINS
from phase_detector import detect_phase

logger = logging.getLogger(__name__)
LOG_FILE = "phase_log.jsonl"

_session = requests.Session()
_session.headers.update({"Content-Type": "application/json"})


def _fetch_candles(coin: str, interval: str = "4h", days: int = 60) -> list[dict]:
    now   = int(time.time() * 1000)
    start = now - days * 86400 * 1000
    try:
        r = _session.post(
            f"{HL_API_URL}/info",
            json={"type": "candleSnapshot",
                  "req": {"coin": coin, "interval": interval,
                          "startTime": start, "endTime": now}},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning("Candle fetch failed for %s: %s", coin, e)
        return []


def _get_price(coin: str) -> float:
    try:
        r = _session.post(f"{HL_API_URL}/info", json={"type": "allMids"}, timeout=10)
        r.raise_for_status()
        return float(r.json().get(coin, 0))
    except Exception:
        return 0.0


def record_snapshot(coins: list[str] = WATCH_COINS, interval: str = "4h") -> dict[str, dict]:
    """
    Fetch current phase for each coin and append to phase_log.jsonl.
    Returns {coin: phase_result} dict for immediate use.
    """
    ts      = datetime.now(timezone.utc).isoformat()
    results = {}

    for coin in coins:
        candles = _fetch_candles(coin, interval)
        if len(candles) < 40:
            logger.warning("Not enough candles for %s — skipping record", coin)
            continue

        phase = detect_phase(candles)
        price = _get_price(coin)

        record = {
            "ts":       ts,
            "coin":     coin,
            "interval": interval,
            "phase":    phase["phase"],
            "conf":     round(phase["confidence"], 4),
            "score":    round(phase["score"], 4),
            "price":    price,
            "signals":  phase["signals"],
        }

        try:
            with open(LOG_FILE, "a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as e:
            logger.error("Failed to write phase log: %s", e)

        results[coin] = phase
        logger.info("Recorded: %s  %-14s  conf=%.0f%%  price=%.4f",
                    coin, phase["phase"], phase["confidence"] * 100, price)

    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(levelname)-8s  %(message)s")
    print(f"Recording phase snapshot for {WATCH_COINS}...")
    results = record_snapshot()
    for coin, p in results.items():
        print(f"  {coin:<6}  {p['phase']:<14}  conf={p['confidence']:.0%}  score={p['score']:+.3f}")
