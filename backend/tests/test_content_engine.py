"""NEST — Content Engine (plan conjunto §7).

Fixtures compartidas. NINGÚN test hace login propio.
"""
import datetime as dt
import uuid

BASE = "/api/business/marketing/contenido"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _future(days: int = 1, hour: int = 10) -> str:
    base = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


def _mk_idea(client, admin_headers, **over):
    body = {"title": _uid("Idea"), "notes": "", "source": "manual",
            "status": "idea"}
    body.update(over)
    r = client.post(f"{BASE}/ideas", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_template(client, admin_headers, **over):
    body = {"name": _uid("Plantilla"), "platform": "instagram",
            "tone": "directo",
            "body": "Tema: {{tema}}. Negocio: {{negocio}}. {{llamada}}"}
    body.update(over)
    r = client.post(f"{BASE}/plantillas", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------- ideas --

def test_ideas_crud_y_validacion(client, admin_headers, viewer_headers):
    idea = _mk_idea(client, admin_headers)
    r = client.get(f"{BASE}/ideas", headers=viewer_headers)
    assert r.status_code == 200
    assert any(i["id"] == idea["id"] for i in r.json())
    # escritura solo admin
    r = client.post(f"{BASE}/ideas", json={"title": "X"}, headers=viewer_headers)
    assert r.status_code == 403
    # validación de enums y FK
    r = client.post(
        f"{BASE}/ideas", json={"title": "X", "source": "invento"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"{BASE}/ideas", json={"title": "X", "contact_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404
    r = client.put(
        f"{BASE}/ideas/{idea['id']}",
        json={"status": "en_produccion"},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["status"] == "en_produccion"
    r = client.put(
        f"{BASE}/ideas/{idea['id']}", json={"status": "mal"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.delete(f"{BASE}/ideas/{idea['id']}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"{BASE}/ideas/{idea['id']}", headers=admin_headers)
    assert r.status_code == 404


# --------------------------------------------------------------- plantillas --

def test_plantillas_variable_desconocida_422(client, admin_headers):
    r = client.post(
        f"{BASE}/plantillas",
        json={"name": "Mala", "platform": "instagram",
              "body": "Hola {{precio}}"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    t = _mk_template(client, admin_headers)
    r = client.put(
        f"{BASE}/plantillas/{t['id']}",
        json={"body": "Nuevo {{tema}} y {{desconocida}}"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.put(
        f"{BASE}/plantillas/{t['id']}",
        json={"tone": "educativo"},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["tone"] == "educativo"
    r = client.delete(f"{BASE}/plantillas/{t['id']}", headers=admin_headers)
    assert r.status_code == 204


def test_generar_desde_plantilla_sin_ia(client, admin_headers):
    template = _mk_template(client, admin_headers, max_chars=30)
    # sin persistir: el calendario tiene los mismos items antes y después
    before = client.get(
        f"{BASE}/calendario?from=2026-11-01&to=2027-01-31",
        headers=admin_headers,
    ).json()
    r = client.post(
        f"{BASE}/generar-desde-plantilla",
        json={"template_id": template["id"],
              "variables": {"tema": "ofertas de noviembre",
                            "negocio": "RIV Goods",
                            "llamada": "Escríbenos hoy"}},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "plantilla"
    assert "demo" not in body
    assert body["template_id"] == template["id"]
    assert body["platform"] == "instagram"
    assert body["truncated"] is True
    assert len(body["text"]) == 30
    assert body["text"].startswith("Tema: ofertas de noviembre")
    after = client.get(
        f"{BASE}/calendario?from=2026-11-01&to=2027-01-31",
        headers=admin_headers,
    ).json()
    assert len(after) == len(before)
    # sin truncar cuando cabe
    template2 = _mk_template(client, admin_headers, max_chars=None)
    r = client.post(
        f"{BASE}/generar-desde-plantilla",
        json={"template_id": template2["id"],
              "variables": {"tema": "X"}},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["truncated"] is False
    assert r.json()["text"] == "Tema: X. Negocio: . "
    # tema obligatorio; variable desconocida -> 422; plantilla -> 404
    r = client.post(
        f"{BASE}/generar-desde-plantilla",
        json={"template_id": template2["id"], "variables": {}},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"{BASE}/generar-desde-plantilla",
        json={"template_id": template2["id"],
              "variables": {"tema": "X", "precio": "5"}},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"{BASE}/generar-desde-plantilla",
        json={"template_id": 999999, "variables": {"tema": "X"}},
        headers=admin_headers,
    )
    assert r.status_code == 404


# --------------------------------------------------------------- calendario --

def test_calendario_from_to_obligatorio_y_rango(client, admin_headers):
    r = client.get(f"{BASE}/calendario", headers=admin_headers)
    assert r.status_code == 422
    r = client.get(f"{BASE}/calendario?from=2026-11-01", headers=admin_headers)
    assert r.status_code == 422
    r = client.get(
        f"{BASE}/calendario?from=2026-01-01&to=2026-12-31",
        headers=admin_headers,
    )
    assert r.status_code == 422  # más de 93 días
    r = client.get(
        f"{BASE}/calendario?from=2026-11-01&to=2026-11-30",
        headers=admin_headers,
    )
    assert r.status_code == 200


def test_calendario_crud_y_publicado_sin_retroceso(client, admin_headers):
    idea = _mk_idea(client, admin_headers)
    r = client.post(
        f"{BASE}/calendario",
        json={"title": "Post 1", "text": "Hola", "scheduled_at": _future(1, 9),
              "platform": "threads", "status": "borrador",
              "idea_id": idea["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["idea_id"] == idea["id"]
    # FK inexistente -> 404
    r = client.post(
        f"{BASE}/calendario",
        json={"title": "Post X", "scheduled_at": _future(1, 9),
              "platform": "threads", "idea_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404
    # scheduled_at naive -> 422
    naive = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat()
    r = client.post(
        f"{BASE}/calendario",
        json={"title": "Post Y", "scheduled_at": naive, "platform": "threads"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    # programado -> publicado -> sin retroceso
    r = client.patch(
        f"{BASE}/calendario/{item['id']}", json={"status": "programado"},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["status"] == "programado"
    r = client.patch(
        f"{BASE}/calendario/{item['id']}", json={"status": "publicado"},
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["status"] == "publicado"
    r = client.patch(
        f"{BASE}/calendario/{item['id']}", json={"status": "borrador"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.patch(
        f"{BASE}/calendario/{item['id']}", json={"status": "programado"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.delete(f"{BASE}/calendario/{item['id']}", headers=admin_headers)
    assert r.status_code == 204
