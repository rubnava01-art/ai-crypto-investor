"""Market endpoints: auth required; no-data -> 503 (never fake data)."""
from unittest.mock import patch


def test_market_requires_auth(client):
    assert client.get("/api/market/candles").status_code == 401
    assert client.get("/api/market/ticker").status_code == 401
    assert client.get("/api/market/indicators").status_code == 401


def test_candles_empty_db_is_503(client, auth_headers):
    r = client.get("/api/market/candles?symbol=FAKE/USD", headers=auth_headers)
    assert r.status_code == 503


def test_ingest_and_candles_roundtrip(client, auth_headers):
    fake_rows = [
        [1700000000000 + i * 3600000, 100 + i, 101 + i, 99 + i, 100.5 + i, 10 + i]
        for i in range(50)
    ]
    with patch(
        "app.data.exchanges.fetch_ohlcv", return_value=fake_rows
    ):
        r = client.post(
            "/api/market/ingest?symbol=BTC/USD&timeframe=1h", headers=auth_headers
        )
    assert r.status_code == 200, r.text
    assert r.json()["ingested"] == 50
    assert r.json()["source"] == "kraken"

    r = client.get("/api/market/candles?symbol=BTC/USD&timeframe=1h", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body["candles"]) == 50
    assert body["source"] == "kraken"

    r = client.get(
        "/api/market/indicators?symbol=BTC/USD&timeframe=1h", headers=auth_headers
    )
    assert r.status_code == 200
    ind = r.json()["indicators"]
    assert ind["n_candles"] == 50
    assert ind["rsi_14"] == 100.0  # monotonically rising closes
    assert ind["sma_20"] is not None


def test_indicators_needs_35_candles(client, auth_headers):
    fake_rows = [
        [1700000000000 + i * 3600000, 100, 101, 99, 100, 10] for i in range(10)
    ]
    with patch("app.data.exchanges.fetch_ohlcv", return_value=fake_rows):
        client.post(
            "/api/market/ingest?symbol=ETH/USD&timeframe=1h", headers=auth_headers
        )
    r = client.get(
        "/api/market/indicators?symbol=ETH/USD&timeframe=1h", headers=auth_headers
    )
    assert r.status_code == 503


def test_ticker_unreachable_is_503(client, auth_headers):
    with patch("app.data.exchanges.fetch_ticker", side_effect=RuntimeError("down")):
        r = client.get("/api/market/ticker?symbol=BTC/USD", headers=auth_headers)
    assert r.status_code == 503


def test_candles_rejects_nonpositive_limit(client, auth_headers):
    # limit=-1 en SQLite significa "sin límite": sin ge=1 devolvería
    # toda la tabla en vez de un 422.
    for bad in ("0", "-5"):
        r = client.get(
            f"/api/market/candles?symbol=BTC/USD&limit={bad}",
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)


def test_market_rejects_unsupported_exchange(client, auth_headers):
    # Antes un exchange inventado caía en 503 tras intentar la red
    # (en /prices, tras 4 tickers + 4 OHLCV fallidos); ahora es 422
    # inmediato, sin tocar la red ni consumir el limitador.
    for url in (
        "/api/market/candles?symbol=BTC/USD&exchange=binance",
        "/api/market/ticker?symbol=BTC/USD&exchange=binance",
        "/api/market/indicators?symbol=BTC/USD&exchange=binance",
        "/api/market/prices?exchange=binance",
    ):
        r = client.get(url, headers=auth_headers)
        assert r.status_code == 422, (url, r.text)
    r = client.post(
        "/api/market/ingest?symbol=BTC/USD&exchange=binance", headers=auth_headers
    )
    assert r.status_code == 422, r.text
