"""AI assistant endpoints. Authenticated + rate-limited + audited.

POST /api/ai/ask      — ask the technical assistant (read-only by construction)
GET  /api/ai/lessons  — learned lessons + calibration summary (Spanish)
GET  /api/ai/status   — model provider status (never exposes keys)
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.ai import assistant, learning
from app.ai.models import get_model
from app.core.hardening import audit
from app.core.rate_limit import RateLimiter
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import User
from app.schemas.api import (
    AIAskRequest,
    AIAskResponse,
    AILessonsResponse,
    AIStatusResponse,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])

ai_limiter = RateLimiter(max_requests=20, window_seconds=60)


@router.get("/status", response_model=AIStatusResponse)
def ai_status(user: User = Depends(get_current_user)):
    model = get_model()
    return AIStatusResponse(
        provider=model.name,
        configured=model.configured,
        demo=not model.configured,
    )


@router.post("/ask", response_model=AIAskResponse)
def ai_ask(
    payload: AIAskRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    key = f"ai_ask:{user.id}:{client_ip}"
    if not ai_limiter.allow(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas preguntas. Espera un minuto.",
        )
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La pregunta no puede estar vacía.",
        )
    if len(question) > 2000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La pregunta es demasiado larga (máx. 2000 caracteres).",
        )
    result = assistant.ask(db, user, question, signal_id=payload.signal_id)
    audit(
        db,
        user,
        action="ai.ask",
        entity="ai_assistant",
        details={
            "refused": result["refused"],
            "demo": result["demo"],
            "signal_id": result["signal_id"],
            "question_excerpt": question[:120],
        },
    )
    return AIAskResponse(
        answer=result["answer"],
        refused=result["refused"],
        demo=result["demo"],
        confidence=result["confidence"],
        signal_id=result["signal_id"],
    )


@router.get("/lessons", response_model=AILessonsResponse)
def ai_lessons(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Opportunistically resolve open explanations before reporting.
    learning.run_learning_cycle(db)
    return AILessonsResponse(
        summary_es=learning.review_lessons(db),
        calibration=learning.calibration_summary(db),
    )
