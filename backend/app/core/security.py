"""Authentication: password hashing (bcrypt) and JWT bearer tokens.

Fase 2 (M1, B1, B2):
- Tokens carry `user_id` (and credential version `tv`) in addition to
  `sub`. Legacy sub-only tokens — e.g. tokens minted by tests, or any
  token issued before this change — are still accepted during their
  60-minute window: the user is resolved by username and the extra
  claims are enforced only when present. After at most 60 minutes every
  live token carries the new claims.
- `get_current_user()` re-checks the pending-activation row on every
  request (login alone used to check it): a pending account sees
  nothing even if it somehow holds a token.
- Credential version: bumping `User.token_version` (password change,
  role downgrade) invalidates every token issued before the bump that
  carries a `tv` claim. Tokens without `tv` (pre-change) expire within
  60 minutes and cannot be renewed without re-login.
- bcrypt truncates silently past 72 bytes: passwords longer than 72
  UTF-8 bytes are REJECTED (never truncated, never pre-hashed into a
  collision) by `check_password_bytes()`; `hash_password()` also
  refuses them defensively so no caller can hash one by accident.
"""
import datetime as dt

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.tables import PendingActivation, User

bearer_scheme = HTTPBearer(auto_error=False)

# bcrypt hard limit: inputs past 72 bytes are silently truncated by the
# algorithm, so two passwords differing only after byte 72 would
# collide. Reject, don't truncate.
MAX_PASSWORD_BYTES = 72

# Mensaje de pendiente: byte-idéntico al de login (los tests lo buscan).
PENDING_DETAIL = "Tu cuenta está pendiente de activación por un administrador."


def check_password_bytes(password: str) -> None:
    """Raise ValueError if the password exceeds bcrypt's 72-byte cap."""
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(
            "La contraseña supera el límite de 72 bytes de bcrypt."
        )


def hash_password(password: str) -> str:
    check_password_bytes(password)
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"), password_hash.encode("utf-8")
        )
    except (ValueError, TypeError):
        return False


def revoke_user_tokens(user: User) -> None:
    """Invalidate every token issued before this point (that carries a
    `tv` claim). Call it on password change and on role downgrade."""
    user.token_version = (user.token_version or 0) + 1


def create_access_token(
    username: str,
    user_id: int | None = None,
    token_version: int | None = None,
) -> str:
    expire = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        minutes=settings.jwt_expire_minutes
    )
    payload: dict = {
        "sub": username,
        "exp": expire,
        "iat": dt.datetime.now(dt.timezone.utc),
    }
    # New claims; omitted for legacy callers (tests minting tokens by
    # username only) so old call sites keep working.
    if user_id is not None:
        payload["user_id"] = user_id
    if token_version is not None:
        payload["tv"] = token_version
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        username = payload.get("sub")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    # H-5 (corrida 2026-11-10): usuario + fila de pendiente en UNA sola
    # consulta (outerjoin). Antes eran dos SELECT por petición
    # autenticada; las comprobaciones son las mismas, solo viajan juntas.
    row = (
        db.query(User, PendingActivation)
        .outerjoin(PendingActivation, PendingActivation.user_id == User.id)
        .filter(User.username == username)
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    user, pending = row
    # A token naming a different user id than the resolved user is
    # forged or recycled (username re-created): reject it. Legacy
    # sub-only tokens carry no user_id and skip this check.
    token_user_id = payload.get("user_id")
    if token_user_id is not None and token_user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    # Credential version: a token issued before a password change or
    # role downgrade is dead. Legacy tokens without `tv` skip this and
    # expire on their own within 60 minutes.
    token_tv = payload.get("tv")
    if token_tv is not None and token_tv != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revocado."
        )
    # Pending accounts see nothing, even with a token in hand (M1).
    if pending is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=PENDING_DETAIL
        )
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Gate for control endpoints: only administrators pass."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only: this account can view and run tests, but not change controls.",
        )
    return user


def is_super_admin(user: User, db: Session) -> bool:
    """True when the user holds a row in super_admin_grants."""
    from app.models.tables import SuperAdminGrant

    return (
        db.query(SuperAdminGrant).filter(SuperAdminGrant.user_id == user.id).first()
        is not None
    )


def require_super_admin(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> User:
    """Gate for super-admin-only actions (granting super status, touching
    another super admin's account)."""
    if not is_super_admin(user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin only.",
        )
    return user


def effective_role(user: User, db: Session, super_flag: bool | None = None) -> str:
    """Display role: super_admin > admin > prueba.

    `super_flag` reuses an already-computed is_super_admin() result so a
    caller that already asked (p. ej. /me) no paga la misma consulta dos
    veces; cuando es None se consulta como antes.
    """
    if super_flag is None:
        super_flag = is_super_admin(user, db)
    if super_flag:
        return "super_admin"
    return "admin" if user.is_admin else "prueba"
