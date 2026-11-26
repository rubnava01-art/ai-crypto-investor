"""Fase 8 mejoras-v1 — Pruebas de humo end-to-end por API (tarea 1).

Encadena el flujo completo con usuarios frescos: registro →
aprobación por admin → login → ver plan/límites → usar el Asistente
→ cancelar suscripción → comprobar límite degradado. Más los casos
de permiso clave: prueba no puede hacer acciones de admin, invitado
no puede mutar nada.

Lo que YA cubrían las suites (no se duplica aquí, solo se encadena):
- Login, rate limits por IP y bloqueo por cuenta, 2FA, verificación
  de correo: test_fase1_seguridad.py (32 tests) y test_auth.py.
- Permisos por rol (CRUD de usuarios, prueba solo lectura, auditoría
  solo super admin, aislamiento de clientes vinculados):
  test_rbac_users.py, test_fase1_seguridad.py, test_fase2_backend.py.
- Límites diarios del Asistente por plan (10/50/200/1000), reinicio
  diario, 429 sin consumir cupo, feedback: test_fase6_asistente.py.
- Suscripciones (activación admin, cancelación con acceso hasta fin
  de periodo, avisos de prueba, pasarela sin configurar):
  test_fase7_pagos.py (25 tests).
Lo que AÑADE este archivo: el encadenamiento completo en un solo
flujo con un usuario fresco, y los permisos de prueba/invitado
reunidos en un mismo recorrido.
"""
import datetime as dt
import re
import uuid

from app.api.asistente import asistente_limiter
from app.core.rate_limit import (
    guest_chat_limiter,
    guest_issue_limiter,
    login_limiter,
    login_lockout,
    register_limiter,
)
from app.database import get_db
from app.models.tables import Suscripcion

PASSWORD = "HumoFase8Pass12"


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


def _limpiar_limiters():
    for limiter in (
        login_limiter,
        login_lockout,
        register_limiter,
        asistente_limiter,
        guest_issue_limiter,
        guest_chat_limiter,
    ):
        limiter.clear()


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


def _login(client, username):
    r = client.post(
        "/api/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_f8_humo_flujo_completo(client, app, admin_headers):
    _limpiar_limiters()
    username = _uid("f8humo")
    # 1. Registro público: nace pendiente. Sin plan elegido: el
    # usuario es prueba pura (10 mensajes/día) hasta que el admin
    # active algo.
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": PASSWORD,
            "challenge_id": cid,
            "answer": answer,
            "terms_accepted": True,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    # 2. Pendiente no puede entrar todavía.
    r = client.post(
        "/api/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert r.status_code == 403, r.text
    # 3. Aprobación por admin.
    user_id = _buscar_usuario(client, admin_headers, username)["id"]
    r = client.post(f"/api/users/{user_id}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"
    # 4. Login ya funciona.
    headers = _login(client, username)
    # 5. Ver plan/límites: sin suscripción, prueba (10/día).
    r = client.get("/api/suscripciones/mia", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["suscripcion"] is None
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "prueba"
    assert r.json()["limite_diario"] == 10
    # 6. Usar el Asistente: cuenta como un mensaje.
    r = client.post(
        "/api/asistente/chat",
        json={"mensaje": "¿cuánto cuesta el plan esencial?"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.json()["mensajes_hoy"] == 1
    assert r.json()["restantes"] == 9
    # 7. El admin activa la prueba de Esencial: el límite sube a 50.
    r = client.post(
        "/api/suscripciones/admin",
        json={"user_id": user_id, "plan": "esencial", "estado": "prueba_activa"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.json()["plan"] == "esencial"
    assert r.json()["limite_diario"] == 50
    # 8. Cancelar en un clic: conserva el acceso hasta fin de prueba.
    r = client.post("/api/suscripciones/mia/cancelar", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["suscripcion"]["estado"] == "cancelada"
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.json()["limite_diario"] == 50  # acceso aún vigente
    # 9. Fin del periodo: el límite se degrada a prueba (10/día).
    db, gen = _db(app)
    try:
        sub = (
            db.query(Suscripcion)
            .filter(Suscripcion.user_id == user_id)
            .first()
        )
        sub.acceso_hasta = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
        db.commit()
    finally:
        _close(gen)
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "prueba"
    assert r.json()["limite_diario"] == 10
    _limpiar_limiters()


def test_f8_humo_prueba_no_puede_acciones_de_admin(client, app, admin_headers):
    _limpiar_limiters()
    username = _uid("f8perm")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["id"]
    from app.core.security import create_access_token

    token = create_access_token(
        username, user_id=user_id, token_version=0
    )
    headers = {"Authorization": f"Bearer {token}"}
    # Crear usuario, ver auditoría, activar suscripción, ver feedback.
    assert client.post(
        "/api/users",
        json={"username": _uid("f8otro"), "password": "pass1234abcd", "role": "prueba"},
        headers=headers,
    ).status_code == 403
    assert client.get("/api/admin/audit-log", headers=headers).status_code == 403
    assert client.post(
        "/api/suscripciones/admin",
        json={"user_id": user_id, "plan": "esencial", "estado": "activa"},
        headers=headers,
    ).status_code == 403
    assert client.get("/api/asistente/feedback", headers=headers).status_code == 403
    # ...pero sí puede leer lo suyo.
    assert client.get("/api/suscripciones/mia", headers=headers).status_code == 200
    assert client.get("/api/asistente/uso", headers=headers).status_code == 200
    _limpiar_limiters()


def test_f8_humo_invitado_no_puede_mutar_nada(client, app):
    _limpiar_limiters()
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/guest",
        json={"challenge_id": cid, "challenge_answer": answer},
    )
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # Nada de mutaciones ni de estado propio: todo 401/403.
    assert client.post(
        "/api/users",
        json={"username": _uid("f8inv"), "password": "pass1234abcd", "role": "prueba"},
        headers=headers,
    ).status_code in (401, 403)
    assert client.post(
        "/api/suscripciones/mia/cancelar", headers=headers
    ).status_code in (401, 403)
    assert client.get("/api/asistente/uso", headers=headers).status_code in (401, 403)
    assert client.get("/api/suscripciones/mia", headers=headers).status_code in (
        401,
        403,
    )
    # El invitado sí puede leer lo público y preguntar al Asistente
    # (solo lectura): eso no es mutar.
    assert client.get("/api/health").status_code == 200
    r = client.post(
        "/api/asistente/chat",
        json={"mensaje": "¿cuánto cuesta el plan esencial?"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    _limpiar_limiters()
