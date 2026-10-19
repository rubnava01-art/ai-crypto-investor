"""Candle ingestion: fetch OHLCV from the exchange and upsert into MarketCandle."""
import datetime as dt
from decimal import Decimal

from sqlalchemy.orm import Session

from app.data import exchanges
from app.models.tables import MarketCandle


def _upsert_candle(db: Session, values: dict) -> None:
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = pg_insert(MarketCandle).values(**values)
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        stmt = sqlite_insert(MarketCandle).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["symbol", "timeframe", "open_time_utc"],
        set_={k: stmt.excluded[k] for k in ("open", "high", "low", "close", "volume", "source")},
    )
    db.execute(stmt)


def ingest_ohlcv(
    db: Session,
    exchange_id: str,
    symbol: str,
    timeframe: str = "1h",
    limit: int = 100,
) -> int:
    """Fetch candles and upsert. Returns number of rows fetched."""
    rows = exchanges.fetch_ohlcv(exchange_id, symbol, timeframe, limit)
    count = 0
    for ts_ms, o, h, l, c, v in rows:
        _upsert_candle(
            db,
            dict(
                symbol=symbol,
                timeframe=timeframe,
                open_time_utc=dt.datetime.fromtimestamp(ts_ms / 1000, tz=dt.timezone.utc),
                open=Decimal(str(o)),
                high=Decimal(str(h)),
                low=Decimal(str(l)),
                close=Decimal(str(c)),
                volume=Decimal(str(v)),
                source=exchange_id,
            ),
        )
        count += 1
    db.commit()
    return count


def latest_candles(
    db: Session, symbol: str, timeframe: str = "1h", limit: int = 100
) -> list[MarketCandle]:
    return (
        db.query(MarketCandle)
        .filter(MarketCandle.symbol == symbol, MarketCandle.timeframe == timeframe)
        .order_by(MarketCandle.open_time_utc.desc())
        .limit(limit)
        .all()[::-1]
    )
