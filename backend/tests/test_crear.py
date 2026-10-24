"""Crear tests (Plataforma Unificada — Fase 3): generador de copies con la
capa IA existente (en tests corre el stub -> demo=True) y panel de
tendencias sembrado solo con temas reales ya publicados en Threads.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited (10/min across the
whole suite), so modules must not log in on their own."""


def test_generate_copy_demo_and_persist(client, admin_headers):
    r = client.post(
        "/api/crear/copies/generate",
        json={"topic": "Lanzamiento de la Academia", "platform": "instagram", "tone": "directo"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    draft = r.json()
    assert draft["topic"] == "Lanzamiento de la Academia"
    assert draft["platform"] == "instagram"
    assert draft["tone"] == "directo"
    assert draft["text"]  # the stub always produces text
    # No real AI provider is configured in tests -> must be flagged demo.
    assert draft["demo"] is True
    did = draft["id"]

    r = client.get("/api/crear/copies", headers=admin_headers)
    assert r.status_code == 200
    assert any(d["id"] == did for d in r.json())

    assert client.delete(f"/api/crear/copies/{did}", headers=admin_headers).status_code == 204
    r = client.get("/api/crear/copies", headers=admin_headers)
    assert all(d["id"] != did for d in r.json())
    assert client.delete(f"/api/crear/copies/{did}", headers=admin_headers).status_code == 404


def test_generate_copy_validation(client, admin_headers):
    assert client.post(
        "/api/crear/copies/generate",
        json={"topic": "Algo", "platform": "tiktok"},
        headers=admin_headers,
    ).status_code == 422
    assert client.post(
        "/api/crear/copies/generate",
        json={"topic": "Algo", "tone": "gritón"},
        headers=admin_headers,
    ).status_code == 422
    assert client.post(
        "/api/crear/copies/generate",
        json={"topic": ""},
        headers=admin_headers,
    ).status_code == 422


def test_crear_requires_auth(client):
    assert client.get("/api/crear/copies").status_code == 401
    assert client.post("/api/crear/copies/generate", json={"topic": "X"}).status_code == 401
    assert client.get("/api/crear/trends").status_code == 401
    assert client.post("/api/crear/trends", json={"title": "X"}).status_code == 401


def test_crear_viewer_read_only(client, admin_headers, viewer_headers):
    # a draft created by admin
    r = client.post(
        "/api/crear/copies/generate",
        json={"topic": "Copy solo lectura", "platform": "threads", "tone": "educativo"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    # a trend note created by admin
    r = client.post(
        "/api/crear/trends",
        json={"title": "Tendencia solo lectura fase 3", "source": "manual", "summary": "x", "published_on": "2026-10-23"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]

    hv = viewer_headers
    # can read both
    r = client.get("/api/crear/copies", headers=hv)
    assert r.status_code == 200 and any(d["id"] == did for d in r.json())
    r = client.get("/api/crear/trends", headers=hv)
    assert r.status_code == 200 and any(t["id"] == tid for t in r.json())
    # cannot write
    assert client.post("/api/crear/copies/generate", json={"topic": "X"}, headers=hv).status_code == 403
    assert client.delete(f"/api/crear/copies/{did}", headers=hv).status_code == 403
    assert client.post("/api/crear/trends", json={"title": "X"}, headers=hv).status_code == 403
    assert client.delete(f"/api/crear/trends/{tid}", headers=hv).status_code == 403


def test_trends_seeded_real_published_topics(client, admin_headers):
    r = client.get("/api/crear/trends", headers=admin_headers)
    assert r.status_code == 200, r.text
    trends = r.json()
    assert len(trends) >= 16
    titles = {t["title"] for t in trends}
    # Real topics published 2026-10-21..23 (per used-posts.txt).
    assert "Airbus A350 VMU tail-strike" in titles
    assert "Autos voladores Alef vs Tesla" in titles
    by_title = {t["title"]: t for t in trends}
    assert by_title["Airbus A350 VMU tail-strike"]["published_on"] == "2026-10-21"
    assert by_title["Autos voladores Alef vs Tesla"]["published_on"] == "2026-10-22"
    # Every seeded note (from the module's real published list) carries the source.
    from app.api.crear import PUBLISHED_TRENDS

    for title, _day in PUBLISHED_TRENDS:
        assert title in by_title, title
        assert by_title[title]["source"] == "@tecnologia vía Threads @rubenpromkt"


def test_trends_admin_crud(client, admin_headers):
    r = client.post(
        "/api/crear/trends",
        json={"title": "Tendencia de prueba fase 3", "source": "investigación propia", "summary": "Resumen de prueba.", "published_on": "2026-10-23"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    note = r.json()
    assert note["title"] == "Tendencia de prueba fase 3"
    assert note["published_on"] == "2026-10-23"
    tid = note["id"]

    # invalid date -> 422
    assert client.post(
        "/api/crear/trends",
        json={"title": "X", "published_on": "23/10/2026"},
        headers=admin_headers,
    ).status_code == 422

    assert client.delete(f"/api/crear/trends/{tid}", headers=admin_headers).status_code == 204
    assert client.delete(f"/api/crear/trends/{tid}", headers=admin_headers).status_code == 404
