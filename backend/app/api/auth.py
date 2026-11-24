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
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.rate_limit import (
    LoginLockout,
    guest_issue_limiter,
    login_limiter,
    login_lockout,
)
from app.core.security import (
    GUEST_TOKEN_EXPIRE_SECONDS,
    PENDING_DETAIL,
    check_password_bytes,
    create_access_token,
    create_guest_token,
    effective_role,
    get_current_user,
    hash_password,
    is_super_admin,
    revoke_user_tokens,
    verify_password,
)
from app.database import get_db
from app.models.tables import PendingActivation, User
from app.schemas.api import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

# B8 (corrida seguridad 2026-11-23): hash ficticio para igualar el
# tiempo de login cuando el usuario no existe (oráculo de timing).
# Se genera una vez al importar: bcrypt es lento a propósito y el
# valor nunca coincide con ninguna contraseña real.
_DUMMY_PASSWORD_HASH = hash_password("dummy-password-nunca-valida-" + secrets.token_hex(16))

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


# Plan elegido en la landing (A2, 2026-11-13): claves canónicas de
# t.planes — "esencial" | "crecimiento" | "total" (nombres
# nameEsencial / nameCrecimiento / nameTotal y anclas PLAN_CARD_IDS
# "plan-esencial" / "plan-crecimiento" / "plan-total" en
# PlanesPanel.tsx). El registro acepta ambas formas y guarda la
# canónica corta; cualquier otro valor es 422. Sin pago en línea: la
# elección solo se guarda para que el admin la vea al aprobar.
REQUESTED_PLAN_KEYS = ("esencial", "crecimiento", "total")


def normalize_requested_plan(value: str) -> str:
    """Canonicaliza el plan del query param ?plan= / del registro.

    Acepta la clave corta ("esencial") y el id de tarjeta
    ("plan-esencial"); rechaza cualquier otro valor con ValueError
    (Pydantic lo convierte en 422)."""
    v = (value or "").strip().lower()
    if v.startswith("plan-"):
        v = v[len("plan-"):]
    if v not in REQUESTED_PLAN_KEYS:
        raise ValueError(
            "plan debe ser uno de: " + ", ".join(REQUESTED_PLAN_KEYS)
        )
    return v


class RegisterRequest(BaseModel):
    # S-1b (corrida 2026-11-24): el username se valida tras strip.
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=12, max_length=128)
    challenge_id: str = Field(min_length=1)
    answer: int
    # Plan elegido en la landing (?plan=<clave>). Opcional: registrarse
    # sin elegir plan sigue funcionando y guarda NULL.
    plan: str | None = None

    @field_validator("username")
    @classmethod
    def _strip_username(cls, v: str) -> str:
        # S-1b: "   " -> "" (422 por min_length) y " ruben " -> "ruben".
        # El validador corre tras la validación de longitud, así que un
        # nombre de solo espacios llega aquí con len>=3 y se rechaza.
        v = (v or "").strip()
        if len(v) < 3:
            raise ValueError("username debe tener al menos 3 caracteres")
        return v

    @field_validator("password")
    @classmethod
    def _password_bytes(cls, v: str) -> str:
        return _password_byte_cap(v)

    @field_validator("plan")
    @classmethod
    def _normalize_plan(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_requested_plan(v)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"login:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de inicio de sesión. Espera un minuto.",
            # 2026-11-13 (M5): el cliente necesita saber cuánto esperar.
            headers={"Retry-After": "60"},
        )
    # Per-account lockout (M3): checked before verifying, so a locked
    # account cannot be brute-forced even with the right password.
    if login_lockout.locked(payload.username):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos fallidos. Espera unos minutos.",
            headers={"Retry-After": str(LoginLockout.LOCKOUT_SECONDS)},
        )
    user = db.query(User).filter(User.username == payload.username).first()
    # B8: verificar siempre la contraseña, también cuando el usuario
    # no existe (contra el hash ficticio), para igualar el tiempo.
    password_ok = (
        verify_password(payload.password, user.password_hash)
        if user is not None
        else verify_password(payload.password, _DUMMY_PASSWORD_HASH)
    )
    if user is None or not password_ok:
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


class GuestRequest(BaseModel):
    challenge_id: str = Field(min_length=1)
    challenge_answer: int


