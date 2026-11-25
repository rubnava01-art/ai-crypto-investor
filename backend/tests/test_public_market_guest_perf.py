"""Entrada de prueba rápida (2026-11-24, Backend/Seguridad): caché de
indicadores públicos, precalentamiento de mercado público en arranque
y hash ficticio de login perezoso.

Candados que estos tests verifican que NO se tocaron: el token de
invitado sigue siendo 15 min sin fila User (ver
test_agentes_2026_11_23_mejoras_optimas), el rate limit de
/api/public/market/* sigue en 30/min/IP y el reto matemático sigue
siendo obligatorio para POST /api/auth/guest.
"""
import datetime as dt
import threading
import time
from decimal import Decimal

import pytest

from app.api import market as market_api
from app.api import public_market as public_market_api
from app.core.rate_limit import public_market_limiter
from app.core.security import Guest, create_guest_token
from app.data import exchanges
from app.database import get_db
from app.indicators import technical as ind
from app.main import _warm_prices_sync, _warm_ticker_sync
from app.models.tables import MarketCandle


@pytest.fixture(autouse=True)
def _limpiar_limiter():
    public_market_limiter.clear()
    yield
    public_market_limiter.clear()


def _guest_headers() -> dict:
    token, _gid = create_guest_token()
    return {"Authorization": f"Bearer {token}"}


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _seed_velas(app, n: int = 60):
    db, gen = _db(app)
    try:
        base = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)
        ids = []
        for i in range(n):
            abierta = base - dt.timedelta(hours=n - 1 - i)
            precio = Decimal("90000") + Decimal(i * 10)
            vela = MarketCandle(
                symbol="BTC/USD", timeframe="1h", open_time_utc=abierta,
                open=precio, high=precio + Decimal("50"),
                low=precio - Decimal("50"), close=precio + Decimal("5"),
                volume=Decimal("12.5"), source="kraken",
            )
            db.add(vela)
            db.flush()
            ids.append(vela.id)
        db.commit()
        return ids
    finally:
        _close(gen)


def _borrar_velas(app, ids):
    db, gen = _db(app)
    try:
        db.query(MarketCandle).filter(MarketCandle.id.in_(ids)).delete(
            synchronize_session=False)
        db.commit()
    finally:
        _close(gen)


def test_indicators_cache_reutiliza_resumen_y_se_invalida_al_cambiar_vela(
    client, app, monkeypatch
):
    """Segunda llamada con las mismas velas: mismo resumen sin
    recalcular (summarize 1 vez). Si cambia una vela, recalcula."""
    h = _guest_headers()
    ids = _seed_velas(app)
    llamadas = {"n": 0}
    real_summarize = ind.summarize

    def _contar(closes, volumes=None):
        llamadas["n"] += 1
        return real_summarize(closes, volumes)

    monkeypatch.setattr(ind, "summarize", _contar)
    public_market_api._INDICATORS_CACHE.clear()
    try:
        r1 = client.get("/api/public/market/indicators?symbol=BTC/USD&timeframe=1h", headers=h)
        assert r1.status_code == 200, r1.text
        r2 = client.get("/api/public/market/indicators?symbol=BTC/USD&timeframe=1h", headers=h)
        assert r2.status_code == 200, r2.text
        assert r2.json()["indicators"] == r1.json()["indicators"]
        assert llamadas["n"] == 1, "la 2ª llamada debió servirse de caché"
        # Cambia el cierre de la vela más reciente: el fingerprint
        # cambia y el resumen se recalcula (no dato viejo).
        db, gen = _db(app)
        try:
            vela = db.query(MarketCandle).filter(MarketCandle.id == ids[-1]).first()
            vela.close = Decimal("99999")
            db.commit()
        finally:
            _close(gen)
        r3 = client.get("/api/public/market/indicators?symbol=BTC/USD&timeframe=1h", headers=h)
        assert r3.status_code == 200, r3.text
        assert llamadas["n"] == 2, "vela cambiada debió invalidar la caché"
        assert r3.json()["indicators"]["last_close"] == 99999.0
    finally:
        public_market_api._INDICATORS_CACHE.clear()
        _borrar_velas(app, ids)


def test_warmup_llena_caches_de_ticker_y_precios(monkeypatch):
    """El precalentamiento de arranque llena las cachés con datos
    reales del exchange (aquí mockeado); un fallo del exchange las
    deja vacías, nunca con datos inventados."""
    monkeypatch.setattr(
        exchanges, "fetch_ticker", lambda exchange, symbol: {"last": 60576.5})
    monkeypatch.setattr(
        exchanges, "fetch_ohlcv",
        lambda exchange, pair, timeframe, limit=24: [
            [i, 60000.0, 60100.0, 59900.0, 60000.0 + i, 1.0] for i in range(24)])
    market_api._TICKER_CACHE.clear()
    market_api._PRICES_CACHE["at"] = 0.0
    market_api._PRICES_CACHE["payload"] = None
    try:
        _warm_ticker_sync()
        _warm_prices_sync()
        cached = market_api._TICKER_CACHE.get(("kraken", "BTC/USD"))
        assert cached is not None, "warm-up debió cachear el ticker BTC/USD"
        assert cached["payload"]["last"] == "60576.5"
        payload = market_api._PRICES_CACHE["payload"]
        assert payload is not None, "warm-up debió cachear los precios"
        assert [p["symbol"] for p in payload["prices"]] == ["BTC", "ETH", "USDT", "BNB"]
        assert payload["prices"][0]["price_usd"] == 60576.5
    finally:
        market_api._TICKER_CACHE.clear()
        market_api._PRICES_CACHE["at"] = 0.0
        market_api._PRICES_CACHE["payload"] = None


