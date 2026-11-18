"""Nest Business Intelligence — dentro de Negocio > Marketing
(NEST 2026-11-17).

Paraguas: /api/business/marketing/bi (plan conjunto §3.4). TODO
`require_admin`: el BI es solo admin; el cliente tiene su
`/portal/resumen` con solo sus datos.

Definiciones (D10):
- ventas = Σ facturas PAGADAS; `enviada` se muestra aparte,
  `borrador` excluida. Total por factura =
  Σ qty*unit_price*(1+tax/100), calculado en Python con `Decimal`
  (los items viven en JSON; nunca float para el dinero).
- rentabilidad = total_pagado − total_costos. Sin costos registrados
  en el periodo -> `rentabilidad: null` + `costos_sin_datos: true`
  (nunca rentabilidad = ventas).
- Sin datos: ceros y objetos vacíos, nunca nulls ni estimaciones
  (salvo la rentabilidad sin costos, que es "sin datos", no cero).
"""
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.security import require_admin
from app.database import get_db
from app.models.tables import (
    BusinessCost,
    Contact,
    Invoice,
    MarketingCampaign,
    ReferralCampaign,
    User,
)

router = APIRouter(prefix="/api/business/marketing/bi", tags=["bi-nest"])

COST_CATEGORIES = ("publicidad", "herramientas", "servicios", "otro")
INVOICE_STATUSES = ("borrador", "enviada", "pagada")


# ------------------------------------------------------------------ helpers --

