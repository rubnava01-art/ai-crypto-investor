"""NEST — Marketing + Citas (plan conjunto §7).

Fixtures compartidas (client/admin_headers/viewer_headers). NINGÚN
test hace login propio: los tokens de clientes se acuñan con
create_access_token (precedente test_fase2_backend), sin tocar el
presupuesto de login (10/min por IP).
"""
import datetime as dt
import uuid

import pytest

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import User

BASE = "/api/business/marketing"


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
        f"{BASE}/portal/vinculos",
        json={"user_id": user_id, "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text


def _future(days: int = 1, hour: int = 10, minute: int = 0) -> str:
    base = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()


def _cita_body(contact_id=None, **over):
    body = {
        "service_type": "Asesoría",
        "starts_at": _future(1, 10),
        "duration_min": 60,
        "notes": "",
    }
    if contact_id is not None:
        body["contact_id"] = contact_id
    body.update(over)
    return body


@pytest.fixture(autouse=True)
def _clear_citas_limiter():
    from app.api.marketing import citas_limiter

    citas_limiter.clear()
    yield
    citas_limiter.clear()


# ------------------------------------------------------------------- citas --

def test_admin_crea_cita_y_lista_filtrada(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("CitaCli"))
    r = client.get(f"{BASE}/citas?contact_id={contact['id']}", headers=admin_headers)
    assert r.status_code == 200 and r.json() == []
    r = client.post(
        f"{BASE}/citas", json=_cita_body(contact["id"]), headers=admin_headers
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pendiente"
    assert r.json()["contact_id"] == contact["id"]
    assert r.json()["client_name"] == contact["name"]
    assert r.json()["starts_at"].endswith("+00:00")
    r = client.get(f"{BASE}/citas?contact_id={contact['id']}", headers=admin_headers)
    assert r.status_code == 200 and len(r.json()) == 1


def test_cita_rechaza_naive_y_pasado(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("CitaNaive"))
    naive = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat()
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(contact["id"], starts_at=naive),
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat()
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(contact["id"], starts_at=past),
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


def test_maquina_estados_forward_only(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("CitaFSM"))
    r = client.post(
        f"{BASE}/citas", json=_cita_body(contact["id"]), headers=admin_headers
    )
    cid = r.json()["id"]
    # pendiente -> confirmada -> completada
    for target in ("confirmada", "completada"):
        r = client.patch(
            f"{BASE}/citas/{cid}", json={"status": target}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == target
    # completada es terminal: nunca reabrir
    r = client.patch(
        f"{BASE}/citas/{cid}", json={"status": "confirmada"}, headers=admin_headers
    )
    assert r.status_code == 422
    r = client.patch(
        f"{BASE}/citas/{cid}", json={"status": "cancelada"}, headers=admin_headers
    )
    assert r.status_code == 422
    # cancelada terminal desde pendiente/confirmada
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(contact["id"], starts_at=_future(2, 10)),
        headers=admin_headers,
    )
    cid2 = r.json()["id"]
    r = client.patch(
        f"{BASE}/citas/{cid2}", json={"status": "cancelada"}, headers=admin_headers
    )
    assert r.status_code == 200 and r.json()["status"] == "cancelada"
    r = client.patch(
        f"{BASE}/citas/{cid2}", json={"status": "pendiente"}, headers=admin_headers
    )
    assert r.status_code == 422
    # estado inválido
    r = client.patch(
        f"{BASE}/citas/{cid2}", json={"status": "inventado"}, headers=admin_headers
    )
    assert r.status_code == 422


def test_solape_mismo_contacto_409_otro_contacto_ok(client, admin_headers):
    a = _mk_contact(client, admin_headers, _uid("SolapeA"))
    b = _mk_contact(client, admin_headers, _uid("SolapeB"))
    start = _future(3, 10)
    r = client.post(
        f"{BASE}/citas", json=_cita_body(a["id"], starts_at=start),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    # mismo contacto, solape parcial -> 409
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(a["id"], starts_at=_future(3, 10, 30)),
        headers=admin_headers,
    )
    assert r.status_code == 409, r.text
    # mismo contacto, adyacente (sin solape) -> 201
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(a["id"], starts_at=_future(3, 11)),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    # otro contacto, mismo hueco -> 201 (D11: sin solape global)
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(b["id"], starts_at=_future(3, 10, 30)),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    # cancelada no bloquea el hueco
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(a["id"], starts_at=_future(4, 10)),
        headers=admin_headers,
    )
    cid = r.json()["id"]
    r = client.patch(
        f"{BASE}/citas/{cid}", json={"status": "cancelada"}, headers=admin_headers
    )
    assert r.status_code == 200
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(a["id"], starts_at=_future(4, 10)),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text


def test_cliente_crea_su_cita_y_no_para_otro(client, app, admin_headers, viewer_headers):
    # Fase 0 (2026-11-23, mejoras óptimas, P0-1): el router de
    # marketing exige el módulo "business" — el cliente vinculado
    # YA NO puede crear citas por POST /citas (403) ni ver la agenda
    # (403). Su superficie es el portal
    # (/api/business/marketing/portal/*). La auto-reserva por
    # cliente queda cerrada hasta que exista un endpoint de reserva
    # en el portal. Este test fija el nuevo comportamiento.
    user_a = _mk_user(client, admin_headers, _uid("cliA"))
    user_b = _mk_user(client, admin_headers, _uid("cliB"))
    contact_a = _mk_contact(client, admin_headers, _uid("CliA"))
    contact_b = _mk_contact(client, admin_headers, _uid("CliB"))
    _link(client, admin_headers, user_a["id"], contact_a["id"])
    _link(client, admin_headers, user_b["id"], contact_b["id"])
    headers_a = _headers_for(app, user_a["username"])
    # cliente vinculado: 403 también para su propia cita
    r = client.post(
        f"{BASE}/citas", json=_cita_body(starts_at=_future(5, 10)), headers=headers_a
    )
    assert r.status_code == 403, r.text
    # contact_id de otro cliente -> 403
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(contact_b["id"], starts_at=_future(5, 12)),
        headers=headers_a,
    )
    assert r.status_code == 403, r.text
    # sin vínculo (viewer compartido) -> 403
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(starts_at=_future(5, 14)),
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text
    # agenda completa: solo admin
    r = client.get(f"{BASE}/citas", headers=headers_a)
    assert r.status_code == 403


