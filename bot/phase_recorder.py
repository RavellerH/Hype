"""
Phase recorder — appends a phase snapshot for each WATCH_COIN every hour
to phase_log.jsonl, trims to LOG_RETENTION_DAYS, then auto-commits and
pushes to GitHub so the history is preserved across machines.

Called automatically from main.py every RECORD_INTERVAL seconds.
Can also run standalone:  python phase_recorder.py
"""

import json
import os
import subprocess
import time
import logging
import requests
from datetime import datetime, timezone, timedelta

from config import HL_API_URL, WATCH_COINS

from phase_detector import detect_phase

logger  = logging.getLogger(__name__)
LOG_FILE          = "phase_log.jsonl"
LOG_RETENTION_DAYS = 14      # keep 2 weeks of hourly snapshots

_session = requests.Session()
_session.headers.update({"Content-Type": "application/json"})


# ── Helpers
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


def _trim_log(log_path: str, days: int = LOG_RETENTION_DAYS) -> int:
    """Remove records older than `days`. Returns number of records kept."""
    if not os.path.exists(log_path):
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept, removed = [], 0
    with open(log_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r  = json.loads(line)
                dt = datetime.fromisoformat(r["ts"])
                if dt >= cutoff:
                    kept.append(line)
                else:
                    removed += 1
            except Exception:
                kept.append(line)   # keep any malformed lines
    with open(log_path, "w") as f:
        f.write("\n".join(kept) + ("\n" if kept else ""))
    if removed:
        logger.info("Trimmed %d old phase records (kept %d)", removed, len(kept))
    return len(kept)


def _git_push(log_path: str) -> bool:
    """
    Stage phase_log.jsonl, commit, pull --rebase, then push.
    Silent failure — a push error never crashes the bot.
    """
    bot_dir   = os.path.dirname(os.path.abspath(log_path))
    repo_root = os.path.dirname(bot_dir)          # hype/
    rel_path  = os.path.relpath(log_path, repo_root)   # bot/phase_log.jsonl

    ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def run(args):
        return subprocess.run(
            args, cwd=repo_root,
            capture_output=True, text=True
        )

    try:
        # Get current branch name
        branch = run(["git", "branch", "--show-current"]).stdout.strip()
        if not branch:
            branch = "claude/study-code-session-QlCAr"   # fallback

        # Stage the log file
        r = run(["git", "add", rel_path])
        if r.returncode != 0:
            logger.warning("git add failed: %s", r.stderr.strip())
            return False

        # Commit — may return non-zero if nothing changed (that's fine)
        run(["git", "commit", "-m", f"phase log {ts_str}"])

        # Pull --rebase to absorb any remote changes before pushing
        run(["git", "pull", "--rebase", "origin", branch])

        # Push
        r = run(["git", "push", "origin", branch])
        if r.returncode == 0:
            logger.info("Phase log pushed to GitHub (%s)", branch)
            return True
        else:
            logger.warning("git push failed: %s", r.stderr.strip())
            return False

    except Exception as e:
        logger.warning("git push error: %s", e)
        return False


# ── Main recording function
def record_snapshot(coins: list[str] = WATCH_COINS, interval: str = "4h",
                    push: bool = True) -> dict[str, dict]:
    """
    Fetch current phase for each coin, append to phase_log.jsonl,
    trim to LOG_RETENTION_DAYS, and push to GitHub.
    Returns {coin: phase_result} for immediate use by the bot.
    """
    ts      = datetime.now(timezone.utc).isoformat()
    results = {}
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), LOG_FILE)

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
            with open(log_path, "a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as e:
            logger.error("Failed to write phase log: %s", e)
            continue

        results[coin] = phase
        logger.info("Recorded: %s  %-14s  conf=%.0f%%  price=%.4f",
                    coin, phase["phase"], phase["confidence"] * 100, price)

    # Trim old records, then push
    _trim_log(log_path)
    if push and results:
        _git_push(log_path)

    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(levelname)-8s  %(message)s")
    print(f"Recording phase snapshot for {WATCH_COINS}...")
    results = record_snapshot()
    for coin, p in results.items():
        print(f"  {coin:<6}  {p['phase']:<14}  conf={p['confidence']:.0%}  score={p['score']:+.3f}")
