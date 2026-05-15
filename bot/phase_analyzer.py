"""
Phase analyzer — reads phase_log.jsonl and produces:

  1. Phase duration statistics (mean/median/p75/p90 per phase per coin)
  2. Validation accuracy (did ACCUMULATION → MARKUP? etc.)
  3. Forecast for current phase of each coin

Run:  python phase_analyzer.py
      python phase_analyzer.py --coin BTC
      python phase_analyzer.py --min-runs 3      (require N completed runs for stats)
"""

import json
import argparse
import statistics
from datetime import datetime, timezone
from collections import defaultdict

LOG_FILE = "phase_log.jsonl"

EXPECTED_NEXT = {
    "ACCUMULATION": "MARKUP",
    "MARKUP":       "DISTRIBUTION",
    "DISTRIBUTION": "MARKDOWN",
    "MARKDOWN":     "ACCUMULATION",
    "NEUTRAL":      None,   # can go anywhere
}

PHASE_EMOJI = {
    "ACCUMULATION": "🔵",
    "MARKUP":       "🟢",
    "DISTRIBUTION": "🟡",
    "MARKDOWN":     "🔴",
    "NEUTRAL":      "⚪",
}


# ── Load and parse log
def load_log(coin: str | None = None) -> dict[str, list[dict]]:
    """Returns {coin: [records sorted by timestamp]}"""
    by_coin: dict[str, list] = defaultdict(list)
    try:
        with open(LOG_FILE) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    r["_dt"] = datetime.fromisoformat(r["ts"])
                    if coin is None or r["coin"] == coin:
                        by_coin[r["coin"]].append(r)
                except Exception:
                    pass
    except FileNotFoundError:
        pass

    # Sort each coin's records by time
    for c in by_coin:
        by_coin[c].sort(key=lambda x: x["_dt"])

    return dict(by_coin)


# ── Group consecutive same-phase records into runs
def find_runs(records: list[dict]) -> list[dict]:
    """
    Returns list of completed phase runs (current in-progress run excluded).
    Each run: {phase, start_dt, end_dt, duration_hours, start_price, end_price,
               price_change_pct, next_phase, records_count}
    """
    if not records:
        return []

    runs    = []
    grp_ph  = records[0]["phase"]
    grp_recs = [records[0]]

    for r in records[1:]:
        if r["phase"] == grp_ph:
            grp_recs.append(r)
        else:
            # Close out the group
            start_dt = grp_recs[0]["_dt"]
            end_dt   = r["_dt"]
            dur_h    = (end_dt - start_dt).total_seconds() / 3600
            sp       = grp_recs[0]["price"]
            ep       = grp_recs[-1]["price"]

            runs.append({
                "phase":          grp_ph,
                "start_dt":       start_dt,
                "end_dt":         end_dt,
                "duration_hours": dur_h,
                "duration_days":  round(dur_h / 24, 1),
                "start_price":    sp,
                "end_price":      ep,
                "price_change":   (ep - sp) / sp if sp else 0,
                "next_phase":     r["phase"],
                "records_count":  len(grp_recs),
                "avg_conf":       sum(x["conf"] for x in grp_recs) / len(grp_recs),
            })

            grp_ph   = r["phase"]
            grp_recs = [r]

    # Current (in-progress) run returned separately
    current = {
        "phase":          grp_ph,
        "start_dt":       grp_recs[0]["_dt"],
        "end_dt":         None,
        "duration_hours": (records[-1]["_dt"] - grp_recs[0]["_dt"]).total_seconds() / 3600,
        "records_count":  len(grp_recs),
        "avg_conf":       sum(x["conf"] for x in grp_recs) / len(grp_recs),
        "latest_price":   grp_recs[-1]["price"],
        "start_price":    grp_recs[0]["price"],
    }

    return runs, current


# ── Statistics per phase
def phase_stats(runs: list[dict]) -> dict[str, dict]:
    by_phase: dict[str, list[float]] = defaultdict(list)
    for r in runs:
        by_phase[r["phase"]].append(r["duration_hours"])

    result = {}
    for phase, durs in by_phase.items():
        durs_s = sorted(durs)
        n      = len(durs_s)
        result[phase] = {
            "count":      n,
            "mean_h":     statistics.mean(durs_s),
            "median_h":   statistics.median(durs_s),
            "std_h":      statistics.stdev(durs_s) if n > 1 else 0,
            "min_h":      durs_s[0],
            "max_h":      durs_s[-1],
            "p25_h":      durs_s[max(0, int(n * 0.25) - 1)],
            "p75_h":      durs_s[min(n - 1, int(n * 0.75))],
            "p90_h":      durs_s[min(n - 1, int(n * 0.90))],
        }
    return result


