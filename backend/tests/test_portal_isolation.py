"""NEST — Matriz de aislamiento del portal (plan conjunto §7, A-3).

13 tests: listas solo propias; ID directo ajeno -> 404; enumeración
id±100; escritura cruzada; sin enlace -> 403; admin ve todo por
endpoints admin; BI 403 para cliente; etiqueta "reglas, no IA";
regresión 401/403; token pre-promoción -> 401; preview admin;
vínculos 409/404; resumen solo propio.

Fixtures compartidas. NINGÚN test hace login propio: tokens de
clientes acuñados con create_access_token (precedente test_fase2).

D-01 (fix 2026-11-17, Agente 2): tests 15-17 completan la matriz
(test 11): las listas de marketing/contenido fuera del portal
(/contenido/ideas, /contenido/calendario, /campanas) fuerzan en
servidor el filtro por el contacto vinculado del no-admin e ignoran
cualquier ?contact_id=. D-02: test 18 acuña un token para una cuenta
pendiente y verifica 403 en el portal.
"""
import datetime as dt
import re
import uuid

import pytest

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import User

BASE = "/api/business/marketing"
PORTAL = f"{BASE}/portal"


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


def _headers_for(app, username: str) -> dict:
    db, gen = _db(app)
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None, username
        token = create_access_token(
            user.username, user_id=user.id, token_version=user.token_version or 0
        )
    finally:
        _close(gen)
    return {"Authorization": f"Bearer {token}"}


