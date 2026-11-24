"""Lote nocturno 2026-11-17 — Agente 2 (Performance & Backend).

S1 (CRÍTICA, QA #1): un cliente vinculado NO puede leer datos de
otros clientes por las rutas no-portal. El servidor devuelve 403 en
esas lecturas (helper `deny_linked_reader`, en `app/api/portal.py`):
CRM, facturas, correos (plantillas + logs), referidos (campañas,
detalle y referidos), desarrollo (proyectos + tareas), crear (copies),
business (notas/tareas por área) y plantillas de contenido. El portal
sigue funcionando para el cliente vinculado; admin y `prueba` sin
vínculo no cambian (D3 pendiente).

S4 (QA #11): `list_briefs` filtra los briefs por los `contact_id` de
la página: una página nunca trae briefs fuera de ella.

Fixtures compartidas (`client`, `admin_headers`, `viewer_headers`).
Ningún test hace login propio: los tokens de cliente se acuñan con
`create_access_token` (precedente `test_portal_isolation.py`). La BD
es compartida por toda la suite: las aserciones son por pertenencia
de los ids sembrados, nunca por igualdad de la lista completa.
"""
import uuid

import pytest

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import (
    BrandBrief,
    BusinessNote,
    BusinessTask,
    Contact,
    ContentTemplate,
    CopyDraft,
    DigitalProject,
    DigitalTask,
    EmailLog,
    EmailTemplate,
    Invoice,
    Referral,
    ReferralCampaign,
    User,
)

BASE = "/api/business/marketing"
PORTAL = f"{BASE}/portal"

# La BD es compartida por toda la suite y hay tests preexistentes que
# asumen vacías las tablas de business/desarrollo (igualdad exacta de
# la lista). Cada seed de este archivo se borra al terminar su test.
_SEEDED: list[dict] = []


def _delete_seed(app, s: dict) -> None:
    """Borra por id todo lo sembrado en un test (ver nota de _SEEDED)."""
    db, gen = _db(app)
    try:
        def _del(model, ids):
            for i in ids:
                if i is not None:
                    db.query(model).filter(model.id == i).delete()

        _del(BusinessTask, [s.get("btask_b_id")])
        _del(BusinessNote, [s.get("note_b_id")])
        _del(DigitalTask, [s.get("task_b_id")])
        _del(DigitalProject, [s.get("proj_b_id")])
        _del(Referral, [s.get("referral_b_id")])
        _del(ReferralCampaign, [s.get("ref_b_id")])
        _del(Invoice, [s.get("inv_b_id")])
        _del(ContentTemplate, [s.get("tpl_b_id")])
        _del(EmailTemplate, [s.get("tpl_id")])
        _del(EmailLog, [s.get("log_id")])
        _del(CopyDraft, [s.get("draft_id")])
        for cid in s.get("contact_ids", []):
            db.query(BrandBrief).filter(BrandBrief.contact_id == cid).delete()
            db.query(Contact).filter(Contact.id == cid).delete()
        for uid in s.get("user_ids", []):
            db.query(User).filter(User.id == uid).delete()
        db.commit()
    finally:
        _close(gen)


@pytest.fixture(autouse=True)
def _cleanup_seeds(app):
    yield
    while _SEEDED:
        _delete_seed(app, _SEEDED.pop())


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


def _seed_db_rows(app, tag: str, contact_b_id: int) -> dict:
    """Filas sin endpoint de creación barato o con limiter (correos):
    se insertan directo en BD. Solo datos de B (el cliente ajeno)."""
    db, gen = _db(app)
    try:
        tpl = EmailTemplate(
            name=f"Plantilla correo B-{tag}",
            subject=f"Asunto B-{tag}", body=f"Cuerpo B-{tag}",
        )
        log = EmailLog(
            contact_id=contact_b_id, contact_name=f"PortB-{tag}",
            contact_email="", template_name=f"Plantilla correo B-{tag}",
            subject=f"Asunto B-{tag}", body=f"Cuerpo secreto B-{tag}",
            status="preparado",
        )
        draft = CopyDraft(
            topic=f"Tema B-{tag}", platform="instagram",
            tone="directo", text=f"Copy secreto B-{tag}", demo=True,
        )
        db.add_all([tpl, log, draft])
        db.commit()
        return {"tpl_id": tpl.id, "log_id": log.id, "draft_id": draft.id}
    finally:
        _close(gen)


