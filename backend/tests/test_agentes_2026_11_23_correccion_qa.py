"""Corrección post-QA 2026-11-23 (Agente 2) — corrida chat + perfiles.

Reproduce la sonda de QA (qa-revalidacion.md) como tests permanentes:

- H1 (BLOQUEANTE): GET /api/dashboard saltaba el gating de Invertir
  y exponía logs solo-admin a `prueba` porque componía llamando a
  los handlers directamente. Ahora las secciones se gatean dentro de
  `dashboard()` con `modulos_para()`.
- Opción B (dictamen QA punto 8): `asistente` fuera de MODULOS_CLIENTE.
- M2 (MEDIA): presupuesto global de 10 s para la búsqueda en Internet.
- B2 (BAJA): pregunta codificada en la URL fallback de DuckDuckGo.

Las filas sembradas (orden, estrategia, evento) son únicas por test
y se borran en `finally`: reproducen la sonda QA sin contaminar la
suite. Sin Internet real: la búsqueda se prueba con clientes falsos.
"""
import time
import uuid
from decimal import Decimal
from urllib.parse import quote_plus

import httpx

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import Order, StrategyVersion, SystemEvent

SECCIONES_INVERTIR = (
    "balances", "performance", "strategies", "modes", "operations", "risk",
)


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


