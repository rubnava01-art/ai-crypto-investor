"""Indicator math tests against known values."""
from app.indicators.technical import ema, macd, rsi, sma, volatility


def test_sma_basic():
    assert sma([1, 2, 3, 4, 5], 3) == 4.0
    assert sma([1, 2], 3) is None


def test_ema_converges_toward_recent():
    vals = [10.0] * 20 + [20.0] * 5
    e = ema(vals, 10)
    assert e is not None
    assert 10.0 < e < 20.0


def test_rsi_all_gains_is_100():
    closes = [float(100 + i) for i in range(20)]
    assert rsi(closes, 14) == 100.0


def test_rsi_all_losses_is_0():
    closes = [float(100 - i) for i in range(20)]
    assert rsi(closes, 14) == 0.0


def test_rsi_needs_n_plus_1():
    assert rsi([1.0] * 14, 14) is None
    assert rsi([1.0] * 15, 14) is not None


def test_macd_shape():
    closes = [100 + (i % 10) + i * 0.5 for i in range(60)]
    m = macd(closes)
    assert m is not None
    assert set(m.keys()) == {"macd_line", "signal_line", "histogram"}
    assert abs(m["histogram"] - (m["macd_line"] - m["signal_line"])) < 1e-9


def test_macd_needs_data():
    assert macd([100.0] * 20) is None


def test_volatility_flat_series_is_zero():
    assert volatility([100.0] * 30, 20) == 0.0


def test_volatility_positive_for_moving_series():
    closes = [100 * (1 + 0.01 * ((i % 2) * 2 - 1)) for i in range(30)]
    v = volatility(closes, 20)
    assert v is not None and v > 0
