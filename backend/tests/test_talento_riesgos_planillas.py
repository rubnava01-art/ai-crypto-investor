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
    # Prueba ya no lee talento desde 2026-11-23 (403 por módulo).
    r = client.get("/api/talento", headers=viewer_headers)
    assert r.status_code == 403, r.text

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
    # Prueba sigue sin ver nada tras crear la fila (403 por módulo).
    r = client.get("/api/talento", headers=viewer_headers)
    assert r.status_code == 403, r.text

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
    # Prueba ya no lee riesgos desde 2026-11-23 (403 por módulo).
    r = client.get("/api/riesgos", headers=viewer_headers)
    assert r.status_code == 403, r.text

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

    # Prueba ya no ve la fila desde 2026-11-23 (403 por módulo).
    r = client.get("/api/riesgos", headers=viewer_headers)
    assert r.status_code == 403, r.text

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
    # Prueba ya no lee planillas desde 2026-11-23 (403 por módulo).
    r = client.get("/api/planillas", headers=viewer_headers)
    assert r.status_code == 403, r.text

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

    # Prueba ya no ve nada desde 2026-11-23 (403 por módulo).
    r = client.get("/api/planillas", headers=viewer_headers)
    assert r.status_code == 403, r.text

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
    # 2026-11-21 (borrado de usuarios): la migración de ondelete en
    # las FK a users es la nueva cabeza.
    # 2026-11-25 (Fase 1 mejoras-v1, tarea 3): la cabeza es la
    # migración del 2FA TOTP.
    # 2026-11-25 (Fase 1 mejoras-v1, corrección F2): la cabeza es la
    # migración de users.email UNIQUE.
    # 2026-11-25 (Fase 2 mejoras-v1, tarea 1): la cabeza es la
    # migración de users.terms_accepted_at.
    # 2026-11-25 (Fase 5a mejoras-v1, tarea 4): la cabeza es la
    # migración de edu_progress (progreso por usuario y clase).
    # 2026-11-25 (Fase 5a mejoras-v1, tarea 5): la cabeza es la
    # migración de edu_quiz_questions y edu_quiz_attempts (quizzes).
    # 2026-11-25 (Fase 5b mejoras-v1, tareas 1-4): la cabeza es la
    # migración de riesgos.fecha_revision (la última de la cadena
    # a51b00000001 CRM -> a51b00000002 movimientos -> a51b00000003).
    # 2026-11-25 (Fase 6 mejoras-v1, tareas 1 y 3): la cabeza es la
    # migración de asistente_feedback (cadena a51b00000004 uso diario
    # del Asistente -> a51b00000005 feedback).
    # 2026-11-25 (Fase 7 mejoras-v1, tarea 1): la cabeza es la
    # migración de suscripciones (a51b00000006).
    # 2026-11-25 (Fase 8 mejoras-v1, tareas 3 y 4): la cabeza es la
    # migración de eventos de analítica, email_envios y
    # users.last_login_at (a51b00000007).
    # 2026-11-26 (fusión mejoras-todas): la rama remota sync #72
    # terminaba en ef98abd287f8 (contact_messages), segunda cabeza
    # tras el merge; la revisión de fusión a51b00000008 une ambas
    # cabezas y es la única cabeza.
    assert head_rev.revision == "a51b00000008"
    assert set(head_rev.down_revision) == {"a51b00000007", "ef98abd287f8"}

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
        assert "ajustes" in insp.get_table_names()
        assert "videos_educativos" in insp.get_table_names()
        assert "edu_progress" in insp.get_table_names()
        assert "edu_quiz_questions" in insp.get_table_names()
        assert "edu_quiz_attempts" in insp.get_table_names()
        assert "crm_stage_history" in insp.get_table_names()
        assert "crm_reminders" in insp.get_table_names()
        assert "inventory_movements" in insp.get_table_names()
        assert "asistente_uso_diario" in insp.get_table_names()
        assert "asistente_feedback" in insp.get_table_names()
        assert "suscripciones" in insp.get_table_names()
        from app.models.tables import Base

        for name in ("empleados", "riesgos", "planillas", "ajustes", "videos_educativos", "edu_progress", "edu_quiz_questions", "edu_quiz_attempts", "asistente_uso_diario", "asistente_feedback", "suscripciones"):
            got = {c["name"] for c in insp.get_columns(name)}
            want = set(Base.metadata.tables[name].columns.keys())
            assert got == want, name
        # New tables start EMPTY (no seed rows).
        with engine.connect() as conn:
            for name in ("empleados", "riesgos", "planillas", "ajustes", "videos_educativos", "edu_progress", "edu_quiz_questions", "edu_quiz_attempts", "crm_stage_history", "crm_reminders", "inventory_movements", "asistente_uso_diario", "asistente_feedback", "suscripciones"):
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
        for name in ("empleados", "riesgos", "planillas", "ajustes", "videos_educativos"):
            assert name in insp.get_table_names()
        with engine2.connect() as conn:
            rows = conn.execute(sa.text("SELECT name FROM crm_contacts")).fetchall()
        assert [r[0] for r in rows] == ["Contacto Preexistente"]
    finally:
        engine2.dispose()


# ---------- Fase 5b mejoras-v1, tarea 4: fecha de revisión ----------

def test_riesgo_fecha_revision_crud(client, admin_headers):
    h = admin_headers
    r = client.post(
        "/api/riesgos",
        json={
            "riesgo": "Revisión Test",
            "probabilidad": "alta",
            "impacto": "alto",
            "responsable": "Rubén",
            "fecha_revision": "2026-12-15",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    riesgo = r.json()
    assert riesgo["fecha_revision"] == "2026-12-15"
    rid = riesgo["id"]

    # Sin fecha en el alta: null, no una fecha inventada.
    r = client.post("/api/riesgos", json={"riesgo": "Sin Fecha"}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["fecha_revision"] is None
    sin_fecha_id = r.json()["id"]

    # Cambiar la fecha y borrarla con null (model_fields_set).
    r = client.put(f"/api/riesgos/{rid}", json={"fecha_revision": "2027-01-10"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["fecha_revision"] == "2027-01-10"
    r = client.put(f"/api/riesgos/{rid}", json={"fecha_revision": None}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["fecha_revision"] is None
    # Un PUT sin el campo no toca la fecha.
    client.put(f"/api/riesgos/{rid}", json={"fecha_revision": "2027-02-01"}, headers=h)
    r = client.put(f"/api/riesgos/{rid}", json={"estado": "mitigado"}, headers=h)
    assert r.json()["fecha_revision"] == "2027-02-01"

    client.delete(f"/api/riesgos/{rid}", headers=h)
    client.delete(f"/api/riesgos/{sin_fecha_id}", headers=h)
