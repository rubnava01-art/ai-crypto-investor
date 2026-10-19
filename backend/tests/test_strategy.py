"""Strategy engine tests on synthetic indicator snapshots."""
from app.strategy.engine import evaluate


def _snap(**kw):
    base = {
        "last_close": 100.0,
        "sma_20": 99.0,
        "sma_50": 98.0,
        "rsi_14": 55.0,
        "macd": {"macd_line": 1.0, "signal_line": 0.5, "histogram": 0.5},
    }
    base.update(kw)
    return base


def test_uptrend_gives_buy():
    c = evaluate("BTC/USD", _snap())
    assert c.side == "buy"
    assert c.entry_price == 100.0
    assert c.target_price == 102.0
    assert c.invalidation_price == 99.0


def test_overbought_blocks_buy():
    c = evaluate("BTC/USD", _snap(rsi_14=75.0))
    assert c.side == "hold"


def test_downtrend_gives_sell():
    c = evaluate(
        "BTC/USD",
        _snap(
            last_close=97.0,
            sma_20=98.0,
            sma_50=99.0,
            rsi_14=45.0,
            macd={"macd_line": -1.0, "signal_line": -0.5, "histogram": -0.5},
        ),
    )
    assert c.side == "sell"


def test_chop_gives_hold():
    c = evaluate("BTC/USD", _snap(sma_20=100.5, sma_50=99.5))  # close below sma20
    assert c.side == "hold"


def test_missing_data_gives_hold():
    c = evaluate("BTC/USD", {"last_close": 100.0})
    assert c.side == "hold"
    assert "not enough" in c.reason
