"""Business areas — Grow Business Platform, módulo Business.

Four areas (Marketing, Ventas, Legal, Administrativo), each with its
OWN notes and tasks, scoped per area and never mixed: every endpoint
takes the area in the path (or as a required filter) and only ever
touches rows of that area.

Permissions follow the platform RBAC (same as CRM / Referidos):
- only admins (módulo "business") can read, create, update or
  delete (Fase 0, 2026-11-23: prueba recibe 403 también en lectura;
  antes cualquier autenticado leía).
"""
import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.portal import deny_linked_reader
from app.core.perfiles import require_modulo
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import BusinessNote, BusinessTask, User

# Fase 0 (2026-11-23, mejoras óptimas, P0-1): el router entero exige
# el módulo "business" — prueba (sin ese módulo) recibe 403 también
# en lectura. Antes: cualquier autenticado leía notas y tareas.
router = APIRouter(
    prefix="/api/business",
    tags=["business"],
    dependencies=[Depends(require_modulo("business"))],
)

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
    # Fecha de vencimiento (Fase 4 mejoras-v1, tarea 7): ISO AAAA-MM-DD o
    # null cuando la tarea no tiene fecha.
    due_date: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    due_date: dt.date | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    done: bool | None = None
    # Solo se aplica si el campo viaja en el payload (model_fields_set):
    # así se puede BORRAR la fecha enviando due_date=null.
    due_date: dt.date | None = Field(default=None)


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
        due_date=t.due_date.isoformat() if t.due_date else None,
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


class NotificacionTarea(BaseModel):
    id: int
    area: str
    title: str
    due_date: str | None = None


class NotificacionesOut(BaseModel):
    fecha: str
    vencidas: list[NotificacionTarea]
    de_hoy: list[NotificacionTarea]


# ---------- Notificaciones en la app (Fase 5b mejoras-v1, tarea 5) ----------
# Las tareas ya tenían due_date (Fase 4); este endpoint resume lo que
# vence hoy o ya venció, en todas las áreas, para el aviso en la app
# (banner en Business y sección de "Hoy", que ya las listaba).
# NOTIFICACIONES POR CORREO: PENDIENTES del proveedor — la plataforma
# no tiene servicio de correo configurado (no hay SMTP ni proveedor
# contratado), así que no se envía nada por correo; el aviso vive solo
# dentro de la app. No se promete envío por correo en ningún texto.
@router.get("/notificaciones", response_model=NotificacionesOut)
def list_notificaciones(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deny_linked_reader(db, user)
    # "Hoy" es el día del negocio (America/Los_Angeles), igual que el
    # panel "Hoy" (dashboard.py): una tarea que vence hoy en LA no debe
    # marcarse vencida a las 00:30 UTC.
    today = dt.datetime.now(ZoneInfo("America/Los_Angeles")).date()
    rows = (
        db.query(BusinessTask)
        .filter(
            BusinessTask.done.is_(False),
            BusinessTask.due_date.isnot(None),
            BusinessTask.due_date <= today,
        )
        .order_by(BusinessTask.due_date.asc(), BusinessTask.id.asc())
        .limit(100)
        .all()
    )
    vencidas = [
        NotificacionTarea(id=t.id, area=t.area, title=t.title, due_date=t.due_date.isoformat())
        for t in rows
        if t.due_date is not None and t.due_date < today
    ]
    de_hoy = [
        NotificacionTarea(id=t.id, area=t.area, title=t.title, due_date=t.due_date.isoformat())
        for t in rows
        if t.due_date is not None and t.due_date == today
    ]
    return NotificacionesOut(fecha=today.isoformat(), vencidas=vencidas, de_hoy=de_hoy)


# ---------- Notes ----------


@router.get("/{area}/notes", response_model=list[NoteOut])
def list_notes(
    area: str,
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py).
    deny_linked_reader(db, user)
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
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py).
    deny_linked_reader(db, user)
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
    task = BusinessTask(area=area, title=payload.title.strip(), done=False, due_date=payload.due_date)
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
    if "due_date" in payload.model_fields_set:
        task.due_date = payload.due_date
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
