"""RBAC tests: admin has full control; 'prueba' users can view + run tests only."""
def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _admin(client):
    return _login(client, "admin", "secret")


def _make_viewer(client):
    h = _admin(client)
    r = client.post("/api/users", json={"username": "viewer1", "password": "viewerpass", "role": "prueba"}, headers=h)
    assert r.status_code in (201, 409), r.text
    return _login(client, "viewer1", "viewerpass")


def test_me_reports_role(client):
    r = client.get("/api/auth/me", headers=_admin(client))
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    assert r.json()["is_admin"] is True


def test_admin_user_crud(client):
    h = _admin(client)
    r = client.post("/api/users", json={"username": "nuevo", "password": "pass1234", "role": "prueba"}, headers=h)
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    assert r.json()["role"] == "prueba"

    r = client.get("/api/users", headers=h)
    assert r.status_code == 200
    names = [u["username"] for u in r.json()]
    assert "nuevo" in names and "admin" in names

    r = client.patch(f"/api/users/{uid}", json={"role": "admin"}, headers=h)
    assert r.status_code == 200 and r.json()["is_admin"] is True

    r = client.delete(f"/api/users/{uid}", headers=h)
    assert r.status_code == 204

    r = client.post("/api/users", json={"username": "admin", "password": "xxxx", "role": "prueba"}, headers=h)
    assert r.status_code == 409


def test_admin_cannot_delete_self_or_demote_self(client):
    h = _admin(client)
    users = client.get("/api/users", headers=h).json()
    admin_id = [u for u in users if u["username"] == "admin"][0]["id"]
    assert client.delete(f"/api/users/{admin_id}", headers=h).status_code == 400
    assert client.patch(f"/api/users/{admin_id}", json={"role": "prueba"}, headers=h).status_code == 400


def test_viewer_blocked_from_controls(client):
    h = _make_viewer(client)
    assert client.get("/api/users", headers=h).status_code == 403
    assert client.post("/api/users", json={"username": "x1", "password": "pass1234"}, headers=h).status_code == 403
    assert client.post("/api/scanner/start", headers=h).status_code == 403
    assert client.post("/api/scanner/stop", headers=h).status_code == 403
    assert client.post("/api/simulation/mode", json={"mode": "paper"}, headers=h).status_code == 403
    assert client.post("/api/risk/kill-switch", headers=h).status_code == 403


def test_viewer_can_view_and_test(client):
    h = _make_viewer(client)
    assert client.get("/api/system/status", headers=h).status_code == 200
    assert client.get("/api/market/prices", headers=h).status_code in (200, 503)
    me = client.get("/api/auth/me", headers=h)
    assert me.json()["role"] == "prueba"
    # backtest run = a "test" -> allowed for viewers (may 422 on payload, must not be 403)
    r = client.post("/api/backtest/run", json={}, headers=h)
    assert r.status_code != 403
