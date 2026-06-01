"""
Strategy backtester — simulates 5 variants of the entry/exit logic on
synthetic crypto price data with embedded Wyckoff cycles.

Synthetic data uses a seeded random walk with realistic:
  - Phase structure (accum → markup → distrib → markdown cycles)
  - Volatility per phase (ATR expansion/compression)
  - Volume patterns (building in accum, climactic in markup)
  - Noise (shortened / failed phases)

Variants:
  A  Phase Exit   +  8% SL + 10x  ← current bot config
  B  Fixed TP 75% +  8% SL + 10x
  C  Fixed TP 75% + 15% SL +  6x
  D  Fixed TP 75% + 25% SL +  3x  ← old "safe" config
  E  Phase Exit   + 15% SL +  6x

Usage:
  python backtest.py
  python backtest.py --seed 99 --days 180
  python backtest.py --coins BTC ETH SOL HYPE
"""

import sys, math, random, argparse, time
sys.path.insert(0, ".")
from indicators import parse_candles, ema as _ema, macd as _macd, rsi as _rsi, volume_ratio as _vr
from phase_detector import detect_phase

# ── Config
DEFAULT_COINS  = ["BTC", "ETH", "SOL", "HYPE"]
START_CAPITAL  = 1000.0
MARGIN_PCT     = 0.10
MIN_CONFIDENCE = 0.40
MIN_VOL_RATIO  = 1.20
PHASE_WINDOW   = 60
TA_WINDOW      = 40
MIN_HOLD       = 3
MAX_HOLD       = 150
COOLDOWN       = 5

STRATEGIES = [
    {"id":"A","name":"PhaseExit  + 8%SL+10x", "sl":0.08, "tp":None, "lev":10, "dyn":True },
    {"id":"B","name":"FixedTP75% + 8%SL+10x", "sl":0.08, "tp":0.75, "lev":10, "dyn":False},
    {"id":"C","name":"FixedTP75% +15%SL+ 6x", "sl":0.15, "tp":0.75, "lev": 6, "dyn":False},
    {"id":"D","name":"FixedTP75% +25%SL+ 3x", "sl":0.25, "tp":0.75, "lev": 3, "dyn":False},
    {"id":"E","name":"PhaseExit  +15%SL+ 6x", "sl":0.15, "tp":None, "lev": 6, "dyn":True },
]

# ── Synthetic Wyckoff data generator
def gen_phase_candles(n, start_price, phase, rng, base_vol=1000.0):
    price   = start_price
    candles = []
    t       = int(time.time() * 1000) - n * 14400 * 1000
    params  = {
        "ACCUMULATION": {"drift": 0.0002,  "vol": 0.007, "vm": 0.7},
        "MARKUP":       {"drift": 0.0035,  "vol": 0.012, "vm": 1.8},
        "DISTRIBUTION": {"drift":-0.0001,  "vol": 0.009, "vm": 1.0},
        "MARKDOWN":     {"drift":-0.0040,  "vol": 0.014, "vm": 2.0},
        "NEUTRAL":      {"drift": 0.0001,  "vol": 0.006, "vm": 0.5},
    }
    p = params.get(phase, params["NEUTRAL"])

    for i in range(n):
        prog  = i / n
        drift = p["drift"] * (1 + prog * 0.5) if phase in ("MARKUP","MARKDOWN") else p["drift"]
        vol   = p["vol"] * (0.6 + 0.4 * prog) if phase == "ACCUMULATION" else \
                p["vol"] * (0.8 + 0.4 * prog) if phase in ("MARKUP","MARKDOWN") else p["vol"]
        ret   = drift + rng.gauss(0, vol)
        o     = price
        c     = price * (1 + ret)
        hi    = max(o, c) * (1 + abs(rng.gauss(0, vol * 0.5)))
        lo    = min(o, c) * (1 - abs(rng.gauss(0, vol * 0.5)))
        v     = base_vol * p["vm"] * rng.lognormvariate(0, 0.4) * (1 + prog * 0.5)
        candles.append({"t": t, "o": f"{o:.4f}", "h": f"{hi:.4f}",
                         "l": f"{lo:.4f}", "c": f"{c:.4f}", "v": f"{v:.2f}"})
        price = c
        t    += 14400 * 1000

    return candles, price

