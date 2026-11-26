"""Corrida 2026-11-24 (chat-potencia), Agente 2 — backend.

Cubre los ítems del plan en backend/tests/test_agentes_2026_11_24_chat_potencia.py:
S-1/S-1b (registro idéntico + strip), F2-1 ranking/confianza, F2-2 AYUDAS,
F2-3 resumir módulo, F2-4 prohibido antes que reglas + 422 + tope 2000,
F2-5 citas en America/Los_Angeles + aclaraciones, F2-6 verbos por palabra
y falsos positivos de _PROHIBIDO, F2-7 idempotencia, F2-9 deny_linked_reader
en /api/chat/messages, F2-10 caché de reglas/backtest/paginación, F3-1..F3-8,
F4-1/F4-2/F4-4/F4-5 biblioteca, ChatIn max_length.

Fixtures compartidas (client, admin_headers, viewer_headers). Sin login
propio salvo el caso S-1b de strip (tolerante a 429 por el límite 10/min
compartido de la suite). Sin Internet real: se monkeypatchea donde hace falta.
"""
import json
import os
import time
import uuid

import pytest

from app.api import asistente as asistente_api
from app.api import market as market_api
from app.api.asistente import asistente_limiter
from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import (
    Appointment,
    BusinessNote,
    ContentItem,
    Invoice,
    PreguntaSinRespuesta,
    User,
)
from app.schemas.api import LoginRequest

CHAT = "/api/asistente/chat"


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _chat(client, headers, mensaje: str, extra_headers: dict | None = None):
    asistente_limiter.clear()
    h = dict(headers)
    if extra_headers:
        h.update(extra_headers)
    return client.post(CHAT, json={"mensaje": mensaje}, headers=h)


def _db(app):
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


def _close(gen) -> None:
    try:
        next(gen)
    except StopIteration:
        pass


def _seed_pregunta(app, pregunta: str) -> int:
    db, gen = _db(app)
    try:
        row = PreguntaSinRespuesta(pregunta=pregunta, veces=1, estado="pendiente")
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    finally:
        _close(gen)


def _mk_linked_client(client, admin_headers):
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


# ------------------------------------------------------------------ S-1 / S-1b --

def test_registro_duplicado_y_nuevo_cuerpo_identico(client, app):
    """S-1: nuevo y duplicado devuelven id null y created_at null."""
    username = _uid("reg24")
    password = "RegistroSeguro123"
    bodies = []
    for _ in range(2):
        r = client.get("/api/auth/register-challenge")
        assert r.status_code == 200, r.text
        ch = r.json()
        q = ch["question"].replace("¿Cuánto es ", "").replace("?", "")
        a, b = q.split(" + ")
        r = client.post("/api/auth/register", json={
            "username": username, "password": password,
            "challenge_id": ch["challenge_id"], "answer": int(a) + int(b), "terms_accepted": True,
        })
        assert r.status_code == 201, r.text
        bodies.append(r.json())
    assert bodies[0] == bodies[1], bodies
    assert bodies[0]["id"] is None and bodies[0]["created_at"] is None
    # Limpieza: borrar el usuario creado (y su fila pending).
    from app.models.tables import PendingActivation
    db, gen = _db(app)
    try:
        user = db.query(User).filter(User.username == username).first()
        assert user is not None
        db.query(PendingActivation).filter(PendingActivation.user_id == user.id).delete()
        db.query(User).filter(User.username == username).delete()
        db.commit()
    finally:
        _close(gen)


