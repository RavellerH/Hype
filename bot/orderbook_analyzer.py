"""
Orderbook (L2) analysis — detects institutional/whale activity from the
resting order book, complementing the candle-based Wyckoff phase detector.

Signals:
  - OBI (Order Book Imbalance): bid vs ask volume within N levels of mid.
  - Wall detection: a single level holding far more size than its
    neighbours — often a large limit order from one player.
  - Wall persistence: tracked across polls so a wall that keeps refilling
    after being hit (iceberg) is distinguished from one that vanishes the
    moment price approaches it (spoofing).

Returns a single orderbook_score in [-1, 1] (positive = bid-side / bullish
pressure) meant to be blended into detect_phase()'s directional score.

Usage:
  from orderbook_analyzer import get_orderbook_signal
  sig = get_orderbook_signal("BTC")
  # sig = {"score": 0.24, "obi": 0.31, "walls": [...], "label": "BID_HEAVY"}
"""

import logging
import time

import requests

from config import HL_API_URL

logger = logging.getLogger(__name__)

_session = requests.Session()
_session.headers.update({"Content-Type": "application/json"})

DEPTH          = 15     # levels per side to consider for OBI
WALL_MULT      = 4.0    # a level is a "wall" if size > WALL_MULT x median level size
WALL_TRACK_TTL = 3600   # forget a tracked wall if not seen for this long (seconds)

# {coin: {price: {"side": "bid"/"ask", "sz": float, "first_seen": ts, "last_seen": ts, "hits": int}}}
_wall_history: dict[str, dict[float, dict]] = {}


def _fetch_l2_book(coin: str) -> dict | None:
    try:
        r = _session.post(f"{HL_API_URL}/info", json={"type": "l2Book", "coin": coin}, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("Orderbook fetch failed for %s: %s", coin, e)
        return None


def _levels(book: dict, side_idx: int) -> list[dict]:
    """side_idx 0 = bids, 1 = asks. Each level: {"px": str, "sz": str, "n": int}."""
    try:
        return book["levels"][side_idx]
    except (KeyError, IndexError, TypeError):
        return []


def compute_obi(bids: list[dict], asks: list[dict], depth: int = DEPTH) -> float:
    """Order Book Imbalance in [-1, 1]. Positive = more bid-side volume."""
    bid_vol = sum(float(l["sz"]) for l in bids[:depth])
    ask_vol = sum(float(l["sz"]) for l in asks[:depth])
    total = bid_vol + ask_vol
    if total == 0:
        return 0.0
    return (bid_vol - ask_vol) / total


def detect_walls(levels: list[dict], side: str, depth: int = DEPTH, mult: float = WALL_MULT) -> list[dict]:
    """Flags levels whose size is an outlier vs the local median — likely a single large order."""
    sizes = [float(l["sz"]) for l in levels[:depth]]
    if len(sizes) < 4:
        return []
    sorted_sizes = sorted(sizes)
    median = sorted_sizes[len(sorted_sizes) // 2] or 1e-9

    walls = []
    for l in levels[:depth]:
        sz = float(l["sz"])
        if sz >= median * mult:
            walls.append({"side": side, "px": float(l["px"]), "sz": sz, "ratio": round(sz / median, 1)})
    return walls


def _track_walls(coin: str, walls: list[dict]) -> list[dict]:
    """Updates wall history and annotates each wall with persistence info.
    A wall seen across multiple consecutive polls without being pulled is
    weighted more heavily (likely real size, not spoofing)."""
    now = time.time()
    hist = _wall_history.setdefault(coin, {})

    # Drop stale entries
    for px in list(hist):
        if now - hist[px]["last_seen"] > WALL_TRACK_TTL:
            del hist[px]

    seen_px = set()
    for w in walls:
        px = round(w["px"], 6)
        seen_px.add(px)
        if px in hist:
            hist[px]["last_seen"] = now
            hist[px]["hits"] += 1
            hist[px]["sz"] = w["sz"]
        else:
            hist[px] = {"side": w["side"], "sz": w["sz"], "first_seen": now, "last_seen": now, "hits": 1}
        w["persistence"] = hist[px]["hits"]
        w["is_new"] = hist[px]["hits"] == 1

    # Mark walls that just disappeared this poll (pulled / spoofed / absorbed)
    pulled = [px for px in hist if px not in seen_px and now - hist[px]["last_seen"] < 60]
    for px in pulled:
        logger.info("%s: wall at %.4f (%s) pulled after %d sightings",
                    coin, px, hist[px]["side"], hist[px]["hits"])

    return walls


def get_orderbook_signal(coin: str) -> dict:
    """Returns {"score", "obi", "mid", "spread_pct", "walls", "label"}.
    score is in [-1, 1]: positive = bid-side / bullish pressure building."""
    book = _fetch_l2_book(coin)
    if not book:
        return {"score": 0.0, "obi": 0.0, "mid": 0.0, "spread_pct": 0.0, "walls": [], "label": "NO_DATA"}

    bids = _levels(book, 0)
    asks = _levels(book, 1)
    if not bids or not asks:
        return {"score": 0.0, "obi": 0.0, "mid": 0.0, "spread_pct": 0.0, "walls": [], "label": "NO_DATA"}

    best_bid = float(bids[0]["px"])
    best_ask = float(asks[0]["px"])
    mid = (best_bid + best_ask) / 2
    spread_pct = (best_ask - best_bid) / mid if mid else 0.0

    obi = compute_obi(bids, asks)

    bid_walls = detect_walls(bids, "bid")
    ask_walls = detect_walls(asks, "ask")
    walls = _track_walls(coin, bid_walls + ask_walls)

    # Wall bias: persistent (hits>=2) bid walls close to mid = support building (bullish);
    # persistent ask walls = resistance (bearish). New (hits==1) walls count for half —
    # could be spoofing until proven otherwise.
    wall_bias = 0.0
    for w in walls:
        weight = 1.0 if w["persistence"] >= 2 else 0.5
        wall_bias += weight if w["side"] == "bid" else -weight
    wall_bias = max(-1.0, min(1.0, wall_bias / 4.0))   # normalize, clamp

    score = max(-1.0, min(1.0, obi * 0.65 + wall_bias * 0.35))

    if score > 0.25:
        label = "BID_HEAVY"
    elif score < -0.25:
        label = "ASK_HEAVY"
    else:
        label = "NEUTRAL"

    return {
        "score": round(score, 4),
        "obi": round(obi, 4),
        "mid": mid,
        "spread_pct": round(spread_pct, 5),
        "walls": walls,
        "label": label,
    }
