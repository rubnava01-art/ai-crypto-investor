"""Mis datos: exportar y borrar los datos propios (Fase 2 mejoras-v1,
tarea 4).

- GET /api/mis-datos/exportar: descarga JSON con SOLO los datos del
  usuario que pide (perfil, contacto vinculado, citas creadas, mensajes
  de chat, búsquedas, explicaciones de IA, auditorías web, publicaciones
  de Inicio e inscripciones de su contacto vinculado). Los datos de
  negocio compartidos (contactos, facturas, inventario, notas de
  negocio) NO son datos personales del usuario: pertenecen al negocio y
  los ven todos los usuarios con acceso, así que no se incluyen en la
  exportación personal; el propio JSON lo explica en `alcance`.
- DELETE /api/mis-datos/cuenta: borra la propia cuenta con confirmación
  por contraseña. Protecciones: no borra la última cuenta super admin
  ni la última cuenta administradora (sin admin no habría quién apruebe
  cuentas), y no funciona desde sesión de invitado (get_current_user
  responde 403 al token guest:<uuid>: el invitado ni siquiera es un
  User). Tras borrar, el token deja de valer (la fila ya no existe).

Qué se borra y qué se conserva (mismo criterio que el borrado por
admin, DELETE /api/users/{id}, bug 2026-11-21): las filas personales
del usuario (mensajes, búsquedas, explicaciones, auditorías, tokens de
verificación, activación pendiente, conexiones de exchange y la
concesión de super admin) se BORRAN; las filas de negocio compartido
que lo referencian (contacto vinculado, citas, costes, posts y
comentarios de Inicio) se CONSERVAN con la referencia a NULL (autor
anónimo), y el historial de auditoría se conserva sin autor (la fila
de auditoría de este borrado guarda el usuario en entity_id y en
details, para que el hecho quede registrado aunque el user_id se
anonimice). La cuenta en sí (User) se borra.
"""

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.users import _detach_user_references
from app.core.hardening import audit
from app.core.rate_limit import login_limiter
from app.core.security import get_current_user, is_super_admin, verify_password
from app.database import get_db
from app.models.tables import (
    AIExplanation,
    Appointment,
    ChatMessage,
    Contact,
    CourseEnrollment,
    EmailVerification,
    ExchangeConnection,
    HomeComment,
    HomePost,
    PendingActivation,
    SuperAdminGrant,
    TrendSearch,
    User,
    WebAudit,
)

router = APIRouter(prefix="/api/mis-datos", tags=["mis-datos"])

ALCANCE = (
    "Exportación personal de Grow Business Platform: solo tus datos. "
    "Los datos de negocio compartidos (contactos, facturas, inventario y "
    "notas de negocio) pertenecen al negocio y no son datos personales "
    "tuyos, así que no se incluyen aquí."
)


def _jsonable(value):
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _row(obj) -> dict:
    return {c.name: _jsonable(getattr(obj, c.name)) for c in obj.__table__.columns}