def test_registro_strip_422_y_login_strip(client, admin_headers):
    """S-1b: "   " -> 422 en registro; " ruben " -> "ruben" en login."""
    from pydantic import ValidationError
    from app.api.auth import RegisterRequest
    # Validador directo (sin gastar el límite de registro).
    # H1 (corrección QA Fase 2, 2026-11-25): terms_accepted es
    # obligatorio desde entonces; el flujo válido lo envía explícito.
    assert RegisterRequest(
        username=" ruben ", password="x" * 12, challenge_id="c", answer=1,
        terms_accepted=True,
    ).username == "ruben"
    with pytest.raises(ValidationError):
        RegisterRequest(username="   ", password="x" * 12, challenge_id="c", answer=1,
                        terms_accepted=True)
    assert LoginRequest(username=" ruben ", password="x").username == "ruben"
    with pytest.raises(ValidationError):
        LoginRequest(username="   ", password="x")
    # Por HTTP: el 422 de Pydantic llega antes que el challenge.
    r = client.post("/api/auth/register", json={
        "username": "   ", "password": "x" * 12,
        "challenge_id": "cualquiera", "answer": 1, "terms_accepted": True,
    })
    assert r.status_code == 422, r.text
    # Login con espacios alrededor del admin: entra como "admin".
    r = client.post("/api/auth/login", json={"username": " admin ", "password": "secret"})
    if r.status_code == 429:
        pytest.skip("límite de login 10/min de la suite (compartido)")
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ F2-1 --

def test_ranking_confianza_y_desempate_por_orden(client, admin_headers, app):
    """F2-1: confianza 0-100 en la respuesta; a igual puntuación gana
    el orden actual (borrador antes que listado de clases)."""
    r = _chat(client, admin_headers, "Analiza el mercado")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "analisis"
    assert isinstance(body["confianza"], (int, float)) and 0 <= body["confianza"] <= 100
    # "mercado" genérico solo: confianza baja.
    r = _chat(client, admin_headers, "mercado de camisetas")
    assert r.json()["accion"]["tipo"] == "analisis"
    assert r.json()["confianza"] <= 50
    # Empate borrador/clases ("curso"): gana crear_borrador por orden.
    db, gen = _db(app)
    try:
        antes = db.query(ContentItem).count()
        r = _chat(client, admin_headers, "Crea un borrador sobre el nuevo curso")
        assert r.json()["accion"]["tipo"] == "crear_borrador", r.json()
        assert db.query(ContentItem).count() == antes + 1
        db.query(ContentItem).filter(
            ContentItem.title == "el nuevo curso").delete()
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F2-2 --

def test_ayudas_ampliadas(client, admin_headers):
    """F2-2: Estudiar, Correos, CRM general y herramientas de Clases."""
    casos = [
        ("¿Cómo uso Correos?", "usar_correos"),
        ("¿Cómo uso el CRM?", "usar_crm"),
        ("¿Cómo uso Estudiar?", "usar_estudiar"),
        ("¿Dónde está la calculadora de interés compuesto?", "herramientas_clases"),
    ]
    for mensaje, tema in casos:
        r = _chat(client, admin_headers, mensaje)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "ayuda", (mensaje, body)
        assert body["accion"]["datos"]["tema"] == tema, (mensaje, body)


# ------------------------------------------------------------------ F2-3 --

def test_resumir_modulo_desde_registro_real(client, admin_headers):
    """F2-3: resumen de Estudiar con conteos reales, sin texto inventado."""
    r = client.get("/api/academy/courses", headers=admin_headers)
    assert r.status_code == 200, r.text
    n_cursos = len(r.json())
    r = _chat(client, admin_headers, "Resume el módulo Estudiar")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "resumen_modulo"
    assert body["accion"]["datos"]["modulo"] == "estudiar"
    assert body["accion"]["datos"]["ruta"] == "/estudiar"
    assert body["accion"]["datos"]["n_cursos"] == n_cursos
    assert "/estudiar" in body["respuesta"]
    r = _chat(client, admin_headers, "Resume el módulo Facturas")
    assert r.json()["accion"]["tipo"] == "resumen_modulo"
    assert r.json()["accion"]["datos"]["ruta"] == "/facturas"


# ------------------------------------------------------------------ F2-4 --

