"""Marketing + Citas — dentro de Negocio > Marketing (NEST 2026-11-17).

Paraguas: /api/business/marketing (plan conjunto §3.1). Listas vacías
al inicio; nunca se inventan datos.

Citas (`Appointment`):
- El propietario se deriva del TOKEN, nunca del body: un cliente del
  portal solo crea citas para su propio contacto vinculado (403 si el
  `contact_id` del body es distinto al suyo, 403 sin vínculo). El admin
  puede indicar `contact_id` (404 si no existe).
- `starts_at` ISO con zona horaria (se rechaza naive), futuro, y se
  guarda en UTC. Solape 409 solo por MISMO contacto (D11): no hay
  solape global porque no hay un "recurso" definido.
- Máquina forward-only: pendiente -> confirmada -> completada;
  cancelada terminal desde pendiente/confirmada; 422 en retroceso.
  Nunca reabrir completada/cancelada. Borrar (204) es admin-only;
  se prefiere cancelar antes que borrar.
- Rate limit 10/min por usuario en POST (M-2).

Campañas (`MarketingCampaign`): campañas de publicidad con canal,
presupuesto y gasto. Distintas de las campañas de referidos
(`ReferralCampaign`), que no se tocan.
"""
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.portal import linked_contact_for
from app.core.hardening import audit
from app.core.perfiles import require_modulo
from app.core.rate_limit import RateLimiter, too_many_requests
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import Appointment, Contact, MarketingCampaign, User

# Fase 0 (2026-11-23, mejoras óptimas, P0-1): el router entero exige
# el módulo "business" (Marketing vive bajo Negocio > Marketing; no
# hay clave "marketing" en MODULOS_TODOS). Prueba y cliente vinculado
# reciben 403 en todo el router, incluidas las listas D-01 y la
# creación de citas por POST /citas: el cliente vinculado usa el
# portal (/api/business/marketing/portal/*, router propio, sin este
# gate) para ver sus citas y campañas. Cambio de comportamiento
# deliberado (plan conjunto §Decisión Q1): la auto-reserva de citas
# por cliente vía este router queda cerrada hasta que exista un
# endpoint de reserva en el portal.
router = APIRouter(
    prefix="/api/business/marketing",
    tags=["marketing-nest"],
    dependencies=[Depends(require_modulo("business"))],
)

APPT_STATUSES = ("pendiente", "confirmada", "completada", "cancelada")
_APPT_ORDER = {"pendiente": 0, "confirmada": 1, "completada": 2}
CHANNELS = ("instagram", "threads", "facebook", "google", "otro")
CAMPAIGN_STATUSES = ("borrador", "activa", "pausada", "finalizada")

citas_limiter = RateLimiter(max_requests=10, window_seconds=60)


# ------------------------------------------------------------------ helpers --

