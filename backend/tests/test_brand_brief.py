"""NEST — Test exprés para Brief de Marca (2026-11-17).

Migración 9c2e7b4a1f08 (tabla brand_briefs) + endpoints:
- Portal: GET/PUT /api/business/marketing/portal/brief (contacto
  derivado del vínculo; sin vínculo -> 403; ?contact_id= ajeno se
  ignora para el cliente; admin necesita ?contact_id= para vista
  previa).
- Admin: GET /contenido/briefs (progreso por cliente), GET/PUT
  /contenido/briefs/{contact_id} (403 para cliente).

Reglas del test: respuestas vacías al inicio; Q2 con != 3 palabras
avisa (q2_warning) sin bloquear el guardado; un cliente nunca ve ni
edita el brief de otro.
"""
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine

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


def _mk_user(client, admin_headers, username: str) -> dict:
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
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


def _seed_pair(client, app, admin_headers) -> dict:
    """Dos clientes vinculados (A y B)."""
    user_a = _mk_user(client, admin_headers, _uid("briefA"))
    user_b = _mk_user(client, admin_headers, _uid("briefB"))
    contact_a = _mk_contact(client, admin_headers, _uid("BriefA"))
    contact_b = _mk_contact(client, admin_headers, _uid("BriefB"))
    _link(client, admin_headers, user_a["id"], contact_a["id"])
    _link(client, admin_headers, user_b["id"], contact_b["id"])
    return {
        "user_a": user_a, "user_b": user_b,
        "contact_a": contact_a, "contact_b": contact_b,
        "headers_a": _headers_for(app, user_a["username"]),
        "headers_b": _headers_for(app, user_b["username"]),
    }


# ------------------------------------------------------------- migración ----

def _run_alembic(db_file, target, downgrade=False):
    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    settings.database_url = f"sqlite:///{db_file}"
    try:
        if downgrade:
            command.downgrade(cfg, target)
        else:
            command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def test_migracion_brand_brief_upgrade_head(tmp_path):
    db_file = tmp_path / "brief.db"
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        insp = sa.inspect(engine)
        assert "brand_briefs" in insp.get_table_names()
        cols = {c["name"] for c in insp.get_columns("brand_briefs")}
        for name in ("id", "contact_id", "q1", "q2", "q3", "q4",
                     "q5", "q6", "q7", "q8", "created_at", "updated_at"):
            assert name in cols, name
        assert "ix_brand_briefs_contact_id" in {
            i["name"] for i in insp.get_indexes("brand_briefs")
        }
        fks = {
            (fk["constrained_columns"][0], fk["referred_table"])
            for fk in insp.get_foreign_keys("brand_briefs")
        }
        assert ("contact_id", "crm_contacts") in fks
    finally:
        engine.dispose()


def test_migracion_brand_brief_downgrade_a_7df4aeb666c6(tmp_path):
    db_file = tmp_path / "brief-down.db"
    _run_alembic(db_file, "head")
    _run_alembic(db_file, "7df4aeb666c6", downgrade=True)
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        insp = sa.inspect(engine)
        assert "brand_briefs" not in insp.get_table_names()
        # Lo anterior a la migración sigue intacto.
        assert "appointments" in insp.get_table_names()
        assert "user_id" in {
            c["name"] for c in insp.get_columns("crm_contacts")
        }
    finally:
        engine.dispose()


# ------------------------------------------------------------------- API ----

