"""Cuentas nuevas por aprobar (Acceso, 2026-10-30, decisión del dueño):
el registro público crea la cuenta pendiente; sin aprobación de un
administrador no puede iniciar sesión ni ver nada. Aprobar la activa,
rechazar la borra. Las cuentas creadas por un admin nacen activas y las
viejas no cambian (no tienen fila de pendiente).
"""

import re

import pytest

from app.core.rate_limit import login_limiter
from app.core.security import create_access_token


@pytest.fixture(autouse=True)
def _reset_login_budget():
    """La suite comparte un solo presupuesto de login (10/min por IP) y
    este módulo corre tarde en orden alfabético: sin esto, sus llamadas
    a /api/auth/login caerían en 429 por llamadas de otros módulos. Limpiar
    el limitador en memoria antes de cada prueba lo hace independiente
    del orden (solo afecta a los tests, nunca al código)."""
    login_limiter._hits.clear()
    yield
    login_limiter._hits.clear()


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    return data["challenge_id"], int(m.group(1)) + int(m.group(2))


def _register(client, username):
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pass1234", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _token(username):
    return {"Authorization": f"Bearer {create_access_token(username)}"}


def _list_users(client, headers):
    r = client.get("/api/users", headers=headers)
    assert r.status_code == 200, r.text
    return {u["username"]: u for u in r.json()}


def test_register_creates_pending_and_login_blocked(client, admin_headers):
    body = _register(client, "pend1")
    assert body["role"] == "prueba"
    assert body["status"] == "pending"

    # Contraseña correcta pero pendiente: 403, sin token.
    r = client.post("/api/auth/login", json={"username": "pend1", "password": "pass1234"})
    assert r.status_code == 403, r.text
    assert "pendiente" in r.json()["detail"]

    users = _list_users(client, admin_headers)
    assert users["pend1"]["status"] == "pending"


def test_approve_enables_login(client, admin_headers):
    body = _register(client, "pend2")
    r = client.post(f"/api/users/{body['id']}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    r = client.post("/api/auth/login", json={"username": "pend2", "password": "pass1234"})
    assert r.status_code == 200, r.text
    assert len(r.json()["access_token"]) > 20


def test_reject_deletes_account(client, admin_headers):
    body = _register(client, "pend3")
    r = client.post(f"/api/users/{body['id']}/reject", headers=admin_headers)
    assert r.status_code == 204, r.text

    users = _list_users(client, admin_headers)
    assert "pend3" not in users
    r = client.post("/api/auth/login", json={"username": "pend3", "password": "pass1234"})
    assert r.status_code == 401


def test_non_admin_cannot_approve_or_reject(client, admin_headers):
    body = _register(client, "pend4")
    # Prueba activa creada por el admin para intentar aprobar/rechazar.
    r = client.post(
        "/api/users",
        json={"username": "probador", "password": "pass1234", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    prueba = _token("probador")
    r = client.post(f"/api/users/{body['id']}/approve", headers=prueba)
    assert r.status_code == 403, r.text
    r = client.post(f"/api/users/{body['id']}/reject", headers=prueba)
    assert r.status_code == 403, r.text
    # Sigue pendiente.
    assert _list_users(client, admin_headers)["pend4"]["status"] == "pending"


def test_approve_non_pending_is_409_and_admin_created_is_active(client, admin_headers):
    users = _list_users(client, admin_headers)
    admin_id = users["admin"]["id"]
    assert users["admin"]["status"] == "active"
    r = client.post(f"/api/users/{admin_id}/approve", headers=admin_headers)
    assert r.status_code == 409, r.text

    r = client.post(
        "/api/users",
        json={"username": "creadoadmin", "password": "pass1234", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "active"
