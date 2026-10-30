"""Business areas — Plataforma Unificada, módulo Business.

Four areas (Marketing, Ventas, Legal, Administrativo), each with its
OWN notes and tasks, scoped per area and never mixed: every endpoint
takes the area in the path (or as a required filter) and only ever
touches rows of that area.

Permissions follow the platform RBAC (same as CRM / Referidos):
- any authenticated user (admin or "prueba") can READ notes/tasks;
- only admins can create, update or delete (require_admin -> 403
  for prueba).
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import BusinessNote, BusinessTask, User

router = APIRouter(prefix="/api/business", tags=["business"])

AREAS = ("marketing", "ventas", "legal", "administrativo")


def _check_area(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in AREAS:
        raise HTTPException(
            status_code=422, detail=f"area must be one of: {', '.join(AREAS)}"
        )
    return v


class NoteOut(BaseModel):
    id: int
    area: str
    title: str
    body: str
    created_at: str | None = None
    updated_at: str | None = None


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    body: str = Field(default="", max_length=5000)


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    body: str | None = Field(default=None, max_length=5000)


class TaskOut(BaseModel):
    id: int
    area: str
    title: str
    done: bool
    created_at: str | None = None
    updated_at: str | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    done: bool | None = None


def _out_note(n: BusinessNote) -> NoteOut:
    return NoteOut(
        id=n.id,
        area=n.area,
        title=n.title,
        body=n.body or "",
        created_at=n.created_at.isoformat() if n.created_at else None,
        updated_at=n.updated_at.isoformat() if n.updated_at else None,
    )


def _out_task(t: BusinessTask) -> TaskOut:
    return TaskOut(
        id=t.id,
        area=t.area,
        title=t.title,
        done=bool(t.done),
        created_at=t.created_at.isoformat() if t.created_at else None,
        updated_at=t.updated_at.isoformat() if t.updated_at else None,
    )


def _get_note_or_404(db: Session, note_id: int) -> BusinessNote:
    note = db.get(BusinessNote, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


def _get_task_or_404(db: Session, task_id: int) -> BusinessTask:
    task = db.get(BusinessTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ---------- Notes ----------


@router.get("/{area}/notes", response_model=list[NoteOut])
def list_notes(
    area: str,
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    area = _check_area(area)
    return [
        _out_note(n)
        for n in db.query(BusinessNote)
        .filter(BusinessNote.area == area)
        .order_by(BusinessNote.id.desc())
        .offset(offset).limit(limit).all()
    ]


@router.post("/{area}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    area: str,
    payload: NoteCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    area = _check_area(area)
    note = BusinessNote(area=area, title=payload.title.strip(), body=payload.body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return _out_note(note)


@router.put("/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    note = _get_note_or_404(db, note_id)
    if payload.title is not None:
        note.title = payload.title.strip()
    if payload.body is not None:
        note.body = payload.body
    db.commit()
    db.refresh(note)
    return _out_note(note)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    db.delete(_get_note_or_404(db, note_id))
    db.commit()
    return None


# ---------- Tasks ----------


@router.get("/{area}/tasks", response_model=list[TaskOut])
def list_tasks(
    area: str,
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    area = _check_area(area)
    return [
        _out_task(t)
        for t in db.query(BusinessTask)
        .filter(BusinessTask.area == area)
        .order_by(BusinessTask.id.desc())
        .offset(offset).limit(limit).all()
    ]


@router.post("/{area}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    area: str,
    payload: TaskCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    area = _check_area(area)
    task = BusinessTask(area=area, title=payload.title.strip(), done=False)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _out_task(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = _get_task_or_404(db, task_id)
    if payload.title is not None:
        task.title = payload.title.strip()
    if payload.done is not None:
        task.done = payload.done
    db.commit()
    db.refresh(task)
    return _out_task(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    db.delete(_get_task_or_404(db, task_id))
    db.commit()
    return None
