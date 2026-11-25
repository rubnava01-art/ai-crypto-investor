"""Mercado público de solo lectura (corrección P0-1, 2026-11-23).

El invitado (y el rol prueba) no tiene el módulo "invertir", así que
`/api/market/*` le responde 403 — y con él el conversor BTC/USD, la
gráfica BTC y los indicadores de Clases, que solo se alimentan de
`/api/market/*`. Este router expone los MISMOS datos públicos de
mercado (ticker, velas, precios, indicadores) sin abrir Invertir:
solo lectura, sin PII, sin datos de usuarios, sin órdenes, señales,
backtest ni ingesta.

- Autenticación: cualquier principal autenticado (`get_current_principal`:
  usuario normal o invitado). Sin token -> 401. No hay `require_modulo`:
  son datos públicos de mercado, no datos de negocio.
- Límite: 30/min por IP (`public_market_limiter`, con `Retry-After`).
- Datos: reutiliza el servicio y la caché de `app.api.market`
  (mismos modelos de respuesta, misma forma, mismo TTL/stale).
"""
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api import market as market_api
from app.core.rate_limit import public_market_limiter, too_many_requests
from app.core.security import Principal, get_current_principal
from app.data import ingest
from app.database import get_db
from app.indicators import technical as ind
from app.models.tables import MarketCandle

router = APIRouter(prefix="/api/public/market", tags=["public-market"])

# Caché de indicadores (corrida 2026-11-24, entrada de prueba rápida):
# /indicators leía 200 velas de la BD y recalculaba el resumen en
# CADA llamada (~7 ms), aunque las velas no hubieran cambiado. La
# caché guarda el resumen ya calculado y se consulta ANTES de cargar
# las 200 velas: la clave es un fingerprint ligero (nº de velas +
# open_time/cierre/volumen de la vela más reciente, dos consultas
# indexadas de una fila). El ingest solo reescribe la vela en curso,
# así que cualquier cambio en los datos cambia la clave; el TTL de
# 60 s es solo un tope. No se inventa nada: un MISS calcula
# exactamente lo mismo que antes. El `updated_utc` de la respuesta
# se regenera en cada llamada (fresco); solo se reutiliza el resumen
# de indicadores. Tope 128 entradas con desalojo FIFO, como la caché
# de ticker.
_INDICATORS_CACHE: dict[tuple, dict] = {}
_INDICATORS_TTL_S = 60.0
_INDICATORS_CACHE_MAX_ENTRIES = 128


def _indicators_cache_put(key: tuple, entry: dict) -> None:
    if key in _INDICATORS_CACHE:
        _INDICATORS_CACHE[key] = entry
        return
    while len(_INDICATORS_CACHE) >= _INDICATORS_CACHE_MAX_ENTRIES:
        _INDICATORS_CACHE.pop(next(iter(_INDICATORS_CACHE)))
    _INDICATORS_CACHE[key] = entry


def _public_market_guard(
    request: Request,
    principal: Principal = Depends(get_current_principal),
) -> Principal:
    """401 sin token (vía get_current_principal); 429 pasado 30/min/IP."""
    client_ip = request.client.host if request.client else "unknown"
    if not public_market_limiter.allow(f"public_market:{client_ip}"):
        raise too_many_requests(
            "Demasiadas consultas de mercado público. Espera un minuto.",
            public_market_limiter.window,
        )
    return principal


@router.get("/ticker", response_model=market_api.TickerResponse)
def get_public_ticker(
    symbol: str = Query("BTC/USD"),
    exchange: str = Query(market_api.DEFAULT_EXCHANGE),
    principal: Principal = Depends(_public_market_guard),
):
    """Misma forma que GET /api/market/ticker (caché 60 s, stale si falla)."""
    market_api._validate_exchange(exchange)
    symbol = market_api._validate_symbol(symbol)
    key = (exchange, symbol)
    now = time.monotonic()
    cached = market_api._TICKER_CACHE.get(key)
    if cached is not None and now - cached["at"] < market_api._TICKER_TTL_S:
        return market_api.TickerResponse(**{**cached["payload"], "stale": False})
    try:
        t = market_api._fetch_ticker_singleflight(exchange, symbol)
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        if cached is not None:
            return market_api.TickerResponse(**{**cached["payload"], "stale": True})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Exchange unreachable ({exchange}): {type(e).__name__}",
        )
    last = t.get("last")
    payload = {
        "symbol": symbol,
        "last": str(last) if last is not None else None,
        "source": exchange,
        "updated_utc": market_api._utcnow(),
        "stale": False,
    }
    market_api._ticker_cache_put(key, {"at": now, "payload": payload})
    return market_api.TickerResponse(**payload)


