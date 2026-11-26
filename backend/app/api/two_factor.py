"""2FA TOTP — enrollment y gestión propia (Fase 1 mejoras-v1, tarea 3).

Solo admin y super admin (require_admin): los roles prueba no
requieren 2FA. El flujo es por cuenta: cada admin activa SU propio
2FA (setup -> confirm con un código válido -> códigos de
recuperación). Desactivar exige la contraseña + un código válido.

PENDIENTE: requiere al dueño — Rubén debe activar su propio 2FA
cuando quiera; hasta entonces su login sigue sin 2FA (ver
two_factor.py: bloquear antes de enrolar lo dejaría fuera).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.security import (
    get_current_user,
    require_admin,
    revoke_user_tokens,
    verify_password,
)
from app.core.two_factor import (
    generate_recovery_codes,
    generate_secret,
    otpauth_url,
    verify_second_factor,
    verify_totp,
)
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/auth/2fa", tags=["2fa"])


@router.get("/status")
def get_status(user: User = Depends(get_current_user)):
    """Estado del 2FA de la propia cuenta."""
    return {
        "enabled": bool(user.totp_enabled),
        # Secreto emitido pero aún sin confirmar (enrollment a medias).
        "pending_setup": bool(user.totp_secret) and not user.totp_enabled,
        "recovery_codes_left": len(user.totp_recovery_codes or []),
    }


@router.post("/setup")
def setup(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Emite el secreto TOTP para enrolar. No activa nada: la
    activación es POST /confirm con un código válido. Si el 2FA ya
    está activo, se rechaza (desactívalo primero): reemitir a ciegas
    dejaría la cuenta sin segundo factor válido hasta confirmar."""
    if admin.totp_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El 2FA ya está activo. Desactívalo primero para enrolar de nuevo.",
        )
    secret = generate_secret()
    admin.totp_secret = secret
    admin.totp_enabled = False
    admin.totp_recovery_codes = []
    db.commit()
    audit(db, admin, "auth.2fa_setup", "auth")
    return {
        "secret": secret,
        "otpauth_url": otpauth_url(secret, admin.username),
        "issuer": "Grow Business Platform",
        "account": admin.username,
    }


class ConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=16)


@router.post("/confirm")
def confirm(
    payload: ConfirmRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Activa el 2FA tras verificar un código TOTP del secreto emitido
    y devuelve los 10 códigos de recuperación (UNA sola vez: guárdalos).
    Activar revoca todos los tokens (las sesiones viejas no heredan
    el segundo factor)."""
    if not admin.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Primero emite un secreto con /setup.",
        )
    if not verify_totp(admin.totp_secret, payload.code):
        audit(db, admin, "auth.2fa_confirm_failed", "auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código de verificación incorrecto.",
        )
    plain, hashed = generate_recovery_codes()
    admin.totp_enabled = True
    admin.totp_recovery_codes = hashed
    revoke_user_tokens(admin)
    db.commit()
    audit(db, admin, "auth.2fa_enabled", "auth")
    return {"ok": True, "recovery_codes": plain}


class DisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=16)


@router.post("/disable")
def disable(
    payload: DisableRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Desactiva el 2FA propio. Exige la contraseña actual + un código
    TOTP o de recuperación válido (sin segundo factor no se puede
    quitar el segundo factor). Desactivar revoca los tokens."""
    if not verify_password(payload.password, admin.password_hash):
        audit(db, admin, "auth.2fa_disable_failed", "auth",
              details={"reason": "password"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La contraseña actual no es correcta.",
        )
    if not verify_second_factor(db, admin, payload.code):
        audit(db, admin, "auth.2fa_disable_failed", "auth",
              details={"reason": "code"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código de verificación incorrecto.",
        )
    admin.totp_secret = None
    admin.totp_enabled = False
    admin.totp_recovery_codes = []
    revoke_user_tokens(admin)
    db.commit()
    audit(db, admin, "auth.2fa_disabled", "auth")
    return {"ok": True}


@router.post("/recovery-codes")
def regenerate_recovery_codes(
    payload: ConfirmRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Regenera los 10 códigos de recuperación (invalida los anteriores).
    Exige un código TOTP válido y el 2FA activo."""
    if not admin.totp_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El 2FA no está activado en esta cuenta.",
        )
    if not verify_totp(admin.totp_secret or "", payload.code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Código de verificación incorrecto.",
        )
    plain, hashed = generate_recovery_codes()
    admin.totp_recovery_codes = hashed
    db.commit()
    audit(db, admin, "auth.2fa_recovery_codes_regenerated", "auth")
    return {"ok": True, "recovery_codes": plain}
