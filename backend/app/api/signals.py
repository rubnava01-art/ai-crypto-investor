"""Signals endpoints. Phase 1 serves seeded DEMO signals."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.core.perfiles import require_modulo
from app.database import get_db
from app.models.tables import AIExplanation, Signal, User
from app.schemas.api import SignalHistoryOut, SignalOut, SignalsResponse

router = APIRouter(prefix="/api/signals", tags=["signals"], dependencies=[Depends(require_modulo("invertir"))])


def _confidence_and_history(db: Session, signals: list[Signal]):
    """Confianza e historial por señal, desde el registro real del
    asistente (Fase 5a, tarea 3).

    - Confianza: la última expresada por el asistente para esa señal
      (ai_explanations.confidence, 0-100, chat-potencia). Sin
      explicación de esa señal, None.
    - Historial: señales DISTINTAS con el mismo símbolo y lado cuyo
      resultado ya se resolvió (outcome win/loss del ciclo de
      aprendizaje, contra objetivo e invalidación con velas
      posteriores). La propia señal no se cuenta como "anterior".
      Una explicación por señal (la más reciente): varias preguntas
      sobre la misma señal no inflan el conteo.

    Sin datos, confianza None e historial None: la UI dice
    "sin historial" en vez de inventar un acierto.
    """
    ids = [s.id for s in signals]
    confidence: dict[int, float] = {}
    if ids:
        rows = (
            db.query(AIExplanation)
            .filter(
                AIExplanation.signal_id.in_(ids),
                AIExplanation.confidence.is_not(None),
            )
            .order_by(AIExplanation.created_at.desc(), AIExplanation.id.desc())
            .all()
        )
        for row in rows:
            if row.signal_id not in confidence:
                confidence[row.signal_id] = float(row.confidence)  # type: ignore[arg-type]

    pairs = {(s.symbol, s.side) for s in signals}
    history: dict[int, SignalHistoryOut] = {}
    if pairs:
        resolved = (
            db.query(AIExplanation, Signal.symbol, Signal.side)
            .join(Signal, Signal.id == AIExplanation.signal_id)
            .filter(AIExplanation.outcome.in_(("win", "loss")))
            .all()
        )
        # Última explicación resuelta por señal (una señal, un voto),
        # con su (símbolo, lado) leídos del join — el historial cuenta
        # TODAS las señales anteriores resueltas, no solo las de esta
        # página de 50.
        latest: dict[int, tuple] = {}
        for expl, symbol, side in resolved:
            if (symbol, side) not in pairs:
                continue
            prev = latest.get(expl.signal_id)
            if prev is None or (expl.created_at, expl.id) > (prev[0], prev[1]):
                latest[expl.signal_id] = (expl.created_at, expl.id, symbol, side, expl.outcome)
        counts: dict[tuple[str, str], dict[str, int]] = {}
        for _sig_id, (_at, _id, symbol, side, outcome) in latest.items():
            counts.setdefault((symbol, side), {"win": 0, "loss": 0})
            counts[(symbol, side)][outcome] += 1
        for s in signals:
            c = counts.get((s.symbol, s.side))
            if not c:
                continue
            # La propia señal no cuenta como "anterior": si su resultado
            # está resuelto, restarlo del conteo de su par.
            wins, losses = c["win"], c["loss"]
            own = latest.get(s.id)
            if own is not None:
                if own[4] == "win":
                    wins -= 1
                else:
                    losses -= 1
            total = wins + losses
            if total > 0:
                history[s.id] = SignalHistoryOut(
                    wins=wins,
                    losses=losses,
                    total=total,
                    win_rate_pct=round(wins / total * 100, 1),
                )
    return confidence, history


def _to_out(s: Signal, confidence: dict[int, float], history: dict[int, SignalHistoryOut]) -> SignalOut:
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
        confidence_pct=confidence.get(s.id),
        history=history.get(s.id),
    )


@router.get("", response_model=SignalsResponse)
def list_signals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    signals = db.query(Signal).order_by(Signal.created_at.desc()).limit(50).all()
    confidence, history = _confidence_and_history(db, signals)
    return SignalsResponse(
        signals=[_to_out(s, confidence, history) for s in signals], demo=True
    )


@router.get("/{signal_id}", response_model=SignalOut)
def get_signal(
    signal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    s = db.query(Signal).filter(Signal.id == signal_id).first()
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    confidence, history = _confidence_and_history(db, [s])
    return _to_out(s, confidence, history)