def test_1_portal_brief_empieza_vacio(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.get(f"{PORTAL}/brief", headers=s["headers_a"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["contact_id"] == s["contact_a"]["id"]
    assert body["answered"] == 0
    assert body["missing"] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert body["answers"] == {f"q{i}": "" for i in range(1, 9)}
    assert body["q2_words"] == 0
    assert body["q2_warning"] is False


def test_2_portal_brief_q2_avisa_sin_bloquear(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    # Q2 con 2 palabras: se guarda igual, con aviso.
    r = client.put(
        f"{PORTAL}/brief",
        json={"q1": "Vender playeras con historia.", "q2": "cercano rebelde"},
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answered"] == 2
    assert body["missing"] == [3, 4, 5, 6, 7, 8]
    assert body["answers"]["q1"] == "Vender playeras con historia."
    assert body["q2_words"] == 2
    assert body["q2_warning"] is True
    # Q2 con 3 palabras: sin aviso.
    r = client.put(
        f"{PORTAL}/brief", json={"q2": "cercano rebelde honesto"},
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["q2_words"] == 3
    assert r.json()["q2_warning"] is False
    assert r.json()["answered"] == 2  # q1 sigue guardada (parcial)
    # Guardado parcial por pregunta: q3 no toca q1/q2.
    r = client.put(
        f"{PORTAL}/brief", json={"q3": "Jóvenes de 18 a 30."},
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["answered"] == 3
    assert r.json()["answers"]["q1"] == "Vender playeras con historia."


def test_3_portal_brief_aislamiento_entre_clientes(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.put(
        f"{PORTAL}/brief",
        json={"q1": "Secreto A: historia de A."},
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    # B no ve el brief de A: su propio brief sigue vacío.
    r = client.get(f"{PORTAL}/brief", headers=s["headers_b"])
    assert r.status_code == 200, r.text
    assert r.json()["answered"] == 0
    assert "Secreto A" not in str(r.json())
    # A no puede leer el de B con ?contact_id=: el parámetro se ignora.
    r = client.get(
        f"{PORTAL}/brief?contact_id={s['contact_b']['id']}",
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["contact_id"] == s["contact_a"]["id"]
    assert r.json()["answers"]["q1"] == "Secreto A: historia de A."
    # A no puede escribir el de B con ?contact_id=: escribe el suyo.
    r = client.put(
        f"{PORTAL}/brief?contact_id={s['contact_b']['id']}",
        json={"q4": "Escrito por A en su propio brief."},
        headers=s["headers_a"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["contact_id"] == s["contact_a"]["id"]
    r = client.get(f"{PORTAL}/brief", headers=s["headers_b"])
    assert r.json()["answered"] == 0


def test_4_portal_brief_sin_vinculo_403(client, viewer_headers):
    for method in ("get", "put"):
        r = getattr(client, method)(
            f"{PORTAL}/brief",
            **({"json": {"q1": "x"}} if method == "put" else {}),
            headers=viewer_headers,
        )
        assert r.status_code == 403, (method, r.status_code)


def test_5_portal_brief_admin_vista_previa(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    # Admin sin ?contact_id= -> 403 (igual que el resto del portal).
    r = client.get(f"{PORTAL}/brief", headers=admin_headers)
    assert r.status_code == 403
    # Admin con ?contact_id= ve el brief de A y lo edita.
    r = client.put(
        f"{PORTAL}/brief?contact_id={s['contact_a']['id']}",
        json={"q5": "Transparencia total."},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["contact_id"] == s["contact_a"]["id"]
    assert r.json()["answers"]["q5"] == "Transparencia total."
    r = client.get(
        f"{PORTAL}/brief?contact_id={s['contact_a']['id']}",
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["answers"]["q5"] == "Transparencia total."
    r = client.get(f"{PORTAL}/brief?contact_id=999999", headers=admin_headers)
    assert r.status_code == 404


def test_6_contenido_briefs_admin_lista_y_detalle(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    client.put(
        f"{PORTAL}/brief",
        json={"q1": "Historia A.", "q2": "uno dos tres"},
        headers=s["headers_a"],
    )
    r = client.get(f"{BASE}/contenido/briefs", headers=admin_headers)
    assert r.status_code == 200, r.text
    by_id = {row["contact_id"]: row for row in r.json()}
    assert by_id[s["contact_a"]["id"]]["answered"] == 2
    assert by_id[s["contact_a"]["id"]]["missing"] == [3, 4, 5, 6, 7, 8]
    assert by_id[s["contact_b"]["id"]]["answered"] == 0
    r = client.get(
        f"{BASE}/contenido/briefs/{s['contact_a']['id']}", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["answers"]["q1"] == "Historia A."
    assert r.json()["q2_warning"] is False
    r = client.get(f"{BASE}/contenido/briefs/999999", headers=admin_headers)
    assert r.status_code == 404


def test_7_contenido_briefs_admin_edita_y_cliente_403(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.put(
        f"{BASE}/contenido/briefs/{s['contact_b']['id']}",
        json={"q3": "Cliente ideal de B.", "q5": "Rapidez."},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["answered"] == 2
    assert r.json()["answers"]["q3"] == "Cliente ideal de B."
    # El cliente lo ve en su portal (lo escribió el admin).
    r = client.get(f"{PORTAL}/brief", headers=s["headers_b"])
    assert r.json()["answers"]["q3"] == "Cliente ideal de B."
    # Cliente: 403 en los endpoints admin de briefs.
    r = client.get(f"{BASE}/contenido/briefs", headers=s["headers_a"])
    assert r.status_code == 403
    r = client.put(
        f"{BASE}/contenido/briefs/{s['contact_b']['id']}",
        json={"q1": "Intento de A."},
        headers=s["headers_a"],
    )
    assert r.status_code == 403


def test_8_portal_brief_sin_auth_401(client):
    r = client.get(f"{PORTAL}/brief")
    assert r.status_code == 401
    r = client.put(f"{PORTAL}/brief", json={"q1": "x"})
    assert r.status_code == 401


def test_9_brief_respuesta_muy_larga_422(client, app, admin_headers):
    s = _seed_pair(client, app, admin_headers)
    r = client.put(
        f"{PORTAL}/brief", json={"q1": "x" * 5001},
        headers=s["headers_a"],
    )
    assert r.status_code == 422, r.text
