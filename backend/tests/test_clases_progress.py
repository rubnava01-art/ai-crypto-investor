"""Progreso por usuario y clase (Fase 5a, tarea 4).

Una fila por (usuario, clase); el porcentaje es por kind (grabada /
envivo) y total. Sin clases, 0 % — nunca 100 % inventado.
"""
import pytest

from app.database import SessionLocal
from app.models.tables import EduClass


def _make_class(db, kind, title):
    row = EduClass(kind=kind, title=title, description="", url="")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id  # el id, no la fila: la sesión se cierra y la fila se desvincula


def test_progress_empty_without_classes(client, admin_headers):
    # La BD se comparte con otros tests, así que puede haber clases: lo
    # que se verifica es la coherencia del resumen, no el vacío absoluto.
    r = client.get("/api/clases/progress", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["completed"] <= body["total"]
    assert body["completed_class_ids"] == sorted(body["completed_class_ids"])
    expected_pct = round(body["completed"] / body["total"] * 100, 1) if body["total"] else 0.0
    assert body["pct"] == expected_pct
    for kind in ("grabada", "envivo"):
        k = body["by_kind"][kind]
        assert k["completed"] <= k["total"]
        assert k["pct"] == (round(k["completed"] / k["total"] * 100, 1) if k["total"] else 0.0)


def test_progress_complete_uncomplete_and_pct(client, admin_headers):
    db = SessionLocal()
    try:
        a = _make_class(db, "grabada", "Progreso A")
        b = _make_class(db, "grabada", "Progreso B")
        c = _make_class(db, "envivo", "Progreso C")
    finally:
        db.close()

    r = client.post(f"/api/clases/classes/{a}/complete", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert a in body["completed_class_ids"]
    assert body["completed"] >= 1
    assert body["by_kind"]["grabada"]["completed"] >= 1

    r = client.post(f"/api/clases/classes/{c}/complete", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert c in r.json()["completed_class_ids"]

    # Desmarcar: la clase deja de contar y el porcentaje baja.
    before = client.get("/api/clases/progress", headers=admin_headers).json()
    r = client.delete(f"/api/clases/classes/{a}/complete", headers=admin_headers)
    assert r.status_code == 200, r.text
    after = r.json()
    assert a not in after["completed_class_ids"]
    assert after["completed"] == before["completed"] - 1

    # Marcar dos veces no duplica: una fila por (usuario, clase).
    client.post(f"/api/clases/classes/{b}/complete", headers=admin_headers)
    client.post(f"/api/clases/classes/{b}/complete", headers=admin_headers)
    body = client.get("/api/clases/progress", headers=admin_headers).json()
    assert body["completed_class_ids"].count(b) == 1


def test_progress_complete_unknown_class_404(client, admin_headers):
    r = client.post("/api/clases/classes/999999/complete", headers=admin_headers)
    assert r.status_code == 404
    r = client.delete("/api/clases/classes/999999/complete", headers=admin_headers)
    assert r.status_code == 404


def test_progress_pct_math(client, admin_headers):
    # 2 grabadas + 1 en vivo nuevas; completar 1 grabada = 50 % grabadas.
    db = SessionLocal()
    try:
        g1 = _make_class(db, "grabada", "Pct G1")
        _make_class(db, "grabada", "Pct G2")
        _make_class(db, "envivo", "Pct E1")
    finally:
        db.close()
    before = client.get("/api/clases/progress", headers=admin_headers).json()
    client.post(f"/api/clases/classes/{g1}/complete", headers=admin_headers)
    after = client.get("/api/clases/progress", headers=admin_headers).json()
    assert after["by_kind"]["grabada"]["completed"] == before["by_kind"]["grabada"]["completed"] + 1
    assert after["by_kind"]["grabada"]["total"] == before["by_kind"]["grabada"]["total"]
    # El porcentaje del kind sube exactamente 100/total del kind
    # (tolerancia por el redondeo a 1 decimal de cada lectura).
    step = 100.0 / after["by_kind"]["grabada"]["total"]
    assert after["by_kind"]["grabada"]["pct"] == pytest.approx(
        before["by_kind"]["grabada"]["pct"] + step, abs=0.15
    )
