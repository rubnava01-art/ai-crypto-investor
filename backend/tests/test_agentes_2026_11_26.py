"""Corrida 2026-11-26, Agente 2 (Backend) — Asistente práctico.

Cubre lo ejecutado por el Agente 2 del plan conjunto
(~/workspace/goals/ai-crypto-investor-platform/hidden_files/
agents-2026-11-26-asistente/plan.md): planes (C2), memoria de
conversación (C-2), internet real para actualidad (C1), etiqueta
demo en señales (A1), flujos y campañas (A-3), límites por entorno
(A2), caché de biblioteca (A4), SSRF/PII/confianza (M1/M2/M9),
reglas vs datos (M6), rate limit de feedback y tope de bandeja
(M7), gate de rol (M8), USDT/BNB (B1), extractos (B2),
herramienta-rentabilidad (B7), deny_linked_reader en /uso y
/feedback (B2 QA), max_length en ReglaIn (B4 QA) y reutilización
de clientes HTTP (M3).

Fixtures compartidas (client, admin_headers, viewer_headers). Sin
login propio: el límite diario del rol prueba es 10/día y la suite
comparte la BD, así que los chats como viewer son solo 2 en este
archivo (el resto, como admin, sin límite). Todo lo sembrado lleva
prefijo único y se borra al final.
"""
import datetime as dt
import time
import uuid
from decimal import Decimal

import pytest

