"""Academia tests (Plataforma Unificada — Fase 2, módulo Estudiar):
catálogo real sembrado, permisos RBAC (prueba lee, admin escribe) y
registro de entrega contacto↔curso.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited (10/min across the
whole suite), so modules must not log in on their own."""


def _make_contact(client, h, name="Alumno Academia"):
    r = client.post(
        "/api/crm/contacts",
        json={"name": name, "email": "alumno@academia.test", "source": "academia", "status": "nuevo"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_academy_catalog_seeded_real_products(client, admin_headers):
    h = admin_headers
    r = client.get("/api/academy/courses", headers=h)
    assert r.status_code == 200, r.text
    courses = r.json()
    assert len(courses) == 8
    by_slug = {c["slug"]: c for c in courses}

    # The 6 documented Hotmart ebooks.
    ebooks = [c for c in courses if c["kind"] == "ebook"]
    assert len(ebooks) == 6
    assert all(c["price_usd"] == "19.99" for c in ebooks)
    assert by_slug["manual-claude"]["title"] == "Manual de Muse"
    assert by_slug["manual-claude"]["buy_url"] == "https://go.hotmart.com/H107872686Y"
    assert by_slug["whatsapp-vende"]["buy_url"] == "https://go.hotmart.com/R107890527U"

    pack = by_slug["pack-creador-completo"]
    assert pack["kind"] == "pack"
    assert pack["price_usd"] == "59.99"
    assert pack["buy_url"] == "https://go.hotmart.com/D107932748G"

    aca = by_slug["academia-habilidades-negocio"]
    assert aca["kind"] == "academia"
    assert aca["price_usd"] == "400.00"
    assert aca["buy_url"] == "https://py.pl/DmZD4WMDLU2VkraMHHo4kg"
    assert "square.link/u/ewarbJoj" in aca["delivery_note"]
    assert all(c["students_count"] == 0 for c in courses)


def test_academy_requires_auth(client):
    assert client.get("/api/academy/courses").status_code == 401
    assert client.post("/api/academy/enrollments", json={"contact_id": 1, "course_id": 1}).status_code == 401


def test_academy_course_edit_permissions(client, admin_headers, viewer_headers):
    h = admin_headers
    courses = client.get("/api/academy/courses", headers=h).json()
    cid = courses[0]["id"]

    hv = viewer_headers
    # prueba can read but not edit
    assert client.get("/api/academy/courses", headers=hv).status_code == 200
    assert client.put(f"/api/academy/courses/{cid}", json={"title": "Nope"}, headers=hv).status_code == 403

    # admin edits; invalid kind rejected
    r = client.put(f"/api/academy/courses/{cid}", json={"delivery_note": "Nota de prueba fase 2."}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["delivery_note"] == "Nota de prueba fase 2."
    assert client.put(f"/api/academy/courses/{cid}", json={"kind": "revista"}, headers=h).status_code == 422
    assert client.put(f"/api/academy/courses/{cid}", json={"price_usd": "abc"}, headers=h).status_code == 422
    assert client.put("/api/academy/courses/999999", json={"title": "X"}, headers=h).status_code == 404
    # restore
    client.put(f"/api/academy/courses/{cid}", json={"delivery_note": "Entrega digital vía Hotmart tras el pago."}, headers=h)


def test_academy_enrollment_delivery_flow(client, admin_headers):
    h = admin_headers
    contact_id = _make_contact(client, h)
    courses = client.get("/api/academy/courses", headers=h).json()
    course = next(c for c in courses if c["slug"] == "academia-habilidades-negocio")

    # register the purchase (not delivered yet)
    r = client.post(
        "/api/academy/enrollments",
        json={"contact_id": contact_id, "course_id": course["id"], "purchased": True, "delivered": False},
        headers=h,
    )
    assert r.status_code == 201, r.text
    enr = r.json()
    assert enr["contact_name"] == "Alumno Academia"
    assert enr["course_title"] == "Academia de Habilidades de Negocio"
    assert enr["purchased"] is True and enr["purchased_at"]
    assert enr["delivered"] is False and enr["delivered_at"] is None
    eid = enr["id"]

    # duplicate registration -> 409
    r = client.post(
        "/api/academy/enrollments",
        json={"contact_id": contact_id, "course_id": course["id"]},
        headers=h,
    )
    assert r.status_code == 409

    # students list of the course shows the contact; course count updated
    r = client.get(f"/api/academy/courses/{course['id']}/students", headers=h)
    assert r.status_code == 200
    assert any(s["id"] == eid for s in r.json())
    r = client.get("/api/academy/courses", headers=h)
    assert next(c for c in r.json() if c["id"] == course["id"])["students_count"] == 1

    # mark delivered -> timestamp appears
    r = client.patch(f"/api/academy/enrollments/{eid}", json={"delivered": True}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["delivered"] is True and r.json()["delivered_at"]

    # delete the delivery record
    assert client.delete(f"/api/academy/enrollments/{eid}", headers=h).status_code == 204
    assert client.patch(f"/api/academy/enrollments/{eid}", json={"delivered": True}, headers=h).status_code == 404

    # unknown contact / course -> 404
    assert client.post("/api/academy/enrollments", json={"contact_id": 999999, "course_id": course["id"]}, headers=h).status_code == 404
    assert client.post("/api/academy/enrollments", json={"contact_id": contact_id, "course_id": 999999}, headers=h).status_code == 404
    assert client.get("/api/academy/courses/999999/students", headers=h).status_code == 404


def test_academy_enrollment_viewer_read_only(client, admin_headers, viewer_headers):
    h_admin = admin_headers
    contact_id = _make_contact(client, h_admin, name="Alumno Solo Lectura")
    courses = client.get("/api/academy/courses", headers=h_admin).json()
    course_id = courses[0]["id"]
    r = client.post(
        "/api/academy/enrollments",
        json={"contact_id": contact_id, "course_id": course_id},
        headers=h_admin,
    )
    assert r.status_code == 201, r.text
    eid = r.json()["id"]

    hv = viewer_headers
    # can read students
    r = client.get(f"/api/academy/courses/{course_id}/students", headers=hv)
    assert r.status_code == 200
    assert any(s["id"] == eid for s in r.json())
    # cannot write
    assert client.post("/api/academy/enrollments", json={"contact_id": contact_id, "course_id": courses[1]["id"]}, headers=hv).status_code == 403
    assert client.patch(f"/api/academy/enrollments/{eid}", json={"delivered": True}, headers=hv).status_code == 403
    assert client.delete(f"/api/academy/enrollments/{eid}", headers=hv).status_code == 403


# --- Fase 2.5: PDFs reales en Estudiar --------------------------------------

def _course_by_slug(client, h, slug):
    courses = client.get("/api/academy/courses", headers=h).json()
    assert courses, "catalog must be seeded"
    return next(c for c in courses if c["slug"] == slug)


def test_academy_catalog_exposes_pdf_downloads(client, admin_headers):
    ebook = _course_by_slug(client, admin_headers, "manual-claude")
    assert len(ebook["downloads"]) == 1
    assert ebook["downloads"][0]["filename"] == "manual-claude.pdf"
    assert ebook["downloads"][0]["course_id"] == ebook["id"]

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

    aca = _course_by_slug(client, admin_headers, "academia-habilidades-negocio")
    assert len(aca["downloads"]) == 1
    assert aca["downloads"][0]["filename"] == "academia-curso-completo.pdf"


def test_academy_pdf_download_requires_auth(client):
    assert client.get("/api/academy/courses/1/download").status_code == 401


def test_academy_pdf_download_admin_and_viewer(client, admin_headers, viewer_headers):
    ebook = _course_by_slug(client, admin_headers, "manual-ia-emprendedores")
    for h in (admin_headers, viewer_headers):
        r = client.get(f"/api/academy/courses/{ebook['id']}/download", headers=h)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 100_000  # the real manual, not a stub

    aca = _course_by_slug(client, admin_headers, "academia-habilidades-negocio")
    r = client.get(f"/api/academy/courses/{aca['id']}/download", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.content[:4] == b"%PDF"


def test_academy_pdf_download_404s(client, admin_headers):
    # The Pack has no single PDF (it is the 6 ebooks) -> 404.
    pack = _course_by_slug(client, admin_headers, "pack-creador-completo")
    r = client.get(f"/api/academy/courses/{pack['id']}/download", headers=admin_headers)
    assert r.status_code == 404, r.text
    # Unknown course -> 404.
    r = client.get("/api/academy/courses/999999/download", headers=admin_headers)
    assert r.status_code == 404, r.text
