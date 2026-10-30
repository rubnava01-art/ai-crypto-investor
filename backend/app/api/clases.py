"""Clases — recorded and live classes in the Estudiar module.

`kind`: grabada (recorded video) or envivo (scheduled live session with
a meeting link and start time). Classes are created by the admin only
and lists start empty — the system never invents classes, links, or
schedules.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
"""
import datetime as dt

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import EduClass, User

router = APIRouter(prefix="/api/clases", tags=["clases"])

KINDS = ("grabada", "envivo")


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
    user: User = Depends(get_current_user),
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
    return _class_out(row)


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
    return None