@router.post("/guest")
def guest(payload: GuestRequest, request: Request):
    """Sesión de invitado (Fase 1, 2026-11-23, mejoras óptimas):
    demo sin registro. Reutiliza el challenge matemático de un solo
    uso del registro (misma bolsa _CHALLENGES, TTL 300 s). Emite un
    JWT HS256 sub "guest:<uuid>", role "invitado", exp 15 min, sin
    refresh y SIN fila User. Límite de emisión: 3/min por IP.
    Respuesta: {access_token, token_type, expires_in: 900,
    perfil: "invitado", modulos: ["inicio","estudiar","planes",
    "asistente"]}. El invitado solo llega a lecturas públicas y al
    Asistente de solo lectura (ver get_current_principal y
    MODULOS_INVITADO); todo lo demás le responde 403."""
    from app.core.perfiles import MODULOS_INVITADO

    client_ip = request.client.host if request.client else "unknown"
    if not guest_issue_limiter.allow(f"guest_issue:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas sesiones de invitado. Espera un minuto.",
            headers={"Retry-After": "60"},
        )
    _prune_challenges()
    expected = _CHALLENGES.pop(payload.challenge_id, None)
    if expected is None or expected[0] != payload.challenge_answer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verificación incorrecta o vencida. Pide una pregunta nueva.",
        )
    token, _guest_id = create_guest_token()
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": GUEST_TOKEN_EXPIRE_SECONDS,
        "perfil": "invitado",
        "modulos": sorted(MODULOS_INVITADO),
    }


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


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _password_bytes(cls, v: str) -> str:
        return _password_byte_cap(v)


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cambio de clave propio (2026-11-21): cualquier usuario con sesión
    puede cambiar SU clave conociendo la actual. Antes no existía esta
    ruta: la única forma era que un admin la cambiara desde Control de
    usuarios, y el formulario de ahí aceptaba 4 caracteres mientras el
    backend exige 12 — por eso "no funcionaba cambiar claves".
    La clave nueva revoca todos los tokens (incluida esta sesión): el
    cliente debe volver a entrar con la clave nueva."""
    # B7 (corrida seguridad 2026-11-23): reutiliza login_limiter
    # (10/min) por USUARIO: con una sesión válida ya no se pueden
    # probar claves actuales sin freno. Tras la validación Pydantic:
    # los 422 no consumen presupuesto.
    if not login_limiter.allow(f"change-password:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados cambios de clave. Espera un minuto.",
            headers={"Retry-After": "60"},
        )
    if not verify_password(payload.current_password, user.password_hash):
        audit(db, user, "auth.change_password_failed", "auth",
              details={"reason": "current_password"})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La contraseña actual no es correcta.",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La clave nueva debe ser distinta de la actual.",
        )
    user.password_hash = hash_password(payload.new_password)
    revoke_user_tokens(user)
    db.commit()
    audit(db, user, "auth.change_password", "auth")
    return {"ok": True}


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
            # 2026-11-13 (M5).
            headers={"Retry-After": "60"},
        )
    _prune_challenges()
    # B10 (corrida seguridad 2026-11-23): secrets en vez de random
    # (el reto no debe depender del PRNG predecible de random).
    a = secrets.randbelow(90) + 10
    b = secrets.randbelow(90) + 10
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
            # 2026-11-13 (M5).
            headers={"Retry-After": "60"},
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
        # B8 (corrida seguridad 2026-11-23): mismo 201 genérico de
        # éxito pendiente aunque el nombre exista (sin crear
        # duplicado): el 409 anterior permitía enumerar usuarios.
        # C1 (QA 2026-11-23): hashear también en este camino para
        # igualar el tiempo con un registro real; si no, el duplicado
        # responde más rápido y delata que el nombre existe.
        hash_password(payload.password)
        # Sin id ni created_at: no hay fila creada que referenciar.
        return {
            "id": None,
            "username": username,
            "role": "prueba",
            "is_admin": False,
            "is_super_admin": False,
            "status": "pending",
            "requested_plan": payload.plan,
            "created_at": None,
        }
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=False,
        # A2: la elección de plan de la landing, ya canonicalizada por
        # el validador (None si se registró sin elegir plan).
        requested_plan=payload.plan,
    )
    db.add(user)
    db.flush()  # populate user.id without committing yet
    # Pendiente de activación, EN LA MISMA transacción (M1): antes eran
    # dos commits y una caída entre ambos dejaba una cuenta activa sin
    # fila pending — es decir, aprobada sin aprobación.
    db.add(PendingActivation(user_id=user.id))
    db.commit()
    db.refresh(user)
    # S-1 (corrida 2026-11-24, A3 H-01): el cuerpo es IDÉNTICO al del
    # duplicado (id null, created_at null en ambos): devolver el id o la
    # fecha solo en el registro nuevo delataba si el nombre ya existía.
    return {
        "id": None,
        "username": user.username,
        "role": "prueba",
        "is_admin": False,
        "is_super_admin": False,
        "status": "pending",
        "requested_plan": user.requested_plan,
        "created_at": None,
    }
