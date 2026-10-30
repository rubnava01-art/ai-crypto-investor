"""Crear — Plataforma Unificada, Fase 3.

Two pieces:
1. Generador de copies: generates a social-media copy through the shared
   AI layer (app.ai.copies -> app.ai.models.get_model, the same provider
   behind /api/ai/ask) and stores each result as a CopyDraft. When the AI
   provider is the local stub, drafts are flagged demo=True and the UI
   says so — never presented as real AI output.
2. Panel de tendencias: TrendNote list. Seeded ONLY with topics Rubén
   actually published on Threads @rubenpromkt (vía @tecnologia), per
   ~/workspace/threads-tecnologia/used-posts.txt — no invented trends.
   New notes are added manually/by research.

Permissions: any authenticated user reads; only admins write
(require_admin -> 403 for prueba), including copy generation (it creates
a draft).
"""
import datetime as dt

from fastapi import APIRouter, Depends, Query, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai import copies as copy_service
from app.ai.models import AIModelError
from app.core.rate_limit import RateLimiter
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import CopyDraft, TrendNote, User

router = APIRouter(prefix="/api/crear", tags=["crear"])

PLATFORMS = ("instagram", "threads", "facebook")
TONES = ("directo", "educativo", "divertido", "profesional")

gen_limiter = RateLimiter(max_requests=20, window_seconds=60)

# --- Real published topics (threads-tecnologia/used-posts.txt) -------------
# (title, published_on) — source is the same for every seeded note.
_TREND_SOURCE = "@tecnologia vía Threads @rubenpromkt"
_TREND_SUMMARY = "Tema ya publicado en Threads @rubenpromkt (vía @tecnologia)."
PUBLISHED_TRENDS: list[tuple[str, str]] = [
    ("Costa Rica IA Latam", "2026-10-16"),
    ("IA se equivoca con seguridad", "2026-10-16"),
    ("Resumen noticias tech 24h", "2026-10-17"),
    ("Porsche Mission S vs Tesla Roadster", "2026-10-17"),
    ("Videos IA virales absurdos", "2026-10-18"),
    ("F1 Singapur TV VFX", "2026-10-18"),
    ("Mazzei Formula Five motor rotativo", "2026-10-19"),
    ("Xiaomi SU7 Ultra Nürburgring", "2026-10-19"),
    ("Tesla Roadster vuela cohete", "2026-10-20"),
    ("Resumen tech IA iPhone Duo", "2026-10-20"),
    ("Robots Figure F.02 fundición Finlandia", "2026-10-21"),
    ("Airbus A350 VMU tail-strike", "2026-10-21"),
    ("Robot humanoide gigante China", "2026-10-22"),
    ("Autos voladores Alef vs Tesla", "2026-10-22"),
    ("Robot humanoide Unitree H2X artes marciales", "2026-10-23"),
    ("Resumen noticias tech IA Apple SpaceX Claude Starlink", "2026-10-23"),
]


def seed_trend_notes(db: Session) -> None:
    """Insert the real published topics that are missing (idempotent)."""
    existing = {(t.title, t.published_on) for t in db.query(TrendNote).all()}
    added = False
    for title, day in PUBLISHED_TRENDS:
        published = dt.date.fromisoformat(day)
        if (title, published) in existing:
            continue
        db.add(
            TrendNote(
                title=title,
                source=_TREND_SOURCE,
                summary=_TREND_SUMMARY,
                published_on=published,
            )
        )
        added = True
    if added:
        db.commit()


# ---------------------------------------------------------------- schemas --

class CopyGenerateIn(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    platform: str = "instagram"
    tone: str = "directo"


class CopyDraftOut(BaseModel):
    id: int
    topic: str
    platform: str
    tone: str
    text: str
    demo: bool
    created_at: str | None = None


class TrendNoteOut(BaseModel):
    id: int
    title: str
    source: str
    summary: str
    published_on: str | None = None
    created_at: str | None = None


class TrendNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    source: str = Field(default="", max_length=120)
    summary: str = ""
    published_on: str | None = None  # ISO date YYYY-MM-DD


# ---------------------------------------------------------------- helpers --

def _copy_out(d: CopyDraft) -> CopyDraftOut:
    return CopyDraftOut(
        id=d.id,
        topic=d.topic,
        platform=d.platform,
        tone=d.tone,
        text=d.text,
        demo=bool(d.demo),
        created_at=d.created_at.isoformat() if d.created_at else None,
    )


def _trend_out(t: TrendNote) -> TrendNoteOut:
    return TrendNoteOut(
        id=t.id,
        title=t.title,
        source=t.source or "",
        summary=t.summary or "",
        published_on=t.published_on.isoformat() if t.published_on else None,
        created_at=t.created_at.isoformat() if t.created_at else None,
    )


def _check(value: str, allowed: tuple[str, ...], field: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise HTTPException(
            status_code=422, detail=f"{field} must be one of: {', '.join(allowed)}"
        )
    return v


# ----------------------------------------------------------------- copies --

@router.post("/copies/generate", response_model=CopyDraftOut, status_code=status.HTTP_201_CREATED)
def generate_copy_endpoint(
    payload: CopyGenerateIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    platform = _check(payload.platform, PLATFORMS, "platform")
    tone = _check(payload.tone, TONES, "tone")
    client_ip = request.client.host if request.client else "unknown"
    if not gen_limiter.allow(f"crear_gen:{admin.id}:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados copies seguidos. Espera un minuto.",
        )
    try:
        result = copy_service.generate_copy(payload.topic.strip(), platform, tone)
    except AIModelError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="El proveedor de IA no respondió. Inténtalo de nuevo.",
        ) from None
    draft = CopyDraft(
        topic=payload.topic.strip(),
        platform=platform,
        tone=tone,
        text=result["text"],
        demo=result["demo"],
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return _copy_out(draft)


@router.get("/copies", response_model=list[CopyDraftOut])
def list_copies(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = db.query(CopyDraft).order_by(CopyDraft.id.desc()).offset(offset).limit(limit).all()
    return [_copy_out(d) for d in rows]


@router.delete("/copies/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_copy(
    draft_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    draft = db.get(CopyDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Copy not found")
    db.delete(draft)
    db.commit()
    return None


# ----------------------------------------------------------------- trends --

@router.get("/trends", response_model=list[TrendNoteOut])
def list_trends(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TrendNote)
        .order_by(TrendNote.published_on.desc(), TrendNote.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_trend_out(t) for t in rows]


@router.post("/trends", response_model=TrendNoteOut, status_code=status.HTTP_201_CREATED)
def create_trend(
    payload: TrendNoteCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    published = None
    if payload.published_on:
        try:
            published = dt.date.fromisoformat(payload.published_on.strip())
        except ValueError:
            raise HTTPException(
                status_code=422, detail="published_on must be YYYY-MM-DD"
            ) from None
    note = TrendNote(
        title=payload.title.strip(),
        source=payload.source.strip(),
        summary=payload.summary,
        published_on=published,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _trend_out(note)


@router.delete("/trends/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trend(
    note_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    note = db.get(TrendNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Trend note not found")
    db.delete(note)
    db.commit()
    return None
