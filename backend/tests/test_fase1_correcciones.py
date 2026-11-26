"""Correcciones Fase 1 mejoras-v1 (hallazgos del QA independiente):
F1 — UI de verificación de correo y 2FA (aquí solo la parte de backend:
el endpoint /verify-email distingue token vencido de inválido);
F2 — users.email UNIQUE (segundo registro con el mismo correo -> error);
F3 — el login sin código TOTP no cuenta como fallo de lockout.

Los limiters son globales en el proceso y la suite comparte un único
proceso: cada test limpia su presupuesto (patrón documentado en
rate_limit.clear) para no bloquear a los demás.
"""
import datetime as dt
import os
import re

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine

from app.core.email_outbox import clear_outbox, list_outbox
from app.core.email_verification import _hash_token
from app.core.rate_limit import (
    guest_issue_limiter,
    guest_read_limiter,
    login_limiter,
    login_lockout,
    register_limiter,
    resend_limiter,
)
from app.database import get_db
from app.models.tables import EmailVerification


@pytest.fixture(autouse=True)
def _reset_fase1_state(app):
    login_limiter.clear()
    login_lockout.clear()
    register_limiter.clear()
    resend_limiter.clear()
    guest_issue_limiter.clear()
    guest_read_limiter.clear()
    clear_outbox()
    yield
    login_limiter.clear()
    login_lockout.clear()
    register_limiter.clear()
    resend_limiter.clear()
    clear_outbox()
    _delete_fx_users(app)


def _delete_fx_users(app):
    """Borra los usuarios fx* creados por este archivo (y sus filas
    hijas: tokens de verificación y pendientes). La suite comparte una
    única BD y GET /api/users pagina a 100: sin limpieza, los 10
    usuarios de este archivo empujaban el total por encima de 100 y
    test_admin_user_crud dejaba de ver al usuario recién creado."""
    from app.models.tables import EmailVerification, PendingActivation, User

    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        ids = [
            u.id
            for u in db.query(User).filter(User.username.like("fx%")).all()
        ]
        if ids:
            db.query(EmailVerification).filter(
                EmailVerification.user_id.in_(ids)
            ).delete(synchronize_session=False)
            db.query(PendingActivation).filter(
                PendingActivation.user_id.in_(ids)
            ).delete(synchronize_session=False)
            db.query(User).filter(User.id.in_(ids)).delete(
                synchronize_session=False
            )
            db.commit()
    finally:
        gen.close()


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    body = r.json()
    a, b = (int(x) for x in re.findall(r"\d+", body["question"]))
    return body["challenge_id"], a + b


def _register(client, username, password="Fase1-" + "FixPass99", email=None):
    cid, answer = _challenge(client)
    payload = {
        "username": username,
        "password": password,
        "challenge_id": cid,
        "answer": answer,
        "terms_accepted": True,
    }
    if email is not None:
        payload["email"] = email
    return client.post("/api/auth/register", json=payload)


def _login(client, username, password, totp_code=None):
    body = {"username": username, "password": password}
    if totp_code is not None:
        body["totp_code"] = totp_code
    return client.post("/api/auth/login", json=body)


