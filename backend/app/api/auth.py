"""Authentication endpoints: login, public registration, access roles.

Registration (Acceso, 2026-10-26): anyone can create an account from the
login screen, but only after passing a one-time human check (a small
math question issued by the server — the "no soy una máquina" check).
New accounts are always role prueba (view + tests only, no controls);
only an admin can promote them, and only a super admin can grant the
super admin tier. No third-party CAPTCHA keys are involved: the check
stops casual bots, it is not a proof against a determined human solver.
"""
import random
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import login_limiter
from app.core.security import (
    create_access_token,
    effective_role,
    get_current_user,
    hash_password,
    is_super_admin,
    verify_password,
)
from app.database import get_db
from app.models.tables import User
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


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    challenge_id: str = Field(min_length=1)
    answer: int


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"login:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )
    user = db.query(User).filter(User.username == payload.username).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    return TokenResponse(access_token=create_access_token(user.username))


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "username": user.username,
        "is_admin": user.is_admin,
        "is_super_admin": is_super_admin(user, db),
        "role": effective_role(user, db),
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
    """Public registration. Always creates a prueba account (read-only);
    promotion to admin/super_admin happens only through user management."""
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"register:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Try again later.",
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
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "role": "prueba",
        "is_admin": False,
        "is_super_admin": False,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
