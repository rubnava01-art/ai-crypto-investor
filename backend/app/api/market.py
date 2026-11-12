"""Market data endpoints (Phase 2): real candles, ticker, indicators.

Every response carries the data source and update timestamp. With no
connection, endpoints return 503 with a clear message (never fake data).
"""
import datetime as dt
import time
from concurrent.futures import ThreadPoolExecutor, wait

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.rate_limit import market_limiter
from app.core.security import get_current_user, require_admin
from app.core.symbols import validate_symbol as _validate_symbol
from app.data import exchanges, ingest
from app.database import get_db
from app.indicators import technical as ind
# 2026-11-08: la regla de antigüedad de velas vive en strategy (guarda
# 2026-11-06): /candles e /indicators la reutilizan para marcar sus
# datos como stale en vez de presentarlos como actuales.
from app.api.strategy import _STALE_CANDLES, _as_utc, _timeframe_seconds
from app.models.tables import User

router = APIRouter(prefix="/api/market", tags=["market"])

DEFAULT_EXCHANGE = "kraken"  # spec: Coinbase or Kraken; Kraken default, both supported

# Top coins shown on the dashboard market panel (real public prices, no keys).
MARKET_COINS = (
    ("BTC", "Bitcoin", "BTC/USD"),
    ("ETH", "Ethereum", "ETH/USD"),
    ("USDT", "Tether", "USDT/USD"),
    ("BNB", "BNB", "BNB/USD"),
)
_PRICES_CACHE: dict = {"at": 0.0, "payload": None}
_PRICES_TTL_S = 60.0
# Caché de ticker por (exchange, símbolo), mismo patrón stale que /prices
# (corrida 3 agentes): antes cada llamada pegaba al exchange sin caché.
_TICKER_CACHE: dict[tuple, dict] = {}
_TICKER_TTL_S = 60.0
# 2026-11-09: la caché es por (exchange, símbolo) y el símbolo lo escribe
# el usuario en el query param, sin validar: cada símbolo distinto era una
# entrada nueva que nunca se eliminaba (solo se sobrescribía al repetirse
# con éxito). Un bucle de símbolos inventados crecía la memoria del
# proceso sin límite. Tope generoso (128 pares) con desalojo FIFO: el
# dict conserva el orden de inserción, así que la entrada más vieja sale
# primero. El uso normal (BTC/ETH y poco más) nunca llega al tope.
_TICKER_CACHE_MAX_ENTRIES = 128


def _ticker_cache_put(key: tuple, entry: dict) -> None:
    """Guarda una entrada de ticker con tope: si la caché está llena,
    desaloja la más antigua (FIFO) antes de insertar."""
    if key in _TICKER_CACHE:
        _TICKER_CACHE[key] = entry
        return
    while len(_TICKER_CACHE) >= _TICKER_CACHE_MAX_ENTRIES:
        _TICKER_CACHE.pop(next(iter(_TICKER_CACHE)))
    _TICKER_CACHE[key] = entry

# Executor COMPARTIDO (Fase 3, B5-style): un pool por proceso para el
# fetch paralelo de /prices, no uno por request (el patrón viejo de
# tendencias creaba y abandonaba un pool por llamada).
_PRICES_EXECUTOR = ThreadPoolExecutor(max_workers=8)
_PRICES_OVERALL_TIMEOUT_S = 60.0


def _validate_exchange(exchange: str) -> None:
    """422 antes de tocar la red: un exchange no soportado antes caía
    en 503 tras intentar (y esperar) la conexión, y en /prices tras
    4 tickers + 4 OHLCV fallidos. No consume el limitador."""
    if exchange not in exchanges.SUPPORTED:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Exchange no soportado: {exchange}. Usa: {', '.join(exchanges.SUPPORTED)}.",
        )


def _check_market_limit(user: User) -> None:
    """Per-USER limiter (M3): the market endpoints hit a public exchange
    and used to be unlimited for any authenticated user."""
    if not market_limiter.allow(f"market:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas consultas de mercado. Espera un minuto.",
        )


class CandleOut(BaseModel):
    open_time_utc: str
    open: str
    high: str
    low: str
    close: str
    volume: str


class CandlesResponse(BaseModel):
    symbol: str
    timeframe: str
    source: str
    updated_utc: str
    # 2026-11-08: antes updated_utc era "ahora" aunque la vela más
    # reciente tuviera horas o días: el mismo dato muerto que el guarda
    # de estrategia (2026-11-06) rechaza para evaluar. Ahora la
    # respuesta dice si las velas están desactualizadas y de cuándo es
    # la más reciente, con la misma regla de 2 timeframes.
    stale: bool = False
    newest_candle_utc: str
    candles: list[CandleOut]


