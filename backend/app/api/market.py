"""Market data endpoints (Phase 2): real candles, ticker, indicators.

Every response carries the data source and update timestamp. With no
connection, endpoints return 503 with a clear message (never fake data).
"""
import datetime as dt
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.data import exchanges, ingest
from app.database import get_db
from app.indicators import technical as ind
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
    candles: list[CandleOut]


class TickerResponse(BaseModel):
    symbol: str
    last: str | None
    source: str
    updated_utc: str


class IndicatorsResponse(BaseModel):
    symbol: str
    timeframe: str
    source: str
    updated_utc: str
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


@router.get("/candles", response_model=CandlesResponse)
def get_candles(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    limit: int = Query(100, le=500),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    candles = ingest.latest_candles(db, symbol, timeframe, limit)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No candle data for {symbol} {timeframe}. Run the scanner or ingest first.",
        )
    return CandlesResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=_utcnow(),
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
    try:
        t = exchanges.fetch_ticker(exchange, symbol)
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Exchange unreachable ({exchange}): {type(e).__name__}",
        )
    last = t.get("last")
    return TickerResponse(
        symbol=symbol,
        last=str(last) if last is not None else None,
        source=exchange,
        updated_utc=_utcnow(),
    )


@router.get("/indicators", response_model=IndicatorsResponse)
def get_indicators(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    candles = ingest.latest_candles(db, symbol, timeframe, 200)
    if len(candles) < 35:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles for indicators ({len(candles)}/35). Ingest more data.",
        )
    closes = [float(c.close) for c in candles]
    volumes = [float(c.volume) for c in candles]
    return IndicatorsResponse(
        symbol=symbol,
        timeframe=timeframe,
        source=candles[-1].source,
        updated_utc=_utcnow(),
        indicators=ind.summarize(closes, volumes),
    )


@router.post("/ingest")
def trigger_ingest(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually trigger one ingestion cycle (also runs on the scanner loop)."""
    try:
        n = ingest.ingest_ohlcv(db, exchange, symbol, timeframe)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Ingestion failed ({exchange}): {type(e).__name__}: {str(e)[:120]}",
        )
    return {"ingested": n, "symbol": symbol, "timeframe": timeframe, "source": exchange}


def _fetch_market_prices(exchange: str) -> list[CoinPriceOut]:
    """Real public prices for the top coins (no API keys needed)."""
    out: list[CoinPriceOut] = []
    for symbol, name, pair in MARKET_COINS:
        t = exchanges.fetch_ticker(exchange, pair)
        last = t.get("last")
        pct = t.get("percentage")
        spark: list[float] = []
        try:
            ohlcv = exchanges.fetch_ohlcv(exchange, pair, "1h", limit=24)
            spark = [float(row[4]) for row in ohlcv if row[4] is not None]
        except Exception:  # noqa: BLE001 - sparkline is best-effort
            spark = []
        out.append(
            CoinPriceOut(
                symbol=symbol,
                name=name,
                pair=pair,
                price_usd=float(last) if last is not None else None,
                change_24h_pct=float(pct) if pct is not None else None,
                sparkline_24h=spark,
            )
        )
    return out


@router.get("/prices", response_model=MarketPricesResponse)
def get_market_prices(
    exchange: str = Query(DEFAULT_EXCHANGE),
    user: User = Depends(get_current_user),
):
    """Live prices for the top coins from the exchange's public API.

    Cached 60s. Serves stale cache (flagged) when the exchange is
    unreachable; 503 only when there is nothing to show (never fake data).
    """
    now = time.monotonic()
    if _PRICES_CACHE["payload"] is not None and now - _PRICES_CACHE["at"] < _PRICES_TTL_S:
        payload = _PRICES_CACHE["payload"]
        return MarketPricesResponse(**{**payload, "stale": False})
    try:
        prices = _fetch_market_prices(exchange)
    except Exception as e:  # noqa: BLE001 - surface as 503, never fake
        if _PRICES_CACHE["payload"] is not None:
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