def test_rate_limit_citas_10_por_minuto(client, admin_headers):
    for day in range(1, 11):
        r = client.post(
            f"{BASE}/citas",
            json=_cita_body(starts_at=_future(day, 9), client_name=f"RL{day}"),
            headers=admin_headers,
        )
        assert r.status_code == 201, (day, r.text)
    r = client.post(
        f"{BASE}/citas",
        json=_cita_body(starts_at=_future(11, 9), client_name="RL11"),
        headers=admin_headers,
    )
    assert r.status_code == 429, r.text


def test_delete_cita_admin_y_403_prueba(client, admin_headers, viewer_headers):
    contact = _mk_contact(client, admin_headers, _uid("CitaDel"))
    r = client.post(
        f"{BASE}/citas", json=_cita_body(contact["id"]), headers=admin_headers
    )
    cid = r.json()["id"]
    r = client.delete(f"{BASE}/citas/{cid}", headers=viewer_headers)
    assert r.status_code == 403
    r = client.delete(f"{BASE}/citas/{cid}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"{BASE}/citas/{cid}", headers=admin_headers)
    assert r.status_code == 404


# --------------------------------------------------------------- campañas --

def test_campanas_crud_y_validacion(client, admin_headers, viewer_headers):
    r = client.get(f"{BASE}/campanas", headers=admin_headers)
    assert r.status_code == 200
    r = client.post(
        f"{BASE}/campanas",
        json={"name": "Promo IG", "channel": "instagram", "status": "activa",
              "budget": 100, "spend": 25},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    camp = r.json()
    assert camp["budget"] == 100 and camp["spend"] == 25
    # Fase 0 (2026-11-23): prueba recibe 403 también en lectura.
    r = client.get(f"{BASE}/campanas", headers=viewer_headers)
    assert r.status_code == 403
    # escritura solo admin
    r = client.post(
        f"{BASE}/campanas",
        json={"name": "X", "channel": "instagram"},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    # validación: canal y montos
    r = client.post(
        f"{BASE}/campanas",
        json={"name": "X", "channel": "tiktok"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"{BASE}/campanas",
        json={"name": "X", "channel": "instagram", "budget": -5},
        headers=admin_headers,
    )
    assert r.status_code == 422
    # PUT con contact_id inexistente -> 404
    r = client.put(
        f"{BASE}/campanas/{camp['id']}",
        json={"contact_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404
    contact = _mk_contact(client, admin_headers, _uid("CampCli"))
    r = client.put(
        f"{BASE}/campanas/{camp['id']}",
        json={"status": "pausada", "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pausada"
    assert r.json()["contact_id"] == contact["id"]
    r = client.delete(f"{BASE}/campanas/{camp['id']}", headers=admin_headers)
    assert r.status_code == 204


# ------------------------------------------------- Fase 1: factura + borrado --

def test_factura_acepta_contact_id_y_404_si_no_existe(client, admin_headers):
    contact = _mk_contact(client, admin_headers, _uid("FacCli"))
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": contact["name"], "contact_id": contact["id"],
              "items": [{"description": "Servicio", "qty": 2, "unit_price": 50}],
              "tax_rate": 0},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["contact_id"] == contact["id"]
    r = client.post(
        "/api/facturas/invoices",
        json={"client_name": "Nadie", "contact_id": 999999,
              "items": [{"description": "Servicio", "qty": 1, "unit_price": 10}]},
        headers=admin_headers,
    )
    assert r.status_code == 404


def test_delete_contacto_409_con_vinculo_o_cita_futura(client, app, admin_headers):
    user = _mk_user(client, admin_headers, _uid("delCli"))
    contact = _mk_contact(client, admin_headers, _uid("DelCli"))
    _link(client, admin_headers, user["id"], contact["id"])
    r = client.delete(f"/api/crm/contacts/{contact['id']}", headers=admin_headers)
    assert r.status_code == 409, r.text
    # sin vínculo pero con cita futura -> 409
    contact2 = _mk_contact(client, admin_headers, _uid("DelCli2"))
    r = client.post(
        f"{BASE}/citas", json=_cita_body(contact2["id"], starts_at=_future(6, 10)),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    r = client.delete(f"/api/crm/contacts/{contact2['id']}", headers=admin_headers)
    assert r.status_code == 409, r.text
    # cita cancelada -> ya se puede borrar
    appt_id = client.get(
        f"{BASE}/citas?contact_id={contact2['id']}", headers=admin_headers
    ).json()[0]["id"]
    r = client.patch(
        f"{BASE}/citas/{appt_id}", json={"status": "cancelada"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    r = client.delete(f"/api/crm/contacts/{contact2['id']}", headers=admin_headers)
    assert r.status_code == 204, r.text