def _seed_pair(client, app, admin_headers) -> dict:
    """Dos clientes vinculados (A y B) con datos propios de B en
    facturas, referidos, desarrollo, correos, crear, business y
    plantillas de contenido."""
    tag = uuid.uuid4().hex[:8]
    user_a = _mk_user(client, admin_headers, _uid("s1A"))
    user_b = _mk_user(client, admin_headers, _uid("s1B"))
    contact_a = _mk_contact(client, admin_headers, _uid("S1A"))
    contact_b = _mk_contact(client, admin_headers, _uid("S1B"))
    _link(client, admin_headers, user_a["id"], contact_a["id"])
    _link(client, admin_headers, user_b["id"], contact_b["id"])
    headers_a = _headers_for(app, user_a["username"])
    headers_b = _headers_for(app, user_b["username"])
    # Factura de B
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": contact_b["name"], "contact_id": contact_b["id"],
              "items": [{"description": "Servicio B", "qty": 1, "unit_price": 100}]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    inv_b = r.json()
    # Campaña de referidos de B + un referido
    r = client.post(
        "/api/referrals/campaigns",
        json={"name": f"Ref B-{tag}", "business_contact_id": contact_b["id"],
              "reward_type": "fixed", "reward_value": "10", "status": "active"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    ref_b = r.json()
    r = client.post(
        f"/api/referrals/campaigns/{ref_b['id']}/referrals",
        json={"referrer_name": "Referidor B", "referrer_contact": "",
              "referred_name": "Referido B", "referred_contact": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    referral_b = r.json()
    # Proyecto + tarea de B
    r = client.post(
        "/api/desarrollo/projects",
        json={"title": f"Web B-{tag}", "contact_id": contact_b["id"],
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
    # Nota + tarea de business (área marketing) y plantilla de contenido
    r = client.post(
        "/api/business/marketing/notes",
        json={"title": f"Nota interna B-{tag}", "body": "Secreto B"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    note_b = r.json()
    r = client.post(
        "/api/business/marketing/tasks",
        json={"title": f"Tarea interna B-{tag}"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    btask_b = r.json()
    r = client.post(
        f"{BASE}/contenido/plantillas",
        json={"name": f"Plantilla B-{tag}", "platform": "instagram",
              "tone": "directo",
              "body": "Hola {{tema}} de {{negocio}}: {{llamada}}",
              "max_chars": 200},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    tpl_b = r.json()
    db_rows = _seed_db_rows(app, tag, contact_b["id"])
    seed = {
        "user_a": user_a, "user_b": user_b,
        "contact_a": contact_a, "contact_b": contact_b,
        "headers_a": headers_a, "headers_b": headers_b,
        "inv_b": inv_b, "ref_b": ref_b, "referral_b": referral_b,
        "proj_b": proj_b, "task_b": task_b,
        "note_b": note_b, "btask_b": btask_b, "tpl_b": tpl_b,
        "inv_b_id": inv_b["id"], "ref_b_id": ref_b["id"],
        "referral_b_id": referral_b["id"], "proj_b_id": proj_b["id"],
        "task_b_id": task_b["id"], "note_b_id": note_b["id"],
        "btask_b_id": btask_b["id"], "tpl_b_id": tpl_b["id"],
        "contact_ids": [contact_a["id"], contact_b["id"]],
        "user_ids": [user_a["id"], user_b["id"]],
        **db_rows,
    }
    _SEEDED.append(seed)
    return seed


# S1 — cliente vinculado: 403 en las lecturas no-portal -----------------

def test_s1_crm_403_para_cliente_vinculado(client, app, admin_headers, viewer_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get("/api/crm/contacts", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    # Ni siquiera con búsqueda por el nombre del otro cliente.
    r = client.get(
        f"/api/crm/contacts?q={s['contact_b']['name']}", headers=s["headers_a"]
    )
    assert r.status_code == 403, r.text
    # Admin sigue viendo todo.
    r = client.get("/api/crm/contacts", headers=admin_headers)
    assert r.status_code == 200, r.text
    ids = [c["id"] for c in r.json()]
    assert s["contact_a"]["id"] in ids and s["contact_b"]["id"] in ids
    # Prueba sin vínculo: D3 RESUELTO el 2026-11-23 (Agente 2) —
    # prueba ya no lee el CRM (403 por módulo).
    r = client.get("/api/crm/contacts", headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_s1_facturas_403_para_cliente_vinculado(client, app, admin_headers, viewer_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get("/api/facturas/invoices", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    r = client.get("/api/facturas/invoices", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(f["id"] == s["inv_b"]["id"] for f in r.json())
    # D3 RESUELTO el 2026-11-23 (Agente 2): prueba ya no lee facturas.
    r = client.get("/api/facturas/invoices", headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_s1_correos_403_para_cliente_vinculado(client, app, admin_headers, viewer_headers):
    s = _seed_pair(client, app, admin_headers)
    for path in ("/api/correos/templates", "/api/correos/logs"):
        r = client.get(path, headers=s["headers_a"])
        assert r.status_code == 403, (path, r.text)
    r = client.get("/api/correos/templates", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["tpl_id"] for t in r.json())
    r = client.get("/api/correos/logs", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["log_id"] for t in r.json())
    # D3 RESUELTO el 2026-11-23 (Agente 2): prueba ya no lee correos.
    r = client.get("/api/correos/templates", headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.get("/api/correos/logs", headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_s1_referidos_403_para_cliente_vinculado(client, app, admin_headers, viewer_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get("/api/referrals/campaigns", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    r = client.get(f"/api/referrals/campaigns/{s['ref_b']['id']}", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    r = client.get(
        f"/api/referrals/campaigns/{s['ref_b']['id']}/referrals",
        headers=s["headers_a"],
    )
    assert r.status_code == 403, r.text
    # Admin sigue viendo todo, incluido el share_code y el referido.
    r = client.get("/api/referrals/campaigns", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(c["id"] == s["ref_b"]["id"] for c in r.json())
    r = client.get(f"/api/referrals/campaigns/{s['ref_b']['id']}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["share_code"]
    r = client.get(
        f"/api/referrals/campaigns/{s['ref_b']['id']}/referrals",
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert any(x["id"] == s["referral_b"]["id"] for x in r.json())
    # Prueba sin vínculo: sin cambios (D3).
    r = client.get("/api/referrals/campaigns", headers=viewer_headers)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/referrals/campaigns/{s['ref_b']['id']}", headers=viewer_headers)
    assert r.status_code == 200, r.text


def test_s1_desarrollo_403_para_cliente_vinculado(client, app, admin_headers, viewer_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get("/api/desarrollo/projects", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    r = client.get(
        f"/api/desarrollo/projects/{s['proj_b']['id']}/tasks",
        headers=s["headers_a"],
    )
    assert r.status_code == 403, r.text
    r = client.get("/api/desarrollo/projects", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(p["id"] == s["proj_b"]["id"] for p in r.json())
    r = client.get(
        f"/api/desarrollo/projects/{s['proj_b']['id']}/tasks",
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["task_b"]["id"] for t in r.json())
    r = client.get("/api/desarrollo/projects", headers=viewer_headers)
    assert r.status_code == 200, r.text
    r = client.get(
        f"/api/desarrollo/projects/{s['proj_b']['id']}/tasks",
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text


def test_s1_crear_copies_y_business_403_para_cliente_vinculado(
    client, app, admin_headers, viewer_headers
):
    s = _seed_pair(client, app, admin_headers)
    for path in (
        "/api/crear/copies",
        "/api/business/marketing/notes",
        "/api/business/marketing/tasks",
    ):
        r = client.get(path, headers=s["headers_a"])
        assert r.status_code == 403, (path, r.text)
    r = client.get("/api/crear/copies", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(d["id"] == s["draft_id"] for d in r.json())
    r = client.get("/api/business/marketing/notes", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(n["id"] == s["note_b"]["id"] for n in r.json())
    r = client.get("/api/business/marketing/tasks", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["btask_b"]["id"] for t in r.json())
    for path in (
        "/api/crear/copies",
        "/api/business/marketing/notes",
        "/api/business/marketing/tasks",
    ):
        r = client.get(path, headers=viewer_headers)
        assert r.status_code == 200, (path, r.text)


def test_s1_plantillas_contenido_403_para_cliente_vinculado(
    client, app, admin_headers, viewer_headers
):
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{BASE}/contenido/plantillas", headers=s["headers_a"])
    assert r.status_code == 403, r.text
    r = client.get(f"{BASE}/contenido/plantillas", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["tpl_b"]["id"] for t in r.json())
    r = client.get(f"{BASE}/contenido/plantillas", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert any(t["id"] == s["tpl_b"]["id"] for t in r.json())


def test_s1_portal_sigue_funcionando_para_cliente_vinculado(
    client, app, admin_headers
):
    """El 403 no-portal no rompe la vista propia del portal."""
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{PORTAL}/me", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    assert r.json()["contact"]["id"] == s["contact_a"]["id"]
    r = client.get(f"{PORTAL}/facturas", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    assert all(f["id"] != s["inv_b"]["id"] for f in r.json())
    r = client.get(f"{PORTAL}/facturas", headers=s["headers_b"])
    assert r.status_code == 200, r.text
    assert [f["id"] for f in r.json()] == [s["inv_b"]["id"]]


# S4 — list_briefs: solo los briefs de la página ---------------------------

def test_s4_list_briefs_solo_briefs_de_la_pagina(client, app, admin_headers):
    # Tres contactos nuevos con brief (1 respuesta cada uno); sus ids
    # son consecutivos y crecientes, así que su orden en list_briefs
    # (id asc) es el de creación.
    contacts = [_mk_contact(client, admin_headers, _uid("S4")) for _ in range(3)]
    _SEEDED.append(
        {"contact_ids": [c["id"] for c in contacts], "user_ids": []}
    )
    for c in contacts:
        r = client.put(
            f"{BASE}/contenido/briefs/{c['id']}",
            json={"q1": "Respuesta del brief"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["answered"] == 1
    # Posición global (offset) del primer contacto nuevo en el orden
    # por id asc: se lee de la BD, no se supone.
    db, gen = _db(app)
    try:
        ordered_ids = [c.id for c in db.query(Contact).order_by(Contact.id.asc()).all()]
    finally:
        _close(gen)
    offsets = [ordered_ids.index(c["id"]) for c in contacts]
    assert offsets == [offsets[0], offsets[0] + 1, offsets[0] + 2]
    # Página de 1 sobre el segundo contacto: solo su brief, nunca los
    # de los otros dos (ni ningún brief fuera de página).
    r = client.get(
        f"{BASE}/contenido/briefs?limit=1&offset={offsets[1]}",
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert [b["contact_id"] for b in r.json()] == [contacts[1]["id"]]
    assert r.json()[0]["answered"] == 1
    # Página de 2 desde el primero: los dos primeros, no el tercero.
    r = client.get(
        f"{BASE}/contenido/briefs?limit=2&offset={offsets[0]}",
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert [b["contact_id"] for b in r.json()] == [
        contacts[0]["id"], contacts[1]["id"],
    ]
    assert all(b["answered"] == 1 for b in r.json())