class TickerResponse(BaseModel):
    symbol: str
    last: str | None
    source: str
    updated_utc: str
    stale: bool = False


class IndicatorsResponse(BaseModel):
    symbol: str
    timeframe: str
    source: str
    updated_utc: str
    # 2026-11-08: igual que /candles — los indicadores se calculan
    # sobre las velas guardadas, y si esas velas son viejas el resumen
    # también lo es. Misma regla de 2 timeframes.
    stale: bool = False
    newest_candle_utc: str
    indicators: dict


class CoinPriceOut(BaseModel):
    symbol: str  # BTC
    name: str  # Bitcoin
    pair: str  # BTC/USD
    price_usd: float | None
    change_24h_pct: float | None
    sparkline_24h: list[float]  # 1h closes, oldest -> newest


class MarketPricesResponse(BaseModel):
    source: str
    updated_utc: str
    stale: bool = False
    prices: list[CoinPriceOut]


def _utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _candles_freshness(candles, timeframe: str) -> tuple[bool, str]:
    """(stale, newest_candle_utc) de una lista ascendente de velas.

    Misma regla que el guarda de /strategy/evaluate (2026-11-06): la
    vela cerrada más reciente más vieja que 2 timeframes es dato muerto.
    """
    newest = _as_utc(candles[-1].open_time_utc)
    max_age_s = _STALE_CANDLES * _timeframe_seconds(timeframe)
    age_s = (dt.datetime.now(dt.timezone.utc) - newest).total_seconds()
    return age_s > max_age_s, newest.isoformat()


@router.get("/candles", response_model=CandlesResponse)
def get_candles(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    limit: int = Query(100, ge=1, le=500),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_exchange(exchange)
    symbol = _validate_symbol(symbol)
    _check_market_limit(user)
    candles = ingest.latest_candles(db, symbol, timeframe, limit)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No candle data for {symbol} {timeframe}. Run the scanner or ingest first.",
        )
    stale, newest_candle_utc = _candles_freshness(candles, timeframe)
    return CandlesResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=_utcnow(),
        stale=stale,
        newest_candle_utc=newest_candle_utc,
        candles=[
            CandleOut(
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


@router.get("/ticker", response_model=TickerResponse)
def get_ticker(
    symbol: str = Query("BTC/USD"),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
):
    """Ticker con caché de 60 s (stale si el exchange falla), como /prices."""
    _validate_exchange(exchange)
    symbol = _validate_symbol(symbol)
    _check_market_limit(user)
    key = (exchange, symbol)
    now = time.monotonic()
    cached = _TICKER_CACHE.get(key)
    if cached is not None and now - cached["at"] < _TICKER_TTL_S:
        return TickerResponse(**{**cached["payload"], "stale": False})
    try:
        t = exchanges.fetch_ticker(exchange, symbol)
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        if cached is not None:
            return TickerResponse(**{**cached["payload"], "stale": True})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Exchange unreachable ({exchange}): {type(e).__name__}",
        )
    last = t.get("last")
    payload = {
        "symbol": symbol,
        "last": str(last) if last is not None else None,
        "source": exchange,
        "updated_utc": _utcnow(),
        "stale": False,
    }
    _ticker_cache_put(key, {"at": now, "payload": payload})
    return TickerResponse(**payload)


@router.get("/indicators", response_model=IndicatorsResponse)
def get_indicators(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_exchange(exchange)
    symbol = _validate_symbol(symbol)
    _check_market_limit(user)
    candles = ingest.latest_candles(db, symbol, timeframe, 200)
    if len(candles) < 35:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles for indicators ({len(candles)}/35). Ingest more data.",
        )
    closes = [float(c.close) for c in candles]
    volumes = [float(c.volume) for c in candles]
    stale, newest_candle_utc = _candles_freshness(candles, timeframe)
    return IndicatorsResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=_utcnow(),
        stale=stale,
        newest_candle_utc=newest_candle_utc,
        indicators=ind.summarize(closes, volumes),
    )


