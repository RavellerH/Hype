"""
Position sizing and risk calculation.

Safe leverage at 8% SL:
  Liquidation at isolated margin = entry × (1 - 1/lev + maint_margin)
  With maint_margin ≈ 0.005 (Hyperliquid):
    lev=10 → liq at entry × (1 - 0.10 + 0.005) = -9.5% from entry
  SL fires at -8%, well before the -9.5% liquidation → 10x is safe at 8% SL.

Leverage scaling by confidence (40% → 3x, 90%+ → 10x):
  Small account benefit: higher leverage amplifies gains without increasing
  absolute risk, because MARGIN_PCT is fixed at 10% of account.
"""

import math
from config import MARGIN_PCT, MAX_LEVERAGE, SL_PCT, TP_PCT_FIXED

MAINT_MARGIN = 0.005   # Hyperliquid maintenance margin rate


def safe_leverage(sl_pct: float = SL_PCT, max_lev: int = MAX_LEVERAGE) -> int:
    """
    Largest integer leverage where liquidation is safely beyond SL.
    Formula: lev ≤ 1 / (sl_pct + maint_margin)
    At SL=8%: max_safe = int(1 / 0.085) = 11 → capped at 10 by MAX_LEVERAGE.
    """
    max_safe = int(1.0 / (sl_pct + MAINT_MARGIN))
    return max(1, min(max_safe, max_lev))


def scale_leverage(confidence: float, sl_pct: float = SL_PCT, max_lev: int = MAX_LEVERAGE) -> int:
    """
    Scale leverage with confidence:
      40% → 3x  (cautious entry)
      65% → 6x  (medium conviction)
      90%+ → 10x (high conviction, full safe max)
    Linear interpolation between 3x floor and safe_max ceiling.
    """
    cap   = safe_leverage(sl_pct, max_lev)
    floor = min(3, cap)
    ratio = max(0.0, (confidence - 0.40) / 0.50)   # 0 at 40%, 1 at 90%+
    lev   = floor + round(ratio * (cap - floor))
    return max(floor, min(lev, cap))


def position_size(account_value: float, price: float, leverage: int) -> float:
    """
    Contract size in base asset.
    margin_used  = account_value × MARGIN_PCT
    notional     = margin × leverage
    contracts    = notional / price
    """
    margin   = account_value * MARGIN_PCT
    notional = margin * leverage
    return notional / price


def sl_price(entry: float, is_long: bool, sl_pct: float = SL_PCT) -> float:
    return entry * (1 - sl_pct) if is_long else entry * (1 + sl_pct)


def tp_price(entry: float, is_long: bool, tp_pct: float = TP_PCT_FIXED) -> float:
    return entry * (1 + tp_pct) if is_long else entry * (1 - tp_pct)


def breakeven_sl(entry: float, is_long: bool, buffer: float = 0.003) -> float:
    """SL price at breakeven +/- a small buffer to avoid noise exits."""
    return entry * (1 + buffer) if is_long else entry * (1 - buffer)


def round_price(price: float, tick: float = 0.1) -> float:
    return math.floor(price / tick + 0.5) * tick


def risk_summary(account_value: float, price: float, confidence: float, is_long: bool) -> dict:
    lev      = scale_leverage(confidence)
    sz       = position_size(account_value, price, lev)
    entry    = price
    sl       = sl_price(entry, is_long)
    tp       = tp_price(entry, is_long)
    margin   = account_value * MARGIN_PCT
    notional = sz * price
    max_loss = margin * SL_PCT    # loss as fraction of margin at SL
    return {
        "leverage":     lev,
        "size":         round(sz, 6),
        "entry":        entry,
        "sl":           round(sl, 4),
        "tp":           round(tp, 4),
        "margin":       round(margin, 2),
        "notional":     round(notional, 2),
        "max_loss_usd": round(max_loss, 2),
        "rr_ratio":     round(TP_PCT_FIXED / SL_PCT, 2),
    }
