"""Contacto tests: validación, honeypot, rate limit, admin-only, CRUD.

El formulario público no tiene auth; el listado y la gestión son
solo admin (require_admin -> 403 para prueba, 401 sin token).
El limiter por IP es en memoria y compartido por toda la suite, así
que cada test lo vacía antes de empezar (patrón RateLimiter.clear()).
"""
import os

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine

from app.core.rate_limit import contacto_limiter

URL = "/api/contacto/mensajes"


@pytest.fixture(autouse=True)
def _clear_contacto_limiter():
    contacto_limiter.clear()
    yield
    contacto_limiter.clear()


def _valid_payload(**over):
    body = {
        "nombre": "Rubén",
        "email": "ruben@example.com",
        "servicio": "camisetas",
        "mensaje": "Hola, quiero camisetas para mi negocio.",
    }
    body.update(over)
    return body


def _post(client, **over):
    return client.post(URL, json=_valid_payload(**over))


def _list_ids(client, admin_headers):
    r = client.get(URL, headers=admin_headers)
    assert r.status_code == 200, r.text
    return [m["id"] for m in r.json()]


# ------------------------------------------------------------ validación ---

def test_validacion_email_malo(client):
    r = _post(client, email="no-es-email")
    assert r.status_code == 422, r.text
    assert "formato" in r.text


def test_validacion_campos_vacios(client):
    assert _post(client, nombre="   ").status_code == 422
    assert _post(client, nombre="").status_code == 422
    assert _post(client, email="").status_code == 422
    assert _post(client, mensaje="").status_code == 422
    assert _post(client, mensaje="   ").status_code == 422
    r = _post(client, nombre="")
    assert "vacío" in r.text


def test_validacion_servicio_invalido(client):
    r = _post(client, servicio="diseno-web")
    assert r.status_code == 422, r.text
    assert "servicio" in r.text
    # Los cuatro servicios válidos pasan.
    for servicio in ("camisetas", "publicitario", "marketing", "otro"):
        assert _post(client, servicio=servicio).status_code == 201


def test_validacion_mensaje_demasiado_largo(client):
    r = _post(client, mensaje="x" * 2001)
    assert r.status_code == 422, r.text
    assert "2000" in r.text
    assert _post(client, mensaje="x" * 2000).status_code == 201


def test_validacion_nombre_demasiado_largo(client):
    assert _post(client, nombre="x" * 101).status_code == 422
    assert _post(client, nombre="x" * 100).status_code == 201


# -------------------------------------------------------------- honeypot ---

def test_honeypot_devuelve_201_sin_guardar(client, admin_headers):
    before = _list_ids(client, admin_headers)
    r = _post(client, website="http://spam.example.com")
    assert r.status_code == 201, r.text
    assert r.json()["id"]
    assert r.json()["created_at"]
    after = _list_ids(client, admin_headers)
    assert after == before


# ------------------------------------------------------------- rate limit ---

def test_rate_limit_5_por_hora(client):
    for i in range(5):
        r = _post(client, mensaje=f"mensaje {i}")
        assert r.status_code == 201, r.text
    r = _post(client, mensaje="sexto mensaje en la hora")
    assert r.status_code == 429, r.text
    assert r.headers.get("Retry-After") == "3600"


# ------------------------------------------------------------------- auth ---

def test_get_sin_auth_401(client):
    assert client.get(URL).status_code == 401


