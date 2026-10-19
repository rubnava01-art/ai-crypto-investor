"""Learning from errors: log explanations, resolve signal outcomes,
track calibration, and aggregate lessons.

Flow:
1. assistant.py logs every signal explanation (AIExplanation, outcome=NULL).
2. run_learning_cycle() resolves each open explanation against market data:
   a buy signal wins if a later candle hits its target before its
   invalidation; a sell signal mirrors it. Otherwise unknown.
3. Resolved explanations update the calibration buckets (expressed
   confidence vs actual hit rate) and may produce an AILesson row.
4. review_lessons() aggregates recurring error patterns into a short
   Spanish summary for the dashboard.

Honest uncertainty is structural: confidence is stored as expressed and
compared against out-of-sample outcomes; miscalibration is surfaced, never
hidden.
"""
import datetime as dt
import re
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.tables import AIExplanation, AILesson, MarketCandle, Signal, utcnow

CONFIDENCE_RE = re.compile(r"(\d{1,3})\s*%")

# (lower, upper) confidence buckets for the calibration table.
BUCKETS: list[tuple[int, int]] = [(0, 50), (50, 60), (60, 70), (70, 80), (80, 101)]

MISCALIBRATION_MIN_N = 5
MISCALIBRATION_TOLERANCE_PTS = 15.0


def extract_confidence(text: str) -> Decimal | None:
    """Pull the first NN% confidence claim out of an answer, if any."""
    m = CONFIDENCE_RE.search(text or "")
    if not m:
        return None
    value = max(0, min(100, int(m.group(1))))
    return Decimal(str(value))


