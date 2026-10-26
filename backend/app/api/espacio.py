"""Espacio — meditation and revelation journal.

Two pieces:
1. Meditación: breathing exercise + timer, fully client-side in the
   frontend — no backend state, no data stored.
2. Revelaciones: a personal journal. Entries are written by Rubén
   himself (reflections, ideas, lessons from meditation) — the system
   never generates or invents them.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Revelation, User

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
    db: Session = Depends(get_db),
):
    rows = db.query(Revelation).order_by(Revelation.id.desc()).all()
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
