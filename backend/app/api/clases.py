"""Clases — recorded and live classes in the Estudiar module.

`kind`: grabada (recorded video) or envivo (scheduled live session with
a meeting link and start time). Classes are created by the admin only
and lists start empty — the system never invents classes, links, or
schedules.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
"""
import datetime as dt
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.security import (
    Principal,
    get_current_user,
    guest_read_guard,
    require_admin,
)
from app.database import get_db
from app.models.tables import (
    EduClass,
    EduProgress,
    EduQuizAttempt,
    EduQuizQuestion,
    User,
    utcnow,
)

router = APIRouter(prefix="/api/clases", tags=["clases"])

KINDS = ("grabada", "envivo")

# URL allowlist (E3, 2026-11-10): solo esquemas http/https. Vacía = opcional.
# Sin esquema (p. ej. "zoom.us/j/123") se RECHAZA con 422: la normalización
# ("https://" si falta esquema) vive en el frontend, que es quien la
# presenta al usuario; el backend solo valida el esquema cuando está
# presente. Contratos simples: vacía o URL absoluta http(s).
ALLOWED_URL_SCHEMES = ("http", "https")


class EduClassOut(BaseModel):
    id: int
    kind: str
    title: str
    description: str
    url: str
    scheduled_at: str | None = None
    duration_min: int | None = None
    created_at: str | None = None


class EduClassCreate(BaseModel):
    kind: str
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    url: str = Field(default="", max_length=500)
    scheduled_at: str | None = None  # ISO datetime
    duration_min: int | None = Field(default=None, gt=0)

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        url = (v or "").strip()
        if not url:
            return ""
        parsed = urlparse(url)
        if parsed.scheme not in ALLOWED_URL_SCHEMES or not parsed.netloc:
            raise ValueError("url must be empty or an absolute http:// or https:// URL")
        return url


def _class_out(c: EduClass) -> EduClassOut:
    return EduClassOut(
        id=c.id,
        kind=c.kind,
        title=c.title,
        description=c.description or "",
        url=c.url or "",
        scheduled_at=c.scheduled_at.isoformat() if c.scheduled_at else None,
        duration_min=c.duration_min,
        created_at=c.created_at.isoformat() if c.created_at else None,
    )


@router.get("/classes", response_model=list[EduClassOut])
def list_classes(
    kind: str | None = None,
    # Fase 1 (2026-11-23): listado abierto a invitado (solo lectura).
    user: Principal = Depends(guest_read_guard),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(EduClass)
    if kind is not None:
        if kind not in KINDS:
            raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(KINDS)}")
        q = q.filter(EduClass.kind == kind)
    rows = q.order_by(EduClass.scheduled_at.desc(), EduClass.id.desc()).offset(offset).limit(limit).all()
    return [_class_out(r) for r in rows]


