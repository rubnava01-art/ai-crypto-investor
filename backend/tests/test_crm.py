"""CRM tests (Grow Business Platform — Fase 1): admin CRUD completo;
el rol 'prueba' solo puede leer (403 en POST/PUT/DELETE).

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited (10/min across the
whole suite), so modules must not log in on their own."""


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


def test_crm_admin_crud(client, admin_headers):
    h = admin_headers
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


def test_crm_search_and_status_filter(client, admin_headers):
    h = admin_headers
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


def test_crm_validation(client, admin_headers):
    h = admin_headers
    assert client.post("/api/crm/contacts", json=_payload(status="volando"), headers=h).status_code == 422
    assert client.post("/api/crm/contacts", json=_payload(source="marte"), headers=h).status_code == 422
    assert client.post("/api/crm/contacts", json=_payload(name=""), headers=h).status_code == 422
    assert client.get("/api/crm/contacts", params={"status": "volando"}, headers=h).status_code == 422


def test_crm_requires_auth(client):
    assert client.get("/api/crm/contacts").status_code == 401
    assert client.post("/api/crm/contacts", json=_payload()).status_code == 401


def test_crm_viewer_read_only(client, admin_headers, viewer_headers):
    h_admin = admin_headers
    r = client.post("/api/crm/contacts", json=_payload(name="Solo Lectura CRM"), headers=h_admin)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    h = viewer_headers
    # cannot read either since 2026-11-23 (aislamiento por perfil:
    # crm no está en la demo de prueba).
    r = client.get("/api/crm/contacts", headers=h)
    assert r.status_code == 403, r.text
    r = client.get("/api/crm/contacts", headers=h_admin)
    assert r.status_code == 200
    assert any(x["id"] == cid for x in r.json())
    # cannot write
    assert client.post("/api/crm/contacts", json=_payload(), headers=h).status_code == 403
    assert client.put(f"/api/crm/contacts/{cid}", json={"status": "cliente"}, headers=h).status_code == 403
    assert client.delete(f"/api/crm/contacts/{cid}", headers=h).status_code == 403


# ---------- Fase 5b mejoras-v1, tarea 1: etapas, historial, recordatorios, CSV ----------

def test_crm_stage_change_records_history(client, admin_headers):
    h = admin_headers
    r = client.post("/api/crm/contacts", json=_payload(stage="nuevo"), headers=h)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["stage"] == "nuevo"

    # Alta deja la fila inicial (sin etapa anterior).
    r = client.get(f"/api/crm/contacts/{cid}/historial", headers=h)
    assert r.status_code == 200, r.text
    assert [{"from": x["from_stage"], "to": x["to_stage"]} for x in r.json()] == [
        {"from": None, "to": "nuevo"}
    ]

    # Cambio de etapa: se registra de -> a.
    r = client.put(f"/api/crm/contacts/{cid}", json={"stage": "propuesta"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "propuesta"
    r = client.get(f"/api/crm/contacts/{cid}/historial", headers=h)
    hist = [(x["from_stage"], x["to_stage"]) for x in r.json()]
    assert ("nuevo", "propuesta") in hist

    # Poner la misma etapa no crea fila nueva.
    before = len(r.json())
    client.put(f"/api/crm/contacts/{cid}", json={"stage": "propuesta"}, headers=h)
    r = client.get(f"/api/crm/contacts/{cid}/historial", headers=h)
    assert len(r.json()) == before

    # Etapa inválida -> 422; filtro por etapa.
    assert client.put(f"/api/crm/contacts/{cid}", json={"stage": "inventada"}, headers=h).status_code == 422
    r = client.get("/api/crm/contacts", params={"stage": "propuesta"}, headers=h)
    assert any(x["id"] == cid for x in r.json())
    r = client.get("/api/crm/contacts", params={"stage": "ganado"}, headers=h)
    assert all(x["id"] != cid for x in r.json())
    client.delete(f"/api/crm/contacts/{cid}", headers=h)


def test_crm_reminders_and_hoy(client, admin_headers):
    h = admin_headers
    r = client.post("/api/crm/contacts", json=_payload(name="Con Recordatorio", email="rec@test.local"), headers=h)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    import datetime as dt
    from zoneinfo import ZoneInfo

    # Fecha de HOY en Los Ángeles, no del sistema (UTC): después de las
    # 16:00 PT la fecha UTC ya es mañana y el recordatorio no aparecería
    # en "Hoy".
    today = dt.datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    r = client.post(
        f"/api/crm/contacts/{cid}/recordatorios",
        json={"remind_date": today, "note": "Llamar para la propuesta"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert r.json()["done"] is False

    # "Hoy" muestra el recordatorio de hoy con el nombre del contacto.
    r = client.get("/api/dashboard/hoy", headers=h)
    assert r.status_code == 200, r.text
    recs = r.json()["recordatorios"]
    assert recs is not None
    assert any(x["id"] == rid and x["contact_name"] == "Con Recordatorio" for x in recs)

    # Marcar hecho: desaparece de "Hoy".
    r = client.patch(f"/api/crm/contacts/recordatorios/{rid}", json={"done": True}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["done"] is True
    r = client.get("/api/dashboard/hoy", headers=h)
    assert all(x["id"] != rid for x in (r.json()["recordatorios"] or []))

    client.delete(f"/api/crm/contacts/recordatorios/{rid}", headers=h)
    client.delete(f"/api/crm/contacts/{cid}", headers=h)


def test_crm_csv_export_template_import(client, admin_headers):
    h = admin_headers
    # Plantilla: solo el encabezado con las columnas reales.
    r = client.get("/api/crm/contacts/plantilla", headers=h)
    assert r.status_code == 200, r.text
    assert r.text.strip() == "nombre,email,telefono,origen,etapa,estado,etiquetas,notas"

    csv_text = (
        "nombre,email,telefono,origen,etapa,estado,etiquetas,notas\n"
        "Ana CSV,ana@csv.test,555,manual,contactado,nuevo,curso;vip,Lead del CSV.\n"
        ",sin-nombre@test.local,,manual,nuevo,nuevo,,Sin nombre: fila inválida.\n"
        "Beto Mal,bad@csv.test,,origen-inventado,nuevo,nuevo,,Origen inválido.\n"
        "Celia CSV,celia@csv.test,,academia,propuesta,interesado,,Segunda válida.\n"
    )
    r = client.post(
        "/api/crm/contacts/import",
        content=csv_text.encode("utf-8"),
        headers={**h, "Content-Type": "text/csv"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["creados"] == 2, body
    assert [e["fila"] for e in body["errores"]] == [3, 4], body
    assert all("error" in e for e in body["errores"])

    # Las válidas existen con su etapa; las inválidas no se crearon.
    r = client.get("/api/crm/contacts", params={"q": "csv.test"}, headers=h)
    names = {x["name"] for x in r.json()}
    assert names == {"Ana CSV", "Celia CSV"}
    ana = next(x for x in r.json() if x["name"] == "Ana CSV")
    assert ana["stage"] == "contactado"
    assert ana["tags"] == ["curso", "vip"]
    assert not any(x["email"] == "bad@csv.test" for x in r.json())

    # Exportar incluye las importadas.
    r = client.get("/api/crm/contacts/export", headers=h)
    assert r.status_code == 200, r.text
    assert "Ana CSV" in r.text and "Celia CSV" in r.text
    assert r.text.splitlines()[0] == "nombre,email,telefono,origen,etapa,estado,etiquetas,notas"
    for x in client.get("/api/crm/contacts", params={"q": "csv.test"}, headers=h).json():
        client.delete(f"/api/crm/contacts/{x['id']}", headers=h)
