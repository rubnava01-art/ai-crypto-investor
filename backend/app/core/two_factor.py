"""2FA TOTP para admin y super admin (Fase 1 mejoras-v1, tarea 3).

- TOTP RFC 6238 (pyotp, ventana ±1 paso de 30 s por desfase de reloj).
- Enrollment en dos pasos: setup emite el secreto (aún sin activar) y
  confirm lo activa tras verificar un código válido; al confirmar se
  generan 10 códigos de recuperación de un solo uso.
- Los códigos de recuperación se guardan solo como SHA-256 (como las
  contraseñas: el valor en claro se muestra UNA vez, al confirmar).
- RIESGO CONOCIDO: el secreto TOTP se guarda en claro en la BD (no
  hay infraestructura de cifrado en reposo en la plataforma). Quien
  lea la BD puede generar códigos. Mitigación futura: cifrarlo con
  Fernet y una clave en el entorno (PENDIENTE, no bloquea esta fase:
  el secreto en BD exige ya acceso a la base de datos).
- PENDIENTE: requiere al dueño — la activación del 2FA es por cuenta:
  Rubén debe activar su propio 2FA (POST /api/auth/2fa/setup +
  /confirm) cuando quiera. Hasta que lo haga, su login sigue
  funcionando sin 2FA: esta fase NO bloquea a ningún admin sin 2FA
  (bloquearlo antes de que él se enrole lo dejaría fuera). El paso
  siguiente, cuando él ya tenga 2FA, es exigirlo a todo admin/super
  admin en login (un cambio de una línea en auth.py).
"""
import hashlib
import secrets
import string

import pyotp
from sqlalchemy.orm import Session

from app.models.tables import User

ISSUER = "Grow Business Platform"
RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = string.ascii_uppercase.replace("O", "") + string.digits.replace("0", "")


def generate_secret() -> str:
    """Secreto base32 nuevo para enrolar."""
    return pyotp.random_base32()


def otpauth_url(secret: str, username: str) -> str:
    """URL otpauth:// para el QR (el frontend la renderiza como QR;
    el secreto también se devuelve en claro para teclearlo a mano)."""
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    """Verifica un código TOTP (ventana ±1 paso)."""
    if not secret or not code:
        return False
    try:
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


def _new_recovery_code() -> str:
    """Código de recuperación legible: 8 caracteres en dos grupos."""
    raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def _hash_recovery_code(code: str) -> str:
    normalized = (code or "").strip().upper().replace("-", "").replace(" ", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def generate_recovery_codes() -> tuple[list[str], list[str]]:
    """Devuelve (códigos en claro, hashes para guardar)."""
    plain = [_new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    return plain, [_hash_recovery_code(c) for c in plain]


def consume_recovery_code(db: Session, user: User, code: str) -> bool:
    """Verifica un código de recuperación y lo consume (un solo uso).
    Devuelve True si era válido."""
    hashes = list(user.totp_recovery_codes or [])
    target = _hash_recovery_code(code)
    if target not in hashes:
        return False
    hashes.remove(target)
    user.totp_recovery_codes = hashes
    db.commit()
    return True


def verify_second_factor(db: Session, user: User, code: str) -> bool:
    """TOTP o código de recuperación (que se consume al usarse)."""
    if verify_totp(user.totp_secret or "", code):
        return True
    return consume_recovery_code(db, user, code)
