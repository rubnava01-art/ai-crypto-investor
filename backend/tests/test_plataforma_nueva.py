"""Tests for the 2026-10-28 platform bundle: profile, chat en vivo,
recomendaciones and desarrollo digital. RBAC: admin CRUD, prueba
read-only — except own-profile edit and chat posting, which any
authenticated user can do. No new logins here (login is rate-limited
across the suite): reuse admin_headers / viewer_headers.
"""
import base64

TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _viewer_id(client, admin_headers):
    r = client.get("/api/users", headers=admin_headers)
    assert r.status_code == 200, r.text
    for u in r.json():
        if u["username"] == "suiteviewer":
            return u["id"]
    raise AssertionError("suiteviewer not found")


# ---------------- profile ----------------

def test_profile_me_empty_for_admin(client, admin_headers):
    r = client.get("/api/profile/me", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["username"] == "admin"
    assert body["display_name"] is None
    assert body["email"] is None
    assert body["address"] is None
    assert body["avatar_data_url"] is None


def test_profile_viewer_edits_own_profile(client, viewer_headers):
    r = client.put(
        "/api/profile/me",
        json={
            "display_name": "Viewer Prueba",
            "email": "viewer@example.com",
            "address": "Calle Falsa 123",
            "avatar_data_url": TINY_PNG,
        },
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "Viewer Prueba"
    assert body["email"] == "viewer@example.com"
    assert body["address"] == "Calle Falsa 123"
    assert body["avatar_data_url"] == TINY_PNG

    r = client.get("/api/profile/me", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "Viewer Prueba"


def test_profile_clear_fields_with_empty_string(client, viewer_headers):
    r = client.put(
        "/api/profile/me",
        json={"display_name": "", "email": "", "address": "", "avatar_data_url": ""},
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] is None
    assert body["email"] is None
    assert body["address"] is None
    assert body["avatar_data_url"] is None


def test_profile_validation_errors(client, viewer_headers):
    # Bad email
    r = client.put("/api/profile/me", json={"email": "not-an-email"}, headers=viewer_headers)
    assert r.status_code == 422, r.text
    # Non-image data URL
    r = client.put(
        "/api/profile/me",
        json={"avatar_data_url": "data:text/plain;base64,aGk="},
        headers=viewer_headers,
    )
    assert r.status_code == 422, r.text
    # Oversized avatar: 600 KiB decoded -> over the 500 KiB cap
    big = base64.b64encode(b"\x00" * (600 * 1024)).decode()
    r = client.put(
        "/api/profile/me",
        json={"avatar_data_url": f"data:image/png;base64,{big}"},
        headers=viewer_headers,
    )
    assert r.status_code == 422, r.text


def test_profile_admin_views_user_viewer_cannot(client, admin_headers, viewer_headers):
    vid = _viewer_id(client, admin_headers)
    r = client.get(f"/api/profile/users/{vid}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "suiteviewer"
    # A prueba user cannot view another user's profile through the admin route
    r = client.get("/api/profile/users/1", headers=viewer_headers)
    assert r.status_code == 403, r.text
    # Unknown user -> 404 for admin
    r = client.get("/api/profile/users/999999", headers=admin_headers)
    assert r.status_code == 404, r.text
    # No token -> 401
    r = client.get("/api/profile/me")
    assert r.status_code == 401, r.text


# ---------------- chat en vivo ----------------

def test_chat_starts_empty(client, admin_headers):
    r = client.get("/api/chat/messages", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_chat_post_list_delete(client, admin_headers, viewer_headers):
    r = client.post("/api/chat/messages", json={"text": "Hola desde la prueba"}, headers=viewer_headers)
    assert r.status_code == 201, r.text
    msg_id = r.json()["id"]
    assert r.json()["author_username"] == "suiteviewer"
    assert r.json()["text"] == "Hola desde la prueba"

    r = client.get("/api/chat/messages", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(m["id"] == msg_id for m in r.json())

    # Prueba cannot delete (moderation is admin-only)
    r = client.delete(f"/api/chat/messages/{msg_id}", headers=viewer_headers)
    assert r.status_code == 403, r.text
    # Admin deletes
    r = client.delete(f"/api/chat/messages/{msg_id}", headers=admin_headers)
    assert r.status_code == 204, r.text
    r = client.get("/api/chat/messages", headers=admin_headers)
    assert all(m["id"] != msg_id for m in r.json())


def test_chat_validation_and_auth(client, viewer_headers):
    r = client.post("/api/chat/messages", json={"text": "   "}, headers=viewer_headers)
    assert r.status_code == 422, r.text
    r = client.post("/api/chat/messages", json={"text": "x" * 501}, headers=viewer_headers)
    assert r.status_code == 422, r.text
    r = client.post("/api/chat/messages", json={"text": "sin token"})
    assert r.status_code == 401, r.text


# ---------------- recomendaciones ----------------

def test_recomendaciones_crud_and_rbac(client, admin_headers, viewer_headers):
    r = client.get("/api/recomendaciones", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json() == []

    # Prueba cannot create
    r = client.post(
        "/api/recomendaciones",
        json={"title": "Curso X", "category": "curso"},
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text

    # Bad category / bad url
    r = client.post(
        "/api/recomendaciones",
        json={"title": "Malo", "category": "otro"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    r = client.post(
        "/api/recomendaciones",
        json={"title": "Malo", "category": "curso", "url": "ftp://x"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text

    r = client.post(
        "/api/recomendaciones",
        json={
            "title": "Curso recomendado",
            "description": "Para aprender",
            "url": "https://example.com/curso",
            "category": "curso",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    rec_id = r.json()["id"]

    r = client.put(
        f"/api/recomendaciones/{rec_id}",
        json={"category": "herramienta"},
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text
    r = client.put(
        f"/api/recomendaciones/{rec_id}",
        json={"category": "herramienta"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["category"] == "herramienta"

    r = client.get("/api/recomendaciones", headers=viewer_headers)
    assert any(x["id"] == rec_id for x in r.json())

    r = client.delete(f"/api/recomendaciones/{rec_id}", headers=admin_headers)
    assert r.status_code == 204, r.text
    r = client.delete(f"/api/recomendaciones/{rec_id}", headers=admin_headers)
    assert r.status_code == 404, r.text


# ---------------- desarrollo digital ----------------

def test_desarrollo_projects_tasks_and_rbac(client, admin_headers, viewer_headers):
    r = client.get("/api/desarrollo/projects", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json() == []

    # Prueba cannot create
    r = client.post(
        "/api/desarrollo/projects",
        json={"title": "Proyecto X"},
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text

    # Unknown contact -> 404
    r = client.post(
        "/api/desarrollo/projects",
        json={"title": "Proyecto X", "contact_id": 999999},
        headers=admin_headers,
    )
    assert r.status_code == 404, r.text

    # Bad stage -> 422
    r = client.post(
        "/api/desarrollo/projects",
        json={"title": "Proyecto X", "stage": "terminado"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text

    # Create a CRM contact, then a project linked to it
    r = client.post(
        "/api/crm/contacts",
        json={"name": "Empresa Prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    contact_id = r.json()["id"]

    r = client.post(
        "/api/desarrollo/projects",
        json={"title": "Adaptación digital", "contact_id": contact_id, "stage": "diagnostico"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["contact_name"] == "Empresa Prueba"
    assert project["stage"] == "diagnostico"
    pid = project["id"]

    # Tasks: viewer cannot create, admin can; toggle done
    r = client.post(
        f"/api/desarrollo/projects/{pid}/tasks",
        json={"title": "Tarea 1"},
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text
    r = client.post(
        f"/api/desarrollo/projects/{pid}/tasks",
        json={"title": "Tarea 1"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    r = client.patch(
        f"/api/desarrollo/tasks/{tid}",
        json={"done": True},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["done"] is True

    r = client.get(f"/api/desarrollo/projects/{pid}/tasks", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1

    # Stage advance + contact clear
    r = client.put(
        f"/api/desarrollo/projects/{pid}",
        json={"stage": "desarrollo", "clear_contact": True},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "desarrollo"
    assert r.json()["contact_id"] is None

    # Deleting the project deletes its tasks
    r = client.delete(f"/api/desarrollo/projects/{pid}", headers=admin_headers)
    assert r.status_code == 204, r.text
    r = client.get(f"/api/desarrollo/projects/{pid}/tasks", headers=admin_headers)
    assert r.status_code == 404, r.text
