"""Fase 3 (2026-11-23) — Rediseño CRM estilo Vivero: resumen del CRM.

Fixtures compartidas (client/admin_headers/viewer_headers). NINGÚN test
hace login propio. La suite comparte una sola BD, así que los tests de
datos usan deltas (resumen antes/después) y fechas fijadas por DB directa
(hoy al mediodía PT, hace 3 días al mediodía PT): un contacto creado por
API a las 00:30 UTC caería en el día PT anterior y el delta de "hoy"
sería 0.
"""
import datetime as dt
import uuid
from zoneinfo import ZoneInfo

import pytest

from app.database import get_db
from app.models.tables import Appointment, Contact, Invoice

PT = ZoneInfo("America/Los_Angeles")
BASE = "/api/crm/contacts"
RESUMEN = f"{BASE}/resumen"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _pt_noon(days_ago: int = 0) -> dt.datetime:
    """Mediodía PT de hoy (o de hace N días), en UTC: nunca cruza de día."""
    day = dt.datetime.now(PT).date() - dt.timedelta(days=days_ago)
    return dt.datetime.combine(day, dt.time(12, 0), tzinfo=PT).astimezone(dt.timezone.utc)


def _resumen(client, admin_headers) -> dict:
    r = client.get(RESUMEN, headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json()


def _mk_contact(client, admin_headers, name, status="nuevo"):
    r = client.post(
        BASE,
        json={"name": name, "email": "", "phone": "", "source": "manual",
              "tags": [], "status": status, "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_invoice(client, admin_headers, tax_rate, status):
    qty, price = 2, 25
    items = [{"description": "Concepto", "qty": qty, "unit_price": price}]
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": _uid("FacCli"), "items": items,
              "tax_rate": tax_rate, "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    inv = r.json()
    r = client.patch(
        f"/api/facturas/invoices/{inv['id']}",
        json={"status": status},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _clear_citas_limiter():
    from app.api.marketing import citas_limiter

    citas_limiter.clear()
    yield
    citas_limiter.clear()


def test_resumen_estructura_admin(client, admin_headers):
    data = _resumen(client, admin_headers)
    today_pt = dt.datetime.now(PT).date()
    assert data["fecha"] == today_pt.isoformat()
    assert data["zona_horaria"] == "America/Los_Angeles"
    assert [p["numero"] for p in data["pasos"]] == [1, 2, 3, 4]
    assert [p["clave"] for p in data["pasos"]] == [
        "nuevos", "gestion", "seguimiento", "citas",
    ]
    for p in data["pasos"]:
        assert len(p["serie_7d"]) == 7
        assert all(isinstance(v, int) and v >= 0 for v in p["serie_7d"])
        assert p["vacio"]  # texto de vacío honesto siempre presente
    assert [p["vacio"] for p in data["pasos"]] == [
        "Todavía nadie hoy",
        "Todavía nadie en gestión",
        "Todavía nadie en seguimiento",
        "Ninguna cita más hoy",
    ]
    # Leyenda = los 5 estados REALES del CRM, sin estados de llamada inventados.
    assert [row["estado"] for row in data["leyenda"]] == [
        "nuevo", "contactado", "interesado", "cliente", "inactivo",
    ]
    m = data["metricas"]
    assert set(m) == {
        "contactos_nuevos_hoy", "citas_hoy", "ventas_hoy",
        "ventas_semana", "por_cobrar", "clientes",
    }
    # Días de la semana: lunes -> hoy (PT).
    assert len(data["ventas_semana_dias"]) == today_pt.weekday() + 1
    assert data["ventas_semana_dias"][-1]["fecha"] == today_pt.isoformat()
    assert data["ventas_semana_dias"][-1]["etiqueta"] == "Hoy"
    assert data["nota_ventas"]  # la limitación de fecha de pago se declara


def test_resumen_datos_reales_deltas(client, admin_headers, app):
    before = _resumen(client, admin_headers)
    contact_hoy = _mk_contact(client, admin_headers, _uid("ResumenHoy"), "nuevo")
    contact_viejo = _mk_contact(client, admin_headers, _uid("Resumen3d"), "interesado")
    # Cita: se crea para mañana (la API rechaza el pasado) y se mueve por
    # DB directa a hoy al mediodía PT.
    r = client.post(
        "/api/business/marketing/citas",
        json={"contact_id": contact_hoy["id"], "service_type": "Asesoría",
              "starts_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1))
              .replace(hour=10, minute=0, second=0, microsecond=0).isoformat(),
              "duration_min": 60, "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    appt_id = r.json()["id"]
    inv_pagada = _mk_invoice(client, admin_headers, 0, "pagada")
    inv_pendiente = _mk_invoice(client, admin_headers, 10, "enviada")
    db, gen = _db(app)
    try:
        db.query(Contact).filter(Contact.id == contact_hoy["id"]).update(
            {"created_at": _pt_noon(0)}
        )
        db.query(Contact).filter(Contact.id == contact_viejo["id"]).update(
            {"created_at": _pt_noon(3)}
        )
        db.query(Appointment).filter(Appointment.id == appt_id).update(
            {"starts_at": _pt_noon(0)}
        )
        db.query(Invoice).filter(Invoice.id == inv_pagada["id"]).update(
            {"created_at": _pt_noon(0)}
        )
        db.commit()
    finally:
        _close(gen)
    try:
        after = _resumen(client, admin_headers)
        m0, m1 = before["metricas"], after["metricas"]
        assert m1["contactos_nuevos_hoy"] - m0["contactos_nuevos_hoy"] == 1
        assert m1["citas_hoy"] - m0["citas_hoy"] == 1
        # Factura pagada: 2 x $25, sin impuesto = $50, creada hoy (PT).
        assert m1["ventas_hoy"]["cantidad"] - m0["ventas_hoy"]["cantidad"] == 1
        assert m1["ventas_hoy"]["total"] - m0["ventas_hoy"]["total"] == 50.0
        assert m1["ventas_semana"]["cantidad"] - m0["ventas_semana"]["cantidad"] == 1
        assert m1["ventas_semana"]["total"] - m0["ventas_semana"]["total"] == 50.0
        assert after["ventas_semana_dias"][-1]["cantidad"] - before["ventas_semana_dias"][-1]["cantidad"] == 1
        assert after["ventas_semana_dias"][-1]["total"] - before["ventas_semana_dias"][-1]["total"] == 50.0
        # Factura enviada: 2 x $25 = $50 + 10% = $55 por cobrar.
        assert m1["por_cobrar"]["cantidad"] - m0["por_cobrar"]["cantidad"] == 1
        assert m1["por_cobrar"]["total"] - m0["por_cobrar"]["total"] == 55.0
        # Leyenda y pasos del embudo.
        ley0 = {row["estado"]: row["total"] for row in before["leyenda"]}
        ley1 = {row["estado"]: row["total"] for row in after["leyenda"]}
        assert ley1["nuevo"] - ley0["nuevo"] == 1
        assert ley1["interesado"] - ley0["interesado"] == 1
        p0, p1 = before["pasos"], after["pasos"]
        assert p1[0]["total"] - p0[0]["total"] == 1  # Nuevos
        assert p1[0]["hoy"] - p0[0]["hoy"] == 1
        assert p1[2]["total"] - p0[2]["total"] == 1  # Seguimiento
        assert p1[3]["total"] - p0[3]["total"] == 1  # Citas de hoy
        # Serie de 7 días: hoy (índice 6) y hace 3 días (índice 3).
        assert p1[0]["serie_7d"][6] - p0[0]["serie_7d"][6] == 1
        assert p1[0]["serie_7d"][3] - p0[0]["serie_7d"][3] == 1
        assert p1[3]["serie_7d"][6] - p0[3]["serie_7d"][6] == 1
    finally:
        # Limpieza: primero la cita (si no, el contacto no se puede borrar
        # por tener citas futuras), luego facturas y contactos.
        assert client.delete(f"/api/business/marketing/citas/{appt_id}", headers=admin_headers).status_code == 204
        assert client.delete(f"/api/facturas/invoices/{inv_pagada['id']}", headers=admin_headers).status_code == 204
        assert client.delete(f"/api/facturas/invoices/{inv_pendiente['id']}", headers=admin_headers).status_code == 204
        assert client.delete(f"{BASE}/{contact_hoy['id']}", headers=admin_headers).status_code == 204
        assert client.delete(f"{BASE}/{contact_viejo['id']}", headers=admin_headers).status_code == 204


def test_resumen_prueba_403(client, viewer_headers):
    r = client.get(RESUMEN, headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_resumen_sin_auth_401(client):
    assert client.get(RESUMEN).status_code == 401
