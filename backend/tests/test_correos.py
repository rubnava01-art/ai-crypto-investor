"""Correos tests: templates + email log, admin-only writes, auth.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own.
"""


def test_template_and_log_crud(client, admin_headers):
    r = client.post(
        "/api/correos/templates",
        json={"name": "Seguimiento diseño", "subject": "Tu diseño, {{nombre}}", "body": "Hola {{nombre}}, aquí va tu diseño."},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["name"] == "Seguimiento diseño"
    tpl_id = tpl["id"]

    r = client.get("/api/correos/templates", headers=admin_headers)
    assert any(d["id"] == tpl_id for d in r.json())

    r = client.post(
        "/api/correos/logs",
        json={"contact_name": "TJ's Restaurant", "contact_email": "catering@tjsbrea.com", "template_name": "Seguimiento diseño", "subject": "Tu diseño, TJ's", "body": "Hola TJ's"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    log = r.json()
    assert log["status"] == "preparado"
    log_id = log["id"]

    r = client.patch(
        f"/api/correos/logs/{log_id}", json={"status": "enviado"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "enviado"
    assert client.patch(
        f"/api/correos/logs/{log_id}", json={"status": "otro"}, headers=admin_headers
    ).status_code == 422

    assert client.delete(f"/api/correos/logs/{log_id}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/correos/templates/{tpl_id}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/correos/templates/{tpl_id}", headers=admin_headers).status_code == 404


def test_correos_requires_auth(client):
    assert client.get("/api/correos/templates").status_code == 401
    assert client.get("/api/correos/logs").status_code == 401
    assert client.post("/api/correos/templates", json={"name": "X"}).status_code == 401


def test_correos_viewer_readonly(client, viewer_headers):
    r = client.get("/api/correos/templates", headers=viewer_headers)
    assert r.status_code == 200
    assert client.post(
        "/api/correos/templates", json={"name": "X"}, headers=viewer_headers
    ).status_code == 403
