"""Corrida 2026-11-23, mejoras óptimas — Agente 2 (backend).

Fase 0: gating por perfil en business/marketing/contenido/referrals/
desarrollo/recomendaciones + SSRF en internet.py + tope FIFO del caché.
Fase 1: perfil invitado (POST /api/auth/guest, JWT guest:<uuid> 15 min,
solo lectura, límites por IP).
Fase 5: lazy import de ccxt + last_update_utc real de /api/system/status.

Fixtures compartidas (client, admin_headers, viewer_headers). Los
tokens de invitado se acuñan con create_guest_token() (precedente:
create_access_token en test_fase2/test_portal_isolation) para no
gastar el limiter de emisión; los challenges se insertan directos
en _CHALLENGES para no gastar el limiter de login. Cada test limpia
sus limiters de invitado al empezar (autouse) porque TestClient
comparte la IP "testclient" en toda la suite.
"""
import datetime as dt
import subprocess
import sys
import time
import uuid
from decimal import Decimal

import httpx
import pytest
from jose import jwt

from app.api import asistente as asistente_api
from app.api import market as market_api
from app.api.auth import _CHALLENGES
from app.config import settings
from app.core.rate_limit import (
    guest_chat_limiter,
    guest_issue_limiter,
    guest_read_limiter,
    public_market_limiter,
)
from app.core.security import create_access_token, create_guest_token
from app.data import exchanges
from app.database import get_db
from app.internet import _cache, _cache_put, _fetch_directo, limpiar_cache
from app.models.tables import MarketCandle, PreguntaSinRespuesta, User


@pytest.fixture(autouse=True)
def _limpiar_limiters_invitado():
    guest_issue_limiter.clear()
    guest_chat_limiter.clear()
    guest_read_limiter.clear()
    public_market_limiter.clear()
    yield
    guest_issue_limiter.clear()
    guest_chat_limiter.clear()
    guest_read_limiter.clear()
    public_market_limiter.clear()


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _guest_headers() -> dict:
    token, _gid = create_guest_token()
    return {"Authorization": f"Bearer {token}"}


def _challenge(answer: int = 42) -> str:
    cid = f"test-{uuid.uuid4().hex[:8]}"
    _CHALLENGES[cid] = (answer, time.monotonic() + 300)
    return cid


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _headers_for(app, username: str) -> dict:
    db, gen = _db(app)
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None, username
        token = create_access_token(
            user.username, user_id=user.id, token_version=user.token_version or 0
        )
    finally:
        _close(gen)
    return {"Authorization": f"Bearer {token}"}