def test_dummy_hash_perezoso_mismo_valor_tras_primer_login_fallido(client):
    """El hash ficticio (B8) se genera bajo demanda y se reutiliza:
    dos logins de usuario inexistente dan 401 y el valor es estable."""
    from app.api import auth as auth_api

    r1 = client.post("/api/auth/login", json={"username": "nadie-existe-1", "password": "x"})
    assert r1.status_code == 401
    h1 = auth_api._dummy_password_hash()
    r2 = client.post("/api/auth/login", json={"username": "nadie-existe-2", "password": "y"})
    assert r2.status_code == 401
    assert auth_api._dummy_password_hash() == h1
    assert h1.startswith("$2b$")


def test_singleflight_ticker_un_solo_fetch_para_llamadas_concurrentes(monkeypatch):
    """8 hilos pidiendo el mismo ticker a la vez: 1 solo fetch a Kraken,
    todos comparten el resultado, y el tiempo total es ~1 fetch."""
    llamadas = {"n": 0}

    def _lento(exchange, symbol):
        llamadas["n"] += 1
        time.sleep(0.5)
        return {"last": 61000.0}

    monkeypatch.setattr(exchanges, "fetch_ticker", _lento)
    resultados, errores = [], []

    def _pedir():
        try:
            resultados.append(
                market_api._fetch_ticker_singleflight("kraken", "BTC/USD"))
        except Exception as e:  # noqa: BLE001 - se registra y se aserta luego
            errores.append(e)

    t0 = time.monotonic()
    hilos = [threading.Thread(target=_pedir) for _ in range(8)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(timeout=10)
    dt = time.monotonic() - t0
    assert not errores, errores
    assert len(resultados) == 8
    assert all(r == {"last": 61000.0} for r in resultados)
    assert llamadas["n"] == 1, f"debió haber 1 fetch, hubo {llamadas['n']}"
    assert dt < 2.0, f"8 fetches en serie habrían tardado ~4 s; tardó {dt:.2f} s"


def test_singleflight_ticker_el_error_lo_heredan_los_seguidores_y_se_reintenta(monkeypatch):
    """Si el líder falla, los seguidores reciben el mismo error (el
    endpoint lo convierte en stale/503) y la siguiente llamada reintenta."""
    llamadas = {"n": 0}

    def _falla(exchange, symbol):
        llamadas["n"] += 1
        time.sleep(0.3)  # el fallo tarda: los seguidores deben unirse en vuelo
        raise RuntimeError("kraken caído")

    monkeypatch.setattr(exchanges, "fetch_ticker", _falla)
    errores = []

    def _pedir():
        try:
            market_api._fetch_ticker_singleflight("kraken", "BTC/USD")
        except Exception as e:  # noqa: BLE001
            errores.append(type(e).__name__)

    hilos = [threading.Thread(target=_pedir) for _ in range(4)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(timeout=10)
    assert errores == ["RuntimeError"] * 4
    assert llamadas["n"] == 1, "el fallo también se comparte, no se reintenta en vuelo"
    with pytest.raises(RuntimeError):
        market_api._fetch_ticker_singleflight("kraken", "BTC/USD")
    assert llamadas["n"] == 2, "tras el fallo, el slot se libera y se reintenta"


def test_singleflight_prices_un_solo_fetch_para_llamadas_concurrentes(monkeypatch):
    """4 hilos pidiendo los precios a la vez: 1 solo fetch de 4 monedas."""
    llamadas = {"n": 0}

    def _lento(exchange):
        llamadas["n"] += 1
        time.sleep(0.5)
        return [market_api.CoinPriceOut(
            symbol=s, name=n, pair=p, price_usd=60000.0,
            change_24h_pct=None, sparkline_24h=[],
        ) for s, n, p in market_api.MARKET_COINS]

    monkeypatch.setattr(market_api, "_fetch_market_prices_uncached", _lento)
    resultados = []

    def _pedir():
        resultados.append(market_api._fetch_market_prices("kraken"))

    hilos = [threading.Thread(target=_pedir) for _ in range(4)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(timeout=10)
    assert len(resultados) == 4
    assert all(len(r) == 4 for r in resultados)
    assert llamadas["n"] == 1, f"debió haber 1 fetch, hubo {llamadas['n']}"


def test_singleflight_invitado_se_une_al_fetch_del_warmup(monkeypatch):
    """El caso QA: el warm-up trae el ticker en un hilo y el invitado
    pide el mismo ticker en otro — el invitado espera al fetch en vuelo
    (1 solo fetch total) en vez de lanzar el suyo."""
    llamadas = {"n": 0}

    def _lento(exchange, symbol):
        llamadas["n"] += 1
        time.sleep(1.0)
        return {"last": 62000.0}

    monkeypatch.setattr(exchanges, "fetch_ticker", _lento)
    market_api._TICKER_CACHE.clear()
    try:
        hilo = threading.Thread(target=_warm_ticker_sync)
        hilo.start()
        time.sleep(0.2)  # el warm-up ya está en vuelo
        t0 = time.monotonic()
        r = public_market_api.get_public_ticker(
            symbol="BTC/USD", exchange="kraken", principal=Guest(guest_id="t"))
        dt = time.monotonic() - t0
        hilo.join(timeout=10)
        assert r.last == "62000.0"
        assert llamadas["n"] == 1, f"debió haber 1 fetch, hubo {llamadas['n']}"
        assert 0.5 < dt < 2.0, f"el invitado esperó al fetch en vuelo ({dt:.2f} s)"
    finally:
        market_api._TICKER_CACHE.clear()