def gen_wyckoff_series(days, start_price, rng):
    """Full Wyckoff cycle series for a given period."""
    total   = days * 6   # 4h candles
    candles = []
    price   = start_price
    lengths = {"NEUTRAL":25, "ACCUMULATION":50, "MARKUP":80, "DISTRIBUTION":35, "MARKDOWN":55}
    cycle   = ["NEUTRAL","ACCUMULATION","MARKUP","DISTRIBUTION","MARKDOWN"]

    while len(candles) < total:
        for ph in cycle:
            n = max(25, int(lengths[ph] * rng.uniform(0.7, 1.4)))
            if rng.random() < 0.12 and ph in ("ACCUMULATION","DISTRIBUTION"):
                n = max(15, n // 2)   # occasional failed/shortened phase
            new_c, price = gen_phase_candles(n, price, ph, rng)
            candles.extend(new_c)
            if len(candles) >= total:
                break

    return candles[:total]

# ── Signal precomputation
# NOTE: Real bot checks EMA20>EMA50 on 1h candles (very common during 4h accum)
# and volume ratio on 1h (higher frequency = less compressed). On 4h-only backtest
# we use relaxed proxies:
#   EMA: close > EMA50 * 0.97 (price near/above medium EMA = not in downtrend)
#   Volume: vr >= 0.70 (accumulation naturally compresses volume; just avoid dead markets)
def precompute(candles):
    results = [None] * len(candles)
    for i in range(PHASE_WINDOW, len(candles) - 1):
        pw    = candles[max(0, i - PHASE_WINDOW + 1): i + 1]
        phase = detect_phase(pw)
        # Use full pw for TA so EMA50 has enough candles (needs ≥50 values)
        c     = parse_candles(pw)

        closes, volumes = c["closes"], c["volumes"]

        e50 = _ema(closes, 50)
        # On 4h: price above or near EMA50 = not in downtrend
        price_above_ema = bool(e50 and closes[-1] > e50[-1] * 0.97)

        _, _, hist = _macd(closes)
        macd_bull  = bool(hist and hist[-1] > 0)

        rv     = _rsi(closes)
        rsi_ok = bool(rv and rv[-1] > 50)

        # Accumulation naturally has lower volume; just exclude dead markets
        vr     = _vr(volumes)
        vol_ok = vr >= 0.70

        results[i] = {
            "phase":    phase,
            "entry_ok": (
                phase["phase"] == "ACCUMULATION"
                and phase["confidence"] >= MIN_CONFIDENCE
                and price_above_ema and macd_bull and rsi_ok and vol_ok
            ),
        }
    return results

def precompute_phases(candles):
    out = [None] * len(candles)
    for i in range(PHASE_WINDOW, len(candles)):
        pw    = candles[max(0, i - PHASE_WINDOW + 1): i + 1]
        out[i] = detect_phase(pw)
    return out

# ── Trade simulation
def simulate_trade(candles, phase_cache, entry_idx, strat):
    if entry_idx >= len(candles):
        return None
    entry = float(candles[entry_idx]["o"])
    sl_px = entry * (1 - strat["sl"])
    tp_px = entry * (1 + strat["tp"]) if strat["tp"] else None

    for j in range(entry_idx, min(entry_idx + MAX_HOLD, len(candles))):
        lo    = float(candles[j]["l"])
        hi    = float(candles[j]["h"])
        close = float(candles[j]["c"])
        hold  = j - entry_idx

        if lo <= sl_px:
            return _r(entry, sl_px, -strat["sl"], "SL", hold, strat)
        if tp_px and hi >= tp_px:
            return _r(entry, tp_px, strat["tp"], "TP", hold, strat)
        if strat["dyn"] and hold >= MIN_HOLD:
            p = phase_cache[j]
            if p and p["phase"] in ("DISTRIBUTION","MARKDOWN"):
                pr = (close - entry) / entry
                return _r(entry, close, pr, f'Ph→{p["phase"][:4]}', hold, strat)

    last    = min(entry_idx + MAX_HOLD - 1, len(candles) - 1)
    close_f = float(candles[last]["c"])
    return _r(entry, close_f, (close_f - entry) / entry, "MaxHold", last - entry_idx, strat)

def _r(entry, exit_px, price_ret, reason, hold, s):
    return {"entry": entry, "exit": exit_px, "price_ret": price_ret,
            "acct_impact": price_ret * s["lev"] * MARGIN_PCT,
            "reason": reason, "hold_candles": hold,
            "hold_days": hold * 4 / 24, "win": price_ret > 0}

def run_coin(candles, signals, phase_cache, strat):
    trades, next_ok = [], 0
    for i in range(len(signals)):
        sig = signals[i]
        if sig is None or not sig["entry_ok"] or i < next_ok:
            continue
        trade = simulate_trade(candles, phase_cache, i + 1, strat)
        if trade:
            trades.append(trade)
            next_ok = i + 1 + trade["hold_candles"] + COOLDOWN
    return trades

# ── Performance metrics
def metrics(trades):
    if not trades:
        return None
    wins   = [t for t in trades if t["win"]]
    losses = [t for t in trades if not t["win"]]
    gp, gl = sum(t["acct_impact"] for t in wins), abs(sum(t["acct_impact"] for t in losses))
    pf     = gp / gl if gl > 0 else float("inf")

    equity, peak, max_dd = START_CAPITAL, START_CAPITAL, 0.0
    eq_curve = []
    for t in trades:
        equity *= (1 + t["acct_impact"])
        eq_curve.append(equity)
        peak   = max(peak, equity)
        max_dd = max(max_dd, (peak - equity) / peak)

    total_ret = (equity - START_CAPITAL) / START_CAPITAL
    d_rets    = [t["acct_impact"] / max(t["hold_days"], 0.17) for t in trades]
    if len(d_rets) > 1:
        mn, var = sum(d_rets)/len(d_rets), sum((r-sum(d_rets)/len(d_rets))**2 for r in d_rets)/len(d_rets)
        sharpe  = (mn / var**0.5 * math.sqrt(252)) if var > 0 else 0.0
    else:
        sharpe = 0.0

    exits = {}
    for t in trades:
        exits[t["reason"]] = exits.get(t["reason"], 0) + 1

    return {"n": len(trades), "win_rate": len(wins)/len(trades),
            "avg_win":  sum(t["price_ret"] for t in wins)   / len(wins)   if wins   else 0,
            "avg_loss": sum(t["price_ret"] for t in losses) / len(losses) if losses else 0,
            "avg_hold": sum(t["hold_days"] for t in trades) / len(trades),
            "pf": pf, "max_dd": max_dd, "total_ret": total_ret,
            "sharpe": sharpe, "final_eq": equity, "exits": exits, "eq_curve": eq_curve}

def spark(curve, w=22):
    if not curve: return " " * w
    lo, hi = min(curve), max(curve)
    if hi == lo: return "─" * w
    blocks = " ▁▂▃▄▅▆▇█"
    step   = (hi - lo) / (len(blocks) - 1)
    return "".join(blocks[min(len(blocks)-1, int((curve[int(i/(w-1)*(len(curve)-1))] - lo) / step))]
                   for i in range(w))

# ── Entry point
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days",  type=int, default=365)
    ap.add_argument("--seed",  type=int, default=42)
    ap.add_argument("--coins", nargs="+", default=DEFAULT_COINS)
    args = ap.parse_args()
    coins = [c.upper() for c in args.coins]

    starts = {"BTC":45000,"ETH":2400,"SOL":90,"HYPE":15,"SUI":1.2,"AVAX":22}

    print(f"\n{'='*80}")
    print(f"  HYPERLIQUID BOT STRATEGY BACKTEST  |  Synthetic Wyckoff Cycles")
    print(f"  Coins: {' '.join(coins)}  |  {args.days}d  |  Seed: {args.seed}  |  Capital: ${START_CAPITAL:.0f}")
    print(f"{'='*80}\n")

    # Generate data
    print("Generating price data...")
    all_candles = {}
    for coin in coins:
        rng = random.Random(args.seed + coins.index(coin) * 7)
        cds = gen_wyckoff_series(args.days, starts.get(coin, 100.0), rng)
        all_candles[coin] = cds
        s = float(cds[0]["c"]); e = float(cds[-1]["c"])
        print(f"  {coin:<6} {len(cds):>5} candles  {s:>8.2f} → {e:>8.2f}  ({(e-s)/s:>+7.1%})")

    bh_avg = sum((float(cds[-1]["c"]) - float(cds[0]["c"])) / float(cds[0]["c"])
                 for cds in all_candles.values()) / len(coins)
    print(f"\nBuy & Hold avg across coins: {bh_avg:+.1%} (unlevered)\n")

    # Precompute
    print("Precomputing signals (phase + TA)...")
    precomp_all     = {}
    phase_cache_all = {}
    for coin, cds in all_candles.items():
        t0 = time.time()
        precomp_all[coin]     = precompute(cds)
        phase_cache_all[coin] = precompute_phases(cds)
        entries = sum(1 for s in precomp_all[coin] if s and s["entry_ok"])
        print(f"  {coin:<6} potential entries: {entries:>3}  ({time.time()-t0:.1f}s)")

    # Run all strategies
    print("\nRunning strategies...\n")
    all_results = {}
    for s in STRATEGIES:
        all_trades, per_coin = [], {}
        for coin, cds in all_candles.items():
            tr = run_coin(cds, precomp_all[coin], phase_cache_all[coin], s)
            all_trades.extend(tr)
            per_coin[coin] = len(tr)
        all_results[s["id"]] = {"strat": s, "trades": all_trades, "per_coin": per_coin}

    # Results table
    print(f"{'='*88}")
    print(f"  {'[ID] Strategy':<35} {'N':>4} {'Win%':>6} {'AvgW':>6} {'AvgL':>6} "
          f"{'PF':>5} {'MaxDD':>6} {'Shrp':>5} {'Ret':>7} {'Final':>7}")
    print("─" * 88)

    best_sharpe, best_id = -999, None
    m_cache = {}

    for s in STRATEGIES:
        sid    = s["id"]
        trades = all_results[sid]["trades"]
        m      = metrics(trades)
        m_cache[sid] = m
        if m is None:
            print(f"  [{sid}] {s['name']:<33}  — no trades —")
            continue
        if m["sharpe"] > best_sharpe:
            best_sharpe, best_id = m["sharpe"], sid

        per_c = "  ".join(f"{c}:{all_results[sid]['per_coin'][c]}" for c in coins)
        print(f"  [{sid}] {s['name']:<33}"
              f" {m['n']:>4} {m['win_rate']:>6.1%} {m['avg_win']:>+6.1%} {m['avg_loss']:>+6.1%}"
              f" {m['pf']:>5.2f} {m['max_dd']:>6.1%} {m['sharpe']:>5.2f}"
              f" {m['total_ret']:>+7.1%} ${m['final_eq']:>6.0f}")
        exits_str = "  ".join(f"{k}:{v}" for k, v in sorted(m["exits"].items()))
        print(f"       {spark(m['eq_curve'])}  hold:{m['avg_hold']:.1f}d  {exits_str}  [{per_c}]")
        print("─" * 88)

    if best_id:
        print(f"\n★  Best risk-adjusted: [{best_id}] {all_results[best_id]['strat']['name']}"
              f"  (Sharpe {best_sharpe:.2f})\n")

    # Head-to-head: A vs D
    ma, md = m_cache.get("A"), m_cache.get("D")
    if ma and md:
        def cmp(va, vd, higher_better=True):
            if higher_better: return " ◀" if float(va.strip('%$x').replace('+','')) > float(vd.strip('%$x').replace('+','')) else ""
            return " ◀" if float(va.strip('%$x').replace('+','')) < float(vd.strip('%$x').replace('+','')) else ""

        print(f"Head-to-head: [A] PhaseExit+8%SL+10x  vs  [D] FixedTP75+25%SL+3x")
        rows = [
            ("Trades",    f"{ma['n']}",              f"{md['n']}",             True),
            ("Win rate",  f"{ma['win_rate']:.1%}",   f"{md['win_rate']:.1%}",  True),
            ("Avg win",   f"{ma['avg_win']:+.1%}",   f"{md['avg_win']:+.1%}",  True),
            ("Avg loss",  f"{ma['avg_loss']:+.1%}",  f"{md['avg_loss']:+.1%}", False),
            ("Profit fac",f"{ma['pf']:.2f}x",        f"{md['pf']:.2f}x",       True),
            ("Max DD",    f"{ma['max_dd']:.1%}",     f"{md['max_dd']:.1%}",    False),
            ("Sharpe",    f"{ma['sharpe']:.2f}",     f"{md['sharpe']:.2f}",    True),
            ("Total ret", f"{ma['total_ret']:+.1%}", f"{md['total_ret']:+.1%}",True),
            ("Final $",   f"${ma['final_eq']:.0f}",  f"${md['final_eq']:.0f}", True),
        ]
        print(f"  {'Metric':<14}  {'[A] Current':>14}  {'[D] Old':>14}")
        print(f"  {'─'*14}  {'─'*14}  {'─'*14}")
        for label, va, vd, hb in rows:
            a_better = (hb and va >= vd) or (not hb and va <= vd)
            tag = "◀ A wins" if a_better else "◀ D wins"
            print(f"  {label:<14}  {va:>14}  {vd:>14}  {tag}")

    print(f"\nNotes:")
    print(f"  • Synthetic data: seeded Wyckoff cycles w/ realistic vol + volume patterns")
    print(f"  • SL checked at candle low (conservative), TP at candle high")
    print(f"  • Dynamic exit fires at 4h candle close after phase flip detected")
    print(f"  • Wallet confirmation NOT modelled — real bot has higher-quality entries")
    print(f"  • Slippage not included — add ~0.05–0.10% per side for realism\n")


if __name__ == "__main__":
    main()
