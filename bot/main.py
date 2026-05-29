"""
Hyperliquid automated trading bot.

Entry conditions (ALL must be true):
  1. Phase = ACCUMULATION, confidence >= 40%, on 4h candles
  2. 1h TA: EMA bullish + MACD bullish + RSI > 50
  3. 15m TA: MACD bullish + RSI > 50
  4. Volume ratio >= 1.2×
  5. >= 1 smart wallet long the coin
  6. Funding rate not extreme (< MAX_LONG_FUNDING_RATE)
  7. Confluence score >= MIN_CONFLUENCE_SCORE (0-10 scale)
  8. No existing position in this coin
  9. < 3 open bot-managed positions
  10. Risk guardrails not tripped (daily loss / consecutive losses)

Risk per trade:
  - 10% of account value as margin
  - Leverage scales 3x–10x based on confluence score (10x at score 10)
  - SL at -8% from entry (trigger order, fires before liquidation at ~-9.5%)
  - TP is DYNAMIC: exit when phase flips to DISTRIBUTION or MARKDOWN
  - Fallback fixed TP at +75% if phase never changes
  - DSL ratcheting trail: at +10/+20/+35% gain, SL locks 35/55/70% of that gain
  - SL also moved to breakeven when phase reaches MARKUP

Phase duration prediction is logged at entry and on each monitor tick.
Inspired by Senpi AI's signal architecture and DSL exit engine.

Usage:
  pip install -r requirements.txt
  cp .env.example .env
  # Fill in .env with HL_PRIVATE_KEY, HL_WALLET_ADDRESS, TG_TOKEN, TG_CHAT_ID
  python main.py
"""

import logging
import time
import json
import os
import sys
from datetime import datetime, timezone, timedelta

import eth_account
from eth_account.signers.local import LocalAccount
from hyperliquid.info     import Info
from hyperliquid.exchange import Exchange
from hyperliquid.utils    import constants

from config          import (PRIVATE_KEY, WALLET_ADDRESS, WATCH_COINS,
                              PHASE_SCAN_INTERVAL, WALLET_SCAN_INTERVAL,
                              POSITION_POLL_INTERVAL, MIN_PHASE_CONFIDENCE,
                              MIN_VOLUME_RATIO, MAX_OPEN_BOT_POSITIONS,
                              PHASE_EXIT, TRAIL_BREAKEVEN, TP_PCT_FIXED, SL_PCT,
                              MIN_CONFLUENCE_SCORE, MAX_LONG_FUNDING_RATE,
                              MAX_DAILY_LOSS_PCT, MAX_CONSECUTIVE_LOSSES, HALT_HOURS,
                              ASSET_COOLDOWN_MINUTES, BTC_MACRO_GATE_PCT,
                              LLM_VETO_ENABLED, LLM_VETO_MIN_SCORE, LLM_VETO_MODEL)
from indicators      import parse_candles, ema, macd, rsi, volume_ratio
from phase_detector  import detect_phase, estimate_phase_duration
from wallet_monitor  import scan_all_wallets, has_wallet_signal, wallet_summary, get_wallet_longs
from risk_manager    import risk_summary, sl_price, tp_price, breakeven_sl
from dsl_engine      import compute_ratchet_sl
from telegram_notifier import send, notify_entry, notify_exit, notify_wallet_entry, notify_error
from phase_recorder  import record_snapshot

try:
    import anthropic as _anthropic_lib
    _anthropic_client = _anthropic_lib.Anthropic() if LLM_VETO_ENABLED else None
except ImportError:
    _anthropic_client = None

RECORD_INTERVAL = 3600   # record phase snapshot every hour

# ── Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("bot.log"),
    ],
)
logger = logging.getLogger(__name__)

