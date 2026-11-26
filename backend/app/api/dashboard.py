"""Aggregate dashboard endpoint: one request instead of nine.

Returns the exact same payloads as the individual GET endpoints so the
frontend can load the whole dashboard in a single round trip (important on
free-tier hosting with cold starts). The individual endpoints remain the
canonical API; this is a read-only convenience composition of them.

Partial-failure tolerance: a single failing section degrades to null instead
of failing the whole dashboard with a 500 — the frontend renders that section
as unavailable and shows a warning, while the other eight sections still load.

Gating por perfil (corrección H1, QA 2026-11-23): este endpoint compone
llamando a los handlers directamente, sin pasar por los routers donde
vive `require_modulo("invertir")`, así que las secciones se gatean
AQUÍ con `modulos_para()` — un `None` significa "sin acceso", no un
fallo (el frontend lo renderiza como vacío, igual que una sección
caída). Reglas:

- Invertir (balances, performance, strategies, modes, operations,
  risk): solo si el perfil tiene el módulo "invertir".
- logs: solo admin (B6: eventos internos del sistema).
- system y signals: para cualquier autenticado — la landing (/) los
  usa y el chat demo (M1) permite señales a prueba.
"""
import datetime as dt
import logging
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import misc, portfolio, signals, system
from app.core.perfiles import modulos_para
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import Appointment, BusinessTask, CrmReminder, Contact, InventoryItem, Invoice, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _dump(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model  # plain dicts pass through


def _safe(name, fn):
    """Run one dashboard section; on failure log it and degrade to null."""
    try:
        return fn()
    except Exception:
        logger.exception("dashboard section %r failed, degrading to null", name)
        return None


@router.get("")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    modulos = modulos_para(user, db)
    tiene_invertir = "invertir" in modulos
    es_admin = bool(user.is_admin)
    return {
        # Fase 5 (2026-11-23): system_status necesita la sesión para
        # la última ingesta real — el dashboard ya la tiene y la pasa
        # (antes se llamaba sin db porque no la usaba).
        "system": _safe("system", lambda: _dump(system.system_status(user, db))),
        # Portfolio now computes from paper rows, so it needs the session
        # (Fase 3, M17) — the dashboard already holds one, pass it through.
        "balances": _safe("balances", lambda: _dump(portfolio.balances(user, db))) if tiene_invertir else None,
        "performance": _safe("performance", lambda: _dump(portfolio.performance(user, db))) if tiene_invertir else None,
        "signals": _safe("signals", lambda: _dump(signals.list_signals(user, db))),
        "strategies": _safe("strategies", lambda: [_dump(s) for s in misc.list_strategies(user, db)]) if tiene_invertir else None,
        "modes": _safe("modes", lambda: _dump(misc.get_modes(user))) if tiene_invertir else None,
        "operations": _safe("operations", lambda: _dump(misc.operations(user, db))) if tiene_invertir else None,
        "risk": _safe("risk", lambda: _dump(misc.risk_limits(user))) if tiene_invertir else None,
        "logs": _safe("logs", lambda: [_dump(e) for e in misc.logs(user, db)]) if es_admin else None,
    }


# ---------- "Hoy": lo urgente del día (Fase 4 mejoras-v1, tarea 7) ----------
# Una sola petición con lo urgente REAL del usuario, sacado de sus datos:
# tareas pendientes con fecha vencida o de hoy, facturas enviadas
# (vencidas / por vencer en 7 días / por cobrar sin fecha), stock bajo
# (mínimo > 0 y cantidad <= mínimo, la misma regla del módulo
# Inventario) y citas de hoy (pendientes o confirmadas). "Hoy" es el día
# en la zona horaria del negocio (America/Los_Angeles; lib/dates.ts en
# el frontend).
# Sin nada urgente, todas las listas llegan vacías y el frontend muestra
# el mensaje honesto "Nada urgente hoy" — nunca se inventa urgencia.
# Gating por perfil (igual que el dashboard): sin el módulo, la sección
# llega como [] (sin acceso), NO como null; null solo significa que esa
# sección falló (el frontend lo distingue del vacío).

LA_TZ = ZoneInfo("America/Los_Angeles")
POR_VENCER_DIAS = 7


class HoyTarea(BaseModel):
    id: int
    area: str
    title: str
    due_date: str | None = None
    href: str = "/business"


class HoyFactura(BaseModel):
    id: int
    number: str
    client_name: str
    due_date: str | None = None
    total: float
    href: str = "/facturas"


class HoyStock(BaseModel):
    id: int
    name: str
    quantity: int
    min_stock: int
    href: str = "/inventario"


class HoyCita(BaseModel):
    id: int
    client_name: str
    service_type: str
    starts_at: str
    href: str = "/business"


class HoyRecordatorio(BaseModel):
    id: int
    contact_name: str
    note: str
    remind_date: str | None = None
    href: str = "/crm"


class HoyOut(BaseModel):
    fecha: str
    tareas: list[HoyTarea] | None
    facturas_vencidas: list[HoyFactura] | None
    facturas_por_vencer: list[HoyFactura] | None
    facturas_por_cobrar: list[HoyFactura] | None
    stock_bajo: list[HoyStock] | None
    citas: list[HoyCita] | None
    # Recordatorios del CRM (Fase 5b mejoras-v1, tarea 1): no hechos
    # con fecha <= hoy (vencidos o de hoy). None solo si la sección
    # falló; [] es "ninguno", como el resto de secciones.
    recordatorios: list[HoyRecordatorio] | None = None


def _invoice_total(inv: Invoice) -> float:
    subtotal = 0.0
    for it in inv.items or []:
        try:
            subtotal += float(it.get("qty", 0)) * float(it.get("unit_price", 0))
        except (TypeError, ValueError, AttributeError):
            continue
    return round(subtotal * (1 + float(inv.tax_rate or 0) / 100), 2)


def _hoy_factura(inv: Invoice) -> HoyFactura:
    return HoyFactura(
        id=inv.id,
        number=inv.number,
        client_name=inv.client_name,
        due_date=inv.due_date.isoformat() if inv.due_date else None,
        total=_invoice_total(inv),
    )


@router.get("/hoy", response_model=HoyOut)
def hoy(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    modulos = modulos_para(user, db)
    today = dt.datetime.now(LA_TZ).date()
    day_start = dt.datetime.combine(today, dt.time.min, tzinfo=LA_TZ).astimezone(dt.timezone.utc)
    day_end = dt.datetime.combine(today, dt.time.max, tzinfo=LA_TZ).astimezone(dt.timezone.utc)

    def tareas():
        if "business" not in modulos:
            return []
        rows = (
            db.query(BusinessTask)
            .filter(
                BusinessTask.done.is_(False),
                BusinessTask.due_date.isnot(None),
                BusinessTask.due_date <= today,
            )
            .order_by(BusinessTask.due_date.asc(), BusinessTask.id.asc())
            .limit(50)
            .all()
        )
        return [
            HoyTarea(
                id=t.id,
                area=t.area,
                title=t.title,
                due_date=t.due_date.isoformat() if t.due_date else None,
            )
            for t in rows
        ]

    def facturas():
        if "facturas" not in modulos:
            return [], [], []
        rows = (
            db.query(Invoice)
            .filter(Invoice.status == "enviada")
            .order_by(Invoice.id.desc())
            .limit(100)
            .all()
        )
        vencidas, por_vencer, por_cobrar = [], [], []
        limite = today + dt.timedelta(days=POR_VENCER_DIAS)
        for inv in rows:
            out = _hoy_factura(inv)
            if inv.due_date is None:
                por_cobrar.append(out)
            elif inv.due_date <= today:
                vencidas.append(out)
            elif inv.due_date <= limite:
                por_vencer.append(out)
        return vencidas, por_vencer, por_cobrar

    def stock_bajo():
        if "inventario" not in modulos:
            return []
        # Misma regla que el módulo Inventario (_out): sin mínimo definido
        # (0) no hay alerta; con mínimo, cantidad <= mínimo es stock bajo.
        rows = (
            db.query(InventoryItem)
            .filter(InventoryItem.min_stock > 0, InventoryItem.quantity <= InventoryItem.min_stock)
            .order_by(InventoryItem.quantity.asc(), InventoryItem.id.asc())
            .limit(50)
            .all()
        )
        return [
            HoyStock(id=r.id, name=r.name, quantity=r.quantity, min_stock=r.min_stock)
            for r in rows
        ]

    def citas():
        if "business" not in modulos:
            return []
        rows = (
            db.query(Appointment)
            .filter(
                Appointment.status.in_(["pendiente", "confirmada"]),
                Appointment.starts_at >= day_start,
                Appointment.starts_at <= day_end,
            )
            .order_by(Appointment.starts_at.asc())
            .limit(50)
            .all()
        )
        return [
            HoyCita(
                id=c.id,
                client_name=c.client_name,
                service_type=c.service_type,
                starts_at=c.starts_at.isoformat() if c.starts_at else "",
            )
            for c in rows
        ]

    def recordatorios():
        if "crm" not in modulos:
            return []
        rows = (
            db.query(CrmReminder, Contact.name)
            .join(Contact, Contact.id == CrmReminder.contact_id)
            .filter(
                CrmReminder.done.is_(False),
                CrmReminder.remind_date <= today,
            )
            .order_by(CrmReminder.remind_date.asc(), CrmReminder.id.asc())
            .limit(50)
            .all()
        )
        return [
            HoyRecordatorio(
                id=r.id,
                contact_name=name or "",
                note=r.note or "",
                remind_date=r.remind_date.isoformat() if r.remind_date else None,
            )
            for r, name in rows
        ]

    # None (fallo) no se confunde con [] (vacío): el `or` enmascararía
    # un fallo como "sin facturas", y el frontend no podría avisar.
    fact = _safe("hoy-facturas", facturas)
    vencidas, por_vencer, por_cobrar = fact if fact is not None else (None, None, None)
    return HoyOut(
        fecha=today.isoformat(),
        tareas=_safe("hoy-tareas", tareas),
        facturas_vencidas=vencidas,
        facturas_por_vencer=por_vencer,
        facturas_por_cobrar=por_cobrar,
        stock_bajo=_safe("hoy-stock", stock_bajo),
        citas=_safe("hoy-citas", citas),
        recordatorios=_safe("hoy-recordatorios", recordatorios),
    )
