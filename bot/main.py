"""
Hyperliquid automated trading bot.

Entry conditions (ALL must be true):
  1. Phase = ACCUMULATION, confidence >= 40%, on 4h candles
  2. 1h TA: EMA bullish + MACD bullish + RSI > 50
  3. 15m TA: MACD bullish + RSI > 50
  4. Volume ratio >= 1.2×
  5. >= 1 smart wallet long the coin
  6. No existing position in this coin
  7. < 3 open bot-managed positions

Risk per trade:
  - 10% of account value as margin
  - Safe leverage auto-calculated (max 3x at 25% SL)
  - SL at -25% from entry
  - TP at +75% from entry

Usage:
  pip install -r requirements.txt
  cp .env.example .env
  # Fill in .env
  python main.py
"""

import logging
import time
import json
import os
import sys
from datetime import datetime, timezone

import eth_account
from eth_account.signers.local import LocalAccount
from hyperliquid.info     import Info
from hyperliquid.exchange import Exchange
from hyperliquid.utils    import constants

from config          import (PRIVATE_KEY, WALLET_ADDRESS, WATCH_COINS,
                              PHASE_SCAN_INTERVAL, WALLET_SCAN_INTERVAL,
                              POSITION_POLL_INTERVAL, MIN_PHASE_CONFIDENCE,
                              MIN_VOLUME_RATIO, MAX_OPEN_BOT_POSITIONS)
from indicators      import parse_candles, ema, macd, rsi, volume_ratio
from phase_detector  import detect_phase
from wallet_monitor  import scan_all_wallets, has_wallet_signal, wallet_summary, get_wallet_longs
from risk_manager    import risk_summary, sl_price, tp_price, safe_leverage
from telegram_notifier import send, notify_entry, notify_exit, notify_wallet_entry, notify_error

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
                return json.load(f)
        except Exception:
            pass
    return {"bot_positions": {}}   # {coin: {"side", "sz", "entry", "sl", "tp", "lev"}}


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

    return {"ok": ok, "reason": f"{label}: {' | '.join(parts)}", "vol_ratio": vr, "vol_ok": vol_ok}


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

    logger.info("Scanning %d coins | account=%.2f USDC | open=%d/%d",
                len(WATCH_COINS), account_value, open_bot_positions, MAX_OPEN_BOT_POSITIONS)

    for coin in WATCH_COINS:
        if coin in state["bot_positions"]:
            logger.debug("%s: already have a bot position — skip", coin)
            continue

        # ── Phase check (4h)
        raw_4h = fetch_candles(info, coin, "4h", 60)
        phase  = detect_phase(raw_4h)
        if phase["phase"] != "ACCUMULATION" or phase["confidence"] < MIN_PHASE_CONFIDENCE:
            logger.debug("%s: phase=%s conf=%.0f%% — skip",
                         coin, phase["phase"], phase["confidence"] * 100)
            continue

        logger.info("%s: ACCUMULATION %.0f%% — checking TA", coin, phase["confidence"] * 100)

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
        if not has_wallet_signal(coin):
            logger.info("%s: no smart wallet longs — skip", coin)
            continue

        # ── All conditions met — build trade
        price = get_price(info, coin)
        if price <= 0:
            logger.warning("%s: could not get price — skip", coin)
            continue

        risk = risk_summary(account_value, price, phase["confidence"], is_long=True)
        longs = get_wallet_longs(coin)

        logger.info(
            "%s: ENTERING LONG | entry=%.4f SL=%.4f TP=%.4f lev=%dx sz=%.4f | wallets=%s",
            coin, price, risk["sl"], risk["tp"], risk["leverage"], risk["size"],
            ", ".join(longs)
        )

        success = open_position(
            exchange, coin, is_long=True,
            sz=risk["size"], entry=price,
            sl=risk["sl"], tp=risk["tp"],
            lev=risk["leverage"],
        )

        if success:
            state["bot_positions"][coin] = {
                "side":  "long",
                "sz":    risk["size"],
                "entry": price,
                "sl":    risk["sl"],
                "tp":    risk["tp"],
                "lev":   risk["leverage"],
                "opened": datetime.now(timezone.utc).isoformat(),
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


# ── Position monitor (check if SL/TP hit via closed positions)
def run_position_monitor(info: Info, state: dict) -> None:
    if not state["bot_positions"]:
        return
    try:
        hl_state  = info.user_state(WALLET_ADDRESS)
        open_coins = {
            p["position"]["coin"]
            for p in (hl_state.get("assetPositions") or [])
            if float(p["position"]["szi"]) != 0
        }
    except Exception as e:
        logger.warning("Position monitor error: %s", e)
        return

    closed = [coin for coin in list(state["bot_positions"]) if coin not in open_coins]
    for coin in closed:
        pos = state["bot_positions"].pop(coin)
        logger.info("%s: position closed (SL/TP hit or manual close)", coin)
        # Fetch actual PnL from fills — simplified: use price vs entry
        price = get_price(info, coin)
        pnl_pct = (price - pos["entry"]) / pos["entry"] if pos["side"] == "long" else \
                  (pos["entry"] - price) / pos["entry"]
        pnl_usd = pnl_pct * pos["sz"] * pos["entry"]
        reason  = "TP hit" if pnl_pct > 0 else "SL hit"
        notify_exit(coin, pos["side"], pnl_usd, reason)
        save_state(state)


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

    while True:
        now = time.time()

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
                run_position_monitor(info, state)
            except Exception as e:
                logger.warning("Position monitor error: %s", e)
            last_pos_poll = now

        time.sleep(5)


if __name__ == "__main__":
    main()