# ── State file (survives restarts)
STATE_FILE = "bot_state.json"


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                s = json.load(f)
            # Migrate older state files that lack new keys
            s.setdefault("risk_stats", {
                "date": "", "realized_pnl": 0.0,
                "consecutive_losses": 0, "halted_until": None,
            })
            return s
        except Exception:
            pass
    return {
        "bot_positions": {},   # {coin: {"side", "sz", "entry", "sl", "tp", "lev", ...}}
        "risk_stats": {
            "date": "",
            "realized_pnl": 0.0,
            "consecutive_losses": 0,
            "halted_until": None,
        },
    }


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ── Hyperliquid setup
def setup_hl():
    if not PRIVATE_KEY or not WALLET_ADDRESS:
        logger.error("HL_PRIVATE_KEY and HL_WALLET_ADDRESS must be set in .env")
        sys.exit(1)
    account: LocalAccount = eth_account.Account.from_key(PRIVATE_KEY)
    info     = Info(constants.MAINNET_API_URL, skip_ws=True)
    exchange = Exchange(account, constants.MAINNET_API_URL)
    return info, exchange, account


# ── Candle fetching
def fetch_candles(info: Info, coin: str, interval: str, days: int) -> list[dict]:
    now  = int(time.time() * 1000)
    secs = {"15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
    start = now - days * 86400 * 1000
    try:
        return info.candles_snapshot(coin, interval, start, now) or []
    except Exception as e:
        logger.warning("Failed to fetch %s %s candles: %s", coin, interval, e)
        return []


# ── TA signal check
def check_ta_signals(candles: list[dict], label: str) -> dict:
    """Returns {"ok": bool, "reason": str} for 1h or 15m timeframe."""
    if len(candles) < 30:
        return {"ok": False, "reason": f"{label}: not enough candles"}

    c      = parse_candles(candles)
    closes = c["closes"]

    e20 = ema(closes, 20)
    e50 = ema(closes, 50)
    ema_bull = bool(e20 and e50 and e20[-1] > e50[-1])

    _, _, hist = macd(closes)
    macd_bull  = bool(hist and hist[-1] > 0)

    rsi_vals  = rsi(closes)
    rsi_above = bool(rsi_vals and rsi_vals[-1] > 50)

    vr      = volume_ratio(c["volumes"])
    vol_ok  = vr >= MIN_VOLUME_RATIO

    if label == "1h":
        ok = ema_bull and macd_bull and rsi_above
        parts = [
            f"EMA {'✓' if ema_bull else '✗'}",
            f"MACD {'✓' if macd_bull else '✗'}",
            f"RSI {'✓' if rsi_above else '✗'}({rsi_vals[-1]:.0f})" if rsi_vals else "RSI ✗",
        ]
    else:   # 15m
        ok    = macd_bull and rsi_above
        parts = [
            f"MACD {'✓' if macd_bull else '✗'}",
            f"RSI {'✓' if rsi_above else '✗'}({rsi_vals[-1]:.0f})" if rsi_vals else "RSI ✗",
        ]

    return {
        "ok": ok, "reason": f"{label}: {' | '.join(parts)}",
        "vol_ratio": vr, "vol_ok": vol_ok,
        # Individual flags for confluence scoring
        "ema_bull": ema_bull, "macd_bull": macd_bull, "rsi_above": rsi_above,
    }


# ── Get account value
def get_account_value(info: Info) -> float:
    try:
        state = info.user_state(WALLET_ADDRESS)
        return float(state.get("marginSummary", {}).get("accountValue", 0))
    except Exception as e:
        logger.warning("Failed to get account value: %s", e)
        return 0.0


# ── Get current mid price
def get_price(info: Info, coin: str) -> float:
    try:
        mids = info.all_mids()
        return float(mids.get(coin, 0))
    except Exception as e:
        logger.warning("Failed to get price for %s: %s", coin, e)
        return 0.0


# ── Fetch all market contexts (funding + OI) in one call
def fetch_all_market_contexts(info: Info) -> dict[str, dict]:
    """Returns {coin: {"funding_rate": float, "open_interest": float}}."""
    try:
        data = info.meta_and_asset_ctxs()
        universe = data[0].get("universe", []) if data else []
        ctxs     = data[1] if len(data) > 1 else []
        result   = {}
        for i, u in enumerate(universe):
            name = u.get("name", "")
            if name and i < len(ctxs):
                ctx = ctxs[i]
                result[name] = {
                    "funding_rate":  float(ctx.get("funding", 0) or 0),
                    "open_interest": float(ctx.get("openInterest", 0) or 0),
                }
        return result
    except Exception as e:
        logger.warning("Failed to fetch market contexts: %s", e)
        return {}


# ── Compute confluence score (0-10)
def compute_confluence_score(
    phase_confidence: float,
    ta_1h: dict,
    ta_15m: dict,
    wallet_count: int,
) -> int:
    """
    Score 0-10 measuring trade confluence strength.
    Min entry score: MIN_CONFLUENCE_SCORE (5).
    """
    score = 0
    # Phase confidence (0-3 pts)
    if phase_confidence >= 0.70:
        score += 3
    elif phase_confidence >= 0.55:
        score += 2
    else:
        score += 1

    # 1h TA signals (0-3 pts, 1 per signal)
    if ta_1h.get("ema_bull"):   score += 1
    if ta_1h.get("macd_bull"):  score += 1
    if ta_1h.get("rsi_above"):  score += 1

    # 15m momentum (0-1 pt — both must pass)
    if ta_15m.get("macd_bull") and ta_15m.get("rsi_above"):
        score += 1

    # Volume strength (0-1 pt — bonus for strong volume)
    if ta_1h.get("vol_ratio", 0) >= 1.5:
        score += 1

    # Smart wallet consensus (0-2 pts)
    if wallet_count >= 1: score += 1
    if wallet_count >= 3: score += 1

    return score  # max 10


# ── Risk guardrail checks
def is_trading_halted(state: dict, account_value: float) -> bool:
    """Returns True if risk guardrails prevent new entries."""
    stats = state["risk_stats"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Clear time-based halt if it has expired
    halted_until = stats.get("halted_until")
    if halted_until:
        until_dt = datetime.fromisoformat(halted_until)
        if datetime.now(timezone.utc) < until_dt:
            remaining = (until_dt - datetime.now(timezone.utc)).seconds // 3600
            logger.info("Trading halted — cooldown expires in ~%dh", remaining)
            return True
        stats["halted_until"] = None
        stats["consecutive_losses"] = 0
        save_state(state)

    # Rotate daily P&L counter when date rolls over
    if stats.get("date") != today:
        stats["date"] = today
        stats["realized_pnl"] = 0.0
        save_state(state)

    # Daily loss limit
    daily_pnl = stats.get("realized_pnl", 0.0)
    if account_value > 0 and daily_pnl < -(account_value * MAX_DAILY_LOSS_PCT):
        logger.warning("Daily loss limit hit (%.2f USDC) — halting new entries", daily_pnl)
        send(f"⛔ Daily loss limit hit (<code>{daily_pnl:.2f}</code> USDC) — pausing new entries today")
        return True

    # Consecutive loss halt
    if stats.get("consecutive_losses", 0) >= MAX_CONSECUTIVE_LOSSES:
        halt_until = datetime.now(timezone.utc) + timedelta(hours=HALT_HOURS)
        stats["halted_until"] = halt_until.isoformat()
        save_state(state)
        logger.warning("%d consecutive losses — halting for %dh", stats["consecutive_losses"], HALT_HOURS)
        send(f"⛔ {stats['consecutive_losses']} consecutive losses — halting entries for {HALT_HOURS}h")
        return True

    return False


def record_trade_outcome(state: dict, pnl_usd: float) -> None:
    """Update risk_stats after a trade closes."""
    stats = state["risk_stats"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if stats.get("date") != today:
        stats["date"] = today
        stats["realized_pnl"] = 0.0
    stats["realized_pnl"] = stats.get("realized_pnl", 0.0) + pnl_usd
    if pnl_usd < 0:
        stats["consecutive_losses"] = stats.get("consecutive_losses", 0) + 1
    else:
        stats["consecutive_losses"] = 0
    save_state(state)


# ── BTC macro gate: block entries if BTC 4h trend is hostile
def check_btc_macro_gate(info: Info, is_long: bool) -> tuple[bool, str]:
    """Returns (gate_passes, reason). Inspired by Senpi AI CONDOR macro gate."""
    try:
        raw = fetch_candles(info, "BTC", "4h", 2)
        if len(raw) < 2:
            return True, "BTC macro: no data"
        c = parse_candles(raw)
        move = (c["closes"][-1] / c["closes"][-2]) - 1
        if is_long and move < -BTC_MACRO_GATE_PCT:
            return False, f"BTC 4h dropped {move:.1%} — hostile to longs"
        if not is_long and move > BTC_MACRO_GATE_PCT:
            return False, f"BTC 4h gained {move:.1%} — hostile to shorts"
        return True, f"BTC 4h {move:+.1%} OK"
    except Exception as e:
        logger.warning("BTC macro gate error: %s", e)
        return True, "BTC macro: check failed (passing)"


# ── LLM veto: Claude judges scored signals before execution
def llm_veto_check(
    coin: str, score: int, phase_confidence: float, funding_rate: float,
    wallet_longs: list[str], ta_1h: dict, ta_15m: dict,
) -> tuple[bool, str]:
    """
    Returns (proceed, reason). Inspired by Senpi AI's LLM decision gate
    which filters ~30-40% of rule-based signals that pass scoring.
    Only called when LLM_VETO_ENABLED and score >= LLM_VETO_MIN_SCORE.
    """
    if not LLM_VETO_ENABLED or _anthropic_client is None:
        return True, "LLM veto disabled"
    try:
        prompt = (
            f"You are a Hyperliquid trading risk manager. "
            f"Should this LONG entry PROCEED or be VETOED?\n\n"
            f"Asset: {coin}\n"
            f"Confluence score: {score}/10\n"
            f"Phase: Wyckoff ACCUMULATION {phase_confidence:.0%} confidence\n"
            f"Funding rate: {funding_rate:.4%}/8h\n"
            f"Smart wallets long: {', '.join(wallet_longs) or 'none'}\n"
            f"1h: EMA={'bull' if ta_1h.get('ema_bull') else 'bear'} "
            f"MACD={'bull' if ta_1h.get('macd_bull') else 'bear'} "
            f"RSI={'above50' if ta_1h.get('rsi_above') else 'below50'} "
            f"Vol={ta_1h.get('vol_ratio', 0):.2f}x\n"
            f"15m: MACD={'bull' if ta_15m.get('macd_bull') else 'bear'} "
            f"RSI={'above50' if ta_15m.get('rsi_above') else 'below50'}\n\n"
            f"Reply: PROCEED or VETO + reason (max 12 words)."
        )
        resp = _anthropic_client.messages.create(
            model=LLM_VETO_MODEL,
            max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        proceed = text.upper().startswith("PROCEED")
        return proceed, f"LLM: {text[:80]}"
    except Exception as e:
        logger.warning("LLM veto error: %s — defaulting to proceed", e)
        return True, "LLM veto: error (proceeding)"


# ── Place entry order with SL/TP
def open_position(exchange: Exchange, coin: str, is_long: bool,
                  sz: float, entry: float, sl: float, tp: float, lev: int) -> bool:
    try:
        # Set leverage
        exchange.update_leverage(lev, coin, is_cross=False)

        # Market entry
        result = exchange.market_open(coin, is_long, sz, slippage=0.01)
        logger.info("Market open result: %s", result)
        if not result or result.get("status") != "ok":
            logger.error("Entry order failed: %s", result)
            return False

        # TP trigger order (reduce-only)
        tp_side = not is_long
        exchange.order(
            coin, tp_side, sz, tp,
            order_type={"trigger": {"triggerPx": tp, "isMarket": True, "tpsl": "tp"}},
            reduce_only=True,
        )

        # SL trigger order (reduce-only)
        exchange.order(
            coin, tp_side, sz, sl,
            order_type={"trigger": {"triggerPx": sl, "isMarket": True, "tpsl": "sl"}},
            reduce_only=True,
        )

        logger.info("Position opened: %s %s sz=%.4f entry=%.4f SL=%.4f TP=%.4f lev=%dx",
                    "LONG" if is_long else "SHORT", coin, sz, entry, sl, tp, lev)
        return True

    except Exception as e:
        logger.error("Failed to open position for %s: %s", coin, e)
        notify_error(f"open_position({coin})", str(e))
        return False


# ── Main scan loop
def run_scan(info: Info, exchange: Exchange, state: dict) -> None:
    account_value = get_account_value(info)
    if account_value <= 0:
        logger.warning("Could not fetch account value — skipping scan")
        return

    open_bot_positions = len(state["bot_positions"])
    if open_bot_positions >= MAX_OPEN_BOT_POSITIONS:
        logger.info("Max bot positions (%d) reached — skipping scan", MAX_OPEN_BOT_POSITIONS)
        return

    # ── Risk guardrail check (daily loss / consecutive losses / cooldown)
    if is_trading_halted(state, account_value):
        return

    # ── BTC macro gate (once per scan; all our entries are longs)
    btc_ok, btc_reason = check_btc_macro_gate(info, is_long=True)
    if not btc_ok:
        logger.info("BTC macro gate blocking scan: %s", btc_reason)
        return

    # ── Fetch all market contexts in one call (funding + OI per coin)
    market_ctxs = fetch_all_market_contexts(info)

    logger.info("Scanning %d coins | account=%.2f USDC | open=%d/%d | %s",
                len(WATCH_COINS), account_value, open_bot_positions, MAX_OPEN_BOT_POSITIONS,
                btc_reason)

    now = datetime.now(timezone.utc)
    cooldowns = state.setdefault("asset_cooldowns", {})

    for coin in WATCH_COINS:
        if coin in state["bot_positions"]:
            logger.debug("%s: already have a bot position — skip", coin)
            continue

        # ── Per-asset cooldown check
        cd_until_str = cooldowns.get(coin)
        if cd_until_str:
            cd_until = datetime.fromisoformat(cd_until_str)
            if now < cd_until:
                remaining_min = int((cd_until - now).total_seconds() / 60)
                logger.info("%s: in loss cooldown (%dmin remaining) — skip", coin, remaining_min)
                continue
            del cooldowns[coin]

        # ── Funding rate filter (crowded longs = skip)
        ctx          = market_ctxs.get(coin, {})
        funding_rate = ctx.get("funding_rate", 0.0)
        if funding_rate > MAX_LONG_FUNDING_RATE:
            logger.info("%s: funding %.4f%% > max %.4f%% — longs crowded, skip",
                        coin, funding_rate * 100, MAX_LONG_FUNDING_RATE * 100)
            continue

        # ── Phase check (4h)
        raw_4h = fetch_candles(info, coin, "4h", 60)
        phase  = detect_phase(raw_4h)
        if phase["phase"] != "ACCUMULATION" or phase["confidence"] < MIN_PHASE_CONFIDENCE:
            logger.debug("%s: phase=%s conf=%.0f%% — skip",
                         coin, phase["phase"], phase["confidence"] * 100)
            continue

        # Phase duration prediction
        dur = estimate_phase_duration(raw_4h, "ACCUMULATION", "4h")
        logger.info(
            "%s: ACCUMULATION %.0f%% | running %.1fd / typical %.1fd | "
            "est %.1fd remaining%s",
            coin, phase["confidence"] * 100,
            dur["days_elapsed"], dur["typical_days"], dur["days_remaining"],
            " ⚠ LATE" if dur["is_late"] else "",
        )

        if dur["is_late"]:
            logger.info("%s: accumulation is late (%d%%) — higher breakout risk, skip",
                        coin, dur["progress_pct"])
            continue

        # ── 1h TA
        raw_1h = fetch_candles(info, coin, "1h", 30)
        ta_1h  = check_ta_signals(raw_1h, "1h")
        if not ta_1h["ok"]:
            logger.info("%s: 1h TA failed — %s", coin, ta_1h["reason"])
            continue

        # ── 15m TA
        raw_15m = fetch_candles(info, coin, "15m", 5)
        ta_15m  = check_ta_signals(raw_15m, "15m")
        if not ta_15m["ok"]:
            logger.info("%s: 15m TA failed — %s", coin, ta_15m["reason"])
            continue

        # ── Volume check (from 1h candles)
        if not ta_1h["vol_ok"]:
            logger.info("%s: volume too low (%.2f×) — skip", coin, ta_1h["vol_ratio"])
            continue

        # ── Smart wallet check
        longs = get_wallet_longs(coin)
        if len(longs) < 1:
            logger.info("%s: no smart wallet longs — skip", coin)
            continue

        # ── Confluence score (0-10)
        score = compute_confluence_score(phase["confidence"], ta_1h, ta_15m, len(longs))
        if score < MIN_CONFLUENCE_SCORE:
            logger.info("%s: confluence score %d < %d — skip", coin, score, MIN_CONFLUENCE_SCORE)
            continue

        # ── LLM veto layer (Senpi-inspired: Claude judges scored signals)
        if score >= LLM_VETO_MIN_SCORE:
            veto_ok, veto_reason = llm_veto_check(
                coin, score, phase["confidence"], funding_rate, longs, ta_1h, ta_15m
            )
            logger.info("%s: %s", coin, veto_reason)
            if not veto_ok:
                continue

        # ── All conditions met — build trade
        price = get_price(info, coin)
        if price <= 0:
            logger.warning("%s: could not get price — skip", coin)
            continue

        risk = risk_summary(account_value, price, phase["confidence"], is_long=True, score=score)

        logger.info(
            "%s: ENTERING LONG | score=%d/10 | entry=%.4f SL=%.4f TP=%.4f(fallback) "
            "lev=%dx sz=%.4f | funding=%.4f%% | wallets=%s",
            coin, score, price, risk["sl"], risk["tp"], risk["leverage"], risk["size"],
            funding_rate * 100, ", ".join(longs),
        )

        success = open_position(
            exchange, coin, is_long=True,
            sz=risk["size"], entry=price,
            sl=risk["sl"], tp=risk["tp"],
            lev=risk["leverage"],
        )

        if success:
            state["bot_positions"][coin] = {
                "side":           "long",
                "sz":             risk["size"],
                "entry":          price,
                "sl":             risk["sl"],
                "tp":             risk["tp"],
                "lev":            risk["leverage"],
                "score":          score,
                "phase_at_entry": "ACCUMULATION",
                "current_phase":  "ACCUMULATION",
                "trailed":        False,
                "dsl_tier":       None,
                "opened":         datetime.now(timezone.utc).isoformat(),
            }
            save_state(state)

            notify_entry(
                coin=coin, side="long",
                entry=price, sz=risk["size"],
                sl=risk["sl"], tp=risk["tp"],
                leverage=risk["leverage"],
                confidence=phase["confidence"],
                phase_coin=coin,
                wallet_labels=longs,
            )

        if len(state["bot_positions"]) >= MAX_OPEN_BOT_POSITIONS:
            break


# ── Cancel all open trigger orders for a coin (clear stale SL/TP before replacing)
def cancel_open_triggers(exchange: Exchange, info: Info, coin: str) -> None:
    try:
        orders = info.open_orders(WALLET_ADDRESS)
        for o in orders:
            if o.get("coin") == coin:
                exchange.cancel(coin, o["oid"])
    except Exception as e:
        logger.warning("Failed to cancel triggers for %s: %s", coin, e)


# ── Market close a position
def close_position(exchange: Exchange, coin: str, sz: float, is_long: bool) -> bool:
    try:
        result = exchange.market_close(coin, sz if not is_long else None)
        logger.info("Market close result for %s: %s", coin, result)
        return True
    except Exception as e:
        logger.error("Failed to close %s: %s", coin, e)
        notify_error(f"close_position({coin})", str(e))
        return False


# ── Position monitor: SL/TP hit detection + dynamic phase exit + breakeven trail
def run_position_monitor(info: Info, exchange: Exchange, state: dict) -> None:
    if not state["bot_positions"]:
        return

    try:
        hl_state   = info.user_state(WALLET_ADDRESS)
        open_coins = {
            p["position"]["coin"]
            for p in (hl_state.get("assetPositions") or [])
            if float(p["position"]["szi"]) != 0
        }
    except Exception as e:
        logger.warning("Position monitor error: %s", e)
        return

    # ── Detect externally closed positions (SL/TP trigger hit)
    auto_closed = [c for c in list(state["bot_positions"]) if c not in open_coins]
    for coin in auto_closed:
        pos = state["bot_positions"].pop(coin)
        price = get_price(info, coin)
        pnl_pct = (price - pos["entry"]) / pos["entry"] if pos["side"] == "long" else \
                  (pos["entry"] - price) / pos["entry"]
        pnl_usd = pnl_pct * pos["sz"] * pos["entry"]
        reason  = "SL triggered" if pnl_pct < 0 else "TP triggered"
        logger.info("%s: position auto-closed (%s) pnl=%.2f", coin, reason, pnl_usd)
        notify_exit(coin, pos["side"], pnl_usd, reason)
        record_trade_outcome(state, pnl_usd)
        # Set per-asset cooldown after a loss
        if pnl_usd < 0:
            cd_until = datetime.now(timezone.utc) + timedelta(minutes=ASSET_COOLDOWN_MINUTES)
            state.setdefault("asset_cooldowns", {})[coin] = cd_until.isoformat()
            logger.info("%s: loss → cooldown until %s", coin, cd_until.strftime("%H:%M UTC"))
        save_state(state)

    if not PHASE_EXIT and not TRAIL_BREAKEVEN:
        return

    # ── Phase-based dynamic exit, DSL ratcheting, and breakeven trail
    for coin, pos in list(state["bot_positions"].items()):
        if coin not in open_coins:
            continue  # already handled above

        raw_4h = fetch_candles(info, coin, "4h", 60)
        phase  = detect_phase(raw_4h)
        dur    = estimate_phase_duration(raw_4h, phase["phase"], "4h")
        cur    = phase["phase"]
        prev   = pos.get("current_phase", "ACCUMULATION")
        price  = get_price(info, coin)

        logger.info(
            "%s [open]: phase=%s(%.0f%%) | %.1fd elapsed / %.1fd remaining | "
            "price=%.4f entry=%.4f pnl=%.1f%%",
            coin, cur, phase["confidence"] * 100,
            dur["days_elapsed"], dur["days_remaining"],
            price, pos["entry"],
            ((price / pos["entry"]) - 1) * 100 if pos["side"] == "long" else
            ((pos["entry"] / price) - 1) * 100,
        )

        # Update tracked phase
        if cur != prev:
            logger.info("%s: phase transition %s → %s", coin, prev, cur)
            pos["current_phase"] = cur
            save_state(state)

        # ── DSL ratcheting trail (Senpi-inspired): lock in gains progressively
        is_long = pos["side"] == "long"
        new_dsl_sl = compute_ratchet_sl(pos["entry"], price, is_long, pos["sl"])
        if new_dsl_sl is not None:
            logger.info("%s: DSL ratchet — SL %.4f → %.4f", coin, pos["sl"], new_dsl_sl)
            cancel_open_triggers(exchange, info, coin)
            tp_side = not is_long
            try:
                exchange.order(
                    coin, tp_side, pos["sz"], new_dsl_sl,
                    order_type={"trigger": {"triggerPx": new_dsl_sl, "isMarket": True, "tpsl": "sl"}},
                    reduce_only=True,
                )
                pos["sl"]      = new_dsl_sl
                pos["dsl_tier"] = "ratcheted"
                pos["trailed"] = True   # DSL supersedes simple breakeven trail
                save_state(state)
                send(f"📈 <b>{coin}</b> DSL ratchet: SL → <code>{new_dsl_sl:.4f}</code>")
            except Exception as e:
                logger.warning("%s: failed to update DSL SL: %s", coin, e)

        # ── Breakeven trail (fallback when DSL hasn't fired yet)
        if TRAIL_BREAKEVEN and cur == "MARKUP" and not pos.get("trailed"):
            new_sl = breakeven_sl(pos["entry"], is_long)
            logger.info("%s: phase → MARKUP — moving SL to breakeven %.4f", coin, new_sl)
            cancel_open_triggers(exchange, info, coin)
            tp_side = not is_long
            try:
                exchange.order(
                    coin, tp_side, pos["sz"], new_sl,
                    order_type={"trigger": {"triggerPx": new_sl, "isMarket": True, "tpsl": "sl"}},
                    reduce_only=True,
                )
                pos["sl"]      = new_sl
                pos["trailed"] = True
                save_state(state)
                send(f"🔒 <b>{coin}</b> SL → breakeven <code>{new_sl:.4f}</code> (phase → MARKUP)")
            except Exception as e:
                logger.warning("%s: failed to set breakeven SL: %s", coin, e)

        # ── Phase exit: close on DISTRIBUTION or MARKDOWN
        if PHASE_EXIT and cur in ("DISTRIBUTION", "MARKDOWN"):
            logger.info("%s: phase is %s — triggering dynamic exit", coin, cur)
            cancel_open_triggers(exchange, info, coin)
            closed = close_position(exchange, coin, pos["sz"], is_long)
            if closed:
                pnl_pct = (price - pos["entry"]) / pos["entry"] if is_long else \
                          (pos["entry"] - price) / pos["entry"]
                pnl_usd = pnl_pct * pos["sz"] * pos["entry"]
                record_trade_outcome(state, pnl_usd)
                state["bot_positions"].pop(coin)
                save_state(state)
                notify_exit(coin, pos["side"], pnl_usd, f"Phase → {cur}")


# ── Wallet scan wrapper
def run_wallet_scan() -> None:
    events = scan_all_wallets()
    for ev in events:
        notify_wallet_entry(ev["label"], ev["coin"], ev["side"], ev["entry"])


# ── Entry point
def main():
    logger.info("=== Hyperliquid Trading Bot starting ===")
    send("🤖 <b>Bot started</b> — monitoring Hyperliquid for accumulation entries")

    info, exchange, account = setup_hl()
    state = load_state()

    # Initial wallet scan to populate baseline positions (no alerts on first run)
    scan_all_wallets()
    logger.info("Initial wallet scan complete")

    last_phase_scan  = 0.0
    last_wallet_scan = 0.0
    last_pos_poll    = 0.0
    last_record      = 0.0

    while True:
        now = time.time()

        if now - last_record >= RECORD_INTERVAL:
            try:
                record_snapshot(WATCH_COINS)
                logger.info("Phase snapshot recorded to phase_log.jsonl")
            except Exception as e:
                logger.warning("Phase record error: %s", e)
            last_record = now

        if now - last_wallet_scan >= WALLET_SCAN_INTERVAL:
            run_wallet_scan()
            last_wallet_scan = now

        if now - last_phase_scan >= PHASE_SCAN_INTERVAL:
            try:
                run_scan(info, exchange, state)
            except Exception as e:
                logger.exception("Phase scan error: %s", e)
                notify_error("Phase scan", str(e))
            last_phase_scan = now

        if now - last_pos_poll >= POSITION_POLL_INTERVAL:
            try:
                run_position_monitor(info, exchange, state)
            except Exception as e:
                logger.warning("Position monitor error: %s", e)
            last_pos_poll = now

        time.sleep(5)


if __name__ == "__main__":
    main()
