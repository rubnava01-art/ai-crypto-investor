"""Auth: protected routes require a valid bearer token."""


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_protected_route_without_token_is_401(client):
    r = client.get("/api/system/status")
    assert r.status_code == 401


def test_protected_route_with_bad_token_is_401(client):
    r = client.get("/api/system/status", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_login_wrong_password_is_401(client):
    r = client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert r.status_code == 401


def test_login_ok_returns_token(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200
    assert r.json()["token_type"] == "bearer"
    assert len(r.json()["access_token"]) > 20


def test_protected_route_with_token_ok(client, auth_headers):
    r = client.get("/api/system/status", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "demo"
    assert body["data_source"] == "DEMO"
