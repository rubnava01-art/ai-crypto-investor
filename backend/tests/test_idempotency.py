"""Idempotency: a retried state-changing request replays the stored response."""
import pytest

from app.core.state import state


@pytest.fixture(autouse=True)
def _reset_state():
    state.kill_switch = False
    state.scanner_running = False
    state.simulation_mode = "simulation"
    yield
    state.kill_switch = False
    state.scanner_running = False
    state.simulation_mode = "simulation"


def test_kill_switch_idempotent_replay(client, auth_headers):
    headers = dict(auth_headers)
    headers["Idempotency-Key"] = "test-key-123"
    r1 = client.post("/api/risk/kill-switch", headers=headers)
    assert r1.status_code == 200
    assert r1.json()["kill_switch"] is True
    assert r1.json()["idempotent_replay"] is False

    r2 = client.post("/api/risk/kill-switch", headers=headers)
    assert r2.status_code == 200
    assert r2.json()["kill_switch"] is True
    assert r2.json()["idempotent_replay"] is True
    # Same engagement timestamp proves no re-execution
    assert r2.json()["engaged_utc"] == r1.json()["engaged_utc"]


def test_order_creation_requires_idempotency_key(client, auth_headers):
    r = client.post(
        "/api/orders",
        headers=auth_headers,
        json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.0001", "mode": "simulation"},
    )
    assert r.status_code == 428  # Precondition Required


def test_order_creation_simulation_executes(client, auth_headers):
    from unittest.mock import patch
    from decimal import Decimal

    headers = dict(auth_headers)
    headers["Idempotency-Key"] = "order-key-1"
    with patch(
        "app.execution.engine._market_price", return_value=Decimal("80000")
    ):
        r = client.post(
            "/api/orders",
            headers=headers,
            json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.0001", "mode": "simulation"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "executed"
    assert body["mode"] == "simulation"
    # Idempotent replay returns the same order
    with patch(
        "app.execution.engine._market_price", return_value=Decimal("80000")
    ):
        r2 = client.post(
            "/api/orders",
            headers=headers,
            json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.0001", "mode": "simulation"},
        )
    assert r2.status_code == 200
    assert r2.json()["id"] == body["id"]


def test_order_creation_real_is_forbidden(client, auth_headers):
    headers = dict(auth_headers)
    headers["Idempotency-Key"] = "order-key-real"
    r = client.post(
        "/api/orders",
        headers=headers,
        json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.0001", "mode": "real"},
    )
    assert r.status_code == 403
