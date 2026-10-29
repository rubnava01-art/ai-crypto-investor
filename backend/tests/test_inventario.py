"""Tests for the Inventario (stock control) module (2026-10-29).

Covers: auth (401 without token), RBAC (prueba reads, admin-only
writes -> 403), validation (blank name, negative quantity/price/min
stock, bad unit -> 422), low_stock computation, and CRUD behavior.
Uses the shared session fixtures only (no extra logins: the login
endpoint is rate-limited across the suite).
"""


def test_inventario_requires_auth(client):
    r = client.get("/api/inventario/items")
    assert r.status_code == 401


def test_inventario_crud_and_validation(client, viewer_headers, admin_headers):
    r = client.get("/api/inventario/items", headers=viewer_headers)
    assert r.status_code == 200
    assert r.json() == []

    # Prueba cannot create.
    r = client.post(
        "/api/inventario/items",
        json={"name": "Intento"},
        headers=viewer_headers,
    )
    assert r.status_code == 403

    # Validation failures.
    for payload in (
        {"name": "   "},
        {"name": "X", "quantity": -1},
        {"name": "X", "unit_price": -5},
        {"name": "X", "min_stock": -1},
        {"name": "X", "unit": "tonelada"},
    ):
        r = client.post("/api/inventario/items", json=payload, headers=admin_headers)
        assert r.status_code == 422, payload

    # Admin creates: 5 <= min 10 -> low stock.
    r = client.post(
        "/api/inventario/items",
        json={
            "name": "Tornillo M6",
            "description": "Acero inoxidable",
            "sku": "TOR-M6",
            "quantity": 5,
            "unit": "pieza",
            "unit_price": 0.5,
            "min_stock": 10,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    item = r.json()
    item_id = item["id"]
    assert item["low_stock"] is True
    assert item["unit_price"] == 0.5

    # Viewer cannot update or delete.
    r = client.put(
        f"/api/inventario/items/{item_id}",
        json={"quantity": 99},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    r = client.delete(f"/api/inventario/items/{item_id}", headers=viewer_headers)
    assert r.status_code == 403

    # Admin restocks above the threshold -> no longer low stock.
    r = client.put(
        f"/api/inventario/items/{item_id}",
        json={"quantity": 20},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["low_stock"] is False
    assert r.json()["quantity"] == 20

    # Admin deletes; list is empty again.
    r = client.delete(f"/api/inventario/items/{item_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.get("/api/inventario/items", headers=viewer_headers)
    assert r.json() == []
