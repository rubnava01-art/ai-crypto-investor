"""Tests for the Privacidad (privacy & compliance) module (2026-10-28).

Covers: seed inserts exactly Rubén's 20 checklist items in the 6
categories when empty (and never duplicates), endpoint auth (401
without token), RBAC (prueba reads, admin-only writes -> 403), CRUD
behavior, and category/status validation.
"""

from app.api.privacidad import CATEGORIES, SEED_ITEMS, seed_privacidad_items
from app.models.tables import ComplianceItem


def _seed_count(db):
    return db.query(ComplianceItem).count()


def test_seed_inserts_20_items_once(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models.tables import Base

    eng = create_engine(f"sqlite:///{tmp_path / 'priv.db'}")
    Base.metadata.create_all(bind=eng)
    db = sessionmaker(bind=eng)()
    try:
        assert _seed_count(db) == 0
        seed_privacidad_items(db)
        db.commit()
        assert _seed_count(db) == 20
        cats = {i.category for i in db.query(ComplianceItem).all()}
        assert cats == set(CATEGORIES.keys())
        assert len(SEED_ITEMS) == 20
        titles = [i.title for i in db.query(ComplianceItem).all()]
        assert "Política de privacidad" in titles
        assert "Banner de consentimiento de cookies" in titles
        assert "Eliminación de patrones oscuros en la interfaz" in titles
        # Second call must not duplicate.
        seed_privacidad_items(db)
        db.commit()
        assert _seed_count(db) == 20
    finally:
        db.close()


def test_privacidad_requires_auth(client):
    r = client.get("/api/privacidad/items")
    assert r.status_code == 401


def test_privacidad_viewer_reads_admin_writes(client, viewer_headers, admin_headers):
    r = client.get("/api/privacidad/items", headers=viewer_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    # Prueba cannot create / update / delete.
    r = client.post(
        "/api/privacidad/items",
        json={"title": "Prueba", "category": "datos"},
        headers=viewer_headers,
    )
    assert r.status_code == 403

    # Admin creates.
    r = client.post(
        "/api/privacidad/items",
        json={
            "title": "Tarea de prueba",
            "category": "datos",
            "description": "Desc",
            "status": "pendiente",
            "notes": "",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    item_id = r.json()["id"]

    # Viewer cannot update or delete it.
    r = client.put(
        f"/api/privacidad/items/{item_id}",
        json={"status": "completado"},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    r = client.delete(f"/api/privacidad/items/{item_id}", headers=viewer_headers)
    assert r.status_code == 403

    # Admin updates status, then deletes.
    r = client.put(
        f"/api/privacidad/items/{item_id}",
        json={"status": "en_proceso", "notes": "En revisión"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "en_proceso"
    assert r.json()["notes"] == "En revisión"
    r = client.delete(f"/api/privacidad/items/{item_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.get("/api/privacidad/items", headers=admin_headers)
    assert all(i["id"] != item_id for i in r.json())


def test_privacidad_validation(client, admin_headers):
    r = client.post(
        "/api/privacidad/items",
        json={"title": "Mala categoría", "category": "otra"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        "/api/privacidad/items",
        json={"title": "Mal estado", "category": "datos", "status": "hecho"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.put("/api/privacidad/items/999999", json={"status": "completado"}, headers=admin_headers)
    assert r.status_code == 404
