"""Tests for Talento humano, Gestión de riesgos y Planillas (2026-11-04).

Covers: CRUD happy paths per module, writes forbidden for prueba (403),
prueba GET [] for talento/planillas, prueba GET readable for riesgos,
enum validation 422, length caps 422, migration head uniqueness, and
the fresh-DB + simulated-existing-DB migration checks for the new
revision. Uses the shared session fixtures only (no extra logins: the
login endpoint is rate-limited across the suite).

Untouchables asserted here: no SSN/bank fields on empleados (the model
has no such columns), no seed rows (lists start empty for admin too
on a fresh fixture DB — modulo rows created by earlier tests in the
same session, so emptiness is asserted only via filtered fresh names
where needed; the module docstring guarantees empty start).
"""


def test_talento_requires_auth(client):
    r = client.get("/api/talento")
    assert r.status_code == 401
    r = client.get("/api/riesgos")
    assert r.status_code == 401
    r = client.get("/api/planillas")
    assert r.status_code == 401


def test_talento_crud_rbac_validation(client, viewer_headers, admin_headers):
    # Prueba sees an empty list even if rows exist (personal data).
    r = client.get("/api/talento", headers=viewer_headers)
    assert r.status_code == 200
    assert r.json() == []

    # Prueba cannot write.
    for method, url, payload in (
        ("post", "/api/talento", {"nombre": "Intento"}),
        ("put", "/api/talento/1", {"estado": "inactivo"}),
        ("delete", "/api/talento/1", None),
    ):
        r = client.request(method, url, json=payload, headers=viewer_headers)
        assert r.status_code == 403, (method, url)

    # Enum validation.
    r = client.post(
        "/api/talento",
        json={"nombre": "Ana", "estado": "despedido"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    # Length cap.
    r = client.post(
        "/api/talento",
        json={"nombre": "X" * 201},
        headers=admin_headers,
    )
    assert r.status_code == 422
    # Blank name.
    r = client.post(
        "/api/talento", json={"nombre": "   "}, headers=admin_headers
    )
    assert r.status_code == 422

    # Happy path: create, update, read back, delete.
    r = client.post(
        "/api/talento",
        json={
            "nombre": "Ana López",
            "puesto": "Diseñadora",
            "contacto": "ana@example.com",
            "fecha_ingreso": "2026-11-01",
            "estado": "activo",
            "notas": "Tiempo completo",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    emp = r.json()
    assert emp["nombre"] == "Ana López"
    assert emp["fecha_ingreso"] == "2026-11-01"
    assert emp["estado"] == "activo"
    # No SSN / bank fields are ever exposed.
    assert "ssn" not in emp and "cuenta" not in emp and "bank" not in emp
    emp_id = emp["id"]

    r = client.get("/api/talento", headers=admin_headers)
    assert r.status_code == 200
    assert any(e["id"] == emp_id for e in r.json())
    # Prueba still sees nothing after the row exists.
    r = client.get("/api/talento", headers=viewer_headers)
    assert r.json() == []

    r = client.put(
        f"/api/talento/{emp_id}",
        json={"estado": "inactivo"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "inactivo"
    r = client.put(
        f"/api/talento/{emp_id}",
        json={"estado": "otro"},
        headers=admin_headers,
    )
    assert r.status_code == 422

    r = client.delete(f"/api/talento/{emp_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"/api/talento/{emp_id}", headers=admin_headers)
    assert r.status_code == 404


def test_riesgos_crud_prueba_reads_rbac_validation(client, viewer_headers, admin_headers):
    # Prueba CAN read riesgos (read-only, no writes).
    r = client.get("/api/riesgos", headers=viewer_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    for method, url, payload in (
        ("post", "/api/riesgos", {"riesgo": "Intento"}),
        ("put", "/api/riesgos/1", {"estado": "cerrado"}),
        ("delete", "/api/riesgos/1", None),
    ):
        r = client.request(method, url, json=payload, headers=viewer_headers)
        assert r.status_code == 403, (method, url)

    # Enum validation: probabilidad, impacto, estado.
    for payload in (
        {"riesgo": "R", "probabilidad": "seguro"},
        {"riesgo": "R", "impacto": "fatal"},
        {"riesgo": "R", "estado": "olvidado"},
    ):
        r = client.post("/api/riesgos", json=payload, headers=admin_headers)
        assert r.status_code == 422, payload

    r = client.post(
        "/api/riesgos",
        json={
            "riesgo": "Retraso de proveedor",
            "descripcion": "Entrega tardía de material",
            "probabilidad": "media",
            "impacto": "alto",
            "mitigacion": "Segundo proveedor",
            "responsable": "Rubén",
            "estado": "abierto",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    riesgo = r.json()
    riesgo_id = riesgo["id"]
    assert riesgo["probabilidad"] == "media"
    assert riesgo["impacto"] == "alto"

    # Prueba now sees the row (readable, not redacted to []).
    r = client.get("/api/riesgos", headers=viewer_headers)
    assert any(x["id"] == riesgo_id for x in r.json())

    r = client.put(
        f"/api/riesgos/{riesgo_id}",
        json={"estado": "en_curso"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["estado"] == "en_curso"
    r = client.put(
        f"/api/riesgos/{riesgo_id}",
        json={"probabilidad": "siempre"},
        headers=admin_headers,
    )
    assert r.status_code == 422

    r = client.delete(f"/api/riesgos/{riesgo_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"/api/riesgos/{riesgo_id}", headers=admin_headers)
    assert r.status_code == 404


def test_planillas_crud_rbac_validation(client, viewer_headers, admin_headers):
    r = client.get("/api/planillas", headers=viewer_headers)
    assert r.status_code == 200
    assert r.json() == []

    for method, url, payload in (
        ("post", "/api/planillas", {"periodo": "2026-11"}),
        ("put", "/api/planillas/1", {"estado": "pagado"}),
        ("delete", "/api/planillas/1", None),
    ):
        r = client.request(method, url, json=payload, headers=viewer_headers)
        assert r.status_code == 403, (method, url)

    # Enum + negative monto validation.
    for payload in (
        {"periodo": "2026-11", "estado": "atrasado"},
        {"periodo": "2026-11", "monto": -10},
    ):
        r = client.post("/api/planillas", json=payload, headers=admin_headers)
        assert r.status_code == 422, payload

    # Link to a real employee: snapshot name stored at creation.
    r = client.post(
        "/api/talento",
        json={"nombre": "Carlos Ruiz", "puesto": "Repartidor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    emp_id = r.json()["id"]

    r = client.post(
        "/api/planillas",
        json={"periodo": "2026-11", "empleado_id": emp_id, "monto": 1200.5},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    planilla = r.json()
    assert planilla["empleado_id"] == emp_id
    assert planilla["empleado_nombre"] == "Carlos Ruiz"
    assert planilla["monto"] == 1200.5
    assert planilla["estado"] == "pendiente"
    planilla_id = planilla["id"]

    # Unknown employee link -> 404, not an invented name.
    r = client.post(
        "/api/planillas",
        json={"periodo": "2026-11", "empleado_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404

    # Prueba still sees nothing.
    r = client.get("/api/planillas", headers=viewer_headers)
    assert r.json() == []

    r = client.put(
        f"/api/planillas/{planilla_id}",
        json={"estado": "pagado", "monto": 1200.5},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["estado"] == "pagado"

    r = client.delete(f"/api/planillas/{planilla_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"/api/talento/{emp_id}", headers=admin_headers)
    assert r.status_code == 204


def test_modelos_sin_campos_sensibles():
    from app.models.tables import Empleado, Planilla

    emp_cols = set(Empleado.__table__.columns.keys())
    assert not (emp_cols & {"ssn", "social_security", "cuenta_bancaria", "bank_account", "iban"})
    plan_cols = set(Planilla.__table__.columns.keys())
    assert "impuesto" not in plan_cols and "tax" not in plan_cols


def _run_alembic(db_file, target):
    import os

    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    settings.database_url = f"sqlite:///{db_file}"
    try:
        command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def test_migration_single_head_and_new_tables(tmp_path):
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine
    import os

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    # Single head: exactly one head revision, and it is the new one.
    # (command.heads() only prints; ScriptDirectory returns the tuples.)
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, heads
    head_rev = script.get_revision(heads[0])
    assert head_rev.revision == "a918a20d8191"
    assert head_rev.down_revision == "f3a2c91d7b4e"

    # Fresh DB: upgrade head creates the three tables with model columns.
    db_file = tmp_path / "fresh.db"
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        import sqlalchemy as sa

        insp = sa.inspect(engine)
        assert "empleados" in insp.get_table_names()
        assert "riesgos" in insp.get_table_names()
        assert "planillas" in insp.get_table_names()
        from app.models.tables import Base

        for name in ("empleados", "riesgos", "planillas"):
            got = {c["name"] for c in insp.get_columns(name)}
            want = set(Base.metadata.tables[name].columns.keys())
            assert got == want, name
        # New tables start EMPTY (no seed rows).
        with engine.connect() as conn:
            for name in ("empleados", "riesgos", "planillas"):
                assert conn.execute(sa.text(f"SELECT COUNT(*) FROM {name}")).scalar() == 0
        # Existing tables untouched: CRM contacts still have their columns.
        contact_cols = {c["name"] for c in insp.get_columns("crm_contacts")}
        assert contact_cols == set(Base.metadata.tables["crm_contacts"].columns.keys())
    finally:
        engine.dispose()

    # Simulated existing DB: pre-migration head + create_all (startup
    # behavior) + upgrade head must succeed and keep existing rows.
    db_file2 = tmp_path / "prod.db"
    _run_alembic(db_file2, "f3a2c91d7b4e")
    engine2 = create_engine(f"sqlite:///{db_file2}")
    try:
        from app.models.tables import Base, Contact

        Base.metadata.create_all(bind=engine2)
        from sqlalchemy.orm import sessionmaker

        s = sessionmaker(bind=engine2)()
        s.add(Contact(name="Contacto Preexistente", email="pre@example.com"))
        s.commit()
        s.close()
    finally:
        engine2.dispose()
    _run_alembic(db_file2, "head")
    engine2 = create_engine(f"sqlite:///{db_file2}")
    try:
        import sqlalchemy as sa

        insp = sa.inspect(engine2)
        for name in ("empleados", "riesgos", "planillas"):
            assert name in insp.get_table_names()
        with engine2.connect() as conn:
            rows = conn.execute(sa.text("SELECT name FROM crm_contacts")).fetchall()
        assert [r[0] for r in rows] == ["Contacto Preexistente"]
    finally:
        engine2.dispose()
