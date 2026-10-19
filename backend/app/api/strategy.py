"""Strategy endpoints (Phase 3): evaluate trend+momentum and run the risk guard."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import get_current_user
from app.data import ingest
from app.database import get_db
from app.indicators import technical as ind
from app.models.tables import User
from app.risk import guard
from app.strategy import engine

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
    candles = ingest.latest_candles(db, symbol, timeframe, 200)
    if len(candles) < 60:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Not enough candles ({len(candles)}/60). Ingest first.",
        )
    # Use only CLOSED candles: drop the last (still forming) one.
    closed = candles[:-1]
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
