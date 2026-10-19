"""Risk guard tests: server-side enforcement of every spec rule."""
import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.state import state
from app.models.tables import Base, Order, Signal, Trade
from app.risk.guard import apply_risk, decide_and_persist
from app.strategy.engine import SignalCandidate


@pytest.fixture(autouse=True)
def _reset_state():
    state.kill_switch = False
    state.scanner_running = False
    state.simulation_mode = "simulation"
    yield
    state.kill_switch = False
    state.scanner_running = False
    state.simulation_mode = "simulation"


@pytest.fixture()
def db():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()
    eng.dispose()


def _buy(symbol="BTC/USD", entry=100.0):
    return SignalCandidate(
        symbol=symbol,
        side="buy",
        entry_price=entry,
        target_price=entry * 1.02,
        invalidation_price=entry * 0.99,
        reason="test",
    )


def test_happy_path_approves_with_sizing(db):
    r = apply_risk(db, _buy(), Decimal("20"))
    assert r.approved, r.reason
    # risk 1% of 20 = 0.20; stop distance 1.0 -> qty 0.20
    assert r.quantity == Decimal("0.20000000")


def test_kill_switch_blocks(db):
    state.kill_switch = True
    try:
        r = apply_risk(db, _buy(), Decimal("20"))
        assert not r.approved
        assert "kill switch" in r.reason
    finally:
        state.kill_switch = False


def test_max_trades_per_day_blocks(db):
    now = dt.datetime.now(dt.timezone.utc)
    for i in range(3):
        db.add(
            Order(
                client_order_id=f"t{i}",
                symbol="BTC/USD",
                side="buy",
                quantity=Decimal("0.1"),
                status="executed",
                created_at=now,
            )
        )
    db.commit()
    r = apply_risk(db, _buy(), Decimal("20"))
    assert not r.approved
    assert "max 3 trades" in r.reason


def test_daily_loss_cap_blocks(db):
    now = dt.datetime.now(dt.timezone.utc)
    db.add(
        Trade(
            symbol="BTC/USD",
            side="buy",
            pnl_net=Decimal("-0.35"),
            opened_at=now,
            closed_at=now,
        )
    )
    db.commit()
    # potential loss 0.20 + realized 0.35 = 0.55 >= 0.40 cap
    r = apply_risk(db, _buy(), Decimal("20"))
    assert not r.approved
    assert "daily loss cap" in r.reason


def test_duplicate_order_blocked(db):
    db.add(
        Order(
            client_order_id="dup1",
            symbol="BTC/USD",
            side="buy",
            quantity=Decimal("0.1"),
            status="sent",
        )
    )
    db.commit()
    r = apply_risk(db, _buy(), Decimal("20"))
    assert not r.approved
    assert "duplicate" in r.reason


def test_hold_candidate_rejected_with_reason(db):
    c = SignalCandidate("BTC/USD", "hold", None, None, None, "no alignment")
    r = apply_risk(db, c, Decimal("20"))
    assert not r.approved


def test_decide_and_persist_records_signal_and_decision(db):
    signal, decision, result = decide_and_persist(db, _buy("ETH/USD"), Decimal("20"))
    assert signal.id is not None
    assert decision.signal_id == signal.id
    assert signal.status == "approved"
    assert decision.approved is True
    # rejected path
    c = SignalCandidate("BTC/USD", "hold", None, None, None, "chop")
    s2, d2, r2 = decide_and_persist(db, c, Decimal("20"))
    assert s2.status == "rejected"
    assert d2.approved is False
