"""Staleness flags on /api/market/candles and /api/market/indicators
(2026-11-08): both endpoints used to answer `updated_utc: now` even
when the newest stored candle was hours or days old — the same dead
data the strategy guard (2026-11-06) refuses to evaluate. Now they
report `stale` and `newest_candle_utc` with the same 2-timeframe rule,
so no consumer can mistake old candles for current ones."""
import time
from unittest.mock import patch


def _seed(client, auth_headers, symbol, last_open_epoch_s, n=70):
    """70 velas horarias terminando en last_open_epoch_s (vía ingest)."""
    rows = [
        [
            int((last_open_epoch_s - (n - 1 - i) * 3600) * 1000),
            100 + i,
            101 + i,
            99 + i,
            100.5 + i,
            10 + i,
        ]
        for i in range(n)
    ]
    with patch("app.data.exchanges.fetch_ohlcv", return_value=rows):
        r = client.post(
            f"/api/market/ingest?symbol={symbol}&timeframe=1h",
            headers=auth_headers,
        )
    assert r.status_code == 200, r.text
    assert r.json()["ingested"] == n


def test_candles_fresh_not_stale(client, auth_headers):
    now = time.time()
    _seed(client, auth_headers, "ADA/USD", now - 3600)
    r = client.get(
        "/api/market/candles?symbol=ADA/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stale"] is False
    assert body["newest_candle_utc"]
    assert len(body["candles"]) == 70


def test_candles_old_is_stale(client, auth_headers):
    now = time.time()
    _seed(client, auth_headers, "DOGE/USD", now - 6 * 3600)
    r = client.get(
        "/api/market/candles?symbol=DOGE/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stale"] is True
    # La vela más reciente reportada es la sembrada (~6h atrás).
    assert body["newest_candle_utc"]


def test_indicators_share_staleness(client, auth_headers):
    now = time.time()
    _seed(client, auth_headers, "ADA/USD", now - 3600)
    _seed(client, auth_headers, "DOGE/USD", now - 6 * 3600)
    fresh = client.get(
        "/api/market/indicators?symbol=ADA/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["stale"] is False
    old = client.get(
        "/api/market/indicators?symbol=DOGE/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert old.status_code == 200, old.text
    assert old.json()["stale"] is True
    assert old.json()["newest_candle_utc"]


def test_candles_without_data_still_503(client, auth_headers):
    r = client.get(
        "/api/market/candles?symbol=SOL/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 503
