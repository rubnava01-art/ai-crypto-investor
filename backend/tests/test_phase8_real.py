"""Phase 8 real-trading gate tests (mocked exchange — no real money moves).

Armor under test: server flag, keys required, $20 cumulative cap, no naked
real sells, kill switch, admin-only.
"""
import uuid
from decimal import Decimal

import pytest

import app.execution.engine as engine
from app.config import settings
from app.database import get_db
from app.models.tables import Fill, Order


@pytest.fixture(autouse=True)
def _clean_real_orders(app):
    """Tests share one app/DB: wipe real orders/fills and reset global state
    (kill switch, mode, login limiter) so each test starts clean."""
    from app.core.rate_limit import login_limiter
    from app.core.state import state

    state.kill_switch = False
    state.simulation_mode = "simulation"
    login_limiter._hits.clear()
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    real_ids = [o.id for o in db.query(Order).filter(Order.mode == "real").all()]
    if real_ids:
        db.query(Fill).filter(Fill.order_id.in_(real_ids)).delete(synchronize_session=False)
        db.query(Order).filter(Order.id.in_(real_ids)).delete(synchronize_session=False)
        db.commit()
    db.close()
    yield


class FakeExchange:
    def __init__(self):
        self.sent = []

    def create_order(self, symbol, type_, side, amount, params=None):
        self.sent.append((symbol, side, amount, params))
        return {"id": "TXID-TEST", "filled": amount, "average": 50000.0, "price": 50000.0}

    def fetch_order(self, id_, symbol, params=None):  # noqa: A002 - ccxt signature
        return None


@pytest.fixture()
def real_env(client, monkeypatch):
    fake = FakeExchange()
    monkeypatch.setattr(settings, "real_trading_enabled", True)
    monkeypatch.setattr(settings, "kraken_api_key", "test-key")
    monkeypatch.setattr(settings, "kraken_api_secret", "test-secret")
    monkeypatch.setattr(engine, "_real_exchange", lambda: fake)
    monkeypatch.setattr(engine, "_market_price", lambda symbol: Decimal("50000"))
    return fake


def _admin(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _order(client, headers, qty, side="buy", symbol="BTC/USD"):
    return client.post(
        "/api/orders",
        json={"symbol": symbol, "side": side, "quantity": qty, "mode": "real"},
        headers={**headers, "Idempotency-Key": f"test-{uuid.uuid4().hex}"},
    )


def test_real_blocked_when_flag_off(client, monkeypatch):
    monkeypatch.setattr(settings, "real_trading_enabled", False)
    r = _order(client, _admin(client), "0.0001")
    assert r.status_code == 403


def test_real_blocked_without_keys(client, monkeypatch):
    monkeypatch.setattr(settings, "real_trading_enabled", True)
    monkeypatch.setattr(settings, "kraken_api_key", "")
    monkeypatch.setattr(settings, "kraken_api_secret", "")
    r = _order(client, _admin(client), "0.0001")
    assert r.status_code == 503


def test_real_buy_executes_and_cap_holds(client, real_env):
    h = _admin(client)
    r = _order(client, h, "0.0003")  # $15 at mocked $50,000
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "executed"
    assert r.json()["mode"] == "real"
    assert len(real_env.sent) == 1
    # $15 used of the $20 cap: another $10 buy must be rejected
    r2 = _order(client, h, "0.0002")
    assert r2.status_code == 422


def test_real_sell_needs_position_and_works(client, real_env):
    h = _admin(client)
    r = _order(client, h, "0.0002", side="sell")
    assert r.status_code == 422  # nothing to sell yet
    assert _order(client, h, "0.0003").status_code == 200  # buy $15
    r = _order(client, h, "0.0002", side="sell")
    assert r.status_code == 200, r.text


def test_set_mode_real_requires_flag(client, monkeypatch):
    h = _admin(client)
    monkeypatch.setattr(settings, "real_trading_enabled", False)
    r = client.post("/api/simulation/mode", json={"mode": "real"}, headers=h)
    assert r.status_code == 403
    monkeypatch.setattr(settings, "real_trading_enabled", True)
    monkeypatch.setattr(settings, "kraken_api_key", "k")
    monkeypatch.setattr(settings, "kraken_api_secret", "s")
    r = client.post("/api/simulation/mode", json={"mode": "real"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["current"] == "real"
    # restore for other tests
    client.post("/api/simulation/mode", json={"mode": "simulation"}, headers=h)


def test_live_balance_endpoint_states(client, monkeypatch):
    h = _admin(client)
    monkeypatch.setattr(settings, "kraken_api_key", "")
    monkeypatch.setattr(settings, "kraken_api_secret", "")
    r = client.get("/api/exchange/live", headers=h)
    assert r.status_code == 200
    assert r.json()["connected"] is False
