"""
Wyckoff phase detector — ported from app.js detectPhase().
Returns {"phase": str, "confidence": float, "score": float, "signals": list}
"""

from indicators import ema, macd, rsi, atr, volume_ratio, parse_candles


PHASES = {
    "MARKUP":       (0.45, float("inf")),
    "ACCUMULATION": (0.12, 0.44),
    "NEUTRAL":      (-0.11, 0.11),
    "DISTRIBUTION": (-0.44, -0.12),
    "MARKDOWN":     (float("-inf"), -0.45),
}


def detect_phase(raw_candles: list[dict]) -> dict:
    if len(raw_candles) < 60:
        return {"phase": "NEUTRAL", "confidence": 0.0, "score": 0.0, "signals": []}

    c = parse_candles(raw_candles)
    closes  = c["closes"]
    highs   = c["highs"]
    lows    = c["lows"]
    volumes = c["volumes"]
    n       = len(closes)

    score   = 0.0
    signals = []

    # ── EMA stack (20 / 50 / 200)
    e20  = ema(closes, 20)
    e50  = ema(closes, 50)
    e200 = ema(closes, 200) if n >= 200 else []

    if e20 and e50:
        last20, last50 = e20[-1], e50[-1]
        if last20 > last50:
            score += 0.15
            signals.append("EMA_BULL")
        else:
            score -= 0.15
            signals.append("EMA_BEAR")

        # EMA 20 slope
        if len(e20) >= 5:
            slope = (e20[-1] - e20[-5]) / e20[-5] if e20[-5] else 0
            if slope > 0.002:
                score += 0.08
                signals.append("EMA20_UP")
            elif slope < -0.002:
                score -= 0.08
                signals.append("EMA20_DOWN")

    if e200:
        if closes[-1] > e200[-1]:
            score += 0.10
            signals.append("ABOVE_EMA200")
        else:
            score -= 0.10
            signals.append("BELOW_EMA200")

    # ── MACD histogram
    _, _, hist = macd(closes)
    if len(hist) >= 3:
        h1, h2, h3 = hist[-1], hist[-2], hist[-3]
        if h1 > 0 and h1 > h2:
            score += 0.12
            signals.append("MACD_BULL_EXP")
        elif h1 > 0:
            score += 0.06
            signals.append("MACD_BULL")
        elif h1 < 0 and h1 < h2:
            score -= 0.12
            signals.append("MACD_BEAR_EXP")
        elif h1 < 0:
            score -= 0.06
            signals.append("MACD_BEAR")

        # MACD turning
        if h3 < 0 and h2 < 0 and h1 > h2:
            score += 0.05
            signals.append("MACD_TURNING_UP")
        elif h3 > 0 and h2 > 0 and h1 < h2:
            score -= 0.05
            signals.append("MACD_TURNING_DOWN")

    # ── RSI
    rsi_vals = rsi(closes)
    if rsi_vals:
        rv = rsi_vals[-1]
        if rv > 60:
            score += 0.10
            signals.append(f"RSI_BULL({rv:.0f})")
        elif rv < 40:
            score -= 0.10
            signals.append(f"RSI_BEAR({rv:.0f})")
        elif rv > 50:
            score += 0.04
        else:
            score -= 0.04

        if rv < 30:
            score += 0.08   # oversold bounce potential
            signals.append("RSI_OVERSOLD")
        elif rv > 70:
            score -= 0.08
            signals.append("RSI_OVERBOUGHT")

    # ── Price change over last 20% of the period
    lookback = max(int(n * 0.2), 5)
    price_chg = (closes[-1] - closes[-lookback]) / closes[-lookback] if closes[-lookback] else 0
    if price_chg > 0.03:
        score += 0.10
        signals.append(f"PRICE_UP({price_chg*100:.1f}%)")
    elif price_chg < -0.03:
        score -= 0.10
        signals.append(f"PRICE_DOWN({price_chg*100:.1f}%)")

    # ── Volume ratio (recent vs base)
    vr = volume_ratio(volumes)
    if vr > 1.5:
        score += 0.08
        signals.append(f"VOL_HIGH({vr:.1f}x)")
    elif vr < 0.7:
        score -= 0.05
        signals.append(f"VOL_LOW({vr:.1f}x)")

    # ── ATR compression (low ATR = consolidation / accumulation potential)
    atr_vals = atr(highs, lows, closes)
    if len(atr_vals) >= 10:
        atr_now = atr_vals[-1]
        atr_avg = sum(atr_vals[-10:]) / 10
        if atr_now < atr_avg * 0.75:
            score += 0.05
            signals.append("ATR_COMPRESS")
        elif atr_now > atr_avg * 1.5:
            score -= 0.03
            signals.append("ATR_EXPAND")

    # ── Consecutive closes direction (last 5 bars)
    consec = 0
    for i in range(-1, -6, -1):
        if len(closes) + i - 1 < 0:
            break
        if closes[i] > closes[i - 1]:
            consec += 1
        else:
            consec -= 1
    if consec >= 4:
        score += 0.08
        signals.append(f"CONSEC_UP({consec})")
    elif consec <= -4:
        score -= 0.08
        signals.append(f"CONSEC_DOWN({abs(consec)})")

    # ── Signal alignment bonus
    bull_sigs = sum(1 for s in signals if any(k in s for k in ("BULL", "UP", "ABOVE", "OVERSOLD", "HIGH")))
    bear_sigs = sum(1 for s in signals if any(k in s for k in ("BEAR", "DOWN", "BELOW", "OVERBOUGHT", "LOW")))
    if bull_sigs >= 5:
        score += 0.08
        signals.append(f"ALIGN_BULL({bull_sigs})")
    elif bull_sigs >= 3:
        score += 0.04
    if bear_sigs >= 5:
        score -= 0.08
        signals.append(f"ALIGN_BEAR({bear_sigs})")
    elif bear_sigs >= 3:
        score -= 0.04

    # ── Confidence (absolute score boosted by data length)
    confidence = min(abs(score) + 0.04 * min(n / 60, 1.0), 1.0)

    # ── Phase classification
    phase = "NEUTRAL"
    if score >= 0.45:
        phase = "MARKUP"
    elif score >= 0.12:
        phase = "ACCUMULATION"
    elif score <= -0.45:
        phase = "MARKDOWN"
    elif score <= -0.12:
        phase = "DISTRIBUTION"

    return {
        "phase":      phase,
        "confidence": round(confidence, 4),
        "score":      round(score, 4),
        "signals":    signals,
    }
