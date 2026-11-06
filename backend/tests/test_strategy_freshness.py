"""Strategy freshness guard (2026-11-06): /api/strategy/evaluate must
refuse to evaluate — and persist nothing — when the newest closed
candle is older than 2 timeframes. A signal built on dead candles is
worse than no signal."""
import time
from unittest.mock import patch

from app.api.strategy import _timeframe_seconds


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


def _signals_for(client, auth_headers, symbol):
    r = client.get("/api/signals", headers=auth_headers)
    assert r.status_code == 200, r.text
    return [s for s in r.json()["signals"] if s["symbol"] == symbol]


def test_evaluate_with_fresh_candles_succeeds(client, auth_headers):
    now = time.time()
    _seed(client, auth_headers, "FRESH/USD", now)
    r = client.post(
        "/api/strategy/evaluate?symbol=FRESH/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["signal_id"] is not None
    assert len(_signals_for(client, auth_headers, "FRESH/USD")) == 1


def test_evaluate_with_stale_candles_is_503_and_persists_nothing(
    client, auth_headers
):
    now = time.time()
    # Última vela cerrada de hace ~6h en timeframe 1h (umbral: 2h).
    _seed(client, auth_headers, "STALE/USD", now - 5 * 3600)
    assert _signals_for(client, auth_headers, "STALE/USD") == []
    r = client.post(
        "/api/strategy/evaluate?symbol=STALE/USD&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 503, r.text
    assert "Stale candles" in r.json()["detail"]
    assert _signals_for(client, auth_headers, "STALE/USD") == []


def test_timeframe_seconds_parsing():
    assert _timeframe_seconds("15m") == 900
    assert _timeframe_seconds("1h") == 3600
    assert _timeframe_seconds("4h") == 14400
    assert _timeframe_seconds("1d") == 86400
    assert _timeframe_seconds("1w") == 604800
    assert _timeframe_seconds("??") == 3600  # formato desconocido: 1h
