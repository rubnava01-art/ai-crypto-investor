"""Technical indicators as pure functions over close-price series.

Hand-rolled (no extra dependency) so the math is auditable and unit-testable.
Conventions: each function takes oldest-first lists and returns the latest value
(or None when there isn't enough data). No future data is ever used.
"""
import math


def sma(values: list[float], n: int) -> float | None:
    if len(values) < n or n <= 0:
        return None
    return sum(values[-n:]) / n


def ema(values: list[float], n: int) -> float | None:
    """Exponential moving average, seeded with the SMA of the first n values."""
    if len(values) < n or n <= 0:
        return None
    k = 2 / (n + 1)
    e = sum(values[:n]) / n
    for v in values[n:]:
        e = v * k + e * (1 - k)
    return e


def ema_series(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) < n or n <= 0:
        return out
    k = 2 / (n + 1)
    e = sum(values[:n]) / n
    out[n - 1] = e
    for i in range(n, len(values)):
        e = values[i] * k + e * (1 - k)
        out[i] = e
    return out


def rsi(closes: list[float], n: int = 14) -> float | None:
    """Wilder's RSI."""
    if len(closes) < n + 1 or n <= 0:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[:n]) / n
    avg_loss = sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        avg_gain = (avg_gain * (n - 1) + g) / n
        avg_loss = (avg_loss * (n - 1) + l) / n
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def macd(
    closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> dict | None:
    """Returns {macd_line, signal_line, histogram} for the latest close."""
    if len(closes) < slow + signal:
        return None
    fast_e = ema_series(closes, fast)
    slow_e = ema_series(closes, slow)
    macd_line = [
        (f - s) if (f is not None and s is not None) else None
        for f, s in zip(fast_e, slow_e)
    ]
    valid = [x for x in macd_line if x is not None]
    sig_series = ema_series(valid, signal)
    if sig_series[-1] is None or macd_line[-1] is None:
        return None
    return {
        "macd_line": macd_line[-1],
        "signal_line": sig_series[-1],
        "histogram": macd_line[-1] - sig_series[-1],
    }


def volatility(closes: list[float], n: int = 20) -> float | None:
    """Standard deviation of log returns over the last n closes (per-period)."""
    if len(closes) < n + 1 or n <= 0:
        return None
    rets = [
        math.log(closes[i] / closes[i - 1])
        for i in range(len(closes) - n, len(closes))
        if closes[i - 1] > 0
    ]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    return math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1))


def volume_sma(volumes: list[float], n: int = 20) -> float | None:
    return sma(volumes, n)


def summarize(
    closes: list[float], volumes: list[float] | None = None
) -> dict:
    """Latest indicator snapshot for a close series."""
    vols = volumes or []
    m = macd(closes)
    return {
        "rsi_14": rsi(closes, 14),
        "macd": m,
        "sma_20": sma(closes, 20),
        "sma_50": sma(closes, 50),
        "ema_20": ema(closes, 20),
        "volatility_20": volatility(closes, 20),
        "volume_sma_20": volume_sma(vols, 20) if vols else None,
        "last_close": closes[-1] if closes else None,
        "n_candles": len(closes),
    }
