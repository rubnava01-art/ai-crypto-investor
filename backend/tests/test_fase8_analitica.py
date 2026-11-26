"""Fase 8 mejoras-v1 — Analítica de eventos (tarea 3).

Sin servicio externo, sin cookies de terceros. Eventos: registro,
primera_herramienta (solo la primera vez), uso_semanal (agregado por
semana ISO) y paso_a_pago (al activar prueba o suscripción de pago).
La tabla nace vacía; cada test parte de cero eventos para su usuario.
"""
import re
import uuid

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import EventoAnalitica

RESUMEN = "/api/analitica/resumen"


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


def _eventos(db, user_id):
    return (
        db.query(EventoAnalitica)
        .filter(EventoAnalitica.user_id == user_id)
        .order_by(EventoAnalitica.id)
        .all()
    )


def _mk_user(client, admin_headers, username=None):
    username = username or _uid("f8a")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    token = create_access_token(
        username, user_id=user["id"], token_version=user.get("token_version") or 0
    )
    return user, {"Authorization": f"Bearer {token}"}


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


def test_f8_registro_crea_evento_una_vez(client, app, admin_headers):
    from app.core.rate_limit import login_limiter, register_limiter

    register_limiter.clear()
    login_limiter.clear()
    username = _uid("f8reg")
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": "RegistroPass12",
            "challenge_id": cid,
            "answer": answer,
            "terms_accepted": True,
        },
    )
    assert r.status_code == 201, r.text
    db, gen = _db(app)
    try:
        uid = _buscar_usuario(client, admin_headers, username)["id"]
        evs = _eventos(db, uid)
        assert [e.tipo for e in evs] == ["registro"]
        # Registrar de nuevo el mismo nombre no crea otro evento (el
        # camino de duplicado no crea fila ni evento).
        cid2, answer2 = _challenge(client)
        r2 = client.post(
            "/api/auth/register",
            json={
                "username": username,
                "password": "RegistroPass12",
                "challenge_id": cid2,
                "answer": answer2,
                "terms_accepted": True,
            },
        )
        assert r2.status_code == 201, r2.text
        assert [e.tipo for e in _eventos(db, uid)] == ["registro"]
    finally:
        _close(gen)
    register_limiter.clear()
    login_limiter.clear()


def test_f8_primera_herramienta_y_uso_semanal_solo_una_vez(
    client, app, admin_headers
):
    from app.api.asistente import asistente_limiter

    user, headers = _mk_user(client, admin_headers)
    db, gen = _db(app)
    try:
        assert _eventos(db, user["id"]) == []
        r = client.post(
            "/api/asistente/chat",
            json={"mensaje": "¿cuánto cuesta el plan esencial?"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        tipos = [e.tipo for e in _eventos(db, user["id"])]
        assert tipos == ["primera_herramienta", "uso_semanal"], tipos
        # Segundo mensaje: no duplica ni la primera herramienta ni la
        # semana (agregado, no por mensaje).
        asistente_limiter.clear()
        r = client.post(
            "/api/asistente/chat",
            json={"mensaje": "¿qué incluye el plan crecimiento?"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert [e.tipo for e in _eventos(db, user["id"])] == [
            "primera_herramienta",
            "uso_semanal",
        ]
        # Sin contenido privado guardado: ninguna referencia lleva la pregunta.
        for e in _eventos(db, user["id"]):
            assert "cuesta" not in e.referencia
            assert "esencial" not in e.referencia or e.tipo == "paso_a_pago"
    finally:
        _close(gen)
        asistente_limiter.clear()


def test_f8_paso_a_pago_solo_al_activar(client, app, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    db, gen = _db(app)
    try:
        r = client.post(
            "/api/suscripciones/admin",
            json={"user_id": user["id"], "plan": "esencial", "estado": "prueba_activa"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        evs = [e for e in _eventos(db, user["id"]) if e.tipo == "paso_a_pago"]
        assert len(evs) == 1
        assert evs[0].referencia == "esencial"
        # Reactivar el mismo plan no duplica el evento.
        r = client.post(
            "/api/suscripciones/admin",
            json={"user_id": user["id"], "plan": "esencial", "estado": "activa"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        assert len([e for e in _eventos(db, user["id"]) if e.tipo == "paso_a_pago"]) == 1
        # Cambiar de plan sí genera un evento nuevo (otro paso a pago).
        r = client.post(
            "/api/suscripciones/admin",
            json={"user_id": user["id"], "plan": "crecimiento", "estado": "activa"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        evs = [e for e in _eventos(db, user["id"]) if e.tipo == "paso_a_pago"]
        assert len(evs) == 2
        assert sorted(e.referencia for e in evs) == ["crecimiento", "esencial"]
        # Pausar no genera evento.
        r = client.post(
            "/api/suscripciones/admin",
            json={"user_id": user["id"], "plan": "crecimiento", "estado": "en_pausa"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        assert len([e for e in _eventos(db, user["id"]) if e.tipo == "paso_a_pago"]) == 2
    finally:
        _close(gen)


def test_f8_resumen_solo_admin_y_solo_conteos(client, app, admin_headers):
    from app.api.asistente import asistente_limiter

    user, headers = _mk_user(client, admin_headers)
    r = client.post(
        "/api/asistente/chat",
        json={"mensaje": "¿cuánto cuesta el plan esencial?"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    asistente_limiter.clear()
    # Prueba no puede ver el resumen.
    r = client.get(RESUMEN, headers=headers)
    assert r.status_code == 403, r.text
    # Sin token tampoco.
    assert client.get(RESUMEN).status_code == 401
    # Admin ve conteos, sin listar usuarios.
    r = client.get(RESUMEN, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["conteos"]["primera_herramienta"] >= 1
    assert body["conteos"]["uso_semanal"] >= 1
    assert body["usuarios_unicos"]["primera_herramienta"] >= 1
    assert "usuarios" not in body
    assert "eventos" not in body
    # Filtro por periodo futuro: cero en todo.
    r = client.get(
        f"{RESUMEN}?desde=2999-01-01&hasta=2999-12-31", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert all(v == 0 for v in r.json()["conteos"].values())
