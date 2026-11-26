"""Fase 7 mejoras-v1 — Pagos (preparar, NO activar): suscripción en BD
+ API, cancelación en un clic, aviso de fin de prueba y pasarela sin
configurar. Sin cobro real en ningún test: todo es estructura local.
"""
import datetime as dt
import uuid

import pytest

from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import Suscripcion, User
from app.pagos_proveedor import (
    PagosProveedor,
    ProveedorNoConfiguradoError,
    estado_proveedor,
    obtener_proveedor,
    proveedor_configurado,
)

MIA = "/api/suscripciones/mia"
CANCELAR = "/api/suscripciones/mia/cancelar"
ADMIN = "/api/suscripciones/admin"
AVISOS = "/api/suscripciones/admin/avisos-prueba"


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


def _mk_user(client, admin_headers):
    username = _uid("f7")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    token = create_access_token(
        username, user_id=user["id"], token_version=user.get("token_version") or 0
    )
    return user, {"Authorization": f"Bearer {token}"}


def _activar(client, admin_headers, user_id, plan="esencial", estado="prueba_activa"):
    r = client.post(
        ADMIN,
        json={"user_id": user_id, "plan": plan, "estado": estado},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["suscripcion"]


def _sembrar_prueba(app, user_id, plan, estado, prueba_fin):
    db, gen = _db(app)
    try:
        sub = Suscripcion(
            user_id=user_id,
            plan=plan,
            estado=estado,
            prueba_inicio=prueba_fin - dt.timedelta(days=12),
            prueba_fin=prueba_fin,
            renovacion_en=prueba_fin,
            acceso_hasta=prueba_fin,
        )
        db.add(sub)
        db.commit()
        return sub.id
    finally:
        _close(gen)


# --------------------------------------------- tarea 1: estructura --

def test_f7_sin_suscripcion_mia_es_null_y_pago_no_activo(client, admin_headers):
    _user, headers = _mk_user(client, admin_headers)
    r = client.get(MIA, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["suscripcion"] is None
    assert body["pago_en_linea"]["configurado"] is False
    assert "no está activo" in body["pago_en_linea"]["mensaje"]


def test_f7_admin_activa_prueba_14_dias(client, admin_headers):
    user, _h = _mk_user(client, admin_headers)
    sub = _activar(client, admin_headers, user["id"], "crecimiento", "prueba_activa")
    assert sub["plan"] == "crecimiento"
    assert sub["plan_nombre"] == "Crecimiento"
    assert sub["precio_mensual_usd"] == 49
    assert sub["estado"] == "prueba_activa"
    assert sub["estado_efectivo"] == "prueba_activa"
    assert sub["acceso_activo"] is True
    inicio = dt.datetime.fromisoformat(sub["prueba_inicio"])
    fin = dt.datetime.fromisoformat(sub["prueba_fin"])
    assert (fin - inicio).days == 14
    assert sub["dias_restantes_prueba"] in (13, 14)


def test_f7_admin_activa_pagada_y_alias_total(client, app, admin_headers):
    user, _h = _mk_user(client, admin_headers)
    sub = _activar(client, admin_headers, user["id"], "total", "activa")
    assert sub["plan"] == "negocio_total"
    assert sub["plan_nombre"] == "Negocio Total"
    assert sub["precio_mensual_usd"] == 99
    assert sub["estado"] == "activa"
    renov = dt.datetime.fromisoformat(sub["renovacion_en"])
    assert (renov - dt.datetime.now(dt.timezone.utc)).days in (29, 30)
    db, gen = _db(app)
    try:
        assert db.get(User, user["id"]).requested_plan == "total"
    finally:
        _close(gen)


def test_f7_admin_plan_invalido_es_422_en_espanol(client, admin_headers):
    user, _h = _mk_user(client, admin_headers)
    r = client.post(
        ADMIN,
        json={"user_id": user["id"], "plan": "oro", "estado": "activa"},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    assert "esencial" in r.text


def test_f7_admin_usuario_inexistente_es_404(client, admin_headers):
    r = client.post(
        ADMIN, json={"user_id": 999999, "plan": "esencial", "estado": "activa"},
        headers=admin_headers,
    )
    assert r.status_code == 404
    assert "No existe" in r.json()["detail"]


def test_f7_no_admin_no_puede_activar(client, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    r = client.post(
        ADMIN,
        json={"user_id": user["id"], "plan": "esencial", "estado": "activa"},
        headers=headers,
    )
    assert r.status_code == 403


# ------------------------------------------- tarea 2: cancelación --

def test_f7_cancelar_conserva_acceso_hasta_fin_prueba(client, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    sub = _activar(client, admin_headers, user["id"], "esencial", "prueba_activa")
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()["suscripcion"]
    assert body["estado"] == "cancelada"
    assert body["estado_efectivo"] == "cancelada"
    assert body["acceso_activo"] is True
    assert body["acceso_hasta"] == sub["prueba_fin"]
    assert "Conservas el acceso" in r.json()["mensaje"]
    assert "no se borran" in r.json()["mensaje"]
    # Sin borrar datos: la fila sigue.
    r = client.get(MIA, headers=headers)
    assert r.json()["suscripcion"]["estado"] == "cancelada"


def test_f7_cancelar_dos_veces_no_rompe(client, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    _activar(client, admin_headers, user["id"], "esencial", "activa")
    r1 = client.post(CANCELAR, headers=headers)
    assert r1.status_code == 200, r1.text
    r2 = client.post(CANCELAR, headers=headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["suscripcion"]["estado"] == "cancelada"
    assert "ya estaba cancelada" in r2.json()["mensaje"]


def test_f7_cancelar_no_afecta_a_otro_usuario(client, admin_headers):
    user_a, headers_a = _mk_user(client, admin_headers)
    user_b, headers_b = _mk_user(client, admin_headers)
    _activar(client, admin_headers, user_a["id"], "esencial", "activa")
    _activar(client, admin_headers, user_b["id"], "crecimiento", "activa")
    r = client.post(CANCELAR, headers=headers_a)
    assert r.status_code == 200, r.text
    # B sigue activa: el endpoint no recibe id de usuario, así que no
    # hay forma de cancelar la suscripción de otro.
    r = client.get(MIA, headers=headers_b)
    assert r.json()["suscripcion"]["estado"] == "activa"


def test_f7_cancelar_sin_suscripcion_es_404_en_espanol(client, admin_headers):
    _user, headers = _mk_user(client, admin_headers)
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 404
    assert r.json()["detail"] == "No tienes ninguna suscripción para cancelar."


def test_f7_cancelar_vencida_es_409(client, app, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    pasado = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    _sembrar_prueba(app, user["id"], "esencial", "vencida", pasado)
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 409
    assert "ya está vencida" in r.json()["detail"]


def test_f7_qa_h33_cancelar_en_pausa_con_fin_pasado_no_promete_acceso(
    client, app, admin_headers
):
    """H3-3 (QA Fase 7): en_pausa con renovacion_en ya pasada —
    cancelar no puede decir 'Conservas el acceso hasta <fecha
    pasada>' mientras acceso_activo es false. El mensaje dice que
    el acceso ya había terminado, con su fecha real."""
    user, headers = _mk_user(client, admin_headers)
    pasado = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=5)
    _sembrar_prueba(app, user["id"], "esencial", "en_pausa", pasado)
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["suscripcion"]["estado"] == "cancelada"
    assert body["suscripcion"]["acceso_activo"] is False
    assert "ya había terminado" in body["mensaje"]
    assert "Conservas el acceso" not in body["mensaje"]
    assert pasado.date().isoformat() in body["mensaje"]
    r = client.get(MIA, headers=headers)
    assert r.json()["suscripcion"]["acceso_activo"] is False


def test_f7_qa_h33_cancelar_en_pausa_con_fin_futuro_tampoco_promete_acceso(
    client, app, admin_headers
):
    """H3-3 (QA Fase 7): en_pausa con renovacion_en futura — la
    pausa ya suspendió el acceso, así que cancelar tampoco promete
    conservarlo hasta esa fecha."""
    user, headers = _mk_user(client, admin_headers)
    futuro = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=10)
    _sembrar_prueba(app, user["id"], "esencial", "en_pausa", futuro)
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 200, r.text
    assert "en pausa" in r.json()["mensaje"]
    assert "no tenías acceso activo" in r.json()["mensaje"]
    assert "Conservas el acceso" not in r.json()["mensaje"]
    r = client.get(MIA, headers=headers)
    assert r.json()["suscripcion"]["acceso_activo"] is False


def test_f7_qa_h33_cancelar_dos_veces_en_pausa_pasada_es_409(
    client, app, admin_headers
):
    """H3-3 (QA Fase 7): tras cancelar una en_pausa con fin pasado,
    el acceso ya terminó — un segundo cancelar ya no es idempotente
    200 sino 409 de vencida (la suscripción cancelada con
    acceso_hasta pasado se lee como vencida, igual que
    test_f7_cancelar_vencida_es_409)."""
    user, headers = _mk_user(client, admin_headers)
    pasado = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=5)
    _sembrar_prueba(app, user["id"], "esencial", "en_pausa", pasado)
    assert client.post(CANCELAR, headers=headers).status_code == 200
    r = client.post(CANCELAR, headers=headers)
    assert r.status_code == 409, r.text
    assert "ya está vencida" in r.json()["detail"]


# ---------------------------------- tarea 3: aviso de fin de prueba --

def test_f7_avisos_vence_en_3_dias_si_ya_vencida_no_cancelada_no(
    client, app, admin_headers
):
    ahora = dt.datetime.now(dt.timezone.utc)
    u_cerca, _ = _mk_user(client, admin_headers)
    u_lejos, _ = _mk_user(client, admin_headers)
    u_vencida, _ = _mk_user(client, admin_headers)
    u_cancelada, _ = _mk_user(client, admin_headers)
    _sembrar_prueba(app, u_cerca["id"], "esencial", "prueba_activa",
                    ahora + dt.timedelta(days=2, hours=12))
    _sembrar_prueba(app, u_lejos["id"], "crecimiento", "prueba_activa",
                    ahora + dt.timedelta(days=10))
    _sembrar_prueba(app, u_vencida["id"], "esencial", "prueba_activa",
                    ahora - dt.timedelta(days=1))
    sub_id = _sembrar_prueba(app, u_cancelada["id"], "esencial", "cancelada",
                             ahora + dt.timedelta(days=2))
    db, gen = _db(app)
    try:
        sub = db.get(Suscripcion, sub_id)
        sub.cancelada_en = ahora
        db.commit()
    finally:
        _close(gen)
    r = client.get(AVISOS, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dias"] == 3
    assert body["correo"]["estado"] == "pendiente"
    assert body["correo"]["motivo"] == "sin_proveedor_correo"
    ids = [a["user_id"] for a in body["avisos"]]
    assert ids == [u_cerca["id"]]
    aviso = body["avisos"][0]
    assert aviso["dias_restantes"] == 2
    assert aviso["correo"]["estado"] == "pendiente"
    assert "Sin proveedor" in aviso["correo"]["detalle"]


def test_f7_avisos_solo_admin(client, admin_headers):
    _user, headers = _mk_user(client, admin_headers)
    r = client.get(AVISOS, headers=headers)
    assert r.status_code == 403


def test_f7_qa_h32_frontera_banner_y_avisos_coinciden(client, app, admin_headers):
    """H3-2 (QA Fase 7): la frontera es la misma en los dos lados —
    días naturales completos restantes entre 0 y 3. Una prueba que
    vence en 3 días y 12 h tiene 3 días restantes: sale en el
    banner (floor 3) y DEBE salir en /admin/avisos-prueba. Una que
    vence en 4 días y 1 h (4 días restantes) no sale en ninguno."""
    ahora = dt.datetime.now(dt.timezone.utc)
    u_borde, _ = _mk_user(client, admin_headers)
    u_fuera, _ = _mk_user(client, admin_headers)
    _sembrar_prueba(app, u_borde["id"], "esencial", "prueba_activa",
                    ahora + dt.timedelta(days=3, hours=12))
    _sembrar_prueba(app, u_fuera["id"], "esencial", "prueba_activa",
                    ahora + dt.timedelta(days=4, hours=1))
    r = client.get(AVISOS, headers=admin_headers)
    assert r.status_code == 200, r.text
    # La BD de tests es compartida (sesión): otros tests del módulo
    # dejan pruebas en ventana, así que se comprueba pertenencia,
    # no igualdad exacta de la lista.
    avisos = {a["user_id"]: a for a in r.json()["avisos"]}
    assert u_borde["id"] in avisos
    assert u_fuera["id"] not in avisos
    assert avisos[u_borde["id"]]["dias_restantes"] == 3


# ----------------------------------- tarea 4: pasarela sin configurar --

def test_f7_pasarela_sin_configurar_no_cobra_ni_falla_en_silencio():
    assert proveedor_configurado() is False
    estado = estado_proveedor()
    assert estado["configurado"] is False
    assert estado["proveedor"] is None
    assert set(estado["pendientes"]) == {"paypal", "stripe"}
    proveedor = obtener_proveedor()
    assert isinstance(proveedor, PagosProveedor)
    with pytest.raises(ProveedorNoConfiguradoError, match="no está activo"):
        proveedor.crear_suscripcion(user_id=1, plan="esencial")
    with pytest.raises(ProveedorNoConfiguradoError, match="no está activo"):
        proveedor.cancelar_en_proveedor(proveedor_suscripcion_id="x")
    with pytest.raises(ProveedorNoConfiguradoError, match="no está activo"):
        proveedor.procesar_webhook(cuerpo=b"{}", firma=None)


# --------------------------- tarea 5: coherencia con el Asistente --

def test_f7_asistente_usa_plan_de_la_suscripcion(client, app, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    _activar(client, admin_headers, user["id"], "negocio_total", "activa")
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "total"
    assert r.json()["limite_diario"] == 1000


def test_f7_asistente_vencida_no_sube_el_limite(client, app, admin_headers):
    user, headers = _mk_user(client, admin_headers)
    pasado = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    _sembrar_prueba(app, user["id"], "negocio_total", "vencida", pasado)
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["plan"] == "prueba"
    assert r.json()["limite_diario"] == 10


def test_f7_qa_h22_activar_a_pendiente_es_409(client, admin_headers):
    """H2-2 (QA Fase 7): el registro público crea un usuario
    pendiente que no puede iniciar sesión; activarle una suscripción
    pondría a correr los 14 días de prueba antes de que pueda entrar.
    El admin debe aprobarlo primero."""
    import re

    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    username = _uid("f7pend")
    r = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": "pass1234abcd",
            "challenge_id": data["challenge_id"],
            "answer": int(m.group(1)) + int(m.group(2)),
            "terms_accepted": True,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    r = client.get("/api/users", headers=admin_headers)
    assert r.status_code == 200, r.text
    user_id = next(u["id"] for u in r.json() if u["username"] == username)
    r = client.post(
        ADMIN,
        json={"user_id": user_id, "plan": "esencial", "estado": "prueba_activa"},
        headers=admin_headers,
    )
    assert r.status_code == 409, r.text
    assert "pendiente de aprobación" in r.json()["detail"]
    # No se creó ninguna suscripción.
    r = client.get(f"/api/suscripciones/admin/usuario/{user_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["suscripcion"] is None


def test_f7_qa_h22_activar_a_aprobado_es_201(client, admin_headers):
    """H2-2 (QA Fase 7): mismo usuario, una vez aprobado en Control
    de usuarios, sí acepta la activación por el admin."""
    import re

    r = client.get("/api/auth/register-challenge")
    assert r.status_code == 200, r.text
    data = r.json()
    m = re.search(r"(\d+)\s*\+\s*(\d+)", data["question"])
    assert m, data["question"]
    username = _uid("f7aprob")
    r = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": "pass1234abcd",
            "challenge_id": data["challenge_id"],
            "answer": int(m.group(1)) + int(m.group(2)),
            "terms_accepted": True,
        },
    )
    assert r.status_code == 201, r.text
    r = client.get("/api/users", headers=admin_headers)
    assert r.status_code == 200, r.text
    user_id = next(u["id"] for u in r.json() if u["username"] == username)
    r = client.post(f"/api/users/{user_id}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    r = client.post(
        ADMIN,
        json={"user_id": user_id, "plan": "esencial", "estado": "prueba_activa"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["suscripcion"]["estado"] == "prueba_activa"


def _uso(client, headers):
    r = client.get("/api/asistente/uso", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_f7_qa_h21_pausar_por_admin_baja_el_limite(client, app, admin_headers):
    """H2-1 (QA Fase 7): flujo REAL por el endpoint admin — activar
    negocio_total/activa (total/1000) y luego poner en_pausa: el
    límite debe bajar a prueba/10, no quedarse en total/1000 por
    el requested_plan sincronizado al activar."""
    user, headers = _mk_user(client, admin_headers)
    _activar(client, admin_headers, user["id"], "negocio_total", "activa")
    assert _uso(client, headers)["limite_diario"] == 1000
    _activar(client, admin_headers, user["id"], "negocio_total", "en_pausa")
    uso = _uso(client, headers)
    assert uso["plan"] == "prueba"
    assert uso["limite_diario"] == 10


def test_f7_qa_h21_vencer_por_admin_baja_el_limite(client, app, admin_headers):
    """H2-1 (QA Fase 7): mismo flujo real con estado vencida."""
    user, headers = _mk_user(client, admin_headers)
    _activar(client, admin_headers, user["id"], "negocio_total", "activa")
    assert _uso(client, headers)["limite_diario"] == 1000
    _activar(client, admin_headers, user["id"], "negocio_total", "vencida")
    uso = _uso(client, headers)
    assert uso["plan"] == "prueba"
    assert uso["limite_diario"] == 10


def test_f7_qa_h21_vencimiento_natural_baja_el_limite(client, app, admin_headers):
    """H2-1 (QA Fase 7): fin de periodo pasado (vencimiento natural,
    sin que el admin toque el estado): el límite es prueba/10
    aunque requested_plan siga diciendo "total" — la fecha manda
    y la fila sin acceso ya no cae al plan elegido."""
    user, headers = _mk_user(client, admin_headers)
    sub = _activar(client, admin_headers, user["id"], "negocio_total", "activa")
    assert _uso(client, headers)["limite_diario"] == 1000
    db, gen = _db(app)
    try:
        fila = db.get(Suscripcion, sub["id"])
        fila.renovacion_en = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
        db.commit()
        assert db.get(User, user["id"]).requested_plan == "total"
    finally:
        _close(gen)
    uso = _uso(client, headers)
    assert uso["plan"] == "prueba"
    assert uso["limite_diario"] == 10