import app.api.asistente as asistente_api
import app.api.market as market_api
import app.internet as internet_mod
from app.api.asistente import asistente_limiter
from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import (
    Appointment,
    AsistenteFeedback,
    BusinessNote,
    ContentItem,
    EduClass,
    HomePost,
    MarketingCampaign,
    MarketCandle,
    PreguntaSinRespuesta,
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


def _chat(client, headers, mensaje: str, historial=None):
    payload = {"mensaje": mensaje}
    if historial is not None:
        payload["historial"] = historial
    return client.post(f"{BASE}/chat", json=payload, headers=headers)


@pytest.fixture(autouse=True)
def _clear_asistente_limiter():
    asistente_limiter.clear()
    yield
    asistente_limiter.clear()


# ------------------------------------------------------------------ C2: planes --

def test_planes_precio_esencial_no_es_btc(client, admin_headers):
    """C2: «¿Cuánto vale el plan Esencial?» responde $19, no el
    precio de BTC."""
    r = _chat(client, admin_headers, "¿Cuánto vale el plan Esencial?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "planes", body
    assert "$19" in body["respuesta"], body
    assert "Bitcoin" not in body["respuesta"], body
    assert body["accion"]["datos"]["planes"][0]["precio_mensual_usd"] == 19


def test_planes_todos_y_prueba_gratis(client, admin_headers):
    r = _chat(client, admin_headers, "¿Qué planes hay?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "planes", body
    for nombre, precio in (("Esencial", "$19"), ("Crecimiento", "$49"),
                           ("Negocio Total", "$99")):
        assert nombre in body["respuesta"], body
        assert precio in body["respuesta"], body
    assert "14 días de prueba gratis" in body["respuesta"], body


def test_planes_que_incluye_crecimiento_es_acumulativo(client, admin_headers):
    """C2: Crecimiento incluye lo de Esencial más lo suyo."""
    r = _chat(client, admin_headers, "¿Qué incluye el plan Crecimiento?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "planes", body
    assert "Invertir" in body["respuesta"], body
    # Crecimiento es acumulativo: sus datos incluyen lo de Esencial.
    incluye = body["accion"]["datos"]["planes"][0]["incluye"]
    assert "Gestor de Clientes" in incluye, body
    assert "Invertir" in incluye, body


def test_planes_no_captura_plan_de_marketing(client, admin_headers, monkeypatch):
    """C2: «plan de marketing» no es una pregunta de planes."""
    monkeypatch.setattr(asistente_api, "buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "¿Qué es un plan de marketing?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"] is None or \
        r.json()["accion"]["tipo"] != "planes", r.json()


def test_planes_mi_plan_admin_sin_limite(client, admin_headers):
    r = _chat(client, admin_headers, "¿Cuál es mi plan?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "planes", body
    assert "Administrador (sin límite diario)" in body["respuesta"], body


# ------------------------------------------------------- C-2: historial --

def _crear_cita(client, admin_headers, app, nombre: str):
    """Crea una cita por chat y devuelve (id, texto_confirmación)."""
    r = _chat(client, admin_headers, f"Crea una cita para {nombre} mañana a las 10:00")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "crear_cita", body
    return body["accion"]["datos"]["id"], body["respuesta"]


def test_historial_cambiar_hora_cita(client, admin_headers, app):
    """C-2: «cámbiala a las 11» resuelve la última cita creada."""
    nombre = _uid("Cita26")
    cita_id, confirmacion = _crear_cita(client, admin_headers, app, nombre)
    historial = [
        {"rol": "usuario",
         "texto": f"Crea una cita para {nombre} mañana a las 10:00"},
        {"rol": "asistente", "texto": confirmacion},
    ]
    try:
        r = _chat(client, admin_headers, "Cámbiala a las 11:00",
                  historial=historial)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "cambiar_cita", body
        assert body["accion"]["datos"]["id"] == cita_id
        db, gen = _db(app)
        try:
            cita = db.get(Appointment, cita_id)
            assert cita is not None
            # La hora se guarda en UTC: 11:00 de Los Ángeles.
            from zoneinfo import ZoneInfo

            assert cita.starts_at.astimezone(
                ZoneInfo("America/Los_Angeles")).hour == 11
        finally:
            _close(gen)
    finally:
        db, gen = _db(app)
        try:
            db.query(Appointment).filter(Appointment.id == cita_id).delete()
            db.commit()
        finally:
            _close(gen)


def test_historial_payload_exactamente_como_lo_construye_el_frontend(
    client, admin_headers, app
):
    """D1 (QA 2026-11-26, regresión): el frontend construye el
    historial con buildHistorial (frontend/lib/asistente.ts), que
    emite {rol: "usuario"|"asistente", texto} — user→usuario,
    assistant→asistente. Este test envía por HTTP ese payload
    exacto en una conversación de dos turnos (crear cita y luego
    «Cámbiala a las 11:00») y afirma 200, no 422: es el test que
    habría cazado D1, cuando el frontend mandaba
    {role: "user"|"assistant"} y cada segundo mensaje devolvía 422.
    La forma vieja sigue rechazándose con 422 (contrato del
    backend sin tocar)."""
    nombre = _uid("Cita26D1")
    cita_id, confirmacion = _crear_cita(client, admin_headers, app, nombre)
    # Payload EXACTO del frontend: buildHistorial([{role: "user",
    # text: "Crea una cita..."}, {role: "assistant",
    # text: <confirmación>}]).
    historial = [
        {"rol": "usuario",
         "texto": f"Crea una cita para {nombre} mañana a las 10:00"},
        {"rol": "asistente", "texto": confirmacion},
    ]
    try:
        # La forma vieja del frontend ({role: "user"}) no valida.
        r = _chat(client, admin_headers, "Cámbiala a las 11:00",
                  historial=[{"role": "user", "texto": "Crea una cita"},
                             {"role": "assistant", "texto": "Cita creada"}])
        assert r.status_code == 422, r.text
        # La forma que construye el frontend hoy: 200 y cambia la cita.
        r = _chat(client, admin_headers, "Cámbiala a las 11:00",
                  historial=historial)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "cambiar_cita", body
        assert body["accion"]["datos"]["id"] == cita_id
        db, gen = _db(app)
        try:
            cita = db.get(Appointment, cita_id)
            assert cita is not None
            # La hora se guarda en UTC: 11:00 de Los Ángeles.
            from zoneinfo import ZoneInfo

            assert cita.starts_at.astimezone(
                ZoneInfo("America/Los_Angeles")).hour == 11
        finally:
            _close(gen)
    finally:
        db, gen = _db(app)
        try:
            db.query(Appointment).filter(Appointment.id == cita_id).delete()
            db.commit()
        finally:
            _close(gen)


def test_historial_mostrar_esa_nota(client, admin_headers, app):
    """C-2: «muéstrame esa nota» resuelve la última nota creada."""
    texto = _uid("Nota26")
    r = _chat(client, admin_headers, f"Crea una nota: {texto}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "crear_nota", body
    nota_id = body["accion"]["datos"]["id"]
    historial = [
        {"rol": "usuario", "texto": f"Crea una nota: {texto}"},
        {"rol": "asistente", "texto": body["respuesta"]},
    ]
    try:
        r = _chat(client, admin_headers, "Muéstrame esa nota",
                  historial=historial)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "mostrar_nota", body
        assert body["accion"]["datos"]["id"] == nota_id
        assert texto in body["respuesta"], body
    finally:
        db, gen = _db(app)
        try:
            db.query(BusinessNote).filter(BusinessNote.id == nota_id).delete()
            db.commit()
        finally:
            _close(gen)


def test_historial_cambiar_sin_referencia_pregunta(client, admin_headers):
    """C-2: sin objeto creado en el historial, un cambio pregunta
    en vez de inventar (y no muta nada)."""
    r = _chat(client, admin_headers, "Cámbiala a las 11:00", historial=[])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"] is None, body
    assert "No veo" in body["respuesta"], body


def test_historial_mas_de_6_turnos_422(client, admin_headers):
    """C-2: el historial tiene tope de 6 turnos (Pydantic, 422)."""
    historial = [{"rol": "usuario", "texto": "hola"}] * 7
    r = _chat(client, admin_headers, "hola", historial=historial)
    assert r.status_code == 422, r.text


def test_historial_rol_invalido_422(client, admin_headers):
    r = _chat(client, admin_headers, "hola",
              historial=[{"rol": "sistema", "texto": "hola"}])
    assert r.status_code == 422, r.text


def test_historial_cambiar_hora_ambigua_pide_aclaracion(
    client, admin_headers, app
):
    """C-2: «cámbiala a las 11» (sin AM/PM) pide aclaración, como
    al crear la cita."""
    nombre = _uid("Cita26Amb")
    cita_id, confirmacion = _crear_cita(client, admin_headers, app, nombre)
    historial = [
        {"rol": "usuario",
         "texto": f"Crea una cita para {nombre} mañana a las 10:00"},
        {"rol": "asistente", "texto": confirmacion},
    ]
    try:
        r = _chat(client, admin_headers, "Cámbiala a las 11",
                  historial=historial)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["aclaracion"] is not None, body
        assert "mañana" in str(body["aclaracion"]["opciones"]), body
        assert "noche" in str(body["aclaracion"]["opciones"]), body
    finally:
        db, gen = _db(app)
        try:
            db.query(Appointment).filter(Appointment.id == cita_id).delete()
            db.commit()
        finally:
            _close(gen)


def test_historial_cambiar_cita_idempotente(client, admin_headers, app):
    """C-2: reintentar «cámbiala» con la misma Idempotency-Key no
    re-ejecuta el cambio."""
    nombre = _uid("Cita26Idem")
    cita_id, confirmacion = _crear_cita(client, admin_headers, app, nombre)
    historial = [
        {"rol": "usuario",
         "texto": f"Crea una cita para {nombre} mañana a las 10:00"},
        {"rol": "asistente", "texto": confirmacion},
    ]
    try:
        headers = dict(admin_headers)
        headers["Idempotency-Key"] = f"cita26-{uuid.uuid4().hex[:8]}"
        r1 = _chat(client, headers, "Cámbiala a las 11:00",
                   historial=historial)
        assert r1.status_code == 200, r1.text
        assert r1.json()["accion"]["tipo"] == "cambiar_cita", r1.json()
        r2 = _chat(client, headers, "Cámbiala a las 11:00",
                   historial=historial)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("idempotent_replay") is True, r2.json()
        assert r2.json()["accion"]["datos"]["id"] == cita_id
    finally:
        db, gen = _db(app)
        try:
            db.query(Appointment).filter(Appointment.id == cita_id).delete()
            db.commit()
        finally:
            _close(gen)


# ------------------------------------------------------- C1: internet real --

class _RespFake:
    def __init__(self, status_code=200, content=b"", headers=None, payload=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}
        self._payload = payload or {}

    def json(self):
        return self._payload


RSS_EJEMPLO = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b"<rss><channel>"
    b"<item><title>Bitcoin sube un 5% hoy</title>"
    b"<link>https://example.org/noticia-1</link>"
    b"<pubDate>Wed, 26 Nov 2026 10:00:00 GMT</pubDate></item>"
    b"<item><title>El mercado espera la decision</title>"
    b"<link>https://example.org/noticia-2</link>"
    b"<pubDate>Wed, 26 Nov 2026 09:00:00 GMT</pubDate></item>"
    b"</channel></rss>"
)


def test_internet_rss_noticias_con_fecha(monkeypatch):
    """C1: el RSS de Google News devuelve titulares con fecha."""
    class ClienteRSS:
        def get(self, url, **k):
            assert "news.google.com/rss" in url
            return _RespFake(200, content=RSS_EJEMPLO)

    r = internet_mod._desde_rss_noticias(ClienteRSS(), "bitcoin", 5.0)
    assert r is not None, r
    assert r["nombre"] == "Google News (RSS)"
    assert "Bitcoin sube un 5% hoy" in r["texto"]
    assert r["publicado_en"] == "2026-11-26T10:00:00+00:00"
    assert len(r["items"]) == 2


def test_internet_rss_sin_items_none(monkeypatch):
    class ClienteVacio:
        def get(self, url, **k):
            return _RespFake(200, content=b"<rss><channel></channel></rss>")

    assert internet_mod._desde_rss_noticias(ClienteVacio(), "bitcoin", 5.0) is None


def test_internet_ddg_resultados_titulos_y_snippets():
    """C1: los resultados de DDG traen títulos/snippets/enlaces."""
    html_ddg = (
        b'<a rel="nofollow" class="result__a" href="https://example.org/a">'
        b"Titulo Uno</a>"
        b'<a class="result__snippet" href="#">Snippet uno con detalle.</a>'
        b'<a rel="nofollow" class="result__a" href="https://example.org/b">'
        b"Titulo Dos</a>"
        b'<a class="result__snippet" href="#">Snippet dos.</a>'
    )

    class ClienteHTML:
        def get(self, url, **k):
            assert "html.duckduckgo.com" in url
            return _RespFake(200, content=html_ddg)

    r = internet_mod._desde_ddg_resultados(ClienteHTML(), "tema de prueba", 5.0)
    assert r is not None, r
    assert r["nombre"] == "DuckDuckGo (resultados)"
    assert r["items"][0]["titulo"] == "Titulo Uno"
    assert r["items"][0]["snippet"] == "Snippet uno con detalle."
    assert r["items"][0]["enlace"] == "https://example.org/a"


def test_internet_chat_rss_con_publicado_en(client, admin_headers, monkeypatch):
    """C1: el chat expone publicado_en y confianza 55 para el RSS."""
    monkeypatch.setattr(
        asistente_api, "buscar_en_internet",
        lambda q: {"nombre": "Google News (RSS)",
                   "url": "https://news.google.com/rss",
                   "texto": "Últimas noticias (Google News):\n- Bitcoin sube (2026-11-26)",
                   "publicado_en": "2026-11-26T10:00:00+00:00"})
    r = _chat(client, admin_headers, "¿Qué noticias hay del zqxwvutl hoy?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fuente"]["nombre"] == "Google News (RSS)", body
    assert body["accion"]["datos"]["publicado_en"] == "2026-11-26T10:00:00+00:00"
    assert "publicado el 2026-11-26" in body["respuesta"], body
    assert body["confianza"] == 55, body


def test_internet_get_json_topado_bloquea_redireccion_privada():
    """M1: una redirección de DDG/Wikipedia a IP privada no se sigue."""

    class ClienteRedirige:
        def get(self, url, **k):
            if "127.0.0.1" in url:
                return _RespFake(200, content=b"{}", payload={})
            return _RespFake(302, headers={"location": "http://127.0.0.1/privado"})

    assert internet_mod._get_json_topado(
        ClienteRedirige(), "https://api.duckduckgo.com/?q=x", 5.0) is None


def test_internet_get_json_topado_sigue_redireccion_publica():
    """M1: una redirección a IP pública sí se sigue (y se topa el cuerpo)."""

    class ClienteRedirige:
        def get(self, url, **k):
            if "8.8.8.8" in url:
                return _RespFake(200, content=b'{"AbstractText": "Hola."}',
                                 payload={"AbstractText": "Hola."})
            return _RespFake(302, headers={"location": "http://8.8.8.8/api"})

    r = internet_mod._get_json_topado(
        ClienteRedirige(), "https://api.duckduckgo.com/?q=x", 5.0)
    assert r == {"AbstractText": "Hola."}, r


def test_internet_get_json_topado_cuerpo_grande_none():
    """M1: un cuerpo mayor de 1 MB no se parsea como JSON."""

    class ClienteGrande:
        def get(self, url, **k):
            return _RespFake(200, content=b"x" * (internet_mod.MAX_JSON_BYTES + 1))

    assert internet_mod._get_json_topado(
        ClienteGrande(), "https://api.duckduckgo.com/?q=x", 5.0) is None


def test_internet_sin_resultado_ttl_corto(monkeypatch):
    """M9: un «sin resultado» cacheado caduca a los 120 s (no 900 s)."""
    import time as _time

    assert internet_mod.CACHE_TTL_SIN_RESULTADO_S == 120
    internet_mod.limpiar_cache()
    internet_mod._cache_put("pregunta ttl 26", None)
    # Recién guardado: el caché manda (None).
    assert internet_mod._cache["pregunta ttl 26"][1] is None
    # Envejecido 121 s: buscar_en_internet debe re-preguntar.
    internet_mod._cache["pregunta ttl 26"] = (_time.monotonic() - 121, None)

    class ClienteDDG:
        def get(self, url, **k):
            return _RespFake(200, content=b'{"AbstractText": "Respuesta fresca.", '
                             b'"AbstractURL": "https://example.org/fresca"}',
                             payload={"AbstractText": "Respuesta fresca.",
                                      "AbstractURL": "https://example.org/fresca"})

    monkeypatch.setattr(internet_mod.httpx, "Client", lambda *a, **k: ClienteDDG())
    # El executor persistente usa _cliente_hilo(): con el cliente
    # monkeypatcheado crea uno fresco por tarea (sin caché).
    r = internet_mod.buscar_en_internet("pregunta ttl 26")
    assert r is not None and r["texto"] == "Respuesta fresca.", r
    internet_mod.limpiar_cache()


def test_internet_reutiliza_cliente_por_hilo(monkeypatch):
    """M3: el mismo hilo reutiliza su cliente; con el cliente falso
    de los tests, uno fresco por tarea (sin servir un falso obsoleto)."""
    c1 = internet_mod._cliente_hilo()
    c2 = internet_mod._cliente_hilo()
    assert c1 is c2

    class Falso:
        def __init__(self, *a, **k):
            pass

    monkeypatch.setattr(internet_mod.httpx, "Client", Falso)
    assert internet_mod._cliente_hilo() is not internet_mod._cliente_hilo()


def test_coingecko_mock_precio(monkeypatch):
    """C1: precio_coingecko parsea la API pública (sin llave)."""

    class ClienteCG:
        def get(self, url, **k):
            assert "api.coingecko.com" in url
            return _RespFake(200, content=b'{"bitcoin": {"usd": 60000}, '
                             b'"binancecoin": {"usd": 500}}',
                             payload={"bitcoin": {"usd": 60000},
                                      "binancecoin": {"usd": 500}})

    monkeypatch.setattr(internet_mod, "_nuevo_cliente", lambda: ClienteCG())
    r = internet_mod.precio_coingecko(["BTC", "BNB"])
    assert r == {"BTC": 60000.0, "BNB": 500.0}, r
    assert internet_mod.precio_coingecko(["XXX"]) is None


# ------------------------------------------------------- A1: señales demo --

def test_senales_llevan_etiqueta_demo(client, admin_headers, app):
    """A1: las señales se presentan como demo/simuladas, no reales."""
    tag = _uid("Senal26")
    db, gen = _db(app)
    try:
        senal = Signal(symbol="BTC", side="buy", reason=tag, status="generated")
        db.add(senal)
        db.commit()
        senal_id = senal.id
    finally:
        _close(gen)
    try:
        r = _chat(client, admin_headers, "Muéstrame las últimas señales")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "senales", body
        assert tag in body["respuesta"], body
        assert "simul" in body["respuesta"].lower(), body
        assert "Últimas señales reales" not in body["respuesta"], body
    finally:
        db, gen = _db(app)
        try:
            db.query(Signal).filter(Signal.id == senal_id).delete()
            db.commit()
        finally:
            _close(gen)


# ------------------------------------------------------- A-3: flujos y campañas --

def test_campanas_listar_y_estado(client, admin_headers, app):
    """A-3: listar campañas y estado de una concreta (solo lectura)."""
    nombre = _uid("Campana26")
    db, gen = _db(app)
    try:
        camp = MarketingCampaign(
            name=nombre, channel="instagram", status="activa",
            budget=Decimal("100"), spend=Decimal("25"), notes="Nota 26")
        db.add(camp)
        db.commit()
        camp_id = camp.id
    finally:
        _close(gen)
    try:
        r = _chat(client, admin_headers, "¿Qué campañas hay?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "campanas", body
        assert nombre in body["respuesta"], body
        r = _chat(client, admin_headers, f"¿Cómo está la campaña {nombre}?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "campanas", body
        assert "activa" in body["respuesta"], body
        assert body["accion"]["datos"]["campana"]["id"] == camp_id
    finally:
        db, gen = _db(app)
        try:
            db.query(MarketingCampaign).filter(
                MarketingCampaign.id == camp_id).delete()
            db.commit()
        finally:
            _close(gen)


def test_campanas_prueba_no_ve_datos(client, viewer_headers):
    """A-3: prueba no ve campañas reales por chat (M1)."""
    r = _chat(client, viewer_headers, "¿Qué campañas hay?")
    assert r.status_code == 200, r.text
    assert "No disponible en la demo" in r.json()["respuesta"], r.json()


def test_campanas_activar_no_se_hace_por_chat(client, admin_headers):
    """A-3: activar una campaña desde el chat se explica, no se ejecuta."""
    r = _chat(client, admin_headers, "Activa la campaña de lanzamiento")
    assert r.status_code == 200, r.text
    assert "solo puedo listar" in r.json()["respuesta"], r.json()


def test_flujos_explica_sin_backend(client, admin_headers):
    """A-3: los flujos no tienen modelo en el servidor; el chat lo
    dice y enlaza a /flujos (activar queda en backlog)."""
    r = _chat(client, admin_headers, "¿Qué son los flujos?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "flujos", body
    assert "navegador" in body["respuesta"], body
    assert "/flujos" in body["respuesta"], body


def test_borrador_de_campana_reutiliza_crear_borrador(
    client, admin_headers, app
):
    """A-3: «crea un borrador de campaña sobre X» crea el borrador
    de contenido con tema X (no «de campaña sobre X»)."""
    tema = _uid("TemaCampana26")
    r = _chat(client, admin_headers,
              f"Crea un borrador de campaña sobre {tema}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "crear_borrador", body
    assert body["accion"]["datos"]["title"] == tema, body
    item_id = body["accion"]["datos"]["id"]
    try:
        db, gen = _db(app)
        try:
            item = db.get(ContentItem, item_id)
            assert item is not None and item.status == "borrador"
        finally:
            _close(gen)
    finally:
        db, gen = _db(app)
        try:
            db.query(ContentItem).filter(ContentItem.id == item_id).delete()
            db.commit()
        finally:
            _close(gen)


# ------------------------------------------------------- A2: límites por entorno --

def test_limites_desde_env(monkeypatch):
    """A2: ASISTENTE_LIMITE_* manda; ausente/no numérico/<=0 cae al
    predeterminado 10/50/200/1000."""
    monkeypatch.setenv("ASISTENTE_LIMITE_PRUEBA", "7")
    assert asistente_api._limite_env("ASISTENTE_LIMITE_PRUEBA", 10) == 7
    monkeypatch.setenv("ASISTENTE_LIMITE_ESENCIAL", "xx")
    assert asistente_api._limite_env("ASISTENTE_LIMITE_ESENCIAL", 50) == 50
    monkeypatch.setenv("ASISTENTE_LIMITE_CRECIMIENTO", "0")
    assert asistente_api._limite_env("ASISTENTE_LIMITE_CRECIMIENTO", 200) == 200
    monkeypatch.delenv("ASISTENTE_LIMITE_TOTAL", raising=False)
    assert asistente_api._limite_env("ASISTENTE_LIMITE_TOTAL", 1000) == 1000


# ------------------------------------------------------- A4: caché de biblioteca --

def test_biblioteca_cache_reutiliza_y_se_invalida(app):
    """A4: el índice se construye una vez y se reutiliza; invalidar
    lo reconstruye."""
    asistente_api.invalidar_cache_biblioteca()
    db, gen = _db(app)
    try:
        primero = asistente_api._indice_biblioteca(db)
        segundo = asistente_api._indice_biblioteca(db)
        assert primero is segundo
        asistente_api.invalidar_cache_biblioteca()
        tercero = asistente_api._indice_biblioteca(db)
        assert tercero is not primero
        assert len(tercero) == len(primero)
    finally:
        _close(gen)


def test_biblioteca_nueva_clase_visible_tras_insertar(client, admin_headers, app):
    """A4: una clase nueva (cambia el conteo) invalida la caché y
    aparece en la búsqueda sin esperar al TTL."""
    titulo = f"Clase {_uid('zqxwvutl')}"
    db, gen = _db(app)
    try:
        # Calienta la caché con el índice actual.
        asistente_api._indice_biblioteca(db)
        clase = EduClass(kind="grabada", title=titulo,
                         description=f"Descripción {_uid('zqx')}", url="")
        db.add(clase)
        db.commit()
        clase_id = clase.id
    finally:
        _close(gen)
    try:
        r = _chat(client, admin_headers, "¿Dónde está zqxwvutl?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "biblioteca", body
        assert any(titulo in rec["titulo"] for rec in body["recursos"]), body
    finally:
        db, gen = _db(app)
        try:
            db.query(EduClass).filter(EduClass.id == clase_id).delete()
            db.commit()
            asistente_api.invalidar_cache_biblioteca()
        finally:
            _close(gen)


# ------------------------------------------------------- M2: PII y confianza --

def test_pii_no_viaja_a_internet(client, admin_headers, app, monkeypatch):
    """M2: una pregunta con correo no se envía a internet ni se
    guarda en la bandeja."""
    def _falla(q):
        raise AssertionError("no debe viajar a internet")

    monkeypatch.setattr(asistente_api, "buscar_en_internet", _falla)
    pregunta = "¿Qué es el zqxwvutl para aaabbb@cccddd.eee?"
    r = _chat(client, admin_headers, pregunta)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sin_respuesta"] is True, body
    assert body["motivo"] == "pii_en_pregunta", body
    assert "datos personales" in body["respuesta"], body
    db, gen = _db(app)
    try:
        fila = db.query(PreguntaSinRespuesta).filter(
            PreguntaSinRespuesta.pregunta == pregunta).first()
        assert fila is None
    finally:
        _close(gen)


def test_pii_telefono_no_viaja_a_internet(client, admin_headers, monkeypatch):
    monkeypatch.setattr(asistente_api, "buscar_en_internet",
                        lambda q: (_ for _ in ()).throw(
                            AssertionError("no debe viajar a internet")))
    r = _chat(client, admin_headers,
              "¿Qué es el zqxwvutl? Llámame al 555-123-4567")
    assert r.status_code == 200, r.text
    assert r.json()["motivo"] == "pii_en_pregunta", r.json()


def test_pagina_publica_confianza_degradada(client, admin_headers, monkeypatch):
    """M2: «Página pública» tiene confianza 40 y etiqueta de fuente
    no verificada; Wikipedia sigue en 60."""
    monkeypatch.setattr(
        asistente_api, "buscar_en_internet",
        lambda q: {"nombre": "Página pública", "url": "https://example.org/x",
                   "texto": "Texto de la página pública."})
    r = _chat(client, admin_headers, "¿Qué es el zqxwvutl de prueba?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["confianza"] == 40, body
    assert "Fuente no verificada" in body["respuesta"], body
    monkeypatch.setattr(
        asistente_api, "buscar_en_internet",
        lambda q: {"nombre": "Wikipedia (es)",
                   "url": "https://es.wikipedia.org/wiki/X",
                   "texto": "Texto de Wikipedia."})
    r = _chat(client, admin_headers, "¿Qué es el zqxwvutl de prueba?")
    assert r.json()["confianza"] == 60, r.json()
    assert "Fuente no verificada" not in r.json()["respuesta"], r.json()


# ------------------------------------------------------- M6: reglas vs datos --

def _seed_pregunta_row(app, pregunta: str) -> int:
    db, gen = _db(app)
    try:
        row = PreguntaSinRespuesta(pregunta=pregunta, veces=1,
                                   estado="pendiente")
        db.add(row)
        db.commit()
        return row.id
    finally:
        _close(gen)


def test_regla_sobre_precio_lleva_marca_no_dato_vivo(
    client, admin_headers, app
):
    """M6: la regla sigue ganando al precio (test existente), pero
    la respuesta lleva la marca «respuesta enseñada, no dato en vivo»."""
    pregunta = "cuanto vale el bitcoin"
    pregunta_id = _seed_pregunta_row(app, pregunta)
    respuesta = f"Precio enseñado {_uid('m6')}."
    r = client.post(
        f"{BASE}/preguntas/{pregunta_id}/regla",
        json={"respuesta": respuesta},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    regla_id = r.json()["id"]
    try:
        r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "regla", body
        assert respuesta in body["respuesta"], body
        assert "respuesta enseñada por el administrador, no un dato en vivo" in body["respuesta"], body
        assert body["accion"]["datos"]["respuesta_ensenada_no_dato_vivo"] is True
    finally:
        r = client.delete(f"{BASE}/reglas/{regla_id}", headers=admin_headers)
        assert r.status_code == 200, r.text
        db, gen = _db(app)
        try:
            db.query(PreguntaSinRespuesta).filter(
                PreguntaSinRespuesta.id == pregunta_id).delete()
            db.commit()
        finally:
            _close(gen)


# ------------------------------------------------------- M7: feedback y bandeja --

def test_bandeja_tope_nuevas_por_dia(app, monkeypatch):
    """M7: con el tope a 0, una pregunta nueva no entra en la bandeja."""
    monkeypatch.setattr(asistente_api, "TOPE_PREGUNTAS_NUEVAS_DIA", 0)
    db, gen = _db(app)
    try:
        assert asistente_api._registrar_pregunta(
            db, f"¿Qué es el {_uid('tope')}?") is None
    finally:
        _close(gen)


# ------------------------------------------------------- M8: gate de rol --

def test_resumen_modulo_filtrado_por_perfil(client, admin_headers, viewer_headers):
    """M8: prueba no puede resumir módulos de admin; admin sí."""
    r = _chat(client, viewer_headers, "Resume el módulo Usuarios")
    assert r.status_code == 200, r.text
    assert "no está disponible para tu perfil" in r.json()["respuesta"], r.json()
    r = _chat(client, admin_headers, "Resume el módulo Usuarios")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "resumen_modulo", body
    assert body["accion"]["datos"]["ruta"] == "/usuarios", body


def test_capacidades_sin_admin_no_lista_admin(client, admin_headers, viewer_headers):
    """M8: /capacidades no lista comandos requiere_admin a no-admin."""
    r = client.get(f"{BASE}/capacidades", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json()["comandos"], r.json()
    assert all(not c["requiere_admin"] for c in r.json()["comandos"]), r.json()
    r = client.get(f"{BASE}/capacidades", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(c["requiere_admin"] for c in r.json()["comandos"]), r.json()


# ------------------------------------------------------- B1: USDT/BNB --

def test_precio_bnb_por_coingecko(client, admin_headers, monkeypatch):
    """B1: el BNB se responde por CoinGecko cuando no hay caché ni velas."""
    monkeypatch.setattr(market_api, "_PRICES_CACHE",
                        {"at": 0.0, "payload": None})
    monkeypatch.setattr(asistente_api, "precio_coingecko",
                        lambda sims: {"BNB": 600.0} if "BNB" in sims else None)
    r = _chat(client, admin_headers, "¿Cuánto vale el BNB?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "precio_btc", body
    assert body["accion"]["datos"]["bnb_usd"] == 600.0, body
    assert "CoinGecko" in body["respuesta"], body


def test_precio_usdt_por_coingecko(client, admin_headers, monkeypatch):
    monkeypatch.setattr(market_api, "_PRICES_CACHE",
                        {"at": 0.0, "payload": None})
    monkeypatch.setattr(asistente_api, "precio_coingecko",
                        lambda sims: {"USDT": 1.0} if "USDT" in sims else None)
    r = _chat(client, admin_headers, "¿Cuánto vale el USDT?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["datos"]["usdt_usd"] == 1.0, body
    assert "$1.00" in body["respuesta"], body


def test_precio_cache_fresca_trae_actualizado_en_y_edad(
    client, admin_headers, monkeypatch
):
    """D2 (QA 2026-11-26): con caché fresca, datos trae
    actualizado_en y cache_edad_s (antes solo existían como
    variables locales y la mini-tarjeta mostraba la edad como
    «menos de 1 min»)."""
    monkeypatch.setattr(market_api, "_PRICES_CACHE",
                        {"at": time.monotonic() - 120,
                         "payload": {
                             "source": "kraken",
                             "updated_utc": "2026-11-26T12:00:00+00:00",
                             "prices": [{"symbol": "BTC", "price_usd": 88000.0},
                                        {"symbol": "ETH", "price_usd": 2900.0}]}})
    r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "precio_btc", body
    datos = body["accion"]["datos"]
    assert datos["fuente"] == "cache_mercado", datos
    assert datos["actualizado_en"] == "2026-11-26T12:00:00+00:00", datos
    assert 0 <= datos["cache_edad_s"] <= 300, datos


def test_precio_sin_datos_no_inventa(client, admin_headers, app, monkeypatch):
    """B1/C1: sin caché, sin velas y sin CoinGecko, «no voy a
    inventar un precio» (no un número)."""
    monkeypatch.setattr(market_api, "_PRICES_CACHE",
                        {"at": 0.0, "payload": None})
    monkeypatch.setattr(asistente_api, "precio_coingecko", lambda sims: None)
    db, gen = _db(app)
    try:
        # Limpieza de velas que otros tests pudieran haber dejado.
        db.query(MarketCandle).filter(
            MarketCandle.symbol.in_(("BTC/USD", "ETH/USD"))).delete()
        db.commit()
    finally:
        _close(gen)
    r = _chat(client, admin_headers, "¿Cuánto vale el bitcoin?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "precio_btc", body
    assert "No voy a inventar un precio" in body["respuesta"], body
    assert body["accion"]["datos"]["disponible"] is False


# ------------------------------------------------------- B2: extractos --

def test_novedades_y_clases_con_extracto(client, admin_headers, app):
    """B2: novedades y clases muestran un extracto corto del cuerpo."""
    cuerpo_novedad = _uid("CuerpoNovedad26") + " con más texto de la novedad."
    titulo_clase = _uid("ClaseExtracto26")
    desc_clase = _uid("DescripcionClase26") + " con más texto de la clase."
    db, gen = _db(app)
    try:
        post = HomePost(title=_uid("Novedad26"), body=cuerpo_novedad)
        clase = EduClass(kind="grabada", title=titulo_clase,
                         description=desc_clase, url="")
        db.add_all([post, clase])
        db.commit()
        post_id, clase_id = post.id, clase.id
    finally:
        _close(gen)
    try:
        r = _chat(client, admin_headers, "¿Qué hay nuevo?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "novedades", body
        assert cuerpo_novedad.split()[0] in body["respuesta"], body
        assert body["accion"]["datos"]["novedades"][0]["extracto"], body
        r = _chat(client, admin_headers, "¿Qué clases hay?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["accion"]["tipo"] == "clases", body
        assert desc_clase.split()[0] in body["respuesta"], body
    finally:
        db, gen = _db(app)
        try:
            db.query(HomePost).filter(HomePost.id == post_id).delete()
            db.query(EduClass).filter(EduClass.id == clase_id).delete()
            db.commit()
            asistente_api.invalidar_cache_biblioteca()
        finally:
            _close(gen)


# ------------------------------------------------------- B7: rentabilidad --

def test_herramienta_rentabilidad_en_biblioteca(client, admin_headers):
    """B7: la calculadora de rentabilidad está en el índice y se
    encuentra por biblioteca."""
    r = _chat(client, admin_headers, "Busco la calculadora de rentabilidad")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "biblioteca", body
    rec = next((x for x in body["recursos"]
                if x["id"] == "herramienta:rentabilidad"), None)
    assert rec is not None, body
    assert rec["enlace"] == "/estudiar#herramienta-rentabilidad"


# ------------------------------------------------------- B2 QA: deny_linked_reader --

def _mk_linked_client(client, admin_headers):
    """Usuario prueba + contacto + vínculo; devuelve (headers, contact_id)."""
    username = _uid("cliente26")
    r = client.post(
        "/api/users",
        json={"username": username, "password": "pass1234abcd", "role": "prueba"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    r = client.post(
        "/api/crm/contacts",
        json={"name": f"Cliente {_uid('c26')}", "email": "", "phone": "",
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
        username, user_id=user["id"], token_version=user.get("token_version") or 0)
    return {"Authorization": f"Bearer {token}"}, contact["id"]


def test_uso_y_feedback_bloquean_cliente_vinculado(client, admin_headers):
    """B2 (QA): /uso y POST /feedback aplican deny_linked_reader."""
    headers, _cid = _mk_linked_client(client, admin_headers)
    r = client.get(f"{BASE}/uso", headers=headers)
    assert r.status_code == 403, r.text
    r = client.post(f"{BASE}/feedback",
                    json={"pregunta": "¿Qué hay nuevo?", "voto": "util"},
                    headers=headers)
    assert r.status_code == 403, r.text


# ------------------------------------------------------- B4 QA: ReglaIn --

def test_regla_modulo_ruta_largos_422(client, admin_headers, app):
    """B4 (QA): modulo >64 o ruta >128 dan 422, no 500."""
    pregunta_id = _seed_pregunta_row(app, _uid("pregunta-b4"))
    try:
        r = client.post(
            f"{BASE}/preguntas/{pregunta_id}/regla",
            json={"respuesta": "ok", "modulo": "m" * 65},
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text
        r = client.post(
            f"{BASE}/preguntas/{pregunta_id}/regla",
            json={"respuesta": "ok", "ruta": "r" * 129},
            headers=admin_headers,
        )
        assert r.status_code == 422, r.text
    finally:
        db, gen = _db(app)
        try:
            db.query(PreguntaSinRespuesta).filter(
                PreguntaSinRespuesta.id == pregunta_id).delete()
            db.commit()
        finally:
            _close(gen)


# ------------------------------------------------------- M7: rate limit en /feedback --
# Último test del archivo: agota el presupuesto de votos del admin
# (20/min); el fixture autouse vacía el limiter después de cada test.

def test_feedback_rate_limit_429(client, admin_headers, app):
    """M7: /feedback tiene el mismo limiter de chat (20/min por usuario)."""
    tag = _uid("FB26")
    try:
        for i in range(20):
            r = client.post(
                f"{BASE}/feedback",
                json={"pregunta": f"{tag} pregunta {i}", "voto": "util"},
                headers=admin_headers,
            )
            assert r.status_code == 201, r.text
        r = client.post(
            f"{BASE}/feedback",
            json={"pregunta": f"{tag} pregunta 21", "voto": "util"},
            headers=admin_headers,
        )
        assert r.status_code == 429, r.text
        assert r.headers.get("Retry-After"), r.headers
    finally:
        db, gen = _db(app)
        try:
            db.query(AsistenteFeedback).filter(
                AsistenteFeedback.pregunta.like(f"{tag}%")).delete()
            db.commit()
        finally:
            _close(gen)
