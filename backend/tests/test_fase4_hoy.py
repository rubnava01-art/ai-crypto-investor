"""Fase 4 mejoras-v1, tarea 7 — panel "Hoy" (GET /api/dashboard/hoy) y
fecha de vencimiento de tareas y facturas.

La suite comparte una BD: todo lo sembrado lleva prefijo único
"Hoy25-" y se borra al final. Los fixtures de login son los
compartidos de conftest (admin_headers / viewer_headers).
"""
import datetime as dt
import uuid
from zoneinfo import ZoneInfo

LA = ZoneInfo("America/Los_Angeles")


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _hoy_la() -> dt.date:
    return dt.datetime.now(LA).date()


def _iso_la(day: dt.date, hora: int, minuto: int = 0) -> str:
    return dt.datetime.combine(day, dt.time(hora, minuto), tzinfo=LA).isoformat()


def _crear_tarea(client, h, area, title, due):
    r = client.post(
        f"/api/business/{area}/tasks",
        json={"title": title, **({"due_date": due.isoformat()} if due else {})},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _crear_factura(client, h, client_name, due, status=None):
    r = client.post(
        "/api/facturas/invoices",
        json={
            "client_name": client_name,
            "items": [{"description": "Servicio", "qty": 2, "unit_price": 50}],
            "tax_rate": 0,
            **({"due_date": due.isoformat()} if due else {}),
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    inv = r.json()
    if status:
        r = client.patch(f"/api/facturas/invoices/{inv['id']}", json={"status": status}, headers=h)
        assert r.status_code == 200, r.text
        inv = r.json()
    return inv


def test_hoy_clasifica_lo_urgente(client, admin_headers):
    h = admin_headers
    hoy = _hoy_la()
    ayer = hoy - dt.timedelta(days=1)
    manana = hoy + dt.timedelta(days=1)
    pronto = hoy + dt.timedelta(days=3)
    ids = {"tasks": [], "invoices": [], "items": [], "citas": []}
    try:
        # Tareas: vencida + de hoy SÍ; mañana, sin fecha y hecha, NO.
        t_vencida = _crear_tarea(client, h, "ventas", _uid("Hoy25-Tvencida"), ayer)
        t_hoy = _crear_tarea(client, h, "marketing", _uid("Hoy25-Thoy"), hoy)
        t_manana = _crear_tarea(client, h, "ventas", _uid("Hoy25-Tmanana"), manana)
        t_sinfecha = _crear_tarea(client, h, "legal", _uid("Hoy25-Tsinfecha"), None)
        t_hecha = _crear_tarea(client, h, "ventas", _uid("Hoy25-Thecha"), ayer)
        r = client.patch(f"/api/business/tasks/{t_hecha['id']}", json={"done": True}, headers=h)
        assert r.status_code == 200, r.text
        ids["tasks"] = [t["id"] for t in (t_vencida, t_hoy, t_manana, t_sinfecha, t_hecha)]

        # Facturas: vencida, por vencer, por cobrar SÍ; pagada y
        # borrador con fecha vencida, NO.
        f_vencida = _crear_factura(client, h, _uid("Hoy25-Fvencida"), ayer, "enviada")
        f_pronto = _crear_factura(client, h, _uid("Hoy25-Fpronto"), pronto, "enviada")
        f_cobrar = _crear_factura(client, h, _uid("Hoy25-Fcobrar"), None, "enviada")
        f_pagada = _crear_factura(client, h, _uid("Hoy25-Fpagada"), ayer, "pagada")
        f_borrador = _crear_factura(client, h, _uid("Hoy25-Fborrador"), ayer, None)
        ids["invoices"] = [f["id"] for f in (f_vencida, f_pronto, f_cobrar, f_pagada, f_borrador)]

        # Inventario: bajo SÍ; bien y sin mínimo (0/0), NO.
        r = client.post("/api/inventario/items",
                        json={"name": _uid("Hoy25-Bajo"), "quantity": 2, "min_stock": 10},
                        headers=h)
        assert r.status_code == 201, r.text
        item_bajo = r.json()
        ids["items"].append(item_bajo["id"])
        r = client.post("/api/inventario/items",
                        json={"name": _uid("Hoy25-Bien"), "quantity": 11, "min_stock": 10},
                        headers=h)
        assert r.status_code == 201, r.text
        item_bien = r.json()
        ids["items"].append(item_bien["id"])
        r = client.post("/api/inventario/items",
                        json={"name": _uid("Hoy25-SinMin"), "quantity": 0, "min_stock": 0},
                        headers=h)
        assert r.status_code == 201, r.text
        item_sinmin = r.json()
        ids["items"].append(item_sinmin["id"])

        # Citas: hoy SÍ; mañana y cancelada de hoy, NO.
        # Hora futura dentro de hoy (antes era fija 14:00 y el test
        # fallaba cuando la suite corría después de esa hora: el
        # endpoint rechaza starts_at en el pasado).
        _ahora = dt.datetime.now(LA)
        _inicio = _ahora + dt.timedelta(minutes=60)
        if _inicio.date() != hoy:
            # 23:59:59 (no 23:59:00): a las 23:59:00-23:59:59 el fallback
            # 23:59:00 ya sería pasado y el endpoint lo rechazaría.
            _inicio = dt.datetime.combine(hoy, dt.time(23, 59, 59), tzinfo=LA)
        r = client.post("/api/business/marketing/citas",
                        json={"client_name": _uid("Hoy25-CitaHoy"), "service_type": "consulta",
                              "starts_at": _inicio.isoformat(), "duration_min": 60},
                        headers=h)
        assert r.status_code == 201, r.text
        cita_hoy = r.json()
        ids["citas"].append(cita_hoy["id"])
        r = client.post("/api/business/marketing/citas",
                        json={"client_name": _uid("Hoy25-CitaManana"), "service_type": "consulta",
                              "starts_at": _iso_la(manana, 14), "duration_min": 60},
                        headers=h)
        assert r.status_code == 201, r.text
        cita_manana = r.json()
        ids["citas"].append(cita_manana["id"])
        r = client.post("/api/business/marketing/citas",
                        json={"client_name": _uid("Hoy25-CitaCanc"), "service_type": "consulta",
                              "starts_at": _inicio.isoformat(), "duration_min": 60},
                        headers=h)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        ids["citas"].append(cid)
        r = client.patch(f"/api/business/marketing/citas/{cid}", json={"status": "cancelada"}, headers=h)
        assert r.status_code == 200, r.text

        r = client.get("/api/dashboard/hoy", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["fecha"] == hoy.isoformat()

        # La BD es compartida: aserciones por pertenencia, nunca por
        # igualdad exacta de listas (otros tests pueden tener filas).
        titulos = {t["title"] for t in data["tareas"]}
        assert t_vencida["title"] in titulos and t_hoy["title"] in titulos
        assert t_manana["title"] not in titulos
        assert t_sinfecha["title"] not in titulos
        assert t_hecha["title"] not in titulos

        ids_vencidas = [f["id"] for f in data["facturas_vencidas"]]
        ids_pronto = [f["id"] for f in data["facturas_por_vencer"]]
        ids_cobrar = [f["id"] for f in data["facturas_por_cobrar"]]
        assert f_vencida["id"] in ids_vencidas
        assert f_pronto["id"] in ids_pronto
        assert f_cobrar["id"] in ids_cobrar
        for ausente in (f_pagada["id"], f_borrador["id"]):
            assert ausente not in ids_vencidas + ids_pronto + ids_cobrar
        # Total: 2 x $50 sin impuesto.
        assert next(f for f in data["facturas_vencidas"] if f["id"] == f_vencida["id"])["total"] == 100.0

        nombres_stock = {s["name"] for s in data["stock_bajo"]}
        assert item_bajo["name"] in nombres_stock
        assert item_bien["name"] not in nombres_stock
        assert item_sinmin["name"] not in nombres_stock
        citas_nombres = {c["client_name"] for c in data["citas"]}
        assert cita_hoy["client_name"] in citas_nombres
        assert cita_manana["client_name"] not in citas_nombres
    finally:
        for tid in ids["tasks"]:
            client.delete(f"/api/business/tasks/{tid}", headers=h)
        for iid in ids["invoices"]:
            client.delete(f"/api/facturas/invoices/{iid}", headers=h)
        for iid in ids["items"]:
            client.delete(f"/api/inventario/items/{iid}", headers=h)
        for cid in ids["citas"]:
            client.delete(f"/api/business/marketing/citas/{cid}", headers=h)


def test_hoy_prueba_sin_acceso_ve_listas_vacias(client, viewer_headers):
    # Prueba no tiene business/facturas/inventario: secciones [] (sin
    # acceso), nunca null (fallo) ni 403.
    r = client.get("/api/dashboard/hoy", headers=viewer_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["tareas"] == []
    assert data["facturas_vencidas"] == []
    assert data["facturas_por_vencer"] == []
    assert data["facturas_por_cobrar"] == []
    assert data["stock_bajo"] == []
    assert data["citas"] == []


def test_task_due_date_roundtrip_y_borrado(client, admin_headers):
    h = admin_headers
    hoy = _hoy_la()
    t = _crear_tarea(client, h, "ventas", _uid("Hoy25-Round"), hoy)
    assert t["due_date"] == hoy.isoformat()
    # PATCH sin due_date no la toca.
    r = client.patch(f"/api/business/tasks/{t['id']}", json={"title": t["title"] + " x"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["due_date"] == hoy.isoformat()
    # PATCH con due_date=null la borra.
    r = client.patch(f"/api/business/tasks/{t['id']}", json={"due_date": None}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["due_date"] is None
    client.delete(f"/api/business/tasks/{t['id']}", headers=h)


def test_invoice_due_date_roundtrip(client, admin_headers):
    h = admin_headers
    hoy = _hoy_la()
    inv = _crear_factura(client, h, _uid("Hoy25-InvRound"), hoy, None)
    assert inv["due_date"] == hoy.isoformat()
    inv2 = _crear_factura(client, h, _uid("Hoy25-InvSinFecha"), None, None)
    assert inv2["due_date"] is None
    client.delete(f"/api/facturas/invoices/{inv['id']}", headers=h)
    client.delete(f"/api/facturas/invoices/{inv2['id']}", headers=h)


def test_invoice_patch_due_date_clasifica_en_hoy(client, admin_headers):
    # Fix H1 (Fase 4 mejoras-v1): la due_date de una factura existente
    # se fija/borra con PATCH, igual que en las tareas; "Hoy" la
    # reclasifica sin borrar ni recrear la factura.
    h = admin_headers
    hoy = _hoy_la()
    ayer = hoy - dt.timedelta(days=1)
    inv = _crear_factura(client, h, _uid("Hoy25-InvPatch"), None, "enviada")
    assert inv["due_date"] is None
    try:
        # Sin fecha, una factura enviada es "por cobrar".
        r = client.get("/api/dashboard/hoy", headers=h)
        assert r.status_code == 200, r.text
        assert inv["id"] in [f["id"] for f in r.json()["facturas_por_cobrar"]]
        assert inv["id"] not in [f["id"] for f in r.json()["facturas_vencidas"]]

        # PATCH solo con fecha: la fija sin tocar el estado.
        r = client.patch(f"/api/facturas/invoices/{inv['id']}",
                         json={"due_date": ayer.isoformat()}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["due_date"] == ayer.isoformat()
        assert r.json()["status"] == "enviada"
        # Ahora vencida: "Hoy" la clasifica como tal.
        r = client.get("/api/dashboard/hoy", headers=h)
        assert r.status_code == 200, r.text
        assert inv["id"] in [f["id"] for f in r.json()["facturas_vencidas"]]
        assert inv["id"] not in [f["id"] for f in r.json()["facturas_por_cobrar"]]

        # PATCH solo con estado no toca la fecha.
        r = client.patch(f"/api/facturas/invoices/{inv['id']}",
                         json={"status": "pagada"}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["due_date"] == ayer.isoformat()

        # PATCH con due_date=null la borra (aunque la factura ya esté
        # pagada, la fecha queda en null para el registro).
        r = client.patch(f"/api/facturas/invoices/{inv['id']}",
                         json={"due_date": None}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["due_date"] is None
    finally:
        client.delete(f"/api/facturas/invoices/{inv['id']}", headers=h)