def _mk_linked_client(client, admin_headers):
    """Usuario prueba + contacto + vínculo; devuelve (headers, contact_id)."""
    username = _uid("cliente")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    r = client.post(
        "/api/crm/contacts",
        json={"name": f"Cliente {_uid('c')}", "email": "", "phone": "",
              "source": "manual", "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    contact = r.json()
    r = client.post(
        "/api/business/marketing/portal/vinculos",
        json={"user_id": user["id"], "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = create_access_token(
        username, user_id=user["id"], token_version=user.get("token_version") or 0
    )
    return {"Authorization": f"Bearer {token}"}, contact["id"]


def _seed_qa_rows(app):
    """Siembra lo mismo que la sonda QA: una orden, una estrategia y
    un evento. Devuelve (client_order_id, nombre_estrategia, mensaje)."""
    client_order_id = _uid("qa-bypass")
    nombre = _uid("qa-estrategia")
    mensaje = f"evento qa bypass {_uid('e')}"
    db, gen = _db(app)
    try:
        db.add(Order(client_order_id=client_order_id, symbol="BTC/USD",
                     side="buy", quantity=Decimal("0.001"),
                     status="executed", mode="simulation"))
        db.add(StrategyVersion(name=nombre, version="1",
                               config_json={}, status="active", notes=""))
        db.add(SystemEvent(level="info", category="qa", message=mensaje))
        db.commit()
    finally:
        _close(gen)
    return client_order_id, nombre, mensaje


def _cleanup_qa_rows(app, client_order_id, nombre, mensaje):
    db, gen = _db(app)
    try:
        db.query(Order).filter(
            Order.client_order_id == client_order_id).delete()
        db.query(StrategyVersion).filter(
            StrategyVersion.name == nombre).delete()
        db.query(SystemEvent).filter(
            SystemEvent.message == mensaje).delete()
        db.commit()
    finally:
        _close(gen)


def _dashboard(client, headers):
    r = client.get("/api/dashboard", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"system", "balances", "performance", "signals",
                         "strategies", "modes", "operations", "risk", "logs"}
    return body


# ------------------------------------------------------------- H1: dashboard --

def test_dashboard_prueba_sin_invertir_ni_logs(client, app, viewer_headers):
    """H1: con datos sembrados, `prueba` NO ve Invertir ni logs."""
    client_order_id, nombre, mensaje = _seed_qa_rows(app)
    try:
        body = _dashboard(client, viewer_headers)
        for seccion in SECCIONES_INVERTIR:
            assert body[seccion] is None, f"prueba ve {seccion}: {body[seccion]}"
        assert body["logs"] is None, f"prueba ve logs: {body['logs']}"
        # La landing (/) sigue funcionando para prueba con sus
        # secciones permitidas: estado del sistema y señales.
        assert body["system"] is not None
        assert body["signals"] is not None
    finally:
        _cleanup_qa_rows(app, client_order_id, nombre, mensaje)


def test_dashboard_admin_ve_todas_las_secciones(client, app, admin_headers):
    """H1: el admin ve las 9 secciones, incluidas las sembradas."""
    client_order_id, nombre, mensaje = _seed_qa_rows(app)
    try:
        body = _dashboard(client, admin_headers)
        for seccion in SECCIONES_INVERTIR:
            assert body[seccion] is not None, f"admin sin {seccion}"
        assert body["logs"] is not None
        assert any(o["client_order_id"] == client_order_id
                   for o in body["operations"]["orders"])
        assert any(s["name"] == nombre for s in body["strategies"])
        assert any(e["message"] == mensaje for e in body["logs"])
        assert body["risk"]["kill_switch"] is False
        assert body["modes"]["real_enabled"] is False
    finally:
        _cleanup_qa_rows(app, client_order_id, nombre, mensaje)


def test_dashboard_cliente_vinculado_sin_invertir_ni_logs(
    client, app, admin_headers
):
    """H1: el cliente vinculado tampoco ve Invertir ni logs."""
    headers, _ = _mk_linked_client(client, admin_headers)
    client_order_id, nombre, mensaje = _seed_qa_rows(app)
    try:
        body = _dashboard(client, headers)
        for seccion in SECCIONES_INVERTIR:
            assert body[seccion] is None, f"cliente ve {seccion}"
        assert body["logs"] is None
        assert body["system"] is not None
    finally:
        _cleanup_qa_rows(app, client_order_id, nombre, mensaje)


# --------------------------------------- opción B: cliente sin asistente --

def test_perfil_cliente_vinculado_sin_asistente(client, admin_headers):
    """Dictamen QA punto 8, opción B: el perfil del cliente vinculado
    ya no lista `asistente` (el chat le responde 403 por B1)."""
    headers, _ = _mk_linked_client(client, admin_headers)
    r = client.get("/api/acceso/perfil", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["modulos"] == ["inicio", "perfil", "portal"]


# ------------------------------------------------- M2: presupuesto global --

class _ClienteLento:
    """Cliente falso que nunca responde: duerme lo que le permite el
    timeout que recibe y luego expira, como haría httpx."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url, **kwargs):
        time.sleep(kwargs.get("timeout") or 8.0)
        raise httpx.ReadTimeout("fuente lenta (mock)")


def test_busqueda_internet_no_pasa_del_presupuesto_global(monkeypatch):
    """M2: con todas las fuentes lentas, la búsqueda no pasa de
    ~5 s (antes: hasta ~32 s en serie; 10 s con el primer
    presupuesto). El presupuesto se baja a 3 s en el test para que
    corra rápido; el mecanismo es el mismo."""
    from app import internet

    monkeypatch.setattr(httpx, "Client", _ClienteLento)
    monkeypatch.setattr(internet, "PRESUPUESTO_TOTAL_S", 3.0)
    internet.limpiar_cache()
    inicio = time.monotonic()
    resultado = internet.buscar_en_internet(
        f"pregunta lenta de prueba {uuid.uuid4().hex[:8]}")
    elapsed = time.monotonic() - inicio
    assert resultado is None
    assert elapsed < 6.0, f"tardó {elapsed:.1f} s con presupuesto de 3 s"


def test_presupuesto_global_por_defecto_es_10s():
    """M2: el presupuesto real es 10 s (no 32 s).

    Chat-opt 2026-11-23 (cambio intencional, documentado en el plan):
    el presupuesto baja a 5 s porque las fuentes ahora corren en
    paralelo (4 s por fuente) y el peor caso medido con mocks lentos
    es ~3 s. El nombre del test se conserva para no romper la
    referencia M2; lo que afirma es el valor vigente."""
    from app import internet

    assert internet.PRESUPUESTO_TOTAL_S == 5.0


# ------------------------------------------- B2: URL de DDG codificada --

class _RespuestaDDG:
    status_code = 200

    def json(self):
        # Resumen sin URL: el fallback construye la URL de búsqueda.
        return {"AbstractText": "texto de prueba", "AbstractURL": ""}


class _ClienteDDG:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url, **kwargs):
        return _RespuestaDDG()


def test_url_fallback_duckduckgo_codificada():
    """B2: la pregunta va codificada en la URL fallback de DDG."""
    from app import internet

    resultado = internet._desde_ddg(
        _ClienteDDG(), "¿qué es el ornitorrinco?", timeout=5.0)
    assert resultado is not None
    url = resultado["url"]
    assert url.startswith("https://duckduckgo.com/?q=")
    assert " " not in url
    assert url == "https://duckduckgo.com/?q=" + quote_plus(
        "¿qué es el ornitorrinco?")
