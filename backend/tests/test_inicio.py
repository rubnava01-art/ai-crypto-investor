"""Tests for the Inicio (Home) module (2026-10-29).

Covers: auth (401 without token), RBAC (prueba reads and comments,
admin-only post publish/edit/delete -> 403), comment delete rules
(author or admin only), validation (blank title/body -> 422),
comment ordering, and post delete removing its comments.
Uses the shared session fixtures only (no extra logins: the login
endpoint is rate-limited across the suite).
"""


def test_inicio_requires_auth(client):
    r = client.get("/api/inicio/posts")
    assert r.status_code == 401
    r = client.post("/api/inicio/posts/1/comments", json={"body": "Hola"})
    assert r.status_code == 401


def test_inicio_posts_and_comments(client, viewer_headers, admin_headers):
    r = client.get("/api/inicio/posts", headers=viewer_headers)
    assert r.status_code == 200
    assert r.json() == []

    # Prueba cannot publish posts.
    r = client.post(
        "/api/inicio/posts",
        json={"title": "Intento", "body": "No debe pasar"},
        headers=viewer_headers,
    )
    assert r.status_code == 403

    # Blank title rejected.
    r = client.post(
        "/api/inicio/posts",
        json={"title": "   ", "body": "Sin título"},
        headers=admin_headers,
    )
    assert r.status_code == 422

    # Admin publishes.
    r = client.post(
        "/api/inicio/posts",
        json={"title": "Novedad de prueba", "body": "Contenido de prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    post = r.json()
    post_id = post["id"]
    assert post["title"] == "Novedad de prueba"
    assert post["comment_count"] == 0
    assert post["author_name"] == "admin"

    # Comment on a missing post -> 404.
    r = client.post(
        "/api/inicio/posts/999999/comments",
        json={"body": "Hola"},
        headers=viewer_headers,
    )
    assert r.status_code == 404

    # Blank comment rejected.
    r = client.post(
        f"/api/inicio/posts/{post_id}/comments",
        json={"body": "   "},
        headers=viewer_headers,
    )
    assert r.status_code == 422

    # Viewer comments (own comment deletable by viewer).
    r = client.post(
        f"/api/inicio/posts/{post_id}/comments",
        json={"body": "Primer comentario"},
        headers=viewer_headers,
    )
    assert r.status_code == 201, r.text
    viewer_comment = r.json()
    assert viewer_comment["can_delete"] is True

    # Admin comments.
    r = client.post(
        f"/api/inicio/posts/{post_id}/comments",
        json={"body": "Respuesta del admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    admin_comment = r.json()

    # Comments listed oldest first; viewer cannot delete admin's.
    r = client.get(f"/api/inicio/posts/{post_id}/comments", headers=viewer_headers)
    assert r.status_code == 200
    comments = r.json()
    assert [c["body"] for c in comments] == ["Primer comentario", "Respuesta del admin"]
    assert comments[1]["can_delete"] is False
    r = client.delete(f"/api/inicio/comments/{admin_comment['id']}", headers=viewer_headers)
    assert r.status_code == 403

    # Viewer deletes own comment; admin deletes the post.
    r = client.delete(f"/api/inicio/comments/{viewer_comment['id']}", headers=viewer_headers)
    assert r.status_code == 204
    r = client.put(
        f"/api/inicio/posts/{post_id}",
        json={"title": "Intento de prueba"},
        headers=viewer_headers,
    )
    assert r.status_code == 403
    r = client.put(
        f"/api/inicio/posts/{post_id}",
        json={"title": "Novedad editada"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Novedad editada"
    r = client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)
    assert r.status_code == 204

    # Post gone, and its comments with it.
    r = client.get("/api/inicio/posts", headers=viewer_headers)
    assert r.json() == []
    r = client.get(f"/api/inicio/posts/{post_id}/comments", headers=viewer_headers)
    assert r.status_code == 404
