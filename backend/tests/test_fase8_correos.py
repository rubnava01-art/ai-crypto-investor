"""Fase 8 mejoras-v1 — Correos de bienvenida y reactivación (tarea 4).

Plantillas + lógica de disparo con ENVÍO desacoplado (cola stub,
patrón Fase 1): ningún correo sale real — PENDIENTE de proveedor.
Bienvenida tras la aprobación por admin, no antes. Reactivación para
inactivos (propuesta: 30 días sin entrar, pendiente del dueño).
"""
import datetime as dt
import re
import uuid

from app.core import correos_fase8
from app.core.email_outbox import clear_outbox, list_outbox
from app.core.rate_limit import login_limiter, login_lockout, register_limiter
from app.database import get_db
from app.models.tables import User, utcnow

CANDIDATOS = "/api/correos/reactivacion/candidatos"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _buscar_usuario(client, admin_headers, username):
    """Busca un usuario paginando (la suite comparte BD y supera los
    100 del límite por defecto)."""
    offset = 0
    while True:
        r = client.get(
            f"/api/users?limit=200&offset={offset}", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        page = r.json()
        if not page:
            raise AssertionError(f"usuario no encontrado: {username}")
        for u in page:
            if u["username"] == username:
                return u
        offset += len(page)


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    body = r.json()
    a, b = (int(x) for x in re.findall(r"\d+", body["question"]))
    return body["challenge_id"], a + b


def _register(client, username, email=None, plan=None):
    register_limiter.clear()
    login_limiter.clear()
    cid, answer = _challenge(client)
    payload = {
        "username": username,
        "password": "BienvenidaPass12",
        "challenge_id": cid,
        "answer": answer,
        "terms_accepted": True,
    }
    if email is not None:
        payload["email"] = email
    if plan is not None:
        payload["plan"] = plan
    r = client.post("/api/auth/register", json=payload)
    assert r.status_code == 201, r.text
    return r


def _approve(client, admin_headers, username):
    row = _buscar_usuario(client, admin_headers, username)
    r = client.post(f"/api/users/{row['id']}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    return row["id"]


def _mk_user(client, app, admin_headers, email=None):
    username = _uid("f8c")
    payload = {"username": username, "password": "pass1234abcd", "role": "prueba"}
    r = client.post("/api/users", json=payload, headers=admin_headers)
    assert r.status_code == 201, r.text
    row = r.json()
    if email:
        # POST /api/users no admite correo: se siembra por BD.
        db, gen = _db(app)
        try:
            db.get(User, row["id"]).email = email
            db.commit()
        finally:
            _close(gen)
        row["email"] = email
    return row


def test_f8_bienvenida_se_encola_al_aprobar_y_no_antes(client, admin_headers):
    clear_outbox()
    username = _uid("f8bienv")
    email = f"{username}@example.com"
    _register(client, username, email=email, plan="esencial")
    # Antes de aprobar: solo el correo de verificación, nada de bienvenida.
    assert not [m for m in list_outbox() if "bienvenid" in m.subject.lower()]
    _approve(client, admin_headers, username)
    mails = [m for m in list_outbox() if "bienvenid" in m.subject.lower()]
    assert len(mails) == 1
    assert mails[0].to == email
    assert "aprobada" in mails[0].body
    assert "Esencial" in mails[0].body
    assert "14 días de prueba gratis" in mails[0].body
    # Sin verificar aún: la bienvenida no promete la entrada, avisa
    # que falta verificar el correo (H2-1: el login bloquea con 403
    # a no verificados, así que «Ya puedes iniciar sesión» sería
    # engañoso aquí).
    assert "Ya puedes iniciar sesión" not in mails[0].body
    assert "Cuando verifiques tu correo podrás iniciar sesión" in mails[0].body
    assert "verifica tu correo" in mails[0].body
    clear_outbox()


def test_f8_bienvenida_plantilla_segun_verificacion():
    """H2-1 (plantilla): verificado promete la entrada; sin verificar
    la condiciona a verificar el correo, sin prometerla antes."""
    _, cuerpo_si = correos_fase8.plantilla_bienvenida("Ana", verificado=True)
    assert "Ya puedes iniciar sesión" in cuerpo_si
    assert "Cuando verifiques" not in cuerpo_si
    _, cuerpo_no = correos_fase8.plantilla_bienvenida("Ana", verificado=False)
    assert "Ya puedes iniciar sesión" not in cuerpo_no
    assert "Cuando verifiques tu correo podrás iniciar sesión" in cuerpo_no
    assert "verifica tu correo" in cuerpo_no


def test_f8_bienvenida_sin_correo_no_encola_nada(client, admin_headers):
    clear_outbox()
    username = _uid("f8bienv2")
    _register(client, username)
    _approve(client, admin_headers, username)
    assert list_outbox() == []
    clear_outbox()


def test_f8_bienvenida_no_se_duplica_el_mismo_dia(client, app, admin_headers):
    clear_outbox()
    user_row = _mk_user(client, app, admin_headers, email=f"{_uid('f8dup')}@example.com")
    db, gen = _db(app)
    try:
        user = db.get(User, user_row["id"])
        assert correos_fase8.encolar_bienvenida(db, user) is True
        assert correos_fase8.encolar_bienvenida(db, user) is False
        assert len([m for m in list_outbox() if "bienvenid" in m.subject.lower()]) == 1
    finally:
        _close(gen)
    clear_outbox()


def test_f8_encolar_correo_unico_tolerante_a_carrera(client, app, admin_headers):
    """H3-1: si el commit pierde la carrera por la UNIQUE (doble
    aprobación concurrente), encolar devuelve False sin romper y sin
    dejar un correo huérfano en la cola."""
    from unittest.mock import patch

    from sqlalchemy.exc import IntegrityError

    clear_outbox()
    user_row = _mk_user(client, app, admin_headers, email=f"{_uid('f8race')}@example.com")
    db, gen = _db(app)
    try:
        user = db.get(User, user_row["id"])
        with patch.object(
            db,
            "commit",
            side_effect=IntegrityError(
                "INSERT INTO email_envios", {}, Exception("UNIQUE constraint failed")
            ),
        ):
            assert (
                correos_fase8.encolar_correo_unico(
                    db, user, "bienvenida", user.email, "Asunto", "Cuerpo"
                )
                is False
            )
        assert list_outbox() == []
    finally:
        _close(gen)
    clear_outbox()


def test_f8_login_estampa_ultimo_acceso(client, app, admin_headers):
    login_limiter.clear()
    login_lockout.clear()
    user_row = _mk_user(client, app, admin_headers)
    db, gen = _db(app)
    try:
        assert db.get(User, user_row["id"]).last_login_at is None
    finally:
        _close(gen)
    r = client.post(
        "/api/auth/login",
        json={"username": user_row["username"], "password": "pass1234abcd"},
    )
    assert r.status_code == 200, r.text
    db, gen = _db(app)
    try:
        ultimo = db.get(User, user_row["id"]).last_login_at
        assert ultimo is not None
        assert (utcnow() - ultimo.replace(tzinfo=dt.timezone.utc)).total_seconds() < 120
    finally:
        _close(gen)
    login_limiter.clear()
    login_lockout.clear()


def _sembrar_inactividad(app, user_id, ultimo_acceso=None, creado=None):
    db, gen = _db(app)
    try:
        user = db.get(User, user_id)
        if ultimo_acceso is not None:
            user.last_login_at = ultimo_acceso
        if creado is not None:
            user.created_at = creado
        db.commit()
    finally:
        _close(gen)


def test_f8_reactivacion_candidatos_correctos(client, app, admin_headers):
    ahora = utcnow()
    viejo = ahora - dt.timedelta(days=40)
    reciente = ahora - dt.timedelta(days=5)
    # Inactivo por último acceso hace 40 días.
    u_viejo = _mk_user(client, app, admin_headers, email=f"{_uid('f8old')}@example.com")
    _sembrar_inactividad(app, u_viejo["id"], ultimo_acceso=viejo)
    # Activo (hace 5 días): no candidato.
    u_reciente = _mk_user(client, app, admin_headers, email=f"{_uid('f8new')}@example.com")
    _sembrar_inactividad(app, u_reciente["id"], ultimo_acceso=reciente)
    # Nunca entró y creado hace 40 días: candidato.
    u_nunca = _mk_user(client, app, admin_headers, email=f"{_uid('f8never')}@example.com")
    _sembrar_inactividad(app, u_nunca["id"], creado=viejo)
    # Nunca entró pero creado hace 5 días: no candidato.
    u_nuevo = _mk_user(client, app, admin_headers, email=f"{_uid('f8fresh')}@example.com")
    _sembrar_inactividad(app, u_nuevo["id"], creado=reciente)
    # Sin correo: no candidato aunque inactivo.
    u_sin = _mk_user(client, app, admin_headers)
    _sembrar_inactividad(app, u_sin["id"], ultimo_acceso=viejo)

    r = client.get(CANDIDATOS, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dias_inactividad"] == 30
    nombres = {c["username"] for c in body["candidatos"]}
    assert u_viejo["username"] in nombres
    assert u_nunca["username"] in nombres
    assert u_reciente["username"] not in nombres
    assert u_nuevo["username"] not in nombres
    assert u_sin["username"] not in nombres
    viejo_row = [c for c in body["candidatos"] if c["username"] == u_viejo["username"]][0]
    assert viejo_row["dias_inactivo"] >= 40
    assert viejo_row["email"] == u_viejo["email"]


def test_f8_reactivacion_solo_admin_y_sin_envio(client, app, admin_headers):
    from app.core.security import create_access_token

    user_row = _mk_user(client, app, admin_headers, email=f"{_uid('f8adm')}@example.com")
    token = create_access_token(
        user_row["username"],
        user_id=user_row["id"],
        token_version=user_row.get("token_version") or 0,
    )
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get(CANDIDATOS, headers=headers)
    assert r.status_code == 403, r.text
    assert client.get(CANDIDATOS).status_code == 401
    # El listado no envía nada: la cola sigue vacía.
    clear_outbox()
    r = client.get(CANDIDATOS, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert list_outbox() == []
