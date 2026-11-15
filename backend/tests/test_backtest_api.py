"""Endpoint /api/backtest/run: validación de symbol (2026-11-13) y de
timeframe (2026-11-14).

Último endpoint con símbolo libre: /api/market lo valida desde el
2026-11-11 y /api/strategy/evaluate desde el 2026-11-12. Sin la
validación, "btc/usd" devolvía 503 (las velas se guardan como
"BTC/USD" y el filtro de la BD es exacto) y el símbolo crudo se
usaba en el run_id (nombre de archivo en data/backtests). Lo mismo
valía para el timeframe: "1H" no encontraba las velas de "1h" y el
valor crudo llegaba al run_id.
"""
import time
from unittest.mock import patch


def _seed(client, auth_headers, symbol, n=120):
    """120 velas horarias frescas terminando ahora (vía ingest)."""
    now = time.time()
    rows = [
        [
            int((now - (n - 1 - i) * 3600) * 1000),
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


def test_backtest_run_rejects_malformed_symbol(client, auth_headers):
    for bad in ("", "BTCUSD", "BTC/USD/EXTRA", "BTC/", "/USD", "B/USD"):
        r = client.post(
            f"/api/backtest/run?symbol={bad}&timeframe=1h",
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)


def test_backtest_run_symbol_is_normalized_to_uppercase(client, auth_headers):
    # Símbolo propio (BTST/USD) para no contaminar el conteo exacto
    # de velas BTC/USD que espera test_market (BD compartida).
    _seed(client, auth_headers, "BTST/USD")
    r = client.post(
        "/api/backtest/run?symbol=btst/usd&timeframe=1h",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["symbol"] == "BTST/USD"


def test_backtest_run_rejects_malformed_timeframe(client, auth_headers):
    # 2026-11-14: mismo patrón que el símbolo — 422 antes de tocar la
    # BD o el limitador. "??" caía a 1h en el guarda y el valor crudo
    # llegaba al run_id (nombre de archivo).
    for bad in ("", "??", "1", "h", "1x", "1h30m"):
        r = client.post(
            f"/api/backtest/run?symbol=BTC/USD&timeframe={bad}",
            headers=auth_headers,
        )
        assert r.status_code == 422, (bad, r.text)


def test_backtest_run_timeframe_is_normalized_to_lowercase(client, auth_headers):
    # Símbolo propio (BTTF/USD) para no contaminar el conteo exacto
    # de velas BTC/USD que espera test_market (BD compartida).
    _seed(client, auth_headers, "BTTF/USD")
    r = client.post(
        "/api/backtest/run?symbol=BTTF/USD&timeframe=1H",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["timeframe"] == "1h"
    assert r.json()["run_id"].startswith("BTTFUSD-1h-")
