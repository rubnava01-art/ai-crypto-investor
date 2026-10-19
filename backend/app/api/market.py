"""Market data endpoints (Phase 2): real candles, ticker, indicators.

Every response carries the data source and update timestamp. With no
connection, endpoints return 503 with a clear message (never fake data).
"""
import datetime as dt

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
