"""Contacto — mensajes del formulario público de /contacto.

Servicios + Calculadora (2026-11-25): /contacto hoy no tiene
formulario ni datos de contacto. Este router añade el buzón:

- POST /api/contacto/mensajes — PÚBLICO, sin auth y sin
  require_modulo (la página es pública). Validación con Pydantic
  (mensajes de error en español), rate limit 5/hora por IP y
  honeypot `website` (silent drop: 201 con id falso, sin guardar).
  NO se guarda la IP (PII).
- GET /api/contacto/mensajes — solo admin, lista paginada desc por id.
- PATCH /api/contacto/mensajes/{id} — solo admin, cambia el estado.
- DELETE /api/contacto/mensajes/{id} — solo admin, 204 (limpiar spam).

No hay envío de correo: no hay SMTP configurado (igual que Correos
v1). El admin lee y responde desde su propio inbox.
"""
import random

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.api.correos import _EMAIL_RE
from app.api.portal import deny_linked_reader
from app.core.rate_limit import contacto_limiter, too_many_requests
from app.core.security import require_admin
from app.database import get_db
from app.models.tables import ContactMessage, User, utcnow

router = APIRouter(prefix="/api/contacto", tags=["contacto"])

SERVICIOS = ("camisetas", "publicitario", "marketing", "otro")
ESTADOS = ("nuevo", "leído", "respondido")


class ContactMessageCreate(BaseModel):
    nombre: str
    email: str
    servicio: str
    mensaje: str
    website: str = ""

    @field_validator("nombre")
    @classmethod
    def _valid_nombre(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("nombre no puede estar vacío.")
        if len(v) > 100:
            raise ValueError("nombre no puede tener más de 100 caracteres.")
        return v

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("email no puede estar vacío.")
        if len(v) > 200:
            raise ValueError("email no puede tener más de 200 caracteres.")
        if not _EMAIL_RE.match(v):
            raise ValueError("email no tiene un formato válido.")
        return v

    @field_validator("servicio")
    @classmethod
    def _valid_servicio(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in SERVICIOS:
            raise ValueError(
                "servicio debe ser uno de: " + ", ".join(SERVICIOS) + "."
            )
        return v

    @field_validator("mensaje")
    @classmethod
    def _valid_mensaje(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("mensaje no puede estar vacío.")
        if len(v) > 2000:
            raise ValueError("mensaje no puede tener más de 2000 caracteres.")
        return v


class ContactMessageOut(BaseModel):
    id: int
    nombre: str
    email: str
    servicio: str
    mensaje: str
    estado: str
    created_at: str | None = None


class ContactMessageCreated(BaseModel):
    id: int
    created_at: str


class ContactMessageStatusUpdate(BaseModel):
    estado: str


def _msg_out(m: ContactMessage) -> ContactMessageOut:
    return ContactMessageOut(
        id=m.id,
        nombre=m.nombre,
        email=m.email,
        servicio=m.servicio,
        mensaje=m.mensaje,
        estado=m.estado,
        created_at=m.created_at.isoformat() if m.created_at else None,
    )


def _check_contacto_limit(request: Request) -> None:
    """Rate limit por IP: 5/hora. Se comprueba DESPUÉS de la
    validación Pydantic (un 422 no consume presupuesto) y ANTES del
    honeypot (un bot que rellena el campo también se frena)."""
    client_ip = request.client.host if request.client else "unknown"
    if not contacto_limiter.allow(f"contacto:{client_ip}"):
        raise too_many_requests(
            "Demasiados mensajes de contacto. Espera una hora.",
            contacto_limiter.window,
        )


@router.post(
    "/mensajes",
    response_model=ContactMessageCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_message(
    payload: ContactMessageCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    _check_contacto_limit(request)
    # Honeypot: el campo `website` no existe en el formulario real;
    # solo lo rellenan los bots. Silent drop: 201 con id falso, sin
    # guardar nada y sin revelar el truco.
    if (payload.website or "").strip():
        return ContactMessageCreated(
            id=random.randint(1_000_000, 9_999_999),
            created_at=utcnow().isoformat(),
        )
    row = ContactMessage(
        nombre=payload.nombre,
        email=payload.email,
        servicio=payload.servicio,
        mensaje=payload.mensaje,
        estado="nuevo",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ContactMessageCreated(
        id=row.id,
        created_at=row.created_at.isoformat() if row.created_at else utcnow().isoformat(),
    )


@router.get("/mensajes", response_model=list[ContactMessageOut])
def list_messages(
    admin: User = Depends(require_admin),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # S1 (2026-11-17): cliente vinculado -> 403 (ver portal.py);
    # para el admin es no-op, se mantiene por coherencia con correos.
    deny_linked_reader(db, admin)
    rows = (
        db.query(ContactMessage)
        .order_by(ContactMessage.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_msg_out(r) for r in rows]


@router.patch("/mensajes/{msg_id}", response_model=ContactMessageOut)
def update_message_status(
    msg_id: int,
    payload: ContactMessageStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.estado not in ESTADOS:
        raise HTTPException(
            status_code=422,
            detail="estado debe ser uno de: " + ", ".join(ESTADOS) + ".",
        )
    row = db.get(ContactMessage, msg_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")
    row.estado = payload.estado
    db.commit()
    db.refresh(row)
    return _msg_out(row)


@router.delete("/mensajes/{msg_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    msg_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    row = db.get(ContactMessage, msg_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")
    db.delete(row)
    db.commit()
    return None
