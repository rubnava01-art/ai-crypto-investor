"""Execution engine tests: lifecycle, partial fills, sandbox failure, real blocked."""
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.execution import engine as exec_engine
from app.models.tables import Base, Fill, Order


@pytest.fixture()
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()
    eng.dispose()


def _order(db, **kw):
    mode = kw.pop("mode", "simulation")
    o = Order(client_order_id=kw.pop("client_order_id", "c1"), symbol="BTC/USD",
              side="buy", quantity=Decimal("0.001"), order_type="market",
              status="pending", mode=mode, **kw)
    db.add(o)
    db.commit()
    return o


def test_simulated_execution_fills_and_records_fee(db):
    o = _order(db)
    out = exec_engine.execute_simulated(db, o, price=Decimal("80000"))
    assert out.status == "executed"
    fills = db.query(Fill).filter(Fill.order_id == o.id).all()
    assert len(fills) == 1
    assert fills[0].price == Decimal("80000")
    assert fills[0].fee == Decimal("80000") * Decimal("0.001") * Decimal("0.001")


def test_partial_fill_status(db):
    o = _order(db)
    o.status = "sent"
    db.flush()
    exec_engine._record_fill(db, o, Decimal("80000"), Decimal("0.0004"))
    exec_engine._refresh_status(db, o)
    assert o.status == "partial"


def test_new_client_order_id_unique():
    assert exec_engine.new_client_order_id() != exec_engine.new_client_order_id()


def test_real_mode_raises(db):
    o = _order(db, mode="real", client_order_id="c-real")
    with pytest.raises(RuntimeError, match="disabled"):
        exec_engine.execute(db, o)


def test_sandbox_without_keys_fails_cleanly(db):
    o = _order(db, mode="sandbox", client_order_id="c-sb")
    with pytest.raises(RuntimeError, match="not configured"):
        exec_engine.execute_sandbox(db, o)
    assert o.status == "failed"
