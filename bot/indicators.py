"""Technical indicator calculations — pure Python, no external deps."""

def ema(values: list[float], period: int) -> list[float]:
    if len(values) < period:
        return []
    k = 2.0 / (period + 1)
    result = [sum(values[:period]) / period]
    for v in values[period:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def macd(closes: list[float], fast=12, slow=26, signal=9):
    """Returns (macd_line, signal_line, histogram) — all same length as the shortest series."""
    ef = ema(closes, fast)
    es = ema(closes, slow)
    # Align: slow EMA starts later
    offset = slow - fast
    ef_aligned = ef[offset:]
    n = min(len(ef_aligned), len(es))
    macd_line = [ef_aligned[i] - es[i] for i in range(n)]
    sig_line = ema(macd_line, signal)
    n2 = min(len(macd_line), len(sig_line))
    hist = [macd_line[i + (n - n2)] - sig_line[i] for i in range(n2)]
    sig_aligned = sig_line
    macd_aligned = macd_line[n - n2:]
    return macd_aligned, sig_aligned, hist


def rsi(closes: list[float], period=14) -> list[float]:
    if len(closes) < period + 1:
        return []
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    result = []
    for i in range(period, len(gains)):
        if avg_l == 0:
            result.append(100.0)
        else:
            rs = avg_g / avg_l
            result.append(100 - 100 / (1 + rs))
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
    return result


def stoch(highs, lows, closes, k_period=14, d_period=3):
    """Returns (k_values, d_values)."""
    k_vals = []
    for i in range(k_period - 1, len(closes)):
        hh = max(highs[i - k_period + 1: i + 1])
        ll = min(lows[i - k_period + 1: i + 1])
        k_vals.append(100 * (closes[i] - ll) / (hh - ll) if hh != ll else 50)
    d_vals = []
    for i in range(d_period - 1, len(k_vals)):
        d_vals.append(sum(k_vals[i - d_period + 1: i + 1]) / d_period)
    return k_vals, d_vals


def bollinger(closes: list[float], period=20, std_dev=2.0):
    """Returns (upper, middle, lower) as single values for the last bar."""
    if len(closes) < period:
        return None, None, None
    window = closes[-period:]
    mid = sum(window) / period
    variance = sum((x - mid) ** 2 for x in window) / period
    sd = variance ** 0.5
    return mid + std_dev * sd, mid, mid - std_dev * sd


def atr(highs, lows, closes, period=14) -> list[float]:
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return []
    result = [sum(trs[:period]) / period]
    for tr in trs[period:]:
        result.append((result[-1] * (period - 1) + tr) / period)
    return result


def volume_ratio(volumes: list[float], lookback=20) -> float:
    """Recent quarter vs first quarter of lookback window."""
    if len(volumes) < lookback:
        return 1.0
    window = volumes[-lookback:]
    q = max(lookback // 4, 1)
    recent = sum(window[-q:]) / q
    base   = sum(window[:q]) / q
    return recent / base if base > 0 else 1.0


def parse_candles(raw: list[dict]) -> dict:
    """Convert Hyperliquid candle dicts to OHLCV lists."""
    opens   = [float(c["o"]) for c in raw]
    highs   = [float(c["h"]) for c in raw]
    lows    = [float(c["l"]) for c in raw]
    closes  = [float(c["c"]) for c in raw]
    volumes = [float(c["v"]) for c in raw]
    return {"opens": opens, "highs": highs, "lows": lows, "closes": closes, "volumes": volumes}
