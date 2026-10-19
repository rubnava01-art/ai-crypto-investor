"""Server-side risk guard (Phase 3). Every signal passes through here before
any order can exist. Pure checks live in core/risk_math.py; this module adds
the stateful checks (kill switch, daily caps, duplicates, balance)."""
import datetime as dt
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import settings
from app.core import risk_math
from app.core.state import state
from app.models.tables import Order, RiskDecision, Signal, Trade
from app.strategy.engine import SignalCandidate

FEE_RATE = Decimal("0.001")  # 0.1% conservative default until exchange fees are read


@dataclass
class GuardResult:
    approved: bool
    reason: str
    quantity: Decimal | None = None
    max_risk_usd: Decimal | None = None


def _today_start() -> dt.datetime:
    now = dt.datetime.now(dt.timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def apply_risk(
    db: Session, candidate: SignalCandidate, equity_usd: Decimal
) -> GuardResult:
    """Evaluate a signal candidate against all risk rules. Never raises for
    business rejections — returns approved=False with a reason."""
    max_risk = risk_math.risk_amount_usd(
        equity_usd, Decimal(settings.max_risk_per_trade_pct)
    )

    if state.kill_switch:
        return GuardResult(False, "kill switch engaged", max_risk_usd=max_risk)

    if candidate.side == "hold" or candidate.entry_price is None:
        return GuardResult(False, f"no trade: {candidate.reason}", max_risk_usd=max_risk)

    # Max trades per day
    trades_today = (
        db.query(Order)
        .filter(Order.created_at >= _today_start(), Order.mode != "real")
        .count()
    )
    ok, reason = risk_math.trades_today_ok(trades_today, settings.max_trades_per_day)
    if not ok:
        return GuardResult(False, reason, max_risk_usd=max_risk)

    # Daily loss cap (realized losses today)
    loss_today = (
        db.query(Trade)
        .filter(Trade.closed_at >= _today_start(), Trade.pnl_net < 0)
        .with_entities(Trade.pnl_net)
        .all()
    )
    realized_loss = sum((-p[0] for p in loss_today), Decimal("0"))
    potential_loss = max_risk  # worst case: stop hit in full
    ok, reason = risk_math.daily_loss_ok(
        realized_loss, potential_loss, Decimal(settings.max_daily_loss_usd)
    )
    if not ok:
        return GuardResult(False, reason, max_risk_usd=max_risk)

    # Duplicate prevention: no open order for the same symbol+side
    dup = (
        db.query(Order)
        .filter(
            Order.symbol == candidate.symbol,
            Order.side == candidate.side,
            Order.status.in_(["pending", "approved", "sent", "partial"]),
        )
        .first()
    )
    if dup:
        return GuardResult(
            False,
            f"duplicate blocked: open {dup.side} order #{dup.id} for {dup.symbol}",
            max_risk_usd=max_risk,
        )

    # Position sizing from stop distance
    entry = Decimal(str(candidate.entry_price))
    stop = Decimal(str(candidate.invalidation_price))
    target = Decimal(str(candidate.target_price))
    try:
        qty = risk_math.position_quantity(
            equity_usd, Decimal(settings.max_risk_per_trade_pct), entry, stop
        )
    except ValueError as e:
        return GuardResult(False, f"sizing error: {e}", max_risk_usd=max_risk)

    # Round-trip cost vs target
    ok, reason = risk_math.round_trip_cost_ok(qty, entry, target, FEE_RATE)
    if not ok:
        return GuardResult(False, reason, max_risk_usd=max_risk)

    # Balance: can't buy more than available equity
    notional = qty * entry
    if notional > equity_usd:
        return GuardResult(
            False,
            f"insufficient balance: need {notional:.2f}, available {equity_usd:.2f}",
            max_risk_usd=max_risk,
        )

    return GuardResult(True, "all risk checks passed", qty, max_risk)


def decide_and_persist(
    db: Session, candidate: SignalCandidate, equity_usd: Decimal
) -> tuple[Signal, RiskDecision, GuardResult]:
    """Persist the signal and its risk decision. Returns all three."""
    signal = Signal(
        strategy_version_id=None,
        symbol=candidate.symbol,
        side=candidate.side,
        entry_price=(
            Decimal(str(candidate.entry_price))
            if candidate.entry_price is not None
            else None
        ),
        target_price=(
            Decimal(str(candidate.target_price))
            if candidate.target_price is not None
            else None
        ),
        invalidation_price=(
            Decimal(str(candidate.invalidation_price))
            if candidate.invalidation_price is not None
            else None
        ),
        reason=candidate.reason,
        status="generated" if candidate.side != "hold" else "demo",
    )
    db.add(signal)
    db.flush()

    result = apply_risk(db, candidate, equity_usd)
    decision = RiskDecision(
        signal_id=signal.id,
        approved=result.approved,
        reason=result.reason,
        max_risk_usd=result.max_risk_usd or Decimal("0"),
        position_size=result.quantity,
    )
    db.add(decision)
    signal.status = "approved" if result.approved else "rejected"
    db.commit()
    return signal, decision, result
