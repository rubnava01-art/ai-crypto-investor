"""Desarrollo digital — business digital-adaptation projects (2026-10-28).

A project tracks one company's digital adaptation: it links to an
existing CRM contact (the company), moves through stages
(diagnostico -> propuesta -> desarrollo -> entrega) and holds tasks
and notes. Lists start EMPTY — nothing is invented. Any authenticated
user reads; only admins create/update/delete (require_admin -> 403
for prueba). Deleting a project deletes its tasks explicitly (SQLite
may not enforce the FK cascade).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Contact, DigitalProject, DigitalTask, User

router = APIRouter(prefix="/api/desarrollo", tags=["desarrollo"])

STAGES = ("diagnostico", "propuesta", "desarrollo", "entrega")


class DigitalTaskOut(BaseModel):
    id: int
    project_id: int
    title: str
    done: bool
    created_at: str | None = None


class DigitalProjectOut(BaseModel):
    id: int
    contact_id: int | None
    contact_name: str | None
    title: str
    stage: str
    notes: str
    tasks_count: int = 0
    done_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    contact_id: int | None = None
    stage: str = "diagnostico"
    notes: str = ""


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    contact_id: int | None = None
    clear_contact: bool = False
    stage: str | None = None
    notes: str | None = None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    done: bool | None = None


def _validate_stage(stage: str) -> str:
    s = (stage or "").strip().lower()
    if s not in STAGES:
        raise HTTPException(
            status_code=422,
            detail="La etapa debe ser diagnostico, propuesta, desarrollo o entrega.",
        )
    return s


def _contact_or_404(db: Session, contact_id: int | None) -> Contact | None:
    if contact_id is None:
        return None
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


def _project_out(p: DigitalProject, db: Session) -> DigitalProjectOut:
    contact = db.get(Contact, p.contact_id) if p.contact_id else None
    tasks = db.query(DigitalTask).filter(DigitalTask.project_id == p.id).all()
    return DigitalProjectOut(
        id=p.id,
        contact_id=p.contact_id,
        contact_name=contact.name if contact else None,
        title=p.title,
        stage=p.stage,
        notes=p.notes or "",
        tasks_count=len(tasks),
        done_count=sum(1 for t in tasks if t.done),
        created_at=p.created_at.isoformat() if p.created_at else None,
        updated_at=p.updated_at.isoformat() if p.updated_at else None,
    )


def _task_out(t: DigitalTask) -> DigitalTaskOut:
    return DigitalTaskOut(
        id=t.id,
        project_id=t.project_id,
        title=t.title,
        done=t.done,
        created_at=t.created_at.isoformat() if t.created_at else None,
    )


@router.get("/projects", response_model=list[DigitalProjectOut])
def list_projects(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(DigitalProject).order_by(DigitalProject.id.desc()).all()
    return [_project_out(p, db) for p in rows]


@router.post("/projects", response_model=DigitalProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _contact_or_404(db, payload.contact_id)
    row = DigitalProject(
        title=payload.title.strip(),
        contact_id=payload.contact_id,
        stage=_validate_stage(payload.stage),
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _project_out(row, db)


@router.put("/projects/{project_id}", response_model=DigitalProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(DigitalProject, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.clear_contact:
        row.contact_id = None
    elif payload.contact_id is not None:
        _contact_or_404(db, payload.contact_id)
        row.contact_id = payload.contact_id
    if payload.stage is not None:
        row.stage = _validate_stage(payload.stage)
    if payload.notes is not None:
        row.notes = payload.notes
    db.commit()
    db.refresh(row)
    return _project_out(row, db)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(DigitalProject, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.query(DigitalTask).filter(DigitalTask.project_id == project_id).delete()
    db.delete(row)
    db.commit()
    return None


@router.get("/projects/{project_id}/tasks", response_model=list[DigitalTaskOut])
def list_tasks(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(DigitalProject, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        db.query(DigitalTask)
        .filter(DigitalTask.project_id == project_id)
        .order_by(DigitalTask.id)
        .all()
    )
    return [_task_out(t) for t in rows]


@router.post("/projects/{project_id}/tasks", response_model=DigitalTaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    project_id: int,
    payload: TaskCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.get(DigitalProject, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    row = DigitalTask(project_id=project_id, title=payload.title.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _task_out(row)


@router.patch("/tasks/{task_id}", response_model=DigitalTaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(DigitalTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.done is not None:
        row.done = payload.done
    db.commit()
    db.refresh(row)
    return _task_out(row)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(DigitalTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(row)
    db.commit()
    return None
