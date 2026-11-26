"""Verificación de correo por token (Fase 1 mejoras-v1, tarea 1).

Flujo: al registrarse con correo (o al cambiarlo en el perfil), se
emite un token de un solo uso con TTL 24 h y se encola el correo de
verificación (ver email_outbox: stub sin envío real — PENDIENTE:
requiere al dueño el proveedor/clave). El token en claro nunca se
guarda: solo su SHA-256. Verificar borra el token y marca
`User.email_verified`. Reenviar invalida los tokens anteriores.

El bloqueo de login vive en auth.py: una cuenta aprobada con correo
sin verificar no entra hasta verificar (los admin están exentos y las
cuentas sin correo no pasan por verificación).
"""
import datetime as dt
import hashlib
import re
import secrets

from sqlalchemy.orm import Session

from app.config import settings
from app.core.email_outbox import queue_email
from app.models.tables import EmailVerification, User, utcnow

TOKEN_TTL_HOURS = 24

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def is_valid_email(value: str) -> bool:
    """Formato mínimo local@dominio.tld (misma regla que perfil)."""
    return bool(_EMAIL_RE.match((value or "").strip()))


def requires_email_verification(user: User) -> bool:
    """True si la cuenta debe verificar el correo antes de entrar:
    tiene correo, aún no lo verificó y no es admin (los admin son
    operadores de confianza y están exentos)."""
    return bool(user.email) and not user.email_verified and not user.is_admin


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _verification_link(token: str) -> str:
    """Enlace de verificación. Sin PUBLIC_BASE_URL configurada es una
    ruta relativa: la ruta /verificar-correo del frontend es
    PENDIENTE (el correo queda encolado igual, con el token)."""
    base = (settings.public_base_url or "").strip().rstrip("/")
    return f"{base}/verificar-correo?token={token}"


def issue_verification_token(db: Session, user: User) -> str:
    """Emite un token nuevo para el usuario (invalida los anteriores)
    y encola el correo de verificación. No hace commit: lo hace el
    llamador junto con el resto de su transacción."""
    if not user.email:
        raise ValueError("El usuario no tiene correo para verificar.")
    db.query(EmailVerification).filter(
        EmailVerification.user_id == user.id
    ).delete(synchronize_session=False)
    token = secrets.token_urlsafe(32)
    db.add(
        EmailVerification(
            user_id=user.id,
            token_hash=_hash_token(token),
            expires_at=utcnow() + dt.timedelta(hours=TOKEN_TTL_HOURS),
        )
    )
    queue_email(
        to=user.email,
        subject="Verifica tu correo — Grow Business Platform",
        body=(
            f"Hola {user.username},\n\n"
            "Para activar tu cuenta en Grow Business Platform, "
            "verifica tu correo con este enlace (válido 24 horas):\n\n"
            f"{_verification_link(token)}\n\n"
            "Si no creaste esta cuenta, ignora este correo.\n"
        ),
    )
    return token


def verify_email_token(db: Session, token: str) -> tuple[User | None, str]:
    """Verifica un token: lo consume (un solo uso) y marca el correo
    verificado. Devuelve (usuario, "ok"), o (None, "invalid") si el
    token no existe o ya se usó, o (None, "expired") si existía pero
    venció. Distinguir vencido de inválido permite a la página pública
    /verificar-correo mostrar cada caso en español; un token no es un
    oráculo de existencia de cuentas (el vencido solo se distingue
    teniendo el token en la mano)."""
    row = (
        db.query(EmailVerification)
        .filter(EmailVerification.token_hash == _hash_token(token or ""))
        .first()
    )
    if row is None:
        return None, "invalid"
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if expires_at <= utcnow():
        db.delete(row)
        db.commit()
        return None, "expired"
    user = db.get(User, row.user_id)
    db.delete(row)
    if user is not None:
        user.email_verified = True
    db.commit()
    return user, "ok"