def test_regla_con_prohibido_422_y_tope_2000(client, admin_headers, app):
    """F2-4: patrón o respuesta con prohibidos -> 422; respuesta >2000 -> 422."""
    pid = _seed_pregunta(app, "compra btc ahora mismo por favor")
    try:
        r = client.post(f"/api/asistente/preguntas/{pid}/regla",
                        json={"respuesta": "Claro, lo compro."},
                        headers=admin_headers)
        assert r.status_code == 422, r.text
    finally:
        db, gen = _db(app)
        try:
            db.query(PreguntaSinRespuesta).filter(
                PreguntaSinRespuesta.id == pid).delete()
            db.commit()
        finally:
            _close(gen)
    pid2 = _seed_pregunta(app, _uid("pregunta-sana"))
    try:
        r = client.post(f"/api/asistente/preguntas/{pid2}/regla",
                        json={"respuesta": "x" * 2001},
                        headers=admin_headers)
        assert r.status_code == 422, r.text
    finally:
        db, gen = _db(app)
        try:
            db.query(PreguntaSinRespuesta).filter(
                PreguntaSinRespuesta.id == pid2).delete()
            db.commit()
        finally:
            _close(gen)


def test_prohibido_antes_que_regla_ensenada(client, admin_headers, app, monkeypatch):
    """F2-4: una regla enseñada no puede reabrir lo prohibido (la
    creación con patrón prohibido ya es 422; aquí se verifica que el
    bloqueo responde prohibido aunque existan reglas activas)."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "Cambia la clave del usuario prueba a temporal123")
    assert "no puede hacer eso" in r.json()["respuesta"]
    assert r.json()["accion"] is None


# ------------------------------------------------------------------ F2-5 --

def test_cita_hora_sin_ampm_y_fecha_ambigua_piden_aclaracion(
        client, admin_headers, app, monkeypatch):
    """F2-5: "a las 10" sin AM/PM y fecha "5/6" ambigua -> aclaracion, sin crear."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    db, gen = _db(app)
    try:
        antes = db.query(Appointment).count()
        r = _chat(client, admin_headers, "Crea una cita para María mañana a las 10")
        body = r.json()
        assert body["aclaracion"] is not None, body
        assert "mañana" in body["aclaracion"]["opciones"][0]
        assert "noche" in body["aclaracion"]["opciones"][1]
        assert body["accion"] is None
        r = _chat(client, admin_headers, "Crea una cita para María 5/6 a las 10:00")
        body = r.json()
        assert body["aclaracion"] is not None, body
        assert len(body["aclaracion"]["opciones"]) == 2
        assert db.query(Appointment).count() == antes
    finally:
        _close(gen)


def test_cita_hora_local_y_sin_solape_explicito(client, admin_headers, app):
    """F2-5: "10:00" se interpreta en LA (18:00 UTC en noviembre) y la
    confirmación dice que NO se comprobó el solape (sin contacto CRM)."""
    db, gen = _db(app)
    try:
        r = _chat(client, admin_headers, "Crea una cita para María mañana a las 10:00")
        body = r.json()
        assert body["accion"]["tipo"] == "crear_cita", body
        assert body["accion"]["datos"]["starts_at"].endswith("18:00:00+00:00"), body
        assert "hora de Los Ángeles" in body["respuesta"]
        assert "No se comprobó si se solapa" in body["respuesta"]
        assert body["accion"]["datos"]["solape_comprobado"] is False
        appt_id = body["accion"]["datos"]["id"]
        db.query(Appointment).filter(Appointment.id == appt_id).delete()
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F2-6 --

