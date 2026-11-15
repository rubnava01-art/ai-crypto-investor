"""Tests de regresión — corrida 3 agentes 2026-11-14 (Agente 3, backend).

Fijan el veredicto de la auditoría: ningún endpoint de mercado es público.
Si en el futuro se abre uno (p. ej. /api/public/ticker), estos tests deberán
actualizarse conscientemente; no deben pasar en silencio con un 200 nuevo.

Solo usa el fixture compartido `client`; no crea nada en la BD ni consume
presupuesto de login (límite 10/min por IP en toda la suite).
"""

from jose import jwt as jose_jwt

from app.ai.api import ai_limiter
from app.api.analizador import analizador_limiter
from app.api.auditor import auditor_limiter
from app.api.backtest import backtest_limiter
from app.api.correos import correos_limiter
from app.api.crear import gen_limiter
from app.api.strategy import strategy_limiter
from app.api.tendencias import tendencias_limiter


def test_market_ticker_requires_auth(client):
    r = client.get("/api/market/ticker?symbol=BTC/USD")
    assert r.status_code == 401, r.text


def test_market_prices_requires_auth(client):
    r = client.get("/api/market/prices")
    assert r.status_code == 401, r.text


def test_market_candles_requires_auth(client):
    r = client.get("/api/market/candles?symbol=BTC/USD&timeframe=1h")
    assert r.status_code == 401, r.text


def test_market_indicators_requires_auth(client):
    r = client.get("/api/market/indicators?symbol=BTC/USD&timeframe=1h")
    assert r.status_code == 401, r.text


def test_health_is_public(client):
    """Contraste: /api/health es el único endpoint público de datos
    (estado de la BD); no exige JWT y no devuelve datos de mercado."""
    r = client.get("/api/health")
    assert r.status_code == 200, r.text
    assert "database" in r.json()


# ------------------------------------------------------------------ M-1 --
# Retry-After en los 8 endpoints con 429 que no lo llevaban (mercado y
# login ya lo tenían desde el lote 2026-11-13). Patrón: pre-llenar el
# limiter con allow() — como test_login_limiter_429_has_retry_after —
# y hacer UNA sola llamada HTTP. Así no se ejecutan N veces los
# endpoints (algunos hacen fetch saliente o escriben filas) y el 429
# salta antes de cualquier trabajo: estos tests no crean nada en la BD.
# Cada limiter se vacía antes y después: la suite comparte un único
# proceso y un test de ráfaga no debe bloquear los demás.


def _user_id_from_headers(headers):
    """Id del usuario del token compartido, sin verificar la firma:
    solo se usa para construir la clave del limiter (strategy:<id>...).
    El endpoint valida el token de verdad al recibir la llamada."""
    token = headers["Authorization"].split(" ", 1)[1]
    return jose_jwt.get_unverified_claims(token)["user_id"]


def _fill(limiter, key):
    for _ in range(limiter.max_requests):
        limiter.allow(key)


def _assert_retry_after_60(response):
    assert response.status_code == 429, response.text
    assert response.headers.get("retry-after") == "60", response.headers


def test_strategy_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    strategy_limiter.clear()
    try:
        _fill(strategy_limiter, f"strategy:{uid}")
        r = client.post(
            "/api/strategy/evaluate?symbol=BTC/USD&timeframe=1h",
            headers=admin_headers,
        )
        _assert_retry_after_60(r)
    finally:
        strategy_limiter.clear()


def test_backtest_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    backtest_limiter.clear()
    try:
        _fill(backtest_limiter, f"backtest:{uid}")
        r = client.post(
            "/api/backtest/run?symbol=BTC/USD&timeframe=1h",
            headers=admin_headers,
        )
        _assert_retry_after_60(r)
    finally:
        backtest_limiter.clear()


def test_correos_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    correos_limiter.clear()
    try:
        _fill(correos_limiter, f"correos:{uid}")
        r = client.get("/api/correos/templates", headers=admin_headers)
        _assert_retry_after_60(r)
    finally:
        correos_limiter.clear()


def test_tendencias_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    tendencias_limiter.clear()
    try:
        _fill(tendencias_limiter, f"tendencias:{uid}")
        r = client.get(
            "/api/tendencias/research?keyword=bitcoin", headers=admin_headers
        )
        _assert_retry_after_60(r)
    finally:
        tendencias_limiter.clear()


