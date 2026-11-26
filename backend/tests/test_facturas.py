"""Facturas tests: invoice CRUD + status, admin-only writes, auth.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own.
"""

ITEMS = [{"description": "Camisetas logo frente y espalda", "qty": 10, "unit_price": 25.0}]


def test_invoice_crud_and_status(client, admin_headers):
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": "TJ's Restaurant", "items": ITEMS, "tax_rate": 0},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["number"].startswith("INV-")
    assert row["client_name"] == "TJ's Restaurant"
    assert row["status"] == "borrador"
    iid = row["id"]

    r = client.get("/api/facturas/invoices", headers=admin_headers)
    assert r.status_code == 200
    assert any(d["id"] == iid for d in r.json())

    r = client.patch(
        f"/api/facturas/invoices/{iid}", json={"status": "pagada"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pagada"

    assert client.patch(
        f"/api/facturas/invoices/{iid}", json={"status": "otra"}, headers=admin_headers
    ).status_code == 422

    assert client.delete(f"/api/facturas/invoices/{iid}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/facturas/invoices/{iid}", headers=admin_headers).status_code == 404


def test_invoice_validation(client, admin_headers):
    assert client.post(
        "/api/facturas/invoices",
        json={"client_name": "X", "items": []},
        headers=admin_headers,
    ).status_code == 422
    assert client.post(
        "/api/facturas/invoices",
        json={"client_name": "", "items": ITEMS},
        headers=admin_headers,
    ).status_code == 422


def test_facturas_requires_auth(client):
    assert client.get("/api/facturas/invoices").status_code == 401
    assert client.post(
        "/api/facturas/invoices", json={"client_name": "X", "items": ITEMS}
    ).status_code == 401


def test_facturas_viewer_readonly(client, viewer_headers):
    # Lectura también 403 desde 2026-11-23 (facturas fuera de la demo).
    r = client.get("/api/facturas/invoices", headers=viewer_headers)
    assert r.status_code == 403, r.text
    assert client.post(
        "/api/facturas/invoices",
        json={"client_name": "X", "items": ITEMS},
        headers=viewer_headers,
    ).status_code == 403


# ---------- Fase 5b mejoras-v1, tarea 2: numeración automática y estado de cobro ----------

def test_invoice_autonumber_sequence_no_reuse(client, admin_headers):
    h = admin_headers
    a = client.post("/api/facturas/invoices", json={"client_name": "Auto Uno", "items": ITEMS}, headers=h)
    assert a.status_code == 201, a.text
    b = client.post("/api/facturas/invoices", json={"client_name": "Auto Dos", "items": ITEMS}, headers=h)
    assert b.status_code == 201, b.text
    # Secuencia INV-001, INV-002...: números distintos, sin huecos entre
    # los creados, y sin reutilizar un número que sigue existiendo.
    na, nb = a.json()["number"], b.json()["number"]
    assert na.startswith("INV-") and nb.startswith("INV-") and na != nb
    assert int(nb.split("-")[1]) == int(na.split("-")[1]) + 1
    # Número explícito se respeta y no se puede duplicar.
    c = client.post(
        "/api/facturas/invoices",
        json={"client_name": "Explicita", "number": "FAC-2026-001", "items": ITEMS},
        headers=h,
    )
    assert c.status_code == 201, c.text
    assert c.json()["number"] == "FAC-2026-001"
    assert client.post(
        "/api/facturas/invoices",
        json={"client_name": "Duplicada", "number": "FAC-2026-001", "items": ITEMS},
        headers=h,
    ).status_code == 409
    # Borrar la primera y crear otra: el número borrado no se reutiliza
    # mientras el segundo sigue existiendo (no hay dos facturas con el
    # mismo número); la nueva no choca con ninguna existente.
    client.delete(f"/api/facturas/invoices/{a.json()['id']}", headers=h)
    d = client.post("/api/facturas/invoices", json={"client_name": "Auto Tres", "items": ITEMS}, headers=h)
    assert d.status_code == 201, d.text
    assert d.json()["number"] not in (nb, "FAC-2026-001")
    for row in (b.json(), c.json(), d.json()):
        client.delete(f"/api/facturas/invoices/{row['id']}", headers=h)


def test_invoice_estado_cobro_por_vencimiento(client, admin_headers):
    import datetime as dt

    h = admin_headers
    hoy = dt.date.today()
    ayer = (hoy - dt.timedelta(days=1)).isoformat()
    futuro = (hoy + dt.timedelta(days=30)).isoformat()

    def _mk(name, **kw):
        body = {"client_name": name, "items": ITEMS}
        body.update(kw)
        r = client.post("/api/facturas/invoices", json=body, headers=h)
        assert r.status_code == 201, r.text
        return r.json()

    # Borrador sin fecha: pendiente.
    borrador = _mk("Cobro Borrador")
    assert borrador["estado_cobro"] == "pendiente"
    # Enviada vencida (ayer): vencida. Enviada futura: pendiente.
    vencida = _mk("Cobro Vencida", due_date=ayer)
    client.patch(f"/api/facturas/invoices/{vencida['id']}", json={"status": "enviada"}, headers=h)
    futura = _mk("Cobro Futura", due_date=futuro)
    client.patch(f"/api/facturas/invoices/{futura['id']}", json={"status": "enviada"}, headers=h)
    r = client.get("/api/facturas/invoices", headers=h)
    by_id = {x["id"]: x for x in r.json()}
    assert by_id[vencida["id"]]["estado_cobro"] == "vencida"
    assert by_id[futura["id"]]["estado_cobro"] == "pendiente"
    # Pagada (aunque su fecha ya pasó): pagada, nunca vencida.
    client.patch(f"/api/facturas/invoices/{vencida['id']}", json={"status": "pagada"}, headers=h)
    r = client.get("/api/facturas/invoices", headers=h)
    by_id = {x["id"]: x for x in r.json()}
    assert by_id[vencida["id"]]["estado_cobro"] == "pagada"
    for row in (borrador, vencida, futura):
        client.delete(f"/api/facturas/invoices/{row['id']}", headers=h)
