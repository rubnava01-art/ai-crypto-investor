"""Paper trading cycle tests with mocked market data."""
import datetime as dt
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.state import state
from app.models.tables import Base, MarketCandle, Order, Trade
from app.paper import trader
from app.strategy.engine import SignalCandidate


@pytest.fixture()
def db():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()
    eng.dispose()


@pytest.fixture(autouse=True)
def _reset_state():
    state.kill_switch = False
    state.simulation_mode = "paper"
    yield
    state.kill_switch = False
    state.simulation_mode = "simulation"


def _candles(last_close, n=100, symbol="BTC/USD"):
    base = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
    out = []
    for i in range(n):
        c = last_close - (n - 1 - i) * 0.1
        out.append(MarketCandle(symbol=symbol, timeframe="1h",
                               open_time_utc=base + dt.timedelta(hours=i),
                               open=Decimal(str(c)), high=Decimal(str(c + 0.05)),
                               low=Decimal(str(c - 0.05)), close=Decimal(str(c)),
                               volume=Decimal("10"), source="test"))
    return out


def _buy_candidate(entry):
    return SignalCandidate("BTC/USD", "buy", entry, entry * 1.02, entry * 0.99, "test")


def _candles_for(symbol):
    def _fake(db, sym, timeframe="1h", limit=200):
        return _candles(150.0, symbol=sym) if sym == "BTC/USD" else []
    return _fake


def test_paper_cycle_opens_position(db):
    with patch("app.data.ingest.latest_candles", side_effect=_candles_for("BTC/USD")), \
         patch("app.paper.trader.strat.evaluate", return_value=_buy_candidate(150.0)):
        summary = trader.paper_cycle(db)
    assert summary["opened"] == 1
    orders = db.query(Order).filter(Order.mode == "paper").all()
    assert len(orders) == 1
    assert orders[0].status == "executed"
    trades = db.query(Trade).all()
    assert len(trades) == 1 and trades[0].closed_at is None


def test_paper_cycle_closes_on_target(db):
    with patch("app.data.ingest.latest_candles", side_effect=_candles_for("BTC/USD")), \
         patch("app.paper.trader.strat.evaluate", return_value=_buy_candidate(150.0)):
        trader.paper_cycle(db)
    # price rallies above target 153 -> close
    def _up(db, sym, timeframe="1h", limit=200):
        return _candles(154.0, symbol=sym) if sym == "BTC/USD" else []
    with patch("app.data.ingest.latest_candles", side_effect=_up), \
         patch("app.paper.trader.strat.evaluate",
               return_value=SignalCandidate("BTC/USD", "hold", None, None, None, "x")):
        summary = trader.paper_cycle(db)
    assert summary["closed"] == 1
    trade = db.query(Trade).first()
    assert trade.closed_at is not None
    assert trade.pnl_net is not None and trade.pnl_net > 0


def test_paper_cycle_hold_opens_nothing(db):
    candles = _candles(150.0)
    with patch("app.data.ingest.latest_candles", return_value=candles), \
         patch("app.paper.trader.strat.evaluate",
               return_value=SignalCandidate("BTC/USD", "hold", None, None, None, "x")):
        summary = trader.paper_cycle(db)
    assert summary["opened"] == 0
    assert db.query(Order).count() == 0
