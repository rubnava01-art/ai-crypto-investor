"""Corrida 2026-11-23, Agente 2 — chat con Internet + mejora propia
y aislamiento por perfil.

Fixtures compartidas (client, admin_headers, viewer_headers). NINGÚN
test hace login propio: el cliente vinculado acuña su token con
create_access_token (precedente test_portal_isolation). Sin Internet
real: el servicio de búsqueda se monkeypatchea. Las reglas enseñadas
se desactivan al final de cada test que las crea: un patrón como
"cuanto vale el bitcoin" seguiría vivo para los demás módulos.
"""
import uuid

from app.core.perfiles import MODULOS_TODOS
from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import PreguntaSinRespuesta

CHAT = "/api/asistente/chat"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _chat(client, headers, mensaje: str):
    return client.post(CHAT, json={"mensaje": mensaje}, headers=headers)


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _mk_linked_client(client, admin_headers):
    """Usuario prueba + contacto + vínculo; devuelve (headers, contact_id)."""
    username = _uid("cliente")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    r = client.post(
        "/api/crm/contacts",
        json={"name": f"Cliente {_uid('c')}", "email": "", "phone": "",
              "source": "manual", "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    contact = r.json()
    r = client.post(
        "/api/business/marketing/portal/vinculos",
        json={"user_id": user["id"], "contact_id": contact["id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = create_access_token(
        username, user_id=user["id"], token_version=user.get("token_version") or 0
    )
    return {"Authorization": f"Bearer {token}"}, contact["id"]


def _seed_pregunta_row(app, pregunta: str) -> int:
    """Fila de bandeja directa en BD (para enseñar reglas cuyo patrón
    casaría con una intención interna y nunca llegaría a la bandeja
    por chat, p. ej. "cuanto vale el bitcoin")."""
    db, gen = _db(app)
    try:
        row = PreguntaSinRespuesta(pregunta=pregunta, veces=1, estado="pendiente")
        db.add(row)
        db.commit()
        return row.id
    finally:
        _close(gen)


# ---------------------------------------------------------- perfil (Trabajo 2) --

def test_perfil_admin_ve_todos_los_modulos(client, admin_headers):
    r = client.get("/api/acceso/perfil", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    # La cuenta admin de la suite es super_admin (el dueño es super
    # al arrancar); lo que importa es que ve todos los módulos.
    assert body["role"] in ("admin", "super_admin")
    assert body["is_admin"] is True
    assert body["es_cliente_vinculado"] is False
    assert body["contacto_id"] is None
    assert set(body["modulos"]) == set(MODULOS_TODOS)


def test_perfil_prueba_solo_demo(client, viewer_headers):
    r = client.get("/api/acceso/perfil", headers=viewer_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "prueba"
    assert body["is_admin"] is False
    assert body["es_cliente_vinculado"] is False
    assert body["contacto_id"] is None
    assert body["modulos"] == [
        "asistente", "crear", "estudiar", "inicio", "perfil", "planes",
    ]


def test_perfil_cliente_vinculado_solo_lo_suyo(client, admin_headers):
    headers, contact_id = _mk_linked_client(client, admin_headers)
    r = client.get("/api/acceso/perfil", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "prueba"
    assert body["es_cliente_vinculado"] is True
    assert body["contacto_id"] == contact_id
    assert body["modulos"] == ["inicio", "perfil", "portal"]  # sin
    # "asistente" (dictamen QA 2026-11-23, opción B): el chat le
    # responde 403 por B1, así que el perfil no debe listar el módulo.


# ------------------------------------------------- gating por módulo (Trabajo 2) --

def test_prueba_403_en_modulos_de_datos(client, admin_headers, viewer_headers):
    paths = [
        "/api/facturas/invoices",
        "/api/business/marketing/citas",
        "/api/crm/contacts",
        "/api/market/prices",
        "/api/correos/templates",
        "/api/inventario/items",
        "/api/espacio/revelations",
        "/api/talento",
        "/api/riesgos",
        "/api/planillas",
        "/api/signals",
        "/api/backtest/runs",
        "/api/portfolio/balances",
    ]
    for path in paths:
        r = client.get(path, headers=viewer_headers)
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"
        r = client.get(path, headers=admin_headers)
        assert r.status_code == 200, f"{path} admin: {r.status_code} {r.text}"


def test_cliente_403_fuera_del_portal_y_200_a_lo_suyo(client, admin_headers):
    headers, contact_id = _mk_linked_client(client, admin_headers)
    for path in ("/api/crm/contacts", "/api/facturas/invoices",
                 "/api/market/prices", "/api/correos/templates"):
        r = client.get(path, headers=headers)
        assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"
    r = client.get("/api/business/marketing/portal/me", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["contact"]["id"] == contact_id
    r = client.get("/api/business/marketing/portal/citas", headers=headers)
    assert r.status_code == 200, r.text


def test_students_solo_admin(client, admin_headers, viewer_headers):
    courses = client.get("/api/academy/courses", headers=admin_headers).json()
    assert courses, "el catálogo de Academia debe estar sembrado"
    course_id = courses[0]["id"]
    r = client.get(f"/api/academy/courses/{course_id}/students",
                   headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.get(f"/api/academy/courses/{course_id}/students",
                   headers=admin_headers)
    assert r.status_code == 200, r.text


# ------------------------------------------------------- chat demo M1 (Trabajo 2) --

def test_chat_prueba_sin_datos_reales(client, admin_headers, viewer_headers):
    tag = _uid("ContactoDemo")
    r = client.post(
        "/api/crm/contacts",
        json={"name": tag, "email": "", "phone": "", "source": "manual",
              "tags": [], "status": "cliente", "notes": ""},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    for mensaje in ("Muéstrame los contactos", "¿Cuánto hemos vendido?",
                    "¿Qué citas tengo?"):
        r = _chat(client, viewer_headers, mensaje)
        assert r.status_code == 200, r.text
        assert "No disponible en la demo" in r.json()["respuesta"], r.json()
    # El admin sí ve los datos reales por chat.
    r = _chat(client, admin_headers, "Muéstrame los contactos")
    assert r.status_code == 200, r.text
    assert tag in r.json()["respuesta"]
    # Precios/señales siguen disponibles para prueba (M1 solo cierra
    # facturas, citas y contactos).
    r = _chat(client, viewer_headers, "¿Cuánto vale el bitcoin?")
    assert r.status_code == 200, r.text
    assert "No disponible en la demo" not in r.json()["respuesta"]


def test_chat_cliente_vinculado_403_incluidas_citas(client, admin_headers):
    """B1 cubre también las citas en el chat: el cliente vinculado
    recibe 403 antes que cualquier intención."""
    headers, _ = _mk_linked_client(client, admin_headers)
    r = _chat(client, headers, "¿Qué citas tengo?")
    assert r.status_code == 403, r.text
    r = client.get("/api/asistente/capacidades", headers=headers)
    assert r.status_code == 403, r.text


# ------------------------------------------------- Internet + ayuda (Trabajo 1) --

def test_chat_internet_mock_devuelve_fuente_y_fecha(
    client, admin_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet",
        lambda q: {"nombre": "DuckDuckGo",
                   "url": "https://example.org/ornitorrinco",
                   "texto": "Texto de prueba sobre los ornitorrincos."},
    )
    r = _chat(client, admin_headers, "¿Qué es un ornitorrinco?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "ornitorrincos" in body["respuesta"]
    assert body["fuente"] == {"nombre": "DuckDuckGo",
                              "url": "https://example.org/ornitorrinco"}
    assert body["consultado_en"], body
    assert body["sin_respuesta"] is False


def test_chat_catalogo_ayuda(client, admin_headers):
    r = _chat(client, admin_headers, "¿Cómo creo una factura?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "ayuda"
    assert body["accion"]["datos"]["tema"] == "crear_factura"
    assert "/facturas" in body["respuesta"]
    # «¿cómo cambio mi clave?» es ayuda, no un intento prohibido.
    r = _chat(client, admin_headers, "¿Cómo cambio mi clave?")
    assert r.status_code == 200, r.text
    assert "Mi perfil" in r.json()["respuesta"]
    assert "no puede hacer eso" not in r.json()["respuesta"]
    # La orden imperativa sigue bloqueada.
    r = _chat(client, admin_headers, "Cambia mi clave a secreto123456")
    assert r.status_code == 200, r.text
    assert "no puede hacer eso" in r.json()["respuesta"]


# ------------------------------------------------- bandeja y reglas (Trabajo 1) --

def test_pregunta_sin_respuesta_queda_en_bandeja_y_se_descarta(
    client, admin_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet", lambda q: None)
    pregunta = f"¿Qué es el zqxwvutl de prueba {uuid.uuid4().hex[:8]}?"
    r = _chat(client, admin_headers, pregunta)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sin_respuesta"] is True
    assert "No encontré información sobre eso" in body["respuesta"]
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    assert r.status_code == 200, r.text
    fila = next(p for p in r.json() if p["pregunta"] == pregunta)
    assert fila["veces"] == 1
    assert fila["estado"] == "pendiente"
    # Segunda vez: el contador sube, no se duplica la fila.
    _chat(client, admin_headers, pregunta)
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    fila = next(p for p in r.json() if p["pregunta"] == pregunta)
    assert fila["veces"] == 2
    # La bandeja es solo-admin y el descarte marca, no borra.
    r = client.get("/api/asistente/preguntas", headers={})
    assert r.status_code == 401
    r = client.delete(f"/api/asistente/preguntas/{fila['id']}",
                      headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "descartada"


def test_admin_crea_regla_desde_bandeja_y_chat_la_usa(
    client, admin_headers, viewer_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet", lambda q: None)
    pregunta = f"¿Cuál es el horario del zqxwvutl {uuid.uuid4().hex[:8]}?"
    r = _chat(client, admin_headers, pregunta)
    assert r.json()["sin_respuesta"] is True
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    fila = next(p for p in r.json() if p["pregunta"] == pregunta)
    respuesta = f"Respuesta enseñada {uuid.uuid4().hex[:8]}."
    r = client.post(
        f"/api/asistente/preguntas/{fila['id']}/regla",
        json={"respuesta": respuesta, "modulo": "inicio", "ruta": "/inicio"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    regla = r.json()
    assert regla["patron"] == pregunta
    assert regla["activo"] is True
    try:
        # La pregunta queda resuelta y la regla aparece en el listado.
        r = client.get("/api/asistente/preguntas?estado=resuelta",
                       headers=admin_headers)
        assert any(p["id"] == fila["id"] for p in r.json())
        r = client.get("/api/asistente/reglas", headers=admin_headers)
        assert any(g["id"] == regla["id"] for g in r.json())
        # El chat usa la regla (admin y prueba).
        for headers in (admin_headers, viewer_headers):
            r = _chat(client, headers, pregunta)
            assert r.status_code == 200, r.text
            assert respuesta in r.json()["respuesta"], r.json()
            assert r.json()["accion"]["tipo"] == "regla"
    finally:
        r = client.delete(f"/api/asistente/reglas/{regla['id']}",
                          headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["activo"] is False


def test_regla_ensenada_precede_a_intencion_interna(
    client, app, admin_headers
):
    """Una regla activa gana a la intención interna que casaría con
    el mismo texto (aquí, el precio de BTC)."""
    pregunta = "cuanto vale el bitcoin"
    pregunta_id = _seed_pregunta_row(app, pregunta)
    respuesta = f"Precio enseñado {uuid.uuid4().hex[:8]}."
    r = client.post(
        f"/api/asistente/preguntas/{pregunta_id}/regla",
        json={"respuesta": respuesta},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    regla_id = r.json()["id"]
    try:
        r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
        assert r.status_code == 200, r.text
        assert respuesta in r.json()["respuesta"], r.json()
        assert r.json()["accion"]["tipo"] == "regla"
    finally:
        r = client.delete(f"/api/asistente/reglas/{regla_id}",
                          headers=admin_headers)
        assert r.status_code == 200, r.text


def test_bandeja_y_reglas_solo_admin(client, viewer_headers):
    r = client.get("/api/asistente/preguntas", headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.get("/api/asistente/reglas", headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.post("/api/asistente/preguntas/1/regla",
                    json={"respuesta": "x"}, headers=viewer_headers)
    assert r.status_code == 403, r.text
    r = client.delete("/api/asistente/reglas/1", headers=viewer_headers)
    assert r.status_code == 403, r.text