# ── Transition accuracy
def transition_accuracy(runs: list[dict]) -> dict[str, dict]:
    """
    For each phase, measures how often the EXPECTED next phase actually followed.
    """
    from_phase: dict[str, list] = defaultdict(list)
    for r in runs:
        from_phase[r["phase"]].append(r["next_phase"])

    accuracy = {}
    for phase, nexts in from_phase.items():
        expected = EXPECTED_NEXT.get(phase)
        correct  = sum(1 for n in nexts if n == expected)
        accuracy[phase] = {
            "total":       len(nexts),
            "expected":    expected,
            "correct":     correct,
            "accuracy":    correct / len(nexts) if nexts else 0,
            "transitions": {n: nexts.count(n) for n in set(nexts)},
        }
    return accuracy


# ── Price change per phase
def price_change_stats(runs: list[dict]) -> dict[str, dict]:
    by_phase: dict[str, list] = defaultdict(list)
    for r in runs:
        by_phase[r["phase"]].append(r["price_change"])

    result = {}
    for phase, changes in by_phase.items():
        result[phase] = {
            "avg_pct":    statistics.mean(changes) * 100,
            "median_pct": statistics.median(changes) * 100,
            "best_pct":   max(changes) * 100,
            "worst_pct":  min(changes) * 100,
        }
    return result


# ── Forecast for current in-progress phase
def forecast(current: dict, stats: dict) -> dict:
    phase     = current["phase"]
    elapsed_h = current["duration_hours"]

    if phase not in stats:
        return {"status": "no_data", "phase": phase, "elapsed_h": elapsed_h}

    s = stats[phase]
    remaining_median = s["median_h"] - elapsed_h
    remaining_p75    = s["p75_h"] - elapsed_h
    progress_pct     = (elapsed_h / s["median_h"]) * 100 if s["median_h"] > 0 else 0
    is_late          = elapsed_h > s["p75_h"]
    is_overdue       = elapsed_h > s["p90_h"]

    return {
        "status":           "ok",
        "phase":            phase,
        "elapsed_h":        elapsed_h,
        "elapsed_days":     round(elapsed_h / 24, 1),
        "median_h":         s["median_h"],
        "p75_h":            s["p75_h"],
        "p90_h":            s["p90_h"],
        "remaining_median": remaining_median,
        "remaining_p75":    remaining_p75,
        "progress_pct":     round(progress_pct, 1),
        "is_late":          is_late,
        "is_overdue":       is_overdue,
        "expected_next":    EXPECTED_NEXT.get(phase, "unknown"),
    }


# ── Pretty print helpers
def _h(hours: float) -> str:
    if hours < 0:
        return f"overdue by {abs(hours):.0f}h"
    if hours < 48:
        return f"{hours:.0f}h"
    return f"{hours/24:.1f}d ({hours:.0f}h)"


def _pbar(pct: float, width: int = 20) -> str:
    filled = int(min(pct, 100) / 100 * width)
    over   = pct > 100
    bar    = "█" * filled + ("▓" if over else "░") * (width - min(filled, width))
    return f"[{bar}] {pct:.0f}%"


