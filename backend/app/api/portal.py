"""Nest Client Portal — dentro de Negocio > Marketing (NEST 2026-11-17).

Paraguas: /api/business/marketing/portal (plan conjunto §3.2, D4/D5).

Aislamiento (el control que evita fugas entre clientes):
- Dependencia `get_client_contact`: resuelve el Contact EN SERVIDOR.
  Admin -> 403 en rutas de datos salvo `?contact_id=` explícito
  (vista previa, auditada). No-admin con vínculo
  (`Contact.user_id == user.id`) -> su Contact. No-admin sin vínculo
  -> 403. El `contact_id` NUNCA viene del cliente en el body.
- Solo listas filtradas por el contacto resuelto; NO hay rutas de
  detalle `/{id}` en el portal (sin superficie IDOR que enumerar).
- Denegaciones auditadas (`portal.denied`).
"""
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import (
    Appointment,
    BrandBrief,
    Contact,
    DigitalProject,
    DigitalTask,
    Invoice,
    MarketingCampaign,
    ReferralCampaign,
    User,
)

router = APIRouter(prefix="/api/business/marketing/portal", tags=["portal-nest"])


def _iso(value: dt.datetime | None) -> str | None:
    """ISO con offset: SQLite devuelve datetimes naive al leer; se
    asumen UTC (todo se guarda en UTC). En Postgres el offset ya viene."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _invoice_total(inv: Invoice) -> Decimal:
    """Total de una factura: Σ qty*unit_price*(1+tax/100), con Decimal.
    Los items se guardan como JSON con floats: se convierten vía str
    para no arrastrar error binario."""
    subtotal = Decimal("0")
    for it in inv.items or []:
        try:
            qty = Decimal(str(it.get("qty", 0)))
            price = Decimal(str(it.get("unit_price", 0)))
        except Exception:
            continue
        subtotal += qty * price
    tax = Decimal(str(inv.tax_rate or 0))
    return (subtotal * (Decimal("1") + tax / Decimal("100"))).quantize(
        Decimal("0.01")
    )


def _deny(db: Session, user: User, reason: str, details: dict | None = None):
    audit(db, user, "portal.denied", "contact", "",
          details={"reason": reason, **(details or {})})
    raise HTTPException(
        status_code=403,
        detail="Tu cuenta no está vinculada a un cliente.",
    )


def get_client_contact(
    user: User = Depends(get_current_user),
    contact_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> Contact:
    """Resuelve el contacto del portal en servidor (ver docstring del
    módulo). El `?contact_id=` solo lo usa el admin para vista previa."""
    if user.is_admin:
        if contact_id is None:
            _deny(db, user, "admin_without_preview_contact")
        contact = db.get(Contact, contact_id)
        if contact is None:
            raise HTTPException(status_code=404, detail="Contact not found")
        audit(db, user, "portal.preview", "contact", str(contact.id),
              details={"contact_id": contact.id})
        return contact
    contact = linked_contact_for(db, user)
    if contact is None:
        _deny(db, user, "no_linked_contact")
    return contact


def linked_contact_for(db: Session, user: User) -> Contact | None:
    """Contacto vinculado a un usuario no-admin, o None.

    Reutilizable fuera del portal (D-01, 2026-11-17): las listas de
    marketing/contenido fuerzan `contact_id == contacto.id` cuando
    devuelve un contacto. Devuelve None para el admin (ve todo) y
    para el no-admin sin vínculo (cuenta `prueba` del dueño: sus
    lecturas quedan como hoy, por decisión D3 del plan). No deniega
    nada: el llamador decide qué hacer con None."""
    if user.is_admin:
        return None
    return db.query(Contact).filter(Contact.user_id == user.id).first()


def _appt_out(a: Appointment) -> dict:
    return {
        "id": a.id,
        "contact_id": a.contact_id,
        "client_name": a.client_name or "",
        "service_type": a.service_type,
        "starts_at": _iso(a.starts_at),
        "duration_min": a.duration_min,
        "status": a.status,
        "notes": a.notes or "",
    }


def _invoice_out(inv: Invoice) -> dict:
    return {
        "id": inv.id,
        "number": inv.number,
        "contact_id": inv.contact_id,
        "client_name": inv.client_name,
        "client_email": inv.client_email or "",
        "status": inv.status,
        "total": float(_invoice_total(inv)),
        "created_at": _iso(inv.created_at),
    }


# ------------------------------------------------------------------- datos --

@router.get("/me")
def portal_me(
    contact: Contact = Depends(get_client_contact),
):
    return {
        "contact": {
            "id": contact.id,
            "name": contact.name,
            "email": contact.email or "",
            "phone": contact.phone or "",
            "status": contact.status,
            "tags": list(contact.tags or []),
        }
    }


@router.get("/campanas")
def portal_campaigns(
    contact: Contact = Depends(get_client_contact),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    referidos = (
        db.query(ReferralCampaign)
        .filter(ReferralCampaign.business_contact_id == contact.id)
        .order_by(ReferralCampaign.id.desc())
        .offset(offset).limit(limit).all()
    )
    campanas = (
        db.query(MarketingCampaign)
        .filter(MarketingCampaign.contact_id == contact.id)
        .order_by(MarketingCampaign.id.desc())
        .offset(offset).limit(limit).all()
    )
    return {
        "referidos": [
            {
                "id": c.id,
                "name": c.name,
                "share_code": c.share_code,
                "status": c.status,
                "reward_type": c.reward_type,
                "reward_value": float(c.reward_value or Decimal("0")),
            }
            for c in referidos
        ],
        "campanas": [
            {
                "id": c.id,
                "name": c.name,
                "channel": c.channel,
                "status": c.status,
                "budget": float(c.budget) if c.budget is not None else None,
                "spend": float(c.spend or Decimal("0")),
                "starts_on": c.starts_on.isoformat() if c.starts_on else None,
                "ends_on": c.ends_on.isoformat() if c.ends_on else None,
            }
            for c in campanas
        ],
    }


@router.get("/facturas")
def portal_invoices(
    contact: Contact = Depends(get_client_contact),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Invoice)
        .filter(Invoice.contact_id == contact.id)
        .order_by(Invoice.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_invoice_out(r) for r in rows]


@router.get("/tareas")
def portal_tasks(
    contact: Contact = Depends(get_client_contact),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    project_ids = [
        p.id
        for p in db.query(DigitalProject)
        .filter(DigitalProject.contact_id == contact.id).all()
    ]
    projects = {
        p.id: p
        for p in db.query(DigitalProject)
        .filter(DigitalProject.id.in_(project_ids)).all()
    } if project_ids else {}
    tasks: list[dict] = []
    if project_ids:
        for t in (
            db.query(DigitalTask)
            .filter(DigitalTask.project_id.in_(project_ids))
            .order_by(DigitalTask.id.asc())
            .offset(offset).limit(limit).all()
        ):
            project = projects.get(t.project_id)
            tasks.append(
                {
                    "id": t.id,
                    "project_id": t.project_id,
                    "project_title": project.title if project else "",
                    "title": t.title,
                    "done": bool(t.done),
                    "created_at": _iso(t.created_at),
                }
            )
    now = dt.datetime.now(dt.timezone.utc)
    proximas = (
        db.query(Appointment)
        .filter(
            Appointment.contact_id == contact.id,
            Appointment.status.in_(("pendiente", "confirmada")),
            Appointment.starts_at >= now,
        )
        .order_by(Appointment.starts_at.asc())
        .limit(50).all()
    )
    return {"tareas": tasks, "proximas_citas": [_appt_out(a) for a in proximas]}


@router.get("/citas")
def portal_appointments(
    contact: Contact = Depends(get_client_contact),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Appointment)
        .filter(Appointment.contact_id == contact.id)
        .order_by(Appointment.starts_at.asc())
        .offset(offset).limit(limit).all()
    )
    return [_appt_out(a) for a in rows]


@router.get("/resumen")
def portal_summary(
    contact: Contact = Depends(get_client_contact),
    db: Session = Depends(get_db),
):
    invoices = (
        db.query(Invoice).filter(Invoice.contact_id == contact.id).all()
    )
    por_estado = {"borrador": 0, "enviada": 0, "pagada": 0}
    total_pagado = Decimal("0")
    for inv in invoices:
        if inv.status in por_estado:
            por_estado[inv.status] += 1
        if inv.status == "pagada":
            total_pagado += _invoice_total(inv)
    now = dt.datetime.now(dt.timezone.utc)
    citas_proximas = (
        db.query(Appointment)
        .filter(
            Appointment.contact_id == contact.id,
            Appointment.status.in_(("pendiente", "confirmada")),
            Appointment.starts_at >= now,
        )
        .count()
    )
    campanas_activas = (
        db.query(MarketingCampaign)
        .filter(
            MarketingCampaign.contact_id == contact.id,
            MarketingCampaign.status == "activa",
        )
        .count()
        + db.query(ReferralCampaign)
        .filter(
            ReferralCampaign.business_contact_id == contact.id,
            ReferralCampaign.status == "active",
        )
        .count()
    )
    proyectos_activos = (
        db.query(DigitalProject)
        .filter(
            DigitalProject.contact_id == contact.id,
            DigitalProject.stage != "entrega",
        )
        .count()
    )
    return {
        "facturas": {
            "por_estado": por_estado,
            "total_pagado": float(total_pagado),
        },
        "citas_proximas": citas_proximas,
        "campanas_activas": campanas_activas,
        "proyectos_activos": proyectos_activos,
    }


# ------------------------------------------------- gestión admin de vínculos --

# ------------------------------------------------------ brief de marca ----

BRIEF_FIELDS = ("q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8")


def count_brief_words(text: str) -> int:
    """Palabras de una respuesta (tokens separados por espacios)."""
    return len((text or "").split())


def brief_out(brief: BrandBrief | None, contact: Contact) -> dict:
    """Serializa el brief de un contacto; sin fila guardada, las 8
    respuestas son "" (el brief empieza vacío, nunca se inventa)."""
    answers = {
        f: (getattr(brief, f) or "") if brief is not None else ""
        for f in BRIEF_FIELDS
    }
    missing = [i + 1 for i, f in enumerate(BRIEF_FIELDS) if not answers[f].strip()]
    q2_words = count_brief_words(answers["q2"])
    return {
        "contact_id": contact.id,
        "contact_name": contact.name,
        "answers": answers,
        "answered": 8 - len(missing),
        "missing": missing,
        # Q2 pide 3 palabras: aviso, nunca bloqueo (el guardado no
        # depende de que sean exactamente 3).
        "q2_words": q2_words,
        "q2_warning": bool(answers["q2"].strip()) and q2_words != 3,
        "updated_at": _iso(brief.updated_at) if brief is not None else None,
    }


def upsert_brief(
    db: Session, contact: Contact, payload: "BriefUpdate"
) -> BrandBrief:
    """Crea la fila del brief si no existe y aplica solo las
    respuestas enviadas (guardado parcial por pregunta)."""
    brief = (
        db.query(BrandBrief)
        .filter(BrandBrief.contact_id == contact.id)
        .first()
    )
    if brief is None:
        brief = BrandBrief(contact_id=contact.id)
        db.add(brief)
    for f in BRIEF_FIELDS:
        value = getattr(payload, f)
        if value is not None:
            setattr(brief, f, value.strip())
    return brief


class BriefUpdate(BaseModel):
    q1: str | None = Field(default=None, max_length=5000)
    q2: str | None = Field(default=None, max_length=5000)
    q3: str | None = Field(default=None, max_length=5000)
    q4: str | None = Field(default=None, max_length=5000)
    q5: str | None = Field(default=None, max_length=5000)
    q6: str | None = Field(default=None, max_length=5000)
    q7: str | None = Field(default=None, max_length=5000)
    q8: str | None = Field(default=None, max_length=5000)


@router.get("/brief")
def portal_brief_get(
    contact: Contact = Depends(get_client_contact),
    db: Session = Depends(get_db),
):
    """Brief de marca del cliente vinculado (admin: vista previa con
    ?contact_id=). Sin fila guardada devuelve las 8 vacías."""
    brief = (
        db.query(BrandBrief)
        .filter(BrandBrief.contact_id == contact.id)
        .first()
    )
    return brief_out(brief, contact)


@router.put("/brief")
def portal_brief_put(
    payload: BriefUpdate,
    contact: Contact = Depends(get_client_contact),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Guarda (parcial o completo) el brief del cliente vinculado
    (admin: vista previa con ?contact_id=). Q2 con != 3 palabras
    avisa en la respuesta, nunca bloquea."""
    brief = upsert_brief(db, contact, payload)
    db.flush()
    audit(db, user, "portal.brief.update", "brand_brief", str(contact.id),
          details={"contact_id": contact.id})
    db.refresh(brief)
    return brief_out(brief, contact)


