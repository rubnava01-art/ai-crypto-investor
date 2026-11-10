"""Correos — email templates + email activity log (HubSpot-style).

Two pieces, both admin-written:
1. Plantillas: reusable emails with personalization tokens
   ({{nombre}}, {{negocio}}, {{telefono}}, {{email}}) replaced at
   compose time from the CRM contact.
2. Registro: the per-contact email timeline. v1 does NOT send mail
   from the server (no SMTP configured): the composer produces a ready
   email + a Gmail compose link, the admin sends from his own inbox and
   marks the record enviado. Nothing here claims a send the server
   did not perform.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
"""
import re

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.rate_limit import correos_limiter
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Contact, EmailLog, EmailTemplate, User

router = APIRouter(prefix="/api/correos", tags=["correos"])

LOG_STATUSES = ("preparado", "enviado")

# M-2 (corrida 2026-11-10): formato de email cuando no está vacío.
# Regex simple (sin dependencia email-validator): local@domino.tld.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def _check_correos_limit(user: User) -> None:
    """M-1 (corrida 2026-11-10): limiter por USUARIO en Correos
    (30/min), mismo patrón que market/strategy/backtest."""
    if not correos_limiter.allow(f"correos:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas consultas de Correos. Espera un minuto.",
        )


class EmailTemplateOut(BaseModel):
    id: int
    name: str
    subject: str
    body: str
    created_at: str | None = None


class EmailTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=20000)


class EmailLogOut(BaseModel):
    id: int
    contact_id: int | None = None
    contact_name: str
    contact_email: str
    template_name: str
    subject: str
    body: str
    status: str
    created_at: str | None = None


class EmailLogCreate(BaseModel):
    contact_id: int | None = None
    contact_name: str = Field(min_length=1, max_length=200)
    contact_email: str = Field(default="", max_length=200)
    template_name: str = Field(default="", max_length=200)
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=20000)

    @field_validator("contact_email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        # M-2: formato válido cuando no está vacío (vacío = sin email).
        v = (v or "").strip()
        if v and not _EMAIL_RE.match(v):
            raise ValueError("contact_email no tiene un formato de email válido.")
        return v

    @field_validator("subject", "body")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        # M-2: asunto y cuerpo no vacíos, igual que exige el frontend.
        if not (v or "").strip():
            raise ValueError("no puede estar vacío.")
        return v


class EmailLogStatusUpdate(BaseModel):
    status: str


def _tpl_out(t: EmailTemplate) -> EmailTemplateOut:
    return EmailTemplateOut(
        id=t.id,
        name=t.name,
        subject=t.subject or "",
        body=t.body or "",
        created_at=t.created_at.isoformat() if t.created_at else None,
    )


def _log_out(r: EmailLog) -> EmailLogOut:
    return EmailLogOut(
        id=r.id,
        contact_id=r.contact_id,
        contact_name=r.contact_name,
        contact_email=r.contact_email or "",
        template_name=r.template_name or "",
        subject=r.subject or "",
        body=r.body or "",
        status=r.status,
        created_at=r.created_at.isoformat() if r.created_at else None,
    )


# ------------------------------------------------------------- templates --

@router.get("/templates", response_model=list[EmailTemplateOut])
def list_templates(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    _check_correos_limit(user)
    rows = db.query(EmailTemplate).order_by(EmailTemplate.id.desc()).offset(offset).limit(limit).all()
    return [_tpl_out(r) for r in rows]


@router.post("/templates", response_model=EmailTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: EmailTemplateCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_correos_limit(admin)
    row = EmailTemplate(
        name=payload.name.strip(), subject=payload.subject, body=payload.body
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _tpl_out(row)


@router.delete("/templates/{tpl_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    tpl_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_correos_limit(admin)
    row = db.get(EmailTemplate, tpl_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(row)
    db.commit()
    return None


# ------------------------------------------------------------------ logs --

@router.get("/logs", response_model=list[EmailLogOut])
def list_logs(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    _check_correos_limit(user)
    rows = db.query(EmailLog).order_by(EmailLog.id.desc()).offset(offset).limit(limit).all()
    return [_log_out(r) for r in rows]


@router.post("/logs", response_model=EmailLogOut, status_code=status.HTTP_201_CREATED)
def create_log(
    payload: EmailLogCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_correos_limit(admin)
    # M-2: contact_id debe existir cuando no es null (sin FK en la
    # tabla, se verifica aquí para no dejar logs huérfanos).
    if payload.contact_id is not None and db.get(Contact, payload.contact_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="contact_id no corresponde a ningún contacto.",
        )
    row = EmailLog(
        contact_id=payload.contact_id,
        contact_name=payload.contact_name.strip(),
        contact_email=payload.contact_email.strip(),
        template_name=payload.template_name.strip(),
        subject=payload.subject,
        body=payload.body,
        status="preparado",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _log_out(row)


@router.patch("/logs/{log_id}", response_model=EmailLogOut)
def update_log_status(
    log_id: int,
    payload: EmailLogStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_correos_limit(admin)
    if payload.status not in LOG_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(LOG_STATUSES)}")
    row = db.get(EmailLog, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email log not found")
    row.status = payload.status
    db.commit()
    db.refresh(row)
    return _log_out(row)


@router.delete("/logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _check_correos_limit(admin)
    row = db.get(EmailLog, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email log not found")
    db.delete(row)
    db.commit()
    return None
