"""Strategy endpoints (Phase 3): evaluate trend+momentum and run the risk guard."""
import datetime as dt
import re
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.core.symbols import validate_symbol as _validate_symbol
from app.core.rate_limit import strategy_limiter
from app.core.security import get_current_user
from app.data import ingest
from app.database import get_db
from app.indicators import technical as ind
from app.models.tables import User
from app.risk import guard
from app.strategy import engine

# 2026-11-06: una evaluación sobre velas viejas es peor que ninguna —
# el escáner puede llevar horas caído y la señal saldría con datos
# muertos y quedaría persistida como si fuera actual. El umbral es 2
# velas: da margen a un ciclo de ingesta perdido sin aceptar datos
# de hace medio día en 1h.
_TIMEFRAME_RE = re.compile(r"^(\d+)([mhdw])$")
_TIMEFRAME_SECONDS = {"m": 60, "h": 3600, "d": 86400, "w": 604800}
_STALE_CANDLES = 2


def _timeframe_seconds(timeframe: str) -> int:
    """Segundos de una vela ('15m', '1h', '4h', '1d'...). Formato
    desconocido -> 1h: nunca bloquear la evaluación por no entender
    el timeframe, el guarda de antigüedad sigue aplicando con 2h."""
    m = _TIMEFRAME_RE.match(timeframe.strip().lower())
    if not m:
        return 3600
    return int(m.group(1)) * _TIMEFRAME_SECONDS[m.group(2)]


def _as_utc(moment: dt.datetime) -> dt.datetime:
    """SQLite devuelve los DateTime(timezone=True) sin tzinfo: se
    asume UTC, que es como se guardaron."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=dt.timezone.utc)
    return moment

router = APIRouter(prefix="/api/strategy", tags=["strategy"])


class EvaluationResponse(BaseModel):
    symbol: str
    side: str
    entry_price: str | None
    target_price: str | None
    invalidation_price: str | None
    reason: str
    risk_approved: bool
    risk_reason: str
    quantity: str | None
    signal_id: int
    demo: bool = True


@router.post("/evaluate", response_model=EvaluationResponse)
def evaluate(
    symbol: str = Query("BTC/USD"),
    timeframe: str = Query("1h"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 2026-11-12 (seguimiento de la validación del 2026-11-11 en
    # /api/market): mismo validate_symbol — "btc/usd" no encontraba
    # las velas guardadas como "BTC/USD" y un símbolo mal formado
    # llegaba a la BD y consumía el limitador. 422 antes del limitador.
    symbol = _validate_symbol(symbol)
    # Per-USER limiter (M3): every evaluate writes a Signal +
    # RiskDecision row and reads 200 candles — it used to be unlimited.
    if not strategy_limiter.allow(f"strategy:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas evaluaciones. Espera un minuto.",
        )
    candles = ingest.latest_candles(db, symbol, timeframe, 200)
    if len(candles) < 60:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles ({len(candles)}/60). Ingest first.",
        )
    # Use only CLOSED candles: drop the last (still forming) one.
    closed = candles[:-1]
    # Sin datos frescos no hay señal: si la última vela cerrada es
    # más vieja que 2 timeframes, el escáner lleva caído un rato y
    # evaluar persistiría una señal con datos muertos.
    newest_closed = _as_utc(closed[-1].open_time_utc)
    age_s = (dt.datetime.now(dt.timezone.utc) - newest_closed).total_seconds()
    max_age_s = _STALE_CANDLES * _timeframe_seconds(timeframe)
    if age_s > max_age_s:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Stale candles for {symbol} {timeframe}: newest closed "
                f"candle is {age_s / 3600:.1f}h old (max {max_age_s / 3600:.1f}h). "
                "Run the scanner or ingest first."
            ),
        )
    closes = [float(c.close) for c in closed]
    volumes = [float(c.volume) for c in closed]
    snapshot = ind.summarize(closes, volumes)

    candidate = engine.evaluate(symbol, snapshot)
    signal, decision, result = guard.decide_and_persist(
        db, candidate, Decimal(settings.initial_capital_usd)
    )
    return EvaluationResponse(
        symbol=symbol,
        side=candidate.side,
        entry_price=str(candidate.entry_price) if candidate.entry_price else None,
        target_price=str(candidate.target_price) if candidate.target_price else None,
        invalidation_price=(
            str(candidate.invalidation_price) if candidate.invalidation_price else None
        ),
        reason=candidate.reason,
        risk_approved=result.approved,
        risk_reason=result.reason,
        quantity=str(result.quantity) if result.quantity else None,
        signal_id=signal.id,
        demo=True,
    )
