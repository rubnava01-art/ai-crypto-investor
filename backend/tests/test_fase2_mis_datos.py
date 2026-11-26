"""Mis datos (Fase 2 mejoras-v1, tarea 4): exportar y borrar la cuenta.

- La exportación solo ve lo propio: otro usuario con sus filas no
  aparece en mi JSON (ni su perfil, ni sus mensajes, ni sus citas).
- El borrado con contraseña correcta elimina la cuenta y sus datos
  personales, conserva los registros de negocio compartidos con autor
  anónimo y cierra la sesión (el token viejo responde 401).
- La contraseña incorrecta no borra nada; el último super admin no se
  puede borrar; el invitado no puede exportar ni borrar (403).

Sin logins reales de más (presupuesto de 10/min por IP): cada login
limpia el limitador antes, como en test_fase2_backend. Las filas
propias se siembran directo en BD (patrón test_usuarios_borrado).
"""
import uuid
from datetime import datetime, timezone

from app.core.rate_limit import login_limiter
from app.core.security import create_guest_token
from app.models.tables import (
    Appointment,
    AuditLog,
    ChatMessage,
    Contact,
    EmailVerification,
    ExchangeConnection,
    PendingActivation,
    SuperAdminGrant,
    TrendSearch,
    User,
)
from tests.conftest import TestingSession


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _mk_user(client, admin_headers, role="prueba"):
    name = _uid("md")
    r = client.post(
        "/api/users",
        json={"username": name, "password": "pass1234abcd", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"], name


def _login(client, username, password="pass1234abcd"):
    login_limiter._hits.clear()
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed_own_rows(uid: int, tag: str):
    """Filas personales del usuario + un contacto vinculado + una cita
    creada por él. Devuelve los ids para aserciones posteriores."""
    db = TestingSession()
    try:
        db.add(ChatMessage(user_id=uid, author_username=f"u-{tag}",
                           author_label=f"U {tag}", text=f"hola {tag}"))
        db.add(TrendSearch(user_id=uid, keyword=f"kw-{tag}"))
        contact = Contact(name=f"Cliente {tag}", email="", phone="", user_id=uid)
        db.add(contact)
        db.flush()
        appt = Appointment(
            contact_id=contact.id, client_name=f"Cliente {tag}",
            service_type="consulta", starts_at=datetime.now(timezone.utc),
            duration_min=30, status="pendiente", created_by_user_id=uid,
        )
        db.add(appt)
        db.commit()
        return {"contact_id": contact.id, "appointment_id": appt.id}
    finally:
        db.close()


def _db_row(model, row_id):
    db = TestingSession()
    try:
        return db.get(model, row_id)
    finally:
        db.close()


def _cleanup(uid: int, contact_id: int | None = None, appointment_id: int | None = None):
    """Borra al usuario de prueba y sus filas sembradas, para no
    contaminar la suite compartida: test_chat_starts_empty exige el
    chat vacío y otros módulos cuentan sus propias filas. Las filas de
    negocio que el borrado anonimizó (contacto/cita con autor NULL) se
    borran por id, porque ya no llevan el user_id."""
    db = TestingSession()
    try:
        db.query(ChatMessage).filter(ChatMessage.user_id == uid).delete(synchronize_session=False)
        db.query(TrendSearch).filter(TrendSearch.user_id == uid).delete(synchronize_session=False)
        db.query(Appointment).filter(Appointment.created_by_user_id == uid).delete(synchronize_session=False)
        db.query(Contact).filter(Contact.user_id == uid).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.user_id == uid).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.entity_id == str(uid)).delete(synchronize_session=False)
        db.query(PendingActivation).filter(PendingActivation.user_id == uid).delete(synchronize_session=False)
        db.query(EmailVerification).filter(EmailVerification.user_id == uid).delete(synchronize_session=False)
        db.query(ExchangeConnection).filter(ExchangeConnection.user_id == uid).delete(synchronize_session=False)
        db.query(SuperAdminGrant).filter(SuperAdminGrant.user_id == uid).delete(synchronize_session=False)
        if contact_id is not None:
            db.query(Contact).filter(Contact.id == contact_id).delete(synchronize_session=False)
        if appointment_id is not None:
            db.query(Appointment).filter(Appointment.id == appointment_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


# ---------- Exportar ----------

def test_export_returns_only_own_data(client, admin_headers):
    # Dos usuarios frescos (no el viewer compartido: otro test podría
    # haberle vinculado ya un contacto y Contact.user_id es UNIQUE).
    me_id, me_name = _mk_user(client, admin_headers)
    other_id, other_name = _mk_user(client, admin_headers)
    me_ids = _seed_own_rows(me_id, "mia")
    other_ids = _seed_own_rows(other_id, "otra")
    try:
        headers = _login(client, me_name)

        r = client.get("/api/mis-datos/exportar", headers=headers)
        assert r.status_code == 200, r.text
        assert "attachment" in r.headers.get("content-disposition", "")
        assert f"mis-datos-{me_name}-" in r.headers["content-disposition"]
        data = r.json()
        assert data["usuario"] == me_name
        assert data["perfil"]["username"] == me_name
        assert "alcance" in data and "negocio compartido" in data["alcance"]
        texts = [m["text"] for m in data["mensajes_chat"]]
        assert any("hola mia" in t for t in texts)
        assert not any("hola otra" in t for t in texts)
        kws = [t["keyword"] for t in data["busquedas_tendencias"]]
        assert any("kw-mia" in k for k in kws)
        assert not any("kw-otra" in k for k in kws)
        assert any(a["client_name"] == "Cliente mia" for a in data["citas_creadas"])
        assert not any(a["client_name"] == "Cliente otra" for a in data["citas_creadas"])
        assert data["contacto_vinculado"] is not None
        assert data["contacto_vinculado"]["name"] == "Cliente mia"
        assert other_name not in r.text
    finally:
        _cleanup(me_id, me_ids["contact_id"], me_ids["appointment_id"])
        _cleanup(other_id, other_ids["contact_id"], other_ids["appointment_id"])


def test_export_requires_auth_and_rejects_guest(client):
    r = client.get("/api/mis-datos/exportar")
    assert r.status_code == 401, r.text
    token, _gid = create_guest_token()
    r = client.get("/api/mis-datos/exportar", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.text
    r = client.request("DELETE", "/api/mis-datos/cuenta", json={"password": "x"},
                      headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.text


# ---------- Borrar ----------

def test_delete_wrong_password_keeps_account(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    try:
        headers = _login(client, name)
        r = client.request("DELETE", "/api/mis-datos/cuenta", json={"password": "clave-mala-1234"}, headers=headers)
        assert r.status_code == 401, r.text
        # La cuenta sigue viva y la sesión también.
        r = client.get("/api/auth/me", headers=headers)
        assert r.status_code == 200, r.text
        assert _db_row(User, uid) is not None
    finally:
        _cleanup(uid)


def test_delete_removes_account_data_and_closes_session(client, admin_headers):
    uid, name = _mk_user(client, admin_headers)
    other_id, _other = _mk_user(client, admin_headers)
    ids = _seed_own_rows(uid, "borrar")
    other_ids = _seed_own_rows(other_id, "ajena")
    try:
        headers = _login(client, name)

        r = client.request("DELETE", "/api/mis-datos/cuenta", json={"password": "pass1234abcd"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        # Sesión cerrada: el token viejo ya no vale.
        r = client.get("/api/auth/me", headers=headers)
        assert r.status_code == 401, r.text
        # Cuenta y datos personales, fuera.
        assert _db_row(User, uid) is None
        db = TestingSession()
        try:
            assert db.query(ChatMessage).filter(ChatMessage.user_id == uid).count() == 0
            assert db.query(TrendSearch).filter(TrendSearch.user_id == uid).count() == 0
            # Datos de negocio compartidos: se conservan, con autor anónimo.
            contact = db.get(Contact, ids["contact_id"])
            assert contact is not None and contact.user_id is None
            appt = db.get(Appointment, ids["appointment_id"])
            assert appt is not None and appt.created_by_user_id is None
            # El historial de auditoría se conserva (actor anonimizado).
            assert db.query(AuditLog).filter(AuditLog.entity_id == str(uid)).count() >= 1
            # Los datos del otro usuario siguen intactos.
            assert db.query(ChatMessage).filter(ChatMessage.user_id == other_id).count() == 1
            assert db.query(TrendSearch).filter(TrendSearch.user_id == other_id).count() == 1
        finally:
            db.close()
    finally:
        _cleanup(uid, ids["contact_id"], ids["appointment_id"])
        _cleanup(other_id, other_ids["contact_id"], other_ids["appointment_id"])


def test_delete_last_super_admin_is_blocked(client, admin_headers):
    # Dos super admin nuevos: borrar uno vale (queda otro); para probar
    # el bloqueo del ÚLTIMO se quitan temporalmente las demás concesiones
    # y se restauran al final (try/finally): solo corre este test entre
    # medias, sin concurrencia en la suite.
    s1_id, s1_name = _mk_user(client, admin_headers, role="super_admin")
    s2_id, s2_name = _mk_user(client, admin_headers, role="super_admin")
    h1 = _login(client, s1_name)
    r = client.request("DELETE", "/api/mis-datos/cuenta", json={"password": "pass1234abcd"}, headers=h1)
    assert r.status_code == 200, r.text
    assert _db_row(User, s1_id) is None

    db = TestingSession()
    others = [g.user_id for g in db.query(SuperAdminGrant).filter(
        SuperAdminGrant.user_id != s2_id).all()]
    try:
        db.query(SuperAdminGrant).filter(
            SuperAdminGrant.user_id != s2_id).delete(synchronize_session=False)
        db.commit()
        h2 = _login(client, s2_name)
        r = client.request("DELETE", "/api/mis-datos/cuenta",
                          json={"password": "pass1234abcd"}, headers=h2)
        assert r.status_code == 400, r.text
        assert _db_row(User, s2_id) is not None
    finally:
        db2 = TestingSession()
        try:
            for uid in others:
                if db2.query(SuperAdminGrant).filter(
                        SuperAdminGrant.user_id == uid).first() is None:
                    db2.add(SuperAdminGrant(user_id=uid))
            db2.commit()
        finally:
            db2.close()
        db.close()
    # Limpieza: el super restante se borra directo en BD (el borrado por
    # admin exige otro super admin; aquí solo queda él).
    db = TestingSession()
    try:
        db.query(SuperAdminGrant).filter(
            SuperAdminGrant.user_id == s2_id).delete(synchronize_session=False)
        db.query(AuditLog).filter(AuditLog.user_id == s2_id).update(
            {AuditLog.user_id: None})
        db.query(User).filter(User.id == s2_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_delete_last_admin_not_super_is_blocked(client, admin_headers):
    # M1 (corrección QA Fase 2, 2026-11-25): regresión del bloqueo de
    # la ÚLTIMA cuenta admin que NO es super admin (mis_datos.py:226-233).
    # El código existía y el QA lo verificó en vivo (400), pero la suite
    # solo testeaba el bloqueo de última super admin.
    # Patrón del test de super admin: se crea un admin plano nuevo y se
    # degradan temporalmente los demás admin (restaurados en finally);
    # solo corre este test entre medias, sin concurrencia en la suite.
    a_id, a_name = _mk_user(client, admin_headers, role="admin")
    db = TestingSession()
    others = [u.id for u in db.query(User).filter(
        User.is_admin.is_(True), User.id != a_id).all()]
    try:
        db.query(User).filter(
            User.is_admin.is_(True), User.id != a_id).update(
            {User.is_admin: False}, synchronize_session=False)
        db.commit()
        # El admin nuevo no es super: solo queda él como admin.
        assert db.query(SuperAdminGrant).filter(
            SuperAdminGrant.user_id == a_id).first() is None
        assert db.query(User).filter(User.is_admin.is_(True)).count() == 1
        h = _login(client, a_name)
        r = client.request("DELETE", "/api/mis-datos/cuenta",
                           json={"password": "pass1234abcd"}, headers=h)
        assert r.status_code == 400, r.text
        assert "última cuenta administradora" in r.json()["detail"]
        # Cuenta intacta: sigue en BD y sigue siendo admin.
        row = _db_row(User, a_id)
        assert row is not None and row.is_admin is True
    finally:
        db2 = TestingSession()
        try:
            db2.query(User).filter(User.id.in_(others)).update(
                {User.is_admin: True}, synchronize_session=False)
            db2.commit()
        finally:
            db2.close()
        db.close()
    _cleanup(a_id)
