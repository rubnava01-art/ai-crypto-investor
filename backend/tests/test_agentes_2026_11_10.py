"""Mejoras diarias 2026-11-10: métricas de latencia por ruta."""
from app.core import metrics


def test_metrics_snapshot_routes_include_called_endpoint(client, admin_headers):
    # La propia petición no se cuenta en su respuesta (el middleware
    # registra al terminar), así que hacen falta dos llamadas. El
    # snapshot muestra solo las 10 más lentas, así que la presencia de
    # la ruta se verifica en el registro interno, no en el top 10.
    client.get("/api/system/metrics", headers=admin_headers)
    r = client.get("/api/system/metrics", headers=admin_headers)
    assert r.status_code == 200
    assert "/api/system/metrics" in metrics._route_stats
    row = metrics._route_stats["/api/system/metrics"]
    assert row["requests"] >= 1
    assert row["errors"] == 0
    assert row["latency_ms_total"] >= 0
    routes = r.json()["routes"]
    assert len(routes) <= 10
    avgs = [row["avg_latency_ms"] for row in routes]
    assert avgs == sorted(avgs, reverse=True)


def test_metrics_snapshot_routes_capped_at_ten(client, admin_headers):
    r = client.get("/api/system/metrics", headers=admin_headers)
    assert r.status_code == 200
    assert len(r.json()["routes"]) <= 10


def test_metrics_route_registry_cap():
    # Unitario: el registro por ruta no crece sin límite (70 rutas
    # distintas -> como mucho 64). Limpia antes y después para no
    # contaminar la suite, que comparte el proceso.
    metrics._route_stats.clear()
    try:
        for i in range(70):
            metrics._record_route(f"/fake/route-{i}", 1.0, False)
        assert len(metrics._route_stats) <= 64
        assert "/fake/route-0" in metrics._route_stats
        assert "/fake/route-69" not in metrics._route_stats
        metrics._record_route("/fake/route-0", 2.0, True)
        assert metrics._route_stats["/fake/route-0"]["requests"] == 2
        assert metrics._route_stats["/fake/route-0"]["errors"] == 1
    finally:
        metrics._route_stats.clear()

# --- Corrida 3 agentes 2026-11-10 · Agente 2 (Backend) -------------------
# H-2 (pool), H-5 (una sola consulta en auth), M-1 (rate limit Correos),
# M-2 (validación EmailLogCreate). Solo fixtures compartidos
# (client, admin_headers, viewer_headers); cada test limpia lo que crea
# y vacía el limiter de Correos para no bloquear a los demás tests de
# la suite (la BD y el proceso son compartidos).
from types import SimpleNamespace

from app.core.rate_limit import correos_limiter
from app.core.security import effective_role


def _valid_log_payload(**overrides):
    payload = {
        "contact_name": "Contacto Prueba",
        "contact_email": "prueba@example.com",
        "template_name": "",
        "subject": "Asunto de prueba",
        "body": "Cuerpo de prueba",
    }
    payload.update(overrides)
    return payload


# H-2: el engine de la app lleva pool_pre_ping + recycle + tamaño 5+5.
def test_database_engine_pool_options():
    from app.database import engine

    pool = engine.pool
    assert pool.size() == 5
    assert pool._max_overflow == 5
    assert pool._recycle == 300
    assert pool._pre_ping is True


