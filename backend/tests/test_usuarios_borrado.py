"""Borrado de usuarios con filas que los referencian (2026-11-21).

Bug: DELETE /api/users/{id} devolvía 409 en producción para
cualquier usuario con acciones auditadas — AuditLog.user_id (y las
demás FK a users sin ondelete) bloqueaba el borrado en Postgres.
El arreglo: ondelete SET NULL en el modelo + limpieza explícita en
delete_user/reject (_detach_user_references) + migración Alembic.
El historial se preserva: las filas quedan con user_id NULL (actor
anónimo), nunca se borran filas de auditoría ni de contenido ajenas;
solo se borran las conexiones de exchange (metadatos propios).

Las pruebas corren con PRAGMA foreign_keys=ON sobre el motor de
pruebas: SQLite no aplica las FK por defecto, y por eso el bug solo
se veía en Postgres/Neon. El fixture restaura el estado al salir
del módulo, así el resto de la suite no se ve afectado.

Sin logins reales en estos tests (presupuesto de 10/min por IP):
las filas de auditoría del usuario se siembran directo en BD, que
es exactamente la condición que bloqueaba el borrado.
"""
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event

from app.api.users import _detach_user_references
from app.core.security import hash_password
from app.models.tables import (
    AIExplanation,
    Appointment,
    AuditLog,
    BusinessCost,
    ChatMessage,
    Contact,
    ExchangeConnection,
    HomeComment,
    HomePost,
    IdempotencyKey,
    PendingActivation,
    TrendSearch,
    User,
    WebAudit,
)
from tests.conftest import TestingSession, engine


