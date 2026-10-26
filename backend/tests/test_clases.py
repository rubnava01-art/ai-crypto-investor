"""Clases tests: recorded + live classes, admin-only writes, auth.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own.
"""


def test_class_crud_and_kinds(client, admin_headers):
    r = client.post(
        "/api/clases/classes",
        json={"kind": "grabada", "title": "Intro a la Academia", "url": "https://example.com/video1", "duration_min": 45},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["kind"] == "grabada"
    assert row["title"] == "Intro a la Academia"
    cid = row["id"]

    r = client.post(
        "/api/clases/classes",
        json={"kind": "envivo", "title": "Sesión en vivo", "url": "https://meet.example.com/sesion", "scheduled_at": "2026-11-01T18:00:00+00:00"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    live_id = r.json()["id"]

    r = client.get("/api/clases/classes?kind=grabada", headers=admin_headers)
    assert r.status_code == 200
    assert any(d["id"] == cid for d in r.json())
    assert all(d["id"] != live_id for d in r.json())

    r = client.get("/api/clases/classes?kind=envivo", headers=admin_headers)
    assert any(d["id"] == live_id for d in r.json())

    assert client.delete(f"/api/clases/classes/{cid}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/clases/classes/{live_id}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/clases/classes/{cid}", headers=admin_headers).status_code == 404


def test_class_validation(client, admin_headers):
    assert client.post(
        "/api/clases/classes", json={"kind": "otro", "title": "X"}, headers=admin_headers
    ).status_code == 422
    assert client.post(
        "/api/clases/classes", json={"kind": "grabada", "title": ""}, headers=admin_headers
    ).status_code == 422
    assert client.post(
        "/api/clases/classes",
        json={"kind": "envivo", "title": "X", "scheduled_at": "no-fecha"},
        headers=admin_headers,
    ).status_code == 422
    assert client.get("/api/clases/classes?kind=otro", headers=admin_headers).status_code == 422


def test_clases_requires_auth(client):
    assert client.get("/api/clases/classes").status_code == 401
    assert client.post("/api/clases/classes", json={"kind": "grabada", "title": "X"}).status_code == 401


def test_clases_viewer_readonly(client, viewer_headers):
    r = client.get("/api/clases/classes", headers=viewer_headers)
    assert r.status_code == 200
    assert client.post(
        "/api/clases/classes",
        json={"kind": "grabada", "title": "X"},
        headers=viewer_headers,
    ).status_code == 403