def _mk_user(client, admin_headers, username: str, role: str = "prueba") -> dict:
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_contact(client, admin_headers, name: str) -> dict:
    r = client.post(
        "/api/crm/contacts",
        json={"name": name, "email": "", "phone": "", "source": "manual",
              "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _link(client, admin_headers, user_id: int, contact_id: int) -> None:
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": user_id, "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text


def _future(days: int = 1, hour: int = 10) -> str:
    base = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


def _seed_pair(client, app, admin_headers) -> dict:
    """Dos clientes vinculados (A y B) con datos propios de B."""
    user_a = _mk_user(client, admin_headers, _uid("portA"))
    user_b = _mk_user(client, admin_headers, _uid("portB"))
    contact_a = _mk_contact(client, admin_headers, _uid("PortA"))
    contact_b = _mk_contact(client, admin_headers, _uid("PortB"))
    _link(client, admin_headers, user_a["id"], contact_a["id"])
    _link(client, admin_headers, user_b["id"], contact_b["id"])
    headers_a = _headers_for(app, user_a["username"])
    headers_b = _headers_for(app, user_b["username"])
    # Factura pagada de B: 1 x 100 = 100
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": contact_b["name"], "contact_id": contact_b["id"],
              "items": [{"description": "Servicio B", "qty": 1, "unit_price": 100}]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    inv_b = r.json()
    r = client.patch(
        f"/api/facturas/invoices/{inv_b['id']}", json={"status": "pagada"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    # Cita futura de B
    r = client.post(
        f"{BASE}/citas",
        json={"contact_id": contact_b["id"], "service_type": "Asesoría B",
              "starts_at": _future(2, 10), "duration_min": 60},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    cita_b = r.json()
    # Campaña de marketing de B + campaña de referidos de B
    r = client.post(
        f"{BASE}/campanas",
        json={"name": "Camp B", "channel": "instagram", "status": "activa",
              "contact_id": contact_b["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    camp_b = r.json()
    r = client.post(
        "/api/referrals/campaigns",
        json={"name": "Ref B", "business_contact_id": contact_b["id"],
              "reward_type": "fixed", "reward_value": "10", "status": "active"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    ref_b = r.json()
    # Proyecto + tarea de B
    r = client.post(
        "/api/desarrollo/projects",
        json={"title": "Web B", "contact_id": contact_b["id"],
              "stage": "desarrollo", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    proj_b = r.json()
    r = client.post(
        f"/api/desarrollo/projects/{proj_b['id']}/tasks",
        json={"title": "Tarea secreta B"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    task_b = r.json()
    return {
        "user_a": user_a, "user_b": user_b,
        "contact_a": contact_a, "contact_b": contact_b,
        "headers_a": headers_a, "headers_b": headers_b,
        "inv_b": inv_b, "cita_b": cita_b, "camp_b": camp_b,
        "ref_b": ref_b, "proj_b": proj_b, "task_b": task_b,
    }


@pytest.fixture(autouse=True)
def _clear_citas_limiter():
    from app.api.marketing import citas_limiter

    citas_limiter.clear()
    yield
    citas_limiter.clear()


# 1. Listas solo propias ---------------------------------------------------

def test_1_listas_solo_propias(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{PORTAL}/facturas", headers=s["headers_a"])
    assert r.status_code == 200
    assert all(f["id"] != s["inv_b"]["id"] for f in r.json())
    r = client.get(f"{PORTAL}/citas", headers=s["headers_a"])
    assert r.status_code == 200
    assert all(c["id"] != s["cita_b"]["id"] for c in r.json())
    r = client.get(f"{PORTAL}/campanas", headers=s["headers_a"])
    assert r.status_code == 200
    assert all(c["id"] != s["camp_b"]["id"] for c in r.json()["campanas"])
    assert all(c["id"] != s["ref_b"]["id"] for c in r.json()["referidos"])
    # B sí ve lo suyo
    r = client.get(f"{PORTAL}/facturas", headers=s["headers_b"])
    assert [f["id"] for f in r.json()] == [s["inv_b"]["id"]]


# 2. ID directo ajeno -> 404 ----------------------------------------------

def test_2_id_directo_ajeno_404(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    # El portal NO tiene rutas de detalle /{id}: cualquier intento
    # directo sobre un id ajeno es 404, nunca el dato.
    for path in (
        f"{PORTAL}/facturas/{s['inv_b']['id']}",
        f"{PORTAL}/citas/{s['cita_b']['id']}",
        f"{PORTAL}/campanas/{s['camp_b']['id']}",
        f"{PORTAL}/tareas/{s['task_b']['id']}",
    ):
        r = client.get(path, headers=s["headers_a"])
        assert r.status_code == 404, (path, r.status_code)


# 3. Enumeración id±100 ----------------------------------------------------

def test_3_enumeracion_id_mas_menos_100(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    # Un cliente no-admin que pase ?contact_id= ajeno (o ±100) recibe
    # SIEMPRE su propio contacto: el parámetro se ignora, no se usa.
    for probe in (
        s["contact_b"]["id"], s["contact_b"]["id"] + 100,
        s["contact_b"]["id"] - 100, 999999,
    ):
        r = client.get(f"{PORTAL}/me?contact_id={probe}", headers=s["headers_a"])
        assert r.status_code == 200, (probe, r.text)
        assert r.json()["contact"]["id"] == s["contact_a"]["id"]
        assert r.json()["contact"]["name"] == s["contact_a"]["name"]


# 4. Escritura cruzada ------------------------------------------------------

def test_4_escritura_cruzada_contact_id_b_403(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.post(
        f"{BASE}/citas",
        json={"contact_id": s["contact_b"]["id"], "service_type": "Robo",
              "starts_at": _future(3, 10), "duration_min": 30},
        headers=s["headers_a"],
    )
    assert r.status_code == 403, r.text
    # y no se creó la cita para B
    r = client.get(f"{PORTAL}/citas", headers=s["headers_b"])
    assert all(c["service_type"] != "Robo" for c in r.json())


# 5. Sin enlace -> 403 ------------------------------------------------------

def test_5_sin_enlace_403_en_todo_el_portal(client, viewer_headers):
    for path in (
        f"{PORTAL}/me", f"{PORTAL}/campanas", f"{PORTAL}/facturas",
        f"{PORTAL}/tareas", f"{PORTAL}/citas", f"{PORTAL}/resumen",
    ):
        r = client.get(path, headers=viewer_headers)
        assert r.status_code == 403, (path, r.status_code)


# 6. Admin ve todo por endpoints admin --------------------------------------

def test_6_admin_ve_todo_por_endpoints_admin(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get("/api/crm/contacts", headers=admin_headers)
    ids = [c["id"] for c in r.json()]
    assert s["contact_a"]["id"] in ids and s["contact_b"]["id"] in ids
    r = client.get("/api/facturas/invoices", headers=admin_headers)
    assert any(f["id"] == s["inv_b"]["id"] for f in r.json())


# 7. BI 403 para cliente ----------------------------------------------------

def test_7_bi_403_para_cliente(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    for path in (
        f"{BASE}/bi/resumen?from=2026-01-01&to=2026-12-31",
        f"{BASE}/bi/ventas?from=2026-01-01&to=2026-12-31",
        f"{BASE}/bi/clientes",
        f"{BASE}/bi/costos",
    ):
        r = client.get(path, headers=s["headers_a"])
        assert r.status_code == 403, (path, r.status_code)


# 8. Etiqueta "reglas, no IA" ----------------------------------------------

def test_8_etiqueta_reglas_no_ia(client, admin_headers):
    r = client.post(
        f"{BASE}/contenido/plantillas",
        json={"name": "Promo", "platform": "instagram", "tone": "directo",
              "body": "Hola {{tema}} de {{negocio}}: {{llamada}}",
              "max_chars": 20},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    template = r.json()
    assert "reglas" in template["etiqueta"] and "no IA" in template["etiqueta"]
    r = client.post(
        f"{BASE}/contenido/generar-desde-plantilla",
        json={"template_id": template["id"],
              "variables": {"tema": "ofertas", "negocio": "RIV",
                            "llamada": "Escríbenos"}},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "plantilla"
    assert "reglas" in r.json()["etiqueta"] and "no IA" in r.json()["etiqueta"]
    assert "demo" not in r.json()
    assert r.json()["truncated"] is True  # max_chars=20 recorta


# 9. Regresión 401/403 ------------------------------------------------------

def test_9_regresion_401_403(client, viewer_headers):
    r = client.get(f"{PORTAL}/me")
    assert r.status_code == 401
    r = client.get(f"{BASE}/bi/resumen?from=2026-01-01&to=2026-12-31")
    assert r.status_code == 401
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": 1, "contact_id": 1},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    r = client.get(f"{PORTAL}/vinculos", headers=viewer_headers)
    assert r.status_code == 403


# 10. Token pre-promoción -> 401 -------------------------------------------

def test_10_token_pre_promocion_401(client, app, admin_headers):
    user = _mk_user(client, admin_headers, _uid("promo"))
    old_headers = _headers_for(app, user["username"])
    r = client.get("/api/system/status", headers=old_headers)
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/api/users/{user['id']}", json={"role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_admin"] is True
    r = client.get("/api/system/status", headers=old_headers)
    assert r.status_code == 401, r.text


# 11. Preview admin ----------------------------------------------------------

def test_11_admin_portal_sin_contact_id_403_y_preview(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{PORTAL}/me", headers=admin_headers)
    assert r.status_code == 403
    r = client.get(
        f"{PORTAL}/me?contact_id={s['contact_b']['id']}", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["contact"]["id"] == s["contact_b"]["id"]
    r = client.get(
        f"{PORTAL}/facturas?contact_id={s['contact_b']['id']}",
        headers=admin_headers,
    )
    assert [f["id"] for f in r.json()] == [s["inv_b"]["id"]]
    r = client.get(f"{PORTAL}/me?contact_id=999999", headers=admin_headers)
    assert r.status_code == 404


# 12. Vínculos: 409/404 y desvincular ---------------------------------------

def test_12_vinculos_409_404_y_desvincular(client, app, admin_headers):
    user = _mk_user(client, admin_headers, _uid("vinc"))
    contact = _mk_contact(client, admin_headers, _uid("Vinc"))
    contact2 = _mk_contact(client, admin_headers, _uid("Vinc2"))
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": 999999, "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 404
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": user["id"], "contact_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404
    _link(client, admin_headers, user["id"], contact["id"])
    # contacto ya vinculado -> 409
    user2 = _mk_user(client, admin_headers, _uid("vinc2"))
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": user2["id"], "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 409
    # usuario ya vinculado a otro contacto -> 409
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": user["id"], "contact_id": contact2["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 409
    # desvincular -> el usuario vuelve a 403 en el portal
    r = client.delete(f"{PORTAL}/vinculos/{contact['id']}", headers=admin_headers)
    assert r.status_code == 204
    headers = _headers_for(app, user["username"])
    r = client.get(f"{PORTAL}/me", headers=headers)
    assert r.status_code == 403
    r = client.delete(f"{PORTAL}/vinculos/999999", headers=admin_headers)
    assert r.status_code == 404


# 13. Resumen solo propio ----------------------------------------------------

def test_13_resumen_portal_solo_datos_propios(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    # Factura pagada propia de A: 2 x 50 = 100
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": s["contact_a"]["name"],
              "contact_id": s["contact_a"]["id"],
              "items": [{"description": "Servicio A", "qty": 2, "unit_price": 50}]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    inv_a = r.json()
    r = client.patch(
        f"/api/facturas/invoices/{inv_a['id']}", json={"status": "pagada"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    r = client.get(f"{PORTAL}/resumen", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    assert r.json()["facturas"]["por_estado"]["pagada"] == 1
    assert r.json()["facturas"]["total_pagado"] == 100
    # B tiene su propia factura de 100: el resumen de A no la suma
    r = client.get(f"{PORTAL}/resumen", headers=s["headers_b"])
    assert r.json()["facturas"]["total_pagado"] == 100
    assert r.json()["facturas"]["por_estado"]["pagada"] == 1


# 14. Tareas: solo proyectos propios + próximas citas propias --------------

def test_14_tareas_solo_proyectos_propios(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{PORTAL}/tareas", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    assert r.json()["tareas"] == []
    assert r.json()["proximas_citas"] == []
    r = client.get(f"{PORTAL}/tareas", headers=s["headers_b"])
    assert r.status_code == 200
    assert [t["id"] for t in r.json()["tareas"]] == [s["task_b"]["id"]]
    assert "Tarea secreta B" == r.json()["tareas"][0]["title"]
    assert [c["id"] for c in r.json()["proximas_citas"]] == [s["cita_b"]["id"]]


# D-01 (fix 2026-11-17): aislamiento en las listas fuera del portal -----
# Helpers de siembra para contenido/campañas (admin crea; los clientes
# solo leen). Los títulos llevan sufijo único: la BD es compartida por
# toda la suite, así que las aserciones son por pertenencia, nunca por
# igualdad exacta de la lista completa.

def _mk_idea(client, admin_headers, title: str, contact_id: int | None) -> dict:
    r = client.post(
        f"{BASE}/contenido/ideas",
        json={"title": title, "notes": "", "source": "manual",
              "status": "idea", "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_calendar_item(
    client, admin_headers, title: str, contact_id: int | None, days: int
) -> dict:
    r = client.post(
        f"{BASE}/contenido/calendario",
        json={"title": title, "text": "", "scheduled_at": _future(days, 10),
              "platform": "instagram", "status": "borrador",
              "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_campaign(client, admin_headers, name: str, contact_id: int | None) -> dict:
    r = client.post(
        f"{BASE}/campanas",
        json={"name": name, "channel": "instagram", "status": "activa",
              "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _seed_d01(client, app, admin_headers) -> dict:
    """Par A/B + una fila propia de A, una de B y una NULL (contenido
    del negocio sin cliente) en ideas, calendario y campañas."""
    s = _seed_pair(client, app, admin_headers)
    tag = uuid.uuid4().hex[:8]
    s["idea_a"] = _mk_idea(client, admin_headers, f"Idea A-{tag}",
                           s["contact_a"]["id"])
    s["idea_b"] = _mk_idea(client, admin_headers, f"Idea B-{tag}",
                           s["contact_b"]["id"])
    s["idea_null"] = _mk_idea(client, admin_headers, f"Idea NULL-{tag}", None)
    s["item_a"] = _mk_calendar_item(client, admin_headers, f"Item A-{tag}",
                                    s["contact_a"]["id"], 2)
    s["item_b"] = _mk_calendar_item(client, admin_headers, f"Item B-{tag}",
                                    s["contact_b"]["id"], 3)
    s["item_null"] = _mk_calendar_item(client, admin_headers, f"Item NULL-{tag}",
                                       None, 4)
    s["camp_a"] = _mk_campaign(client, admin_headers, f"Camp A-{tag}",
                               s["contact_a"]["id"])
    # camp_b ya existe en _seed_pair ("Camp B"); camp_null es nueva.
    s["camp_null"] = _mk_campaign(client, admin_headers, f"Camp NULL-{tag}", None)
    return s


def _cal_range() -> tuple[str, str]:
    today = dt.datetime.now(dt.timezone.utc).date()
    return today.isoformat(), (today + dt.timedelta(days=30)).isoformat()


# 15. D-01 ideas: A solo ve las suyas; B y NULL invisibles ---------------

def test_15_ideas_d01_solo_propias(client, app, admin_headers, viewer_headers):
    s = _seed_d01(client, app, admin_headers)
    r = client.get(f"{BASE}/contenido/ideas", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert s["idea_a"]["id"] in ids
    assert s["idea_b"]["id"] not in ids
    assert s["idea_null"]["id"] not in ids
    # ?contact_id= de B se ignora: A sigue viendo solo lo suyo.
    r = client.get(
        f"{BASE}/contenido/ideas?contact_id={s['contact_b']['id']}",
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert s["idea_a"]["id"] in ids
    assert s["idea_b"]["id"] not in ids
    assert s["idea_null"]["id"] not in ids
    # B ve solo la suya.
    r = client.get(f"{BASE}/contenido/ideas", headers=s["headers_b"])
    ids = [i["id"] for i in r.json()]
    assert s["idea_b"]["id"] in ids
    assert s["idea_a"]["id"] not in ids
    assert s["idea_null"]["id"] not in ids
    # Admin ve todo, con ?contact_id= respetado.
    r = client.get(f"{BASE}/contenido/ideas", headers=admin_headers)
    ids = [i["id"] for i in r.json()]
    assert s["idea_a"]["id"] in ids
    assert s["idea_b"]["id"] in ids
    assert s["idea_null"]["id"] in ids
    r = client.get(
        f"{BASE}/contenido/ideas?contact_id={s['contact_b']['id']}",
        headers=admin_headers,
    )
    ids = [i["id"] for i in r.json()]
    assert s["idea_b"]["id"] in ids
    assert s["idea_a"]["id"] not in ids
    assert s["idea_null"]["id"] not in ids
    # Prueba sin vínculo: comportamiento documentado sin cambios (D3).
    r = client.get(f"{BASE}/contenido/ideas", headers=viewer_headers)
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert s["idea_a"]["id"] in ids
    assert s["idea_b"]["id"] in ids
    assert s["idea_null"]["id"] in ids


# 16. D-01 calendario: igual que ideas ------------------------------------

def test_16_calendario_d01_solo_propio(client, app, admin_headers, viewer_headers):
    s = _seed_d01(client, app, admin_headers)
    frm, to = _cal_range()
    url = f"{BASE}/contenido/calendario?from={frm}&to={to}"
    r = client.get(url, headers=s["headers_a"])
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert s["item_a"]["id"] in ids
    assert s["item_b"]["id"] not in ids
    assert s["item_null"]["id"] not in ids
    r = client.get(url, headers=s["headers_b"])
    ids = [i["id"] for i in r.json()]
    assert s["item_b"]["id"] in ids
    assert s["item_a"]["id"] not in ids
    assert s["item_null"]["id"] not in ids
    r = client.get(url, headers=admin_headers)
    ids = [i["id"] for i in r.json()]
    assert s["item_a"]["id"] in ids
    assert s["item_b"]["id"] in ids
    assert s["item_null"]["id"] in ids
    # Prueba sin vínculo: sin cambios (D3).
    r = client.get(url, headers=viewer_headers)
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()]
    assert s["item_a"]["id"] in ids
    assert s["item_b"]["id"] in ids
    assert s["item_null"]["id"] in ids


# 17. D-01 campañas: igual que ideas --------------------------------------

def test_17_campanas_d01_solo_propias(client, app, admin_headers, viewer_headers):
    s = _seed_d01(client, app, admin_headers)
    r = client.get(f"{BASE}/campanas", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert s["camp_a"]["id"] in ids
    assert s["camp_b"]["id"] not in ids
    assert s["camp_null"]["id"] not in ids
    # ?contact_id= de B se ignora.
    r = client.get(
        f"{BASE}/campanas?contact_id={s['contact_b']['id']}",
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert s["camp_a"]["id"] in ids
    assert s["camp_b"]["id"] not in ids
    assert s["camp_null"]["id"] not in ids
    # B ve solo la suya.
    r = client.get(f"{BASE}/campanas", headers=s["headers_b"])
    ids = [c["id"] for c in r.json()]
    assert s["camp_b"]["id"] in ids
    assert s["camp_a"]["id"] not in ids
    assert s["camp_null"]["id"] not in ids
    # Admin ve todo, con ?contact_id= respetado.
    r = client.get(f"{BASE}/campanas", headers=admin_headers)
    ids = [c["id"] for c in r.json()]
    assert s["camp_a"]["id"] in ids
    assert s["camp_b"]["id"] in ids
    assert s["camp_null"]["id"] in ids
    r = client.get(
        f"{BASE}/campanas?contact_id={s['contact_b']['id']}",
        headers=admin_headers,
    )
    ids = [c["id"] for c in r.json()]
    assert s["camp_b"]["id"] in ids
    assert s["camp_a"]["id"] not in ids
    assert s["camp_null"]["id"] not in ids
    # Prueba sin vínculo: sin cambios (D3).
    r = client.get(f"{BASE}/campanas", headers=viewer_headers)
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert s["camp_a"]["id"] in ids
    assert s["camp_b"]["id"] in ids
    assert s["camp_null"]["id"] in ids


# 18. D-02: token acuñado para una cuenta pendiente -> 403 ----------------

def test_18_token_cuenta_pendiente_403_en_portal(client, admin_headers):
    # Registro público: la cuenta nace pendiente (no se puede hacer
    # login con ella, así que el token se acuña directamente con
    # create_access_token, mismo precedente que los demás tests).
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    username = _uid("pendtok")
    r = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pass1234abcd",
              "challenge_id": data["challenge_id"],
              "answer": int(m.group(1)) + int(m.group(2))},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    token = create_access_token(username)
    headers = {"Authorization": f"Bearer {token}"}
    # get_current_user re-verifica la fila de pendiente en cada
    # petición: token en mano o no, la cuenta pendiente ve nada.
    r = client.get(f"{PORTAL}/me", headers=headers)
    assert r.status_code == 403, r.text
    assert "pendiente" in r.json()["detail"]
    r = client.get(f"{BASE}/contenido/ideas", headers=headers)
    assert r.status_code == 403, r.text
