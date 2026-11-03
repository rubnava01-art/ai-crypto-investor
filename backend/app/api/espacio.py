"""Espacio — meditation, revelation journal, and emotion check-ins.

Three pieces:
1. Meditación: breathing exercise + timer, fully client-side in the
   frontend — no backend state, no data stored.
2. Revelaciones: a personal journal. Entries are written by Rubén
   himself (reflections, ideas, lessons from meditation) — the system
   never generates or invents them.
3. Emociones: manual emotion check-ins (how he feels, intensity 1-5,
   optional note), following the Monitor de Emociones pattern — also
   written only by him, never generated.

Permissions: admins read and write the journal and the emotion
check-ins. The demo role ("prueba") sees NEITHER list (empty lists,
decisión 6 de Rubén 2026-11-02: son datos personales del dueño).
Writes are admin-only (require_admin -> 403 for prueba).
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import EmotionEntry, Revelation, User

router = APIRouter(prefix="/api/espacio", tags=["espacio"])


class RevelationOut(BaseModel):
    id: int
    title: str
    text: str
    created_at: str | None = None


class RevelationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = ""


def _rev_out(r: Revelation) -> RevelationOut:
    return RevelationOut(
        id=r.id,
        title=r.title,
        text=r.text or "",
        created_at=r.created_at.isoformat() if r.created_at else None,
    )


@router.get("/revelations", response_model=list[RevelationOut])
def list_revelations(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Decisión 6 (2026-11-02): el diario es personal del dueño; la demo
    # no ve nada (lista vacía, sin textos ni conteos que filtren nada).
    if not user.is_admin:
        return []
    rows = db.query(Revelation).order_by(Revelation.id.desc()).offset(offset).limit(limit).all()
    return [_rev_out(r) for r in rows]


@router.post("/revelations", response_model=RevelationOut, status_code=status.HTTP_201_CREATED)
def create_revelation(
    payload: RevelationCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = Revelation(title=payload.title.strip(), text=payload.text)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _rev_out(row)


@router.delete("/revelations/{rev_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_revelation(
    rev_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Revelation, rev_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Revelation not found")
    db.delete(row)
    db.commit()
    return None


class EmotionOut(BaseModel):
    id: int
    emotion: str
    intensity: int
    note: str
    created_at: str | None = None


class EmotionCreate(BaseModel):
    emotion: str = Field(min_length=1, max_length=40)
    intensity: int = Field(ge=1, le=5)
    note: str = ""


class EmotionUpdate(BaseModel):
    emotion: str = Field(min_length=1, max_length=40)
    intensity: int = Field(ge=1, le=5)
    note: str = ""


def _emo_out(r: EmotionEntry) -> EmotionOut:
    return EmotionOut(
        id=r.id,
        emotion=r.emotion,
        intensity=r.intensity,
        note=r.note or "",
        created_at=r.created_at.isoformat() if r.created_at else None,
    )


@router.get("/emotions", response_model=list[EmotionOut])
def list_emotions(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # Decisión 6 (2026-11-02): las emociones son datos personales del
    # dueño. La demo no ve nada: lista vacía, sin notas, sin conteos
    # que filtren contenido. La escritura ya era solo admin.
    if not user.is_admin:
        return []
    rows = db.query(EmotionEntry).order_by(EmotionEntry.id.desc()).offset(offset).limit(limit).all()
    return [_emo_out(r) for r in rows]


@router.post("/emotions", response_model=EmotionOut, status_code=status.HTTP_201_CREATED)
def create_emotion(
    payload: EmotionCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = EmotionEntry(emotion=payload.emotion.strip(), intensity=payload.intensity, note=payload.note)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _emo_out(row)


@router.put("/emotions/{emo_id}", response_model=EmotionOut)
def update_emotion(
    emo_id: int,
    payload: EmotionUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(EmotionEntry, emo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Emotion entry not found")
    row.emotion = payload.emotion.strip()
    row.intensity = payload.intensity
    row.note = payload.note
    db.commit()
    db.refresh(row)
    return _emo_out(row)


@router.delete("/emotions/{emo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_emotion(
    emo_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(EmotionEntry, emo_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Emotion entry not found")
    db.delete(row)
    db.commit()
    return None
