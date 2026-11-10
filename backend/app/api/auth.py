"""Authentication endpoints: login, public registration, access roles.

Registration (Acceso, 2026-10-26; cuentas por aprobar, 2026-10-30): anyone
can create an account from the login screen, but only after passing a
one-time human check (a small math question issued by the server — the
"no soy una máquina" check). New accounts are always role prueba AND
stay pending: they cannot log in or see anything until an admin
approves them from the users panel (approval removes the pending row;
rejection deletes the account). Only an admin can promote an approved
account, and only a super admin can grant the super admin tier.
No third-party CAPTCHA keys are involved: the check stops casual bots,
it is not a proof against a determined human solver.

Fase 2 (M1, M2, 3.6): login now checks the per-account lockout before
verifying the password, audits failed AND successful logins, and issues
tokens carrying user_id + credential version; registration creates the
user and its pending row in ONE transaction (a crash between the two
used to leave an active, unapproved account). Auth error messages are
unified in Spanish in this module (login + register); the pending
message is byte-identical to before.
"""
import random
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.rate_limit import login_limiter, login_lockout
from app.core.security import (
    PENDING_DETAIL,
    check_password_bytes,
    create_access_token,
    effective_role,
    get_current_user,
    hash_password,
    is_super_admin,
    verify_password,
)
from app.database import get_db
from app.models.tables import PendingActivation, User
from app.schemas.api import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

# One-time human challenges: challenge_id -> (answer, expires_at).
# In-memory by design (single worker, same assumption as the login rate
# limiter): a challenge is consumed on its first verification attempt,
# right or wrong, so it cannot be replayed or brute-forced.
_CHALLENGES: dict[str, tuple[int, float]] = {}
_CHALLENGE_TTL_SECONDS = 300


def _prune_challenges() -> None:
    now = time.monotonic()
    for cid in [c for c, (_, exp) in _CHALLENGES.items() if exp < now]:
        del _CHALLENGES[cid]


def _password_byte_cap(v: str) -> str:
    """bcrypt cap (B2): reject passwords past 72 UTF-8 bytes. The
    minimum for SETTING a password is 12 (decisión de Rubén 2026-11-02);
    login keeps no minimum so existing accounts still sign in."""
    try:
        check_password_bytes(v)
    except ValueError as e:
        raise ValueError(str(e)) from e
    return v


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=12, max_length=128)
    challenge_id: str = Field(min_length=1)
    answer: int

    @field_validator("password")
    @classmethod
    def _password_bytes(cls, v: str) -> str:
        return _password_byte_cap(v)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"login:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de inicio de sesión. Espera un minuto.",
        )
    # Per-account lockout (M3): checked before verifying, so a locked
    # account cannot be brute-forced even with the right password.
    if login_lockout.locked(payload.username):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos. Espera unos minutos.",
        )
    user = db.query(User).filter(User.username == payload.username).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        login_lockout.record_failure(payload.username)
        audit(
            db, user, "auth.login_failed", "auth",
            details={"username": payload.username},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas."
        )
    # Cuenta pendiente de activación: la contraseña es correcta pero aún
    # ningún administrador la aprobó, así que no recibe token ni entra.
    if (
        db.query(PendingActivation)
        .filter(PendingActivation.user_id == user.id)
        .first()
        is not None
    ):
        audit(
            db, user, "auth.login_failed", "auth",
            details={"username": payload.username, "reason": "pending"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=PENDING_DETAIL,
        )
    login_lockout.record_success(payload.username)
    audit(db, user, "auth.login_success", "auth")
    return TokenResponse(
        access_token=create_access_token(
            user.username, user_id=user.id, token_version=user.token_version or 0
        )
    )


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # H-5 (corrida 2026-11-10): is_super_admin se calcula UNA vez y se
    # reutiliza en effective_role; antes se consultaba dos veces.
    super_flag = is_super_admin(user, db)
    return {
        "username": user.username,
        "is_admin": user.is_admin,
        "is_super_admin": super_flag,
        "role": effective_role(user, db, super_flag=super_flag),
    }


@router.get("/register-challenge")
def register_challenge(request: Request):
    """Issue a one-time human check for the registration form."""
    # Antes sin límite: se podía pedir un challenge nuevo sin freno y el
    # rango 2-9 solo tenía 64 respuestas posibles. Ahora 10-99 + límite.
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"challenge:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas verificaciones. Espera un minuto.",
        )
    _prune_challenges()
    a = random.randint(10, 99)
    b = random.randint(10, 99)
    cid = secrets.token_urlsafe(16)
    _CHALLENGES[cid] = (a + b, time.monotonic() + _CHALLENGE_TTL_SECONDS)
    return {"challenge_id": cid, "question": f"¿Cuánto es {a} + {b}?"}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """Public registration. Always creates a prueba account in pending
    state: it cannot log in until an admin approves it from the users
    panel. Promotion to admin/super_admin happens only through user
    management, after approval."""
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"register:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de registro. Espera un minuto.",
        )
    _prune_challenges()
    expected = _CHALLENGES.pop(payload.challenge_id, None)
    if expected is None or expected[0] != payload.answer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verificación incorrecta o vencida. Pide una pregunta nueva.",
        )
    username = payload.username.strip()
    if db.query(User).filter(User.username == username).first() is not None:
        raise HTTPException(status_code=409, detail="El nombre de usuario ya existe.")
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=False,
    )
    db.add(user)
    db.flush()  # populate user.id without committing yet
    # Pendiente de activación, EN LA MISMA transacción (M1): antes eran
    # dos commits y una caída entre ambos dejaba una cuenta activa sin
    # fila pending — es decir, aprobada sin aprobación.
    db.add(PendingActivation(user_id=user.id))
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "role": "prueba",
        "is_admin": False,
        "is_super_admin": False,
        "status": "pending",
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