def _profile_out(user: User, db: Session) -> dict:
    return {
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "email_verified": user.email_verified,
        "bio": user.bio,
        "location": user.location,
        "address": user.address,
        "business_handle": user.business_handle,
        "business_description": user.business_description,
        "skills": user.skills,
        "requested_plan": user.requested_plan,
        "is_admin": user.is_admin,
        "is_super_admin": is_super_admin(user, db),
        "terms_accepted_at": user.terms_accepted_at.isoformat() if user.terms_accepted_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.get("/exportar")
def export_my_data(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Descarga JSON con los datos propios del usuario (solo los suyos)."""
    contact = db.query(Contact).filter(Contact.user_id == user.id).first()
    enrollments = []
    if contact is not None:
        enrollments = [
            _row(e)
            for e in db.query(CourseEnrollment)
            .filter(CourseEnrollment.contact_id == contact.id)
            .order_by(CourseEnrollment.id)
            .all()
        ]
    data = {
        "plataforma": "Grow Business Platform",
        "exportado_en": dt.datetime.now(dt.timezone.utc).isoformat(),
        "usuario": user.username,
        "alcance": ALCANCE,
        "perfil": _profile_out(user, db),
        "contacto_vinculado": _row(contact) if contact is not None else None,
        "inscripciones_academia": enrollments,
        "citas_creadas": [
            _row(a)
            for a in db.query(Appointment)
            .filter(Appointment.created_by_user_id == user.id)
            .order_by(Appointment.id)
            .all()
        ],
        "mensajes_chat": [
            _row(m)
            for m in db.query(ChatMessage)
            .filter(ChatMessage.user_id == user.id)
            .order_by(ChatMessage.id)
            .all()
        ],
        "busquedas_tendencias": [
            _row(t)
            for t in db.query(TrendSearch)
            .filter(TrendSearch.user_id == user.id)
            .order_by(TrendSearch.id)
            .all()
        ],
        "explicaciones_ia": [
            _row(e)
            for e in db.query(AIExplanation)
            .filter(AIExplanation.user_id == user.id)
            .order_by(AIExplanation.id)
            .all()
        ],
        "auditorias_web": [
            _row(w)
            for w in db.query(WebAudit)
            .filter(WebAudit.user_id == user.id)
            .order_by(WebAudit.id)
            .all()
        ],
        "publicaciones_inicio": [
            _row(p)
            for p in db.query(HomePost)
            .filter(HomePost.author_id == user.id)
            .order_by(HomePost.id)
            .all()
        ],
        "comentarios_inicio": [
            _row(c)
            for c in db.query(HomeComment)
            .filter(HomeComment.author_id == user.id)
            .order_by(HomeComment.id)
            .all()
        ],
    }
    data["resumen"] = {
        key: (len(value) if isinstance(value, list) else (1 if value is not None else 0))
        for key, value in data.items()
        if key not in ("plataforma", "exportado_en", "usuario", "alcance", "perfil", "resumen")
    }
    filename = (
        f"mis-datos-{user.username}-"
        f"{dt.datetime.now(dt.timezone.utc).date().isoformat()}.json"
    )
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


@router.delete("/cuenta")
def delete_my_account(
    payload: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Borra la propia cuenta y sus datos personales (confirmación por
    contraseña). El token deja de valer: la fila ya no existe."""
    # B7 (patrón change-password): el mismo limitador de login, por
    # usuario, frena probar contraseñas sin freno con una sesión válida.
    if not login_limiter.allow(f"delete-account:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Espera un minuto.",
            headers={"Retry-After": "60"},
        )
    if not verify_password(payload.password, user.password_hash):
        audit(db, user, "mis_datos.delete_account_failed", "user",
              str(user.id), details={"username": user.username, "reason": "password"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La contraseña actual no es correcta.",
        )
    if is_super_admin(user, db):
        if db.query(SuperAdminGrant).count() <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se puede borrar la última cuenta super admin.",
            )
    if user.is_admin:
        admins = db.query(User).filter(User.is_admin.is_(True)).count()
        if admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se puede borrar la última cuenta administradora.",
            )
    # Auditoría ANTES de borrar (después ya no hay fila que referenciar):
    # el detach anonimiza su user_id, pero entity_id y details sobreviven.
    audit(db, user, "mis_datos.delete_account", "user", str(user.id),
          details={"username": user.username})
    # Filas personales: se BORRAN (son datos propios del usuario).
    db.query(ChatMessage).filter(ChatMessage.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(TrendSearch).filter(TrendSearch.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(AIExplanation).filter(AIExplanation.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(WebAudit).filter(WebAudit.user_id == user.id).delete(
        synchronize_session=False
    )
    db.query(EmailVerification).filter(
        EmailVerification.user_id == user.id
    ).delete(synchronize_session=False)
    db.query(PendingActivation).filter(
        PendingActivation.user_id == user.id
    ).delete(synchronize_session=False)
    db.query(ExchangeConnection).filter(
        ExchangeConnection.user_id == user.id
    ).delete(synchronize_session=False)
    db.query(SuperAdminGrant).filter(
        SuperAdminGrant.user_id == user.id
    ).delete(synchronize_session=False)
    # Filas compartidas: se CONSERVAN anonimizadas (mismo criterio que
    # el borrado por admin en app/api/users.py).
    _detach_user_references(db, user)
    db.delete(user)
    db.commit()
    return {"ok": True}
