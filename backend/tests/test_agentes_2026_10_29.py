"""Tests de la corrida 3 agentes (2026-10-29, coordinador ejecuta directo).

Cubre: fail-closed de secretos en producción, borrado de post que limpia
sus comentarios, low_stock sin mínimo definido, max_length en body de
post y descripción de inventario, avatar con magic bytes, paginación de
posts, caché de ticker, handlers globales 409/500 y el limitador en sí.
No hace logins extra (usa los fixtures compartidos) y limpia todo lo que
crea, porque la suite comparte una sola BD de pruebas.
"""
import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.api import market as market_mod
from app.config import Settings, assert_production_secrets
from app.database import get_db
from app.main import create_app
from app.models.tables import HomeComment


# ---------- B1: fail-closed de secretos en producción ----------

def test_fail_closed_no_actua_en_desarrollo():
    assert_production_secrets(Settings(environment="development"))


def test_fail_closed_rechaza_secreto_por_defecto_en_produccion():
    default_secret = Settings.model_fields["jwt_secret_key"].default
    with pytest.raises(RuntimeError):
        assert_production_secrets(
            Settings(
                environment="production",
                jwt_secret_key=default_secret,
                admin_password_hash="",
            )
        )


def test_fail_closed_rechaza_hash_admin_vacio_en_produccion():
    with pytest.raises(RuntimeError):
        assert_production_secrets(
            Settings(
                environment="production",
                jwt_secret_key="x" * 40,
                admin_password_hash="",
            )
        )


def test_fail_closed_acepta_secretos_reales_en_produccion():
    assert_production_secrets(
        Settings(
            environment="production",
            jwt_secret_key="z" * 40,
            admin_password_hash="$2b$12$hashdeprueba",
        )
    )