def test_verbos_por_palabra_y_prohibido_sin_falsos_positivos(
        client, admin_headers, app, monkeypatch):
    """F2-6: "recrear" no es "crea" (no muta); "Control de usuarios"
    como pregunta ya no se bloquea como prohibido."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    db, gen = _db(app)
    try:
        antes = db.query(BusinessNote).count()
        r = _chat(client, admin_headers, "Recrea una nota: prueba de verbo")
        assert r.json()["accion"] is None or r.json()["accion"]["tipo"] != "crear_nota"
        assert db.query(BusinessNote).count() == antes
        r = _chat(client, admin_headers, "¿Dónde está el Control de usuarios?")
        assert "no puede hacer eso" not in r.json()["respuesta"], r.json()
        assert r.json()["sin_respuesta"] is True
    finally:
        _close(gen)


# ------------------------------------------------------------------ F2-7 --

def test_idempotencia_reintento_no_duplica_nota(client, admin_headers, app):
    """F2-7: mismo Idempotency-Key en "crea una nota" -> segunda vez
    devuelve la respuesta guardada sin crear otra nota."""
    texto = _uid("NotaIdem")
    headers = {"Idempotency-Key": f"idem-{texto}"}
    db, gen = _db(app)
    try:
        antes = db.query(BusinessNote).count()
        r1 = _chat(client, admin_headers, f"Crea una nota: {texto}", extra_headers=headers)
        assert r1.status_code == 200, r1.text
        assert r1.json()["accion"]["tipo"] == "crear_nota"
        assert r1.json().get("idempotent_replay") is not True
        r2 = _chat(client, admin_headers, f"Crea una nota: {texto}", extra_headers=headers)
        assert r2.json()["accion"]["datos"]["id"] == r1.json()["accion"]["datos"]["id"]
        assert r2.json().get("idempotent_replay") is True
        assert db.query(BusinessNote).count() == antes + 1
        db.query(BusinessNote).filter(BusinessNote.id == r1.json()["accion"]["datos"]["id"]).delete()
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F2-9 --

def test_chat_vivo_vinculado_403_y_prueba_200(client, admin_headers, viewer_headers):
    """F2-9: deny_linked_reader en GET/POST /api/chat/messages."""
    headers, _ = _mk_linked_client(client, admin_headers)
    assert client.get("/api/chat/messages", headers=headers).status_code == 403
    assert client.post("/api/chat/messages", json={"text": "hola"},
                       headers=headers).status_code == 403
    r = client.get("/api/chat/messages", headers=viewer_headers)
    assert r.status_code == 200, r.text


# ------------------------------------------------------------------ F2-10 --

def test_paginacion_preguntas_y_reglas(client, admin_headers):
    """F2-10: limit/offset en /preguntas y /reglas."""
    r = client.get("/api/asistente/preguntas?limit=1&offset=0", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) <= 1
    r = client.get("/api/asistente/reglas?limit=1&offset=0", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) <= 1


def test_cache_reglas_se_invalida_al_desactivar(client, admin_headers, app):
    """F2-10: la caché de reglas activas se invalida al desactivar."""
    patron = _uid("patron-cache-reglas")
    pid = _seed_pregunta(app, patron)
    regla_id = None
    try:
        r = client.post(f"/api/asistente/preguntas/{pid}/regla",
                        json={"respuesta": "Respuesta cacheada de prueba."},
                        headers=admin_headers)
        assert r.status_code == 201, r.text
        regla_id = r.json()["id"]
        # La regla responde (caché poblada) y al desactivarla deja de responder.
        r = _chat(client, admin_headers, patron)
        assert r.json()["accion"]["tipo"] == "regla", r.json()
        r = client.delete(f"/api/asistente/reglas/{regla_id}", headers=admin_headers)
        assert r.status_code == 200, r.text
        db2, gen2 = _db(app)
        try:
            assert asistente_api._regla_activa(db2, patron) is None
        finally:
            _close(gen2)
    finally:
        db, gen = _db(app)
        try:
            db.query(PreguntaSinRespuesta).filter(
                PreguntaSinRespuesta.id == pid).delete()
            db.commit()
        finally:
            _close(gen)


def test_backtest_cacheado_por_mtime():
    """F2-10/F3-6: el resumen del último backtest se cachea por mtime."""
    from app.api.backtest import RUNS_DIR
    os.makedirs(RUNS_DIR, exist_ok=True)
    path = os.path.join(RUNS_DIR, "TEST24-BTCUSD-1h-20261124000000.json")
    payload = {"run_id": "BTCUSD-1h-20261124000000", "symbol": "BTC/USD",
               "timeframe": "1h", "n_candles": 100,
               "metrics": {"net_return_pct": 1.5}}
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        asistente_api._BACKTEST_CACHE.update({"mtime": None, "path": None, "result": None})
        primero = asistente_api._ultimo_backtest()
        segundo = asistente_api._ultimo_backtest()
        assert primero is not None and primero is segundo
        assert primero["fecha"].startswith("2026-11-24")
    finally:
        if os.path.exists(path):
            os.remove(path)
        asistente_api._BACKTEST_CACHE.update({"mtime": None, "path": None, "result": None})


# ------------------------------------------------------------------ F3-1 --

def test_fuente_y_consultado_en_en_todos_los_handlers(client, admin_headers, monkeypatch):
    """F3-1: fuente + consultado_en en precio, señales, análisis,
    facturas, contactos, clases, novedades y ayuda."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    for mensaje in ("¿Cuánto vale el bitcoin?", "Muéstrame las últimas señales",
                    "Analiza el mercado", "¿Cuánto hemos vendido?",
                    "Muéstrame los contactos", "¿Qué clases hay?",
                    "¿Qué hay nuevo?", "¿Qué puedes hacer?"):
        r = _chat(client, admin_headers, mensaje)
        assert r.status_code == 200, (mensaje, r.text)
        body = r.json()
        assert isinstance(body.get("fuente"), dict) and body["fuente"].get("nombre"), (mensaje, body)
        assert body.get("consultado_en"), (mensaje, body)


