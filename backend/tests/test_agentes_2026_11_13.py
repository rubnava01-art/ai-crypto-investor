"""Tests de la corrida de agentes 2026-11-13 — Agente 2 (backend).

Cubre:
- A1: /api/market/prices TTL 300 s + stale-while-revalidate con refresco
  en segundo plano (antes: TTL 60 s == sondeo 60 s -> MISS ~5 s cada minuto).
- A2: columna `requested_plan` (migración Alembic 88f6de1c6bb9): el registro
  acepta un `plan` opcional, lo guarda canónico y el admin lo ve en
  GET /api/users.
- M4: `Cache-Control: private, max-age=60` solo en los GET casi
  estáticos allowlistados; ausente en dashboard y lecturas de usuario.
- M5: `Retry-After` en los 429 de mercado y de login.

Solo usa las fixtures compartidas (client, admin_headers,
viewer_headers). Cada test limpia lo que crea: usuarios de prueba se
borran vía reject, la caché de precios y los limiters se restauran al
final (la suite comparte un único proceso y una única BD).
"""
import re
import time

import app.api.market as market_mod
from app.api.market import _PRICES_CACHE
from app.core.rate_limit import login_limiter, login_lockout, market_limiter


# ------------------------------------------------------------------ A1 --
def _fake_ticker(price):
    def _t(exchange, pair):
        return {"last": price, "percentage": 1.5}

    return _t


def _fake_ohlcv(exchange, pair, timeframe="1h", limit=24):
    return [[i * 3_600_000, 1, 2, 0.5, 49000.0 + i * 10, 100.0] for i in range(limit)]


def _reset_prices_cache():
    _PRICES_CACHE["at"] = 0.0
    _PRICES_CACHE["payload"] = None


def _wait_refresh_done(timeout_s=5.0):
    """Espera a que un refresco en fondo termine (para no dejar hilos
    corriendo cuando el monkeypatch del test se deshace)."""
    deadline = time.monotonic() + timeout_s
    while market_mod._PRICES_REFRESHING and time.monotonic() < deadline:
        time.sleep(0.05)


def test_prices_ttl_is_300_and_max_stale_above_it():
    # La regresión concreta: TTL 60 s == sondeo 60 s del frontend.
    assert market_mod._PRICES_TTL_S == 300.0
    assert market_mod._PRICES_MAX_STALE_S > market_mod._PRICES_TTL_S


def test_prices_swr_serves_stale_fast_and_refreshes_in_background(
    client, admin_headers, monkeypatch
):
    """Caché vencida (301 s, dentro del tope de antigüedad): la respuesta
    es inmediata con el dato viejo marcado stale, y el refresco en fondo
    actualiza la caché para el siguiente sondeo."""
    _reset_prices_cache()
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker(50000.0))
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    try:
        first = client.get("/api/market/prices", headers=admin_headers)
        assert first.status_code == 200, first.text
        assert first.json()["stale"] is False
        assert first.json()["prices"][0]["price_usd"] == 50000.0

        # El exchange ahora daría otro precio; la caché vence.
        monkeypatch.setattr(
            market_mod.exchanges, "fetch_ticker", _fake_ticker(60000.0)
        )
        _PRICES_CACHE["at"] = time.monotonic() - 301.0

        started = time.monotonic()
        stale_resp = client.get("/api/market/prices", headers=admin_headers)
        elapsed = time.monotonic() - started
        assert stale_resp.status_code == 200, stale_resp.text
        # SWR: dato viejo inmediato (sin esperar al refetch) y marcado.
        assert stale_resp.json()["stale"] is True
        assert stale_resp.json()["prices"][0]["price_usd"] == 50000.0
        assert elapsed < 1.0, f"SWR debe ser inmediato, tardó {elapsed:.2f}s"

        # El refresco en fondo actualiza la caché: el siguiente sondeo
        # ya es fresco con el precio nuevo.
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            payload = _PRICES_CACHE["payload"]
            if payload and payload["prices"][0]["price_usd"] == 60000.0:
                break
            time.sleep(0.05)
        assert _PRICES_CACHE["payload"]["prices"][0]["price_usd"] == 60000.0
        fresh = client.get("/api/market/prices", headers=admin_headers)
        assert fresh.status_code == 200, fresh.text
        assert fresh.json()["stale"] is False
        assert fresh.json()["prices"][0]["price_usd"] == 60000.0
    finally:
        _wait_refresh_done()
        _reset_prices_cache()


