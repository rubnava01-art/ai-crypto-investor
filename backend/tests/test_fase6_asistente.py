"""Fase 6 mejoras-v1 — Asistente: límites por plan, "no sé", feedback y
consejo personalizado.

Tarea 1 (este archivo, primera parte): contador diario por usuario y
límites por plan (PROPUESTA pendiente de confirmación del dueño).
Los usuarios de prueba son frescos por test (nunca el `viewer`
compartido: su presupuesto diario es 10 y la suite ya lo usa).
"""
import datetime as dt
import uuid

from app.api.asistente import LIMITES_MENSAJES_POR_DIA, asistente_limiter
from app.core.security import create_access_token
from app.database import get_db
from app.models.tables import AsistenteUsoDiario, User

CHAT = "/api/asistente/chat"
USO = "/api/asistente/uso"


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
    """Usuario prueba fresco + token acuñado (precedente
    test_agentes_2026_11_23_chat_perfiles: sin login propio, que
    tiene presupuesto limitado en la suite)."""
    username = _uid("f6")
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


def _mk_user_con_app(client, app, admin_headers, plan: str | None = None):
    user, headers = _mk_user(client, admin_headers)
    if plan is not None:
        db, gen = _db(app)
        try:
            row = db.get(User, user["id"])
            row.requested_plan = plan
            db.commit()
        finally:
            _close(gen)
    return user, headers


def _chat(client, headers, mensaje: str):
    # Solo se limpia el limiter por minuto (20/min): el contador
    # diario de la Fase 6 NO se toca aquí.
    asistente_limiter.clear()
    return client.post(CHAT, json={"mensaje": mensaje}, headers=headers)


def _seed_uso(app, user_id: int, fecha: dt.date, mensajes: int):
    db, gen = _db(app)
    try:
        db.add(AsistenteUsoDiario(user_id=user_id, fecha=fecha, mensajes=mensajes))
        db.commit()
    finally:
        _close(gen)


# ------------------------------------------------------- tarea 1: límites --

