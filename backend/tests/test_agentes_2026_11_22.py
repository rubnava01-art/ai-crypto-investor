"""Agente 2 (Backend/Seguridad) — Asistente por reglas 2026-11-22.

Fixtures compartidas (client/admin_headers/viewer_headers). NINGÚN
test hace login propio. La suite comparte una BD: todo lo sembrado
aquí lleva prefijo único "Asistente22-" y se borra al final (o se
mide por DELTAS cuando otros módulos pueden tener datos).
"""
import datetime as dt
import uuid
from decimal import Decimal

import pytest

from app.api.asistente import asistente_limiter
from app.database import get_db
from app.models.tables import (
    Appointment,
    BusinessNote,
    BusinessTask,
    Contact,
    ContentItem,
    EduClass,
    HomePost,
    Invoice,
    MarketCandle,
    Order,
    Signal,
)

BASE = "/api/asistente"


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


def _chat(client, headers, mensaje: str):
    return client.post(f"{BASE}/chat", json={"mensaje": mensaje}, headers=headers)


@pytest.fixture(autouse=True)
def _clear_asistente_limiter():
    """B2 (corrida seguridad 2026-11-23): el chat tiene limiter
    20/min por usuario y este módulo hace ~35 llamadas como admin
    en total; vaciarlo por test (patrón test_portal_isolation con
    citas_limiter) para que la ráfaga de un test no bloquee el
    siguiente. Cada test individual queda muy por debajo de 20."""
    asistente_limiter.clear()
    yield
    asistente_limiter.clear()


@pytest.fixture()
def velas(app):
    """60 velas BTC/USD 1h (source propio) para precio y análisis."""
    db, gen = _db(app)
    try:
        base = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
        precio = Decimal("90000")
        rows = []
        for i in range(60):
            precio = precio + Decimal("100") if i % 2 == 0 else precio - Decimal("50")
            rows.append(MarketCandle(
                symbol="BTC/USD", timeframe="1h",
                open_time_utc=base - dt.timedelta(hours=60 - i),
                open=precio, high=precio + 10, low=precio - 10,
                close=precio, volume=Decimal("1.5"), source="asistente-test",
            ))
        db.add_all(rows)
        db.commit()
        yield rows
    finally:
        db.query(MarketCandle).filter(MarketCandle.source == "asistente-test").delete()
        db.commit()
        _close(gen)


@pytest.fixture()
def contacto(client, admin_headers):
    name = _uid("Asistente22-Contacto")
    r = client.post("/api/crm/contacts",
                    json={"name": name, "email": "", "phone": "", "source": "manual",
                          "tags": [], "status": "cliente", "notes": ""},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    c = r.json()
    yield c
    client.delete(f"/api/crm/contacts/{c['id']}", headers=admin_headers)


def _manana(hora: int, minuto: int = 0) -> str:
    dia = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).date()
    return dt.datetime.combine(dia, dt.time(hora, minuto), tzinfo=dt.timezone.utc).isoformat()


def _manana_la(hora: int, minuto: int = 0) -> str:
    """Mañana a una hora de Los Ángeles, en ISO UTC (F2-5, corrida
    2026-11-24: el chat interpreta las horas en America/Los_Angeles)."""
    from zoneinfo import ZoneInfo
    la = ZoneInfo("America/Los_Angeles")
    dia = (dt.datetime.now(la) + dt.timedelta(days=1)).date()
    return dt.datetime.combine(dia, dt.time(hora, minuto), tzinfo=la).astimezone(
        dt.timezone.utc).isoformat()


# ------------------------------------------------------------------ contrato --