def test_sugerencias_con_requiere_admin(client, admin_headers, app):
    """Contrato: sugerencias como {texto, requiere_admin}."""
    r = _chat(client, admin_headers, "¿Qué puedes hacer?")
    sugs = r.json()["sugerencias"]
    assert len(sugs) == 3
    assert all(set(s.keys()) == {"texto", "requiere_admin"} for s in sugs)
    # Con citas próximas, la sugerencia "Crea una cita..." marca requiere_admin.
    import datetime as dt
    db, gen = _db(app)
    try:
        appt = Appointment(client_name="T24 sugerencias", service_type="consulta",
                           starts_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1),
                           duration_min=60, status="pendiente")
        db.add(appt)
        db.commit()
        r = _chat(client, admin_headers, "¿Qué citas tengo?")
        assert r.json()["accion"]["tipo"] == "listar_citas", r.json()
        assert any(s["requiere_admin"] for s in r.json()["sugerencias"]), r.json()
        db.query(Appointment).filter(Appointment.id == appt.id).delete()
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F3-2 --

def test_precio_cache_vieja_se_etiqueta_como_vieja(client, admin_headers):
    """F3-2: caché >300 s sin velas -> precio viejo con antigüedad explícita."""
    viejo = {"at": time.monotonic() - 600, "payload": {
        "source": "kraken", "updated_utc": "2026-11-24T00:00:00+00:00",
        "prices": [{"symbol": "BTC", "price_usd": 99999.0},
                   {"symbol": "ETH", "price_usd": 3000.0}],
    }}
    guardado = dict(market_api._PRICES_CACHE)
    try:
        market_api._PRICES_CACHE.clear()
        market_api._PRICES_CACHE.update(viejo)
        r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
        body = r.json()
        assert body["accion"]["tipo"] == "precio_btc", body
        assert "NO es actual" in body["respuesta"], body
        assert "10 minuto" in body["respuesta"], body
        # Caché fresca: precio actual, sin etiqueta de viejo.
        market_api._PRICES_CACHE.clear()
        market_api._PRICES_CACHE.update({
            "at": time.monotonic(),
            "payload": {"source": "kraken", "updated_utc": "2026-11-24T12:00:00+00:00",
                        "prices": [{"symbol": "BTC", "price_usd": 88000.0},
                                   {"symbol": "ETH", "price_usd": 2900.0}]},
        })
        r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
        assert "actual" in r.json()["respuesta"], r.json()
        assert "NO es actual" not in r.json()["respuesta"]
    finally:
        market_api._PRICES_CACHE.clear()
        market_api._PRICES_CACHE.update(guardado)


# ------------------------------------------------------------------ F3-4 / F3-5 --

def test_internet_vigencia_corte_y_desambiguacion(client, admin_headers, monkeypatch):
    """F3-4: línea de vigencia + corte en punto final; "¿A o B?" sin
    resultado devuelve opciones en vez de "sin respuesta" seco."""
    texto_largo = ("Primera frase completa. " * 40) + "Frase final sin terminar"
    monkeypatch.setattr(
        "app.api.asistente.buscar_en_internet",
        lambda q: {"nombre": "DuckDuckGo", "url": "https://example.org/x",
                   "texto": texto_largo},
    )
    r = _chat(client, admin_headers, "¿Qué es un ornitorrinco de prueba?")
    body = r.json()
    assert "Consultado el" in body["respuesta"]
    assert "la fuente no indica fecha del dato" in body["respuesta"]
    assert "sin terminar" not in body["respuesta"]
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "¿París o Londres?")
    body = r.json()
    assert body["aclaracion"] is not None, body
    assert body["aclaracion"]["opciones"] == ["paris", "londres"]


