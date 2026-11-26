"""Certificado de finalización por recorrido (Fase 5a, tarea 6).

El certificado existe solo al completar el 100 % de un recorrido
(grabada / envivo) con al menos una clase. Sin completar:
completed=False. El nombre es el real del usuario y la fecha, la de
la última clase marcada.
"""
from app.database import SessionLocal
from app.models.tables import EduClass


def _make_class(db, kind, title):
    row = EduClass(kind=kind, title=title, description="", url="")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def test_certificate_requires_full_completion(client, admin_headers):
    db = SessionLocal()
    try:
        a = _make_class(db, "grabada", "Cert A")
        b = _make_class(db, "grabada", "Cert B")
    finally:
        db.close()
    # Sin completar: completed=False, sin fecha.
    r = client.get("/api/clases/certificates/grabada", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["completed"] is False
    assert body["completed_at"] is None
    assert body["user_name"] == "admin"
    assert body["total"] >= 2

    # Una de dos: sigue sin certificado.
    client.post(f"/api/clases/classes/{a}/complete", headers=admin_headers)
    r = client.get("/api/clases/certificates/grabada", headers=admin_headers)
    assert r.json()["completed"] is False

    # Las dos: certificado con nombre real y fecha de finalización.
    client.post(f"/api/clases/classes/{b}/complete", headers=admin_headers)
    r = client.get("/api/clases/certificates/grabada", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["completed"] is True
    assert body["completed_count"] == body["total"]
    assert body["pct"] == 100.0
    assert body["user_name"] == "admin"
    assert body["completed_at"] is not None


def test_certificate_empty_track_has_no_certificate(client, admin_headers):
    # Recorrido en vivo sin clases (o sin completar): no hay certificado.
    r = client.get("/api/clases/certificates/envivo", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    if body["total"] == 0:
        assert body["completed"] is False
        assert body["completed_at"] is None


def test_certificate_invalid_kind_422(client, admin_headers):
    r = client.get("/api/clases/certificates/otro", headers=admin_headers)
    assert r.status_code == 422, r.text
