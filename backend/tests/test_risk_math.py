"""Unit tests for the pure risk-math functions (Phase 3 server rules preview)."""
from decimal import Decimal

import pytest

from app.core.risk_math import (
    daily_loss_ok,
    position_quantity,
    risk_amount_usd,
    round_trip_cost_ok,
    trades_today_ok,
)


def test_risk_amount_is_1pct_of_20():
    assert risk_amount_usd(Decimal("20"), Decimal("1")) == Decimal("0.20000000")


def test_position_quantity_limits_loss_to_risk_amount():
    # equity 20, risk 1% -> risk 0.20; entry 100, stop 95 -> qty = 0.20/5 = 0.04
    qty = position_quantity(Decimal("20"), Decimal("1"), Decimal("100"), Decimal("95"))
    assert qty == Decimal("0.04000000")


def test_position_quantity_rejects_zero_stop_distance():
    with pytest.raises(ValueError):
        position_quantity(Decimal("20"), Decimal("1"), Decimal("100"), Decimal("100"))


def test_round_trip_cost_blocks_expensive_trade():
    # qty 0.04 @100, target 101 -> profit 0.04; fee 1% each way -> cost 0.08 > 30% of 0.04
    ok, reason = round_trip_cost_ok(
        Decimal("0.04"), Decimal("100"), Decimal("101"), Decimal("0.01")
    )
    assert ok is False
    assert "30%" in reason


def test_round_trip_cost_allows_cheap_trade():
    ok, _ = round_trip_cost_ok(
        Decimal("0.04"), Decimal("100"), Decimal("110"), Decimal("0.001")
    )
    assert ok is True


def test_daily_loss_cap_blocks():
    ok, _ = daily_loss_ok(Decimal("0.35"), Decimal("0.10"), Decimal("0.40"))
    assert ok is False
    ok, _ = daily_loss_ok(Decimal("0.10"), Decimal("0.10"), Decimal("0.40"))
    assert ok is True


def test_max_trades_per_day():
    ok, _ = trades_today_ok(3, 3)
    assert ok is False
    ok, _ = trades_today_ok(2, 3)
    assert ok is True