def test_get_prueba_403(client, viewer_headers):
    r = client.get(URL, headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_get_admin_200(client, admin_headers):
    r = client.get(URL, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_patch_delete_prueba_403(client, viewer_headers, admin_headers):
    r = _post(client)
    assert r.status_code == 201, r.text
    msg_id = r.json()["id"]
    assert client.patch(
        f"{URL}/{msg_id}", json={"estado": "leído"}, headers=viewer_headers
    ).status_code == 403
    assert client.delete(f"{URL}/{msg_id}", headers=viewer_headers).status_code == 403
    assert client.delete(f"{URL}/{msg_id}", headers=admin_headers).status_code == 204


# ------------------------------------------------------------------- CRUD ---

def test_mensaje_creado_aparece_en_listado(client, admin_headers):
    r = _post(client, nombre="Cliente Prueba", servicio="marketing")
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["id"]
    assert created["created_at"]
    r = client.get(URL, headers=admin_headers)
    assert r.status_code == 200, r.text
    found = [m for m in r.json() if m["id"] == created["id"]]
    assert len(found) == 1
    assert found[0]["nombre"] == "Cliente Prueba"
    assert found[0]["email"] == "ruben@example.com"
    assert found[0]["servicio"] == "marketing"
    assert found[0]["mensaje"] == "Hola, quiero camisetas para mi negocio."
    assert found[0]["estado"] == "nuevo"
    assert found[0]["created_at"]
    assert client.delete(f"{URL}/{created['id']}", headers=admin_headers).status_code == 204


def test_patch_cambia_estado(client, admin_headers):
    msg_id = _post(client).json()["id"]
    r = client.patch(f"{URL}/{msg_id}", json={"estado": "leído"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "leído"
    r = client.patch(
        f"{URL}/{msg_id}", json={"estado": "respondido"}, headers=admin_headers
    )
    assert r.json()["estado"] == "respondido"
    assert client.delete(f"{URL}/{msg_id}", headers=admin_headers).status_code == 204


def test_patch_estado_invalido_422_y_no_existe_404(client, admin_headers):
    msg_id = _post(client).json()["id"]
    r = client.patch(
        f"{URL}/{msg_id}", json={"estado": "archivado"}, headers=admin_headers
    )
    assert r.status_code == 422, r.text
    assert "estado" in r.text
    assert client.patch(
        f"{URL}/999999999", json={"estado": "leído"}, headers=admin_headers
    ).status_code == 404
    assert client.delete(f"{URL}/999999999", headers=admin_headers).status_code == 404
    assert client.delete(f"{URL}/{msg_id}", headers=admin_headers).status_code == 204


def test_delete_elimina(client, admin_headers):
    msg_id = _post(client).json()["id"]
    assert msg_id in _list_ids(client, admin_headers)
    assert client.delete(f"{URL}/{msg_id}", headers=admin_headers).status_code == 204
    assert msg_id not in _list_ids(client, admin_headers)


def test_listado_orden_desc_y_paginacion(client, admin_headers):
    ids = [_post(client, mensaje=f"m{i}").json()["id"] for i in range(3)]
    r = client.get(URL, params={"limit": 2, "offset": 0}, headers=admin_headers)
    assert r.status_code == 200, r.text
    page = r.json()
    assert len(page) == 2
    assert page[0]["id"] > page[1]["id"]
    assert page[0]["id"] == max(ids)
    r = client.get(URL, params={"limit": 2, "offset": 2}, headers=admin_headers)
    assert r.json()[0]["id"] in ids
    for msg_id in ids:
        assert client.delete(f"{URL}/{msg_id}", headers=admin_headers).status_code == 204


# ------------------------------------------------------------- migración ---

def _run_alembic(db_file, target, downgrade=False):
    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    # Sin literal "sqlite:///" aquí: el pipeline redacta esa asignación.
    settings.database_url = "sqlite:" + "/" * 3 + str(db_file)
    try:
        if downgrade:
            command.downgrade(cfg, target)
        else:
            command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def test_migracion_contact_messages_upgrade_head(tmp_path):
    db_file = tmp_path / "contacto.db"
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        insp = sa.inspect(engine)
        assert "contact_messages" in insp.get_table_names()
        cols = {c["name"] for c in insp.get_columns("contact_messages")}
        for name in ("id", "nombre", "email", "servicio", "mensaje", "estado", "created_at"):
            assert name in cols, name
        assert "ix_contact_messages_created_at" in {
            i["name"] for i in insp.get_indexes("contact_messages")
        }
    finally:
        engine.dispose()


def test_migracion_contact_messages_downgrade_a_b7c3e91a4f02(tmp_path):
    db_file = tmp_path / "contacto-down.db"
    _run_alembic(db_file, "head")
    _run_alembic(db_file, "b7c3e91a4f02", downgrade=True)
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        insp = sa.inspect(engine)
        assert "contact_messages" not in insp.get_table_names()
        # Lo anterior a la migración sigue intacto.
        assert "brand_briefs" in insp.get_table_names()
    finally:
        engine.dispose()