@router.get("/candles", response_model=market_api.CandlesResponse)
def get_public_candles(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    limit: int = Query(100, ge=1, le=500),
    exchange: str = Query(market_api.DEFAULT_EXCHANGE),
    principal: Principal = Depends(_public_market_guard),
    db: Session = Depends(get_db),
):
    """Misma forma que GET /api/market/candles (velas guardadas por el escáner)."""
    market_api._validate_exchange(exchange)
    symbol = market_api._validate_symbol(symbol)
    timeframe = market_api._validate_timeframe(timeframe)
    candles = ingest.latest_candles(db, symbol, timeframe, limit)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No candle data for {symbol} {timeframe}. Run the scanner or ingest first.",
        )
    stale, newest_candle_utc = market_api._candles_freshness(candles, timeframe)
    return market_api.CandlesResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=market_api._utcnow(),
        stale=stale,
        newest_candle_utc=newest_candle_utc,
        candles=[
            market_api.CandleOut(
                open_time_utc=c.open_time_utc.isoformat(),
                open=str(c.open),
                high=str(c.high),
                low=str(c.low),
                close=str(c.close),
                volume=str(c.volume),
            )
            for c in candles
        ],
    )


@router.get("/indicators", response_model=market_api.IndicatorsResponse)
def get_public_indicators(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    exchange: str = Query(market_api.DEFAULT_EXCHANGE),
    principal: Principal = Depends(_public_market_guard),
    db: Session = Depends(get_db),
):
    """Misma forma que GET /api/market/indicators (mínimo 35 velas)."""
    market_api._validate_exchange(exchange)
    symbol = market_api._validate_symbol(symbol)
    timeframe = market_api._validate_timeframe(timeframe)
    now = time.monotonic()
    # Fingerprint ligero ANTES de cargar las 200 velas: nº de velas +
    # vela más reciente (el ingest solo reescribe la vela en curso).
    # Un HIT evita la carga de 200 filas y el recálculo del resumen.
    newest = (
        db.query(MarketCandle)
        .filter(
            MarketCandle.symbol == symbol, MarketCandle.timeframe == timeframe
        )
        .order_by(MarketCandle.open_time_utc.desc())
        .first()
    )
    if newest is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles for indicators (0/35). Ingest more data.",
        )
    n_candles = (
        db.query(MarketCandle)
        .filter(
            MarketCandle.symbol == symbol, MarketCandle.timeframe == timeframe
        )
        .count()
    )
    if n_candles < 35:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles for indicators ({n_candles}/35). Ingest more data.",
        )
    cache_key = (
        exchange,
        symbol,
        timeframe,
        n_candles,
        newest.open_time_utc,
        str(newest.close),
        str(newest.volume),
    )
    cached = _INDICATORS_CACHE.get(cache_key)
    if cached is not None and now - cached["at"] < _INDICATORS_TTL_S:
        return market_api.IndicatorsResponse(
            symbol=symbol,
            timeframe=timeframe,
            source=cached["source"],
            updated_utc=market_api._utcnow(),
            stale=cached["stale"],
            newest_candle_utc=cached["newest_candle_utc"],
            indicators=cached["indicators"],
        )
    candles = ingest.latest_candles(db, symbol, timeframe, 200)
    if len(candles) < 35:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles for indicators ({len(candles)}/35). Ingest more data.",
        )
    closes = [float(c.close) for c in candles]
    volumes = [float(c.volume) for c in candles]
    stale, newest_candle_utc = market_api._candles_freshness(candles, timeframe)
    indicators = ind.summarize(closes, volumes)
    _indicators_cache_put(
        cache_key,
        {
            "at": now,
            "source": candles[-1].source,
            "stale": stale,
            "newest_candle_utc": newest_candle_utc,
            "indicators": indicators,
        },
    )
    return market_api.IndicatorsResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=market_api._utcnow(),
        stale=stale,
        newest_candle_utc=newest_candle_utc,
        indicators=indicators,
    )


@router.get("/prices", response_model=market_api.MarketPricesResponse)
def get_public_prices(
    exchange: str = Query(market_api.DEFAULT_EXCHANGE),
    principal: Principal = Depends(_public_market_guard),
):
    """Misma forma que GET /api/market/prices (caché 300 s compartida
    con /api/market, stale-while-revalidate; 503 solo sin nada que servir)."""
    market_api._validate_exchange(exchange)
    now = time.monotonic()
    cached = market_api._PRICES_CACHE["payload"]
    same_exchange = cached is not None and cached.get("source") == exchange
    if same_exchange:
        age = now - market_api._PRICES_CACHE["at"]
        if age < market_api._PRICES_TTL_S:
            return market_api.MarketPricesResponse(**{**cached, "stale": False})
        if age < market_api._PRICES_MAX_STALE_S:
            market_api._trigger_background_refresh(exchange)
            return market_api.MarketPricesResponse(**{**cached, "stale": True})
    try:
        prices = market_api._fetch_market_prices(exchange)
        if prices and all(p.price_usd is None for p in prices):
            raise RuntimeError("all coin tickers failed")
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        if same_exchange:
            payload = market_api._PRICES_CACHE["payload"]
            return market_api.MarketPricesResponse(**{**payload, "stale": True})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Exchange unreachable ({exchange}): {type(e).__name__}",
        )
    payload = {
        "source": exchange,
        "updated_utc": market_api._utcnow(),
        "stale": False,
        "prices": [p.model_dump() for p in prices],
    }
    market_api._PRICES_CACHE["at"] = now
    market_api._PRICES_CACHE["payload"] = payload
    return market_api.MarketPricesResponse(**payload)
