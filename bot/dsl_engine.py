"""
DSL (Dynamic Stop Loss) ratcheting trailing stop engine.
Inspired by Senpi AI's two-phase exit engine.

As price gains, ratchets the SL upward to lock in progressively more profit.
Tiers from DSL_TIERS config: at each price_gain_pct threshold, the SL is moved
to lock lock_fraction of that gain (e.g., at +10%, lock 35% = SL at entry +3.5%).

The highest applicable tier wins. Returns None if no improvement is possible
(price below all tier triggers, or already at/above computed SL).
"""

from config import DSL_TIERS


def compute_ratchet_sl(
    entry: float,
    current_price: float,
    is_long: bool,
    current_sl: float,
) -> float | None:
    """
    Returns a new SL price if a DSL tier fires and improves the current SL, else None.

    For longs: new_sl > current_sl (SL moves up, locking profit).
    For shorts: new_sl < current_sl (SL moves down, locking profit).
    """
    if is_long:
        gain_pct = (current_price / entry) - 1.0
    else:
        gain_pct = (entry / current_price) - 1.0

    if gain_pct <= 0:
        return None  # in loss territory — let the initial SL trigger order handle it

    best_sl = current_sl
    for trigger_pct, lock_frac in sorted(DSL_TIERS, reverse=True):
        if gain_pct >= trigger_pct:
            locked_gain = trigger_pct * lock_frac
            if is_long:
                candidate = entry * (1.0 + locked_gain)
                if candidate > best_sl:
                    best_sl = candidate
            else:
                candidate = entry * (1.0 - locked_gain)
                if candidate < best_sl:
                    best_sl = candidate
            break  # highest applicable tier wins

    if best_sl == current_sl:
        return None
    return round(best_sl, 6)