def _approve(client, admin_headers, username):
    users = client.get("/api/users", headers=admin_headers).json()
    row = [u for u in users if u["username"] == username][0]
    if row["status"] != "pending":
        return row["id"]
    r = client.post(f"/api/users/{row['id']}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    return row["id"]


def _token_from_outbox(email):
    mails = [m for m in list_outbox() if m.to == email]
    assert mails, f"sin correo encolado para {email}"
    # Fase 8: la cola ya no trae solo verificación — la bienvenida
    # tras aprobar también va al mismo destinatario. Se busca el
    # correo de verificación (el que trae token=), no el último.
    for mail in reversed(mails):
        match = re.search(r"token=([A-Za-z0-9_\-]+)", mail.body)
        if match:
            return match.group(1)
    raise AssertionError("ningún correo trae enlace con token")


def _expire_token(app, token):
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        row = (
            db.query(EmailVerification)
            .filter(EmailVerification.token_hash == _hash_token(token))
            .first()
        )
        assert row is not None
        row.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
        db.commit()
    finally:
        gen.close()


# ---------------------------------------------------------------- F1: correo --

def test_verify_email_vencido_e_invalido_con_mensaje_propio(client, app):
    _register(client, "fxmail1", email="fxmail1@example.com")
    token = _token_from_outbox("fxmail1@example.com")
    _expire_token(app, token)
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 400, r.text
    assert "venció" in r.json()["detail"]
    # Token inventado: 400 con el mensaje de no válido (no el de vencido).
    r = client.post("/api/auth/verify-email", json={"token": "token-inventado"})
    assert r.status_code == 400, r.text
    assert "no es válido" in r.json()["detail"]
    assert "venció" not in r.json()["detail"]


def test_verify_email_reutilizado_es_invalido_no_vencido(client):
    _register(client, "fxmail2", email="fxmail2@example.com")
    token = _token_from_outbox("fxmail2@example.com")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 400, r.text
    assert "no es válido" in r.json()["detail"]


# ---------------------------------------------------------------- F2: correo --

def test_segundo_registro_mismo_correo_es_409(client, admin_headers):
    r = _register(client, "fxdup1", email="fxdup1@example.com")
    assert r.status_code == 201, r.text
    # Segundo registro, otro usuario, mismo correo: 409 en español.
    r = _register(client, "fxdup2", email="fxdup1@example.com")
    assert r.status_code == 409, r.text
    assert "Ya existe una cuenta con ese correo" in r.json()["detail"]
    # Solo existe una cuenta con ese correo.
    users = client.get("/api/users", headers=admin_headers).json()
    assert len([u for u in users if u["username"] in ("fxdup1", "fxdup2")]) == 1


def test_registro_mismo_correo_distinto_caso_es_409(client):
    assert _register(client, "fxdup3", email="fxdup3@example.com").status_code == 201
    r = _register(client, "fxdup4", email="FXDUP3@EXAMPLE.COM")
    assert r.status_code == 409, r.text


def test_registro_sin_correo_no_choca_por_null(client):
    # Varios NULL no chocan con la UNIQUE (Postgres y SQLite los permiten).
    assert _register(client, "fxnull1").status_code == 201
    assert _register(client, "fxnull2").status_code == 201


def test_cambio_correo_en_perfil_a_correo_de_otro_es_409(client, admin_headers):
    _register(client, "fxprof1", email="fxprof1@example.com")
    _approve(client, admin_headers, "fxprof1")
    _register(client, "fxprof2", email="fxprof2@example.com")
    _approve(client, admin_headers, "fxprof2")
    # Verificar el correo de fxprof2: si no, el login es 403 y el PUT
    # ni se alcanza.
    token = _token_from_outbox("fxprof2@example.com")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    r = _login(client, "fxprof2", "Fase1-FixPass99")
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.put(
        "/api/profile/me",
        json={"email": "fxprof1@example.com"},
        headers=headers,
    )
    assert r.status_code == 409, r.text
    assert "Ya existe una cuenta con ese correo" in r.json()["detail"]
    # El correo propio no cambió.
    me = client.get("/api/profile/me", headers=headers).json()
    assert me["email"] == "fxprof2@example.com"


def _run_alembic(db_file, target, downgrade=False):
    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    settings.database_url = f"sqlite:///{db_file}"
    try:
        if downgrade:
            command.downgrade(cfg, target)
        else:
            command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def _users_unique_constraints(db_file):
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        return {
            c["name"]
            for c in sa.inspect(engine).get_unique_constraints("users")
            if c["name"]
        }
    finally:
        engine.dispose()


def test_migracion_email_unique_upgrade_y_downgrade(tmp_path):
    db_file = tmp_path / "f2.db"
    _run_alembic(db_file, "head")
    assert "uq_users_email" in _users_unique_constraints(db_file)
    _run_alembic(db_file, "a3b7c2d4e5f6", downgrade=True)
    assert "uq_users_email" not in _users_unique_constraints(db_file)
    _run_alembic(db_file, "head")
    assert "uq_users_email" in _users_unique_constraints(db_file)


def test_migracion_email_unique_aborta_con_duplicados(tmp_path):
    db_file = tmp_path / "f2dup.db"
    _run_alembic(db_file, "a3b7c2d4e5f6")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        with engine.begin() as conn:
            for username in ("dup-a", "dup-b"):
                conn.execute(
                    sa.text(
                        "INSERT INTO users (username, password_hash, "
                        "is_admin, token_version, email_verified, "
                        "totp_enabled, email, "
                        "created_at) VALUES (:u, 'x', 0, 0, 0, 0, "
                        "'duplicado@example.com', '2026-01-01T00:00:00')"
                    ),
                    {"u": username},
                )
    finally:
        engine.dispose()
    with pytest.raises(RuntimeError, match="duplicados"):
        _run_alembic(db_file, "head")
    # La migración abortó antes de crear nada: sigue sin restricción.
    assert "uq_users_email" not in _users_unique_constraints(db_file)


# ------------------------------------------------- F3: lockout y 2FA --

def _make_admin_2fa(client, admin_headers, username):
    """Admin con 2FA activado. Devuelve el secreto TOTP."""
    import pyotp

    r = client.post(
        "/api/users",
        json={"username": username, "password": "AdminFix2fa99", "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code in (201, 409), r.text
    r = _login(client, username, "AdminFix2fa99")
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post("/api/auth/2fa/setup", headers=headers)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    r = client.post(
        "/api/auth/2fa/confirm",
        json={"code": pyotp.TOTP(secret).now()},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return secret


def _totp_now(secret):
    import pyotp

    return pyotp.TOTP(secret).now()


def test_login_sin_codigo_2fa_no_bloquea_la_cuenta(client, admin_headers):
    secret = _make_admin_2fa(client, admin_headers, "fxlock1")
    # 10 logins con la contraseña correcta pero sin código: todos 401
    # con el mensaje propio, y ninguno registra fallo de lockout.
    for _ in range(10):
        r = _login(client, "fxlock1", "AdminFix2fa99")
        assert r.status_code == 401, r.text
        assert "dos pasos" in r.json()["detail"]
        login_limiter.clear()
    # El intento 11, con el código correcto, entra (antes era 429).
    r = _login(client, "fxlock1", "AdminFix2fa99", totp_code=_totp_now(secret))
    assert r.status_code == 200, r.text


def test_codigo_totp_incorrecto_si_cuenta_para_lockout(client, admin_headers):
    secret = _make_admin_2fa(client, admin_headers, "fxlock2")
    # 10 logins con código incorrecto: cada uno registra un fallo.
    for _ in range(10):
        r = _login(client, "fxlock2", "AdminFix2fa99", totp_code="000000")
        assert r.status_code == 401, r.text
        assert "incorrecto" in r.json()["detail"]
        login_limiter.clear()
    # El intento 11, incluso con el código correcto, es 429 (bloqueo).
    r = _login(client, "fxlock2", "AdminFix2fa99", totp_code=_totp_now(secret))
    assert r.status_code == 429, r.text
    assert "minutos" in r.json()["detail"]
