"""Tests de single-flight en ticker y precios (arreglo 4, 2026-11-25).

La deduplicación YA existe en app/api/market.py (corrida 2026-11-24,
entrada de prueba rápida): `_SingleFlight` + `_fetch_ticker_singleflight`
+ `_fetch_market_prices`. Estos tests la fijan con candado: sin
single-flight, N llamadas concurrentes lanzarían N fetches a Kraken
(lo que el QA de la entrada de prueba midió como ventana fría de ~5 s
para el primer invitado); con single-flight, el primer hilo es el
líder y hace el ÚNICO fetch, y los demás esperan su resultado.

Criterio de fallo: si alguien quita el single-flight, el contador de
fetches sube de 1 a N y estos tests fallan.
"""
import threading
import time

import app.api.market as market_mod


def _slow_ticker_factory(calls):
    def _fake_ticker(exchange, pair):
        calls["n"] += 1
        time.sleep(0.3)
        return {"last": 50000.0, "percentage": 1.5}

    return _fake_ticker


def _fake_ohlcv(exchange, pair, timeframe="1h", limit=24):
    return [[i * 3_600_000, 1, 2, 0.5, 49000.0 + i * 10, 100.0] for i in range(limit)]


def _run_concurrent(fn, n_threads=8):
    """Lanza n hilos a la vez contra fn y devuelve sus resultados."""
    barrier = threading.Barrier(n_threads)
    results = [None] * n_threads
    errors = [None] * n_threads

    def _work(i):
        barrier.wait(timeout=10)
        try:
            results[i] = fn()
        except Exception as e:  # noqa: BLE001 - el test inspecciona el error
            errors[i] = e

    threads = [threading.Thread(target=_work, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results, errors


def test_ticker_singleflight_one_fetch_for_concurrent_callers(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(
        market_mod.exchanges, "fetch_ticker", _slow_ticker_factory(calls)
    )
    results, errors = _run_concurrent(
        lambda: market_mod._fetch_ticker_singleflight("kraken", "BTC/USD")
    )
    assert not any(errors), errors
    assert calls["n"] == 1, f"sin single-flight el fetch se lanzó {calls['n']} veces"
    assert all(r == {"last": 50000.0, "percentage": 1.5} for r in results)


def test_prices_singleflight_one_fetch_for_concurrent_callers(monkeypatch):
    calls = {"n": 0}
    monkeypatch.setattr(
        market_mod.exchanges, "fetch_ticker", _slow_ticker_factory(calls)
    )
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    results, errors = _run_concurrent(
        lambda: market_mod._fetch_market_prices("kraken"), n_threads=4
    )
    assert not any(errors), errors
    # Un solo _fetch_market_prices_uncached = 4 tickers (uno por moneda).
    assert calls["n"] == 4, f"sin single-flight los tickers fueron {calls['n']}"
    first = [p.model_dump() for p in results[0]]
    assert all([p.model_dump() for p in r] == first for r in results)
    assert [p["symbol"] for p in first] == ["BTC", "ETH", "USDT", "BNB"]


def test_singleflight_followers_inherit_leader_error(monkeypatch):
    calls = {"n": 0}

    def _boom(exchange, pair):
        calls["n"] += 1
        time.sleep(0.2)
        raise RuntimeError("exchange down")

    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _boom)
    results, errors = _run_concurrent(
        lambda: market_mod._fetch_ticker_singleflight("kraken", "BTC/USD")
    )
    assert calls["n"] == 1
    assert all(e is not None and "exchange down" in str(e) for e in errors)
    assert all(r is None for r in results)
