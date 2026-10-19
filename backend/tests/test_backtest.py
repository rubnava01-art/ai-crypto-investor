"""Backtest engine tests on synthetic data."""
import datetime as dt
from decimal import Decimal

import pytest

from app.backtest.engine import (
    BacktestConfig,
    compute_metrics,
    run_backtest,
    split_train_val_test,
)


def _wave(n=300):
    # choppy uptrend: rises with pullbacks so RSI oscillates
    import math
    return [100 + i * 0.15 + 3 * math.sin(i / 5) for i in range(n)]


def test_backtest_runs_and_reports_metrics():
    cfg = BacktestConfig()
    result = run_backtest(_wave(), cfg)
    m = result.metrics
    assert result.equity_curve and len(result.equity_curve) == 300 - 60
    for key in ("net_return_pct", "baseline_return_pct", "max_drawdown_pct",
                "win_rate_pct", "expectancy_usd", "n_trades", "final_equity_usd"):
        assert key in m, key
    assert m["n_trades"] >= 0
    csv_text = result.to_csv()
    assert csv_text.startswith("entry_idx,exit_idx")
    assert csv_text.count("\n") == m["n_trades"] + 1


def test_backtest_needs_minimum_data():
    with pytest.raises(ValueError):
        run_backtest([100.0] * 50, BacktestConfig())


def test_backtest_flat_market_trades_little():
    result = run_backtest([100.0] * 200, BacktestConfig())
    # flat: no trend alignment -> few or zero trades, no crash
    assert result.metrics["n_trades"] <= 2


def test_split_proportions():
    train, val, test = split_train_val_test(1000, 0.6, 0.2)
    assert train == (0, 600) and val == (600, 800) and test == (800, 1000)


def test_metrics_keys_even_with_no_trades():
    cfg = BacktestConfig()
    result = run_backtest([100.0] * 200, cfg)
    assert result.metrics["win_rate_pct"] == 0.0
    assert result.metrics["sharpe_per_trade"] is None
