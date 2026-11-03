"""Tests de las 6 decisiones de Rubén 2026-11-02 (F8, F13, mínimo 12,
siembra de prueba, sandbox, redacción PII para prueba).

El frontend (badges quiet, acentos por familia, minLength) se cubre con
`npm run check` (typecheck); aquí se prueban los comportamientos backend.
"""
import re
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.main as mainmod
from app.main import seed_demo_data
from app.models.tables import User


@pytest.fixture()
def memdb():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()
    eng.dispose()


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    return data["challenge_id"], int(m.group(1)) + int(m.group(2))


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --- Decisión 3: mínimo 12 ---

def test_password_minimum_12_register_create_change(client, admin_headers):
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={"username": "corto11", "password": "oncechars11", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 422, r.text
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={"username": "largo12ok", "password": "docechars123", "challenge_id": cid, "answer": answer},
    )
    assert r.status_code == 201, r.text

    r = client.post(
        "/api/users",
        json={"username": "corto11b", "password": "oncechars11", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    r = client.post(
        "/api/users",
        json={"username": "largo12b", "password": "docechars123", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    r = client.patch(
        f"/api/users/{uid}", json={"password": "oncechars11"}, headers=admin_headers
    )
    assert r.status_code == 422, r.text
    r = client.patch(
        f"/api/users/{uid}", json={"password": "docechars456"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text


def test_login_legacy_short_password_still_works(client):
    # El admin de pruebas tiene contraseña corta ("secret", 6) puesta
    # directo en BD. El mínimo 12 NO aplica al login: nunca se bloquea
    # a una cuenta existente por tener contraseña vieja y corta.
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200, r.text


# --- Decisión 4: siembra de prueba ---

def _fk_engine(path):
    eng = create_engine(f"sqlite:///{path}")

    @event.listens_for(eng, "connect")
    def _fk_on(dbapi_con, _rec):
        dbapi_con.execute("PRAGMA foreign_keys=ON")

    return eng


def _seed_with(path, seed_flag, environment):
    eng = _fk_engine(path)
    Base.metadata.create_all(bind=eng)
    old_engine, old_session, old_settings = mainmod.engine, mainmod.SessionLocal, mainmod.settings
    mainmod.engine = eng
    mainmod.SessionLocal = sessionmaker(bind=eng)
    mainmod.settings = SimpleNamespace(
        admin_username="admin",
        admin_password_hash="",
        seed_demo_accounts=seed_flag,
        environment=environment,
    )
    try:
        seed_demo_data()
    finally:
        mainmod.engine, mainmod.SessionLocal, mainmod.settings = old_engine, old_session, old_settings
    db = sessionmaker(bind=eng)()
    try:
        return db.query(User).filter(User.username == "prueba").first() is not None
    finally:
        db.close()


def test_prueba_seeding_gated(tmp_path):
    # Por defecto (flag apagado): no se siembra.
    assert _seed_with(tmp_path / "a.db", False, "development") is False
    # Flag explícito fuera de producción: sí se siembra.
    assert _seed_with(tmp_path / "b.db", True, "development") is True
    # Flag explícito EN producción: tampoco se siembra.
    assert _seed_with(tmp_path / "c.db", True, "production") is False


# --- Decisión 5: sandbox ---

def test_sandbox_order_rejected_without_flag(client, admin_headers):
    r = client.post(
        "/api/orders",
        json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.001", "mode": "sandbox"},
        headers={**admin_headers, "Idempotency-Key": "sb-gate-1"},
    )
    assert r.status_code == 403, r.text
    assert "sandbox" in r.text.lower()


def test_sandbox_engine_gate_without_flag(memdb, monkeypatch):
    from decimal import Decimal

    from app.execution import engine as exec_engine
    from app.models.tables import Order

    monkeypatch.setattr(exec_engine.settings, "allow_sandbox", False)
    o = Order(client_order_id="c-sb-gate", symbol="BTC/USD", side="buy",
              quantity=Decimal("0.001"), order_type="market",
              status="pending", mode="sandbox")
    memdb.add(o)
    memdb.commit()
    with pytest.raises(RuntimeError, match="disabled"):
        exec_engine.execute_sandbox(memdb, o)
    assert o.status == "failed"


# --- Decisión 6: redacción PII para prueba ---

def test_pii_redaction_for_prueba(client, admin_headers):
    # Limpieza en finally: la BD de sesión se comparte con todos los
    # tests y test_inicio.py exige posts/comentarios vacíos al inicio y
    # author_name == "admin" — no se deja rastro (post, chat, diario,
    # emociones, display_name ni usuario demo).
    ids = {}

    def _cleanup():
        h = admin_headers
        if ids.get("post"):
            client.delete(f"/api/inicio/posts/{ids['post']}", headers=h)
        if ids.get("chat"):
            client.delete(f"/api/chat/messages/{ids['chat']}", headers=h)
        if ids.get("rev"):
            client.delete(f"/api/espacio/revelations/{ids['rev']}", headers=h)
        if ids.get("emo"):
            client.delete(f"/api/espacio/emotions/{ids['emo']}", headers=h)
        if ids.get("demo"):
            client.delete(f"/api/users/{ids['demo']}", headers=h)
        client.put("/api/profile/me", json={"display_name": ""}, headers=h)

    try:
        r = client.put("/api/profile/me", json={"display_name": "Nombre Dueño"}, headers=admin_headers)
        assert r.status_code == 200, r.text
        r = client.post(
            "/api/espacio/emotions",
            json={"emotion": "tranquilo", "intensity": 4, "note": "nota privada del dueño"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        ids["emo"] = r.json()["id"]
        r = client.post(
            "/api/espacio/revelations",
            json={"title": "Revelación", "text": "texto privado del dueño"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        ids["rev"] = r.json()["id"]
        r = client.post("/api/chat/messages", json={"text": "hola chat"}, headers=admin_headers)
        assert r.status_code == 201, r.text
        ids["chat"] = r.json()["id"]
        r = client.post(
            "/api/inicio/posts", json={"title": "Aviso", "body": "cuerpo"}, headers=admin_headers
        )
        assert r.status_code == 201, r.text
        ids["post"] = r.json()["id"]

        r = client.post(
            "/api/users",
            json={"username": "demo6pii", "password": "pass1234abcd", "role": "prueba"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        ids["demo"] = r.json()["id"]
        prueba = _login(client, "demo6pii", "pass1234abcd")

        r = client.get("/api/espacio/emotions", headers=prueba)
        assert r.status_code == 200 and r.json() == [], r.text
        r = client.get("/api/espacio/revelations", headers=prueba)
        assert r.status_code == 200 and r.json() == [], r.text

        r = client.get("/api/chat/messages", headers=prueba)
        assert r.status_code == 200, r.text
        admin_msgs = [m for m in r.json() if m["author_username"] == "admin"]
        assert admin_msgs, r.text
        assert all(m["author_label"] == "admin" for m in admin_msgs), r.text
        assert "Nombre Dueño" not in r.text

        r = client.get("/api/inicio/posts", headers=prueba)
        assert r.status_code == 200, r.text
        assert r.json(), r.text
        assert all(p["author_name"] != "Nombre Dueño" for p in r.json()), r.text

        r = client.get("/api/profile/me", headers=prueba)
        assert r.status_code == 200 and r.json()["username"] == "demo6pii", r.text
        assert r.json()["display_name"] is None, r.text

        users = client.get("/api/users", headers=admin_headers).json()
        admin_id = next(u["id"] for u in users if u["username"] == "admin")
        r = client.get(f"/api/profile/users/{admin_id}", headers=prueba)
        assert r.status_code == 403, r.text

        # El admin sigue viendo todo completo.
        r = client.get("/api/espacio/emotions", headers=admin_headers)
        assert r.status_code == 200 and any(
            e["note"] == "nota privada del dueño" for e in r.json()
        ), r.text
    finally:
        _cleanup()