class VinculoCreate(BaseModel):
    user_id: int
    contact_id: int


@router.get("/vinculos")
def list_vinculos(
    admin: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Contact)
        .order_by(Contact.id.asc())
        .offset(offset).limit(limit).all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email or "",
            "user_id": c.user_id,
        }
        for c in rows
    ]


@router.post("/vinculos", status_code=status.HTTP_201_CREATED)
def create_vinculo(
    payload: VinculoCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    contact = db.get(Contact, payload.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.user_id is not None:
        raise HTTPException(
            status_code=409, detail="Contact is already linked to a user"
        )
    other = (
        db.query(Contact).filter(Contact.user_id == user.id).first()
    )
    if other is not None:
        raise HTTPException(
            status_code=409, detail="User is already linked to another contact"
        )
    contact.user_id = user.id
    db.flush()
    audit(db, admin, "portal.vinculos.create", "contact", str(contact.id),
          details={"user_id": user.id, "username": user.username})
    db.refresh(contact)
    return {
        "id": contact.id,
        "name": contact.name,
        "email": contact.email or "",
        "user_id": contact.user_id,
    }


@router.delete("/vinculos/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vinculo(
    contact_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    old_user_id = contact.user_id
    contact.user_id = None
    # Auditoría ANTES del commit final (el audit hace commit).
    audit(db, admin, "portal.vinculos.delete", "contact", str(contact.id),
          details={"unlinked_user_id": old_user_id})
    db.commit()
    return None