def log_explanation(
    db: Session,
    user_id: int | None,
    signal_id: int | None,
    question: str,
    answer: str,
    confidence: Decimal | None,
) -> AIExplanation:
    row = AIExplanation(
        signal_id=signal_id,
        user_id=user_id,
        question_excerpt=(question or "")[:300],
        answer_excerpt=(answer or "")[:500],
        confidence=confidence,
        outcome=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def resolve_signal_outcome(db: Session, signal_id: int) -> str:
    """Win/loss vs the signal's own stated invalidation, using candles that
    closed AFTER the signal was created. No future data leaks: only candles
    with open_time_utc > signal.created_at are considered."""
    sig = db.query(Signal).filter(Signal.id == signal_id).first()
    if sig is None or sig.entry_price is None:
        return "unknown"
    if sig.side not in ("buy", "sell"):
        return "unknown"  # hold signals carry no directional claim
    if sig.target_price is None or sig.invalidation_price is None:
        return "unknown"

    entry = float(sig.entry_price)
    target = float(sig.target_price)
    inval = float(sig.invalidation_price)
    candles = (
        db.query(MarketCandle)
        .filter(
            MarketCandle.symbol == sig.symbol,
            MarketCandle.open_time_utc > sig.created_at,
        )
        .order_by(MarketCandle.open_time_utc.asc())
        .limit(500)
        .all()
    )
    for c in candles:
        high, low = float(c.high), float(c.low)
        if sig.side == "buy":
            if high >= target:
                return "win"
            if low <= inval:
                return "loss"
        else:  # sell: target below entry, invalidation above
            if low <= target:
                return "win"
            if high >= inval:
                return "loss"
    return "unknown"


def _lesson_for(outcome: str, confidence: Decimal | None, signal_id: int) -> str:
    conf = f" (confianza expresada: {confidence}%)" if confidence is not None else ""
    if outcome == "loss" and confidence is not None and confidence >= 70:
        return (
            f"La señal #{signal_id} se explicó con alta confianza{conf} y "
            f"resultó en pérdida: la confianza alta no evita que el stop se "
            f"active. Reducir el tono de certeza en escenarios similares."
        )
    if outcome == "win" and confidence is not None and confidence <= 40:
        return (
            f"La señal #{signal_id} se explicó con baja confianza{conf} y "
            f"resultó en ganancia: el escepticismo era excesivo frente a los "
            f"indicadores. Revisar qué datos se subestimaron."
        )
    if outcome == "loss":
        return (
            f"La señal #{signal_id} tocó su invalidación: repasar si los "
            f"indicadores (RSI/MACD/medias) realmente alineaban o si la "
            f"explicación fue demasiado optimista."
        )
    return (
        f"La señal #{signal_id} alcanzó su objetivo: la lectura técnica fue "
        f"correcta. Conservar el patrón de análisis usado."
    )


def run_learning_cycle(db: Session) -> dict:
    """Resolve all open explanations. Returns counts for observability."""
    resolved = {"win": 0, "loss": 0, "unknown": 0, "lessons": 0}
    open_rows = (
        db.query(AIExplanation).filter(AIExplanation.outcome.is_(None)).all()
    )
    for row in open_rows:
        if row.signal_id is None:
            row.outcome = "unknown"
            row.resolved_at = utcnow()
            resolved["unknown"] += 1
            continue
        outcome = resolve_signal_outcome(db, row.signal_id)
        row.outcome = outcome
        row.resolved_at = utcnow()
        resolved[outcome] += 1
        if outcome in ("win", "loss"):
            db.add(
                AILesson(
                    signal_id=row.signal_id,
                    claim=row.answer_excerpt[:300],
                    outcome=outcome,
                    lesson=_lesson_for(outcome, row.confidence, row.signal_id),
                )
            )
            resolved["lessons"] += 1
    db.commit()
    return resolved


def calibration_summary(db: Session) -> list[dict]:
    """Per-bucket calibration: expressed confidence vs actual hit rate.

    A bucket is flagged miscalibrated when it has >= 5 resolved samples and
    the gap between mean expressed confidence and actual win rate exceeds
    15 points. This is the honest-uncertainty mechanism: the assistant's
    certainty is audited against out-of-sample outcomes.
    """
    rows = (
        db.query(AIExplanation)
        .filter(
            AIExplanation.confidence.is_not(None),
            AIExplanation.outcome.in_(["win", "loss"]),
        )
        .all()
    )
    summary = []
    for lo, hi in BUCKETS:
        bucket = [r for r in rows if lo <= float(r.confidence) < hi]
        n = len(bucket)
        if n == 0:
            continue
        wins = sum(1 for r in bucket if r.outcome == "win")
        claimed = sum(float(r.confidence) for r in bucket) / n
        actual = wins / n * 100.0
        gap = abs(claimed - actual)
        summary.append(
            {
                "bucket": f"{lo}-{min(hi, 100)}%",
                "n": n,
                "claimed_avg_pct": round(claimed, 1),
                "actual_win_pct": round(actual, 1),
                "miscalibrated": n >= MISCALIBRATION_MIN_N and gap > MISCALIBRATION_TOLERANCE_PTS,
            }
        )
    return summary


def review_lessons(db: Session, limit: int = 20) -> str:
    """Aggregate recurring error patterns into a short Spanish summary for
    the dashboard."""
    lessons = (
        db.query(AILesson).order_by(AILesson.created_at.desc()).limit(limit).all()
    )
    if not lessons:
        return (
            "Aún no hay lecciones registradas. Las lecciones aparecen cuando "
            "las explicaciones del asistente se resuelven contra el mercado."
        )
    wins = sum(1 for l in lessons if l.outcome == "win")
    losses = len(lessons) - wins
    lines = [
        f"Lecciones registradas: {len(lessons)} ({wins} de señales ganadoras, "
        f"{losses} de perdedoras)."
    ]
    # Surface the most recent loss lessons — those are the errors to learn from.
    for l in [x for x in lessons if x.outcome == "loss"][:3]:
        lines.append(f"- {l.lesson}")
    cal = calibration_summary(db)
    bad = [b for b in cal if b["miscalibrated"]]
    for b in bad:
        lines.append(
            f"- Calibración: en el rango {b['bucket']} el asistente expresa "
            f"{b['claimed_avg_pct']}% de confianza pero acierta el "
            f"{b['actual_win_pct']}% ({b['n']} casos). Ajustar el tono."
        )
    lines.append(
        "Nota honesta: estos resultados describen el pasado; un backtest o "
        "una racha no prueban rentabilidad futura."
    )
    return "\n".join(lines)
