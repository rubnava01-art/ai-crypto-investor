"""Tests for GET /api/market/prices (live top-coin prices, mocked exchange)."""
import app.api.market as market_mod
from app.api.market import _PRICES_CACHE


def _fake_ticker(exchange, pair):
    return {"last": 50000.0, "percentage": 1.5}


def _fake_ohlcv(exchange, pair, timeframe="1h", limit=24):
    return [[i * 3_600_000, 1, 2, 0.5, 49000.0 + i * 10, 100.0] for i in range(limit)]


def _auth_client(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_market_prices_live(client, monkeypatch):
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker)
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    headers = _auth_client(client)
    r = client.get("/api/market/prices", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "kraken"
    assert body["stale"] is False
    assert [p["symbol"] for p in body["prices"]] == ["BTC", "ETH", "USDT", "BNB"]
    btc = body["prices"][0]
    assert btc["name"] == "Bitcoin"
    assert btc["price_usd"] == 50000.0
    assert btc["change_24h_pct"] == 1.5
    assert len(btc["sparkline_24h"]) == 24


def test_market_prices_requires_auth(client):
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None
    r = client.get("/api/market/prices")
    assert r.status_code in (401, 403)


def test_market_prices_exchange_down_serves_stale(client, monkeypatch):
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker)
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    headers = _auth_client(client)
    first = client.get("/api/market/prices", headers=headers)
    assert first.status_code == 200

    def _boom(*a, **k):
        raise ConnectionError("down")

    # expire the cache so it refetches, then fails -> stale served
    _PRICES_CACHE["at"] = 0.0
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _boom)
    r = client.get("/api/market/prices", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["stale"] is True
    assert len(r.json()["prices"]) == 4


def test_market_prices_one_coin_down_keeps_others(client, monkeypatch):
    """One coin's ticker failing must not blank the whole price list."""
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None

    def _partial_ticker(exchange, pair):
        if pair == "ETH/USD":
            raise ConnectionError("ETH feed down")
        return _fake_ticker(exchange, pair)

    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _partial_ticker)
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    headers = _auth_client(client)
    r = client.get("/api/market/prices", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stale"] is False
    assert len(body["prices"]) == 4
    by_symbol = {p["symbol"]: p for p in body["prices"]}
    assert by_symbol["ETH"]["price_usd"] is None
    assert by_symbol["BTC"]["price_usd"] == 50000.0


def test_market_prices_cache_is_per_exchange(client, admin_headers, monkeypatch):
    """A cached kraken payload must not answer a coinbase request."""
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None

    def _per_exchange_ticker(exchange, pair):
        return {"last": 50000.0 if exchange == "kraken" else 60000.0, "percentage": 1.5}

    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _per_exchange_ticker)
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    # Shared admin_headers fixture: a fresh login here would eat the
    # suite-wide 10/min login budget and flake under a full run.
    headers = admin_headers
    first = client.get("/api/market/prices", headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["source"] == "kraken"
    assert first.json()["prices"][0]["price_usd"] == 50000.0
    # Within the 60s TTL: a different exchange must refetch, not reuse kraken's cache.
    second = client.get("/api/market/prices?exchange=coinbase", headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["source"] == "coinbase"
    assert second.json()["prices"][0]["price_usd"] == 60000.0
    assert second.json()["stale"] is False