# ── Main output
def print_report(coin_filter: str | None = None, min_runs: int = 2):
    data = load_log(coin_filter)

    if not data:
        print(f"\n  No data in {LOG_FILE} yet.")
        print("  The recorder writes one entry per hour per coin.")
        print("  Come back after a few hours to see phase tracking.\n")
        return

    for coin, records in sorted(data.items()):
        result      = find_runs(records)
        if isinstance(result, tuple):
            runs, current = result
        else:
            print(f"\n{coin}: not enough data for run analysis")
            continue

        stats       = phase_stats(runs)
        accuracy    = transition_accuracy(runs)
        px_stats    = price_change_stats(runs)
        fcast       = forecast(current, stats)
        total_hours = (records[-1]["_dt"] - records[0]["_dt"]).total_seconds() / 3600

        print(f"\n{'═'*62}")
        print(f"  {PHASE_EMOJI.get(current['phase'], '⚪')}  {coin}  —  {len(records)} snapshots "
              f"over {total_hours:.0f}h  ({len(runs)} completed runs)")
        print(f"{'═'*62}")

        # ── Current phase forecast
        print(f"\n  CURRENT PHASE: {current['phase']}  (avg conf {current['avg_conf']:.0%})")
        if fcast["status"] == "no_data":
            print(f"  Elapsed: {_h(current['duration_hours'])}  (no historical data yet for forecast)")
        else:
            print(f"  Elapsed:   {_h(fcast['elapsed_h'])}")
            print(f"  Progress:  {_pbar(fcast['progress_pct'])}")
            print(f"  Typical:   median={_h(fcast['median_h'])}  p75={_h(fcast['p75_h'])}  p90={_h(fcast['p90_h'])}")
            if fcast["is_overdue"]:
                print(f"  ⛔ OVERDUE  —  past p90, change could come at any candle")
            elif fcast["is_late"]:
                late_h = fcast["elapsed_h"] - fcast["p75_h"]
                print(f"  ⚠  LATE  —  {late_h:.0f}h past p75, phase change imminent")
            else:
                print(f"  Remaining: ~{_h(fcast['remaining_median'])} (median) "
                      f"to ~{_h(fcast['remaining_p75'])} (p75)")
            exp = fcast["expected_next"]
            if exp:
                print(f"  Anticipate: → {exp}  {PHASE_EMOJI.get(exp,'')}")

        # ── Phase duration table
        if stats:
            print(f"\n  DURATION STATISTICS  (completed runs)")
            print(f"  {'Phase':<14} {'N':>3} {'Min':>6} {'Median':>7} {'P75':>7} {'P90':>7} {'Max':>7}  Price Δ")
            print(f"  {'─'*14} {'─'*3} {'─'*6} {'─'*7} {'─'*7} {'─'*7} {'─'*7}  {'─'*8}")
            for phase in ["ACCUMULATION","MARKUP","DISTRIBUTION","MARKDOWN","NEUTRAL"]:
                if phase not in stats:
                    continue
                s  = stats[phase]
                px = px_stats.get(phase, {})
                if s["count"] < min_runs:
                    continue
                px_str = f"{px.get('median_pct',0):>+.1f}%" if px else "  n/a"
                print(f"  {PHASE_EMOJI.get(phase,'')} {phase:<12} "
                      f"{s['count']:>3}  "
                      f"{_h(s['min_h']):>6}  "
                      f"{_h(s['median_h']):>7}  "
                      f"{_h(s['p75_h']):>7}  "
                      f"{_h(s['p90_h']):>7}  "
                      f"{_h(s['max_h']):>7}  "
                      f"{px_str}")

        # ── Transition accuracy
        if accuracy:
            print(f"\n  PHASE TRANSITION ACCURACY")
            for phase in ["ACCUMULATION","MARKUP","DISTRIBUTION","MARKDOWN"]:
                if phase not in accuracy:
                    continue
                a = accuracy[phase]
                if a["total"] < min_runs:
                    continue
                exp    = a["expected"] or "any"
                bar    = "█" * int(a["accuracy"] * 10) + "░" * (10 - int(a["accuracy"] * 10))
                others = {k: v for k, v in a["transitions"].items() if k != a["expected"]}
                other_str = "  other: " + ", ".join(f"{k}×{v}" for k,v in others.items()) if others else ""
                print(f"  {PHASE_EMOJI.get(phase,'')} {phase:<14} → {exp:<14} "
                      f"[{bar}] {a['accuracy']:.0%}  ({a['correct']}/{a['total']}){other_str}")

        # ── Recent phase timeline
        last_n  = min(12, len(runs))
        if last_n > 0:
            print(f"\n  RECENT PHASE TIMELINE  (last {last_n} completed runs)")
            for r in runs[-last_n:]:
                arrow  = "✓" if r["next_phase"] == EXPECTED_NEXT.get(r["phase"]) else "↯"
                pc     = r["price_change"] * 100
                pc_str = f"{pc:>+6.1f}%"
                print(f"  {PHASE_EMOJI.get(r['phase'],'')} {r['phase']:<14} "
                      f"{r['duration_days']:>4.1f}d  "
                      f"price {pc_str}  "
                      f"→ {PHASE_EMOJI.get(r['next_phase'],'')} {r['next_phase']:<14} {arrow}")

    print()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--coin",     type=str,  default=None, help="Filter to one coin")
    ap.add_argument("--min-runs", type=int,  default=2,    help="Min completed runs for stats")
    args = ap.parse_args()
    print_report(coin_filter=args.coin.upper() if args.coin else None,
                 min_runs=args.min_runs)
