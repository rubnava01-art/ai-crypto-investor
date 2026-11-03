"""Facturas — invoice generator + materials calculator backend.

The calculator itself runs client-side; this API only persists the
invoices the admin creates (and their status). Items always come from
the admin's form — the system never invents amounts.

Permissions: any authenticated user reads; only admins write/delete
(require_admin -> 403 for prueba), mirroring the other modules.
v1 tracks invoices only; it does not charge cards or move money.
"""
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Invoice, User

router = APIRouter(prefix="/api/facturas", tags=["facturas"])

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
    client_name: str
    client_email: str
    client_phone: str
    items: list[InvoiceItem]
    tax_rate: float
    status: str
    notes: str
    created_at: str | None = None


class InvoiceCreate(BaseModel):
    number: str = Field(default="", max_length=40)
    client_name: str = Field(min_length=1, max_length=200)
    client_email: str = Field(default="", max_length=200)
    client_phone: str = Field(default="", max_length=64)
    items: list[InvoiceItem] = Field(min_length=1, max_length=MAX_INVOICE_ITEMS)
    tax_rate: float = Field(default=0, ge=0, le=100)
    notes: str = Field(default="", max_length=5000)


class InvoiceStatusUpdate(BaseModel):
    status: str


def _inv_out(inv: Invoice) -> InvoiceOut:
    return InvoiceOut(
        id=inv.id,
        number=inv.number,
        client_name=inv.client_name,
        client_email=inv.client_email or "",
        client_phone=inv.client_phone or "",
        items=[InvoiceItem(**it) for it in (inv.items or [])],
        tax_rate=float(inv.tax_rate),
        status=inv.status,
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
    row = Invoice(
        number=number,
        client_name=payload.client_name.strip(),
        client_email=payload.client_email.strip(),
        client_phone=payload.client_phone.strip(),
        items=[it.model_dump() for it in payload.items],
        tax_rate=Decimal(str(payload.tax_rate)),
        status="borrador",
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
    if payload.status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(STATUSES)}")
    row = db.get(Invoice, inv_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if _STATUS_ORDER[payload.status] < _STATUS_ORDER[row.status]:
        raise HTTPException(
            status_code=422,
            detail=f"cannot move invoice from {row.status} to {payload.status}",
        )
    row.status = payload.status
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
