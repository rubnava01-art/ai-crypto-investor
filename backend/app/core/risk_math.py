"""Pure risk-math functions (no I/O, no DB). Server-enforced from Phase 3;
these are the exact formulas, unit-tested here in Phase 1.

All money is Decimal. All prices are in quote currency per 1 unit of base.
"""
from decimal import Decimal, ROUND_DOWN


def _d(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def risk_amount_usd(equity_usd: Decimal, risk_pct: Decimal) -> Decimal:
    """Max USD to risk on one trade: equity * risk_pct / 100."""
    return (_d(equity_usd) * _d(risk_pct) / Decimal("100")).quantize(
        Decimal("0.00000001")
    )


def position_quantity(
    equity_usd: Decimal, risk_pct: Decimal, entry_price: Decimal, stop_price: Decimal
) -> Decimal:
    """Base-asset quantity so that hitting the stop loses exactly risk_amount.

    quantity = risk_amount / |entry - stop|
    """
    entry, stop = _d(entry_price), _d(stop_price)
    per_unit_risk = abs(entry - stop)
    if per_unit_risk <= 0:
        raise ValueError("entry_price and stop_price must differ")
    qty = risk_amount_usd(equity_usd, risk_pct) / per_unit_risk
    return qty.quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)


def round_trip_cost_ok(
    quantity: Decimal,
    entry_price: Decimal,
    target_price: Decimal,
    fee_rate: Decimal,
    slippage_rate: Decimal = Decimal("0"),
) -> tuple[bool, str]:
    """Block the trade if round-trip cost exceeds 30% of the profit target.

    cost = 2 * notional * fee_rate + 2 * notional * slippage_rate
    target_profit = quantity * |target - entry|
    """
    qty, entry, target = _d(quantity), _d(entry_price), _d(target_price)
    notional = qty * entry
    cost = (notional * _d(fee_rate) * 2) + (notional * _d(slippage_rate) * 2)
    profit = qty * abs(target - entry)
    if profit <= 0:
        return False, "target must differ from entry"
    if cost > profit * Decimal("0.30"):
        return (
            False,
            f"round-trip cost {cost:.8f} exceeds 30% of target profit {profit:.8f}",
        )
    return True, "ok"


def daily_loss_ok(
    realized_loss_today_usd: Decimal, potential_loss_usd: Decimal, max_daily_loss_usd: Decimal
) -> tuple[bool, str]:
    """Block if today's realized loss + this trade's worst case hits the daily cap."""
    total = _d(realized_loss_today_usd) + _d(potential_loss_usd)
    if total >= _d(max_daily_loss_usd):
        return False, f"daily loss cap reached: {total} >= {max_daily_loss_usd}"
    return True, "ok"


def trades_today_ok(trades_today: int, max_trades_per_day: int) -> tuple[bool, str]:
    if trades_today >= max_trades_per_day:
        return False, f"max {max_trades_per_day} trades per day reached"
    return True, "ok"