def test_sin_respuesta_con_motivo(client, admin_headers, monkeypatch):
    """F3-5: motivo via_rapida (saludo) e internet_sin_resultado."""
    r = _chat(client, admin_headers, "hola")
    assert r.json()["sin_respuesta"] is True
    assert r.json()["motivo"] == "via_rapida"
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "¿Qué es el zqxwvutl de prueba?")
    assert r.json()["sin_respuesta"] is True
    assert r.json()["motivo"] == "internet_sin_resultado"


# ------------------------------------------------------------------ F3-6 --

def test_analisis_con_fecha_del_backtest(client, admin_headers):
    """F3-6: el análisis muestra la fecha del último backtest."""
    from app.api.backtest import RUNS_DIR
    os.makedirs(RUNS_DIR, exist_ok=True)
    path = os.path.join(RUNS_DIR, "TEST24-BTCUSD-1h-20261124000000.json")
    payload = {"run_id": "BTCUSD-1h-20261124000000", "symbol": "BTC/USD",
               "timeframe": "1h", "n_candles": 100,
               "metrics": {"net_return_pct": 1.5}}
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        asistente_api._BACKTEST_CACHE.update({"mtime": None, "path": None, "result": None})
        r = _chat(client, admin_headers, "Analiza el mercado")
        body = r.json()
        assert body["accion"]["tipo"] == "analisis", body
        assert "2026-11-24" in body["respuesta"], body
        # Etiqueta de simulación intacta.
        assert "simulación" in body["respuesta"]
    finally:
        if os.path.exists(path):
            os.remove(path)
        asistente_api._BACKTEST_CACHE.update({"mtime": None, "path": None, "result": None})


# ------------------------------------------------------------------ F3-7 --

def test_borrador_declara_defaults_y_usa_mencionados(client, admin_headers, app):
    """F3-7: sin plataforma/fecha -> defaults declarados; con TikTok
    mencionado -> plataforma TikTok y fecha por defecto declarada."""
    db, gen = _db(app)
    try:
        r = _chat(client, admin_headers, "Crea un borrador sobre el nuevo curso")
        body = r.json()
        assert body["accion"]["tipo"] == "crear_borrador", body
        assert body["accion"]["datos"]["platform"] == "instagram"
        assert "defaults" in body["respuesta"]
        id1 = body["accion"]["datos"]["id"]
        r = _chat(client, admin_headers, "Crea un borrador sobre el nuevo curso para TikTok")
        body = r.json()
        assert body["accion"]["datos"]["platform"] == "tiktok", body
        assert "fecha por defecto" in body["respuesta"]
        id2 = body["accion"]["datos"]["id"]
        db.query(ContentItem).filter(ContentItem.id.in_([id1, id2])).delete(
            synchronize_session=False)
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F3-8 --

def test_ventas_solo_facturas_pagadas(client, admin_headers, app):
    """F3-8: ventas = solo PAGADAS; enviadas y borradores aparte."""
    db, gen = _db(app)
    try:
        antes = _chat(client, admin_headers, "¿Cuánto hemos vendido?").json()
        filas = [
            Invoice(number=_uid("F-PAG"), client_name="T24 pagada",
                    items=[{"description": "x", "qty": 1, "unit_price": "100"}],
                    tax_rate=0, status="pagada"),
            Invoice(number=_uid("F-ENV"), client_name="T24 enviada",
                    items=[{"description": "x", "qty": 1, "unit_price": "50"}],
                    tax_rate=0, status="enviada"),
            Invoice(number=_uid("F-BOR"), client_name="T24 borrador",
                    items=[{"description": "x", "qty": 1, "unit_price": "10"}],
                    tax_rate=0, status="borrador"),
        ]
        db.add_all(filas)
        db.commit()
        despues = _chat(client, admin_headers, "¿Cuánto hemos vendido?").json()
        datos_a, datos_d = antes["accion"]["datos"], despues["accion"]["datos"]
        assert datos_d["total_pagado"] - datos_a["total_pagado"] == 100.0
        assert datos_d["n_pagadas"] - datos_a["n_pagadas"] == 1
        assert datos_d["total_enviado"] - datos_a["total_enviado"] == 50.0
        assert datos_d["n_enviadas"] - datos_a["n_enviadas"] == 1
        assert datos_d["n_borrador"] - datos_a["n_borrador"] == 1
        for f in filas:
            db.delete(f)
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------------------ F4 --