def _iso(value: dt.datetime | None) -> str | None:
    """ISO con offset: SQLite devuelve datetimes naive al leer; se
    asumen UTC (todo se guarda en UTC). En Postgres el offset ya viene."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _check(value: str, allowed: tuple[str, ...], field: str) -> str:
    v = (value or "").strip().lower()
    if v not in allowed:
        raise HTTPException(
            status_code=422, detail=f"{field} must be one of: {', '.join(allowed)}"
        )
    return v


def _parse_day(value: str | None, field: str) -> dt.date | None:
    if value is None:
        return None
    try:
        return dt.date.fromisoformat(value.strip())
    except ValueError:
        raise HTTPException(
            status_code=422, detail=f"{field} must be YYYY-MM-DD"
        ) from None


def _day_bounds(from_day: dt.date | None, to_day: dt.date | None) -> tuple:
    start = (
        dt.datetime.combine(from_day, dt.time.min, tzinfo=dt.timezone.utc)
        if from_day
        else None
    )
    end = (
        dt.datetime.combine(
            to_day + dt.timedelta(days=1), dt.time.min, tzinfo=dt.timezone.utc
        )
        if to_day
        else None
    )
    return start, end


def _contact_or_404(db: Session, contact_id: int | None) -> Contact | None:
    if contact_id is None:
        return None
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


def _own_contact(db: Session, user: User) -> Contact | None:
    return db.query(Contact).filter(Contact.user_id == user.id).first()


def _overlaps(
    db: Session,
    contact_id: int,
    starts_at: dt.datetime,
    duration_min: int,
    exclude_id: int | None = None,
) -> bool:
    """True if another non-cancelled appointment of the SAME contact
    overlaps [starts_at, starts_at + duration)."""
    end = starts_at + dt.timedelta(minutes=duration_min)
    query = db.query(Appointment).filter(
        Appointment.contact_id == contact_id,
        Appointment.status != "cancelada",
    )
    if exclude_id is not None:
        query = query.filter(Appointment.id != exclude_id)
    for other in query.all():
        other_start = other.starts_at
        if other_start.tzinfo is None:
            other_start = other_start.replace(tzinfo=dt.timezone.utc)
        other_end = other_start + dt.timedelta(minutes=other.duration_min)
        if other_start < end and starts_at < other_end:
            return True
    return False


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
        "created_by_user_id": a.created_by_user_id,
        "created_at": _iso(a.created_at),
        "updated_at": _iso(a.updated_at),
    }


def _campaign_out(c: MarketingCampaign) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "channel": c.channel,
        "status": c.status,
        "budget": float(c.budget) if c.budget is not None else None,
        "spend": float(c.spend or Decimal("0")),
        "contact_id": c.contact_id,
        "starts_on": c.starts_on.isoformat() if c.starts_on else None,
        "ends_on": c.ends_on.isoformat() if c.ends_on else None,
        "notes": c.notes or "",
        "created_at": _iso(c.created_at),
        "updated_at": _iso(c.updated_at),
    }


# ------------------------------------------------------------------ schemas --

class AppointmentCreate(BaseModel):
    contact_id: int | None = None
    client_name: str = Field(default="", max_length=200)
    service_type: str = Field(min_length=1, max_length=128)
    starts_at: dt.datetime
    duration_min: int = Field(ge=15, le=480)
    notes: str = Field(default="", max_length=1000)

    @field_validator("starts_at")
    @classmethod
    def _require_tz(cls, v: dt.datetime) -> dt.datetime:
        if v.tzinfo is None:
            raise ValueError("starts_at must include a timezone offset")
        return v


class AppointmentUpdate(BaseModel):
    status: str | None = None
    contact_id: int | None = None
    client_name: str | None = Field(default=None, max_length=200)
    service_type: str | None = Field(default=None, min_length=1, max_length=128)
    starts_at: dt.datetime | None = None
    duration_min: int | None = Field(default=None, ge=15, le=480)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("starts_at")
    @classmethod
    def _require_tz(cls, v: dt.datetime | None) -> dt.datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("starts_at must include a timezone offset")
        return v


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    channel: str = "instagram"
    status: str = "borrador"
    budget: Decimal | None = Field(default=None, ge=0)
    spend: Decimal = Field(default=Decimal("0"), ge=0)
    contact_id: int | None = None
    starts_on: dt.date | None = None
    ends_on: dt.date | None = None
    notes: str = Field(default="", max_length=5000)


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    channel: str | None = None
    status: str | None = None
    budget: Decimal | None = Field(default=None, ge=0)
    spend: Decimal | None = Field(default=None, ge=0)
    contact_id: int | None = None
    starts_on: dt.date | None = None
    ends_on: dt.date | None = None
    notes: str | None = Field(default=None, max_length=5000)


# ------------------------------------------------------------------- citas --

@router.get("/citas")
def list_appointments(
    status_filter: str | None = Query(default=None, alias="status"),
    from_day: str | None = Query(default=None, alias="from"),
    to_day: str | None = Query(default=None, alias="to"),
    contact_id: int | None = Query(default=None),
    admin: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Appointment)
    if status_filter:
        query = query.filter(
            Appointment.status == _check(status_filter, APPT_STATUSES, "status")
        )
    if contact_id is not None:
        query = query.filter(Appointment.contact_id == contact_id)
    start, end = _day_bounds(
        _parse_day(from_day, "from"), _parse_day(to_day, "to")
    )
    if start is not None:
        query = query.filter(Appointment.starts_at >= start)
    if end is not None:
        query = query.filter(Appointment.starts_at < end)
    rows = (
        query.order_by(Appointment.starts_at.asc())
        .offset(offset).limit(limit).all()
    )
    return [_appt_out(a) for a in rows]


@router.post("/citas", status_code=status.HTTP_201_CREATED)
def create_appointment(
    payload: AppointmentCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not citas_limiter.allow(f"citas:{user.id}"):
        raise too_many_requests(
            "Demasiadas citas seguidas. Espera un minuto.", citas_limiter.window
        )
    now = dt.datetime.now(dt.timezone.utc)
    starts_at = payload.starts_at.astimezone(dt.timezone.utc)
    if starts_at <= now:
        raise HTTPException(status_code=422, detail="starts_at must be in the future")
    if user.is_admin:
        contact = _contact_or_404(db, payload.contact_id)
        contact_id = payload.contact_id
        client_name = payload.client_name.strip() or (contact.name if contact else "")
        if contact_id is None and not client_name:
            raise HTTPException(
                status_code=422,
                detail="client_name is required when no contact_id is given",
            )
    else:
        # Cliente: el contacto se deriva del token; el body no manda.
        own = _own_contact(db, user)
        if own is None:
            audit(db, user, "marketing.citas.denied", "appointment", "",
                  details={"reason": "no_linked_contact"})
            raise HTTPException(
                status_code=403, detail="Tu cuenta no está vinculada a un cliente."
            )
        if payload.contact_id is not None and payload.contact_id != own.id:
            audit(db, user, "marketing.citas.denied", "appointment", "",
                  details={"reason": "contact_id_mismatch",
                           "requested_contact_id": payload.contact_id})
            raise HTTPException(
                status_code=403, detail="No puedes crear citas para otro cliente."
            )
        contact_id = own.id
        client_name = own.name
    if contact_id is not None and _overlaps(
        db, contact_id, starts_at, payload.duration_min
    ):
        raise HTTPException(
            status_code=409,
            detail="Ya existe una cita de este cliente que se solapa con ese horario",
        )
    appt = Appointment(
        contact_id=contact_id,
        client_name=client_name,
        service_type=payload.service_type.strip(),
        starts_at=starts_at,
        duration_min=payload.duration_min,
        status="pendiente",
        notes=payload.notes,
        created_by_user_id=user.id,
    )
    db.add(appt)
    db.flush()
    audit(db, user, "marketing.citas.create", "appointment", str(appt.id),
          details={"contact_id": contact_id, "service_type": appt.service_type})
    db.refresh(appt)
    return _appt_out(appt)


@router.patch("/citas/{appt_id}")
def update_appointment(
    appt_id: int,
    payload: AppointmentUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    appt = db.get(Appointment, appt_id)
    if appt is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if payload.status is not None:
        target = _check(payload.status, APPT_STATUSES, "status")
        current = appt.status
        if current in ("completada", "cancelada"):
            raise HTTPException(
                status_code=422,
                detail=f"cannot move appointment from {current} to {target}",
            )
        if target == "cancelada":
            if current not in ("pendiente", "confirmada"):
                raise HTTPException(
                    status_code=422,
                    detail=f"cannot move appointment from {current} to {target}",
                )
        elif _APPT_ORDER[target] < _APPT_ORDER[current]:
            raise HTTPException(
                status_code=422,
                detail=f"cannot move appointment from {current} to {target}",
            )
        appt.status = target
    new_starts = appt.starts_at
    new_duration = appt.duration_min
    if payload.starts_at is not None:
        new_starts = payload.starts_at.astimezone(dt.timezone.utc)
        if new_starts <= dt.datetime.now(dt.timezone.utc):
            raise HTTPException(
                status_code=422, detail="starts_at must be in the future"
            )
    if payload.duration_min is not None:
        new_duration = payload.duration_min
    if payload.contact_id is not None:
        _contact_or_404(db, payload.contact_id)
        appt.contact_id = payload.contact_id
    if (
        payload.starts_at is not None or payload.duration_min is not None
        or payload.contact_id is not None
    ) and appt.contact_id is not None and appt.status != "cancelada":
        if _overlaps(
            db, appt.contact_id, new_starts, new_duration, exclude_id=appt.id
        ):
            raise HTTPException(
                status_code=409,
                detail="Ya existe una cita de este cliente que se solapa con ese horario",
            )
    appt.starts_at = new_starts
    appt.duration_min = new_duration
    if payload.client_name is not None:
        appt.client_name = payload.client_name.strip()
    if payload.service_type is not None:
        appt.service_type = payload.service_type.strip()
    if payload.notes is not None:
        appt.notes = payload.notes
    db.flush()
    audit(db, admin, "marketing.citas.update", "appointment", str(appt.id),
          details={"status": appt.status})
    db.refresh(appt)
    return _appt_out(appt)


@router.delete("/citas/{appt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_appointment(
    appt_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    appt = db.get(Appointment, appt_id)
    if appt is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    # Auditoría ANTES de borrar (después ya no hay fila que referenciar).
    audit(db, admin, "marketing.citas.delete", "appointment", str(appt.id),
          details={"contact_id": appt.contact_id, "status": appt.status})
    db.delete(appt)
    db.commit()
    return None


# --------------------------------------------------------------- campañas --

@router.get("/campanas")
def list_campaigns(
    status_filter: str | None = Query(default=None, alias="status"),
    channel: str | None = Query(default=None),
    contact_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(MarketingCampaign)
    if status_filter:
        query = query.filter(
            MarketingCampaign.status
            == _check(status_filter, CAMPAIGN_STATUSES, "status")
        )
    if channel:
        query = query.filter(
            MarketingCampaign.channel == _check(channel, CHANNELS, "channel")
        )
    # D-01 (2026-11-17): igual que en contenido — cliente vinculado
    # solo ve sus campañas y el `?contact_id=` se ignora para él; las
    # filas con contact_id NULL no las ve. Admin ve todo (con
    # ?contact_id= respetado); no-admin sin vínculo sin cambios (D3).
    own = linked_contact_for(db, user)
    if own is not None:
        query = query.filter(MarketingCampaign.contact_id == own.id)
    elif contact_id is not None:
        query = query.filter(MarketingCampaign.contact_id == contact_id)
    rows = (
        query.order_by(MarketingCampaign.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_campaign_out(c) for c in rows]


@router.post("/campanas", status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    channel = _check(payload.channel, CHANNELS, "channel")
    status_value = _check(payload.status, CAMPAIGN_STATUSES, "status")
    _contact_or_404(db, payload.contact_id)
    if (
        payload.starts_on is not None
        and payload.ends_on is not None
        and payload.ends_on < payload.starts_on
    ):
        raise HTTPException(
            status_code=422, detail="ends_on must be on or after starts_on"
        )
    campaign = MarketingCampaign(
        name=payload.name.strip(),
        channel=channel,
        status=status_value,
        budget=payload.budget,
        spend=payload.spend,
        contact_id=payload.contact_id,
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
        notes=payload.notes,
    )
    db.add(campaign)
    db.flush()
    audit(db, admin, "marketing.campanas.create", "marketing_campaign",
          str(campaign.id), details={"name": campaign.name})
    db.refresh(campaign)
    return _campaign_out(campaign)


@router.put("/campanas/{campaign_id}")
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    campaign = db.get(MarketingCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if payload.name is not None:
        campaign.name = payload.name.strip()
    if payload.channel is not None:
        campaign.channel = _check(payload.channel, CHANNELS, "channel")
    if payload.status is not None:
        campaign.status = _check(payload.status, CAMPAIGN_STATUSES, "status")
    if payload.budget is not None:
        campaign.budget = payload.budget
    if payload.spend is not None:
        campaign.spend = payload.spend
    if payload.contact_id is not None:
        _contact_or_404(db, payload.contact_id)
        campaign.contact_id = payload.contact_id
    if payload.starts_on is not None:
        campaign.starts_on = payload.starts_on
    if payload.ends_on is not None:
        campaign.ends_on = payload.ends_on
    if (
        campaign.starts_on is not None
        and campaign.ends_on is not None
        and campaign.ends_on < campaign.starts_on
    ):
        raise HTTPException(
            status_code=422, detail="ends_on must be on or after starts_on"
        )
    if payload.notes is not None:
        campaign.notes = payload.notes
    db.flush()
    audit(db, admin, "marketing.campanas.update", "marketing_campaign",
          str(campaign.id), details={"name": campaign.name})
    db.refresh(campaign)
    return _campaign_out(campaign)


@router.delete("/campanas/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    campaign = db.get(MarketingCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    audit(db, admin, "marketing.campanas.delete", "marketing_campaign",
          str(campaign.id), details={"name": campaign.name})
    db.delete(campaign)
    db.commit()
    return None