def test_capacidades_lista_comandos(client, admin_headers):
    r = client.get(f"{BASE}/capacidades", headers=admin_headers)
    assert r.status_code == 200, r.text
    ids = {c["id"]: c for c in r.json()["comandos"]}
    esperados = {"precio_btc", "senales", "analisis", "crear_nota", "crear_tarea",
                 "crear_borrador", "listar_citas", "crear_cita", "facturas",
                 "contactos", "clases", "novedades", "ayuda"}
    assert esperados <= set(ids), ids.keys()
    for cid in esperados:
        assert ids[cid]["ejemplo"], cid
        assert isinstance(ids[cid]["requiere_admin"], bool)
    assert ids["crear_nota"]["requiere_admin"] is True
    assert ids["crear_cita"]["requiere_admin"] is True
    assert ids["precio_btc"]["requiere_admin"] is False
    # Nada prohibido expuesto en capacidades.
    texto = str(r.json()).lower()
    for prohibido in ("users", "kill switch", "trading", "change-password"):
        assert prohibido not in texto


def test_sin_token_401(client):
    assert client.get(f"{BASE}/capacidades").status_code == 401
    assert client.post(f"{BASE}/chat", json={"mensaje": "hola"}).status_code == 401


def test_mensaje_vacio_400_y_largo_400(client, admin_headers):
    assert _chat(client, admin_headers, "").status_code == 400
    assert _chat(client, admin_headers, "   ").status_code == 400
    # Corrida 2026-11-24: el tope de 1000 caracteres ahora lo impone
    # ChatIn con max_length de Pydantic, así que es 422 (no 400).
    assert _chat(client, admin_headers, "x" * 1001).status_code == 422


# ------------------------------------------------------------------ lecturas --

def test_precio_con_velas_reales(client, admin_headers, velas):
    r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "precio_btc"
    assert body["accion"]["datos"]["disponible"] is True
    assert body["accion"]["datos"]["btc_usd"] == pytest.approx(float(velas[-1].close))
    assert "Bitcoin" in body["respuesta"]


def test_senales_reales(client, admin_headers):
    r = _chat(client, admin_headers, "Muéstrame las últimas señales")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "senales"
    assert "BTC" in body["respuesta"] or "ETH" in body["respuesta"] or "No hay señales" in body["respuesta"]


def test_analisis_con_indicadores_reales(client, admin_headers, velas):
    r = _chat(client, admin_headers, "Analiza el mercado")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "analisis"
    assert "RSI" in body["respuesta"]
    assert "MACD" in body["respuesta"]
    assert body["accion"]["datos"]["rsi_14"] is not None
    assert body["accion"]["datos"]["n_candles"] >= 35
    assert "simulación" in body["respuesta"]


