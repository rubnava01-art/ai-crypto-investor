"""CRM contacts — Plataforma Unificada, Fase 1.

The CRM is the connective tissue between modules (Estudiar / Invertir /
Crear): leads and customers from the Academy, Cohley brand work, RIV Goods
and manual entry live in one list.

Permissions follow the platform RBAC:
- any authenticated user (admin or "prueba") can READ contacts;
- only admins can create, update or delete (require_admin -> 403 for prueba).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Contact, User

router = APIRouter(prefix="/api/crm/contacts", tags=["crm"])

SOURCES = ("manual", "academia", "cohley", "rivgoods", "otro")
STATUSES = ("nuevo", "contactado", "interesado", "cliente", "inactivo")


class ContactOut(BaseModel):
    id: int
    name: str
    email: str
    phone: str
    source: str
    tags: list[str]
    status: str
    notes: str
    created_at: str | None = None
    updated_at: str | None = None


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    email: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=64)
    source: str = "manual"
    tags: list[str] = Field(default_factory=list)
    status: str = "nuevo"
    notes: str = ""


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    source: str | None = None
    tags: list[str] | None = None
    status: str | None = None
    notes: str | None = None


def _check_source(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in SOURCES:
        raise HTTPException(
            status_code=422, detail=f"source must be one of: {', '.join(SOURCES)}"
        )
    return v


def _check_status(value: str) -> str:
    v = (value or "").strip().lower()
    if v not in STATUSES:
        raise HTTPException(
            status_code=422, detail=f"status must be one of: {', '.join(STATUSES)}"
        )
    return v


def _out(c: Contact) -> ContactOut:
    return ContactOut(
        id=c.id,
        name=c.name,
        email=c.email or "",
        phone=c.phone or "",
        source=c.source,
        tags=list(c.tags or []),
        status=c.status,
        notes=c.notes or "",
        created_at=c.created_at.isoformat() if c.created_at else None,
        updated_at=c.updated_at.isoformat() if c.updated_at else None,
    )


@router.get("", response_model=list[ContactOut])
def list_contacts(
    q: str | None = Query(default=None, description="Search by name or email"),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Contact)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(or_(Contact.name.ilike(term), Contact.email.ilike(term)))
    if status_filter:
        query = query.filter(Contact.status == _check_status(status_filter))
    return [_out(c) for c in query.order_by(Contact.id.desc()).all()]


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: ContactCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contact = Contact(
        name=payload.name.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        source=_check_source(payload.source),
        tags=[str(t).strip() for t in payload.tags if str(t).strip()],
        status=_check_status(payload.status),
        notes=payload.notes,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return _out(contact)


@router.put("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    if payload.name is not None:
        contact.name = payload.name.strip()
    if payload.email is not None:
        contact.email = payload.email.strip()
    if payload.phone is not None:
        contact.phone = payload.phone.strip()
    if payload.source is not None:
        contact.source = _check_source(payload.source)
    if payload.tags is not None:
        contact.tags = [str(t).strip() for t in payload.tags if str(t).strip()]
    if payload.status is not None:
        contact.status = _check_status(payload.status)
    if payload.notes is not None:
        contact.notes = payload.notes
    db.commit()
    db.refresh(contact)
    return _out(contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return None
