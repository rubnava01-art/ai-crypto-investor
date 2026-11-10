"""Límite de la caché de ticker (2026-11-09).

La caché es por (exchange, símbolo) y el símbolo lo escribe el usuario:
sin tope, cada símbolo distinto era una entrada que nunca se eliminaba.
El tope (128) se prueba con 3 para no gastar el limitador de mercado
(60/min por usuario): 4 símbolos distintos bastan para probar el
desalojo FIFO.
"""
import app.api.market as market_mod


def test_ticker_cache_evicts_oldest(monkeypatch, client, viewer_headers):
    calls = {"n": 0}

    def fake_fetch(exchange, symbol):
        calls["n"] += 1
        return {"last": 100.0}

    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", fake_fetch)
    monkeypatch.setattr(market_mod, "_TICKER_CACHE_MAX_ENTRIES", 3)
    try:
        for symbol in ("AAA/USD", "BBB/USD", "CCC/USD", "DDD/USD"):
            r = client.get(f"/api/market/ticker?symbol={symbol}", headers=viewer_headers)
            assert r.status_code == 200, r.text
            assert r.json()["last"] == "100.0"
        assert calls["n"] == 4
        assert len(market_mod._TICKER_CACHE) == 3
        assert ("kraken", "AAA/USD") not in market_mod._TICKER_CACHE
        assert ("kraken", "DDD/USD") in market_mod._TICKER_CACHE

        # El símbolo desalojado vuelve a pegar al exchange...
        r = client.get("/api/market/ticker?symbol=AAA/USD", headers=viewer_headers)
        assert r.status_code == 200
        assert calls["n"] == 5
        # ...mientras el que sigue en caché no pega de nuevo.
        r = client.get("/api/market/ticker?symbol=CCC/USD", headers=viewer_headers)
        assert r.status_code == 200
        assert calls["n"] == 5
    finally:
        market_mod._TICKER_CACHE.clear()


def test_ticker_cache_put_updates_without_growing(monkeypatch):
    monkeypatch.setattr(market_mod, "_TICKER_CACHE_MAX_ENTRIES", 2)
    try:
        market_mod._ticker_cache_put(("kraken", "AAA/USD"), {"at": 1.0, "payload": {}})
        market_mod._ticker_cache_put(("kraken", "BBB/USD"), {"at": 2.0, "payload": {}})
        # Reescribir una clave existente no crece la caché ni desaloja.
        market_mod._ticker_cache_put(("kraken", "AAA/USD"), {"at": 3.0, "payload": {}})
        assert len(market_mod._TICKER_CACHE) == 2
        assert ("kraken", "BBB/USD") in market_mod._TICKER_CACHE
        assert market_mod._TICKER_CACHE[("kraken", "AAA/USD")]["at"] == 3.0
    finally:
        market_mod._TICKER_CACHE.clear()