def _mk_linked_client(client, app, admin_headers) -> dict:
    """Usuario prueba vinculado a un Contact; devuelve sus headers."""
    username = _uid("cliF0")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["id"]
    r = client.post(
        "/api/crm/contacts",
        json={"name": _uid("CliF0"), "email": "", "phone": "", "source": "manual",
              "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    contact_id = r.json()["id"]
    r = client.post(
        "/api/business/marketing/portal/vinculos",
        json={"user_id": user_id, "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return _headers_for(app, username)


# ------------------------------------------------------------------ Fase 0 --

def test_fase0_viewer_403_en_lecturas_cerradas(client, viewer_headers, admin_headers):
    rutas = (
        "/api/business/administrativo/notes",
        "/api/business/administrativo/tasks",
        "/api/business/marketing/campanas",
        "/api/business/marketing/contenido/ideas",
        "/api/business/marketing/contenido/calendario?from=2026-01-01&to=2026-03-01",
        "/api/referrals/campaigns",
        "/api/desarrollo/projects",
        "/api/recomendaciones",
    )
    for ruta in rutas:
        r = client.get(ruta, headers=viewer_headers)
        assert r.status_code == 403, (ruta, r.text)
    # Admin sigue 200 en las mismas rutas.
    for ruta in rutas:
        r = client.get(ruta, headers=admin_headers)
        assert r.status_code == 200, (ruta, r.text)


def test_fase0_cliente_vinculado_403_salvo_portal(client, app, admin_headers):
    headers = _mk_linked_client(client, app, admin_headers)
    for ruta in (
        "/api/business/administrativo/notes",
        "/api/business/marketing/campanas",
        "/api/business/marketing/contenido/ideas",
        "/api/referrals/campaigns",
        "/api/desarrollo/projects",
        "/api/recomendaciones",
        "/api/crm/contacts",
    ):
        r = client.get(ruta, headers=headers)
        assert r.status_code == 403, (ruta, r.text)
    # Su superficie sigue abierta: inicio, portal y perfil.
    assert client.get("/api/inicio/posts", headers=headers).status_code == 200
    assert client.get("/api/business/marketing/portal/me", headers=headers).status_code == 200
    assert client.get("/api/acceso/perfil", headers=headers).status_code == 200
    assert client.get("/api/acceso/perfil", headers=headers).json()["modulos"] == [
        "inicio", "perfil", "portal",
    ]


def test_fase0_ajustador_privacidad_siguen_abiertos_sin_pii(client, viewer_headers):
    # Verificación Fase 0: contenido compartido sin PII de otros
    # usuarios (propuestas de secciones, vídeos públicos, checklist
    # de cumplimiento); escrituras siguen siendo admin-only.
    assert client.get("/api/ajustes", headers=viewer_headers).status_code == 200
    assert client.get("/api/videos", headers=viewer_headers).status_code == 200
    assert client.get("/api/privacidad/items", headers=viewer_headers).status_code == 200


def test_fase0_ssrf_fetch_directo_bloquea_privada_y_redireccion(client):
    # URL privada directa -> None (sin salir a red).
    c_priv = httpx.Client(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, text="<p>" + "x" * 200 + "</p>")))
    assert _fetch_directo(c_priv, "http://127.0.0.1/evil", 2.0) is None
    assert _fetch_directo(c_priv, "http://169.254.169.254/latest/meta-data/", 2.0) is None

    # Redirección pública -> privada -> None (revalidación por salto).
    def _redir(req: httpx.Request) -> httpx.Response:
        if str(req.url) == "http://93.184.216.34/":
            return httpx.Response(302, headers={"location": "http://127.0.0.1/evil"})
        return httpx.Response(200, text="<p>" + "y" * 200 + "</p>")

    c_redir = httpx.Client(transport=httpx.MockTransport(_redir))
    assert _fetch_directo(c_redir, "http://93.184.216.34/", 2.0) is None

    # Pública sin redirección y con texto suficiente -> dict.
    def _ok(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, text="<html><body><p>" + "Texto público suficiente. " * 10 + "</p></body></html>")

    c_ok = httpx.Client(transport=httpx.MockTransport(_ok))
    out = _fetch_directo(c_ok, "http://93.184.216.34/pagina", 2.0)
    assert out is not None and out["texto"].startswith("Texto público")


def test_fase0_ssrf_fetch_directo_topa_cuerpo_1mb():
    def _grande(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="z" * (2 * 1024 * 1024))

    c = httpx.Client(transport=httpx.MockTransport(_grande))
    assert _fetch_directo(c, "http://93.184.216.34/grande", 2.0) is None


def test_fase0_cache_internet_tope_fifo_500():
    limpiar_cache()
    try:
        for i in range(500):
            _cache_put(f"pregunta-{i}", None)
        assert len(_cache) == 500
        _cache_put("pregunta-nueva", None)
        assert len(_cache) == 500
        assert "pregunta-0" not in _cache  # la más antigua, evictada
        assert "pregunta-nueva" in _cache
    finally:
        limpiar_cache()


# ------------------------------------------------------------------ Fase 1 --

def test_fase1_guest_emision_contrato(client):
    cid = _challenge(42)
    r = client.post("/api/auth/guest",
                    json={"challenge_id": cid, "challenge_answer": 42})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    assert body["perfil"] == "invitado"
    assert body["modulos"] == ["asistente", "estudiar", "inicio", "planes"]
    # Expiración real del JWT: 15 min exactos.
    payload = jwt.decode(body["access_token"], settings.jwt_secret_key,
                         algorithms=["HS256"])
    assert payload["sub"].startswith("guest:")
    assert payload["role"] == "invitado"
    assert payload["exp"] - payload["iat"] == 900


def test_fase1_guest_challenge_incorrecto_o_reutilizado_400(client):
    cid = _challenge(10)
    r = client.post("/api/auth/guest",
                    json={"challenge_id": cid, "challenge_answer": 99})
    assert r.status_code == 400, r.text
    # El challenge se consume en el primer intento (aunque falle).
    r = client.post("/api/auth/guest",
                    json={"challenge_id": cid, "challenge_answer": 10})
    assert r.status_code == 400, r.text


def test_fase1_guest_emision_limite_3_por_minuto(client):
    for _ in range(3):
        cid = _challenge(7)
        r = client.post("/api/auth/guest",
                        json={"challenge_id": cid, "challenge_answer": 7})
        assert r.status_code == 200, r.text
    cid = _challenge(7)
    r = client.post("/api/auth/guest",
                    json={"challenge_id": cid, "challenge_answer": 7})
    assert r.status_code == 429, r.text
    assert r.headers.get("Retry-After") == "60"


def test_fase1_guest_perfil_y_lecturas_publicas(client):
    h = _guest_headers()
    r = client.get("/api/acceso/perfil", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "invitado"
    assert r.json()["is_admin"] is False
    assert r.json()["modulos"] == ["asistente", "estudiar", "inicio", "planes"]
    assert client.get("/api/inicio/posts", headers=h).status_code == 200
    assert client.get("/api/academy/courses", headers=h).status_code == 200
    assert client.get("/api/clases/classes", headers=h).status_code == 200
    assert client.get("/api/asistente/capacidades", headers=h).status_code == 200


def test_fase1_guest_token_expirado_401(client):
    ahora = dt.datetime.now(dt.timezone.utc)
    token = jwt.encode(
        {"sub": "guest:expirado", "role": "invitado",
         "exp": ahora - dt.timedelta(minutes=1), "iat": ahora - dt.timedelta(minutes=16)},
        settings.jwt_secret_key, algorithm="HS256")
    r = client.get("/api/acceso/perfil",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401, r.text


def test_fase1_guest_exclusiones_403(client, admin_headers):
    h = _guest_headers()
    # Escrituras y rutas cerradas a invitado.
    assert client.post("/api/chat/messages", json={"text": "hola"}, headers=h).status_code == 403
    assert client.post("/api/auth/change-password",
                       json={"current_password": "x", "new_password": "y" * 12},
                       headers=h).status_code == 403
    assert client.get("/api/users", headers=h).status_code == 403
    assert client.get("/api/system/metrics", headers=h).status_code == 403
    assert client.get("/api/tendencias/searches", headers=h).status_code == 403
    assert client.get("/api/auditor/audits", headers=h).status_code == 403
    assert client.post("/api/analizador/analizar",
                       json={"url": "https://example.com"}, headers=h).status_code == 403
    assert client.get("/api/crm/contacts", headers=h).status_code == 403
    assert client.get("/api/business/administrativo/notes", headers=h).status_code == 403
    assert client.post("/api/inicio/posts",
                       json={"title": "x", "body": "y"}, headers=h).status_code == 403
    # Comentarios POST cerrados (la lectura sigue abierta).
    r = client.post("/api/inicio/posts",
                    json={"title": "Post invitado", "body": "cuerpo"},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    post_id = r.json()["id"]
    try:
        assert client.get(f"/api/inicio/posts/{post_id}/comments",
                          headers=h).status_code == 200
        assert client.post(f"/api/inicio/posts/{post_id}/comments",
                           json={"body": "comentario invitado"},
                           headers=h).status_code == 403
    finally:
        client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)


def test_fase1_guest_asistente_solo_lectura(client, app):
    h = _guest_headers()
    # Lectura: precio (200, sin red).
    r = client.post("/api/asistente/chat",
                    json={"mensaje": "cuanto vale el bitcoin"}, headers=h)
    assert r.status_code == 200, r.text
    # Creaciones: 200 con explicación de solo lectura, sin mutar.
    for mensaje in ("crea una nota: comprar café",
                    "crea una tarea: llamar al proveedor",
                    "crea un borrador sobre el nuevo curso",
                    "crea una cita para mañana a las 10:00"):
        r = client.post("/api/asistente/chat", json={"mensaje": mensaje}, headers=h)
        assert r.status_code == 200, (mensaje, r.text)
        assert "solo lectura" in r.json()["respuesta"], r.json()
    # Datos reales de otros: no disponibles en demo.
    # (El limiter de invitado es 5/min: se limpia a mitad del test
    # para cubrir las 7 preguntas sin falsear el límite.)
    guest_chat_limiter.clear()
    r = client.post("/api/asistente/chat",
                    json={"mensaje": "muéstrame las facturas"}, headers=h)
    assert r.status_code == 200, r.text
    assert "No disponible en la demo" in r.json()["respuesta"]
    r = client.post("/api/asistente/chat",
                    json={"mensaje": "lista mis contactos"}, headers=h)
    assert "No disponible en la demo" in r.json()["respuesta"]
    # Nada creado por el invitado: sin notas/tareas/borradores nuevos.
    db, gen = _db(app)
    try:
        from app.models.tables import BusinessNote, BusinessTask, ContentItem
        assert db.query(BusinessNote).filter(
            BusinessNote.title.like("%comprar café%")).count() == 0
        assert db.query(BusinessTask).filter(
            BusinessTask.title.like("%llamar al proveedor%")).count() == 0
        assert db.query(ContentItem).filter(
            ContentItem.title.like("%nuevo curso%")).count() == 0
    finally:
        _close(gen)


def test_fase1_guest_pregunta_sin_respuesta_no_va_a_bandeja(client, app):
    h = _guest_headers()
    db, gen = _db(app)
    try:
        antes = db.query(PreguntaSinRespuesta).count()
        conteo_antes = asistente_api.invitado_sin_respuesta_total()
    finally:
        _close(gen)
    # "hola" cae en la vía rápida sin-respuesta (sin viaje a Internet).
    r = client.post("/api/asistente/chat", json={"mensaje": "hola"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json().get("sin_respuesta") is True
    db, gen = _db(app)
    try:
        assert db.query(PreguntaSinRespuesta).count() == antes
    finally:
        _close(gen)
    assert asistente_api.invitado_sin_respuesta_total() == conteo_antes + 1


def test_fase1_guest_chat_limite_5_por_minuto(client):
    h = _guest_headers()
    for _ in range(5):
        r = client.post("/api/asistente/chat", json={"mensaje": "hola"}, headers=h)
        assert r.status_code == 200, r.text
    r = client.post("/api/asistente/chat", json={"mensaje": "hola"}, headers=h)
    assert r.status_code == 429, r.text
    assert r.headers.get("Retry-After") == "60"


def test_fase1_guest_lecturas_limite_30_por_minuto(client):
    h = _guest_headers()
    for _ in range(30):
        r = client.get("/api/inicio/posts", headers=h)
        assert r.status_code == 200, r.text
    r = client.get("/api/inicio/posts", headers=h)
    assert r.status_code == 429, r.text
    assert r.headers.get("Retry-After") == "60"


# ------------------------------------------------------------------ Fase 5 --

def test_fase5_ccxt_no_carga_en_arranque():
    # Proceso fresco: importar app.main NO debe cargar ccxt.
    r = subprocess.run(
        [sys.executable, "-c",
         "import app.main, sys; print('ccxt' in sys.modules)"],
        cwd=".",
        capture_output=True, text=True, timeout=120,
    )
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "False", r.stdout


def test_fase5_make_exchange_carga_ccxt_bajo_demanda():
    from app.data import exchanges

    assert not hasattr(exchanges, "ccxt")
    ex = exchanges.make_exchange("kraken")
    assert type(ex).__name__ == "kraken"
    import sys as _sys
    assert "ccxt" in _sys.modules  # cargado solo al usarlo
    from app.exchange import adapter
    assert not hasattr(adapter, "ccxt")


def test_fase5_system_status_last_update_es_ingesta_real(client, app, admin_headers):
    db, gen = _db(app)
    try:
        # La vela se siembra 1 h DESPUÉS del máximo existente (la BD
        # de la suite es compartida y otros tests siembran velas):
        # así el max() es seguro que es la nuestra.
        from sqlalchemy import func as _func

        max_existente = db.query(_func.max(MarketCandle.open_time_utc)).scalar()
        base = max_existente or dt.datetime.now(dt.timezone.utc)
        if base.tzinfo is None:
            base = base.replace(tzinfo=dt.timezone.utc)
        abierta = base + dt.timedelta(hours=1)
        vela = MarketCandle(
            symbol="BTC/USD", timeframe="1h", open_time_utc=abierta,
            open=Decimal("90000"), high=Decimal("91000"), low=Decimal("89000"),
            close=Decimal("90500"), volume=Decimal("12.5"), source="kraken",
        )
        db.add(vela)
        db.commit()
        try:
            r = client.get("/api/system/status", headers=admin_headers)
            assert r.status_code == 200, r.text
            assert r.json()["last_update_utc"] == abierta.isoformat(), r.json()
        finally:
            db.delete(vela)
            db.commit()
    finally:
        _close(gen)


# ------------------------------------------------- Corrección P0-1 (QA) --
# El invitado no podía usar conversor/gráfica/indicadores: /api/market/*
# exige require_modulo("invertir") + get_current_user. El router nuevo
# /api/public/market/* sirve los mismos datos públicos de solo lectura
# a cualquier principal autenticado (invitado incluido), con límite
# propio de 30/min por IP. Las velas se siembran reales en la BD de
# pruebas; ticker/precios pasan por el servicio real de mercado
# (fetch_ticker/fetch_ohlcv con stub) y por la caché compartida.

def _seed_velas_publicas(app, n: int = 60):
    """Siembra n velas frescas BTC/USD 1h (la más reciente, hace 30 min)
    y devuelve sus ids para borrarlas al final del test."""
    db, gen = _db(app)
    try:
        base = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=30)
        ids = []
        for i in range(n):
            abierta = base - dt.timedelta(hours=n - 1 - i)
            precio = Decimal("90000") + Decimal(i * 10)
            vela = MarketCandle(
                symbol="BTC/USD", timeframe="1h", open_time_utc=abierta,
                open=precio, high=precio + Decimal("50"),
                low=precio - Decimal("50"), close=precio + Decimal("5"),
                volume=Decimal("12.5"), source="kraken",
            )
            db.add(vela)
            db.flush()
            ids.append(vela.id)
        db.commit()
        return ids
    finally:
        _close(gen)


def _borrar_velas_publicas(app, ids):
    db, gen = _db(app)
    try:
        db.query(MarketCandle).filter(MarketCandle.id.in_(ids)).delete(
            synchronize_session=False)
        db.commit()
    finally:
        _close(gen)


def _limpiar_caches_mercado():
    market_api._TICKER_CACHE.clear()
    market_api._PRICES_CACHE["at"] = 0.0
    market_api._PRICES_CACHE["payload"] = None


def test_p01_guest_200_en_los_4_endpoints_publicos(client, app, monkeypatch):
    h = _guest_headers()
    ids = _seed_velas_publicas(app)
    llamadas = {"ticker": 0, "ohlcv": 0}

    def _ticker(exchange, symbol):
        llamadas["ticker"] += 1
        return {"last": 60576.5, "percentage": 1.5}

    def _ohlcv(exchange, pair, timeframe, limit=24):
        llamadas["ohlcv"] += 1
        return [[i, 60000.0, 60100.0, 59900.0, 60000.0 + i, 1.0]
                for i in range(24)]

    monkeypatch.setattr(exchanges, "fetch_ticker", _ticker)
    monkeypatch.setattr(exchanges, "fetch_ohlcv", _ohlcv)
    try:
        _limpiar_caches_mercado()
        r = client.get("/api/public/market/ticker?symbol=BTC/USD", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["symbol"] == "BTC/USD"
        assert r.json()["last"] == "60576.5"
        assert r.json()["source"] == "kraken"
        # Segunda llamada: servida desde la caché, sin pegar al exchange.
        r = client.get("/api/public/market/ticker?symbol=BTC/USD", headers=h)
        assert r.status_code == 200, r.text
        assert llamadas["ticker"] == 1

        r = client.get("/api/public/market/candles?symbol=BTC/USD&timeframe=1h&limit=100", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["symbol"] == "BTC/USD"
        assert r.json()["timeframe"] == "1h"
        assert len(r.json()["candles"]) >= 60

        r = client.get("/api/public/market/indicators?symbol=BTC/USD&timeframe=1h", headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["symbol"] == "BTC/USD"
        assert "rsi_14" in r.json()["indicators"]

        r = client.get("/api/public/market/prices", headers=h)
        assert r.status_code == 200, r.text
        assert [p["symbol"] for p in r.json()["prices"]] == ["BTC", "ETH", "USDT", "BNB"]
        assert r.json()["prices"][0]["price_usd"] == 60576.5
        assert llamadas["ohlcv"] >= 1
    finally:
        _limpiar_caches_mercado()
        _borrar_velas_publicas(app, ids)


def test_p01_anonimo_401_en_los_4_endpoints_publicos(client):
    for ruta in (
        "/api/public/market/ticker",
        "/api/public/market/candles",
        "/api/public/market/prices",
        "/api/public/market/indicators",
    ):
        r = client.get(ruta)
        assert r.status_code == 401, (ruta, r.text)


def test_p01_admin_y_prueba_200_en_los_4_endpoints_publicos(
        client, app, viewer_headers, admin_headers):
    ids = _seed_velas_publicas(app)
    try:
        _limpiar_caches_mercado()
        market_api._ticker_cache_put(
            ("kraken", "BTC/USD"),
            {"at": time.monotonic(), "payload": {
                "symbol": "BTC/USD", "last": "60576.5", "source": "kraken",
                "updated_utc": market_api._utcnow(), "stale": False}})
        market_api._PRICES_CACHE["at"] = time.monotonic()
        market_api._PRICES_CACHE["payload"] = {
            "source": "kraken", "updated_utc": market_api._utcnow(),
            "stale": False,
            "prices": [
                {"symbol": s, "name": n, "pair": f"{s}/USD",
                 "price_usd": 60000.0, "change_24h_pct": 1.5,
                 "sparkline_24h": [1.0, 2.0]}
                for s, n in (("BTC", "Bitcoin"), ("ETH", "Ethereum"),
                             ("USDT", "Tether"), ("BNB", "BNB"))]}
        rutas = (
            "/api/public/market/ticker?symbol=BTC/USD",
            "/api/public/market/candles?symbol=BTC/USD&timeframe=1h",
            "/api/public/market/prices",
            "/api/public/market/indicators?symbol=BTC/USD&timeframe=1h",
        )
        for headers in (admin_headers, viewer_headers):
            for ruta in rutas:
                r = client.get(ruta, headers=headers)
                assert r.status_code == 200, (ruta, r.text)
    finally:
        _limpiar_caches_mercado()
        _borrar_velas_publicas(app, ids)


def test_p01_misma_forma_que_api_market(client, app, admin_headers):
    """El cuerpo público tiene la misma forma (mismas claves) que
    /api/market/* para el mismo símbolo/timeframe."""
    h = _guest_headers()
    ids = _seed_velas_publicas(app)
    try:
        _limpiar_caches_mercado()
        market_api._ticker_cache_put(
            ("kraken", "BTC/USD"),
            {"at": time.monotonic(), "payload": {
                "symbol": "BTC/USD", "last": "60576.5", "source": "kraken",
                "updated_utc": market_api._utcnow(), "stale": False}})
        market_api._PRICES_CACHE["at"] = time.monotonic()
        market_api._PRICES_CACHE["payload"] = {
            "source": "kraken", "updated_utc": market_api._utcnow(),
            "stale": False,
            "prices": [
                {"symbol": s, "name": n, "pair": f"{s}/USD",
                 "price_usd": 60000.0, "change_24h_pct": 1.5,
                 "sparkline_24h": [1.0, 2.0]}
                for s, n in (("BTC", "Bitcoin"), ("ETH", "Ethereum"),
                             ("USDT", "Tether"), ("BNB", "BNB"))]}
        pares = (
            ("/api/public/market/ticker?symbol=BTC/USD",
             "/api/market/ticker?symbol=BTC/USD"),
            ("/api/public/market/candles?symbol=BTC/USD&timeframe=1h&limit=100",
             "/api/market/candles?symbol=BTC/USD&timeframe=1h&limit=100"),
            ("/api/public/market/prices", "/api/market/prices"),
            ("/api/public/market/indicators?symbol=BTC/USD&timeframe=1h",
             "/api/market/indicators?symbol=BTC/USD&timeframe=1h"),
        )
        for publico, privado in pares:
            rp = client.get(publico, headers=h)
            ra = client.get(privado, headers=admin_headers)
            assert rp.status_code == 200, (publico, rp.text)
            assert ra.status_code == 200, (privado, ra.text)
            assert set(rp.json().keys()) == set(ra.json().keys()), (publico, privado)
    finally:
        _limpiar_caches_mercado()
        _borrar_velas_publicas(app, ids)


def test_p01_limite_ip_30_por_minuto(client):
    h = _guest_headers()
    market_api._ticker_cache_put(
        ("kraken", "BTC/USD"),
        {"at": time.monotonic(), "payload": {
            "symbol": "BTC/USD", "last": "60576.5", "source": "kraken",
            "updated_utc": market_api._utcnow(), "stale": False}})
    try:
        for _ in range(30):
            r = client.get("/api/public/market/ticker?symbol=BTC/USD", headers=h)
            assert r.status_code == 200, r.text
        r = client.get("/api/public/market/ticker?symbol=BTC/USD", headers=h)
        assert r.status_code == 429, r.text
        assert r.headers.get("Retry-After") == "60"
    finally:
        market_api._TICKER_CACHE.clear()


def test_p01_guest_sigue_403_en_api_market_privado(client):
    h = _guest_headers()
    for ruta in (
        "/api/market/ticker?symbol=BTC/USD",
        "/api/market/candles?symbol=BTC/USD&timeframe=1h",
        "/api/market/prices",
        "/api/market/indicators?symbol=BTC/USD&timeframe=1h",
    ):
        r = client.get(ruta, headers=h)
        assert r.status_code == 403, (ruta, r.text)
    # La ingesta (escritura) sigue cerrada al invitado.
    r = client.post("/api/market/ingest?symbol=BTC/USD&timeframe=1h", headers=h)
    assert r.status_code == 403, r.text


def test_p01_asistente_rechazo_dice_invitado_al_invitado(
        client, viewer_headers):
    h = _guest_headers()
    r = client.post("/api/asistente/chat",
                    json={"mensaje": "muéstrame las facturas"}, headers=h)
    assert r.status_code == 200, r.text
    assert "No disponible en la demo" in r.json()["respuesta"]
    assert "(invitado)" in r.json()["respuesta"], r.json()
    assert "(prueba)" not in r.json()["respuesta"], r.json()
    # El rol prueba sigue viéndose como "prueba".
    r = client.post("/api/asistente/chat",
                    json={"mensaje": "muéstrame las facturas"},
                    headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert "(prueba)" in r.json()["respuesta"], r.json()
    assert "(invitado)" not in r.json()["respuesta"], r.json()
