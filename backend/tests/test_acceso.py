"""Acceso tests: public registration with the human check, and the
admin / super admin tiers.

Login-budget rule (see conftest): the login endpoint is rate-limited
(10/min per IP) across the whole suite, so this module mints JWTs
directly with create_access_token for authorization checks instead of
calling /api/auth/login. The login endpoint itself is covered by
test_auth.py and the shared session fixtures.
"""
import re

from app.core.security import create_access_token


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    return data["challenge_id"], int(m.group(1)) + int(m.group(2))


def _token(username):
    return {"Authorization": f"Bearer {create_access_token(username)}"}


def test_register_human_check_and_prueba_role(client, admin_headers):
    cid, answer = _challenge(client)
    # Wrong answer -> rejected, challenge consumed.
    r = client.post(
        "/api/auth/register",
        json={"username": "nuevo1", "password": "pass1234", "challenge_id": cid, "answer": answer + 1},
    )
    assert r.status_code == 400
    # Same challenge cannot be replayed.
    r = client.post(
        "/api/auth/register",
        json={"username": "nuevo1", "password": "pass1234", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 400

    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={"username": "nuevo1", "password": "pass1234", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "prueba"
    assert r.json()["is_admin"] is False

    # Duplicate username -> 409 (with a fresh challenge).
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={"username": "nuevo1", "password": "pass1234", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 409

    # The registered account is usable and cannot touch controls.
    h = _token("nuevo1")
    assert client.get("/api/users", headers=h).status_code == 403
    me = client.get("/api/auth/me", headers=h).json()
    assert me["role"] == "prueba"

    # Cleanup via the seeded super admin.
    users = client.get("/api/users", headers=admin_headers).json()
    uid = [u for u in users if u["username"] == "nuevo1"][0]["id"]
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204


def test_super_admin_tier_guards(client, admin_headers):
    # A plain admin (created by the super admin) cannot grant super status
    # and cannot touch the super admin's account.
    r = client.post(
        "/api/users",
        json={"username": "adminplano", "password": "pass1234", "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    plain_id = r.json()["id"]
    plain_h = _token("adminplano")

    users = client.get("/api/users", headers=admin_headers).json()
    super_id = [u for u in users if u["is_super_admin"]][0]["id"]
    assert super_id != plain_id

    assert client.patch(
        f"/api/users/{plain_id}", json={"role": "super_admin"}, headers=plain_h
    ).status_code == 403
    assert client.patch(
        f"/api/users/{super_id}", json={"role": "prueba"}, headers=plain_h
    ).status_code == 403
    assert client.delete(f"/api/users/{super_id}", headers=plain_h).status_code == 403

    # The super admin CAN promote, and the promoted user reports the tier.
    r = client.patch(
        f"/api/users/{plain_id}", json={"role": "super_admin"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "super_admin"
    assert r.json()["is_super_admin"] is True

    # A super admin cannot remove their own super status (seeded admin on itself).
    assert client.patch(
        f"/api/users/{super_id}", json={"role": "admin"}, headers=admin_headers
    ).status_code == 400

    # Cleanup: super admin demotes + deletes the extra account.
    assert client.patch(
        f"/api/users/{plain_id}", json={"role": "prueba"}, headers=admin_headers
    ).status_code == 200
    assert client.delete(f"/api/users/{plain_id}", headers=admin_headers).status_code == 204
