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


def test_backtest_fees_and_slippage_are_net_not_gross():
    """Fase 5a, tarea 2: con comisión y deslizamiento, el neto es menor
    que el bruto y los costes se desglosan; sin ellos, bruto == neto."""
    wave = _wave()
    free = run_backtest(wave, BacktestConfig(fee_rate=Decimal("0"), slippage_rate=Decimal("0")))
    assert free.metrics["n_trades"] > 0
    assert free.metrics["total_fees_usd"] == 0
    assert free.metrics["total_slippage_usd"] == 0
    assert free.metrics["gross_return_pct"] == free.metrics["net_return_pct"]
    # Comisión 0,2 % + deslizamiento 0,1 %: el guarda de coste de ida y
    # vuelta (objetivo +2 %) rechaza tasas mayores, como en vivo.
    paid = run_backtest(wave, BacktestConfig(fee_rate=Decimal("0.002"), slippage_rate=Decimal("0.001")))
    assert paid.metrics["n_trades"] > 0
    assert paid.metrics["total_fees_usd"] > 0
    assert paid.metrics["total_slippage_usd"] > 0
    assert paid.metrics["total_costs_usd"] == pytest.approx(
        paid.metrics["total_fees_usd"] + paid.metrics["total_slippage_usd"],
        abs=0.001,  # cada total se redondea a 4 decimales por separado
    )
    assert paid.metrics["gross_return_pct"] > paid.metrics["net_return_pct"]
    # Bruto - neto == costes / capital inicial (en puntos porcentuales).
    assert (paid.metrics["gross_return_pct"] - paid.metrics["net_return_pct"]) == pytest.approx(
        paid.metrics["total_costs_usd"] / 20.0 * 100, abs=0.05
    )
    assert paid.metrics["fee_rate"] == pytest.approx(0.002)
    assert paid.metrics["slippage_rate"] == pytest.approx(0.001)


def test_backtest_trade_pnl_net_includes_entry_costs():
    """Fase 5a, tarea 2: pnl_net de cada operación = bruto - comisión -
    deslizamiento (entrada y salida); antes faltaba la entrada."""
    wave = _wave()
    result = run_backtest(wave, BacktestConfig())
    assert result.trades
    for t in result.trades:
        assert t.pnl_net == pytest.approx(t.pnl_gross - t.fee_paid - t.slippage_paid, abs=1e-9)
        assert t.fee_paid >= 0 and t.slippage_paid >= 0


def test_backtest_csv_reports_fees_and_slippage():
    result = run_backtest(_wave(), BacktestConfig())
    header = result.to_csv().splitlines()[0]
    assert header == (
        "entry_idx,exit_idx,side,entry_price,exit_price,quantity,"
        "fee_paid,slippage_paid,pnl_gross,pnl_net,exit_reason"
    )
