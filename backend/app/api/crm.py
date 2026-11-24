"""CRM contacts — Grow Business Platform, Fase 1.

The CRM is the connective tissue between modules (Estudiar / Invertir /
Crear): leads and customers from the Academy, Cohley brand work, RIV Goods
and manual entry live in one list.

Permissions follow the platform RBAC:
- any authenticated user (admin or "prueba") can READ contacts;
- only admins can create, update or delete (require_admin -> 403 for prueba).
"""
import datetime as dt
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.portal import deny_linked_reader
from app.core.security import get_current_user, require_admin
from app.core.perfiles import require_modulo
from app.database import get_db
from app.models.tables import Appointment, Contact, Invoice, User

# Zona horaria del usuario (America/Los_Angeles): "hoy" y "esta semana" se
# calculan aquí; la foto de referencia usa Miami como ejemplo y NO se copia.
CRM_TZ = ZoneInfo("America/Los_Angeles")

router = APIRouter(prefix="/api/crm/contacts", tags=["crm"], dependencies=[Depends(require_modulo("crm"))])

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
    notes: str = Field(default="", max_length=5000)


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    source: str | None = None
    tags: list[str] | None = None
    status: str | None = None
    notes: str | None = Field(default=None, max_length=5000)


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


# ---------------------------------------------------------------------------
# Resumen del CRM (Fase 3, rediseño estilo Vivero — estructura, no contenido).
# Solo datos reales: contactos, citas y facturas. Sin telefonía, envíos,
# pasarela ni agentes en línea: la plataforma no tiene esas fuentes, así que
# no aparecen aquí (ver informe de la corrida). Sin cambio de esquema.
# ---------------------------------------------------------------------------

# Etiquetas cortas de día de semana (es), para la gráfica semanal.
_DIA_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


class ResumenPaso(BaseModel):
    clave: str
    numero: int
    total: int
    hoy: int
    serie_7d: list[int]
    sub: str
    vacio: str


class ResumenLeyenda(BaseModel):
    estado: str
    total: int


class ResumenDinero(BaseModel):
    cantidad: int
    total: float


class ResumenDiaVenta(BaseModel):
    fecha: str
    etiqueta: str
    total: float
    cantidad: int


class ResumenMetricas(BaseModel):
    contactos_nuevos_hoy: int
    citas_hoy: int
    ventas_hoy: ResumenDinero
    ventas_semana: ResumenDinero
    por_cobrar: ResumenDinero
    clientes: int


class CrmResumen(BaseModel):
    fecha: str
    zona_horaria: str
    pasos: list[ResumenPaso]
    leyenda: list[ResumenLeyenda]
    metricas: ResumenMetricas
    ventas_semana_dias: list[ResumenDiaVenta]
    nota_ventas: str


def _invoice_total(inv: Invoice) -> Decimal:
    """Total de una factura desde sus líneas + impuesto (mismo cálculo que
    `invoiceTotals` del frontend: subtotal + subtotal * tasa / 100)."""
    subtotal = Decimal("0")
    for it in inv.items or []:
        try:
            qty = Decimal(str(it.get("qty", 0)))
            price = Decimal(str(it.get("unit_price", 0)))
        except (ValueError, TypeError, AttributeError):
            continue
        subtotal += qty * price
    tax = subtotal * (Decimal(str(inv.tax_rate or 0)) / Decimal("100"))
    return (subtotal + tax).quantize(Decimal("0.01"))


