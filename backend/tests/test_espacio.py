"""Espacio tests: revelations journal — CRUD, admin-only writes, auth.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own.
"""


def test_revelation_crud(client, admin_headers):
    r = client.post(
        "/api/espacio/revelations",
        json={"title": "Calma antes de decidir", "text": "Respirar primero, decidir después."},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["title"] == "Calma antes de decidir"
    assert row["text"] == "Respirar primero, decidir después."
    rid = row["id"]

    r = client.get("/api/espacio/revelations", headers=admin_headers)
    assert r.status_code == 200
    assert any(d["id"] == rid for d in r.json())

    assert client.delete(f"/api/espacio/revelations/{rid}", headers=admin_headers).status_code == 204
    r = client.get("/api/espacio/revelations", headers=admin_headers)
    assert all(d["id"] != rid for d in r.json())
    assert client.delete(f"/api/espacio/revelations/{rid}", headers=admin_headers).status_code == 404


def test_revelation_validation(client, admin_headers):
    assert client.post(
        "/api/espacio/revelations", json={"title": ""}, headers=admin_headers
    ).status_code == 422


def test_espacio_requires_auth(client):
    assert client.get("/api/espacio/revelations").status_code == 401
    assert client.post("/api/espacio/revelations", json={"title": "X"}).status_code == 401


def test_espacio_viewer_readonly(client, viewer_headers):
    r = client.get("/api/espacio/revelations", headers=viewer_headers)
    assert r.status_code == 200
    assert client.post(
        "/api/espacio/revelations", json={"title": "X"}, headers=viewer_headers
    ).status_code == 403