def test_f6_limite_prueba_10_dia_y_429_con_plan(client, app, admin_headers):
    assert LIMITES_MENSAJES_POR_DIA["prueba"] == 10
    _user, headers = _mk_user_con_app(client, app, admin_headers)
    for _ in range(10):
        r = _chat(client, headers, "¿Qué hay nuevo?")
        assert r.status_code == 200, r.text
    r = _chat(client, headers, "¿Qué hay nuevo?")
    assert r.status_code == 429, r.text
    detalle = r.json()["detail"]
    assert "10" in detalle and "Prueba" in detalle
    assert "administrador" in detalle
    r = client.get(USO, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"] == "prueba"
    assert body["limite_diario"] == 10
    assert body["mensajes_hoy"] == 10
    assert body["restantes"] == 0


def test_f6_limite_uso_muestra_restantes(client, app, admin_headers):
    _user, headers = _mk_user_con_app(client, app, admin_headers)
    r = client.get(USO, headers=headers)
    assert r.json() == {
        "plan": "prueba",
        "plan_nombre": "Prueba",
        "limite_diario": 10,
        "mensajes_hoy": 0,
        "restantes": 10,
        "fecha": dt.datetime.now(dt.timezone.utc).date().isoformat(),
    }
    r = _chat(client, headers, "¿Qué hay nuevo?")
    assert r.status_code == 200, r.text
    r = client.get(USO, headers=headers)
    assert r.json()["mensajes_hoy"] == 1
    assert r.json()["restantes"] == 9


def test_f6_limite_esencial_50_desde_fila_sembrada(client, app, admin_headers):
    assert LIMITES_MENSAJES_POR_DIA["esencial"] == 50
    hoy = dt.datetime.now(dt.timezone.utc).date()
    user, headers = _mk_user_con_app(client, app, admin_headers, plan="esencial")
    _seed_uso(app, user["id"], hoy, 49)
    r = _chat(client, headers, "¿Qué hay nuevo?")
    assert r.status_code == 200, r.text
    r = _chat(client, headers, "¿Qué hay nuevo?")
    assert r.status_code == 429, r.text
    assert "50" in r.json()["detail"]
    assert "Esencial" in r.json()["detail"]


def test_f6_limite_se_reinicia_al_dia_siguiente(client, app, admin_headers):
    hoy = dt.datetime.now(dt.timezone.utc).date()
    ayer = hoy - dt.timedelta(days=1)
    user, headers = _mk_user_con_app(client, app, admin_headers)
    _seed_uso(app, user["id"], ayer, 10)  # ayer al límite: hoy no cuenta
    r = _chat(client, headers, "¿Qué hay nuevo?")
    assert r.status_code == 200, r.text
    r = client.get(USO, headers=headers)
    assert r.json()["mensajes_hoy"] == 1
    assert r.json()["restantes"] == 9


def test_f6_limite_admin_sin_limite(client, admin_headers):
    r = client.get(USO, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"] == "admin"
    assert body["limite_diario"] is None
    assert body["restantes"] is None
    for _ in range(3):
        r = _chat(client, admin_headers, "¿Qué hay nuevo?")
        assert r.status_code == 200, r.text


def test_f6_limite_429_no_incrementa_contador(client, app, admin_headers):
    """Corrección QA H3 (carrera): el 429 por límite no cuenta el
    mensaje rechazado. Sembrado a 9/10: una verificación pasa (10)
    y la siguiente es 429 con el contador quieto en 10."""
    import pytest
    from fastapi import HTTPException

    from app.api.asistente import _mensajes_hoy, _verificar_limite

    hoy = dt.datetime.now(dt.timezone.utc).date()
    user, _headers = _mk_user_con_app(client, app, admin_headers)
    _seed_uso(app, user["id"], hoy, 9)
    db, gen = _db(app)
    try:
        fila = db.get(User, user["id"])
        _clave, limite, total = _verificar_limite(db, fila)
        assert (limite, total) == (10, 10)
        with pytest.raises(HTTPException) as excinfo:
            _verificar_limite(db, fila)
        assert excinfo.value.status_code == 429
        assert "10" in str(excinfo.value.detail)
    finally:
        _close(gen)
    db, gen = _db(app)
    try:
        assert _mensajes_hoy(db, user["id"]) == 10
    finally:
        _close(gen)


def test_f6_limite_concurrente_no_sobrepasa(client, app, admin_headers):
    """Corrección QA H3 (carrera): 5 verificaciones concurrentes
    junto al límite (9/10) dejan el contador en 10, no en 11–14:
    el chequeo y el incremento son una sola sentencia atómica.
    Cada hilo usa su propia sesión (la BD de tests es un fichero
    SQLite compartido); un bloqueo transitorio de SQLite bajo
    contención se reintenta, no es un fallo."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.exc import OperationalError

    from app.api.asistente import _verificar_limite

    hoy = dt.datetime.now(dt.timezone.utc).date()
    user, _headers = _mk_user_con_app(client, app, admin_headers)
    _seed_uso(app, user["id"], hoy, 9)

    def _intento() -> str:
        for _ in range(50):
            db, gen = _db(app)
            try:
                fila = db.get(User, user["id"])
                _verificar_limite(db, fila)
                return "ok"
            except HTTPException as exc:
                if exc.status_code == 429:
                    return "429"
                raise
            except OperationalError as exc:
                if "locked" in str(exc).lower():
                    time.sleep(0.05)
                    continue
                raise
            finally:
                _close(gen)
        return "locked"

    with ThreadPoolExecutor(max_workers=5) as pool:
        resultados = list(pool.map(lambda _: _intento(), range(5)))
    assert resultados.count("ok") == 1, resultados
    assert resultados.count("429") == 4, resultados
    db, gen = _db(app)
    try:
        from app.api.asistente import _mensajes_hoy

        assert _mensajes_hoy(db, user["id"]) == 10
    finally:
        _close(gen)


# ------------------------------------------------------- tarea 2: "no sé" --

def test_f6_no_se_sin_fuente_ni_invento(client, app, admin_headers, monkeypatch):
    """Pregunta sin fuente: "No sé" explícito, sin afirmaciones
    inventadas, sin_respuesta True y registrada en la bandeja."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    pregunta = f"¿Qué es el zqxwvutl de prueba {_uid('nose')}?"
    r = _chat(client, admin_headers, pregunta)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sin_respuesta"] is True
    assert "No sé" in body["respuesta"]
    assert "no tengo una fuente" in body["respuesta"]
    assert "Estudiar" in body["respuesta"]  # sugiere dónde buscar
    # Nada inventado: la respuesta no define el término inexistente
    # ni repite la pregunta como si fuera una respuesta.
    assert "zqxwvutl" not in body["respuesta"]
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(p["pregunta"] == pregunta for p in r.json())


def test_f6_no_se_biblioteca_sin_resultado(client, app, admin_headers, monkeypatch):
    """Recurso concreto inexistente en Estudiar: "No sé" explícito,
    sin listar otros manuales como si fueran la respuesta."""
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    r = _chat(client, admin_headers, "¿Dónde está el manual de cocina?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sin_respuesta"] is True
    assert body.get("motivo") == "biblioteca_sin_resultado"
    assert "No sé" in body["respuesta"]
    assert "sin resultados en la biblioteca" in body["respuesta"]


# ----------------------------------------------------- tarea 3: feedback --

FEEDBACK = "/api/asistente/feedback"


def test_f6_feedback_util_se_guarda_sin_respuesta(client, app, admin_headers):
    user, headers = _mk_user_con_app(client, app, admin_headers)
    r = client.post(
        FEEDBACK, json={"pregunta": "¿Qué hay nuevo?", "voto": "util"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["voto"] == "util"
    r = client.get(f"{FEEDBACK}?voto=util", headers=admin_headers)
    assert r.status_code == 200, r.text
    fila = next(f for f in r.json() if f["pregunta"] == "¿Qué hay nuevo?")
    assert fila["usuario"] == user["username"]
    # Minimización de datos: solo pregunta + voto + usuario + fecha.
    assert set(fila.keys()) == {"id", "pregunta", "voto", "usuario", "creado_en"}


def test_f6_feedback_no_util_reentra_en_bandeja(client, app, admin_headers):
    user, headers = _mk_user_con_app(client, app, admin_headers)
    pregunta = f"¿Qué es el zqxwvutl {_uid('noutl')}?"
    r = client.post(
        FEEDBACK, json={"pregunta": pregunta, "voto": "no_util"}, headers=headers
    )
    assert r.status_code == 201, r.text
    r = client.get(f"{FEEDBACK}?voto=no_util", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(f["pregunta"] == pregunta for f in r.json())
    # La pregunta "no útil" queda en la bandeja del admin para enseñarla.
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(p["pregunta"] == pregunta for p in r.json())


def test_f6_feedback_solo_admin_lo_consulta_y_voto_invalido_422(
    client, app, admin_headers
):
    _user, headers = _mk_user_con_app(client, app, admin_headers)
    r = client.get(FEEDBACK, headers=headers)
    assert r.status_code == 403, r.text
    r = client.post(
        FEEDBACK, json={"pregunta": "¿Qué hay nuevo?", "voto": "maso"},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    r = client.post(FEEDBACK, json={"pregunta": "   ", "voto": "util"}, headers=headers)
    assert r.status_code == 422, r.text


# --------------------------------------- tarea 3: feedback y chat de invitado --

def _guest_headers() -> dict:
    """Token de invitado acuñado en el test (precedente
    test_agentes_2026_11_23_mejoras_optimas: no gasta el limiter de
    emisión de POST /api/auth/guest)."""
    from app.core.security import create_guest_token

    token, _gid = create_guest_token()
    return {"Authorization": f"Bearer {token}"}


def test_f6_feedback_invitado_se_guarda_como_invitado(client, app, admin_headers):
    """Corrección QA H3: el invitado puede votar; su voto queda con
    usuario 'invitado' (user_id NULL, no un usuario inventado)."""
    pregunta = f"¿Qué hay nuevo? {_uid('invfb')}"
    r = client.post(
        FEEDBACK, json={"pregunta": pregunta, "voto": "util"},
        headers=_guest_headers(),
    )
    assert r.status_code == 201, r.text
    assert r.json()["voto"] == "util"
    r = client.get(f"{FEEDBACK}?voto=util", headers=admin_headers)
    assert r.status_code == 200, r.text
    fila = next((f for f in r.json() if f["pregunta"] == pregunta), None)
    assert fila is not None, r.json()
    assert fila["usuario"] == "invitado"


def test_f6_feedback_invitado_no_util_no_entra_en_bandeja(client, app, admin_headers):
    """Corrección QA H3: el 'no útil' del invitado queda registrado
    (visible como invitado) pero NO entra en la bandeja del admin:
    un anónimo podría llenarla de spam (misma regla que las
    preguntas 'no sé' de invitado)."""
    pregunta = f"¿Qué es el zqxwvutl {_uid('invnoutl')}?"
    r = client.post(
        FEEDBACK, json={"pregunta": pregunta, "voto": "no_util"},
        headers=_guest_headers(),
    )
    assert r.status_code == 201, r.text
    r = client.get(f"{FEEDBACK}?voto=no_util", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert any(
        f["pregunta"] == pregunta and f["usuario"] == "invitado"
        for f in r.json()
    ), r.json()
    r = client.get("/api/asistente/preguntas", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert not any(p["pregunta"] == pregunta for p in r.json()), r.json()


def test_f6_chat_invitado_no_consume_cupo_diario(client, app):
    """Corrección QA H3: el chat de invitado no crea fila en
    AsistenteUsoDiario (no tiene user_id): su tope es el limiter
    por minuto (5/min por IP), no un límite diario."""
    from app.core.rate_limit import guest_chat_limiter

    guest_chat_limiter.clear()
    db, gen = _db(app)
    try:
        antes = db.query(AsistenteUsoDiario).count()
    finally:
        _close(gen)
    headers = _guest_headers()
    for _ in range(3):
        r = client.post(CHAT, json={"mensaje": "¿Qué hay nuevo?"}, headers=headers)
        assert r.status_code == 200, r.text
    db, gen = _db(app)
    try:
        assert db.query(AsistenteUsoDiario).count() == antes
    finally:
        _close(gen)


# ------------------------------------------- tarea 4: consejo personalizado --

CONSEJO_NEGATIVA = "No puedo darte consejos financieros personalizados"

# Corrección QA H3: una formulación por cada patrón de
# _PATRONES_CONSEJO (13), no solo 8. El test exige la igualdad de
# longitudes para que un patrón nuevo sin formulación falle.
FORMULACIONES_CONSEJO = [
    "¿Debo comprar más?",               # debo (comprar|vender|invertir|mantener)
    "¿Debería vender mis acciones?",   # deberia (comprar|vender|invertir|mantener)
    "¿Me conviene invertir ahora?",    # conviene (comprar|vender|invertir)
    "¿Cuánto invierto?",               # cuanto (invierto|meto|pongo)
    "¿Cuánto dinero debería invertir?",  # cuanto ... invertir
    "¿En qué invierto este mes?",      # en que (invierto|inviert|debo invertir)
    "¿Dónde invierto mis ahorros?",    # donde (invierto|inviert|debo invertir)
    "Recomiéndame en qué invertir",    # recomiend... (invertir|...|cartera|...)
    "¿Qué hago con mi cartera?",       # que hago con mi (cartera|dinero|...)
    "Mi cartera cae, ¿vendo o mantengo?",  # mi cartera ... (vendo|compro|...)
    "¿Es buen momento para vender?",   # es buen momento para (comprar|vender|invertir)
    "Should I buy bitcoin?",           # should i (buy|sell|invest)
    "How much should I invest?",       # how much should i invest
]


def test_f6_consejo_personalizado_se_niega_en_todas_las_formas(
    client, app, admin_headers
):
    # Una formulación por patrón: si se añade un patrón sin su
    # formulación, el test lo señala.
    from app.api.asistente import _PATRONES_CONSEJO

    assert len(FORMULACIONES_CONSEJO) == len(_PATRONES_CONSEJO) == 13
    for mensaje in FORMULACIONES_CONSEJO:
        r = _chat(client, admin_headers, mensaje)
        assert r.status_code == 200, (mensaje, r.text)
        body = r.json()
        assert CONSEJO_NEGATIVA in body["respuesta"], (mensaje, body)
        assert "no es asesoría financiera" in body["respuesta"]
        assert "Estudiar" in body["respuesta"]
        # No es un "no sé": la pregunta sí se responde (con la negativa).
        assert body["sin_respuesta"] is False


def test_f6_consejo_no_bloquea_consultas_educativas(
    client, app, admin_headers, monkeypatch
):
    monkeypatch.setattr("app.api.asistente.buscar_en_internet", lambda q: None)
    for mensaje in (
        "¿Cuánto vale el bitcoin?",
        "Analiza el mercado",
        "Recomiéndame un curso",
        "¿Qué es el RSI?",
    ):
        r = _chat(client, admin_headers, mensaje)
        assert r.status_code == 200, (mensaje, r.text)
        assert CONSEJO_NEGATIVA not in r.json()["respuesta"], (
            mensaje, r.json())


def test_f6_consejo_producto_propio_llega_a_estudiar(client, app, admin_headers):
    """Corrección QA H2: preguntar por comprar un producto propio
    (manual/curso) NO es consejo personalizado: llega a la
    biblioteca/Estudiar en vez de a la negativa. Lo que no es
    producto propio sigue bloqueado (bitcoin, ETH, casa). Las filas
    sembradas se borran al final: test_academy.py exige 9 cursos."""
    from decimal import Decimal

    from app.models.tables import Course, EduClass

    db, gen = _db(app)
    try:
        curso = Course(
            slug=f"manual-whatsapp-{uuid.uuid4().hex[:8]}",
            title="Manual de WhatsApp",
            description="Manual para vender por WhatsApp, paso a paso.",
            price_usd=Decimal("19.99"),
            kind="ebook",
            buy_url="https://go.hotmart.com/R107890527U",
            sort_order=99,
        )
        clase = EduClass(
            kind="grabada",
            title=f"Clase de prueba {_uid('f6clase')}",
            description="Clase sembrada para el test H2.",
            url="",
        )
        db.add(curso)
        db.add(clase)
        db.commit()
        curso_id, clase_id = curso.id, clase.id
    finally:
        _close(gen)
    try:
        # Producto propio -> biblioteca (manual $19.99).
        r = _chat(client, admin_headers, "¿Debo comprar el manual de WhatsApp?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert CONSEJO_NEGATIVA not in body["respuesta"], body
        assert body["accion"]["tipo"] == "biblioteca", body
        assert "Manual de WhatsApp" in body["respuesta"], body
        assert any(
            rec.get("titulo") == "Manual de WhatsApp"
            and rec.get("precio_usd") == 19.99
            for rec in body["accion"]["datos"]["recursos"]
        ), body
        # Producto propio -> Estudiar (clases): la palabra "curso"
        # dispara la intención de clases, que es Estudiar.
        r = _chat(client, admin_headers, "¿Debo comprar un curso?")
        assert r.status_code == 200, r.text
        body = r.json()
        assert CONSEJO_NEGATIVA not in body["respuesta"], body
        assert body["accion"]["tipo"] == "clases", body
        assert "Clase de prueba" in body["respuesta"], body
        # No son producto propio: siguen bloqueados. "bitcoin"/"ETH"
        # caen antes en el bloqueo de prohibidos ("comprar bitcoin"
        # es una orden explícita); "casa" llega al guardarraíl de
        # consejo. En ambos casos la respuesta es una negativa,
        # nunca la biblioteca ni una recomendación.
        for mensaje in ("¿Debo comprar bitcoin?", "¿Debo vender mis ETH?"):
            r = _chat(client, admin_headers, mensaje)
            assert r.status_code == 200, (mensaje, r.text)
            assert CONSEJO_NEGATIVA in r.json()["respuesta"] or (
                "El chat no puede hacer eso" in r.json()["respuesta"]
            ), (mensaje, r.json())
        r = _chat(client, admin_headers, "¿Debo vender mi casa?")
        assert r.status_code == 200, r.text
        assert CONSEJO_NEGATIVA in r.json()["respuesta"], r.json()
    finally:
        db, gen = _db(app)
        try:
            for fila in (db.get(Course, curso_id), db.get(EduClass, clase_id)):
                if fila is not None:
                    db.delete(fila)
            db.commit()
        finally:
            _close(gen)


def test_f6_consejo_antes_que_reglas_ensenadas(client, app, admin_headers):
    """Una regla enseñada no puede reabrir el consejo personalizado
    (igual que F2-4 con lo prohibido)."""
    from app.api.asistente import invalidar_cache_reglas
    from app.models.tables import ReglaAsistente

    db, gen = _db(app)
    try:
        regla = ReglaAsistente(
            patron="debo comprar mas zqxw",
            respuesta="Compra todo lo que puedas.",
            activo=True,
            creado_por="admin",
        )
        db.add(regla)
        db.commit()
        invalidar_cache_reglas()
        regla_id = regla.id
    finally:
        _close(gen)
    try:
        r = _chat(client, admin_headers, "¿Debo comprar más zqxw?")
        assert r.status_code == 200, r.text
        assert CONSEJO_NEGATIVA in r.json()["respuesta"]
        assert "Compra todo" not in r.json()["respuesta"]
    finally:
        db, gen = _db(app)
        try:
            fila = db.get(ReglaAsistente, regla_id)
            if fila is not None:
                db.delete(fila)
                db.commit()
            invalidar_cache_reglas()
        finally:
            _close(gen)
