"""
Wyckoff-inspired phase detection.
Phases: ACCUMULATION | MARKUP | DISTRIBUTION | MARKDOWN | NEUTRAL

Logic:
  - Uses recent OHLCV candles for the given coin
  - Computes price trend, volume trend, and price range compression
  - Combines signals into a phase score
"""

import math
from dataclasses import dataclass
from typing import Literal

Phase = Literal["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN", "NEUTRAL"]

# Logistic calibration of confidence = P(direction implied by score is correct),
# fitted via bot/calibrate_confidence.py against forward returns on synthetic
# Wyckoff cycles (12 seeds x 365d, 10-candle horizon). Replaces the previous
# arbitrary `abs(score) + length bonus` heuristic with an actual probability.
CONFIDENCE_A = 3.4847
CONFIDENCE_B = -1.1124


@dataclass
class PhaseResult:
    phase: Phase
    confidence: float          # 0-1
    price_trend: str           # "up" | "down" | "flat"
    volume_trend: str          # "expanding" | "contracting" | "neutral"
    range_compression: bool    # tight price range → possible accumulation or distribution
    signals: list[str]         # human-readable reasons
    score: float               # raw score -1 to +1 (positive = bullish accumulation)


def detect_phase(candles: list[dict]) -> PhaseResult:
    """
    candles: list of dicts with keys t, o, h, l, c, v
    Expects at least 20 candles for meaningful detection.
    """
    if len(candles) < 10:
        return PhaseResult(
            phase="NEUTRAL", confidence=0.0,
            price_trend="flat", volume_trend="neutral",
            range_compression=False, signals=["Not enough candles"], score=0.0
        )

    closes = [float(c["c"]) for c in candles]
    volumes = [float(c["v"]) for c in candles]
    highs = [float(c["h"]) for c in candles]
    lows = [float(c["l"]) for c in candles]

    n = len(candles)
    half = n // 2

    # Price trend: compare first half avg vs second half avg
    early_close = sum(closes[:half]) / half
    late_close = sum(closes[half:]) / (n - half)
    price_change_pct = (late_close - early_close) / early_close if early_close else 0

    if price_change_pct > 0.03:
        price_trend = "up"
    elif price_change_pct < -0.03:
        price_trend = "down"
    else:
        price_trend = "flat"

    # Volume trend: compare last quarter vs first quarter
    qtr = max(n // 4, 1)
    early_vol = sum(volumes[:qtr]) / qtr
    late_vol = sum(volumes[-qtr:]) / qtr
    vol_change_pct = (late_vol - early_vol) / early_vol if early_vol else 0

    if vol_change_pct > 0.2:
        volume_trend = "expanding"
    elif vol_change_pct < -0.2:
        volume_trend = "contracting"
    else:
        volume_trend = "neutral"

    # Range compression: last 1/4 candles vs whole period
    full_range = max(highs) - min(lows) if max(highs) != min(lows) else 1
    recent_range = max(highs[-qtr:]) - min(lows[-qtr:])
    range_ratio = recent_range / full_range
    range_compression = range_ratio < 0.35

    # Compute directional score
    signals: list[str] = []
    score = 0.0

    # Price trend signals
    if price_trend == "up":
        score += 0.3
        signals.append("Price trending up")
    elif price_trend == "down":
        score -= 0.3
        signals.append("Price trending down")
    else:
        signals.append("Price flat / sideways")

    # Volume + price combo signals
    if price_trend == "flat" and volume_trend == "contracting" and range_compression:
        score += 0.4
        signals.append("Tight range with low volume → possible accumulation")
    elif price_trend == "up" and volume_trend == "expanding":
        score += 0.35
        signals.append("Price up + volume expanding → markup/breakout")
    elif price_trend == "flat" and volume_trend == "expanding":
        score -= 0.15
        signals.append("Flat price + rising volume → possible absorption or distribution")
    elif price_trend == "down" and volume_trend == "expanding":
        score -= 0.4
        signals.append("Price down + volume expanding → markdown/selling pressure")
    elif price_trend == "down" and volume_trend == "contracting":
        score -= 0.2
        signals.append("Price down + volume drying up → possible exhaustion")

    if range_compression:
        signals.append("Price range compressed (potential breakout setup)")

    # Volume spike check: last candle vs avg
    avg_vol = sum(volumes[:-1]) / max(len(volumes) - 1, 1)
    last_vol = volumes[-1]
    if last_vol > avg_vol * 2:
        signals.append(f"Volume spike on last candle ({last_vol / avg_vol:.1f}x avg)")
        if closes[-1] > closes[-2]:
            score += 0.1
        else:
            score -= 0.1

    # Clamp score
    score = max(-1.0, min(1.0, score))

    # Determine phase
    if score >= 0.55:
        phase: Phase = "MARKUP"
    elif score >= 0.2:
        phase = "ACCUMULATION"
    elif score <= -0.55:
        phase = "MARKDOWN"
    elif score <= -0.2:
        phase = "DISTRIBUTION"
    else:
        phase = "NEUTRAL"

    confidence = 1.0 / (1.0 + math.exp(-(CONFIDENCE_A * abs(score) + CONFIDENCE_B)))

    return PhaseResult(
        phase=phase,
        confidence=round(confidence, 3),
        price_trend=price_trend,
        volume_trend=volume_trend,
        range_compression=range_compression,
        signals=signals,
        score=round(score, 4),
    )


def phase_to_dict(r: PhaseResult) -> dict:
    return {
        "phase": r.phase,
        "confidence": r.confidence,
        "score": r.score,
        "price_trend": r.price_trend,
        "volume_trend": r.volume_trend,
        "range_compression": r.range_compression,
        "signals": r.signals,
    }