def test_prices_beyond_max_stale_falls_back_to_sync_fetch(
    client, admin_headers, monkeypatch
):
    """Caché más vieja que el tope de antigüedad (1 h): no se sirve stale
    en fondo; el endpoint refetchea en síncrono como antes."""
    _reset_prices_cache()
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker(50000.0))
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    try:
        first = client.get("/api/market/prices", headers=admin_headers)
        assert first.status_code == 200, first.text
        monkeypatch.setattr(
            market_mod.exchanges, "fetch_ticker", _fake_ticker(60000.0)
        )
        _PRICES_CACHE["at"] = time.monotonic() - 4000.0  # > MAX_STALE 3600
        r = client.get("/api/market/prices", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["stale"] is False
        assert r.json()["prices"][0]["price_usd"] == 60000.0
    finally:
        _wait_refresh_done()
        _reset_prices_cache()


# ------------------------------------------------------------------ A2 --
def _challenge_answer(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    body = r.json()
    m = re.search(r"(\d+) \+ (\d+)", body["question"])
    assert m, body
    return body["challenge_id"], int(m.group(1)) + int(m.group(2))


def _register(client, username, plan=None):
    cid, answer = _challenge_answer(client)
    payload = {
        "username": username,
        "password": "PlanPass12345",
        "challenge_id": cid,
        "answer": answer,
    }
    if plan is not None:
        payload["plan"] = plan
    return client.post("/api/auth/register", json=payload)


def _find_user(client, admin_headers, username):
    r = client.get("/api/users?limit=200", headers=admin_headers)
    assert r.status_code == 200, r.text
    for u in r.json():
        if u["username"] == username:
            return u
    return None


def test_register_with_plan_card_id_stores_canonical_and_admin_sees_it(
    client, admin_headers
):
    """?plan=plan-crecimiento (id de tarjeta, PLAN_CARD_IDS) se guarda
    canónico ("crecimiento") y el admin lo ve en la lista de usuarios."""
    username = "a2plan1"
    try:
        r = _register(client, username, plan="plan-crecimiento")
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["requested_plan"] == "crecimiento"
        listed = _find_user(client, admin_headers, username)
        assert listed is not None
        assert listed["status"] == "pending"
        assert listed["requested_plan"] == "crecimiento"
    finally:
        listed = _find_user(client, admin_headers, username)
        if listed is not None:
            rr = client.post(
                f"/api/users/{listed['id']}/reject", headers=admin_headers
            )
            assert rr.status_code == 204, rr.text


def test_register_with_short_plan_key_and_none_for_existing(
    client, admin_headers
):
    """La clave corta ("esencial") también vale; las cuentas sin plan
    (aquí, el admin semilla) exponen requested_plan null."""
    username = "a2plan2"
    try:
        r = _register(client, username, plan="esencial")
        assert r.status_code == 201, r.text
        assert r.json()["requested_plan"] == "esencial"
        listed = _find_user(client, admin_headers, username)
        assert listed is not None
        assert listed["requested_plan"] == "esencial"
    finally:
        listed = _find_user(client, admin_headers, username)
        if listed is not None:
            rr = client.post(
                f"/api/users/{listed['id']}/reject", headers=admin_headers
            )
            assert rr.status_code == 204, rr.text
    admin = _find_user(client, admin_headers, "admin")
    assert admin is not None
    assert admin["requested_plan"] is None


def test_register_with_invalid_plan_is_422(client, admin_headers):
    """Un plan inventado se rechaza antes de crear nada (422 de
    validación; no consume el limitador de registro)."""
    r = client.post(
        "/api/auth/register",
        json={
            "username": "a2planbad",
            "password": "PlanPass12345",
            "challenge_id": "dummy",
            "answer": 0,
            "plan": "premium",
        },
    )
    assert r.status_code == 422, r.text
    # Nada creado: el usuario no aparece en la lista de admin.
    assert _find_user(client, admin_headers, "a2planbad") is None


# ------------------------------------------------------------------ M4 --
def test_cache_control_on_static_gets(client, admin_headers):
    """Solo los GET casi estáticos llevan private, max-age=60."""
    for path in (
        "/api/academy/courses",
        "/api/clases/classes",
        "/api/inicio/posts",
        "/api/recomendaciones",
    ):
        r = client.get(path, headers=admin_headers)
        assert r.status_code == 200, (path, r.text)
        assert r.headers.get("cache-control") == "private, max-age=60", path


def test_no_cache_control_on_dashboard_me_users_and_prices(
    client, admin_headers, monkeypatch
):
    """Dashboard, /me, lista de usuarios y precios en vivo NO llevan
    Cache-Control: son datos de usuario o en vivo."""
    for path in ("/api/dashboard", "/api/auth/me", "/api/users"):
        r = client.get(path, headers=admin_headers)
        assert r.status_code == 200, (path, r.text)
        assert "cache-control" not in r.headers, path
    _reset_prices_cache()
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker(50000.0))
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    try:
        r = client.get("/api/market/prices", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert "cache-control" not in r.headers
    finally:
        _reset_prices_cache()


# ------------------------------------------------------------------ M5 --
def test_market_429_has_retry_after(client, admin_headers, monkeypatch):
    """60/min por usuario: la 61.ª llamada es 429 con Retry-After: 60.
    El limiter se vacía antes y después para no bloquear al resto de
    la suite (BD y proceso compartidos)."""
    _reset_prices_cache()
    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", _fake_ticker(50000.0))
    monkeypatch.setattr(market_mod.exchanges, "fetch_ohlcv", _fake_ohlcv)
    market_limiter.clear()
    try:
        last = None
        for _ in range(61):
            last = client.get("/api/market/prices", headers=admin_headers)
        assert last is not None
        assert last.status_code == 429, last.text
        assert last.headers.get("retry-after") == "60"
        assert "Espera un minuto" in last.json()["detail"]
    finally:
        market_limiter.clear()
        _reset_prices_cache()


def test_login_limiter_429_has_retry_after(client):
    """Llenar el limitador de login (10/min por IP) y comprobar que el
    429 de login lleva Retry-After: 60. Se vacía antes y después: la
    suite comparte el limitador y los logins de las fixtures ya ocupan
    parte del cupo, así que se llena hasta agotar sin asumir el cupo
    inicial."""
    login_limiter.clear()
    try:
        for _ in range(15):
            login_limiter.allow("login:testclient")
        r = client.post(
            "/api/auth/login", json={"username": "nobody", "password": "x"}
        )
        assert r.status_code == 429, r.text
        assert r.headers.get("retry-after") == "60"
    finally:
        login_limiter.clear()


def test_login_lockout_429_has_retry_after(client):
    """10 fallos seguidos bloquean la cuenta 5 min: el 429 lleva
    Retry-After: 300 (LOCKOUT_SECONDS). Sin tocar el limitador de IP."""
    for _ in range(10):
        login_lockout.record_failure("a2probe")
    try:
        assert login_lockout.locked("a2probe") is True
        r = client.post(
            "/api/auth/login",
            json={"username": "a2probe", "password": "whatever123"},
        )
        assert r.status_code == 429, r.text
        assert r.headers.get("retry-after") == "300"
    finally:
        login_lockout.clear()