def _iso(value: dt.datetime | None) -> str | None:
    """ISO con offset: SQLite devuelve datetimes naive al leer; se
    asumen UTC (todo se guarda en UTC). En Postgres el offset ya viene."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _invoice_total(inv: Invoice) -> Decimal:
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


def _parse_range(from_day: str | None, to_day: str | None, max_days: int):
    """from/to obligatorios (YYYY-MM-DD), máx. max_days. Devuelve
    (start_utc, end_exclusive_utc)."""
    if not from_day or not to_day:
        raise HTTPException(
            status_code=422, detail="from and to are required (YYYY-MM-DD)"
        )
    try:
        start_day = dt.date.fromisoformat(from_day.strip())
        end_day = dt.date.fromisoformat(to_day.strip())
    except ValueError:
        raise HTTPException(
            status_code=422, detail="from/to must be YYYY-MM-DD"
        ) from None
    if end_day < start_day:
        raise HTTPException(status_code=422, detail="to must be on or after from")
    if (end_day - start_day).days > max_days:
        raise HTTPException(
            status_code=422, detail=f"date range must be at most {max_days} days"
        )
    start = dt.datetime.combine(start_day, dt.time.min, tzinfo=dt.timezone.utc)
    end = dt.datetime.combine(
        end_day + dt.timedelta(days=1), dt.time.min, tzinfo=dt.timezone.utc
    )
    return start, end


def _as_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _cost_out(c: BusinessCost) -> dict:
    return {
        "id": c.id,
        "date": c.date.isoformat() if c.date else None,
        "category": c.category,
        "concept": c.concept,
        "amount": float(c.amount or Decimal("0")),
        "notes": c.notes or "",
        "created_by_user_id": c.created_by_user_id,
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


# ------------------------------------------------------------------ schemas --

class CostCreate(BaseModel):
    date: dt.date
    category: str = "otro"
    concept: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(ge=0)
    notes: str = Field(default="", max_length=5000)


class CostUpdate(BaseModel):
    date: dt.date | None = None
    category: str | None = None
    concept: str | None = Field(default=None, min_length=1, max_length=200)
    amount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=5000)


# ------------------------------------------------------------------ resumen --

@router.get("/resumen")
def bi_summary(
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    start, end = _parse_range(from_day, to_day, 366)
    invoices = (
        db.query(Invoice)
        .filter(Invoice.created_at >= start, Invoice.created_at < end)
        .all()
    )
    por_estado = {"borrador": 0, "enviada": 0, "pagada": 0}
    total_pagado = Decimal("0")
    total_enviado = Decimal("0")
    for inv in invoices:
        if inv.status in por_estado:
            por_estado[inv.status] += 1
        if inv.status == "pagada":
            total_pagado += _invoice_total(inv)
        elif inv.status == "enviada":
            total_enviado += _invoice_total(inv)
    costs = (
        db.query(BusinessCost)
        .filter(BusinessCost.date >= start.date(), BusinessCost.date < end.date())
        .all()
    )
    total_costos = sum((c.amount or Decimal("0") for c in costs), Decimal("0"))
    por_categoria: dict[str, float] = {}
    for c in costs:
        por_categoria[c.category] = por_categoria.get(c.category, 0.0) + float(
            c.amount or Decimal("0")
        )
    costos_sin_datos = len(costs) == 0
    rentabilidad = None
    if not costos_sin_datos:
        rentabilidad = float((total_pagado - total_costos).quantize(Decimal("0.01")))
    contacts = db.query(Contact).all()
    por_status: dict[str, int] = {}
    nuevos = 0
    for ct in contacts:
        por_status[ct.status] = por_status.get(ct.status, 0) + 1
        if ct.created_at is not None and start <= _as_utc(ct.created_at) < end:
            nuevos += 1
    campanas_activas = (
        db.query(MarketingCampaign)
        .filter(MarketingCampaign.status == "activa").count()
    )
    gasto_total = sum(
        (c.spend or Decimal("0") for c in db.query(MarketingCampaign).all()),
        Decimal("0"),
    )
    referidos_activos = (
        db.query(ReferralCampaign)
        .filter(ReferralCampaign.status == "active").count()
    )
    return {
        "ventas": {
            "total_pagado": float(total_pagado),
            "total_enviado": float(total_enviado),
            "n_facturas": len(invoices),
            "por_estado": por_estado,
        },
        "costos": {
            "total": float(total_costos),
            "por_categoria": por_categoria,
        },
        "rentabilidad": rentabilidad,
        "costos_sin_datos": costos_sin_datos,
        "clientes": {
            "total": len(contacts),
            "nuevos_en_periodo": nuevos,
            "por_status": por_status,
        },
        "publicidad": {
            "campanas_activas": campanas_activas,
            "gasto_total": float(gasto_total),
            "referidos_activos": referidos_activos,
        },
    }


@router.get("/ventas")
def bi_sales_series(
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    contact_id: int | None = Query(default=None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    start, end = _parse_range(from_day, to_day, 366)
    query = db.query(Invoice).filter(
        Invoice.created_at >= start,
        Invoice.created_at < end,
        Invoice.status == "pagada",
    )
    if contact_id is not None:
        query = query.filter(Invoice.contact_id == contact_id)
    # Meses del periodo, con cero si no hubo ventas (serie completa).
    months: list[str] = []
    cursor = dt.date(start.year, start.month, 1)
    last = dt.date(end.year, end.month, 1) - dt.timedelta(days=1)
    last = dt.date(last.year, last.month, 1)
    while cursor <= last:
        months.append(cursor.strftime("%Y-%m"))
        cursor = dt.date(
            cursor.year + (1 if cursor.month == 12 else 0),
            1 if cursor.month == 12 else cursor.month + 1,
            1,
        )
    totals: dict[str, Decimal] = {m: Decimal("0") for m in months}
    counts: dict[str, int] = {m: 0 for m in months}
    for inv in query.all():
        mes = _as_utc(inv.created_at).strftime("%Y-%m")
        if mes in totals:
            totals[mes] += _invoice_total(inv)
            counts[mes] += 1
    return [
        {"mes": m, "total_pagado": float(totals[m]), "n_facturas": counts[m]}
        for m in months
    ]


@router.get("/clientes")
def bi_clients(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    contacts = db.query(Contact).all()
    por_status: dict[str, int] = {}
    for ct in contacts:
        por_status[ct.status] = por_status.get(ct.status, 0) + 1
    totals: dict[int, Decimal] = {}
    for inv in (
        db.query(Invoice).filter(Invoice.status == "pagada").all()
    ):
        if inv.contact_id is None:
            continue
        totals[inv.contact_id] = totals.get(inv.contact_id, Decimal("0")) + (
            _invoice_total(inv)
        )
    names = {ct.id: ct.name for ct in contacts}
    top = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:10]
    return {
        "por_status": por_status,
        "top_por_total_pagado": [
            {
                "contact_id": cid,
                "name": names.get(cid, ""),
                "total_pagado": float(total),
            }
            for cid, total in top
        ],
    }


# ------------------------------------------------------------------- costos --

@router.get("/costos")
def list_costs(
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    category: str | None = Query(default=None),
    admin: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(BusinessCost)
    if from_day:
        try:
            start_day = dt.date.fromisoformat(from_day.strip())
        except ValueError:
            raise HTTPException(
                status_code=422, detail="from must be YYYY-MM-DD"
            ) from None
        query = query.filter(BusinessCost.date >= start_day)
    if to_day:
        try:
            end_day = dt.date.fromisoformat(to_day.strip())
        except ValueError:
            raise HTTPException(
                status_code=422, detail="to must be YYYY-MM-DD"
            ) from None
        query = query.filter(BusinessCost.date <= end_day)
    if category:
        if category.strip().lower() not in COST_CATEGORIES:
            raise HTTPException(
                status_code=422,
                detail=f"category must be one of: {', '.join(COST_CATEGORIES)}",
            )
        query = query.filter(BusinessCost.category == category.strip().lower())
    rows = (
        query.order_by(BusinessCost.date.desc(), BusinessCost.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_cost_out(c) for c in rows]


@router.post("/costos", status_code=status.HTTP_201_CREATED)
def create_cost(
    payload: CostCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    category = payload.category.strip().lower()
    if category not in COST_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"category must be one of: {', '.join(COST_CATEGORIES)}",
        )
    cost = BusinessCost(
        date=payload.date,
        category=category,
        concept=payload.concept.strip(),
        amount=payload.amount,
        notes=payload.notes,
        created_by_user_id=admin.id,
    )
    db.add(cost)
    db.flush()
    audit(db, admin, "bi.costos.create", "business_cost", str(cost.id),
          details={"concept": cost.concept, "amount": str(cost.amount)})
    db.refresh(cost)
    return _cost_out(cost)


@router.put("/costos/{cost_id}")
def update_cost(
    cost_id: int,
    payload: CostUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cost = db.get(BusinessCost, cost_id)
    if cost is None:
        raise HTTPException(status_code=404, detail="Cost not found")
    if payload.date is not None:
        cost.date = payload.date
    if payload.category is not None:
        category = payload.category.strip().lower()
        if category not in COST_CATEGORIES:
            raise HTTPException(
                status_code=422,
                detail=f"category must be one of: {', '.join(COST_CATEGORIES)}",
            )
        cost.category = category
    if payload.concept is not None:
        cost.concept = payload.concept.strip()
    if payload.amount is not None:
        cost.amount = payload.amount
    if payload.notes is not None:
        cost.notes = payload.notes
    db.flush()
    audit(db, admin, "bi.costos.update", "business_cost", str(cost.id),
          details={"concept": cost.concept})
    db.refresh(cost)
    return _cost_out(cost)


@router.delete("/costos/{cost_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cost(
    cost_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cost = db.get(BusinessCost, cost_id)
    if cost is None:
        raise HTTPException(status_code=404, detail="Cost not found")
    audit(db, admin, "bi.costos.delete", "business_cost", str(cost.id),
          details={"concept": cost.concept})
    db.delete(cost)
    db.commit()
    return None
