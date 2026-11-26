"""Fase 1 mejoras-v1 — seguridad: verificación de correo (tarea 1),
rate limits (tarea 2), 2FA (tarea 3), super admin por registro (tarea 4),
aislamiento de datos + H-02 (tarea 5), auditoría de admin (tarea 6) y
interruptor de trading real (tarea 7).

Los limiters son globales en el proceso y la suite comparte un único
proceso: cada test limpia su presupuesto (patrón documentado en
rate_limit.clear) para no bloquear a los demás.
"""
import re

import pytest

from app.core.email_outbox import clear_outbox, list_outbox
from app.core.rate_limit import (
    guest_issue_limiter,
    guest_read_limiter,
    login_limiter,
    login_lockout,
    register_limiter,
    resend_limiter,
)


@pytest.fixture(autouse=True)
def _reset_fase1_state():
    login_limiter.clear()
    login_lockout.clear()
    register_limiter.clear()
    resend_limiter.clear()
    guest_issue_limiter.clear()
    guest_read_limiter.clear()
    clear_outbox()
    yield
    login_limiter.clear()
    login_lockout.clear()
    register_limiter.clear()
    resend_limiter.clear()
    clear_outbox()


def _challenge(client):
    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    body = r.json()
    a, b = (int(x) for x in re.findall(r"\d+", body["question"]))
    return body["challenge_id"], a + b


def _register(client, username, password="VerificaPass12", email=None):
    cid, answer = _challenge(client)
    payload = {
        "username": username,
        "password": password,
        "challenge_id": cid,
        "answer": answer,
        "terms_accepted": True,
    }
    if email is not None:
        payload["email"] = email
    return client.post("/api/auth/register", json=payload)


def _login(client, username, password):
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )


def _approve(client, admin_headers, username):
    users = client.get("/api/users", headers=admin_headers).json()
    row = [u for u in users if u["username"] == username][0]
    if row["status"] != "pending":
        # Cuenta creada por un admin: nace activa, no hay nada que aprobar.
        return row["id"]
    r = client.post(f"/api/users/{row['id']}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    return row["id"]


def _token_from_outbox(email):
    mails = [m for m in list_outbox() if m.to == email]
    assert mails, f"sin correo encolado para {email}"
    # Fase 8: la cola ya no trae solo verificación — la bienvenida
    # tras aprobar también va al mismo destinatario. Se busca el
    # correo de verificación (el que trae token=), no el último.
    for mail in reversed(mails):
        match = re.search(r"token=([A-Za-z0-9_\-]+)", mail.body)
        if match:
            return match.group(1)
    raise AssertionError("ningún correo trae enlace con token")


# ------------------------------------------------------- tarea 1: correo --

def test_registro_con_correo_encola_verificacion(client):
    r = _register(client, "f1mail1", email="f1mail1@example.com")
    assert r.status_code == 201, r.text
    mails = list_outbox()
    assert len(mails) == 1
    assert mails[0].to == "f1mail1@example.com"
    assert "verific" in mails[0].subject.lower()
    assert "token=" in mails[0].body


def test_registro_sin_correo_no_encola_nada(client):
    r = _register(client, "f1mail2")
    assert r.status_code == 201, r.text
    assert list_outbox() == []


def test_registro_con_correo_invalido_es_422(client):
    r = _register(client, "f1mail3", email="no-es-correo")
    assert r.status_code == 422, r.text


def test_cuenta_sin_verificar_no_entra_hasta_verificar(client, admin_headers):
    _register(client, "f1mail4", email="f1mail4@example.com")
    _approve(client, admin_headers, "f1mail4")
    # Aprobada pero sin verificar: acceso limitado (403 con mensaje claro).
    r = _login(client, "f1mail4", "VerificaPass12")
    assert r.status_code == 403, r.text
    assert "verific" in r.json()["detail"].lower()
    # Verificar con el token del correo encolado abre el acceso.
    token = _token_from_outbox("f1mail4@example.com")
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    r = _login(client, "f1mail4", "VerificaPass12")
    assert r.status_code == 200, r.text
    # /me refleja la verificación.
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["email_verified"] is True
    assert me["email"] == "f1mail4@example.com"


def test_token_verificacion_un_solo_uso(client):
    _register(client, "f1mail5", email="f1mail5@example.com")
    token = _token_from_outbox("f1mail5@example.com")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    # Reusar el mismo token: 400.
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 400, r.text
    # Token inventado: 400 con el mismo mensaje (sin oráculo).
    r = client.post("/api/auth/verify-email", json={"token": "token-inventado"})
    assert r.status_code == 400, r.text


def test_reenvio_no_filtra_existencia_y_reemplaza_token(client, admin_headers):
    _register(client, "f1mail6", email="f1mail6@example.com")
    viejo = _token_from_outbox("f1mail6@example.com")
    # Usuario inexistente: mismo 200 genérico, sin correo nuevo.
    r = client.post("/api/auth/resend-verification", json={"username": "nadie-existe"})
    assert r.status_code == 200, r.text
    assert len(list_outbox()) == 1
    # Reenvío real: encola un token nuevo e invalida el anterior.
    r = client.post("/api/auth/resend-verification", json={"username": "f1mail6"})
    assert r.status_code == 200, r.text
    assert len(list_outbox()) == 2
    nuevo = _token_from_outbox("f1mail6@example.com")
    assert nuevo != viejo
    assert client.post("/api/auth/verify-email", json={"token": viejo}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": nuevo}).status_code == 200


def test_cuenta_sin_correo_entra_tras_aprobar(client, admin_headers):
    _register(client, "f1mail7")
    _approve(client, admin_headers, "f1mail7")
    r = _login(client, "f1mail7", "VerificaPass12")
    assert r.status_code == 200, r.text


def test_token_vencido_no_verifica(client, app):
    _register(client, "f1mail8", email="f1mail8@example.com")
    token = _token_from_outbox("f1mail8@example.com")
    # Caducar el token directamente en BD (TTL 24 h), con la sesión
    # de la app (el override de get_db de conftest).
    import datetime as dt

    from app.core.email_verification import _hash_token
    from app.database import get_db
    from app.models.tables import EmailVerification

    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        row = (
            db.query(EmailVerification)
            .filter(EmailVerification.token_hash == _hash_token(token))
            .first()
        )
        assert row is not None
        row.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
        db.commit()
    finally:
        gen.close()
    r = client.post("/api/auth/verify-email", json={"token": token})
    assert r.status_code == 400, r.text


def test_cambio_correo_en_perfil_exige_reverificar(client, admin_headers):
    _register(client, "f1mail9")
    _approve(client, admin_headers, "f1mail9")
    r = _login(client, "f1mail9", "VerificaPass12")
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # Añadir correo en el perfil: queda sin verificar y se encola token.
    r = client.put("/api/profile/me", json={"email": "f1mail9@example.com"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["email_verified"] is False
    assert len(list_outbox()) == 1
    # El login siguiente queda bloqueado hasta verificar.
    r = _login(client, "f1mail9", "VerificaPass12")
    assert r.status_code == 403, r.text
    token = _token_from_outbox("f1mail9@example.com")
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
    assert _login(client, "f1mail9", "VerificaPass12").status_code == 200


# -------------------------------------------------------- tarea 2: límites --

def test_bloqueo_por_cuenta_tras_10_fallos(client, admin_headers):
    # 10 fallos seguidos con la misma cuenta (la contraseña es la del
    # admin semilla; se limpia el limiter de IP entre intentos para
    # aislar el bloqueo por cuenta del límite por IP).
    for _ in range(10):
        r = _login(client, "admin", "clave-incorrecta")
        assert r.status_code == 401, r.text
        assert r.json()["detail"] == "Credenciales inválidas."
        login_limiter.clear()
    # El intento 11 (incluso con la contraseña correcta) es 429.
    r = _login(client, "admin", "secret")
    assert r.status_code == 429, r.text
    assert "minutos" in r.json()["detail"]
    assert r.headers.get("Retry-After")


def test_bloqueo_por_cuenta_no_filtra_si_existe(client):
    # Un usuario inexistente también se bloquea igual (mismo 429 tras
    # 10 fallos): el bloqueo no delata si la cuenta existe.
    for _ in range(10):
        r = _login(client, "usuario-que-no-existe", "clave-incorrecta")
        assert r.status_code == 401, r.text
        login_limiter.clear()
    r = _login(client, "usuario-que-no-existe", "clave-incorrecta")
    assert r.status_code == 429, r.text


def test_limite_login_por_ip(client):
    # 10 intentos desde la misma IP (usuarios distintos, para no
    # activar el bloqueo por cuenta): el 11º es 429 por IP.
    for i in range(10):
        r = _login(client, f"ip-usuario-{i}", "clave-incorrecta")
        assert r.status_code == 401, r.text
    r = _login(client, "ip-usuario-10", "clave-incorrecta")
    assert r.status_code == 429, r.text
    assert "inicio de sesión" in r.json()["detail"]


def test_limite_registro_por_ip(client):
    # 10 registros por minuto por IP: el 11º es 429 en español.
    # (Se limpia el limiter del challenge entre intentos: el test
    # mide el límite de REGISTRO, no el de la pregunta matemática.)
    for i in range(10):
        r = _register(client, f"f2reg{i}")
        assert r.status_code == 201, r.text
        login_limiter.clear()
    login_limiter.clear()
    r = _register(client, "f2reg10")
    assert r.status_code == 429, r.text
    assert "registro" in r.json()["detail"]


def test_registro_duplicado_no_filtra_existencia(client, admin_headers):
    _register(client, "f2dup")
    # Mismo cuerpo 201 genérico que un registro nuevo (sin id ni fecha).
    r = _register(client, "f2dup")
    assert r.status_code == 201, r.text
    assert r.json()["id"] is None
    assert r.json()["created_at"] is None
    assert r.json()["status"] == "pending"
    # Y solo existe una fila con ese nombre.
    users = client.get("/api/users", headers=admin_headers).json()
    assert len([u for u in users if u["username"] == "f2dup"]) == 1


# ------------------------------------------------------------ tarea 3: 2FA --

def _make_admin(client, admin_headers, username, password="Admin2faPass12"):
    r = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code in (201, 409), r.text
    r = _login(client, username, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _totp_now(secret):
    import pyotp

    return pyotp.TOTP(secret).now()


def test_2fa_flujo_completo_admin(client, admin_headers):
    h = _make_admin(client, admin_headers, "f3admin1")
    # Setup: secreto + URL otpauth; aún no activo.
    r = client.post("/api/auth/2fa/setup", headers=h)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert r.json()["otpauth_url"].startswith("otpauth://totp/")
    st = client.get("/api/auth/2fa/status", headers=h).json()
    assert st["enabled"] is False and st["pending_setup"] is True
    # Sin confirmar, el login sigue sin 2FA.
    assert _login(client, "f3admin1", "Admin2faPass12").status_code == 200
    # Confirmar con código TOTP válido: 10 códigos de recuperación.
    r = client.post("/api/auth/2fa/setup", headers=h)  # reemite antes de confirmar
    secret = r.json()["secret"]
    r = client.post(
        "/api/auth/2fa/confirm", json={"code": _totp_now(secret)}, headers=h
    )
    assert r.status_code == 200, r.text
    recovery = r.json()["recovery_codes"]
    assert len(recovery) == 10
    # Confirmar revocó los tokens viejos (la sesión anterior muere).
    assert client.get("/api/auth/me", headers=h).status_code == 401
    # Login sin código: 401 con mensaje propio.
    r = _login(client, "f3admin1", "Admin2faPass12")
    assert r.status_code == 401, r.text
    assert "dos pasos" in r.json()["detail"]
    # Código incorrecto: 401.
    r = client.post(
        "/api/auth/login",
        json={"username": "f3admin1", "password": "Admin2faPass12", "totp_code": "000000"},
    )
    assert r.status_code == 401, r.text
    # Código correcto: 200.
    r = client.post(
        "/api/auth/login",
        json={"username": "f3admin1", "password": "Admin2faPass12", "totp_code": _totp_now(secret)},
    )
    assert r.status_code == 200, r.text
    h2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # Código de recuperación: entra una vez y se consume.
    r = client.post(
        "/api/auth/login",
        json={"username": "f3admin1", "password": "Admin2faPass12", "totp_code": recovery[0]},
    )
    assert r.status_code == 200, r.text
    r = client.post(
        "/api/auth/login",
        json={"username": "f3admin1", "password": "Admin2faPass12", "totp_code": recovery[0]},
    )
    assert r.status_code == 401, r.text
    # Desactivar con contraseña + TOTP: el login vuelve a ser solo clave.
    r = client.post(
        "/api/auth/2fa/disable",
        json={"password": "Admin2faPass12", "code": _totp_now(secret)},
        headers=h2,
    )
    assert r.status_code == 200, r.text
    assert _login(client, "f3admin1", "Admin2faPass12").status_code == 200


def test_2fa_prueba_no_puede_enrolar(client, viewer_headers):
    r = client.post("/api/auth/2fa/setup", headers=viewer_headers)
    assert r.status_code == 403, r.text


def test_2fa_confirm_con_codigo_malo_no_activa(client, admin_headers):
    h = _make_admin(client, admin_headers, "f3admin2")
    r = client.post("/api/auth/2fa/setup", headers=h)
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/2fa/confirm", json={"code": "000000"}, headers=h)
    assert r.status_code == 401, r.text
    st = client.get("/api/auth/2fa/status", headers=h).json()
    assert st["enabled"] is False


def test_2fa_setup_rechazado_si_ya_activo(client, admin_headers):
    h = _make_admin(client, admin_headers, "f3admin3")
    r = client.post("/api/auth/2fa/setup", headers=h)
    secret = r.json()["secret"]
    r = client.post(
        "/api/auth/2fa/confirm", json={"code": _totp_now(secret)}, headers=h
    )
    assert r.status_code == 200, r.text
    # Confirmar revocó el token viejo: entrar de nuevo con TOTP.
    r = client.post(
        "/api/auth/login",
        json={"username": "f3admin3", "password": "Admin2faPass12", "totp_code": _totp_now(secret)},
    )
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # Reemitir con el 2FA activo: 409 (no se deja la cuenta a medias).
    r = client.post("/api/auth/2fa/setup", headers=h)
    assert r.status_code == 409, r.text


# ------------------------------------------- tarea 4: super admin por registro --

def test_registro_publico_no_puede_pedir_super_admin(client, admin_headers):
    # Aunque el cuerpo pida rol super_admin / is_admin, el registro
    # público lo ignora: la cuenta nace siempre prueba, sin admin.
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/register",
        json={
            "username": "f4intruso",
            "password": "IntrusoPass12",
            "challenge_id": cid,
            "answer": answer,
            "terms_accepted": True,
            "role": "super_admin",
            "is_admin": True,
            "is_super_admin": True,
        },
    )
    assert r.status_code == 201, r.text
    users = client.get("/api/users", headers=admin_headers).json()
    intruso = [u for u in users if u["username"] == "f4intruso"][0]
    assert intruso["role"] == "prueba"
    assert intruso["is_admin"] is False
    assert intruso["is_super_admin"] is False
    # Y tras aprobar, tampoco puede auto-promoverse.
    _approve(client, admin_headers, "f4intruso")
    r = _login(client, "f4intruso", "IntrusoPass12")
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.patch(
        f"/api/users/{intruso['id']}", json={"role": "super_admin"}, headers=h
    )
    assert r.status_code == 403, r.text


def test_crear_super_admin_exige_super_admin(client, admin_headers):
    # Un admin plano (no super) no puede crear un super admin.
    r = client.post(
        "/api/users",
        json={"username": "f4plano", "password": "PlanoPass123", "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    plano_h = _login(client, "f4plano", "PlanoPass123")
    assert plano_h.status_code == 200, plano_h.text
    plano_h = {"Authorization": f"Bearer {plano_h.json()['access_token']}"}
    r = client.post(
        "/api/users",
        json={"username": "f4super2", "password": "SuperPass123", "role": "super_admin"},
        headers=plano_h,
    )
    assert r.status_code == 403, r.text
    # El super admin sí puede.
    r = client.post(
        "/api/users",
        json={"username": "f4super2", "password": "SuperPass123", "role": "super_admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "super_admin"
    # Limpieza: el super admin degrada y borra la cuenta extra.
    uid = r.json()["id"]
    assert client.patch(
        f"/api/users/{uid}", json={"role": "prueba"}, headers=admin_headers
    ).status_code == 200
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204
    assert client.delete(
        f"/api/users/{[u for u in client.get('/api/users', headers=admin_headers).json() if u['username'] == 'f4plano'][0]['id']}",
        headers=admin_headers,
    ).status_code == 204


# --------------------------------------- tarea 5: aislamiento de datos + H-02 --

def _guest_headers(client):
    cid, answer = _challenge(client)
    r = client.post(
        "/api/auth/guest", json={"challenge_id": cid, "challenge_answer": answer}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _course_id(client, headers, slug):
    courses = client.get("/api/academy/courses", headers=headers).json()
    return [c for c in courses if c["slug"] == slug][0]["id"]


def test_h02_invitado_no_descarga_pdf_pago(client, admin_headers):
    guest_h = _guest_headers(client)
    ebook_id = _course_id(client, admin_headers, "manual-ia-emprendedores")
    r = client.get(f"/api/academy/courses/{ebook_id}/download", headers=guest_h)
    assert r.status_code == 403, r.text
    assert "pago" in r.json()["detail"]


def test_h02_invitado_si_descarga_guia_gratuita(client):
    guest_h = _guest_headers(client)
    guia_id = _course_id(client, guest_h, "guia-comandos-prompts-visuales")
    r = client.get(f"/api/academy/courses/{guia_id}/download", headers=guest_h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"


def test_h02_cuenta_registrada_si_descarga_pdf_pago(client, viewer_headers):
    ebook_id = _course_id(client, viewer_headers, "manual-ia-emprendedores")
    r = client.get(
        f"/api/academy/courses/{ebook_id}/download", headers=viewer_headers
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"


def _make_linked_client(client, admin_headers, username, contact_name):
    """Crea usuario prueba aprobado + contacto CRM y los vincula."""
    r = client.post(
        "/api/users",
        json={"username": username, "password": "VinculoPass12", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code in (201, 409), r.text
    uid = r.json()["id"] if r.status_code == 201 else [
        u for u in client.get("/api/users", headers=admin_headers).json()
        if u["username"] == username
    ][0]["id"]
    _approve(client, admin_headers, username)
    r = client.post(
        "/api/crm/contacts",
        json={"name": contact_name, "email": f"{username}@example.com"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    contact_id = r.json()["id"]
    r = client.post(
        "/api/business/marketing/portal/vinculos",
        json={"user_id": uid, "contact_id": contact_id},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    r = _login(client, username, "VinculoPass12")
    assert r.status_code == 200, r.text
    return (
        {"Authorization": f"Bearer {r.json()['access_token']}"},
        uid,
        contact_id,
    )


def test_aislamiento_dos_clientes_vinculados(client, admin_headers):
    h_a, _uid_a, contact_a = _make_linked_client(client, admin_headers, "f5cliA", "Cliente A")
    h_b, _uid_b, contact_b = _make_linked_client(client, admin_headers, "f5cliB", "Cliente B")
    # Facturas: una por cliente (el admin las crea).
    for contact_id, name in ((contact_a, "Cliente A"), (contact_b, "Cliente B")):
        r = client.post(
            "/api/facturas/invoices",
            json={
                "contact_id": contact_id,
                "client_name": name,
                "items": [{"description": "Servicio", "qty": 1, "unit_price": 100}],
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
    # Cada cliente ve SOLO lo suyo en el portal...
    me_a = client.get("/api/business/marketing/portal/me", headers=h_a).json()
    assert me_a["contact"]["id"] == contact_a
    fact_a = client.get("/api/business/marketing/portal/facturas", headers=h_a).json()
    assert len(fact_a) == 1 and fact_a[0]["contact_id"] == contact_a
    fact_b = client.get("/api/business/marketing/portal/facturas", headers=h_b).json()
    assert len(fact_b) == 1 and fact_b[0]["contact_id"] == contact_b
    # ...y el ?contact_id= del otro se ignora (el contacto se resuelve
    # en servidor, nunca viene del cliente).
    me_a_otro = client.get(
        f"/api/business/marketing/portal/me?contact_id={contact_b}", headers=h_a
    ).json()
    assert me_a_otro["contact"]["id"] == contact_a
    fact_a_otro = client.get(
        f"/api/business/marketing/portal/facturas?contact_id={contact_b}", headers=h_a
    ).json()
    assert len(fact_a_otro) == 1 and fact_a_otro[0]["contact_id"] == contact_a


def test_cliente_vinculado_bloqueado_en_rutas_no_portal(client, admin_headers):
    h_a, _u, _c = _make_linked_client(client, admin_headers, "f5cliC", "Cliente C")
    for path in (
        "/api/crm/contacts",
        "/api/facturas/invoices",
        "/api/correos/logs",
        "/api/inventario/items",
        "/api/business/marketing/notes",
    ):
        r = client.get(path, headers=h_a)
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"


def test_prueba_no_ve_datos_de_negocio(client, viewer_headers):
    for path in (
        "/api/crm/contacts",
        "/api/facturas/invoices",
        "/api/correos/logs",
        "/api/inventario/items",
        "/api/business/marketing/notes",
        "/api/crm/contacts/resumen",
    ):
        r = client.get(path, headers=viewer_headers)
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"


def test_invitado_no_ve_datos_de_negocio(client):
    guest_h = _guest_headers(client)
    for path in ("/api/crm/contacts", "/api/facturas/invoices", "/api/inventario/items"):
        r = client.get(path, headers=guest_h)
        assert r.status_code in (401, 403), f"{path}: {r.status_code} {r.text}"


# -------------------------------------------------- tarea 6: auditoría admin --

def test_audit_log_solo_super_admin(client, admin_headers, viewer_headers):
    # El admin semilla ES super admin: lee el registro.
    r = client.get("/api/admin/audit-log", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    # Un admin plano y un prueba reciben 403.
    r = client.post(
        "/api/users",
        json={"username": "f6plano", "password": "PlanoPass123", "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    plano_h = _login(client, "f6plano", "PlanoPass123")
    plano_h = {"Authorization": f"Bearer {plano_h.json()['access_token']}"}
    assert client.get("/api/admin/audit-log", headers=plano_h).status_code == 403
    assert client.get("/api/admin/audit-log", headers=viewer_headers).status_code == 403
    # Limpieza.
    uid = [u for u in client.get("/api/users", headers=admin_headers).json() if u["username"] == "f6plano"][0]["id"]
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204


def test_audit_log_registra_acciones_de_admin(client, admin_headers):
    # Crear un usuario deja huella con quién/cuándo/qué.
    r = client.post(
        "/api/users",
        json={"username": "f6audit", "password": "AuditPass123", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    rows = client.get(
        "/api/admin/audit-log", params={"action": "users.create"}, headers=admin_headers
    ).json()
    # El id se reutiliza en SQLite tras borrar (f6plano se borró en el
    # test anterior): se filtra también por el detalle del nombre.
    hits = [
        x
        for x in rows
        if x["entity_id"] == str(uid) and x["details"].get("username") == "f6audit"
    ]
    assert len(hits) == 1
    assert hits[0]["actor_username"] == "admin"
    assert hits[0]["details"]["username"] == "f6audit"
    assert hits[0]["created_at"]
    # Cambiar el rol también queda registrado.
    assert client.patch(
        f"/api/users/{uid}", json={"role": "admin"}, headers=admin_headers
    ).status_code == 200
    rows = client.get(
        "/api/admin/audit-log", params={"action": "users.update"}, headers=admin_headers
    ).json()
    assert any(x["entity_id"] == str(uid) for x in rows)
    # Borrarlo también (la fila de auditoría sobrevive al borrado).
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204
    rows = client.get(
        "/api/admin/audit-log", params={"action": "users.delete"}, headers=admin_headers
    ).json()
    assert any(x["entity_id"] == str(uid) for x in rows)


def test_audit_log_kill_switch_y_exchange(client, admin_headers):
    r = client.post("/api/risk/kill-switch", headers=admin_headers)
    assert r.status_code == 200, r.text
    rows = client.get(
        "/api/admin/audit-log", params={"action": "risk.kill_switch"}, headers=admin_headers
    ).json()
    assert len(rows) >= 1
    assert rows[0]["actor_username"] == "admin"
    assert client.post(
        "/api/risk/kill-switch/deactivate", headers=admin_headers
    ).status_code == 200
    rows = client.get(
        "/api/admin/audit-log",
        params={"action": "risk.kill_switch_deactivate"},
        headers=admin_headers,
    ).json()
    assert len(rows) >= 1
    # Registrar una conexión de exchange también se audita.
    r = client.post(
        "/api/exchange/connections",
        json={"exchange": "kraken", "label": "f6-test"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    rows = client.get(
        "/api/admin/audit-log",
        params={"action": "exchange.connection_registered"},
        headers=admin_headers,
    ).json()
    assert any(x["details"].get("exchange") == "kraken" for x in rows)


# --------------------------------- tarea 7: interruptor de trading real --

def test_kill_switch_solo_super_admin(client, admin_headers):
    # Admin plano: 403 en activar y en desactivar.
    r = client.post(
        "/api/users",
        json={"username": "f7plano", "password": "PlanoPass123", "role": "admin"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    plano = _login(client, "f7plano", "PlanoPass123")
    plano_h = {"Authorization": f"Bearer {plano.json()['access_token']}"}
    assert client.post("/api/risk/kill-switch", headers=plano_h).status_code == 403
    assert client.post(
        "/api/risk/kill-switch/deactivate", headers=plano_h
    ).status_code == 403
    assert client.post(
        "/api/simulation/mode", json={"mode": "paper"}, headers=plano_h
    ).status_code == 403
    # Super admin: 200 en los tres.
    assert client.post("/api/risk/kill-switch", headers=admin_headers).status_code == 200
    assert client.post(
        "/api/risk/kill-switch/deactivate", headers=admin_headers
    ).status_code == 200
    r = client.post(
        "/api/simulation/mode", json={"mode": "paper"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["current"] == "paper"
    # Limpieza: modo de vuelta a simulation y borrar el admin plano.
    assert client.post(
        "/api/simulation/mode", json={"mode": "simulation"}, headers=admin_headers
    ).status_code == 200
    uid = [u for u in client.get("/api/users", headers=admin_headers).json() if u["username"] == "f7plano"][0]["id"]
    assert client.delete(f"/api/users/{uid}", headers=admin_headers).status_code == 204


def test_trading_real_sigue_apagado(client, admin_headers):
    # El flag del servidor sigue en False: health y system lo dicen.
    assert client.get("/api/health").json()["mode"] == "demo"
    status = client.get("/api/system/status", headers=admin_headers).json()
    assert status["mode"] == "demo"
    assert status["data_source"] == "DEMO"
    # Ni el super admin puede poner modo real con el flag apagado.
    r = client.post(
        "/api/simulation/mode", json={"mode": "real"}, headers=admin_headers
    )
    assert r.status_code == 403, r.text
    # Y el modo sigue siendo simulation (no cambió nada).
    modes = client.get("/api/simulation/modes", headers=admin_headers).json()
    assert modes["current"] == "simulation"
    assert modes["real_enabled"] is False
