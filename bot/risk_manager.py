"""
Position sizing and risk calculation.

Safe leverage at 25% SL:
  Liquidation at isolated margin = entry × (1 - 1/lev + maint_margin)
  With maint_margin ≈ 0.005 (Hyperliquid):
    lev=3 → liq at ~67% of entry → -33%  (safe: SL at -25% fires first)
    lev=4 → liq at ~75% of entry → -25%  (dangerous: liq == SL)
  Therefore hard safe cap is 3x at 25% SL.
"""

import math
from config import MARGIN_PCT, MAX_LEVERAGE, SL_PCT, TP_PCT

MAINT_MARGIN = 0.005   # Hyperliquid maintenance margin rate


def safe_leverage(sl_pct: float = SL_PCT, max_lev: int = MAX_LEVERAGE) -> int:
    """
    Largest integer leverage where the liquidation price is safely beyond the SL.
    Formula: lev ≤ 1 / (sl_pct + maint_margin)
    """
    max_safe = int(1.0 / (sl_pct + MAINT_MARGIN))
    return max(1, min(max_safe, max_lev))


def scale_leverage(confidence: float, sl_pct: float = SL_PCT, max_lev: int = MAX_LEVERAGE) -> int:
    """
    Scale leverage linearly between 1x and safe_max based on confidence.
    40% conf → 1x, 70% conf → safe_max/2, 90%+ conf → safe_max
    """
    cap   = safe_leverage(sl_pct, max_lev)
    ratio = max(0.0, (confidence - 0.40) / 0.50)   # 0 at 40%, 1 at 90%+
    lev   = 1 + round(ratio * (cap - 1))
    return max(1, min(lev, cap))


def position_size(account_value: float, price: float, leverage: int) -> float:
    """
    Contract size (in base asset) for a given margin allocation.
    margin_used = account_value × MARGIN_PCT
    position_value = margin_used × leverage
    contracts = position_value / price
    """
    margin   = account_value * MARGIN_PCT
    notional = margin * leverage
    return notional / price


def sl_price(entry: float, is_long: bool, sl_pct: float = SL_PCT) -> float:
    return entry * (1 - sl_pct) if is_long else entry * (1 + sl_pct)


def tp_price(entry: float, is_long: bool, tp_pct: float = TP_PCT) -> float:
    return entry * (1 + tp_pct) if is_long else entry * (1 - tp_pct)


def round_price(price: float, tick: float = 0.1) -> float:
    return math.floor(price / tick + 0.5) * tick


def risk_summary(account_value: float, price: float, confidence: float, is_long: bool) -> dict:
    lev       = scale_leverage(confidence)
    sz        = position_size(account_value, price, lev)
    entry     = price
    sl        = sl_price(entry, is_long)
    tp        = tp_price(entry, is_long)
    margin    = account_value * MARGIN_PCT
    notional  = sz * price
    max_loss  = margin * SL_PCT * lev    # approximate
    return {
        "leverage":    lev,
        "size":        round(sz, 6),
        "entry":       entry,
        "sl":          round(sl, 4),
        "tp":          round(tp, 4),
        "margin":      round(margin, 2),
        "notional":    round(notional, 2),
        "max_loss_usd": round(max_loss, 2),
        "rr_ratio":    round(TP_PCT / SL_PCT, 2),
    }