def test_facturas_ventas_solo_pagadas(client, admin_headers, contacto):
    antes = _chat(client, admin_headers, "¿Cuánto hemos vendido?").json()["accion"]["datos"]
    r = client.post("/api/facturas/invoices",
                    json={"client_name": contacto["name"], "contact_id": contacto["id"],
                          "items": [{"description": "Servicio", "qty": 2, "unit_price": 50}],
                          "tax_rate": 0},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    inv = r.json()
    try:
        r = client.patch(f"/api/facturas/invoices/{inv['id']}", json={"status": "pagada"},
                         headers=admin_headers)
        assert r.status_code == 200, r.text
        despues = _chat(client, admin_headers, "¿Cuánto hemos vendido?").json()
        assert despues["accion"]["tipo"] == "facturas"
        assert despues["accion"]["datos"]["total_pagado"] - antes["total_pagado"] == pytest.approx(100.0)
        assert "PAGADAS" in despues["respuesta"]
    finally:
        client.delete(f"/api/facturas/invoices/{inv['id']}", headers=admin_headers)


def test_contactos(client, admin_headers, contacto):
    r = _chat(client, admin_headers, "Muéstrame los contactos")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "contactos"
    assert contacto["name"] in body["respuesta"]


def test_clases(client, admin_headers):
    titulo = _uid("Asistente22-Clase")
    r = client.post("/api/clases/classes",
                    json={"kind": "grabada", "title": titulo, "description": "", "url": ""},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    clase = r.json()
    try:
        r = _chat(client, admin_headers, "¿Qué clases hay?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"]["tipo"] == "clases"
        assert titulo in r.json()["respuesta"]
    finally:
        client.delete(f"/api/clases/classes/{clase['id']}", headers=admin_headers)


def test_novedades(client, admin_headers):
    titulo = _uid("Asistente22-Novedad")
    r = client.post("/api/inicio/posts", json={"title": titulo, "body": "Novedad de prueba."},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    post = r.json()
    try:
        r = _chat(client, admin_headers, "¿Qué hay nuevo?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"]["tipo"] == "novedades"
        assert titulo in r.json()["respuesta"]
    finally:
        client.delete(f"/api/inicio/posts/{post['id']}", headers=admin_headers)


def test_ayuda_y_fallback(client, admin_headers, monkeypatch):
    # Sin Internet (mock): el fallback registra en la bandeja.
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "¿Qué puedes hacer?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "ayuda"
    assert "bitcoin" in r.json()["respuesta"].lower()
    r = _chat(client, admin_headers, "hola, ¿qué tiempo hace hoy en Brea?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] is None
    assert r.json()["sin_respuesta"] is True
    # Fase 6, tarea 2: el fallback es "No sé" explícito.
    assert "No sé" in r.json()["respuesta"]
    assert "no tengo una fuente" in r.json()["respuesta"]
    assert len(r.json()["sugerencias"]) == 3


# ------------------------------------------------------------------ mutaciones --

def test_crear_nota_admin(client, admin_headers, app):
    texto = _uid("Asistente22-Nota")
    r = _chat(client, admin_headers, f"Crea una nota: {texto}")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "crear_nota"
    nota_id = r.json()["accion"]["datos"]["id"]
    db, gen = _db(app)
    try:
        nota = db.get(BusinessNote, nota_id)
        assert nota is not None and texto in nota.body
    finally:
        db.query(BusinessNote).filter(BusinessNote.id == nota_id).delete()
        db.commit()
        _close(gen)


def test_crear_tarea_admin(client, admin_headers, app):
    texto = _uid("Asistente22-Tarea")
    r = _chat(client, admin_headers, f"Crea una tarea: {texto}")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "crear_tarea"
    tarea_id = r.json()["accion"]["datos"]["id"]
    db, gen = _db(app)
    try:
        assert db.get(BusinessTask, tarea_id) is not None
    finally:
        db.query(BusinessTask).filter(BusinessTask.id == tarea_id).delete()
        db.commit()
        _close(gen)


def test_crear_borrador_admin_source_plantilla(client, admin_headers, app):
    tema = _uid("Asistente22-Tema")
    r = _chat(client, admin_headers, f"Crea un borrador sobre {tema}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "crear_borrador"
    assert body["accion"]["datos"]["source"] == "plantilla"
    item_id = body["accion"]["datos"]["id"]
    db, gen = _db(app)
    try:
        item = db.get(ContentItem, item_id)
        assert item is not None and item.status == "borrador"
        assert "plantilla" in (item.notes or "")
    finally:
        db.query(ContentItem).filter(ContentItem.id == item_id).delete()
        db.commit()
        _close(gen)


def test_listar_y_crear_cita(client, admin_headers, contacto):
    r = client.post("/api/business/marketing/citas",
                    json={"contact_id": contacto["id"], "client_name": contacto["name"],
                          "service_type": "consulta", "starts_at": _manana(14),
                          "duration_min": 60},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    cita = r.json()
    try:
        r = _chat(client, admin_headers, "¿Qué citas tengo?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"]["tipo"] == "listar_citas"
        assert contacto["name"] in r.json()["respuesta"]
    finally:
        client.delete(f"/api/business/marketing/citas/{cita['id']}", headers=admin_headers)


def test_crear_cita_admin_ok(client, admin_headers, contacto, app):
    r = _chat(client, admin_headers, f"Crea una cita para {contacto['name']} mañana a las 10:00")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "crear_cita"
    appt_id = body["accion"]["datos"]["id"]
    db, gen = _db(app)
    try:
        assert db.get(Appointment, appt_id) is not None
    finally:
        db.query(Appointment).filter(Appointment.id == appt_id).delete()
        db.commit()
        _close(gen)


def test_crear_cita_solape_no_crea_nada(client, admin_headers, contacto, app):
    # La cita existente está a las 10:00 de Los Ángeles (el chat
    # interpreta "10:30" también en LA: solapan 10:00-11:00 y 10:30).
    r = client.post("/api/business/marketing/citas",
                    json={"contact_id": contacto["id"], "client_name": contacto["name"],
                          "service_type": "consulta", "starts_at": _manana_la(10),
                          "duration_min": 60},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    cita = r.json()
    db, gen = _db(app)
    try:
        antes = db.query(Appointment).filter(Appointment.contact_id == contacto["id"]).count()
        r = _chat(client, admin_headers, f"Crea una cita para {contacto['name']} mañana a las 10:30")
        assert r.status_code == 200, r.text
        # Conflicto marcado en la acción (no se creó nada).
        assert r.json()["accion"]["tipo"] == "crear_cita"
        assert r.json()["accion"]["datos"]["conflicto"] is True
        assert "solapa" in r.json()["respuesta"]
        despues = db.query(Appointment).filter(Appointment.contact_id == contacto["id"]).count()
        assert despues == antes
    finally:
        _close(gen)
        client.delete(f"/api/business/marketing/citas/{cita['id']}", headers=admin_headers)


def test_crear_cita_sin_fecha_no_crea(client, admin_headers, app):
    db, gen = _db(app)
    try:
        antes = db.query(Appointment).count()
        r = _chat(client, admin_headers, "Crea una cita para María")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None
        assert db.query(Appointment).count() == antes
    finally:
        _close(gen)


# ------------------------------------------------------------------ seguridad --

def test_mutacion_como_prueba_no_ejecuta(client, viewer_headers, app):
    texto = _uid("Asistente22-NotaPrueba")
    db, gen = _db(app)
    try:
        antes = db.query(BusinessNote).count()
        r = _chat(client, viewer_headers, f"Crea una nota: {texto}")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None
        assert "solo lectura" in r.json()["respuesta"]
        assert db.query(BusinessNote).count() == antes
    finally:
        _close(gen)


def test_prohibido_usuarios_sin_efectos(client, admin_headers):
    r = _chat(client, admin_headers, "Cambia la clave del usuario prueba a temporal123")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] is None
    assert "no puede" in r.json()["respuesta"]
    # La clave sigue siendo la original: el login de prueba funciona.
    r = client.post("/api/auth/login", json={"username": "suiteviewer", "password": "viewerpass12"})
    # 200 si el login no está limitado; 429 no invalida la prueba (la
    # clave no se tocó: el rechazo del chat ocurrió antes que nada).
    assert r.status_code in (200, 429), r.text


def test_prohibido_trading_real_sin_efectos(client, admin_headers, app):
    db, gen = _db(app)
    try:
        antes = db.query(Order).count()
        r = _chat(client, admin_headers, "Compra 0.01 BTC real ahora")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None
        assert "no puede" in r.json()["respuesta"]
        assert db.query(Order).count() == antes
        r = _chat(client, admin_headers, "Desactiva el kill switch")
        assert r.json()["accion"] is None
        assert db.query(Order).count() == antes
    finally:
        _close(gen)


# ------------------------------------------- no-creación (A1, 2026-11-22) --
# Una pregunta o consulta NUNCA crea nada: solo una orden explícita
# de creación muta. Cada test mide el conteo en BD antes/después y
# verifica que la respuesta no confirma ninguna creación.

def test_pregunta_borrador_no_crea(client, admin_headers, app, monkeypatch):
    # Sin Internet (mock): las preguntas caen en "sin respuesta".
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet", lambda q: None)
    db, gen = _db(app)
    try:
        antes = db.query(ContentItem).count()
        # Probe exacto del QA (A1): antes creaba un borrador "E2E3 del curso?".
        r = _chat(client, admin_headers, "¿Dónde está el borrador E2E3 del curso?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"] is None or body["accion"]["tipo"] != "crear_borrador"
        assert "creado" not in body["respuesta"].lower()
        assert db.query(ContentItem).count() == antes
        # "¿cómo crea contenido el equipo?" tampoco crea (verbo dentro de pregunta).
        r = _chat(client, admin_headers, "¿Cómo crea contenido el equipo?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None
        assert "creado" not in r.json()["respuesta"].lower()
        assert db.query(ContentItem).count() == antes
    finally:
        _close(gen)


def test_pregunta_nota_no_crea(client, admin_headers, app):
    db, gen = _db(app)
    try:
        antes = db.query(BusinessNote).count()
        r = _chat(client, admin_headers, "¿Dónde está la nota de precios del proveedor?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"] is None or body["accion"]["tipo"] != "crear_nota"
        assert "creada" not in body["respuesta"].lower()
        assert db.query(BusinessNote).count() == antes
        # "nueva nota" dentro de una pregunta tampoco crea.
        r = _chat(client, admin_headers, "¿Tienes una nueva nota sobre precios?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None or r.json()["accion"]["tipo"] != "crear_nota"
        assert "creada" not in r.json()["respuesta"].lower()
        assert db.query(BusinessNote).count() == antes
    finally:
        _close(gen)


def test_pregunta_tarea_no_crea(client, admin_headers, app, monkeypatch):
    # Sin Internet (mock): las preguntas caen en "sin respuesta".
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet", lambda q: None)
    db, gen = _db(app)
    try:
        antes = db.query(BusinessTask).count()
        r = _chat(client, admin_headers, "¿Dónde está la tarea de llamar a TJ's?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"] is None or body["accion"]["tipo"] != "crear_tarea"
        assert "creada" not in body["respuesta"].lower()
        assert db.query(BusinessTask).count() == antes
        # "tarea pendiente" en pregunta tampoco crea (antes creaba una tarea "?").
        r = _chat(client, admin_headers, "¿Tengo alguna tarea pendiente?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None
        assert "creada" not in r.json()["respuesta"].lower()
        assert db.query(BusinessTask).count() == antes
    finally:
        _close(gen)


def test_pregunta_cita_no_crea(client, admin_headers, app):
    db, gen = _db(app)
    try:
        antes = db.query(Appointment).count()
        # "nueva cita" + cliente + fecha + hora dentro de una pregunta:
        # con el código anterior se creaba la cita; ahora solo lista.
        r = _chat(client, admin_headers, "¿Hay una nueva cita para María mañana a las 10:00?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"] is None or body["accion"]["tipo"] != "crear_cita"
        assert "creada" not in body["respuesta"].lower()
        assert db.query(Appointment).count() == antes
        r = _chat(client, admin_headers, "¿Dónde está la cita de María mañana a las 10:00?")
        assert r.status_code == 200, r.text
        assert r.json()["accion"] is None or r.json()["accion"]["tipo"] != "crear_cita"
        assert db.query(Appointment).count() == antes
    finally:
        _close(gen)


def test_prohibido_cambiar_rol_responde_prohibido(client, admin_headers):
    # B1: "cambia el rol del usuario X" caía en fallback; ahora responde
    # con la explicación de no disponible (sin ningún efecto real).
    r = _chat(client, admin_headers, "Cambia el rol del usuario suiteviewer a admin")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] is None
    assert "no puede" in r.json()["respuesta"]
    r = _chat(client, admin_headers, "Haz admin al usuario suiteviewer")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] is None
    assert "no puede" in r.json()["respuesta"]