def _day_window_utc(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """[inicio, fin) del día en America/Los_Angeles, expresado en UTC."""
    start = dt.datetime.combine(day, dt.time.min, tzinfo=CRM_TZ)
    end = start + dt.timedelta(days=1)
    return start.astimezone(dt.timezone.utc), end.astimezone(dt.timezone.utc)


def _pt_date(moment: dt.datetime) -> dt.date:
    aware = moment if moment.tzinfo is not None else moment.replace(tzinfo=dt.timezone.utc)
    return aware.astimezone(CRM_TZ).date()


@router.get("/resumen", response_model=CrmResumen)
def crm_resumen(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # S1: cliente vinculado -> 403, igual que el resto de rutas del CRM
    # (además del gate require_modulo("crm") del router, que ya deja fuera
    # a prueba y a clientes: el resumen nunca muestra datos demo).
    deny_linked_reader(db, user)
    today = dt.datetime.now(CRM_TZ).date()
    days_7 = [today - dt.timedelta(days=i) for i in range(6, -1, -1)]
    start_7d_utc, _ = _day_window_utc(days_7[0])
    today_start_utc, today_end_utc = _day_window_utc(today)
    monday = today - dt.timedelta(days=today.weekday())
    week_days = [monday + dt.timedelta(days=i) for i in range((today - monday).days + 1)]

    # Contactos por estado (totales del embudo) y por día de creación.
    status_counts = {
        row[0]: int(row[1])
        for row in db.query(Contact.status, func.count(Contact.id))
        .group_by(Contact.status)
        .all()
    }
    created_per_day = {d: 0 for d in days_7}
    created_today = 0
    for (created_at,) in (
        db.query(Contact.created_at)
        .filter(Contact.created_at >= start_7d_utc)
        .all()
    ):
        if created_at is None:
            continue
        d = _pt_date(created_at)
        if d in created_per_day:
            created_per_day[d] += 1
        if d == today:
            created_today += 1
    updated_today_by_status: dict[str, int] = {}
    for (upd_status, upd_at) in (
        db.query(Contact.status, Contact.updated_at)
        .filter(Contact.updated_at >= today_start_utc, Contact.updated_at < today_end_utc)
        .all()
    ):
        updated_today_by_status[upd_status] = updated_today_by_status.get(upd_status, 0) + 1

    # Citas: las de hoy (pendiente/confirmada) y serie de 7 días
    # (citas que empiezan cada día, sin canceladas).
    appts_today = (
        db.query(Appointment)
        .filter(
            Appointment.starts_at >= today_start_utc,
            Appointment.starts_at < today_end_utc,
            Appointment.status.in_(("pendiente", "confirmada")),
        )
        .all()
    )
    confirmed_today = sum(1 for a in appts_today if a.status == "confirmada")
    appts_per_day = {d: 0 for d in days_7}
    for (starts_at,) in (
        db.query(Appointment.starts_at)
        .filter(Appointment.starts_at >= start_7d_utc, Appointment.status != "cancelada")
        .all()
    ):
        if starts_at is None:
            continue
        d = _pt_date(starts_at)
        if d in appts_per_day:
            appts_per_day[d] += 1

    # Facturas: totales por día de CREACIÓN (la plataforma no registra
    # fecha de pago: Invoice no tiene paid_at/updated_at). Ventas =
    # facturas `pagada`; por cobrar = facturas `enviada`.
    invoices = db.query(Invoice).filter(Invoice.created_at >= start_7d_utc).all()
    # Por cobrar: solo facturas `enviada` (el borrador aún no se envió),
    # sin límite de fecha — una enviada de hace meses sigue por cobrar.
    pending_invoices = db.query(Invoice).filter(Invoice.status == "enviada").all()
    paid_by_day: dict[dt.date, ResumenDinero] = {}
    paid_today = ResumenDinero(cantidad=0, total=0.0)
    paid_week = ResumenDinero(cantidad=0, total=0.0)
    pending_total = Decimal("0")
    pending_count = 0
    for inv in pending_invoices:
        pending_count += 1
        pending_total += _invoice_total(inv)
    for inv in invoices:
        if inv.status != "pagada" or inv.created_at is None:
            continue
        total = _invoice_total(inv)
        d = _pt_date(inv.created_at)
        bucket = paid_by_day.setdefault(d, ResumenDinero(cantidad=0, total=0.0))
        bucket.cantidad += 1
        bucket.total = round(bucket.total + float(total), 2)
        if d == today:
            paid_today.cantidad += 1
            paid_today.total = round(paid_today.total + float(total), 2)
        if d in week_days:
            paid_week.cantidad += 1
            paid_week.total = round(paid_week.total + float(total), 2)
    ventas_semana_dias = [
        ResumenDiaVenta(
            fecha=d.isoformat(),
            etiqueta="Hoy" if d == today else _DIA_CORTO[d.weekday()],
            total=paid_by_day.get(d, ResumenDinero(cantidad=0, total=0.0)).total,
            cantidad=paid_by_day.get(d, ResumenDinero(cantidad=0, total=0.0)).cantidad,
        )
        for d in week_days
    ]

    serie_contactos = [created_per_day[d] for d in days_7]
    serie_citas = [appts_per_day[d] for d in days_7]
    nuevos_total = status_counts.get("nuevo", 0)
    pasos = [
        ResumenPaso(
            clave="nuevos", numero=1, total=nuevos_total, hoy=created_today,
            serie_7d=serie_contactos,
            sub=f"{created_today} entraron hoy",
            vacio="Todavía nadie hoy",
        ),
        ResumenPaso(
            clave="gestion", numero=2, total=status_counts.get("contactado", 0),
            hoy=updated_today_by_status.get("contactado", 0),
            serie_7d=serie_contactos,
            sub=f"{updated_today_by_status.get('contactado', 0)} actualizados hoy",
            vacio="Todavía nadie en gestión",
        ),
        ResumenPaso(
            clave="seguimiento", numero=3, total=status_counts.get("interesado", 0),
            hoy=updated_today_by_status.get("interesado", 0),
            serie_7d=serie_contactos,
            sub=f"{updated_today_by_status.get('interesado', 0)} actualizados hoy",
            vacio="Todavía nadie en seguimiento",
        ),
        ResumenPaso(
            clave="citas", numero=4, total=len(appts_today), hoy=len(appts_today),
            serie_7d=serie_citas,
            sub=f"{confirmed_today} confirmadas",
            vacio="Ninguna cita más hoy",
        ),
    ]
    return CrmResumen(
        fecha=today.isoformat(),
        zona_horaria="America/Los_Angeles",
        pasos=pasos,
        leyenda=[
            ResumenLeyenda(estado=s, total=status_counts.get(s, 0)) for s in STATUSES
        ],
        metricas=ResumenMetricas(
            contactos_nuevos_hoy=created_today,
            citas_hoy=len(appts_today),
            ventas_hoy=paid_today,
            ventas_semana=paid_week,
            por_cobrar=ResumenDinero(cantidad=pending_count, total=float(pending_total)),
            clientes=status_counts.get("cliente", 0),
        ),
        ventas_semana_dias=ventas_semana_dias,
        nota_ventas=(
            "Las ventas se agrupan por fecha de creación de la factura pagada: "
            "la plataforma no registra fecha de pago."
        ),
    )


@router.get("", response_model=list[ContactOut])
def list_contacts(
    q: str | None = Query(default=None, description="Search by name or email"),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py).
    deny_linked_reader(db, user)
    query = db.query(Contact)
    if q and q.strip():
        # Escape LIKE wildcards (M10): a user's % or _ used to act as
        # wildcards and over-expose results. Backslash-escaped, with
        # SQLAlchemy's escape parameter (not string surgery).
        raw = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{raw}%"
        query = query.filter(
            or_(
                Contact.name.ilike(term, escape="\\"),
                Contact.email.ilike(term, escape="\\"),
            )
        )
    if status_filter:
        query = query.filter(Contact.status == _check_status(status_filter))
    return [_out(c) for c in query.order_by(Contact.id.desc()).offset(offset).limit(limit).all()]


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
    # NEST 2026-11-17: no borrar un contacto vinculado al portal ni
    # con citas futuras (el vínculo y la agenda lo necesitan vivo).
    # Desvincular primero (/portal/vinculos) y cancelar/reprogramar
    # las citas; el resto de hijos se comporta como antes.
    if contact.user_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Contact is linked to a portal user; unlink it first",
        )
    now = dt.datetime.now(dt.timezone.utc)
    future = (
        db.query(Appointment)
        .filter(
            Appointment.contact_id == contact.id,
            Appointment.status.in_(("pendiente", "confirmada")),
            Appointment.starts_at > now,
        )
        .first()
    )
    if future is not None:
        raise HTTPException(
            status_code=409,
            detail="Contact has future appointments; cancel them first",
        )
    db.delete(contact)
    db.commit()
    return None
