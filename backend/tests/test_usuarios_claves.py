"""Claves y modificación de usuarios (2026-11-21).

Regresión de la causa raíz: el formulario de Control de usuarios
aceptaba claves de 4 caracteres ("mín. 4") pero el backend exige 12
(decisión de Rubén 2026-11-02) — el cambio fallaba con un 422 en
inglés y parecía que "no funcionaba cambiar claves". El mínimo de 12
se mantiene; el arreglo está en el frontend (12 en UI y mensajes).
Estos tests fijan el contrato del backend: <12 -> 422, >=12 -> 200 y
login con la nueva clave; cambio propio con clave actual; renombrar.

Login-budget (ver conftest/test_acceso): los logins reales se usan
solo donde el login mismo es lo que se verifica; cada test crea sus
propios usuarios desechables para no tocar los fixtures compartidos
(admin semilla, viewer de la suite).
"""
import uuid

from app.core.security import create_access_token, verify_password
from app.models.tables import User
from tests.conftest import TestingSession


def _hash_ok(username, password):
    """La clave guardada en BD verifica contra `password` (sin gastar
    el presupuesto de logins del endpoint, 10/min por IP)."""
    db = TestingSession()
    try:
        u = db.query(User).filter(User.username == username).first()
        return u is not None and verify_password(password, u.password_hash)
    finally:
        db.close()



def _mint(uid, name):
    """Token con `tv` como el del login real, sin gastar el presupuesto
    de logins (10/min por IP): token_version 0 para usuarios nuevos."""
    return {
        "Authorization": f"Bearer {create_access_token(name, user_id=uid, token_version=0)}"
    }


def _mk_user(client, admin_headers, role="prueba"):
    name = "u" + uuid.uuid4().hex[:10]
    r = client.post(
        "/api/users",
        json={"username": name, "password": "origpass1234", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"], name



def test_admin_patch_short_password_rejected(client, admin_headers):
    """<12 caracteres -> 422 (el contrato que el frontend debe reflejar)."""
    uid, name = _mk_user(client, admin_headers)
    try:
        for short in ("clav", "clave123", "clave123456"):
            r = client.patch(
                f"/api/users/{uid}", json={"password": short}, headers=admin_headers
            )
            assert r.status_code == 422, (short, r.status_code, r.text)
        # La clave vieja sigue valiendo: el rechazo no la tocó.
        assert _hash_ok(name, "origpass1234")
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)


def test_admin_patch_password_ok_and_old_token_revoked(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    try:
        # Token con `tv` para probar revocación (acuñado, no login real).
        h = _mint(uid, name)
        assert client.get("/api/auth/me", headers=h).status_code == 200
        r = client.patch(
            f"/api/users/{uid}",
            json={"password": "nuevaclave123"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        # La clave guardada es la nueva (si el hash viejo siguiera, esto
        # fallaría) y la vieja ya no verifica.
        assert _hash_ok(name, "nuevaclave123")
        assert not _hash_ok(name, "origpass1234")
        # El token anterior quedó revocado por el cambio de clave.
        assert client.get("/api/auth/me", headers=h).status_code == 401
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)


def test_admin_changing_own_password_revokes_own_token(client, admin_headers):
    """El admin que se cambia su propia clave pierde su sesión: el
    cliente debe avisarle y mandarlo al login (no dejarlo atascado)."""
    uid, name = _mk_user(client, admin_headers, role="admin")
    try:
        h = _mint(uid, name)
        r = client.patch(
            f"/api/users/{uid}", json={"password": "adminnueva123"}, headers=h
        )
        assert r.status_code == 200, r.text
        assert client.get("/api/auth/me", headers=h).status_code == 401
        assert _hash_ok(name, "adminnueva123")
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)


def test_change_password_self(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    try:
        h = _mint(uid, name)
        # Clave actual incorrecta -> 401, sin cambiar nada.
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "noesesta1234", "new_password": "mipropia12345"},
            headers=h,
        )
        assert r.status_code == 401, r.text
        # Nueva demasiado corta -> 422.
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "origpass1234", "new_password": "corta123"},
            headers=h,
        )
        assert r.status_code == 422, r.text
        # Igual a la actual -> 400.
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "origpass1234", "new_password": "origpass1234"},
            headers=h,
        )
        assert r.status_code == 400, r.text
        # Camino feliz.
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "origpass1234", "new_password": "mipropia12345"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert _hash_ok(name, "mipropia12345")
        assert not _hash_ok(name, "origpass1234")
        # La sesión con la que se cambió quedó revocada.
        assert client.get("/api/auth/me", headers=h).status_code == 401
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)


def test_change_password_requires_auth(client):
    r = client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "nuevaclave123"},
    )
    assert r.status_code == 401, r.text


def test_prueba_cannot_patch_others_but_can_change_own(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    viewer_id, viewer_name = _mk_user(client, admin_headers, role="prueba")
    try:
        h = _mint(viewer_id, viewer_name)
        r = client.patch(
            f"/api/users/{uid}", json={"password": "nopuedocambiar"}, headers=h
        )
        assert r.status_code == 403, r.text
        # ... pero sí puede cambiar su propia clave.
        r = client.post(
            "/api/auth/change-password",
            json={"current_password": "origpass1234", "new_password": "viewernew1234"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert _hash_ok(viewer_name, "viewernew1234")
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)
        client.delete(f"/api/users/{viewer_id}", headers=admin_headers)


def test_rename_user(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    new_name = "u" + uuid.uuid4().hex[:10]
    try:
        h = _mint(uid, name)
        r = client.patch(
            f"/api/users/{uid}", json={"username": new_name}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["username"] == new_name
        assert _hash_ok(new_name, "origpass1234")
        assert not _hash_ok(name, "origpass1234")
        # El token con el nombre viejo quedó revocado.
        assert client.get("/api/auth/me", headers=h).status_code == 401
        # Nombre ya usado -> 409.
        uid2, _name2 = _mk_user(client, admin_headers)
        try:
            r = client.patch(
                f"/api/users/{uid2}", json={"username": new_name}, headers=admin_headers
            )
            assert r.status_code == 409, r.text
        finally:
            client.delete(f"/api/users/{uid2}", headers=admin_headers)
    finally:
        client.delete(f"/api/users/{uid}", headers=admin_headers)
