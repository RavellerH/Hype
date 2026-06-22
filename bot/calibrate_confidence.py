"""
Confidence calibration — fits confidence = sigmoid(a * |score| + b) against
realized outcomes, so confidence becomes an actual probability estimate
("how often is a score of this magnitude right?") instead of an arbitrary
abs(score) + bonus heuristic.

Method:
  1. Generate synthetic Wyckoff candle series (same generator as backtest.py).
  2. Slide a window over the series; at each point compute the phase score
     and look H candles ahead to see whether price moved in the direction
     the score implied (success=1) or not (success=0).
  3. Fit a 1-D logistic regression (score magnitude -> success) via plain
     gradient descent (no external deps, so bot/ stays numpy-free).
  4. Print the fitted (a, b) for each detector so they can be hardcoded into
     phase_detector.py's confidence formula.

Usage:
  python calibrate_confidence.py
  python calibrate_confidence.py --seeds 20 --days 365 --horizon 10
"""

import sys, math, random, argparse
sys.path.insert(0, ".")
sys.path.insert(0, "../backend")

from backtest import gen_wyckoff_series
from phase_detector import detect_phase as detect_phase_bot

import importlib.util
_spec = importlib.util.spec_from_file_location("backend_phase_detector", "../backend/phase_detector.py")
_backend_pd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_backend_pd)
detect_phase_backend = _backend_pd.detect_phase

WINDOW = 60   # candles fed to detect_phase
NOISE_FLOOR = 0.004   # ignore forward moves smaller than this — too noisy to call


def build_dataset(detect_fn, candles, horizon):
    """Returns list of (abs_score, success) pairs."""
    closes = [float(c["c"]) for c in candles]
    data = []
    for i in range(WINDOW, len(candles) - horizon):
        window = candles[i - WINDOW + 1: i + 1]
        result = detect_fn(window)
        score = result["score"] if isinstance(result, dict) else result.score
        if score == 0:
            continue
        fwd_ret = (closes[i + horizon] - closes[i]) / closes[i] if closes[i] else 0
        if abs(fwd_ret) < NOISE_FLOOR:
            continue
        predicted_dir = 1 if score > 0 else -1
        actual_dir = 1 if fwd_ret > 0 else -1
        success = 1 if predicted_dir == actual_dir else 0
        data.append((abs(score), success))
    return data


def fit_logistic(data, lr=0.5, epochs=2000):
    """Fits confidence = sigmoid(a*x + b) via batch gradient descent."""
    a, b = 1.0, 0.0
    n = len(data)
    for _ in range(epochs):
        grad_a = grad_b = 0.0
        for x, y in data:
            p = 1.0 / (1.0 + math.exp(-(a * x + b)))
            err = p - y
            grad_a += err * x
            grad_b += err
        a -= lr * grad_a / n
        b -= lr * grad_b / n
    return a, b


def evaluate(data, a, b):
    """Returns (accuracy, brier_score) for the fitted calibration."""
    n = len(data)
    correct = 0
    brier = 0.0
    for x, y in data:
        p = 1.0 / (1.0 + math.exp(-(a * x + b)))
        correct += 1 if (p >= 0.5) == (y == 1) else 0
        brier += (p - y) ** 2
    return correct / n, brier / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=12)
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--horizon", type=int, default=10)
    args = ap.parse_args()

    print(f"Generating {args.seeds} synthetic series x {args.days}d, horizon={args.horizon} candles...\n")

    all_candles = []
    for seed in range(args.seeds):
        rng = random.Random(seed * 13 + 7)
        all_candles.append(gen_wyckoff_series(args.days, 1000.0, rng))

    for name, fn in (("bot/phase_detector.py", detect_phase_bot),
                      ("backend/phase_detector.py", detect_phase_backend)):
        data = []
        for candles in all_candles:
            data.extend(build_dataset(fn, candles, args.horizon))

        if len(data) < 50:
            print(f"{name}: not enough samples ({len(data)}), skipping")
            continue

        baseline_acc = sum(y for _, y in data) / len(data)
        a, b = fit_logistic(data)
        acc, brier = evaluate(data, a, b)

        print(f"=== {name} ===")
        print(f"  samples: {len(data)}   base hit-rate: {baseline_acc:.3f}")
        print(f"  fitted:  a={a:.4f}  b={b:.4f}")
        print(f"  calibrated accuracy: {acc:.3f}   brier: {brier:.4f}")
        print(f"  confidence = sigmoid({a:.4f} * abs(score) + {b:.4f})\n")


if __name__ == "__main__":
    main()
