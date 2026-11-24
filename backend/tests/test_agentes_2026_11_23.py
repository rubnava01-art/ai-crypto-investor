"""Agente 2 (Backend/Seguridad) — Corrida de SEGURIDAD 2026-11-23.

Cubre los puntos backend del plan conjunto (B1–B11) que tienen
comportamiento observable por HTTP:
- B1: cliente vinculado -> 403 en el Asistente (chat y capacidades);
  prueba SIN vínculo sigue entrando (decisión M1 de Rubén, pendiente).
- B2: rate limit por usuario en POST /api/asistente/chat (20/min) y
  audit() en las mutaciones del chat (nota y cita).
- B6: /api/system/metrics y /api/logs exigen admin; /api/crear/trends
  cierra a clientes vinculados. El listado de alumnos de Academia
  QUEDA FUERA a propósito: el panel lo carga para prueba y un test
  existente (test_academy.py) exige 200 para viewer — pasa a la
  decisión 6 de Rubén; aquí se documenta ese comportamiento.
- B9: borrado de usuario con post + comentario de Inicio: 204 y el
  contenido se preserva con autor anónimo (author_id NULL).

Fixtures compartidas (client, admin_headers, viewer_headers). NINGÚN
test hace login propio: los tokens de clientes vinculados se acuñan
con create_access_token (precedente test_portal_isolation). Todo lo
creado se limpia; los limiters nuevos se vacían antes y después de
cada test porque la suite comparte un único proceso.
"""
import uuid

import pytest

from app.api.asistente import asistente_limiter
from app.api.chat import chat_limiter
from app.api.inicio import comment_limiter
from app.core.security import create_access_token, hash_password
from app.database import get_db
from app.models.tables import (
    Appointment,
    AuditLog,
    BusinessNote,
    Contact,
    HomeComment,
    HomePost,
    User,
)
from tests.conftest import TestingSession

PORTAL = "/api/business/marketing/portal"


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