def test_fail_closed_actua_con_render_true(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    default_secret = Settings.model_fields["jwt_secret_key"].default
    with pytest.raises(RuntimeError):
        assert_production_secrets(
            Settings(jwt_secret_key=default_secret, admin_password_hash="")
        )


# ---------- B6: borrar post borra sus comentarios ----------

def test_inicio_delete_post_removes_comments(client, admin_headers, viewer_headers, app):
    r = client.post(
        "/api/inicio/posts",
        json={"title": "Post a borrar", "body": "cuerpo"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    post_id = r.json()["id"]
    r = client.post(
        f"/api/inicio/posts/{post_id}/comments",
        json={"body": "comentario huérfano si no se borra"},
        headers=viewer_headers,
    )
    assert r.status_code == 201, r.text
    r = client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)
    assert r.status_code == 204, r.text
    # El post ya no existe…
    r = client.get(f"/api/inicio/posts/{post_id}/comments", headers=admin_headers)
    assert r.status_code == 404
    # …y sus comentarios tampoco (misma BD de pruebas que la app).
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        assert db.query(HomeComment).filter(HomeComment.post_id == post_id).count() == 0
    finally:
        gen.close()


# ---------- B8: low_stock sin mínimo definido ----------

def test_inventario_low_stock_sin_minimo(client, admin_headers):
    ids = []
    try:
        cases = [
            ({"name": "AG-SinMin", "quantity": 0, "min_stock": 0}, False),
            ({"name": "AG-Bajo", "quantity": 5, "min_stock": 10}, True),
            ({"name": "AG-Justo", "quantity": 10, "min_stock": 10}, True),
            ({"name": "AG-Bien", "quantity": 11, "min_stock": 10}, False),
        ]
        for payload, expected in cases:
            r = client.post("/api/inventario/items", json=payload, headers=admin_headers)
            assert r.status_code == 201, r.text
            ids.append(r.json()["id"])
            assert r.json()["low_stock"] is expected, payload
    finally:
        for item_id in ids:
            client.delete(f"/api/inventario/items/{item_id}", headers=admin_headers)


# ---------- B7: max_length ----------

def test_inicio_post_body_demasiado_largo(client, admin_headers):
    r = client.post(
        "/api/inicio/posts",
        json={"title": "Largo", "body": "x" * 10001},
        headers=admin_headers,
    )
    assert r.status_code == 422


def test_inventario_descripcion_demasiado_larga(client, admin_headers):
    r = client.post(
        "/api/inventario/items",
        json={"name": "AG-Largo", "description": "x" * 2001},
        headers=admin_headers,
    )
    assert r.status_code == 422


# ---------- B9: avatar con magic bytes ----------

def test_perfil_avatar_mime_declarado_sin_contenido_real(client, admin_headers):
    import base64

    fake = base64.b64encode(b"esto-no-es-una-imagen").decode()
    r = client.put(
        "/api/profile/me",
        json={"avatar_data_url": f"data:image/png;base64,{fake}"},
        headers=admin_headers,
    )
    assert r.status_code == 422


# ---------- B2: paginación de posts ----------

def test_inicio_posts_paginacion(client, admin_headers):
    r = client.get("/api/inicio/posts", headers=admin_headers)
    assert r.status_code == 200
    initial = len(r.json())
    ids = []
    try:
        for i in range(3):
            r = client.post(
                "/api/inicio/posts",
                json={"title": f"AG-Pag-{i}", "body": "paginación"},
                headers=admin_headers,
            )
            assert r.status_code == 201, r.text
            ids.append(r.json()["id"])
        r = client.get("/api/inicio/posts?limit=2", headers=admin_headers)
        assert r.status_code == 200
        assert len(r.json()) == 2
        r = client.get("/api/inicio/posts?limit=100", headers=admin_headers)
        assert len(r.json()) == initial + 3
        # Los 3 nuevos son los más recientes: con offset=2, el primero es
        # el más antiguo de los 3 (AG-Pag-0).
        r = client.get("/api/inicio/posts?offset=2&limit=100", headers=admin_headers)
        assert r.json()[0]["title"] == "AG-Pag-0"
    finally:
        for post_id in ids:
            client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)


# ---------- B4: caché de ticker ----------

def test_market_ticker_cache(monkeypatch, client, viewer_headers):
    calls = {"n": 0}

    def fake_fetch(exchange, symbol):
        calls["n"] += 1
        return {"last": 42424.0}

    monkeypatch.setattr(market_mod.exchanges, "fetch_ticker", fake_fetch)
    try:
        r = client.get("/api/market/ticker?symbol=BTC/USD", headers=viewer_headers)
        assert r.status_code == 200, r.text
        assert r.json()["last"] == "42424.0"
        assert r.json()["stale"] is False
        r = client.get("/api/market/ticker?symbol=BTC/USD", headers=viewer_headers)
        assert r.status_code == 200
        assert calls["n"] == 1, "la segunda llamada debe servirse de caché"
    finally:
        market_mod._TICKER_CACHE.clear()


# ---------- B6: handlers globales ----------

def test_handlers_globales_409_y_500():
    test_app = create_app()

    @test_app.get("/_boom-integrity")
    def boom_integrity():
        raise IntegrityError("stmt", {}, Exception("orig"))

    @test_app.get("/_boom")
    def boom():
        raise RuntimeError("boom")

    # ServerErrorMiddleware siempre re-lanza tras responder (diseño de
    # Starlette: así el servidor registra el error); con
    # raise_server_exceptions=False el TestClient devuelve la respuesta 500
    # generada por el handler, que es lo que vería un cliente real.
    c = TestClient(test_app, raise_server_exceptions=False)
    r = c.get("/_boom-integrity")
    assert r.status_code == 409
    assert "traceback" not in r.text.lower()
    r = c.get("/_boom")
    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == "Error interno del servidor."
    assert body["error_id"]
    assert "traceback" not in r.text.lower()


# ---------- B5: el limitador en sí (sin agotar los globales de la suite) ----------

def test_rate_limiter_unidad():
    from app.core.rate_limit import RateLimiter

    lim = RateLimiter(max_requests=2, window_seconds=60)
    assert lim.allow("k") is True
    assert lim.allow("k") is True
    assert lim.allow("k") is False
    assert lim.allow("otra") is True


# ---------- B10: challenge con números 10-99 ----------

def test_register_challenge_rango_amplio(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    m = re.search(r"(\d+) \+ (\d+)", r.json()["question"])
    assert m, r.json()
    assert 10 <= int(m.group(1)) <= 99
    assert 10 <= int(m.group(2)) <= 99