def test_biblioteca_manual_whatsapp_y_guia_gratuita(client, admin_headers):
    """F4-1/F4-4: el manual de WhatsApp enlaza a compra (Hotmart),
    nunca al PDF; la guía gratuita enlaza descarga directa."""
    r = _chat(client, admin_headers, "¿Dónde está el manual de WhatsApp?")
    body = r.json()
    assert body["accion"]["tipo"] == "biblioteca", body
    rec = next(x for x in body["recursos"] if x["id"] == "curso:whatsapp-vende")
    assert rec["enlace"] == "https://go.hotmart.com/R107890527U"
    assert rec["precio_usd"] == 19.99
    assert "/download" not in (rec["enlace"] or "")
    r = _chat(client, admin_headers, "¿Dónde está la guía gratuita de comandos?")
    body = r.json()
    assert body["accion"]["tipo"] == "biblioteca", body
    rec = next(x for x in body["recursos"] if x["id"] == "curso:guia-comandos-prompts-visuales")
    assert rec["enlace"] and rec["enlace"].endswith("/download")
    assert rec["precio_usd"] == 0.0


def test_herramientas_clases_constante_y_anclas_reales():
    """F4-2: las 6 herramientas con anclas que existen en el frontend
    (B7, 2026-11-26: se añadió la calculadora de rentabilidad)."""
    from pathlib import Path
    assert len(asistente_api.HERRAMIENTAS_CLASES) == 6
    frontend = Path(__file__).resolve().parents[2] / "frontend" / "components" / "ClasesHerramientas.tsx"
    texto = frontend.read_text(encoding="utf-8")
    for h in asistente_api.HERRAMIENTAS_CLASES:
        ancla = h["enlace"].split("#", 1)[1]
        assert f'id="{ancla}"' in texto, ancla