def _mk_user(client, admin_headers, username: str, role: str = "prueba") -> dict:
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_contact(client, admin_headers, name: str) -> dict:
    r = client.post(
        "/api/crm/contacts",
        json={"name": name, "email": "", "phone": "", "source": "manual",
              "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_linked_pair(client, app, admin_headers, tag: str) -> dict:
    """Un usuario prueba vinculado a un contacto del CRM."""
    user = _mk_user(client, admin_headers, _uid(f"link{tag}"))
    contact = _mk_contact(client, admin_headers, _uid(f"Link{tag}"))
    r = client.post(
        f"{PORTAL}/vinculos",
        json={"user_id": user["id"], "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return {
        "user": user, "contact": contact,
        "headers": _headers_for(app, user["username"]),
    }


def _cleanup_user(client, admin_headers, user_id: int, contact_id: int) -> None:
    client.delete(f"{PORTAL}/vinculos/{contact_id}", headers=admin_headers)
    client.delete(f"/api/users/{user_id}", headers=admin_headers)


@pytest.fixture(autouse=True)
def _clear_new_limiters():
    """Los limiters nuevos son globales al proceso: vaciarlos antes y
    después de cada test para que una ráfaga no bloquee otros módulos."""
    for limiter in (asistente_limiter, chat_limiter, comment_limiter):
        limiter.clear()
    yield
    for limiter in (asistente_limiter, chat_limiter, comment_limiter):
        limiter.clear()


# ------------------------------------------------------------------ B1 --

def test_b1_linked_client_403_in_chat_and_capacidades(
    client, app, admin_headers, viewer_headers
):
    pair = _mk_linked_pair(client, app, admin_headers, "B1")
    try:
        r = client.post(
            "/api/asistente/chat", json={"mensaje": "Muéstrame los contactos"},
            headers=pair["headers"],
        )
        assert r.status_code == 403, r.text
        r = client.get("/api/asistente/capacidades", headers=pair["headers"])
        assert r.status_code == 403, r.text
        # El mismo cliente vinculado sigue entrando a SU portal.
        r = client.get(f"{PORTAL}/me", headers=pair["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["contact"]["id"] == pair["contact"]["id"]
    finally:
        _cleanup_user(client, admin_headers,
                      pair["user"]["id"], pair["contact"]["id"])


def test_b1_unlinked_viewer_still_uses_chat(client, viewer_headers, admin_headers):
    """Prueba SIN vínculo no cambia (decisión M1 pendiente de Rubén):
    el chat le sigue respondiendo; solo se cierra el bypass del
    cliente vinculado."""
    r = client.post(
        "/api/asistente/chat", json={"mensaje": "¿Qué hay nuevo?"},
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text
    r = client.get("/api/asistente/capacidades", headers=viewer_headers)
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ B2 --

def test_b2_chat_rate_limit_20_per_min_per_user(client, admin_headers):
    for _ in range(20):
        r = client.post(
            "/api/asistente/chat", json={"mensaje": "¿Qué hay nuevo?"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
    r = client.post(
        "/api/asistente/chat", json={"mensaje": "¿Qué hay nuevo?"},
        headers=admin_headers,
    )
    assert r.status_code == 429, r.text
    assert r.headers.get("Retry-After") == "60"


def test_b2_chat_mutations_are_audited(client, admin_headers):
    tag = uuid.uuid4().hex[:8]
    note_title = f"Nota auditoría B2-{tag}"
    r = client.post(
        "/api/asistente/chat",
        json={"mensaje": f"Crea una nota: {note_title}"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    note_id = r.json()["accion"]["datos"]["id"]
    r = client.post(
        "/api/asistente/chat",
        json={"mensaje": f"Crea una cita para Cliente B2-{tag} mañana a las 10:00"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    appt_id = r.json()["accion"]["datos"]["id"]
    try:
        db = TestingSession()
        try:
            admin = db.query(User).filter(User.username == "admin").one()
            rows = db.query(AuditLog).filter(
                AuditLog.action.in_(
                    ("asistente.crear_nota", "asistente.crear_cita")),
                AuditLog.entity_id.in_((str(note_id), str(appt_id))),
            ).all()
            assert {row.action for row in rows} == {
                "asistente.crear_nota", "asistente.crear_cita"}
            assert all(row.user_id == admin.id for row in rows)
        finally:
            db.close()
    finally:
        db = TestingSession()
        try:
            db.query(BusinessNote).filter(BusinessNote.id == note_id).delete()
            db.query(Appointment).filter(Appointment.id == appt_id).delete()
            db.commit()
        finally:
            db.close()


# ------------------------------------------------------------------ B6 --

def test_b6_metrics_and_logs_require_admin(
    client, admin_headers, viewer_headers
):
    for path in ("/api/system/metrics", "/api/logs"):
        r = client.get(path, headers=viewer_headers)
        assert r.status_code == 403, (path, r.text)
        r = client.get(path, headers=admin_headers)
        assert r.status_code == 200, (path, r.text)


def test_b6_students_still_readable_by_viewer(client, admin_headers, viewer_headers):
    """Decisión 6 RESUELTA el 2026-11-23 (Agente 2, por orden de Rubén):
    el listado de alumnos de Academia es solo-admin; prueba recibe
    403. El docstring anterior documentaba que quedaba fuera de B6."""
    courses = client.get("/api/academy/courses", headers=admin_headers).json()
    assert courses, "el catálogo de Academia debe estar sembrado"
    course_id = courses[0]["id"]
    r = client.get(
        f"/api/academy/courses/{course_id}/students", headers=viewer_headers
    )
    assert r.status_code == 403, r.text


def test_b6_trends_denies_linked_client_but_not_viewer(
    client, app, admin_headers, viewer_headers
):
    pair = _mk_linked_pair(client, app, admin_headers, "B6")
    try:
        r = client.get("/api/crear/trends", headers=pair["headers"])
        assert r.status_code == 403, r.text
        r = client.get("/api/crear/trends", headers=viewer_headers)
        assert r.status_code == 200, r.text
        r = client.get("/api/crear/trends", headers=admin_headers)
        assert r.status_code == 200, r.text
    finally:
        _cleanup_user(client, admin_headers,
                      pair["user"]["id"], pair["contact"]["id"])


# ------------------------------------------------------------------ B9 --

def test_b9_delete_user_with_home_post_and_comment(client, admin_headers):
    """Borrado con post + comentario de Inicio del usuario víctima:
    204 y el contenido se preserva con autor anónimo."""
    vid, vname = None, None
    db = TestingSession()
    try:
        victim = User(username="u" + uuid.uuid4().hex[:10],
                      password_hash=hash_password("origpass1234"))
        db.add(victim)
        db.commit()
        vid, vname = victim.id, victim.username
        post = HomePost(title="Post B9 " + uuid.uuid4().hex[:6],
                        body="cuerpo", author_id=vid)
        db.add(post)
        db.flush()
        comment = HomeComment(post_id=post.id, author_id=vid,
                              body="comentario B9")
        db.add(comment)
        db.commit()
        post_id, comment_id = post.id, comment.id
    finally:
        db.close()
    try:
        r = client.delete(f"/api/users/{vid}", headers=admin_headers)
        assert r.status_code == 204, r.text
        db = TestingSession()
        try:
            assert db.get(User, vid) is None
            post = db.get(HomePost, post_id)
            assert post is not None and post.author_id is None
            comment = db.get(HomeComment, comment_id)
            assert comment is not None and comment.author_id is None
        finally:
            db.close()
    finally:
        client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)
        client.delete(f"/api/users/{vid}", headers=admin_headers)
