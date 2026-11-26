"""Business module tests (Grow Business Platform — módulo Business):
admin has full CRUD on notes/tasks per area; 'prueba' reads only
(403 on writes); no token -> 401; notes/tasks are strictly scoped
per area and never leak across areas.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own.
"""


def test_business_admin_flow_and_area_scoping(client, admin_headers):
    h = admin_headers
    # marketing note + task
    r = client.post(
        "/api/business/marketing/notes",
        json={"title": "Idea campaña", "body": "Lanzar en Threads."},
        headers=h,
    )
    assert r.status_code == 201, r.text
    note = r.json()
    assert note["area"] == "marketing" and note["title"] == "Idea campaña"
    nid = note["id"]

    r = client.post("/api/business/marketing/tasks", json={"title": "Publicar reel"}, headers=h)
    assert r.status_code == 201, r.text
    task = r.json()
    assert task["area"] == "marketing" and task["done"] is False
    tid = task["id"]

    # ventas area starts empty: no leak across areas
    r = client.get("/api/business/ventas/notes", headers=h)
    assert r.status_code == 200 and r.json() == []
    r = client.get("/api/business/ventas/tasks", headers=h)
    assert r.status_code == 200 and r.json() == []

    # marketing lists contain exactly what was created
    r = client.get("/api/business/marketing/notes", headers=h)
    assert [n["id"] for n in r.json()] == [nid]
    r = client.get("/api/business/marketing/tasks", headers=h)
    assert [t["id"] for t in r.json()] == [tid]

    # edit note, toggle task done
    r = client.put(f"/api/business/notes/{nid}", json={"body": "Lanzar en Threads e IG."}, headers=h)
    assert r.status_code == 200 and r.json()["body"] == "Lanzar en Threads e IG."
    r = client.patch(f"/api/business/tasks/{tid}", json={"done": True}, headers=h)
    assert r.status_code == 200 and r.json()["done"] is True

    # delete both
    r = client.delete(f"/api/business/notes/{nid}", headers=h)
    assert r.status_code == 204, r.text
    r = client.delete(f"/api/business/tasks/{tid}", headers=h)
    assert r.status_code == 204, r.text
    r = client.get("/api/business/marketing/notes", headers=h)
    assert r.json() == []
    r = client.get("/api/business/marketing/tasks", headers=h)
    assert r.json() == []


def test_business_invalid_area_rejected(client, admin_headers):
    r = client.get("/api/business/contabilidad/notes", headers=admin_headers)
    assert r.status_code == 422
    r = client.post(
        "/api/business/contabilidad/tasks", json={"title": "X"}, headers=admin_headers
    )
    assert r.status_code == 422


def test_business_not_found(client, admin_headers):
    r = client.put("/api/business/notes/999999", json={"title": "X"}, headers=admin_headers)
    assert r.status_code == 404
    r = client.delete("/api/business/tasks/999999", headers=admin_headers)
    assert r.status_code == 404


def test_business_auth_required(client):
    r = client.get("/api/business/legal/notes")
    assert r.status_code == 401
    r = client.get("/api/business/legal/tasks")
    assert r.status_code == 401


def test_business_viewer_read_only(client, viewer_headers, admin_headers):
    # Fase 0 (2026-11-23, mejoras óptimas, P0-1): prueba recibe 403
    # también en lectura (antes leía notas y tareas).
    r = client.get("/api/business/administrativo/notes", headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.get("/api/business/administrativo/tasks", headers=viewer_headers)
    assert r.status_code == 403, r.text
    # viewer cannot write (403 on every write route)
    r = client.post(
        "/api/business/administrativo/notes",
        json={"title": "Nope", "body": ""},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    r = client.post(
        "/api/business/administrativo/tasks", json={"title": "Nope"}, headers=viewer_headers
    )
    assert r.status_code == 403
    # create as admin, then viewer cannot update/delete
    r = client.post(
        "/api/business/administrativo/tasks", json={"title": "Pagar renta"}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    r = client.patch(f"/api/business/tasks/{tid}", json={"done": True}, headers=viewer_headers)
    assert r.status_code == 403
    r = client.delete(f"/api/business/tasks/{tid}", headers=viewer_headers)
    assert r.status_code == 403
    # cleanup as admin
    r = client.delete(f"/api/business/tasks/{tid}", headers=admin_headers)
    assert r.status_code == 204


# ---------- Fase 5b mejoras-v1, tarea 5: notificaciones en la app ----------

def test_business_notificaciones_vencidas_y_hoy(client, admin_headers):
    import datetime as dt

    h = admin_headers
    # "Hoy" en LA puede diferir del UTC del sistema: se calcula igual
    # que el backend (America/Los_Angeles) para no depender de la hora.
    from zoneinfo import ZoneInfo

    hoy = dt.datetime.now(ZoneInfo("America/Los_Angeles")).date()
    ayer = (hoy - dt.timedelta(days=1)).isoformat()
    manana = (hoy + dt.timedelta(days=1)).isoformat()

    def _mk(area, title, due):
        r = client.post(f"/api/business/{area}/tasks", json={"title": title, "due_date": due}, headers=h)
        assert r.status_code == 201, r.text
        return r.json()

    vencida = _mk("ventas", "Notificacion Vencida", ayer)
    de_hoy = _mk("legal", "Notificacion Hoy", hoy.isoformat())
    futura = _mk("ventas", "Notificacion Futura", manana)
    sin_fecha = _mk("ventas", "Notificacion Sin Fecha", None)
    hecha = _mk("ventas", "Notificacion Hecha Vencida", ayer)
    client.patch(f"/api/business/tasks/{hecha['id']}", json={"done": True}, headers=h)

    r = client.get("/api/business/notificaciones", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fecha"] == hoy.isoformat()
    assert [t["id"] for t in body["vencidas"]] == [vencida["id"]]
    assert [t["id"] for t in body["de_hoy"]] == [de_hoy["id"]]
    # La futura, la sin fecha y la hecha no aparecen en ningún grupo.
    ids = {t["id"] for t in body["vencidas"] + body["de_hoy"]}
    assert futura["id"] not in ids and sin_fecha["id"] not in ids and hecha["id"] not in ids

    for row in (vencida, de_hoy, futura, sin_fecha, hecha):
        client.delete(f"/api/business/tasks/{row['id']}", headers=h)
