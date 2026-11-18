"""NEST — Business Intelligence (plan conjunto §7).

Fixtures compartidas. NINGÚN test hace login propio.

La suite comparte una sola BD: otros módulos crean facturas y
contactos en el mismo periodo. Por eso el test principal mide
DELTAS (resumen antes/después de sembrar datos propios) en vez de
totales absolutos, y el test de vacío usa un rango 2030 sin datos.
"""
import datetime as dt
import uuid

BASE = "/api/business/marketing/bi"
NOV = "from=2026-11-01&to=2026-11-30"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _mk_contact(client, admin_headers, name: str) -> dict:
    r = client.post(
        "/api/crm/contacts",
        json={"name": name, "email": "", "phone": "", "source": "manual",
              "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_invoice(client, admin_headers, contact: dict, qty, price,
                status: str = "borrador", tax: float = 0) -> dict:
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": contact["name"], "contact_id": contact["id"],
              "items": [{"description": "Servicio", "qty": qty,
                         "unit_price": price}],
              "tax_rate": tax},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    inv = r.json()
    if status != "borrador":
        r = client.patch(
            f"/api/facturas/invoices/{inv['id']}", json={"status": status},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
    return inv


def _mk_cost(client, admin_headers, date: str, category: str, amount) -> dict:
    r = client.post(
        f"{BASE}/costos",
        json={"date": date, "category": category,
              "concept": _uid("Costo"), "amount": amount},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_resumen_con_datos_reales_y_rentabilidad_decimal(client, admin_headers):
    contact_a = _mk_contact(client, admin_headers, _uid("BIA"))
    contact_b = _mk_contact(client, admin_headers, _uid("BIB"))
    before = client.get(f"{BASE}/resumen?{NOV}", headers=admin_headers).json()
    # Ventas: A pagada 2x50 con 10% IVA = 110; A enviada 1x200 = 200;
    # A borrador 1x999 (excluida de ventas); B pagada 1x30 = 30.
    _mk_invoice(client, admin_headers, contact_a, 2, 50,
                status="pagada", tax=10)
    _mk_invoice(client, admin_headers, contact_a, 1, 200, status="enviada")
    _mk_invoice(client, admin_headers, contact_a, 1, 999, status="borrador")
    _mk_invoice(client, admin_headers, contact_b, 1, 30, status="pagada")
    # Costos en noviembre: 40 publicidad + 25 herramientas = 65.
    # Costo de octubre: fuera del rango, no cuenta.
    _mk_cost(client, admin_headers, "2026-11-10", "publicidad", 40)
    _mk_cost(client, admin_headers, "2026-11-12", "herramientas", 25)
    _mk_cost(client, admin_headers, "2026-10-15", "servicios", 10)
    after = client.get(f"{BASE}/resumen?{NOV}", headers=admin_headers).json()
    ventas_b, ventas_a = before["ventas"], after["ventas"]
    assert ventas_a["total_pagado"] - ventas_b["total_pagado"] == 140
    assert ventas_a["total_enviado"] - ventas_b["total_enviado"] == 200
    assert ventas_a["n_facturas"] - ventas_b["n_facturas"] == 4
    assert (ventas_a["por_estado"]["pagada"]
            - ventas_b["por_estado"]["pagada"]) == 2
    assert (ventas_a["por_estado"]["enviada"]
            - ventas_b["por_estado"]["enviada"]) == 1
    assert (ventas_a["por_estado"]["borrador"]
            - ventas_b["por_estado"]["borrador"]) == 1
    costos_b, costos_a = before["costos"], after["costos"]
    assert costos_a["total"] - costos_b["total"] == 65
    assert (costos_a["por_categoria"].get("publicidad", 0)
            - costos_b["por_categoria"].get("publicidad", 0)) == 40
    assert (costos_a["por_categoria"].get("herramientas", 0)
            - costos_b["por_categoria"].get("herramientas", 0)) == 25
    # Rentabilidad exacta con Decimal: pagado − costos del periodo.
    assert after["costos_sin_datos"] is False
    assert after["rentabilidad"] == round(
        after["ventas"]["total_pagado"] - after["costos"]["total"], 2
    )
    assert after["clientes"]["total"] >= 2
    assert after["clientes"]["nuevos_en_periodo"] >= 2
    assert after["clientes"]["por_status"].get("cliente", 0) >= 2


def test_resumen_vacio_ceros_y_sin_datos(client, admin_headers):
    r = client.get(
        f"{BASE}/resumen?from=2030-01-01&to=2030-01-31", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ventas"] == {
        "total_pagado": 0, "total_enviado": 0, "n_facturas": 0,
        "por_estado": {"borrador": 0, "enviada": 0, "pagada": 0},
    }
    assert body["costos"] == {"total": 0, "por_categoria": {}}
    assert body["rentabilidad"] is None
    assert body["costos_sin_datos"] is True
    assert body["clientes"]["nuevos_en_periodo"] == 0
    assert body["publicidad"]["campanas_activas"] >= 0
    # from/to obligatorios y rango máximo
    r = client.get(f"{BASE}/resumen", headers=admin_headers)
    assert r.status_code == 422
    r = client.get(
        f"{BASE}/resumen?from=2020-01-01&to=2026-12-31", headers=admin_headers
    )
    assert r.status_code == 422


def test_ventas_serie_mensual_y_por_cliente(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("BIV"))
    before = client.get(f"{BASE}/ventas?{NOV}", headers=admin_headers).json()
    _mk_invoice(client, admin_headers, contact, 3, 20, status="pagada")
    after = client.get(f"{BASE}/ventas?{NOV}", headers=admin_headers).json()
    assert len(after) == 1 and after[0]["mes"] == "2026-11"
    assert after[0]["total_pagado"] - before[0]["total_pagado"] == 60
    assert after[0]["n_facturas"] - before[0]["n_facturas"] == 1
    r = client.get(
        f"{BASE}/ventas?{NOV}&contact_id={contact['id']}",
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()[0]["total_pagado"] == 60
    assert r.json()[0]["n_facturas"] == 1


def test_clientes_top_por_total_pagado(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("BITop"))
    _mk_invoice(client, admin_headers, contact, 1, 110, status="pagada")
    r = client.get(f"{BASE}/clientes", headers=admin_headers)
    assert r.status_code == 200, r.text
    top = {t["contact_id"]: t for t in r.json()["top_por_total_pagado"]}
    assert contact["id"] in top
    assert top[contact["id"]]["total_pagado"] == 110
    assert top[contact["id"]]["name"] == contact["name"]
    assert r.json()["por_status"].get("cliente", 0) >= 1


def test_costos_crud_y_validacion(client, admin_headers, viewer_headers):
    r = client.get(f"{BASE}/costos", headers=admin_headers)
    assert r.status_code == 200
    # solo admin escribe
    r = client.post(
        f"{BASE}/costos",
        json={"date": "2026-11-17", "category": "otro",
              "concept": "X", "amount": 5},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    # validación
    r = client.post(
        f"{BASE}/costos",
        json={"date": "2026-11-17", "category": "invento",
              "concept": "X", "amount": 5},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"{BASE}/costos",
        json={"date": "2026-11-17", "category": "otro",
              "concept": "X", "amount": -1},
        headers=admin_headers,
    )
    assert r.status_code == 422
    cost = _mk_cost(client, admin_headers, "2026-11-17", "servicios", 12.5)
    assert cost["amount"] == 12.5
    r = client.get(
        f"{BASE}/costos?category=servicios", headers=admin_headers
    )
    assert any(c["id"] == cost["id"] for c in r.json())
    r = client.put(
        f"{BASE}/costos/{cost['id']}", json={"amount": 15},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["amount"] == 15
    r = client.delete(f"{BASE}/costos/{cost['id']}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"{BASE}/costos/{cost['id']}", headers=admin_headers)
    assert r.status_code == 404
