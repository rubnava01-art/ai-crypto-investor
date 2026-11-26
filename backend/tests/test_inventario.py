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
    # Lectura también 403 desde 2026-11-23 (inventario fuera de la demo).
    r = client.get("/api/inventario/items", headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.get("/api/inventario/items", headers=admin_headers)
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
    r = client.get("/api/inventario/items", headers=admin_headers)
    assert r.json() == []


# ---------- Fase 5b mejoras-v1, tarea 3: historial de movimientos ----------

def _mk_item(client, admin_headers, **kw):
    body = {"name": "Historial Test", "quantity": 10, "unit": "pieza", "unit_price": 1.0, "min_stock": 2}
    body.update(kw)
    r = client.post("/api/inventario/items", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_inventario_movements_history(client, admin_headers):
    h = admin_headers
    item = _mk_item(client, h, name="Historial Uno", sku="HIST-1")
    iid = item["id"]

    # La creación con stock inicial deja una entrada de +10.
    r = client.get(f"/api/inventario/items/{iid}/movimientos", headers=h)
    assert r.status_code == 200, r.text
    movs = r.json()
    assert len(movs) == 1
    assert movs[0]["tipo"] == "entrada" and movs[0]["cantidad_delta"] == 10
    assert movs[0]["cantidad_final"] == 10 and movs[0]["motivo"] == "Stock inicial"

    # PUT con cantidad distinta: ajuste con motivo.
    r = client.put(f"/api/inventario/items/{iid}", json={"quantity": 14, "motivo": "Compra a proveedor"}, headers=h)
    assert r.status_code == 200, r.text
    # PUT con la misma cantidad: no crea movimiento.
    client.put(f"/api/inventario/items/{iid}", json={"quantity": 14}, headers=h)

    # Venta explícita de 3: stock 11.
    r = client.post(
        f"/api/inventario/items/{iid}/movimientos",
        json={"tipo": "venta", "cantidad": -3, "motivo": "Venta mostrador"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["cantidad_final"] == 11

    r = client.get(f"/api/inventario/items/{iid}/movimientos", headers=h)
    movs = r.json()
    assert len(movs) == 3, movs
    tipos = [(m["tipo"], m["cantidad_delta"], m["cantidad_final"]) for m in movs]
    assert ("venta", -3, 11) in tipos
    assert ("ajuste", 4, 14) in tipos
    assert any(m["motivo"] == "Venta mostrador" for m in movs)
    assert any(m["motivo"] == "Compra a proveedor" for m in movs)

    # Validación: vender más de lo que hay, venta con signo positivo,
    # entrada con signo negativo y cantidad 0 son 422 y no mueven nada.
    for bad in (
        {"tipo": "venta", "cantidad": -99},
        {"tipo": "venta", "cantidad": 2},
        {"tipo": "entrada", "cantidad": -2},
        {"tipo": "ajuste", "cantidad": 0},
        {"tipo": "otro", "cantidad": 1},
    ):
        assert client.post(f"/api/inventario/items/{iid}/movimientos", json=bad, headers=h).status_code == 422, bad
    # El item sigue en 11: ningún movimiento inválido tocó el stock.
    r = client.get("/api/inventario/items", headers=h)
    item_now = next(x for x in r.json() if x["id"] == iid)
    assert item_now["quantity"] == 11

    # El historial es por producto: otro producto no ve estos movimientos.
    other = _mk_item(client, h, name="Historial Dos", sku="HIST-2", quantity=0)
    r = client.get(f"/api/inventario/items/{other['id']}/movimientos", headers=h)
    assert r.json() == []
    # 404 en producto inexistente.
    assert client.get("/api/inventario/items/999999/movimientos", headers=h).status_code == 404

    client.delete(f"/api/inventario/items/{iid}", headers=h)
    client.delete(f"/api/inventario/items/{other['id']}", headers=h)