def test_students_count_solo_admin(client, admin_headers, viewer_headers):
    """F4-5: students_count es null para prueba y número para admin."""
    r = client.get("/api/academy/courses", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json(), r.json()
    assert all(c["students_count"] is None for c in r.json()), r.json()
    r = client.get("/api/academy/courses", headers=admin_headers)
    assert all(isinstance(c["students_count"], int) for c in r.json())


# ------------------------------------------------- Corrección QA 2026-11-24 --

def test_aclaracion_palabra_desnuda_ambigua(client, admin_headers):
    """Corrección QA F3-07/F4-05: "mercado", "curso" y "ventas"
    desnudos devuelven tipo="aclaracion" con opciones, no una
    respuesta por ranking con confianza baja."""
    casos = [
        ("mercado", 45, ["Analiza el mercado", "¿Cuánto vale el bitcoin?",
                         "Muéstrame las últimas señales"]),
        ("curso", 55, ["¿Qué clases hay?", "¿Qué manuales hay?",
                       "Resume el módulo Estudiar"]),
        ("ventas", 45, ["¿Cuánto hemos vendido?", "Ver todas las facturas",
                        "Resume el módulo Facturas"]),
    ]
    for mensaje, confianza, opciones in casos:
        body = _chat(client, admin_headers, mensaje).json()
        assert body["accion"]["tipo"] == "aclaracion", (mensaje, body)
        assert body["confianza"] == confianza, (mensaje, body)
        assert body["sin_respuesta"] is False, (mensaje, body)
        assert body["aclaracion"] is not None, (mensaje, body)
        assert body["aclaracion"]["opciones"] == opciones, (mensaje, body)
        assert body["aclaracion"]["pregunta"] in body["respuesta"], (mensaje, body)
    # Artículo + palabra desnuda también aclara; "tendencia" es la
    # otra clave genérica de análisis.
    for mensaje in ("el mercado", "el curso", "tendencia"):
        body = _chat(client, admin_headers, mensaje).json()
        assert body["accion"]["tipo"] == "aclaracion", (mensaje, body)
        assert body["aclaracion"] is not None, (mensaje, body)


def test_aclaracion_no_rompe_contexto_real(client, admin_headers):
    """Corrección QA F3-07/F4-05: con contexto real no se aclara.
    "mercado de camisetas" sigue siendo análisis con confianza
    <= 50 (test del Agente 2, guardado aquí); y cada opción de la
    aclaración, al reenviarse, resuelve sin volver a aclarar."""
    assert _chat(client, admin_headers, "mercado de camisetas").json()["accion"]["tipo"] == "analisis"
    assert _chat(client, admin_headers, "mercado de camisetas").json()["confianza"] <= 50
    assert _chat(client, admin_headers, "Analiza el mercado").json()["accion"]["tipo"] == "analisis"
    assert _chat(client, admin_headers, "¿Cuánto hemos vendido?").json()["accion"]["tipo"] == "facturas"
    assert _chat(client, admin_headers, "¿Qué cursos hay?").json()["accion"]["tipo"] == "clases"
    assert _chat(client, admin_headers, "curso de marketing").json()["accion"]["tipo"] == "clases"
    assert _chat(client, admin_headers, "ventas de hoy").json()["accion"]["tipo"] == "facturas"
    # Otras intenciones de una sola palabra no se tocan.
    assert _chat(client, admin_headers, "precio").json()["accion"]["tipo"] == "precio_btc"
    assert _chat(client, admin_headers, "ayuda").json()["accion"]["tipo"] == "ayuda"
    # Ida y vuelta de las opciones: resuelven sin bucle de aclaración.
    body = _chat(client, admin_headers, "curso").json()
    assert _chat(client, admin_headers,
                 body["aclaracion"]["opciones"][0]).json()["accion"]["tipo"] == "clases"
    assert _chat(client, admin_headers,
                 body["aclaracion"]["opciones"][1]).json()["accion"]["tipo"] == "biblioteca"
    body = _chat(client, admin_headers, "mercado").json()
    assert _chat(client, admin_headers,
                 body["aclaracion"]["opciones"][0]).json()["accion"]["tipo"] == "analisis"
    assert _chat(client, admin_headers,
                 body["aclaracion"]["opciones"][1]).json()["accion"]["tipo"] == "precio_btc"
    body = _chat(client, admin_headers, "ventas").json()
    assert _chat(client, admin_headers,
                 body["aclaracion"]["opciones"][0]).json()["accion"]["tipo"] == "facturas"


def test_biblioteca_manual_inexistente_sin_resultado(client, admin_headers, monkeypatch):
    """Corrección QA F4-07: "el manual de cocina" declara la ausencia
    (sin_respuesta + motivo biblioteca_sin_resultado + texto "sin
    resultados en la biblioteca") en vez de devolver otros manuales
    como si fueran la respuesta."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    body = _chat(client, admin_headers, "el manual de cocina").json()
    assert body["sin_respuesta"] is True, body
    assert body["motivo"] == "biblioteca_sin_resultado", body
    assert "sin resultados en la biblioteca" in body["respuesta"], body
    assert not body["recursos"], body
    assert body["accion"] is None, body
    # Guardas: el listado genérico y los manuales que SÍ existen
    # siguen funcionando igual.
    body = _chat(client, admin_headers, "¿Qué manuales hay?").json()
    assert body["accion"]["tipo"] == "biblioteca", body
    assert body["sin_respuesta"] is False, body
    body = _chat(client, admin_headers, "¿Dónde está el manual de WhatsApp?").json()
    assert body["accion"]["tipo"] == "biblioteca", body
    assert any(r["id"] == "curso:whatsapp-vende" for r in body["recursos"]), body
    body = _chat(client, admin_headers, "el manual de marketing").json()
    assert body["accion"]["tipo"] == "biblioteca", body
    assert any("Marketing" in r["titulo"] for r in body["recursos"]), body
