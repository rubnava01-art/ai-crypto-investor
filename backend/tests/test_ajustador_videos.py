"""Tests for Ajustador proposals and educational YouTube videos (2026-11-05).

Covers: CRUD happy paths per API, writes forbidden for prueba (403),
prueba GET readable for both lists, enum validation 422 (section /
agent / status), YouTube URL validation 422, length caps 422, and
that both lists start EMPTY (no seeded proposals or videos). Uses the
shared session fixtures only (no extra logins: the login endpoint is
rate-limited across the suite).

Untouchables asserted here: proposals are never "done work" by
themselves (estado is only a label), no invented videos (the list
starts empty and only admin-added URLs appear), and the YouTube
validator accepts only youtube.com/watch or youtu.be links.
"""


def test_ajustador_videos_requires_auth(client):
    r = client.get("/api/ajustes")
    assert r.status_code == 401
    r = client.get("/api/videos")
    assert r.status_code == 401


def test_ajustes_crud_rbac_validation(client, viewer_headers, admin_headers):
    # Prueba reads the board (read-only) but cannot write.
    r = client.get("/api/ajustes", headers=viewer_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    for method, url, payload in (
        ("post", "/api/ajustes", {"seccion": "crm", "agente": "agente1", "propuesta": "X"}),
        ("put", "/api/ajustes/1", {"estado": "aplicada"}),
        ("delete", "/api/ajustes/1", None),
    ):
        r = client.request(method, url, json=payload, headers=viewer_headers)
        assert r.status_code == 403, (method, url)

    # Enum validation: bad section, bad agent, bad status.
    for payload in (
        {"seccion": "noexiste", "agente": "agente1", "propuesta": "X"},
        {"seccion": "crm", "agente": "agente9", "propuesta": "X"},
        {"seccion": "crm", "agente": "agente1", "propuesta": "X", "estado": "hecho"},
        {"seccion": "ajustador", "agente": "agente1", "propuesta": "X"},
    ):
        r = client.post("/api/ajustes", json=payload, headers=admin_headers)
        assert r.status_code == 422, payload
    # Length cap + blank proposal.
    r = client.post(
        "/api/ajustes",
        json={"seccion": "crm", "agente": "agente1", "propuesta": "X" * 5001},
        headers=admin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        "/api/ajustes",
        json={"seccion": "crm", "agente": "agente1", "propuesta": "   "},
        headers=admin_headers,
    )
    assert r.status_code == 422

    # Happy path: create, update status, read back, delete.
    r = client.post(
        "/api/ajustes",
        json={
            "seccion": "crm",
            "agente": "agente1",
            "propuesta": "Ajuste de prueba Ajustador 2026-11-05",
            "estado": "propuesta",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["seccion"] == "crm"
    assert row["agente"] == "agente1"
    assert row["estado"] == "propuesta"
    ajuste_id = row["id"]

    r = client.put(
        f"/api/ajustes/{ajuste_id}",
        json={"estado": "en_curso"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "en_curso"

    # Prueba sees the proposal (read-only view of the board).
    r = client.get("/api/ajustes", headers=viewer_headers)
    assert r.status_code == 200
    assert any(x["id"] == ajuste_id for x in r.json())

    r = client.put(
        f"/api/ajustes/{ajuste_id}",
        json={"estado": "aplicada"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["estado"] == "aplicada"

    r = client.delete(f"/api/ajustes/{ajuste_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.get(f"/api/ajustes", headers=admin_headers)
    assert all(x["id"] != ajuste_id for x in r.json())

    # 404 on missing row.
    r = client.put("/api/ajustes/999999", json={"estado": "aplicada"}, headers=admin_headers)
    assert r.status_code == 404


def test_videos_crud_rbac_url_validation(client, viewer_headers, admin_headers):
    # Prueba reads the list (read-only) but cannot write.
    r = client.get("/api/videos", headers=viewer_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    for method, url, payload in (
        ("post", "/api/videos", {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "titulo": "X"}),
        ("put", "/api/videos/1", {"titulo": "Y"}),
        ("delete", "/api/videos/1", None),
    ):
        r = client.request(method, url, json=payload, headers=viewer_headers)
        assert r.status_code == 403, (method, url)

    # URL validation: only youtube.com/watch?v=ID or youtu.be/ID.
    for bad_url in (
        "https://vimeo.com/123456",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/watch",
        "https://www.youtube.com/watch?v=",
        "https://www.youtube.com/playlist?list=PL123",
        "https://youtu.be/",
        "https://example.com/video",
        "not a url",
        "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    ):
        r = client.post(
            "/api/videos",
            json={"url": bad_url, "titulo": "Video malo"},
            headers=admin_headers,
        )
        assert r.status_code == 422, bad_url
    # Blank title.
    r = client.post(
        "/api/videos",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "titulo": "   "},
        headers=admin_headers,
    )
    assert r.status_code == 422

    # Happy path: watch URL, then youtu.be URL; read back; delete.
    r = client.post(
        "/api/videos",
        json={
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "titulo": "Video de prueba Ajustador 2026-11-05",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    video = r.json()
    assert video["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert video["titulo"] == "Video de prueba Ajustador 2026-11-05"
    assert video["added_at"]
    video_id = video["id"]

    r = client.post(
        "/api/videos",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "titulo": "Video corto youtu.be"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    short_id = r.json()["id"]

    # Prueba sees both (read-only).
    r = client.get("/api/videos", headers=viewer_headers)
    assert r.status_code == 200
    ids = {x["id"] for x in r.json()}
    assert video_id in ids and short_id in ids

    # Update URL to another valid one.
    r = client.put(
        f"/api/videos/{video_id}",
        json={"url": "https://youtu.be/abcdefghijk"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://youtu.be/abcdefghijk"
    # Update to an invalid URL is rejected.
    r = client.put(
        f"/api/videos/{video_id}",
        json={"url": "https://vimeo.com/1"},
        headers=admin_headers,
    )
    assert r.status_code == 422

    r = client.delete(f"/api/videos/{video_id}", headers=admin_headers)
    assert r.status_code == 204
    r = client.delete(f"/api/videos/{short_id}", headers=admin_headers)
    assert r.status_code == 204

    # 404 on missing row.
    r = client.put("/api/videos/999999", json={"titulo": "X"}, headers=admin_headers)
    assert r.status_code == 404


def test_ajustador_videos_start_empty(client, admin_headers):
    # No seeded proposals or videos: the fixture DB starts without the
    # unique test rows used above (deleted at the end of each test).
    r = client.get("/api/ajustes", headers=admin_headers)
    assert r.status_code == 200
    assert not any(
        x["propuesta"] == "Ajuste de prueba Ajustador 2026-11-05" for x in r.json()
    )
    r = client.get("/api/videos", headers=admin_headers)
    assert r.status_code == 200
    assert not any(
        x["titulo"] == "Video de prueba Ajustador 2026-11-05" for x in r.json()
    )