@router.post("/classes", response_model=EduClassOut, status_code=status.HTTP_201_CREATED)
def create_class(
    payload: EduClassCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(KINDS)}")
    scheduled = None
    if payload.scheduled_at:
        try:
            scheduled = dt.datetime.fromisoformat(payload.scheduled_at.strip())
        except ValueError:
            raise HTTPException(
                status_code=422, detail="scheduled_at must be ISO datetime"
            ) from None
    row = EduClass(
        kind=payload.kind,
        title=payload.title.strip(),
        description=payload.description,
        url=payload.url.strip(),
        scheduled_at=scheduled,
        duration_min=payload.duration_min,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # A4 (2026-11-26): invalida la caché del índice de biblioteca
    # del Asistente.
    from app.api.asistente import invalidar_cache_biblioteca

    invalidar_cache_biblioteca()
    return _class_out(row)


class ProgressKindOut(BaseModel):
    total: int
    completed: int
    pct: float


class ProgressOut(BaseModel):
    completed_class_ids: list[int]
    total: int
    completed: int
    pct: float
    by_kind: dict[str, ProgressKindOut]


def _progress_out(db: Session, user_id: int) -> ProgressOut:
    """Resumen de progreso del usuario (Fase 5a, tarea 4).

    El porcentaje es por "curso": cada kind (grabada / envivo) es un
    recorrido propio, además del total de Estudiar. Sin clases, el
    porcentaje es 0 (nunca división por cero ni 100 % inventado).
    """
    classes = db.query(EduClass).all()
    done = {
        r.class_id
        for r in db.query(EduProgress)
        .filter(EduProgress.user_id == user_id, EduProgress.completed.is_(True))
        .all()
    }
    total = len(classes)
    completed = len([c for c in classes if c.id in done])
    by_kind: dict[str, ProgressKindOut] = {}
    for kind in KINDS:
        rows = [c for c in classes if c.kind == kind]
        n_done = len([c for c in rows if c.id in done])
        n_total = len(rows)
        by_kind[kind] = ProgressKindOut(
            total=n_total,
            completed=n_done,
            pct=round(n_done / n_total * 100, 1) if n_total else 0.0,
        )
    return ProgressOut(
        completed_class_ids=sorted(done),
        total=total,
        completed=completed,
        pct=round(completed / total * 100, 1) if total else 0.0,
        by_kind=by_kind,
    )


def _set_completed(
    db: Session, user_id: int, class_id: int, completed: bool
) -> EduProgress:
    row = (
        db.query(EduProgress)
        .filter(EduProgress.user_id == user_id, EduProgress.class_id == class_id)
        .first()
    )
    now = utcnow()
    if row is None:
        row = EduProgress(
            user_id=user_id,
            class_id=class_id,
            completed=completed,
            completed_at=now if completed else None,
        )
        db.add(row)
    else:
        row.completed = completed
        row.completed_at = now if completed else None
        row.updated_at = now
    db.commit()
    db.refresh(row)
    return row


@router.get("/progress", response_model=ProgressOut)
def get_progress(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Progreso propio del usuario (cuenta registrada; el invitado no
    tiene fila de usuario y recibe 401)."""
    return _progress_out(db, user.id)


@router.post("/classes/{class_id}/complete", response_model=ProgressOut)
def complete_class(
    class_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    _set_completed(db, user.id, class_id, True)
    return _progress_out(db, user.id)


@router.delete("/classes/{class_id}/complete", response_model=ProgressOut)
def uncomplete_class(
    class_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    _set_completed(db, user.id, class_id, False)
    return _progress_out(db, user.id)


class CertificateOut(BaseModel):
    kind: str
    completed: bool
    total: int
    completed_count: int
    pct: float
    user_name: str
    completed_at: str | None = None


@router.get("/certificates/{kind}", response_model=CertificateOut)
def get_certificate(
    kind: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Certificado de finalización de un recorrido (Fase 5a, tarea 6).

    Un "curso" es un recorrido de Clases (grabada / envivo): el
    certificado existe solo al completar el 100 % con al menos una
    clase. Sin completar, completed=False y completed_at=None. El
    nombre es el real del usuario (display_name o usuario) y la fecha
    es la de la última clase marcada. Sin sellos ni credenciales: el
    texto del certificado (frontend) lo marca como finalización de la
    plataforma, no como título oficial.
    """
    if kind not in KINDS:
        raise HTTPException(
            status_code=422, detail=f"kind must be one of: {', '.join(KINDS)}"
        )
    progress = _progress_out(db, user.id)
    k = progress.by_kind[kind]
    done = k.total > 0 and k.completed == k.total
    done_at = None
    if done:
        row = (
            db.query(EduProgress)
            .join(EduClass, EduClass.id == EduProgress.class_id)
            .filter(
                EduProgress.user_id == user.id,
                EduProgress.completed.is_(True),
                EduClass.kind == kind,
            )
            .order_by(EduProgress.completed_at.desc())
            .first()
        )
        done_at = row.completed_at.isoformat() if row and row.completed_at else None
    return CertificateOut(
        kind=kind,
        completed=done,
        total=k.total,
        completed_count=k.completed,
        pct=k.pct,
        user_name=user.display_name or user.username,
        completed_at=done_at,
    )


# ------------------------------------------------------------------ quiz --
# Fase 5a, tarea 5: quiz corto por clase, con preguntas basadas SOLO en
# el material real de esa clase. Las preguntas las crea el admin (con
# `source` obligatorio: de dónde sale la respuesta) y sin preguntas la
# clase no tiene quiz: GET responde has_quiz=False y la UI lo marca
# PENDIENTE, sin inventar preguntas.

class QuizQuestionPublic(BaseModel):
    id: int
    question: str
    options: list[str]


class QuizOut(BaseModel):
    class_id: int
    has_quiz: bool
    questions: list[QuizQuestionPublic]


class QuizQuestionCreate(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int
    explanation: str = Field(default="", max_length=1000)
    source: str = Field(min_length=1, max_length=300)

    @field_validator("options")
    @classmethod
    def _validate_options(cls, v: list[str]) -> list[str]:
        cleaned = [(o or "").strip() for o in v]
        if any(not o for o in cleaned):
            raise ValueError("options must not contain empty strings")
        if any(len(o) > 200 for o in cleaned):
            raise ValueError("each option must be at most 200 characters")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("options must not repeat")
        return cleaned


class QuizQuestionOut(BaseModel):
    id: int
    question: str
    options: list[str]
    correct_index: int
    explanation: str
    source: str


class QuizSubmit(BaseModel):
    answers: dict[int, int]


class QuizResultItem(BaseModel):
    question_id: int
    correct: bool
    correct_index: int
    explanation: str


class QuizResult(BaseModel):
    score: int
    total: int
    results: list[QuizResultItem]


def _quiz_questions(db: Session, class_id: int) -> list[EduQuizQuestion]:
    return (
        db.query(EduQuizQuestion)
        .filter(EduQuizQuestion.class_id == class_id)
        .order_by(EduQuizQuestion.id.asc())
        .all()
    )


@router.get("/classes/{class_id}/quiz", response_model=QuizOut)
def get_quiz(
    class_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Preguntas del quiz SIN respuestas: la corrección llega solo al
    enviar (POST .../submit). Sin preguntas, has_quiz=False."""
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    questions = _quiz_questions(db, class_id)
    return QuizOut(
        class_id=class_id,
        has_quiz=len(questions) > 0,
        questions=[
            QuizQuestionPublic(id=q.id, question=q.question, options=list(q.options))
            for q in questions
        ],
    )


@router.post("/classes/{class_id}/quiz/submit", response_model=QuizResult)
def submit_quiz(
    class_id: int,
    payload: QuizSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Corrección inmediata con explicación breve. Guarda el intento
    (aciertos/total) del usuario; las respuestas concretas no se
    guardan."""
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    questions = _quiz_questions(db, class_id)
    if not questions:
        raise HTTPException(
            status_code=422, detail="Esta clase todavía no tiene quiz."
        )
    by_id = {q.id: q for q in questions}
    unknown = [qid for qid in payload.answers if qid not in by_id]
    if unknown:
        raise HTTPException(
            status_code=422, detail=f"Unknown question ids: {sorted(unknown)}."
        )
    results: list[QuizResultItem] = []
    score = 0
    for q in questions:
        chosen = payload.answers.get(q.id)
        if chosen is not None and (chosen < 0 or chosen >= len(q.options)):
            raise HTTPException(
                status_code=422,
                detail=f"Answer for question {q.id} is out of range.",
            )
        correct = chosen == q.correct_index
        score += 1 if correct else 0
        results.append(
            QuizResultItem(
                question_id=q.id,
                correct=correct,
                correct_index=q.correct_index,
                explanation=q.explanation or "",
            )
        )
    db.add(
        EduQuizAttempt(
            user_id=user.id, class_id=class_id, score=score, total=len(questions)
        )
    )
    db.commit()
    return QuizResult(score=score, total=len(questions), results=results)


@router.get(
    "/classes/{class_id}/quiz/questions", response_model=list[QuizQuestionOut]
)
def list_quiz_questions(
    class_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Vista del admin con respuestas (para revisar y gestionar)."""
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    return [
        QuizQuestionOut(
            id=q.id,
            question=q.question,
            options=list(q.options),
            correct_index=q.correct_index,
            explanation=q.explanation or "",
            source=q.source,
        )
        for q in _quiz_questions(db, class_id)
    ]


@router.post(
    "/classes/{class_id}/quiz/questions",
    response_model=QuizQuestionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_quiz_question(
    class_id: int,
    payload: QuizQuestionCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.get(EduClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if not 0 <= payload.correct_index < len(payload.options):
        raise HTTPException(
            status_code=422, detail="correct_index is out of range for options"
        )
    row = EduQuizQuestion(
        class_id=class_id,
        question=payload.question.strip(),
        options=payload.options,
        correct_index=payload.correct_index,
        explanation=payload.explanation.strip(),
        source=payload.source.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return QuizQuestionOut(
        id=row.id,
        question=row.question,
        options=list(row.options),
        correct_index=row.correct_index,
        explanation=row.explanation or "",
        source=row.source,
    )


@router.delete(
    "/classes/{class_id}/quiz/questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_quiz_question(
    class_id: int,
    question_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = (
        db.query(EduQuizQuestion)
        .filter(
            EduQuizQuestion.id == question_id,
            EduQuizQuestion.class_id == class_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(row)
    db.commit()
    return None


@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_class(
    class_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(EduClass, class_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Class not found")
    db.delete(row)
    db.commit()
    # A4 (2026-11-26): invalida la caché del índice de biblioteca
    # del Asistente.
    from app.api.asistente import invalidar_cache_biblioteca

    invalidar_cache_biblioteca()
    return None
