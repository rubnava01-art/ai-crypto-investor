"""CRM tests (Plataforma Unificada — Fase 1): admin CRUD completo;
el rol 'prueba' solo puede leer (403 en POST/PUT/DELETE)."""


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# The login endpoint is rate-limited (10/min across the whole suite), so this
# module logs in at most once per role and reuses the headers.
_CACHE: dict[str, dict] = {}


def _admin(client):
    if "admin" not in _CACHE:
        _CACHE["admin"] = _login(client, "admin", "secret")
    return _CACHE["admin"]


def _viewer(client):
    if "viewer" not in _CACHE:
        h = _admin(client)
        r = client.post(
            "/api/users",
            json={"username": "crmviewer", "password": "viewerpass", "role": "prueba"},
            headers=h,
        )
        assert r.status_code in (201, 409), r.text
        _CACHE["viewer"] = _login(client, "crmviewer", "viewerpass")
    return _CACHE["viewer"]


def _payload(**kw):
    base = {
        "name": "María Prueba CRM",
        "email": "maria.crm@example.com",
        "phone": "555-0101",
        "source": "academia",
        "tags": ["curso", "hotmart"],
        "status": "nuevo",
        "notes": "Lead de la Academia.",
    }
    base.update(kw)
    return base


def test_crm_admin_crud(client):
    h = _admin(client)
    r = client.post("/api/crm/contacts", json=_payload(), headers=h)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["name"] == "María Prueba CRM"
    assert c["source"] == "academia"
    assert c["status"] == "nuevo"
    assert c["tags"] == ["curso", "hotmart"]
    assert c["created_at"] and c["updated_at"]
    cid = c["id"]

    # list contains it
    r = client.get("/api/crm/contacts", headers=h)
    assert r.status_code == 200
    assert any(x["id"] == cid for x in r.json())

    # update via PUT
    r = client.put(
        f"/api/crm/contacts/{cid}",
        json={"status": "cliente", "notes": "Compró el curso."},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cliente"
    assert r.json()["notes"] == "Compró el curso."
    assert r.json()["name"] == "María Prueba CRM"  # untouched fields preserved

    # delete
    r = client.delete(f"/api/crm/contacts/{cid}", headers=h)
    assert r.status_code == 204
    r = client.get("/api/crm/contacts", headers=h)
    assert all(x["id"] != cid for x in r.json())

    # deleting/updating a missing contact -> 404
    assert client.delete(f"/api/crm/contacts/{cid}", headers=h).status_code == 404
    assert client.put(f"/api/crm/contacts/{cid}", json={"name": "X"}, headers=h).status_code == 404


def test_crm_search_and_status_filter(client):
    h = _admin(client)
    a = client.post("/api/crm/contacts", json=_payload(name="Buscable Uno", email="uno@busca.test", status="nuevo"), headers=h)
    assert a.status_code == 201, a.text
    b = client.post("/api/crm/contacts", json=_payload(name="Buscable Dos", email="dos@busca.test", status="cliente"), headers=h)
    assert b.status_code == 201, b.text

    r = client.get("/api/crm/contacts", params={"q": "busca.test"}, headers=h)
    names = {x["name"] for x in r.json()}
    assert {"Buscable Uno", "Buscable Dos"} <= names

    r = client.get("/api/crm/contacts", params={"q": "uno@busca"}, headers=h)
    assert [x["name"] for x in r.json()] == ["Buscable Uno"]

    r = client.get("/api/crm/contacts", params={"status": "cliente", "q": "Buscable"}, headers=h)
    assert [x["name"] for x in r.json()] == ["Buscable Dos"]


def test_crm_validation(client):
    h = _admin(client)
    assert client.post("/api/crm/contacts", json=_payload(status="volando"), headers=h).status_code == 422
    assert client.post("/api/crm/contacts", json=_payload(source="marte"), headers=h).status_code == 422
    assert client.post("/api/crm/contacts", json=_payload(name=""), headers=h).status_code == 422
    assert client.get("/api/crm/contacts", params={"status": "volando"}, headers=h).status_code == 422


def test_crm_requires_auth(client):
    assert client.get("/api/crm/contacts").status_code == 401
    assert client.post("/api/crm/contacts", json=_payload()).status_code == 401


def test_crm_viewer_read_only(client):
    h_admin = _admin(client)
    r = client.post("/api/crm/contacts", json=_payload(name="Solo Lectura CRM"), headers=h_admin)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    h = _viewer(client)
    # can read
    r = client.get("/api/crm/contacts", headers=h)
    assert r.status_code == 200
    assert any(x["id"] == cid for x in r.json())
    # cannot write
    assert client.post("/api/crm/contacts", json=_payload(), headers=h).status_code == 403
    assert client.put(f"/api/crm/contacts/{cid}", json={"status": "cliente"}, headers=h).status_code == 403
    assert client.delete(f"/api/crm/contacts/{cid}", headers=h).status_code == 403