@pytest.fixture(scope="module", autouse=True)
def _enforce_fks():
    """Activa la aplicación de FK en SQLite solo durante este módulo."""
    def _on_connect(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    event.listen(engine, "connect", _on_connect)
    engine.dispose()
    yield
    event.remove(engine, "connect", _on_connect)
    engine.dispose()


def _mk_user(client, admin_headers, role="prueba"):
    name = "u" + uuid.uuid4().hex[:10]
    r = client.post(
        "/api/users",
        json={"username": name, "password": "origpass1234", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"], name


def _seed_references(uid, other_uid=None):
    """Filas que referencian al usuario víctima: las que bloqueaban
    el borrado en producción (login + cambio de clave auditados).
    Devuelve los identificadores sembrados: los entity_id NO son
    únicos entre pruebas (SQLite reutiliza ids de usuarios
    borrados), así que las aserciones usan estos ids de fila."""
    contact_name = "Contacto víctima " + uuid.uuid4().hex[:6]
    db = TestingSession()
    try:
        a1 = AuditLog(user_id=uid, action="auth.login",
                      entity="user", entity_id=str(uid))
        a2 = AuditLog(user_id=uid, action="users.change_password",
                      entity="user", entity_id=str(uid))
        db.add_all([a1, a2])
        db.flush()
        audit_ids = [a1.id, a2.id]
        db.add(IdempotencyKey(
            key="k-" + uuid.uuid4().hex[:8], user_id=uid,
            route="/api/test", response_json={}, status_code=200))
        db.add(ExchangeConnection(
            user_id=uid, exchange="kraken", label="prueba",
            permissions=[], ip_whitelist=[]))
        db.add(AIExplanation(user_id=uid, question_excerpt="q",
                             answer_excerpt="a"))
        db.add(Contact(name=contact_name, user_id=uid))
        db.add(ChatMessage(user_id=uid, author_username="victima",
                           author_label="Prueba", text="hola"))
        db.add(TrendSearch(user_id=uid, keyword="btc"))
        db.add(WebAudit(user_id=uid, url="https://example.com",
                        final_url="https://example.com", status=200,
                        redirect_count=0, ttfb_ms=10.0, total_ms=20.0,
                        size_kb=1.0))
        db.add(Appointment(
            contact_id=None, client_name="Víctima",
            service_type="consulta",
            starts_at=datetime(2026, 11, 22, 10, 0, tzinfo=timezone.utc),
            duration_min=30, created_by_user_id=uid))
        db.add(BusinessCost(date=date(2026, 11, 21), category="otro",
                            concept="gasto víctima", amount=1,
                            created_by_user_id=uid))
        # B9 (corrida seguridad 2026-11-23): post + comentario de
        # Inicio del usuario víctima (author_id, no user_id).
        post = HomePost(title="Post víctima " + uuid.uuid4().hex[:6],
                        body="cuerpo", author_id=uid)
        db.add(post)
        db.flush()
        comment = HomeComment(post_id=post.id, author_id=uid,
                              body="comentario víctima")
        db.add(comment)
        db.flush()
        home_ids = {"post_id": post.id, "comment_id": comment.id}
        other_audit_id = None
        if other_uid is not None:
            other = AuditLog(user_id=other_uid, action="auth.login",
                             entity="user", entity_id=str(other_uid))
            db.add(other)
            db.flush()
            other_audit_id = other.id
        db.commit()
        return {
            "audit_ids": audit_ids,
            "other_audit_id": other_audit_id,
            "contact_name": contact_name,
            "home_ids": home_ids,
        }
    finally:
        db.close()


def _cleanup_home(client, admin_headers, seed):
    """Borra el post sembrado por _seed_references (B9): el borrado
    del usuario PRESERVA el post con autor NULL, así que sin esto
    quedaría en la BD compartida y rompería tests que exigen la
    lista de Inicio vacía."""
    home_ids = (seed or {}).get("home_ids") or {}
    post_id = home_ids.get("post_id")
    if post_id is not None:
        client.delete(f"/api/inicio/posts/{post_id}", headers=admin_headers)


def test_delete_user_with_audit_rows_succeeds_and_preserves_history(
    client, admin_headers
):
    """El caso exacto de producción: usuario con login y cambio de
    clave auditados + resto de referencias. Antes del arreglo esto
    era 409; ahora es 204 y el historial queda anonimizado, no
    borrado."""
    vid, vname = _mk_user(client, admin_headers)
    oid, _ = _mk_user(client, admin_headers)  # otro usuario: intacto
    seed = _seed_references(vid, other_uid=oid)
    try:
        r = client.delete(f"/api/users/{vid}", headers=admin_headers)
        assert r.status_code == 204, r.text
        db = TestingSession()
        try:
            assert db.get(User, vid) is None
            # Historial de la víctima preservado, con actor anónimo.
            seeded = db.query(AuditLog).filter(
                AuditLog.id.in_(seed["audit_ids"])).all()
            assert len(seeded) == 2
            assert all(row.user_id is None for row in seeded)
            # La auditoría del borrado sí registra al admin que borró.
            admin = db.query(User).filter(User.username == "admin").one()
            gone = db.query(AuditLog).filter(
                AuditLog.action == "users.delete",
                AuditLog.entity_id == str(vid),
            ).all()
            assert any(
                row.user_id == admin.id
                and (row.details_json or {}).get("username") == vname
                for row in gone
            )
            # Historial ajeno intacto.
            other = db.get(AuditLog, seed["other_audit_id"])
            assert other is not None and other.user_id == oid
            # Conexión propia borrada; resto desvinculado, no borrado.
            assert db.query(ExchangeConnection).filter(
                ExchangeConnection.user_id == vid).count() == 0
            assert db.query(IdempotencyKey).filter(
                IdempotencyKey.user_id.is_(None)).count() >= 1
            contact = db.query(Contact).filter(
                Contact.name.like("Contacto víctima%")).one()
            assert contact.user_id is None
            assert db.query(ChatMessage).filter(
                ChatMessage.user_id.is_(None)).count() >= 1
            assert db.query(TrendSearch).filter(
                TrendSearch.user_id.is_(None)).count() >= 1
            assert db.query(WebAudit).filter(
                WebAudit.user_id.is_(None)).count() >= 1
            assert db.query(AIExplanation).filter(
                AIExplanation.user_id.is_(None)).count() >= 1
            assert db.query(Appointment).filter(
                Appointment.created_by_user_id.is_(None)).count() >= 1
            assert db.query(BusinessCost).filter(
                BusinessCost.created_by_user_id.is_(None)).count() >= 1
            # B9: post y comentario preservados, con autor anónimo.
            post = db.get(HomePost, seed["home_ids"]["post_id"])
            assert post is not None and post.author_id is None
            comment = db.get(HomeComment, seed["home_ids"]["comment_id"])
            assert comment is not None and comment.author_id is None
        finally:
            db.close()
    finally:
        _cleanup_home(client, admin_headers, seed)
        client.delete(f"/api/users/{vid}", headers=admin_headers)
        client.delete(f"/api/users/{oid}", headers=admin_headers)


def test_detach_helper_nulls_references_without_deleting_rows(
    client, admin_headers
):
    """El helper en sí: desvincula sin borrar filas, sin pasar por
    el endpoint (prueba la limpieza explícita, independiente del
    ondelete de la BD)."""
    db = TestingSession()
    try:
        victim = User(username="u" + uuid.uuid4().hex[:10],
                      password_hash=hash_password("origpass1234"))
        db.add(victim)
        db.commit()
        vid = victim.id
    finally:
        db.close()
    seed = _seed_references(vid)
    contact_name = seed["contact_name"]
    try:
        db = TestingSession()
        try:
            victim = db.get(User, vid)
            _detach_user_references(db, victim)
            db.commit()
            seeded = db.query(AuditLog).filter(
                AuditLog.id.in_(seed["audit_ids"])).all()
            assert len(seeded) == 2
            assert all(row.user_id is None for row in seeded)
            assert db.query(ExchangeConnection).filter(
                ExchangeConnection.user_id == vid).count() == 0
            contact = db.query(Contact).filter(
                Contact.name == contact_name).one()
            assert contact.user_id is None
        finally:
            db.close()
    finally:
        _cleanup_home(client, admin_headers, seed)
        client.delete(f"/api/users/{vid}", headers=admin_headers)


def test_reject_pending_user_with_linked_contact(client, admin_headers):
    """El flujo de rechazo también borra la cuenta: si el pendiente
    tiene un contacto CRM vinculado, se desvincula en vez de 409."""
    vid, _ = _mk_user(client, admin_headers)
    contact_name = "Contacto pendiente " + uuid.uuid4().hex[:6]
    db = TestingSession()
    try:
        db.add(PendingActivation(user_id=vid))
        db.add(Contact(name=contact_name, user_id=vid))
        db.commit()
    finally:
        db.close()
    try:
        r = client.post(f"/api/users/{vid}/reject", headers=admin_headers)
        assert r.status_code == 204, r.text
        db = TestingSession()
        try:
            assert db.get(User, vid) is None
            contact = db.query(Contact).filter(
                Contact.name == contact_name).one()
            assert contact.user_id is None
        finally:
            db.close()
    finally:
        client.delete(f"/api/users/{vid}", headers=admin_headers)