def test_auditor_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    auditor_limiter.clear()
    try:
        _fill(auditor_limiter, f"auditor:{uid}")
        r = client.post(
            "/api/auditor/audits",
            json={"url": "https://example.com"},
            headers=admin_headers,
        )
        _assert_retry_after_60(r)
    finally:
        auditor_limiter.clear()


def test_analizador_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    analizador_limiter.clear()
    try:
        _fill(analizador_limiter, f"analizador:{uid}")
        r = client.post(
            "/api/analizador/analizar",
            json={"url": "https://example.com"},
            headers=admin_headers,
        )
        _assert_retry_after_60(r)
    finally:
        analizador_limiter.clear()


def test_crear_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    gen_limiter.clear()
    try:
        # TestClient presenta client.host == "testclient", igual que
        # la clave del endpoint (crear_gen:<id>:<ip>).
        _fill(gen_limiter, f"crear_gen:{uid}:testclient")
        r = client.post(
            "/api/crear/copies/generate",
            json={"topic": "prueba", "platform": "instagram", "tone": "directo"},
            headers=admin_headers,
        )
        _assert_retry_after_60(r)
    finally:
        gen_limiter.clear()


def test_ai_ask_429_has_retry_after(client, admin_headers):
    uid = _user_id_from_headers(admin_headers)
    ai_limiter.clear()
    try:
        _fill(ai_limiter, f"ai_ask:{uid}:testclient")
        r = client.post(
            "/api/ai/ask", json={"question": "hola"}, headers=admin_headers
        )
        _assert_retry_after_60(r)
    finally:
        ai_limiter.clear()


# ------------------------------------------------- Guía ChatGPT (Nov 2026) --
# Free guide PDF added to the /estudiar catalog (AcademyPanel, API-driven).
# Title + description are the PDF's real title/subtitle; price 0.00 and no
# buy URL because none was provided. Kind "guia" (not "ebook") on purpose:
# EBOOK_SLUGS feeds the Pack, which must stay exactly the 6 manuals.


def _course_by_slug(client, h, slug):
    courses = client.get("/api/academy/courses", headers=h).json()
    assert courses, "catalog must be seeded"
    return next(c for c in courses if c["slug"] == slug)


def test_guia_prompts_visuales_in_catalog(client, admin_headers):
    g = _course_by_slug(client, admin_headers, "guia-comandos-prompts-visuales")
    assert g["title"] == "Guía de Comandos y Prompts Visuales"
    assert g["kind"] == "guia"
    assert g["price_usd"] == "0.00"
    assert g["buy_url"] == ""
    assert len(g["downloads"]) == 1
    assert g["downloads"][0]["filename"] == "guia-comandos-prompts-visuales-chatgpt.pdf"
    assert g["downloads"][0]["course_id"] == g["id"]


def test_guia_kind_is_valid_for_put(client, admin_headers):
    # M-1 (QA): the seeded kind "guia" must also be valid on the admin PUT
    # route (_check_kind), otherwise the new guide cannot be edited by API.
    g = _course_by_slug(client, admin_headers, "guia-comandos-prompts-visuales")
    r = client.put(f"/api/academy/courses/{g['id']}", json={"kind": "guia"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "guia"
    # unknown kinds are still rejected
    assert client.put(
        f"/api/academy/courses/{g['id']}", json={"kind": "revista"}, headers=admin_headers
    ).status_code == 422


def test_guia_prompts_visuales_pdf_downloads(client, admin_headers, viewer_headers):
    g = _course_by_slug(client, admin_headers, "guia-comandos-prompts-visuales")
    for h in (admin_headers, viewer_headers):
        r = client.get(f"/api/academy/courses/{g['id']}/download", headers=h)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 40_000  # the real 7-page guide (44,574 B)


def test_pack_still_exactly_six_manuals(client, admin_headers):
    pack = _course_by_slug(client, admin_headers, "pack-creador-completo")
    assert len(pack["downloads"]) == 6
    assert {d["filename"] for d in pack["downloads"]} == {
        "manual-ia-emprendedores.pdf",
        "manual-claude.pdf",
        "manual-marketing-2027.pdf",
        "whatsapp-vende.pdf",
        "sistema-contenido-ia.pdf",
        "marca-personal-rentable.pdf",
    }
