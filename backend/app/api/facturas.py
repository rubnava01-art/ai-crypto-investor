"""Facturas — invoice generator + materials calculator backend.

The calculator itself runs client-side; this API only persists the
invoices the admin creates (and their status). Items always come from
the admin's form — the system never invents amounts.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
v1 tracks invoices only; it does not charge cards or move money.
"""
from decimal import Decimal
import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.portal import deny_linked_reader
from app.core.security import get_current_user, require_admin
from app.core.perfiles import require_modulo
from app.database import get_db
from app.models.tables import Contact, Invoice, User

# Zona horaria del negocio (America/Los_Angeles): "vencida" se decide
# contra el hoy del negocio, igual que el panel "Hoy" (dashboard.py).
LA_TZ = ZoneInfo("America/Los_Angeles")
POR_VENCER_DIAS = 7

router = APIRouter(prefix="/api/facturas", tags=["facturas"], dependencies=[Depends(require_modulo("facturas"))])

STATUSES = ("borrador", "enviada", "pagada")
# Forward-only state machine (Fase 3, M18), mirroring referrals'
# pending -> confirmed -> rewarded: an invoice may advance (skips
# allowed: borrador -> pagada is a real flow, the tests use it) but
# NEVER go back (pagada -> borrador used to be accepted).
_STATUS_ORDER = {name: i for i, name in enumerate(STATUSES)}

# Tope de líneas por factura (M10): items venía sin tope.
MAX_INVOICE_ITEMS = 100


class InvoiceItem(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    qty: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class InvoiceOut(BaseModel):
    id: int
    number: str
    contact_id: int | None = None
    client_name: str
    client_email: str
    client_phone: str
    items: list[InvoiceItem]
    tax_rate: float
    status: str
    # Estado de cobro (Fase 5b mejoras-v1, tarea 2): DERIVADO, no
    # almacenado — "vencida" no es un estado del flujo (la máquina de
    # estados sigue siendo borrador -> enviada -> pagada, solo hacia
    # adelante). pagada: status pagada; vencida: enviada con
    # due_date <= hoy (hora de Los Ángeles, igual que "Hoy"); pendiente:
    # el resto (borrador, o enviada sin vencer). Coherente con la
    # clasificación de "Hoy" (vencidas / por vencer / por cobrar).
    estado_cobro: str
    # Fecha de vencimiento (Fase 4 mejoras-v1, tarea 7): ISO AAAA-MM-DD
    # o null cuando la factura no tiene fecha.
    due_date: str | None = None
    notes: str
    created_at: str | None = None


class InvoiceCreate(BaseModel):
    number: str = Field(default="", max_length=40)
    contact_id: int | None = None  # NEST: opcional, validado contra el CRM
    client_name: str = Field(min_length=1, max_length=200)
    client_email: str = Field(default="", max_length=200)
    client_phone: str = Field(default="", max_length=64)
    items: list[InvoiceItem] = Field(min_length=1, max_length=MAX_INVOICE_ITEMS)
    tax_rate: float = Field(default=0, ge=0, le=100)
    due_date: dt.date | None = None
    notes: str = Field(default="", max_length=5000)


class InvoiceStatusUpdate(BaseModel):
    # status es opcional desde el fix H1 (Fase 4 mejoras-v1): el PATCH
    # también acepta due_date solo, para fijar o borrar la fecha de una
    # factura existente sin tocar su estado.
    status: str | None = None
    # Fecha de vencimiento opcional: solo se aplica si el campo viaja en
    # el payload (model_fields_set); así se puede BORRAR la fecha
    # enviando due_date=null, igual que en las tareas (business.py).
    due_date: dt.date | None = Field(default=None)


def _estado_cobro(inv: Invoice) -> str:
    if inv.status == "pagada":
        return "pagada"
    if inv.status == "enviada" and inv.due_date is not None:
        if inv.due_date <= dt.datetime.now(LA_TZ).date():
            return "vencida"
    return "pendiente"


def _inv_out(inv: Invoice) -> InvoiceOut:
    return InvoiceOut(
        id=inv.id,
        number=inv.number,
        contact_id=inv.contact_id,
        client_name=inv.client_name,
        client_email=inv.client_email or "",
        client_phone=inv.client_phone or "",
        items=[InvoiceItem(**it) for it in (inv.items or [])],
        tax_rate=float(inv.tax_rate),
        status=inv.status,
        estado_cobro=_estado_cobro(inv),
        due_date=inv.due_date.isoformat() if inv.due_date else None,
        notes=inv.notes or "",
        created_at=inv.created_at.isoformat() if inv.created_at else None,
    )


@router.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py).
    deny_linked_reader(db, user)
    rows = db.query(Invoice).order_by(Invoice.id.desc()).offset(offset).limit(limit).all()
    return [_inv_out(r) for r in rows]


@router.post("/invoices", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    number = payload.number.strip()
    if number:
        # Explicit numbers must be unique (M18; the migration adds the
        # DB constraint when no duplicates exist — the API check holds
        # regardless, so behavior never depends on migration outcome).
        if db.query(Invoice).filter(Invoice.number == number).first() is not None:
            raise HTTPException(status_code=409, detail="Invoice number already exists")
    else:
        # Autonumber: skip taken numbers instead of trusting the count
        # (the old INV-{count+1} raced with concurrent creates and with
        # deletions, which reuse numbers).
        count = db.query(Invoice).count()
        for attempt in range(count + 1, count + 101):
            candidate = f"INV-{attempt:03d}"
            if db.query(Invoice).filter(Invoice.number == candidate).first() is None:
                number = candidate
                break
        else:
            raise HTTPException(status_code=409, detail="Could not allocate an invoice number")
    # NEST: contact_id opcional, validado contra el CRM (404 si no existe).
    if payload.contact_id is not None and db.get(Contact, payload.contact_id) is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    row = Invoice(
        number=number,
        contact_id=payload.contact_id,
        client_name=payload.client_name.strip(),
        client_email=payload.client_email.strip(),
        client_phone=payload.client_phone.strip(),
        items=[it.model_dump() for it in payload.items],
        tax_rate=Decimal(str(payload.tax_rate)),
        status="borrador",
        due_date=payload.due_date,
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _inv_out(row)


@router.patch("/invoices/{inv_id}", response_model=InvoiceOut)
def update_invoice_status(
    inv_id: int,
    payload: InvoiceStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.status is not None and payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(STATUSES)}")
    row = db.get(Invoice, inv_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if payload.status is not None:
        if _STATUS_ORDER[payload.status] < _STATUS_ORDER[row.status]:
            raise HTTPException(
                status_code=422,
                detail=f"cannot move invoice from {row.status} to {payload.status}",
            )
        row.status = payload.status
    if "due_date" in payload.model_fields_set:
        row.due_date = payload.due_date
    db.commit()
    db.refresh(row)
    return _inv_out(row)


@router.delete("/invoices/{inv_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    inv_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Invoice, inv_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(row)
    db.commit()
    return None
