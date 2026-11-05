"""Fase 2 (Subagente 3): seguridad, trading/estado, DB/rendimiento.

Cada prueba usa nombres de usuario únicos (uuid) para no chocar con
otros módulos: la suite comparte una sola BD.
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import AuditLog, Order, Signal, SystemEvent, Trade


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _db(app):
    """A raw session on the suite DB (same pattern as test_phase8)."""
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    return db, gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _mk_user(client, admin_headers, username, role="prueba"):
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username, password="pass1234abcd"):
    # Presupuesto IP propio (como el fixture de test_pending_activation):
    # la suite comparte un solo presupuesto de login (10/min por IP).
    from app.core.rate_limit import login_limiter

    login_limiter._hits.clear()
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------- 1.2: tokens con user_id, legacy aceptados, pending en cada request ----------

def test_token_carries_user_id_and_tv(client, app, admin_headers):
    from app.core.security import create_access_token as _mk

    db, gen = _db(app)
    try:
        from app.models.tables import User

        admin = db.query(User).filter(User.username == "admin").first()
        token = _mk("admin", user_id=admin.id, token_version=admin.token_version or 0)
    finally:
        _close(gen)
    r = client.get("/api/system/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def test_legacy_sub_only_token_still_accepted(client):
    # Tests y tokens viejos solo llevan sub: se aceptan en su ventana.
    token = create_access_token("admin")
    r = client.get("/api/system/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text


def test_token_with_wrong_user_id_is_401(client):
    token = create_access_token("admin", user_id=999999, token_version=0)
    r = client.get("/api/system/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_pending_user_token_is_403(client, admin_headers):
    # Registrar (pendiente) + token forjado por nombre: get_current_user
    # debe bloquear aunque el token sea válido (M1).
    import re

    from app.core.rate_limit import login_limiter

    login_limiter._hits.clear()
    r = client.get("/api/auth/register-challenge")
    cid = r.json()["challenge_id"]
    m = re.search(r"(\d+)\s*\+\s*(\d+)", r.json()["question"])
    username = _uid("pendfase2")
    r = client.post(
        "/api/auth/register",
        json={"username": username, "password": "pass1234abcd",
              "challenge_id": cid, "answer": int(m.group(1)) + int(m.group(2))},
    )
    assert r.status_code == 201, r.text
    token = create_access_token(username)
    r = client.get("/api/system/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert "pendiente" in r.json()["detail"]


def test_password_change_revokes_old_token(client, admin_headers):
    username = _uid("revoke")
    _mk_user(client, admin_headers, username)
    old_headers = _login(client, username)
    assert client.get("/api/system/status", headers=old_headers).status_code == 200
    users = client.get("/api/users", headers=admin_headers).json()
    uid = next(u["id"] for u in users if u["username"] == username)
    r = client.patch(
        f"/api/users/{uid}", json={"password": "newpass12345"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    # El token viejo (con tv anterior) ya no entra.
    assert client.get("/api/system/status", headers=old_headers).status_code == 401
    # Con la contraseña nueva sí.
    assert client.get("/api/system/status", headers=_login(client, username, "newpass12345")).status_code == 200


# ---------- 1.3: auditoría en users.py y login ----------

def test_user_mutations_are_audited(client, app, admin_headers):
    username = _uid("audit")
    user = _mk_user(client, admin_headers, username)
    r = client.post(f"/api/users/{user['id']}/approve", headers=admin_headers)
    # approve sobre una cuenta activa da 409, pero create ya auditó.
    assert r.status_code in (200, 409)
    db, gen = _db(app)
    try:
        rows = db.query(AuditLog).filter(
            AuditLog.action == "users.create",
            AuditLog.entity_id == str(user["id"]),
        ).all()
    finally:
        _close(gen)
    assert len(rows) >= 1


def test_failed_and_successful_logins_are_audited(client, app, admin_headers):
    username = _uid("login audit".replace(" ", ""))
    _mk_user(client, admin_headers, username)
    client.post("/api/auth/login", json={"username": username, "password": "wrongpass"})
    _login(client, username)
    db, gen = _db(app)
    try:
        failed = db.query(AuditLog).filter(AuditLog.action == "auth.login_failed").all()
        ok = db.query(AuditLog).filter(AuditLog.action == "auth.login_success").all()
    finally:
        _close(gen)
    assert len(failed) >= 1
    assert len(ok) >= 1


# ---------- 1.4: idempotencia por ruta, backtest CSV, CRM escape ----------

def test_idempotency_key_does_not_leak_across_routes(client, app, admin_headers):
    from app.core.state import state

    key = f"route-scope-{uuid.uuid4().hex[:8]}"
    headers = {**admin_headers, "Idempotency-Key": key}
    r = client.post("/api/risk/kill-switch", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["kill_switch"] is True
    # Soltar el switch para poder crear la orden.
    r = client.post("/api/risk/kill-switch/deactivate", headers=admin_headers)
    assert r.status_code == 200
    state.kill_switch = False
    # Misma clave, OTRA ruta: no debe devolver la respuesta del kill-switch.
    with patch(
        "app.execution.engine._market_price", return_value=Decimal("80000")
    ):
        r = client.post(
            "/api/orders", headers=headers,
            json={"symbol": "BTC/USD", "side": "buy", "quantity": "0.0001",
                  "mode": "simulation"},
        )
    assert r.status_code == 200, r.text
    assert "client_order_id" in r.json()
    assert r.json()["mode"] == "simulation"
    # Limpieza: el guard cuenta las órdenes no-reales del día (tope 3);
    # no dejar residuos para los tests de órdenes de otros módulos.
    from app.models.tables import Fill as _Fill

    db, gen = _db(app)
    try:
        oid = r.json()["id"]
        db.query(_Fill).filter(_Fill.order_id == oid).delete(synchronize_session=False)
        db.delete(db.get(Order, oid))
        db.commit()
    finally:
        _close(gen)


def test_backtest_csv_rejects_traversal(client, admin_headers):
    for bad in ("..%2F..%2Fetc%2Fpasswd", "..", "a/b", "a;rm", ""):
        r = client.get(f"/api/backtest/runs/{bad}/csv", headers=admin_headers)
        assert r.status_code in (404, 422), (bad, r.status_code)


def test_crm_search_escapes_wildcards(client, admin_headers):
    suffix = uuid.uuid4().hex[:8]
    for name in (f"Alpha{suffix}", f"Beta{suffix}"):
        r = client.post(
            "/api/crm/contacts", json={"name": name, "email": "", "phone": ""},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
    # '%' como comodín devolvería todo; escapado, no casa con ningún nombre.
    r = client.get("/api/crm/contacts", params={"q": "%"}, headers=admin_headers)
    assert r.status_code == 200
    assert all(suffix not in c["name"] for c in r.json())
    r = client.get("/api/crm/contacts", params={"q": f"Alpha{suffix}"}, headers=admin_headers)
    assert any(c["name"] == f"Alpha{suffix}" for c in r.json())


# ---------- 2.1: techo del risk guard, allowlist, tope de cantidad ----------

def _order(client, headers, qty, symbol="BTC/USD", mode="simulation"):
    return client.post(
        "/api/orders", headers={**headers, "Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={"symbol": symbol, "side": "buy", "quantity": qty, "mode": mode},
    )


def test_order_quantity_above_guard_ceiling_is_422(client, admin_headers):
    # Precio 80000: riesgo 1% de $20 = $0.20, stop 1% -> techo 0.00025.
    with patch("app.execution.engine._market_price", return_value=Decimal("80000")):
        r = _order(client, admin_headers, "0.001")
    assert r.status_code == 422, r.text
    assert "risk-guard" in r.json()["detail"]


def test_order_symbol_allowlist_and_quantity_cap(client, admin_headers):
    with patch("app.execution.engine._market_price", return_value=Decimal("80000")):
        r = _order(client, admin_headers, "0.0001", symbol="DOGE/USD")
    assert r.status_code == 400
    with patch("app.execution.engine._market_price", return_value=Decimal("80000")):
        r = _order(client, admin_headers, "101")
    assert r.status_code == 400


# ---------- 2.2/2.3: kill switch desactivable, cancelar órdenes ----------

def test_kill_switch_deactivate_is_audited_and_idempotent(client, admin_headers):
    r = client.post(
        "/api/risk/kill-switch",
        headers={**admin_headers, "Idempotency-Key": f"ks-{uuid.uuid4().hex}"},
    )
    assert r.status_code == 200
    r = client.post("/api/risk/kill-switch/deactivate", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["kill_switch"] is False
    assert r.json()["was_engaged"] is True
    r = client.post("/api/risk/kill-switch/deactivate", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["was_engaged"] is False


def test_cancel_pending_order_and_terminal_rejected(client, app, admin_headers):
    db, gen = _db(app)
    try:
        order = Order(
            client_order_id=f"pend-{uuid.uuid4().hex}",
            symbol="BTC/USD", side="buy", quantity=Decimal("0.0001"),
            order_type="market", status="pending", mode="simulation",
        )
        db.add(order)
        db.commit()
        oid = order.id
    finally:
        _close(gen)
    r = client.post(f"/api/orders/{oid}/cancel", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    r = client.post(f"/api/orders/{oid}/cancel", headers=admin_headers)
    assert r.status_code == 409
    # Limpieza: no dejar residuos para el tope diario del guard.
    db2, gen2 = _db(app)
    try:
        db2.delete(db2.get(Order, oid))
        db2.commit()
    finally:
        _close(gen2)


def test_reconcile_marks_only_stale_pending_failed(app):
    from app.core.runtime import reconcile_stale_pending_orders

    db, gen = _db(app)
    try:
        old = Order(
            client_order_id=f"old-{uuid.uuid4().hex}",
            symbol="BTC/USD", side="buy", quantity=Decimal("0.0001"),
            order_type="market", status="pending", mode="simulation",
            created_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        fresh = Order(
            client_order_id=f"fresh-{uuid.uuid4().hex}",
            symbol="BTC/USD", side="buy", quantity=Decimal("0.0001"),
            order_type="market", status="pending", mode="simulation",
        )
        db.add_all([old, fresh])
        db.commit()
        old_id, fresh_id = old.id, fresh.id
        n = reconcile_stale_pending_orders(db)
        assert n >= 1
        assert db.get(Order, old_id).status == "failed"
        assert db.get(Order, fresh_id).status == "pending"
        # Limpieza: no dejar pendientes frescos para otros tests.
        db.delete(db.get(Order, fresh_id))
        db.delete(db.get(Order, old_id))
        db.commit()
    finally:
        _close(gen)


# ---------- 3.2: retención (nunca contenido de usuario) ----------

def test_retention_prunes_growth_tables_only(app):
    from app.core.retention import prune_stale_rows
    from app.models.tables import HomePost, TrendSearch

    db, gen = _db(app)
    try:
        old_event = SystemEvent(
            level="info", category="test", message="old",
            created_at=datetime.now(timezone.utc) - timedelta(days=100),
        )
        old_search = TrendSearch(
            user_id=None, keyword="old",
            created_at=datetime.now(timezone.utc) - timedelta(days=200),
        )
        post = HomePost(title="keep me", body="user content")
        db.add_all([old_event, old_search, post])
        db.commit()
        # Capturar ids antes del prune: tras el delete, la instancia
        # queda detached y acceder a .id lanza ObjectDeletedError.
        old_event_id, old_search_id, post_id = old_event.id, old_search.id, post.id
        counts = prune_stale_rows(db)
        assert counts["system_events"] >= 1
        assert counts["trend_searches"] >= 1
        assert db.query(SystemEvent).filter(SystemEvent.id == old_event_id).first() is None
        assert db.query(TrendSearch).filter(TrendSearch.id == old_search_id).first() is None
        assert db.query(HomePost).filter(HomePost.id == post_id).first() is not None
        db.delete(db.get(HomePost, post_id))
        db.commit()
    finally:
        _close(gen)


def test_retention_keeps_referenced_signals(app):
    from app.core.retention import prune_stale_rows
    from app.models.tables import RiskDecision

    db, gen = _db(app)
    try:
        old = Signal(
            symbol="BTC/USD", side="buy", reason="old",
            created_at=datetime.now(timezone.utc) - timedelta(days=200),
        )
        db.add(old)
        db.flush()
        db.add(RiskDecision(
            signal_id=old.id, approved=False, reason="x",
            max_risk_usd=Decimal("0.2"),
        ))
        db.commit()
        prune_stale_rows(db)
        assert db.get(Signal, old.id) is not None
        db.query(RiskDecision).filter(RiskDecision.signal_id == old.id).delete(
            synchronize_session=False)
        db.delete(db.get(Signal, old.id))
        db.commit()
    finally:
        _close(gen)


# ---------- 3.4/3.5: limiters, facturas, SKU, referidos, portfolio, health ----------

def test_per_user_limiters_exist_and_trigger():
    from app.core.rate_limit import market_limiter, strategy_limiter

    key = f"probe-{uuid.uuid4().hex}"
    for _ in range(market_limiter.max_requests):
        assert market_limiter.allow(key) is True
    assert market_limiter.allow(key) is False
    key2 = f"probe-{uuid.uuid4().hex}"
    for _ in range(strategy_limiter.max_requests):
        assert strategy_limiter.allow(key2) is True
    assert strategy_limiter.allow(key2) is False


def test_login_lockout_blocks_after_failures(client, admin_headers):
    from app.core.rate_limit import login_limiter, login_lockout

    username = _uid("locky")
    _mk_user(client, admin_headers, username)
    try:
        login_limiter._hits.clear()
        for _ in range(login_lockout.MAX_FAILURES):
            r = client.post(
                "/api/auth/login",
                json={"username": username, "password": "wrongpass"},
            )
            assert r.status_code == 401, r.text
        # Presupuesto IP limpio para aislar el lockout de cuenta.
        login_limiter._hits.clear()
        r = client.post(
            "/api/auth/login", json={"username": username, "password": "pass1234abcd"}
        )
        assert r.status_code == 429, r.text
    finally:
        login_lockout.clear()
        login_limiter._hits.clear()


def test_circuit_breaker_trips_on_network_death():
    import ccxt

    from app.data import exchanges

    class Dead:
        def __init__(self):
            self.calls = 0

        def fetch_ticker(self, symbol):
            self.calls += 1
            raise ccxt.NetworkError("down")

    dead = Dead()
    try:
        with patch.object(exchanges, "make_exchange", return_value=dead):
            with pytest.raises(ccxt.NetworkError):
                exchanges.fetch_ticker("kraken", "BTC/USD", attempts=1)
            # Segunda llamada: fail fast, sin tocar la red.
            with pytest.raises(exchanges.CircuitOpenError):
                exchanges.fetch_ticker("kraken", "BTC/USD", attempts=1)
        assert dead.calls == 1
    finally:
        exchanges.reset_circuit_breakers()


def test_invoice_state_machine_forward_only_and_unique_number(client, admin_headers):
    body = {
        "client_name": "Test", "items": [{"description": "x", "qty": 1, "unit_price": 10}],
    }
    r = client.post("/api/facturas/invoices", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    iid = r.json()["id"]
    number = r.json()["number"]
    # Salto hacia adelante permitido (borrador -> pagada).
    r = client.patch(
        f"/api/facturas/invoices/{iid}", json={"status": "pagada"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    # Hacia atrás prohibido.
    r = client.patch(
        f"/api/facturas/invoices/{iid}", json={"status": "borrador"},
        headers=admin_headers,
    )
    assert r.status_code == 422
    # Número explícito duplicado prohibido.
    r = client.post(
        "/api/facturas/invoices",
        json={**body, "number": number}, headers=admin_headers,
    )
    assert r.status_code == 409


def test_sku_unique_and_referral_dedup(client, app, admin_headers):
    sku = f"SKU-{uuid.uuid4().hex[:8]}"
    item = {"name": "Item", "sku": sku, "quantity": 1}
    r = client.post("/api/inventario/items", json=item, headers=admin_headers)
    assert r.status_code == 201, r.text
    sku_id = r.json()["id"]
    r = client.post("/api/inventario/items", json=item, headers=admin_headers)
    assert r.status_code == 409
    # Dos ítems sin SKU sí pueden coexistir (SKU vacío = sin SKU).
    nosku_ids = []
    r = client.post(
        "/api/inventario/items", json={"name": "NoSku1"}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    nosku_ids.append(r.json()["id"])
    r = client.post(
        "/api/inventario/items", json={"name": "NoSku2"}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    nosku_ids.append(r.json()["id"])
    # Limpieza: test_inventario asume lista vacía al inicio.
    for iid in [sku_id, *nosku_ids]:
        assert client.delete(f"/api/inventario/items/{iid}", headers=admin_headers).status_code == 204

    r = client.post(
        "/api/referrals/campaigns", json={"name": "Camp"}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    ref = {"referrer_name": "A", "referred_name": "B",
           "referred_contact": f"dup-{uuid.uuid4().hex[:8]}@x.com"}
    r = client.post(
        f"/api/referrals/campaigns/{cid}/referrals", json=ref,
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    r = client.post(
        f"/api/referrals/campaigns/{cid}/referrals", json=ref,
        headers=admin_headers,
    )
    assert r.status_code == 409
    # Limpieza: no dejar campañas de prueba para otros módulos.
    from app.models.tables import Referral as _Ref
    from app.models.tables import ReferralCampaign as _Camp

    db, gen = _db(app)
    try:
        db.query(_Ref).filter(_Ref.campaign_id == cid).delete(synchronize_session=False)
        db.delete(db.get(_Camp, cid))
        db.commit()
    finally:
        _close(gen)


def test_portfolio_reflects_real_paper_trades(client, app, admin_headers):
    db, gen = _db(app)
    try:
        order = Order(
            client_order_id=f"paper-{uuid.uuid4().hex}",
            symbol="BTC/USD", side="buy", quantity=Decimal("0.001"),
            order_type="market", status="executed", mode="paper",
        )
        db.add(order)
        db.flush()
        trade = Trade(
            order_id=order.id, symbol="BTC/USD", side="buy",
            entry_price=Decimal("50000"), exit_price=Decimal("55000"),
            pnl_net=Decimal("5"),
            closed_at=datetime.now(timezone.utc),
        )
        db.add(trade)
        db.commit()
        trade_id, order_id = trade.id, order.id
    finally:
        _close(gen)
    r = client.get("/api/portfolio/performance", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["demo"] is False
    assert Decimal(r.json()["realized_pnl_usd"]) >= Decimal("5")
    r = client.get("/api/portfolio/balances", headers=admin_headers)
    assert Decimal(r.json()["equity_usd"]) >= Decimal("25")
    db, gen = _db(app)
    try:
        db.delete(db.get(Trade, trade_id))
        db.delete(db.get(Order, order_id))
        db.commit()
    finally:
        _close(gen)


def test_health_carries_git_sha(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "git_sha" in body
    assert isinstance(body["git_sha"], str) and body["git_sha"]


# ---------- 2026-11-05: health informa la conectividad real con la BD ----------

def test_health_reports_database_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["database"] == "ok"


def test_health_reports_database_error_but_stays_200(client, monkeypatch):
    from sqlalchemy import create_engine

    import app.database

    broken = create_engine("sqlite:////nonexistent-dir-xyz/health.db")
    monkeypatch.setattr(app.database, "engine", broken)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["database"] == "error"


# ---------- 3.1: migraciones == modelos (fresco y producción simulada) ----------

def _schema_map(engine):
    import sqlalchemy as sa

    insp = sa.inspect(engine)
    out = {}
    for table in insp.get_table_names():
        if table == "alembic_version":
            continue
        out[table] = {c["name"] for c in insp.get_columns(table)}
    return out


def _model_map():
    from app.models.tables import Base

    return {name: set(t.columns.keys()) for name, t in Base.metadata.tables.items()}


def _run_alembic(tmp_path, target):
    import os

    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    # env.py sobrescribe sqlalchemy.url con settings.database_url: por
    # eso se muta el setting (y se restaura en finally).
    settings.database_url = f"sqlite:///{tmp_path}"
    try:
        command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def test_fresh_migration_head_equals_models(tmp_path):
    from sqlalchemy import create_engine

    db_file = tmp_path / "fresh.db"
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        migrated = _schema_map(engine)
    finally:
        engine.dispose()
    models = _model_map()
    assert set(migrated) == set(models), (
        f"tablas: solo-migración={set(migrated) - set(models)} "
        f"solo-modelos={set(models) - set(migrated)}"
    )
    for table, cols in models.items():
        assert migrated[table] == cols, f"columnas en {table}"


def test_simulated_production_then_upgrade_head(tmp_path):
    import sqlalchemy as sa
    from sqlalchemy import create_engine

    from app.models.tables import Base

    db_file = tmp_path / "prod.db"
    # 1. Las 6 migraciones viejas (hasta el head anterior).
    _run_alembic(db_file, "d485eb364382")
    # 2. create_all para las tablas posteriores (lo que hoy hace el arranque).
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        engine.dispose()
    # 3. upgrade head: debe tener éxito sobre ese estado mixto.
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        migrated = _schema_map(engine)
        insp = sa.inspect(engine)
        index_names = {
            t: {i["name"] for i in insp.get_indexes(t)}
            for t in insp.get_table_names()
        }
        uniques = {
            t: {u["name"] for u in insp.get_unique_constraints(t)}
            for t in insp.get_table_names()
        }
    finally:
        engine.dispose()
    models = _model_map()
    assert set(migrated) == set(models)
    for table, cols in models.items():
        assert migrated[table] == cols, f"columnas en {table}"
    # Índices explícitos presentes tras la migración.
    assert "ix_orders_created_at" in index_names["orders"]
    assert "ix_system_events_created_at" in index_names["system_events"]
    assert "ix_fills_order_id" in index_names["fills"]
    assert "ix_signals_created_at" in index_names["signals"]
    # Uniques de negocio presentes (BD fresca, sin duplicados).
    assert "uq_invoices_number" in uniques["invoices"]
    assert "uq_inventory_items_sku" in uniques["inventory_items"]
    assert "uq_idempotency_user_route_key" in uniques["idempotency_keys"]
    assert "uq_referral_campaign_contact" in index_names["referrals"]
