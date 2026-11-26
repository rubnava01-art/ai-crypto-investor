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
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import analitica
from app.core.email_verification import (
    is_valid_email,
    issue_verification_token,
    requires_email_verification,
    verify_email_token,
)
from app.core.hardening import audit
from app.core.rate_limit import (
    LoginLockout,
    guest_issue_limiter,
    login_limiter,
    login_lockout,
    register_limiter,
    resend_limiter,
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
from app.models.tables import PendingActivation, User, utcnow
from app.schemas.api import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

# B8 (corrida seguridad 2026-11-23): hash ficticio para igualar el
# tiempo de login cuando el usuario no existe (oráculo de timing).
# PEREZOSO (corrida 2026-11-24, entrada de prueba rápida): antes se
# generaba al importar el módulo (~470 ms de bcrypt en cada arranque
# en frío, que paga también el primer invitado aunque nunca haga
# login). Ahora se genera solo en el primer login de usuario
# inexistente y se reutiliza después: el mismo valor para todos los
# intentos posteriores, así que el oráculo de timing sigue igualado
# a partir de ese primer intento. El doble chequeo con lock evita
# generarlo dos veces si dos logins llegan a la vez.
_DUMMY_PASSWORD_HASH: str | None = None
_DUMMY_PASSWORD_HASH_LOCK = threading.Lock()


def _dummy_password_hash() -> str:
    global _DUMMY_PASSWORD_HASH
    hashed = _DUMMY_PASSWORD_HASH
    if hashed is None:
        with _DUMMY_PASSWORD_HASH_LOCK:
            if _DUMMY_PASSWORD_HASH is None:
                _DUMMY_PASSWORD_HASH = hash_password(
                    "dummy-password-nunca-valida-" + secrets.token_hex(16)
                )
            hashed = _DUMMY_PASSWORD_HASH
    return hashed

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
    # Correo para verificación (Fase 1 mejoras-v1, tarea 1). Opcional:
    # sin correo no hay verificación que hacer (cuentas viejas y
    # registros sin correo entran como antes, tras la aprobación).
    # Con correo: se emite el token y la cuenta no entra hasta
    # verificar, una vez aprobada.
    email: str | None = None
    # Aceptación de los textos legales (Fase 2 mejoras-v1, tarea 1):
    # el registro exige aceptar los Términos y la Política de
    # privacidad (checkbox en /login?mode=register). Sin aceptación
    # no hay cuenta: el validador lo rechaza con 422.
    # H1 (corrección QA Fase 2, 2026-11-25): SIN default. Con
    # `= False` Pydantic v2 no ejecutaba el validador sobre el valor
    # por defecto y un registro sin el campo devolvía 201 y estampaba
    # terms_accepted_at, registrando un consentimiento que nunca
    # ocurrió. Obligatorio: omitirlo es 422 ("Field required").
    terms_accepted: bool

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

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = (v or "").strip()
        if not v:
            return None
        if len(v) > 255 or not is_valid_email(v):
            raise ValueError("El correo no tiene un formato válido.")
        return v

    @field_validator("terms_accepted")
    @classmethod
    def _require_terms(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError(
                "Debes aceptar los Términos y la Política de privacidad "
                "para crear la cuenta."
            )
        return v


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
        else verify_password(payload.password, _dummy_password_hash())
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
    # Correo sin verificar (Fase 1 mejoras-v1, tarea 1): la cuenta
    # está aprobada pero su correo sigue sin confirmar, así que no
    # entra. Acceso limitado, no bloqueo total: verificar y reenviar
    # siguen disponibles sin sesión (ver abajo). Sin correo no hay
    # verificación que exigir; los admin están exentos.
    if requires_email_verification(user):
        audit(
            db, user, "auth.login_failed", "auth",
            details={"username": payload.username, "reason": "email_unverified"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Tu correo aún no está verificado. Revisa tu bandeja de "
                "entrada o pide un reenvío del enlace de verificación."
            ),
        )
    # 2FA (Fase 1 mejoras-v1, tarea 3): con el 2FA activado, la
    # contraseña sola no basta. Sin código -> 401 con mensaje propio
    # (el cliente reintenta con el código); código inválido -> 401 y
    # cuenta como fallo de login para el bloqueo por cuenta. Los
    # códigos de recuperación valen una sola vez.
    if user.totp_enabled:
        from app.core.two_factor import verify_second_factor

        if not payload.totp_code:
            # F3 (corrección Fase 1 mejoras-v1): la contraseña es
            # correcta y solo falta el código: se responde 2fa_required
            # SIN registrar fallo de lockout (antes, 10 logins sin
            # código bloqueaban la cuenta). El fallo solo se registra
            # con contraseña incorrecta o código TOTP incorrecto. La
            # auditoría sí se conserva: el intento queda registrado.
            audit(
                db, user, "auth.login_failed", "auth",
                details={"username": payload.username, "reason": "2fa_required"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Se requiere el código de verificación en dos pasos.",
            )
        if not verify_second_factor(db, user, payload.totp_code):
            login_lockout.record_failure(payload.username)
            audit(
                db, user, "auth.login_failed", "auth",
                details={"username": payload.username, "reason": "2fa_failed"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Código de verificación incorrecto.",
            )
    login_lockout.record_success(payload.username)
    # Fase 8 mejoras-v1, tarea 4: estampa el último acceso (base de
    # la reactivación por inactividad). Lo persiste el commit de
    # audit() justo debajo.
    user.last_login_at = utcnow()
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
        # Fase 1 mejoras-v1, tarea 1: el frontend muestra el aviso de
        # verificación con estos dos campos.
        "email": user.email,
        "email_verified": bool(user.email_verified),
        # Fase 1 mejoras-v1, tarea 3: el frontend muestra el estado
        # del 2FA y el aviso de activación para admin/super admin.
        "two_factor_enabled": bool(user.totp_enabled),
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


def _email_taken(db: Session, email: str) -> bool:
    """True si otra cuenta ya usa ese correo (comparación sin
    distinguir mayúsculas: el correo no distingue 'A@x.com' de
    'a@x.com' para el usuario, aunque la UNIQUE de la BD sí lo haga)."""
    return (
        db.query(User)
        .filter(func.lower(User.email) == (email or "").strip().lower())
        .first()
        is not None
    )


def _pending_registration_response(username: str, plan: str | None) -> dict:
    """Cuerpo genérico del registro pendiente (S-1): idéntico para
    registro nuevo y duplicado, para no delatar si el nombre existe."""
    return {
        "id": None,
        "username": username,
        "role": "prueba",
        "is_admin": False,
        "is_super_admin": False,
        "status": "pending",
        "requested_plan": plan,
        "created_at": None,
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """Public registration. Always creates a prueba account in pending
    state: it cannot log in until an admin approves it from the users
    panel. Promotion to admin/super_admin happens only through user
    management, after approval."""
    client_ip = request.client.host if request.client else "unknown"
    if not register_limiter.allow(f"register:{client_ip}"):
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
        return _pending_registration_response(username, payload.plan)
    # F2 (corrección Fase 1 mejoras-v1): el correo es único entre
    # cuentas. A diferencia del nombre, aquí SÍ se responde 409: el
    # correo lo aporta quien se registra y el error claro evita que
    # dos cuentas compartan un correo que luego se verifica. La UNIQUE
    # de la BD (uq_users_email) respalda este chequeo ante carreras.
    if payload.email and _email_taken(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una cuenta con ese correo electrónico.",
        )
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=False,
        # A2: la elección de plan de la landing, ya canonicalizada por
        # el validador (None si se registró sin elegir plan).
        requested_plan=payload.plan,
        # Fase 1 mejoras-v1, tarea 1: correo opcional para verificación.
        email=payload.email,
        # Fase 2 mejoras-v1, tarea 1: la aceptación ya pasó el
        # validador (terms_accepted=True). H1 (corrección QA Fase 2,
        # 2026-11-25): la fecha solo se estampa con aceptación real;
        # sin ella sería un consentimiento inventado.
        terms_accepted_at=utcnow() if payload.terms_accepted else None,
    )
    db.add(user)
    db.flush()  # populate user.id without committing yet
    # Pendiente de activación, EN LA MISMA transacción (M1): antes eran
    # dos commits y una caída entre ambos dejaba una cuenta activa sin
    # fila pending — es decir, aprobada sin aprobación.
    db.add(PendingActivation(user_id=user.id))
    try:
        db.commit()
    except IntegrityError:
        # Carrera: otra petición creó el mismo correo (o nombre) entre
        # el chequeo y el commit. El correo duplicado es 409; el nombre
        # duplicado, el mismo 201 genérico de arriba.
        db.rollback()
        if payload.email and _email_taken(db, payload.email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una cuenta con ese correo electrónico.",
            ) from None
        hash_password(payload.password)
        return _pending_registration_response(username, payload.plan)
    db.refresh(user)
    # Fase 8 mejoras-v1, tarea 3: evento "registro" (una vez por
    # usuario; el camino de nombre duplicado no llega aquí porque no
    # crea fila).
    analitica.registrar_evento(db, analitica.TIPO_REGISTRO, user.id)
    # Fase 1 mejoras-v1, tarea 1: con correo, se emite el token de
    # verificación y se encola el correo (stub: sin envío real,
    # PENDIENTE proveedor). Sin correo no hay nada que verificar.
    if payload.email:
        issue_verification_token(db, user)
        db.commit()
    # S-1 (corrida 2026-11-24, A3 H-01): el cuerpo es IDÉNTICO al del
    # duplicado (id null, created_at null en ambos): devolver el id o la
    # fecha solo en el registro nuevo delataba si el nombre ya existía.
    return _pending_registration_response(user.username, user.requested_plan)


# ------------------------------------------------- verificación de correo --
# Fase 1 mejoras-v1, tarea 1. Sin sesión: el usuario verifica desde el
# enlace que recibió (o pide un reenvío) antes de poder entrar.

class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=1)


class ResendVerificationRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)


@router.post("/verify-email")
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Verifica el correo con el token del enlace (un solo uso, 24 h).

    200 cuando el token es válido (la cuenta queda verificada);
    400 cuando no existe, ya se usó ("no es válido") o venció
    ("ya venció"): la página /verificar-correo muestra cada caso.
    """
    user, result = verify_email_token(db, payload.token)
    if result == "expired":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El enlace de verificación ya venció. "
                "Pide un reenvío del enlace."
            ),
        )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El enlace de verificación no es válido. "
                "Pide un reenvío del enlace."
            ),
        )
    audit(db, user, "auth.email_verified", "auth")
    return {"ok": True, "username": user.username}


@router.post("/resend-verification")
def resend_verification(
    payload: ResendVerificationRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Reenvía el enlace de verificación (invalida el anterior).

    Respuesta SIEMPRE 200 con el mismo texto, exista o no la cuenta:
    un 404/409 aquí permitiría enumerar usuarios. Solo se emite un
    token nuevo cuando la cuenta existe, tiene correo sin verificar
    y no es admin. Limitado por IP (presupuesto propio, 5/min).
    """
    client_ip = request.client.host if request.client else "unknown"
    if not resend_limiter.allow(f"resend:{client_ip}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados reenvíos. Espera un minuto.",
            headers={"Retry-After": "60"},
        )
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if user is not None and requires_email_verification(user):
        issue_verification_token(db, user)
        db.commit()
        audit(db, user, "auth.email_verification_resent", "auth")
    return {
        "ok": True,
        "detail": (
            "Si la cuenta existe y su correo sigue sin verificar, "
            "recibirás un enlace nuevo."
        ),
    }
