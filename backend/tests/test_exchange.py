"""Exchange endpoints: metadata-only registration; balances need real keys."""
from unittest.mock import patch

from app.exchange import adapter


def test_status_unconfigured(client, auth_headers):
    with patch.object(adapter, "is_configured", return_value=False):
        r = client.get("/api/exchange/status", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["configured"] is False
    assert r.json()["read_only"] is True


def test_balances_unconfigured_is_503(client, auth_headers):
    with patch.object(adapter, "is_configured", return_value=False):
        r = client.get("/api/exchange/balances", headers=auth_headers)
    assert r.status_code == 503


def test_balances_with_mocked_adapter(client, auth_headers):
    fake_balance = {
        "BTC": {"free": 0.001, "used": 0.0, "total": 0.001},
        "USD": {"free": 20.0, "used": 0.0, "total": 20.0},
        "info": {},
    }

    class FakeAdapter:
        def fetch_balance(self):
            return fake_balance

    with patch.object(adapter, "is_configured", return_value=True), \
         patch.object(adapter, "ReadOnlyAdapter", return_value=FakeAdapter()):
        r = client.get("/api/exchange/balances", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "kraken"
    assert body["balances"]["USD"]["total"] == "20.0"
    assert "info" not in body["balances"]


def test_register_connection_stores_metadata_only(client, auth_headers):
    r = client.post(
        "/api/exchange/connections",
        headers=auth_headers,
        json={"exchange": "kraken", "label": "main-readonly"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["exchange"] == "kraken"
    assert "secret" not in body and "api_key" not in body


def test_register_connection_rejects_bad_exchange(client, auth_headers):
    r = client.post(
        "/api/exchange/connections",
        headers=auth_headers,
        json={"exchange": "binance", "label": "x"},
    )
    assert r.status_code == 400


def test_adapter_refuses_without_keys():
    with patch.object(adapter.settings, "kraken_api_key", ""), \
         patch.object(adapter.settings, "kraken_api_secret", ""):
        try:
            adapter.ReadOnlyAdapter()
            assert False, "should have raised"
        except adapter.ExchangeNotConfigured:
            pass
