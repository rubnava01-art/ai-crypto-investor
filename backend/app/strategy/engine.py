"""Trend + momentum strategy (long/flat, spot only).

Rules (evaluated on CLOSED candles only — never the forming candle):
  BUY  when: close > sma20 > sma50 (uptrend) AND rsi14 < 70 (not overbought)
             AND macd_histogram > 0 (positive momentum)
  SELL when: close < sma20 < sma50 (downtrend) AND rsi14 > 30 (not oversold)
             AND macd_histogram < 0
  HOLD otherwise (no obligation to trade).

Entry = last close. Target = entry +/- 2%. Invalidation (stop) = entry -/+ 1%,
matching the 1%-risk position sizing in core/risk_math.py.

The engine is exchange-independent: it consumes indicator snapshots only.
"""
from dataclasses import dataclass


@dataclass
class SignalCandidate:
    symbol: str
    side: str  # buy | sell | hold
    entry_price: float | None
    target_price: float | None
    invalidation_price: float | None
    reason: str


TARGET_PCT = 0.02
STOP_PCT = 0.01


def evaluate(symbol: str, ind: dict) -> SignalCandidate:
    close = ind.get("last_close")
    sma20, sma50 = ind.get("sma_20"), ind.get("sma_50")
    rsi = ind.get("rsi_14")
    macd = ind.get("macd") or {}
    hist = macd.get("histogram")

    def hold(why: str) -> SignalCandidate:
        return SignalCandidate(symbol, "hold", None, None, None, why)

    if close is None or sma20 is None or sma50 is None or rsi is None or hist is None:
        return hold("not enough indicator data")

    if close > sma20 > sma50 and rsi < 70 and hist > 0:
        entry = close
        return SignalCandidate(
            symbol=symbol,
            side="buy",
            entry_price=entry,
            target_price=entry * (1 + TARGET_PCT),
            invalidation_price=entry * (1 - STOP_PCT),
            reason=(
                f"uptrend (close {close:.2f} > sma20 {sma20:.2f} > sma50 {sma50:.2f}), "
                f"rsi {rsi:.1f} < 70, macd_hist {hist:.2f} > 0"
            ),
        )
    if close < sma20 < sma50 and rsi > 30 and hist < 0:
        entry = close
        return SignalCandidate(
            symbol=symbol,
            side="sell",
            entry_price=entry,
            target_price=entry * (1 - TARGET_PCT),
            invalidation_price=entry * (1 + STOP_PCT),
            reason=(
                f"downtrend (close {close:.2f} < sma20 {sma20:.2f} < sma50 {sma50:.2f}), "
                f"rsi {rsi:.1f} > 30, macd_hist {hist:.2f} < 0"
            ),
        )
    return hold("no trend+momentum alignment")
