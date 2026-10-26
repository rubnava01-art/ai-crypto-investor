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
    r = client.get("/api/facturas/invoices", headers=viewer_headers)
    assert r.status_code == 200
    assert client.post(
        "/api/facturas/invoices",
        json={"client_name": "X", "items": ITEMS},
        headers=viewer_headers,
    ).status_code == 403