@router.post("/ingest")
def trigger_ingest(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Manually trigger one ingestion cycle (also runs on the scanner loop)."""
    _validate_exchange(exchange)
    symbol = _validate_symbol(symbol)
    _check_market_limit(user)
    try:
        n = ingest.ingest_ohlcv(db, exchange, symbol, timeframe)
    except Exception as e:  # noqa: BLE001
        # Generic error (M9): exchange internals never reach the client.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ingestion failed ({exchange}): {type(e).__name__}",
        )
    return {"ingested": n, "symbol": symbol, "timeframe": timeframe, "source": exchange}


def _fetch_one_coin(exchange: str, symbol: str, name: str, pair: str) -> CoinPriceOut:
    """One coin's ticker + sparkline. Per-coin resilience: a failure
    reports this coin with price None instead of failing the endpoint."""
    try:
        t = exchanges.fetch_ticker(exchange, pair)
    except Exception:  # noqa: BLE001 - one bad coin, not a failed endpoint
        return CoinPriceOut(
            symbol=symbol, name=name, pair=pair,
            price_usd=None, change_24h_pct=None, sparkline_24h=[],
        )
    last = t.get("last")
    pct = t.get("percentage")
    spark: list[float] = []
    try:
        ohlcv = exchanges.fetch_ohlcv(exchange, pair, "1h", limit=24)
        spark = [float(row[4]) for row in ohlcv if row[4] is not None]
    except Exception:  # noqa: BLE001 - sparkline is best-effort
        spark = []
    return CoinPriceOut(
        symbol=symbol,
        name=name,
        pair=pair,
        price_usd=float(last) if last is not None else None,
        change_24h_pct=float(pct) if pct is not None else None,
        sparkline_24h=spark,
    )


def _fetch_market_prices(exchange: str) -> list[CoinPriceOut]:
    """Real public prices for the top coins (no API keys needed).

    PARALLEL (Fase 3, M16): the old code fetched 4 tickers + 4 OHLCV
    sequentially — up to minutes of blocking when the exchange is slow.
    Coins now fetch concurrently on the shared pool with an overall
    budget; a coin that times out reports price None like any other
    per-coin failure, and the endpoint still serves the rest.
    """
    futures = {
        _PRICES_EXECUTOR.submit(_fetch_one_coin, exchange, symbol, name, pair): (
            symbol,
            name,
            pair,
        )
        for symbol, name, pair in MARKET_COINS
    }
    done, _pending = wait(futures.keys(), timeout=_PRICES_OVERALL_TIMEOUT_S)
    by_pair = {}
    for future in done:
        try:
            coin = future.result()
        except Exception:  # noqa: BLE001 - per-coin failure, not endpoint failure
            continue
        by_pair[coin.pair] = coin
    out: list[CoinPriceOut] = []
    for symbol, name, pair in MARKET_COINS:
        out.append(
            by_pair.get(
                pair,
                CoinPriceOut(
                    symbol=symbol, name=name, pair=pair,
                    price_usd=None, change_24h_pct=None, sparkline_24h=[],
                ),
            )
        )
    return out


@router.get("/prices", response_model=MarketPricesResponse)
def get_market_prices(
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
):
    """Live prices for the top coins from the exchange's public API.

    Cached 60s per exchange. Serves stale cache (flagged) when the
    exchange is unreachable; 503 only when there is nothing to show
    (never fake data). The cache is only valid for the exchange that
    filled it: a request for another exchange must refetch instead of
    receiving the first exchange's prices under the wrong source.
    """
    _validate_exchange(exchange)
    _check_market_limit(user)
    now = time.monotonic()
    if (
        _PRICES_CACHE["payload"] is not None
        and _PRICES_CACHE["payload"].get("source") == exchange
        and now - _PRICES_CACHE["at"] < _PRICES_TTL_S
    ):
        payload = _PRICES_CACHE["payload"]
        return MarketPricesResponse(**{**payload, "stale": False})
    try:
        prices = _fetch_market_prices(exchange)
        if prices and all(p.price_usd is None for p in prices):
            # Total failure is still an outage, not a live empty list:
            # fall through to the stale-cache / 503 path below.
            raise RuntimeError("all coin tickers failed")
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        if _PRICES_CACHE["payload"] is not None and _PRICES_CACHE["payload"].get("source") == exchange:
            payload = _PRICES_CACHE["payload"]
            return MarketPricesResponse(**{**payload, "stale": True})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Exchange unreachable ({exchange}): {type(e).__name__}",
        )
    payload = {
        "source": exchange,
        "updated_utc": _utcnow(),
        "stale": False,
        "prices": [p.model_dump() for p in prices],
    }
    _PRICES_CACHE["at"] = now
    _PRICES_CACHE["payload"] = payload
    return MarketPricesResponse(**payload)
