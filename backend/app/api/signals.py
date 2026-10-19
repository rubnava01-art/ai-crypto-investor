"""Signals endpoints. Phase 1 serves seeded DEMO signals."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import Signal, User
from app.schemas.api import SignalOut, SignalsResponse

router = APIRouter(prefix="/api/signals", tags=["signals"])


def _to_out(s: Signal) -> SignalOut:
    return SignalOut(
        id=s.id,
        symbol=s.symbol,
        side=s.side,  # type: ignore[arg-type]
        entry_price=str(s.entry_price) if s.entry_price is not None else None,
        target_price=str(s.target_price) if s.target_price is not None else None,
        invalidation_price=(
            str(s.invalidation_price) if s.invalidation_price is not None else None
        ),
        reason=s.reason,
        status=s.status,
        created_utc=s.created_at.isoformat(),
    )


@router.get("", response_model=SignalsResponse)
def list_signals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    signals = db.query(Signal).order_by(Signal.created_at.desc()).limit(50).all()
    return SignalsResponse(signals=[_to_out(s) for s in signals], demo=True)


@router.get("/{signal_id}", response_model=SignalOut)
def get_signal(
    signal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    s = db.query(Signal).filter(Signal.id == signal_id).first()
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return _to_out(s)