# H-5: /me devuelve el rol correcto con is_super_admin calculado una
# sola vez; effective_role reutiliza el flag sin tocar la BD.
def test_me_role_for_admin_and_viewer(client, admin_headers, viewer_headers):
    r = client.get("/api/auth/me", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_admin"] is True
    # El admin sembrado es el owner: la siembra le otorga super admin.
    assert r.json()["is_super_admin"] is True
    assert r.json()["role"] == "super_admin"

    r = client.get("/api/auth/me", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_admin"] is False
    assert r.json()["role"] == "prueba"


def test_effective_role_reuses_super_flag_without_query():
    # Con super_flag dado, effective_role no debe tocar la BD (db=None
    # provocaría un error si intentara consultar).
    assert effective_role(SimpleNamespace(is_admin=False), None, super_flag=True) == "super_admin"
    assert effective_role(SimpleNamespace(is_admin=False), None, super_flag=False) == "prueba"
    assert effective_role(SimpleNamespace(is_admin=True), None, super_flag=False) == "admin"


# M-1: uso normal de Correos no se bloquea.
def test_correos_rate_limit_normal_use_not_blocked(client, admin_headers):
    correos_limiter.clear()
    log_id = None
    try:
        assert client.get("/api/correos/templates", headers=admin_headers).status_code == 200
        assert client.get("/api/correos/logs", headers=admin_headers).status_code == 200
        r = client.post("/api/correos/logs", json=_valid_log_payload(), headers=admin_headers)
        assert r.status_code == 201, r.text
        log_id = r.json()["id"]
        assert client.get("/api/correos/logs", headers=admin_headers).status_code == 200
    finally:
        if log_id is not None:
            correos_limiter.clear()
            client.delete(f"/api/correos/logs/{log_id}", headers=admin_headers)
        correos_limiter.clear()


# M-1: 100 POST seguidos -> los 30 primeros pasan, el resto 429.
def test_correos_rate_limit_burst_returns_429(client, admin_headers):
    correos_limiter.clear()
    created_ids = []
    try:
        statuses = []
        for i in range(100):
            r = client.post(
                "/api/correos/logs",
                json=_valid_log_payload(contact_name=f"Ráfaga {i}"),
                headers=admin_headers,
            )
            statuses.append(r.status_code)
            if r.status_code == 201:
                created_ids.append(r.json()["id"])
        assert statuses.count(201) == 30, statuses
        assert statuses.count(429) == 70, statuses
        assert statuses[:30] == [201] * 30
        assert statuses[30:] == [429] * 70
    finally:
        # Limpiar los 30 logs creados (cada DELETE consume el limiter:
        # vaciarlo antes) y dejar el limiter limpio para el resto de la
        # suite (test_correos.py corre después y comparte el proceso).
        correos_limiter.clear()
        for log_id in created_ids:
            client.delete(f"/api/correos/logs/{log_id}", headers=admin_headers)
        correos_limiter.clear()


# M-2: email inválido, contact_id inexistente y cuerpo/asunto vacíos -> 422.
def test_correos_log_validation_rejects_invalid(client, admin_headers):
    correos_limiter.clear()
    try:
        # Caso combinado del plan: email "xxx" + contact_id 999999 +
        # cuerpo vacío -> 422.
        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(contact_email="xxx", contact_id=999999, body=""),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text

        # Cada regla por separado.
        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(contact_email="xxx"),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text

        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(contact_email="", contact_id=999999),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text

        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(body=""),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text

        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(body="   "),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text

        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(subject=""),
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text
    finally:
        correos_limiter.clear()


# M-2: payload válido con contact_id existente y email válido -> 201.
def test_correos_log_validation_accepts_valid_with_existing_contact(
    client, admin_headers
):
    correos_limiter.clear()
    contact_id = None
    log_id = None
    try:
        r = client.post(
            "/api/crm/contacts",
            json={"name": "Contacto Corrida 2026-11-10", "email": "contacto@example.com"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        contact_id = r.json()["id"]

        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(contact_id=contact_id),
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        log_id = r.json()["id"]
        assert r.json()["contact_id"] == contact_id

        # Sin email y sin contact_id también es válido (campos opcionales).
        r = client.post(
            "/api/correos/logs",
            json=_valid_log_payload(contact_email="", contact_id=None),
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        log_id2 = r.json()["id"]
        correos_limiter.clear()
        assert (
            client.delete(f"/api/correos/logs/{log_id2}", headers=admin_headers).status_code
            == 204
        )
    finally:
        correos_limiter.clear()
        if log_id is not None:
            client.delete(f"/api/correos/logs/{log_id}", headers=admin_headers)
        if contact_id is not None:
            client.delete(f"/api/crm/contacts/{contact_id}", headers=admin_headers)
        correos_limiter.clear()
