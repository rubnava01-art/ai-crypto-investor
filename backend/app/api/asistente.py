"""Asistente — chat por REGLAS de Grow Business Platform (2026-11-22).

NO llama a OpenAI ni a ningún proveedor externo: no hay llave válida
(la pegada por el usuario dio 401 y nunca se guardó; AI_PROVIDER=stub).
El asistente razona con un parser de intenciones por palabras clave en
español (insensible a mayúsculas/acentos) + datos REALES de la
plataforma. Nunca inventa cifras: si no hay datos, lo dice.

Reutiliza la lógica existente, no la duplica:
- precios: caché de /api/market/prices (`app.api.market._PRICES_CACHE`)
  y, si está vacía, el último cierre guardado en velas (`ingest`).
- señales: tabla `Signal` directamente.
- análisis: `app.indicators.technical.summarize` sobre las velas
  guardadas + últimas señales + último backtest guardado en disco.
- notas/tareas: tablas `BusinessNote`/`BusinessTask` (área marketing).
- borrador: `ContentItem` del Content Engine, status borrador, con
  `source: "plantilla"` (reglas, no IA) en notas y en la respuesta.
- citas: `Appointment` + solape con `app.api.marketing._overlaps`.
- facturas: `app.api.bi._invoice_total`; ventas = facturas PAGADAS.
- contactos/clases/novedades: lectura directa de `Contact`,
  `EduClass` y `HomePost`.

Corrida 2026-11-23, Agente 2 (chat con Internet + mejora propia +
aislamiento por perfil):
- Orden de resolución: (a) reglas enseñadas por el admin, (b)
  intenciones internas, (c) catálogo de ayuda, (d) Internet como
  fallback (solo la pregunta genérica, nunca datos de la
  plataforma). La respuesta gana `fuente` {nombre, url},
  `consultado_en` (ISO UTC) y `sin_respuesta` (bool).
- M1 resuelto: el rol prueba ya NO recibe facturas/citas/contactos
  reales por chat ("no disponible en la demo"). El cliente vinculado
  sigue fuera del chat por B1 (403 antes que cualquier intención).
- Bandeja "Preguntas por enseñar": preguntas sin respuesta se
  registran en `preguntas_sin_respuesta`; el admin crea reglas en
  `reglas_asistente` desde la bandeja; nada se auto-escribe.

Seguridad (dura):
- Mutaciones (nota/tarea/borrador/cita) SOLO admin/super_admin
  (`user.is_admin`; el super admin también es admin). El rol prueba
  recibe 200 con accion null y la explicación de solo lectura; la
  mutación NO se ejecuta.
- PROHIBIDO para el chat (hard-codeado, nunca se llama a esos
  endpoints ni aparecen en capacidades): /api/users y
  /api/auth/change-password, aprobar/rechazar/renombrar usuarios,
  roles, secretos/variables, conexiones de exchange, kill switch,
  pagos y CUALQUIER orden real de trading. El chat jamás ejecuta
  órdenes reales ni toca REAL_TRADING_ENABLED. Las etiquetas de
  simulación se mantienen.
"""
import datetime as dt
import json
import os
import re
import time
import unicodedata
from decimal import Decimal
from types import SimpleNamespace
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api import market as market_api
from app.api.backtest import RUNS_DIR
from app.api.bi import _invoice_total
from app.api.marketing import _overlaps
from app.api.portal import deny_linked_reader
from app.core.idempotency import (
    check_idempotency,
    idempotency_key_from,
    store_idempotency,
)
from app.core.hardening import audit
from app.core.rate_limit import (
    RateLimiter,
    guest_chat_limiter,
    too_many_requests,
)
from app.core.security import (
    Guest,
    Principal,
    get_current_principal,
    get_current_user,
    guest_read_guard,
    is_super_admin,
    require_admin,
)
from app.data import ingest
from app.database import get_db
from app.indicators import technical as ind
from app.internet import buscar_en_internet, precio_coingecko
from app.models.tables import (
    Appointment,
    AsistenteFeedback,
    AsistenteUsoDiario,
    BusinessNote,
    BusinessTask,
    Contact,
    ContentItem,
    Course,
    EduClass,
    HomePost,
    Invoice,
    MarketingCampaign,
    PreguntaSinRespuesta,
    ReglaAsistente,
    Signal,
    User,
    VideoEducativo,
)

router = APIRouter(prefix="/api/asistente", tags=["asistente"])

MAX_MENSAJE = 1000

# F2-5 (corrida 2026-11-24): las horas de las citas se interpretan en
# la zona del usuario (America/Los_Angeles) y se guardan en UTC.
TZ_LA = ZoneInfo("America/Los_Angeles")

# B2 (corrida seguridad 2026-11-23): limiter por USUARIO en /chat
# (20/min, como ai_ask). Clave solo por usuario: sobrevive al proxy
# de Render, donde la IP colapsa (ver rate_limit.py).
asistente_limiter = RateLimiter(max_requests=20, window_seconds=60)

# ------------------------------------------------- límites por plan (Fase 6) --
# PROPUESTA PENDIENTE DE CONFIRMACIÓN DEL DUEÑO (Fase 6, tarea 1):
# estos límites NO están aprobados por Rubén; son valores
# conservadores de partida. El dueño debe confirmarlos o cambiarlos
# antes de publicar la Fase 6. UN SOLO SITIO: cambiar un número aquí
# cambia el límite en el chat y en GET /api/asistente/uso.
# Corrida 2026-11-26 (A2): cada límite se lee de su variable de
# entorno (ASISTENTE_LIMITE_PRUEBA/ESENCIAL/CRECIMIENTO/TOTAL) con
# los valores propuestos (10/50/200/1000) como predeterminados; un
# valor ausente, no numérico o <= 0 cae al predeterminado. Sin
# cambio de esquema: sigue siendo un dict en memoria, no una tabla.
# Día = día natural UTC (toda la BD guarda en UTC); al cambiar de día
# el contador vuelve a cero porque la fila es otra (ver
# AsistenteUsoDiario). La subida de plan hoy la hace el administrador
# (no hay pago en línea: la Fase 7 la prepara); el 429 lo dice así,
# sin prometer nada que no exista.
def _limite_env(nombre: str, defecto: int) -> int:
    """Límite diario desde variable de entorno, o el predeterminado."""
    raw = (os.environ.get(nombre) or "").strip()
    if not raw:
        return defecto
    try:
        valor = int(raw)
    except ValueError:
        return defecto
    return valor if valor > 0 else defecto


LIMITES_MENSAJES_POR_DIA: dict[str, int] = {
    "prueba": _limite_env("ASISTENTE_LIMITE_PRUEBA", 10),        # rol prueba / sin plan elegido
    "esencial": _limite_env("ASISTENTE_LIMITE_ESENCIAL", 50),    # Esencial $19/mes
    "crecimiento": _limite_env("ASISTENTE_LIMITE_CRECIMIENTO", 200),  # Crecimiento $49/mes
    "total": _limite_env("ASISTENTE_LIMITE_TOTAL", 1000),        # Negocio Total $99/mes
}
NOMBRES_PLAN: dict[str, str] = {
    "prueba": "Prueba",
    "esencial": "Esencial ($19/mes)",
    "crecimiento": "Crecimiento ($49/mes)",
    "total": "Negocio Total ($99/mes)",
}
_PLANES_VALIDOS = frozenset(LIMITES_MENSAJES_POR_DIA)


def _plan_usuario(user: User, db: Session) -> tuple[str, int | None]:
    """(clave de plan, límite diario o None si no tiene límite).

    admin/super_admin: SIN límite (operan la plataforma; documentado,
    no es un olvido). El resto: la SUSCRIPCIÓN vigente manda si la
    hay con acceso (Fase 7: plan de la suscripción, no solo el
    elegido al registrarse); si hay fila de suscripción SIN acceso
    (en_pausa, vencida o fin de periodo pasado), el plan es
    "prueba" — User.requested_plan NO se usa en ese caso
    (corrección QA H2-1 Fase 7, 2026-11-25); si no hay fila,
    User.requested_plan ("esencial"|"crecimiento"|"total", elegido
    al registrarse); sin plan o con un valor desconocido ->
    "prueba". Una suscripción vencida o en pausa NO sube el límite:
    se cae a prueba, no al plan elegido."""
    if user.is_admin or is_super_admin(user, db):
        return "admin", None
    from app.api.suscripciones import clave_plan_asistente_para_usuario

    clave_sub = clave_plan_asistente_para_usuario(db, user)
    clave = clave_sub or (user.requested_plan or "").strip().lower()
    if clave not in _PLANES_VALIDOS:
        clave = "prueba"
    return clave, LIMITES_MENSAJES_POR_DIA[clave]


def _hoy_utc() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def _mensajes_hoy(db: Session, user_id: int) -> int:
    row = (
        db.query(AsistenteUsoDiario)
        .filter(AsistenteUsoDiario.user_id == user_id,
                AsistenteUsoDiario.fecha == _hoy_utc())
        .first()
    )
    return int(row.mensajes) if row is not None else 0


def _incrementar_cupo(db: Session, user_id: int, limite: int | None) -> int | None:
    """Suma 1 al contador de hoy y devuelve el total nuevo, o None
    si el límite ya estaba alcanzado (el mensaje rechazado NO se
    cuenta).

    Corrección QA H3 (condición de carrera): antes se leía el total
    y luego se escribía en dos pasos; dos peticiones concurrentes
    junto al límite podían pasar el chequeo a la vez y sobrepasarlo
    en 1–2 mensajes. Ahora el chequeo y el incremento son UNA sola
    sentencia atómica (INSERT ... ON CONFLICT DO UPDATE ... WHERE
    mensajes < limite RETURNING mensajes), posible porque
    `asistente_uso_diario` tiene la restricción única (user_id,
    fecha). El mismo SQL vale en SQLite (tests) y en Postgres
    (producción): mismo precedente que `app/data/ingest.py`
    (upsert con `on_conflict_do_update` por dialecto). Con limite
    None (admin, sin límite) el incremento es incondicional."""
    hoy = _hoy_utc()
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = pg_insert(AsistenteUsoDiario)
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        stmt = sqlite_insert(AsistenteUsoDiario)
    stmt = stmt.values(user_id=user_id, fecha=hoy, mensajes=1)
    if limite is None:
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "fecha"],
            set_={"mensajes": AsistenteUsoDiario.mensajes + 1},
        )
    else:
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "fecha"],
            set_={"mensajes": AsistenteUsoDiario.mensajes + 1},
            where=AsistenteUsoDiario.mensajes < limite,
        )
    row = db.execute(stmt.returning(AsistenteUsoDiario.mensajes)).fetchone()
    db.commit()
    return int(row[0]) if row is not None else None


def _segundos_hasta_manana_utc() -> int:
    ahora = dt.datetime.now(dt.timezone.utc)
    manana = (ahora + dt.timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return max(60, int((manana - ahora).total_seconds()))


def _verificar_limite(db: Session, user: User) -> tuple[str, int | None, int]:
    """Comprueba el límite diario ANTES de responder: si hay cupo,
    cuenta el mensaje y devuelve (plan, límite, mensajes_hoy).
    Si no hay cupo, lanza 429 en español con el límite, el plan
    actual y la vía de subida (el administrador). El 429 NO se
    cuenta como mensaje. El invitado no pasa por aquí (sin user_id:
    su tope es el limiter por minuto). El chequeo y el conteo son
    una sola sentencia atómica (ver _incrementar_cupo)."""
    clave, limite = _plan_usuario(user, db)
    hoy = _incrementar_cupo(db, user.id, limite)
    if hoy is None:
        raise too_many_requests(
            f"Has llegado a tu límite diario del Asistente: {limite} "
            f"mensajes al día en tu plan {NOMBRES_PLAN[clave]}. Vuelve "
            "mañana o pídele al administrador que suba tu plan "
            "(Esencial, Crecimiento o Negocio Total); la subida la "
            "hace el administrador.",
            _segundos_hasta_manana_utc(),
        )
    return clave, limite, hoy

# ------------------------------------------------------------------ catálogo --

COMANDOS = [
    {
        "id": "precio_btc",
        "ejemplo": "¿Cuánto vale el bitcoin?",
        "descripcion": "Precio actual de BTC, ETH, USDT y BNB con datos reales de la plataforma.",
        "requiere_admin": False,
    },
    {
        "id": "senales",
        "ejemplo": "Muéstrame las últimas señales",
        "descripcion": "Resumen de las últimas señales demo/simuladas registradas en la plataforma.",
        "requiere_admin": False,
    },
    {
        "id": "analisis",
        "ejemplo": "Analiza el mercado",
        "descripcion": "RSI y MACD sobre velas reales, resumen de señales y último backtest.",
        "requiere_admin": False,
    },
    {
        "id": "crear_nota",
        "ejemplo": "Crea una nota: revisar precios de proveedor",
        "descripcion": "Crea una nota en Negocio > Marketing.",
        "requiere_admin": True,
    },
    {
        "id": "crear_tarea",
        "ejemplo": "Crea una tarea: llamar a TJ's",
        "descripcion": "Crea una tarea pendiente en Negocio > Marketing.",
        "requiere_admin": True,
    },
    {
        "id": "crear_borrador",
        "ejemplo": "Crea un borrador sobre el nuevo curso",
        "descripcion": "Crea un borrador de contenido (reglas, no IA; source: plantilla).",
        "requiere_admin": True,
    },
    {
        "id": "listar_citas",
        "ejemplo": "¿Qué citas tengo?",
        "descripcion": "Lista las próximas citas (no canceladas).",
        "requiere_admin": False,
    },
    {
        "id": "crear_cita",
        "ejemplo": "Crea una cita para María mañana a las 10:00",
        "descripcion": "Crea una cita (60 min) respetando el solape: si choca con otra, no se crea.",
        "requiere_admin": True,
    },
    {
        "id": "facturas",
        "ejemplo": "¿Cuánto hemos vendido?",
        "descripcion": "Resumen de ventas: solo facturas PAGADAS cuentan como ventas.",
        "requiere_admin": False,
    },
    {
        "id": "contactos",
        "ejemplo": "Muéstrame los contactos",
        "descripcion": "Lista los contactos del CRM (solo lectura).",
        "requiere_admin": False,
    },
    {
        "id": "clases",
        "ejemplo": "¿Qué clases hay?",
        "descripcion": "Lista las clases de Estudiar.",
        "requiere_admin": False,
    },
    {
        "id": "novedades",
        "ejemplo": "¿Qué hay nuevo?",
        "descripcion": "Últimas novedades publicadas en Inicio.",
        "requiere_admin": False,
    },
    {
        "id": "planes",
        "ejemplo": "¿Cuánto vale el plan Esencial?",
        "descripcion": "Precios de los planes (Esencial $19, Crecimiento $49, Negocio Total $99) y prueba gratis de 14 días.",
        "requiere_admin": False,
    },
    {
        "id": "campanas",
        "ejemplo": "¿Qué campañas hay?",
        "descripcion": "Lista las campañas de marketing y su estado (solo lectura).",
        "requiere_admin": False,
    },
    {
        "id": "flujos",
        "ejemplo": "¿Qué son los flujos?",
        "descripcion": "Explica qué son los flujos y dónde verlos (viven en el navegador, no en el servidor).",
        "requiere_admin": False,
    },
    {
        "id": "ayuda",
        "ejemplo": "¿Qué puedes hacer?",
        "descripcion": "Lista todo lo que el asistente puede hacer.",
        "requiere_admin": False,
    },
    {
        "id": "resumen_modulo",
        "ejemplo": "Resume el módulo Estudiar",
        "descripcion": "Resumen de un módulo desde su registro real (nombre, ruta, qué contiene).",
        "requiere_admin": False,
    },
    {
        "id": "biblioteca",
        "ejemplo": "¿Dónde está el manual de WhatsApp?",
        "descripcion": "Busca cursos, clases, vídeos y herramientas de Estudiar.",
        "requiere_admin": False,
    },
]

_SUGERENCIAS_LECTURA = [
    "¿Cuánto vale el bitcoin?",
    "Muéstrame las últimas señales",
    "¿Qué hay nuevo?",
]

# Patrones PROHIBIDOS (texto ya normalizado: minúsculas, sin acentos).
# Se comprueban ANTES que cualquier intención: el chat nunca ejecuta
# estas acciones ni las sugiere como comando propio.
_PROHIBIDO = (
    "kill switch",
    "contrasena",
    "password",
    "cambia la clave",
    "cambiar la clave",
    "cambia mi clave",
    "cambiar mi clave",
    "cambiar clave",
    "cambia la contrasena",
    "cambiar contrasena",
    "restablecer clave",
    "crear usuario",
    "crea un usuario",
    "crear un usuario",
    "eliminar usuario",
    "borrar usuario",
    "renombrar usuario",
    "renombrar un usuario",
    # F2-6: "usuarios" a secas era falso positivo ("Control de
    # usuarios", "¿dónde está el Control de usuarios?"). La
    # enumeración de usuarios sigue bloqueada por las formas
    # explícitas de abajo; "renombrar" a secas también salía
    # (p. ej. renombrar una nota) y queda solo con "usuario".
    "lista los usuarios",
    "muestra los usuarios",
    "ver usuarios",
    "listar usuarios",
    "cuantos usuarios",
    "cambiar el rol",
    "cambiar rol",
    # "rol" suelto NO va: es subcadena de "control" ("Control de
    # usuarios") y daría falsos positivos. Van las formas con
    # artículo/verbo, que cubren "cambia el rol del usuario X a admin".
    "cambia el rol",
    " el rol",
    " mi rol",
    "haz admin",
    "hazme admin",
    "aprobar usuario",
    "rechazar usuario",
    "api key",
    "clave api",
    "secreto",
    "variable de entorno",
    "variables de entorno",
    "conectar el exchange",
    "conexion de exchange",
    "conectar kraken",
    "conectar coinbase",
    "compra btc",
    "compra bitcoin",
    "compra eth",
    "compra ethereum",
    "comprar btc",
    "comprar bitcoin",
    "comprar eth",
    "vende btc",
    "vende bitcoin",
    "vende eth",
    "vender btc",
    "vender bitcoin",
    "vender eth",
    "orden real",
    "trading real",
    "dinero real",
    "con dinero real",
    "realizar un pago",
    "hacer un pago",
    # F2-6: "desactiva el" / "desactivar el" a secas bloqueaban
    # cualquier desactivación ("desactiva el escáner"); el kill
    # switch ya está cubierto por "kill switch" arriba.
)

_RESPUESTA_PROHIBIDO = (
    "El chat no puede hacer eso: no gestiona usuarios, claves, roles, "
    "secretos, conexiones de exchange, kill switch, pagos ni órdenes "
    "reales de trading. Para trading, usa el panel Invertir en modo "
    "simulación; para usuarios y claves, Control de usuarios (solo el "
    "administrador). ¿Te ayudo con precios, señales, análisis, citas, "
    "facturas, contactos, clases o novedades?"
)


# ------------------------------------------------------------------ helpers --

def _norm(text: str) -> str:
    """Minúsculas, sin acentos, espacios colapsados (coincidencia por
    subcadena insensible a mayúsculas/acentos)."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    sin_acentos = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", sin_acentos.lower()).strip()


def _money(value: Decimal | float | None) -> str:
    if value is None:
        return "sin dato"
    return f"${float(value):,.2f}"


def _iso(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _extracto(texto: str | None, limite: int = 140) -> str:
    """Extracto corto de un cuerpo (B2, 2026-11-26): novedades y
    clases muestran de qué tratan, no solo el título. Una línea,
    sin saltos, cortado a `limite` caracteres."""
    limpio = re.sub(r"\s+", " ", (texto or "")).strip()
    if len(limpio) <= limite:
        return limpio
    return limpio[:limite].rstrip() + "…"


def _ahora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _contiene_prohibido(norm: str) -> bool:
    """True si el mensaje pide algo prohibido (F2-4/F2-6).

    Las frases se comprueban por subcadena (como antes); las
    palabras sueltas de _PROHIBIDO ("contrasena", "password",
    "secreto") por palabra completa (\\b), para no bloquear por
    subcadena ("contraseña" dentro de otra palabra)."""
    for p in _PROHIBIDO:
        if " " in p:
            if p in norm:
                return True
        elif re.search(r"\b" + re.escape(p) + r"\b", norm):
            return True
    if re.search(
        r"\b(compra|comprar|vende|vender|invierte|invertir)\b.{0,30}\b(btc|bitcoin|eth|ethereum|cripto)",
        norm,
    ):
        return True
    return False


# --------------------------------------- consejo financiero (Fase 6, tarea 4) --
# Patrones de CONSEJO PERSONALIZADO (texto ya normalizado: minúsculas,
# sin acentos). Se comprueban DESPUÉS de _PROHIBIDO (una orden explícita
# "compra bitcoin" ya cae en ese bloqueo) y ANTES de las reglas enseñadas
# (una regla nunca puede reabrir el consejo personalizado, igual que
# F2-4 con lo prohibido). Solo cubren preguntas que piden una decisión
# sobre EL DINERO DEL USUARIO ("¿debo comprar?", "¿cuánto invierto?",
# "¿qué hago con mi cartera?"); NO cubren consultas educativas
# ("¿qué es el RSI?", "analiza el mercado", "¿cuánto vale el bitcoin?",
# "recomiéndame un curso").
_PATRONES_CONSEJO: tuple[str, ...] = (
    r"\bdebo (comprar|vender|invertir|mantener)\b",
    r"\bdeberia (comprar|vender|invertir|mantener)\b",
    r"\bconviene (comprar|vender|invertir)\b",
    r"\bcuanto (invierto|meto|pongo)\b",
    r"\bcuanto\b.{0,20}\binvertir\b",
    r"\ben que (invierto|inviert|debo invertir)\b",
    r"\bdonde (invierto|inviert|debo invertir)\b",
    r"\brecomiend\w*\b.{0,50}\b(invertir|inversion|btc|bitcoin|eth|ethereum|cripto|cartera|acciones?|fondos?)\b",
    r"\bque hago con mi (cartera|dinero|inversion|ahorros|plata)\b",
    r"\bmi cartera\b.{0,40}\b(vendo|compro|invierto|hago|mantengo)\b",
    r"\bes buen momento para (comprar|vender|invertir)\b",
    r"\bshould i (buy|sell|invest)\b",
    r"\bhow much should i invest\b",
)


# Productos propios (corrección QA H2, Fase 6): "¿debo comprar el
# manual de WhatsApp?" o "¿debo comprar un curso?" NO son consejo
# de inversión: preguntan por un producto de la plataforma
# (manual $19.99, academia $400) y deben llegar a la
# biblioteca/Estudiar, no a la negativa de asesoría. Vía elegida:
# exclusión explícita del objeto — el chequeo de consejo se salta
# solo cuando el verbo (debo/debería/conviene + comprar/vender/
# invertir/mantener) lleva como objeto un producto propio
# (curso/manual/academia/libro/guía/pack/ebook) a menos de 40
# caracteres. Es deliberadamente amplia hacia el producto: una
# pregunta mixta ("¿debo comprar bitcoin o el manual?") va a la
# biblioteca en vez de a la negativa. Lo que NO es producto propio
# sigue bloqueado: "¿debo comprar bitcoin?", "¿debo vender mis
# ETH?" y "¿debo vender mi casa?" (la casa es una decisión
# patrimonial, no un producto de la plataforma).
_PRODUCTOS_PROPIOS: tuple[str, ...] = (
    "manual", "manuales", "curso", "cursos", "academia",
    "libro", "libros", "guia", "guias", "pack", "ebook", "ebooks",
)
_RE_PRODUCTO_PROPIO = re.compile(
    r"\b(debo|deberia|conviene)\s+(comprar|vender|invertir|mantener)\b"
    r".{0,40}\b(" + "|".join(_PRODUCTOS_PROPIOS) + r")\b"
)


def _es_consejo_personalizado(norm: str) -> bool:
    """True si el mensaje pide consejo financiero personalizado."""
    if _RE_PRODUCTO_PROPIO.search(norm):
        return False
    return any(re.search(p, norm) for p in _PATRONES_CONSEJO)


def _h_consejo_personalizado() -> dict:
    """Negativa a dar consejo personalizado (Fase 6, tarea 4): en
    español, con recordatorio de simulación/no asesoría y sugerencia
    de contenido educativo (Estudiar) o herramientas. No es
    sin_respuesta (la pregunta SÍ se responde, con la negativa) y no
    va a la bandeja: el admin no puede "enseñar" una respuesta de
    consejo personalizado."""
    return _respuesta(
        "No puedo darte consejos financieros personalizados: no sé tu "
        "situación, tus objetivos ni tu tolerancia al riesgo, y este "
        "asistente no es asesoría financiera. Todo lo que ves aquí es "
        "simulación y datos reales de la plataforma, nunca una "
        "recomendación de inversión. Si quieres aprender, en Estudiar "
        "(/estudiar) tienes los cursos y manuales, y en Clases las "
        "herramientas: calculadora de interés compuesto, conversor "
        "BTC/USD, gráfica e indicadores. También puedes pedirme un "
        "análisis con datos reales: «Analiza el mercado».",
        sugerencias=["Analiza el mercado", "¿Qué clases hay?", "¿Cuánto vale el bitcoin?"],
    )


def _sugerencia_obj(s) -> dict:
    """Una sugerencia con su marca requiere_admin (contrato
    2026-11-24): el frontend deja de inferirlo por el prefijo
    "Crea ". Una sugerencia es de admin si es una orden de
    creación (crear/agendar/generar/hacer)."""
    if isinstance(s, dict):
        return {"texto": str(s.get("texto", "")),
                "requiere_admin": bool(s.get("requiere_admin", False))}
    n = _norm(str(s))
    req = n.startswith(("crea ", "crear ", "agenda ", "agendar ",
                        "genera ", "generar ", "haz ", "hacer "))
    return {"texto": str(s), "requiere_admin": req}


def _respuesta(texto: str, tipo: str | None = None, datos: dict | None = None,
               sugerencias: list[str] | None = None,
               fuente: dict | None = None,
               consultado_en: str | None = None,
               sin_respuesta: bool = False,
               confianza: int | None = None,
               aclaracion: dict | None = None,
               recursos: list | None = None,
               motivo: str | None = None) -> dict:
    accion = None if tipo is None else {"tipo": tipo, "datos": datos or {}}
    return {
        "respuesta": texto,
        "accion": accion,
        # Contrato 2026-11-24: sugerencias como objetos
        # {texto, requiere_admin}; fuente y consultado_en en TODAS
        # las respuestas (F3-1: el default es la plataforma misma,
        # nunca null). confianza 0-100, aclaracion y recursos solo
        # cuando el handler los aporta; motivo solo en sin_respuesta.
        "sugerencias": [_sugerencia_obj(s) for s in
                        (sugerencias if sugerencias is not None else _SUGERENCIAS_LECTURA)],
        "fuente": fuente or {"nombre": "Plataforma Grow Business", "url": None},
        "consultado_en": consultado_en or _ahora_iso(),
        "sin_respuesta": sin_respuesta,
        "motivo": motivo,
        "confianza": confianza,
        "aclaracion": aclaracion,
        "recursos": recursos,
    }


def _etiqueta_principal(principal) -> str:
    """Nombre del perfil para los mensajes de rechazo: el invitado no
    es "prueba" (P2 QA 2026-11-23: el texto lo etiquetaba mal)."""
    if isinstance(principal, Guest):
        return "invitado"
    return "prueba"


def _solo_lectura(principal=None) -> dict:
    etiqueta = _etiqueta_principal(principal)
    return _respuesta(
        f"Tu rol ({etiqueta}) es de solo lectura: puedes consultar precios, "
        "señales, análisis, citas, facturas, contactos, clases y "
        "novedades, pero no crear notas, tareas, borradores ni citas. "
        "Pídele a un administrador que haga ese cambio.",
        sugerencias=_SUGERENCIAS_LECTURA,
    )


def _no_disponible_demo(principal=None) -> dict:
    """M1 (resuelto 2026-11-23): prueba ya NO recibe facturas, citas
    ni contactos reales por chat. Precios, señales, análisis, clases
    y novedades siguen disponibles."""
    etiqueta = _etiqueta_principal(principal)
    return _respuesta(
        f"No disponible en la demo: tu rol ({etiqueta}) puede "
        "consultar precios, señales, análisis, clases y novedades, "
        "pero no ver facturas, citas ni contactos reales. Pídele a un "
        "administrador que te dé acceso.",
        sugerencias=_SUGERENCIAS_LECTURA,
    )


# ------------------------------------------------------------------ ayuda --
# Catálogo de ayuda estático (corrida 2026-11-23): temas con palabras
# clave, pasos concretos en español, módulo y ruta interna. Los pasos
# describen flujos reales de la plataforma (no se inventa ningún
# botón): crear factura (Facturas), invitar cliente (Control de
# usuarios + vínculo del portal), citas/notas/tareas (Negocio >
# Marketing), borrador (Crear / Content Engine), señales/precios
# (Invertir), cambiar clave (Mi perfil, endpoint real
# /api/auth/change-password), publicar novedad (Inicio, admin),
# ver mis facturas (portal del cliente).
AYUDAS = [
    {
        "id": "crear_factura",
        "claves": ("crear factura", "crear una factura", "como hago una factura",
                   "como creo una factura", "nueva factura", "hacer una factura"),
        "titulo": "Crear una factura",
        "pasos": ("Ve a Facturas (/facturas) y crea una factura nueva con "
                  "el cliente y el importe. Queda como borrador hasta que "
                  "la envíes; solo las facturas pagadas cuentan como ventas."),
        "modulo": "facturas",
        "ruta": "/facturas",
    },
    {
        "id": "invitar_cliente",
        "claves": ("invitar cliente", "invitar un cliente", "invitar a un cliente",
                   "como invito a un cliente", "como invitar a un cliente",
                   "dar acceso a un cliente", "acceso de cliente"),
        "titulo": "Invitar a un cliente",
        "pasos": ("Lo hace el administrador: primero crea la cuenta del "
                  "cliente en Control de usuarios (/usuarios, rol prueba) "
                  "y después la vincula a su contacto en Negocio > "
                  "Marketing > Portal (Vínculos). El cliente entra con "
                  "esa cuenta y solo ve su portal."),
        "modulo": "crm",
        "ruta": "/crm",
    },
    {
        "id": "crear_cita",
        "claves": ("como creo una cita", "como hago una cita",
                   "como agendo una cita", "como se crea una cita",
                   "como pedir una cita", "como agendar una cita"),
        "titulo": "Crear una cita",
        "pasos": ("En Negocio > Marketing > Citas (/business) crea la "
                  "cita con el cliente, la fecha y la hora (60 min). "
                  "También puedes pedírmela a mí: «Crea una cita para "
                  "María mañana a las 10:00» (solo el administrador)."),
        "modulo": "business",
        "ruta": "/business",
    },
    {
        "id": "crear_nota_tarea",
        "claves": ("como creo una nota", "como hago una nota",
                   "como creo una tarea", "como hago una tarea",
                   "como se crea una nota", "como se crea una tarea"),
        "titulo": "Crear una nota o una tarea",
        "pasos": ("En Negocio > Marketing (/business) crea notas y "
                  "tareas. También puedes pedírmelas a mí: «Crea una "
                  "nota: revisar precios» o «Crea una tarea: llamar a "
                  "un cliente» (solo el administrador)."),
        "modulo": "business",
        "ruta": "/business",
    },
    {
        "id": "crear_borrador",
        "claves": ("como creo un borrador", "como hago un borrador",
                   "como se crea un borrador", "como creo contenido",
                   "como hago contenido", "como creo un post",
                   "como creo una publicacion"),
        "titulo": "Crear un borrador de contenido",
        "pasos": ("En Crear (/crear), Content Engine, crea un borrador "
                  "con el tema y la plataforma. También puedes "
                  "pedírmelo a mí: «Crea un borrador sobre el nuevo "
                  "curso» (solo el administrador; es una plantilla por "
                  "reglas, no IA: revísalo antes de programarlo)."),
        "modulo": "crear",
        "ruta": "/crear",
    },
    {
        "id": "ver_senales_precios",
        "claves": ("como veo las senales", "como ver las senales",
                   "como veo los precios", "como ver los precios",
                   "donde veo las senales", "donde veo los precios",
                   "donde estan las senales", "donde estan los precios"),
        "titulo": "Ver señales y precios",
        "pasos": ("En Invertir (/) ves los precios de BTC/ETH y las "
                  "últimas señales en modo simulación. También puedes "
                  "preguntarme: «¿Cuánto vale el bitcoin?» o "
                  "«Muéstrame las últimas señales»."),
        "modulo": "invertir",
        "ruta": "/",
    },
    {
        "id": "cambiar_clave",
        "claves": ("como cambio mi clave", "como cambiar mi clave",
                   "como cambio la clave", "como cambiar la clave",
                   "cambiar mi clave", "donde cambio mi clave",
                   "como cambio mi contrasena"),
        "titulo": "Cambiar mi clave",
        "pasos": ("En Mi perfil (/perfil), «Cambiar mi clave»: escribe "
                  "tu clave actual y la nueva (mínimo 12 caracteres). "
                  "Después tendrás que volver a entrar con la clave nueva."),
        "modulo": "perfil",
        "ruta": "/perfil",
    },
    {
        "id": "publicar_novedad",
        "claves": ("como publico una novedad", "como publicar una novedad",
                   "como creo una novedad", "publicar novedad",
                   "publicar una novedad", "nueva novedad"),
        "titulo": "Publicar una novedad",
        "pasos": ("En Inicio (/inicio) el administrador crea una "
                  "novedad con título y texto y se publica en Inicio. "
                  "Las novedades del sistema («Actualización de la "
                  "plataforma») solo cambian cuando el administrador "
                  "aprueba una publicación."),
        "modulo": "inicio",
        "ruta": "/inicio",
    },
    {
        "id": "ver_mis_facturas",
        "claves": ("como veo mis facturas", "ver mis facturas",
                   "donde veo mis facturas", "donde estan mis facturas",
                   "mis facturas"),
        "titulo": "Ver mis facturas (cliente)",
        "pasos": ("Como cliente vinculado, tus facturas están en tu "
                  "portal (Negocio > Marketing > Portal): ahí ves solo "
                  "tus facturas, tus citas y tus campañas, nunca las de "
                  "otro cliente."),
        "modulo": "portal",
        "ruta": "/business",
    },
    # F2-2 (corrida 2026-11-24): pasos verificados contra rutas y
    # endpoints reales; nada inventado.
    {
        "id": "usar_estudiar",
        "claves": ("como uso estudiar", "como funciona estudiar",
                   "donde estan los cursos", "donde estan las clases",
                   "como veo los cursos", "que hay en estudiar",
                   "como descargo un manual", "como descargo una guia",
                   "donde estan los manuales"),
        "titulo": "Usar Estudiar",
        "pasos": ("En Estudiar (/estudiar) están los cursos y manuales, "
                  "las clases grabadas y en vivo, los vídeos y las 6 "
                  "herramientas (calculadora de interés compuesto, "
                  "conversor BTC/USD, gráfica, indicadores, BTC y "
                  "calculadora de rentabilidad). La "
                  "guía gratuita se descarga desde su ficha; los cursos "
                  "de pago se compran en su ficha (Hotmart o PayPal)."),
        "modulo": "estudiar",
        "ruta": "/estudiar",
    },
    {
        "id": "usar_correos",
        "claves": ("como creo un correo", "como envio un correo",
                   "como hago un correo", "como uso correos",
                   "como funciona correos", "plantillas de correo",
                   "como creo una plantilla de correo",
                   "donde estan las plantillas"),
        "titulo": "Usar Correos",
        "pasos": ("En Correos (/correos) el administrador crea "
                  "plantillas con asunto y texto y registra cada envío "
                  "en el registro de correos. Solo el administrador "
                  "gestiona plantillas y envíos."),
        "modulo": "correos",
        "ruta": "/correos",
    },
    {
        "id": "usar_crm",
        "claves": ("como agrego un contacto", "como creo un contacto",
                   "como uso el crm", "como funciona el crm",
                   "como veo los clientes", "donde estan los contactos",
                   "como busco un contacto", "gestor de clientes"),
        "titulo": "Usar el Gestor de Clientes (CRM)",
        "pasos": ("En Gestor de Clientes (/crm) ves todos los "
                  "contactos: crea uno nuevo con nombre y datos, "
                  "búscalo por nombre o correo y abre su ficha para "
                  "ver su estado y notas. Solo el administrador crea "
                  "y edita contactos."),
        "modulo": "crm",
        "ruta": "/crm",
    },
    {
        "id": "herramientas_clases",
        "claves": ("como uso la calculadora",
                   "calculadora de interes compuesto",
                   "conversor btc", "conversor bitcoin",
                   "como convierto btc a usd", "grafica btc",
                   "donde esta la calculadora",
                   "herramientas de clases", "como veo los indicadores"),
        "titulo": "Herramientas de Clases",
        "pasos": ("En Estudiar (/estudiar), sección de herramientas: "
                  "calculadora de interés compuesto "
                  "(#herramienta-calculadora), conversor BTC/USD en "
                  "vivo (#herramienta-conversor), gráfica BTC/USD de 1 "
                  "hora (#herramienta-grafica), indicadores "
                  "(#herramienta-indicadores), BTC "
                  "(#herramienta-bitcoin) y calculadora de rentabilidad "
                  "(#herramienta-rentabilidad)."),
        "modulo": "estudiar",
        "ruta": "/estudiar",
    },
]


def _buscar_ayuda(norm: str) -> dict | None:
    """Entrada del catálogo de ayuda cuyo tema aparece en el mensaje,
    o None. Se consulta DESPUÉS de las intenciones de creación y
    ANTES de las de lectura: «¿cómo creo una factura?» es una
    pregunta de ayuda, no un resumen de facturación."""
    for ayuda in AYUDAS:
        if any(clave in norm for clave in ayuda["claves"]):
            return ayuda
    return None


def _h_ayuda_tema(ayuda: dict) -> dict:
    return _respuesta(
        f"{ayuda['titulo']} — {ayuda['pasos']} (Módulo: {ayuda['modulo']}, {ayuda['ruta']}).",
        tipo="ayuda",
        datos={"tema": ayuda["id"], "modulo": ayuda["modulo"], "ruta": ayuda["ruta"]},
        fuente={"nombre": "Catálogo de ayuda", "url": None},
        sugerencias=["¿Qué puedes hacer?", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"],
    )


# ------------------------------------------------- reglas y bandeja (mejora propia) --

# F2-10: caché en memoria de reglas activas (tuplas, no objetos
# ORM: un objeto de otra sesión quedaría detached). Se invalida al
# crear o desactivar una regla; si el admin enseña muchas reglas,
# el chat ya no hace un SELECT + scan en Python por mensaje.
_REGLAS_CACHE: dict = {"rows": None}


def invalidar_cache_reglas() -> None:
    _REGLAS_CACHE["rows"] = None


def _reglas_activas(db: Session) -> list:
    if _REGLAS_CACHE["rows"] is None:
        rows = (
            db.query(ReglaAsistente)
            .filter(ReglaAsistente.activo == True)  # noqa: E712
            .all()
        )
        _REGLAS_CACHE["rows"] = [
            (r.id, _norm(r.patron), r.respuesta, r.modulo, r.ruta)
            for r in rows
        ]
    return _REGLAS_CACHE["rows"]


def _regla_activa(db: Session, norm: str):
    """Regla enseñada activa cuyo patrón (normalizado) aparece en el
    mensaje; ante varias, gana el patrón más largo (el más específico).
    Las reglas las crea solo el admin y se consultan ANTES que las
    intenciones internas (pero DESPUÉS del bloqueo de prohibidos,
    F2-4: una regla enseñada nunca puede reabrir lo prohibido)."""
    mejor = None
    mejor_len = 0
    for rid, patron, respuesta, modulo, ruta in _reglas_activas(db):
        if patron and patron in norm and len(patron) > mejor_len:
            mejor = SimpleNamespace(id=rid, patron=patron, respuesta=respuesta,
                                    modulo=modulo, ruta=ruta)
            mejor_len = len(patron)
    return mejor


# M7 (QA 2026-11-26): tope de preguntas NUEVAS por día en la
# bandeja (200): sin tope, un usuario podía llenarla con preguntas
# distintas sin parar. Tope global por día: la tabla no tiene
# user_id, así que un tope por usuario exigiría un cambio de
# esquema (no se hace en esta corrida). Las repetidas solo
# incrementan `veces` y no crean fila, así que no cuentan.
TOPE_PREGUNTAS_NUEVAS_DIA = 200


def _registrar_pregunta(db: Session, pregunta: str):
    """Registra/incrementa una pregunta sin respuesta en la bandeja.
    Si ya existía resuelta o descartada y vuelve a quedarse sin
    respuesta, vuelve a pendiente (la regla que la cubría ya no está
    activa)."""
    texto = (pregunta or "").strip()[:1000]
    if not texto:
        return None
    ahora = dt.datetime.now(dt.timezone.utc)
    row = (
        db.query(PreguntaSinRespuesta)
        .filter(PreguntaSinRespuesta.pregunta == texto)
        .first()
    )
    if row is None:
        nuevas_hoy = (
            db.query(PreguntaSinRespuesta)
            .filter(func.date(PreguntaSinRespuesta.primera_vez)
                    == _hoy_utc().isoformat())
            .count()
        )
        if nuevas_hoy >= TOPE_PREGUNTAS_NUEVAS_DIA:
            return None
        row = PreguntaSinRespuesta(
            pregunta=texto, veces=1, primera_vez=ahora, ultima_vez=ahora,
            estado="pendiente",
        )
        db.add(row)
    else:
        row.veces = (row.veces or 0) + 1
        row.ultima_vez = ahora
        if row.estado != "pendiente":
            row.estado = "pendiente"
    db.commit()
    return row


# Fase 1 (2026-11-23, mejoras óptimas): las preguntas sin respuesta
# de INVITADO no se guardan en la bandeja de enseñanza (un anónimo
# podría llenarla de spam); solo se cuentan en memoria.
_sin_respuesta_invitado: int = 0


def invitado_sin_respuesta_total() -> int:
    """Contador de preguntas sin respuesta de invitados (para tests)."""
    return _sin_respuesta_invitado


def _registrar_pregunta_para(principal, db: Session, pregunta: str):
    """Bandeja para usuarios; solo conteo para invitados."""
    global _sin_respuesta_invitado
    if isinstance(principal, Guest):
        _sin_respuesta_invitado += 1
        return None
    return _registrar_pregunta(db, pregunta)


def _extraer_despues(mensaje: str, patrones: tuple[str, ...]) -> str:
    """Texto tras la primera orden que coincida (regex insensible a
    mayúsculas, con acentos opcionales en las vocales)."""
    for pat in patrones:
        m = re.search(pat + r"\s*:?\s*(.*)", mensaje, flags=re.IGNORECASE | re.DOTALL)
        if m:
            return (m.group(1) or "").strip()
    return ""


# Verbos imperativos de creación (texto ya normalizado: minúsculas,
# sin acentos). Solo una orden explícita con uno de estos verbos
# puede mutar; una pregunta o consulta NUNCA crea nada (A1, 2026-11-22).
_VERBOS_CREACION = (
    "crea", "crear", "haz", "hacer", "genera", "generar",
    "nuevo", "nueva", "redacta", "escribe", "agenda", "agendar",
    "anota", "anotar",
)

# Marcas de pregunta/consulta (texto normalizado): frases por subcadena
# y palabras con límite de palabra. "lista"/"muestra" van como frase
# ("lista los", "muestra el") y no sueltas: como sustantivo ("lista
# de precios", "muestra de productos") aparecen dentro de órdenes
# legítimas de creación.
_CONSULTA_FRASES = (
    "donde esta", "donde estan", "muestrame", "ensename", "listame",
    "cual es", "cuales son", "como crea", "como se crea",
    "como haces", "como hacen", "lista los", "lista las",
    "lista mis", "muestra el", "muestra la", "muestra los",
    "muestra las",
)
_CONSULTA_PALABRAS = (
    "tienes", "tiene", "hay", "cual", "existe", "existen",
    "busca", "buscar", "encuentra",
)
_RE_CONSULTA = re.compile(r"\b(" + "|".join(_CONSULTA_PALABRAS) + r")\b")


_RE_VERBOS_CREACION = re.compile(
    r"\b(" + "|".join(_VERBOS_CREACION) + r")\b")


def _es_orden_creacion(norm: str) -> bool:
    """True solo si el mensaje es una orden explícita de creación:
    trae un verbo imperativo de creación y NO es una pregunta ni
    una consulta («¿dónde está…?», «¿tienes…?», «muéstrame…»,
    «lista…», «¿cómo crea…?»). Una pregunta cae en listado,
    búsqueda o fallback, nunca en un handler que muta.
    F2-6: los verbos se comprueban por PALABRA (\\b), no por
    subcadena: "crear" dentro de "recrear" o "crea" dentro de
    otra palabra ya no dispara una mutación."""
    if "?" in norm or norm.startswith("¿"):
        return False
    if any(f in norm for f in _CONSULTA_FRASES):
        return False
    if _RE_CONSULTA.search(norm):
        return False
    return bool(_RE_VERBOS_CREACION.search(norm))


# ------------------------------------------------------------------ intenciones --

# C2 (2026-11-26): qué incluye cada plan — matriz acumulativa que
# espeja frontend/components/PlanesPanel.tsx (PLAN_FEATURE_KEYS):
# Esencial trae 4 módulos; Crecimiento suma 4 más; Negocio Total
# suma 6 más. No hay fuente backend de estas inclusiones (PLANES
# solo trae nombre y precio): si el frontend cambia la matriz, hay
# que cambiarla aquí también (misma advertencia que
# HERRAMIENTAS_CLASES, F4-2). Los precios y los días de prueba SÍ
# se leen de suscripciones.py (PLANES, DIAS_PRUEBA), nunca de texto
# hardcodeado.
_PLANES_INCLUYE: dict[str, tuple[str, ...]] = {
    "esencial": ("crm", "facturas", "inventario", "correos"),
    "crecimiento": ("invertir", "estudiar", "crear", "espacio"),
    "negocio_total": ("talento", "riesgos", "planillas", "analisis",
                      "referidos", "ajustador"),
}
_PLANES_CLAVES = ("esencial", "crecimiento", "negocio total")
_PALABRAS_PLAN_PRECIO = ("precio", "cuanto", "cuesta", "vale")


def _es_pregunta_planes(norm: str) -> bool:
    """True si el mensaje pregunta por los planes de suscripción
    (precio, qué incluye, prueba gratis, "mi plan").

    Desambigua "precio del plan" de "precio de BTC": la intención
    `precio` ya no debe capturar preguntas de planes (C2). "plan de
    marketing" o "plan de negocio" NO son preguntas de planes: la
    palabra "plan" sola no basta, hace falta un nombre de plan, una
    palabra de precio/inclusión o "suscripción"."""
    if "suscripci" in norm:
        return True
    # Los tokens se extraen sin puntuación: "¿cuál es mi plan?"
    # deja "plan?" como token y el "plan" exacto no casaba (C2,
    # 2026-11-26: "¿cuál es mi plan?" no llegaba a planes).
    palabras = re.findall(r"[a-z0-9]+", norm)
    menciona_plan = "plan" in palabras or "planes" in palabras
    menciona_nombre = any(c in norm for c in _PLANES_CLAVES)
    if menciona_plan:
        if palabras in (["plan"], ["planes"]):
            return True
        if menciona_nombre:
            return True
        # "¿qué planes hay?" / "¿hay planes?": "que hay" no es
        # contiguo ("que planes hay"), así que se mira el par.
        if "planes" in palabras and "hay" in palabras:
            return True
        return any(p in norm for p in (
            "precio", "cuanto", "cuesta", "vale", "incluye", "inclui",
            "prueba", "gratis", "dias", "que hay", "cuales", "dime",
            "muestra", "lista", "cambiar", "subir", "mi plan",
            "planes hay", "hay planes"))
    if menciona_nombre and any(p in norm for p in _PALABRAS_PLAN_PRECIO):
        return True
    return False


def _h_planes(db: Session, user, norm: str) -> dict:
    """Precios e inclusiones de los planes, leídos de PLANES de
    suscripciones.py ($19/$49/$99, 14 días gratis). Si el mensaje
    nombra un plan, responde solo ese; si no, los tres. "Mi plan"
    añade el plan actual del usuario (de su suscripción o del plan
    elegido al registrarse, misma fuente que el límite diario)."""
    from app.api.suscripciones import DIAS_PRUEBA, PLANES

    if "negocio total" in norm:
        claves = ["negocio_total"]
    elif "esencial" in norm:
        claves = ["esencial"]
    elif "crecimiento" in norm:
        claves = ["crecimiento"]
    else:
        claves = ["esencial", "crecimiento", "negocio_total"]
    datos_planes = []
    lineas = ["Planes de Grow Business Platform (precios en USD, por mes):"]
    acumuladas: list[str] = []
    for clave in ("esencial", "crecimiento", "negocio_total"):
        propias = [MODULOS_RESUMEN[m][0] for m in _PLANES_INCLUYE[clave]]
        if clave not in claves:
            acumuladas.extend(propias)
            continue
        info = PLANES[clave]
        incluye = acumuladas + propias
        if acumuladas:
            linea = (f"- {info['nombre']}: ${info['precio_mensual_usd']}/mes. "
                     f"Incluye todo lo anterior, más: {', '.join(propias)}.")
        else:
            linea = (f"- {info['nombre']}: ${info['precio_mensual_usd']}/mes. "
                     f"Incluye: {', '.join(propias)}.")
        lineas.append(linea)
        datos_planes.append({
            "clave": clave, "nombre": info["nombre"],
            "precio_mensual_usd": info["precio_mensual_usd"],
            "incluye": incluye,
        })
        acumuladas.extend(propias)
    lineas.append(
        f"Todos los planes incluyen {DIAS_PRUEBA} días de prueba gratis. "
        "La prueba y la suscripción las activa el administrador "
        "(todavía no hay cobro en línea). Más detalle en /planes.")
    if "mi plan" in norm:
        clave_actual, limite = _plan_usuario(user, db)
        if limite is None:
            lineas.append("Tu plan actual: Administrador (sin límite diario).")
        else:
            nombre_actual = next(
                (PLANES[c]["nombre"] for c in ("esencial", "crecimiento", "negocio_total")
                 if c == clave_actual or (c == "negocio_total" and clave_actual == "total")),
                NOMBRES_PLAN.get(clave_actual, clave_actual))
            lineas.append(
                f"Tu plan actual: {nombre_actual} "
                f"({limite} mensajes del Asistente al día).")
    return _respuesta(
        "\n".join(lineas),
        tipo="planes",
        datos={"planes": datos_planes, "dias_prueba_gratis": DIAS_PRUEBA},
        fuente={"nombre": "Planes de suscripción", "url": "/planes"},
        sugerencias=["¿Cuánto vale el plan Esencial?", "¿Qué puedes hacer?", "¿Cuánto vale el bitcoin?"],
    )


def _h_precio(db: Session, norm: str) -> dict:
    # F3-2: la edad del caché se mira antes de presentar el precio.
    # B1 (2026-11-26): BTC/ETH/USDT/BNB (antes solo BTC/ETH aunque
    # la caché de mercado trae las 4). Monedas pedidas en el mensaje;
    # sin mención, BTC+ETH (comportamiento anterior). Fuentes, en
    # orden: caché fresca (<=300 s) -> último cierre guardado en
    # velas (BTC/ETH) -> CoinGecko en vivo (C1, solo si la pregunta
    # es de precio explícita: "¿qué es el bitcoin?" es una
    # definición y no merece un viaje a internet) -> caché vieja
    # etiquetada con su antigüedad. Nunca se pega al exchange desde
    # el chat y nunca se inventa un precio.
    pedidas = [m for m in _MONEDAS_PRECIO
               if any(w in norm for w in m[2])]
    if not pedidas:
        pedidas = list(_MONEDAS_PRECIO[:2])
    simbolos = [m[0] for m in pedidas]
    precios: dict[str, tuple[float, str, str]] = {}
    datos: dict = {"btc_usd": None, "eth_usd": None, "usdt_usd": None,
                   "bnb_usd": None, "disponible": False, "fuente": "sin_datos"}
    cached = (market_api._PRICES_CACHE or {}).get("payload")
    edad_s = None
    actualizado_en = None
    if cached and cached.get("prices"):
        edad_s = time.monotonic() - float((market_api._PRICES_CACHE or {}).get("at") or 0.0)
        actualizado_en = cached.get("updated_utc")
        if edad_s <= 300:
            for coin in cached["prices"]:
                sym = coin.get("symbol")
                if sym in simbolos and coin.get("price_usd") is not None:
                    precios[sym] = (float(coin["price_usd"]), "cache_mercado",
                                    f"actualizada hace {int(edad_s)} s")
    if any(s not in precios for s in simbolos):
        # Sin caché fresca: último cierre guardado en velas (datos
        # reales de la plataforma) con la fecha de la vela. Solo
        # BTC/USD y ETH/USD tienen velas guardadas.
        for symbol, key in (("BTC/USD", "BTC"), ("ETH/USD", "ETH")):
            if key in simbolos and key not in precios:
                velas = ingest.latest_candles(db, symbol, "1h", 1)
                if velas:
                    precios[key] = (float(velas[-1].close), "velas_guardadas",
                                    _iso(velas[-1].open_time_utc) or "sin fecha")
    faltan = [s for s in simbolos if s not in precios]
    coingecko_intentado = False
    if faltan and any(p in norm for p in _PALABRAS_PRECIO_EXPLICITO):
        # C1: CoinGecko en vivo como respaldo, sin llave. La llamada
        # es corta (4 s) y nunca tumba el chat (devuelve None).
        coingecko_intentado = True
        try:
            vivos = precio_coingecko(faltan)
        except Exception:
            vivos = None
        if vivos:
            hora = dt.datetime.now(TZ_LA).strftime("%H:%M")
            for sym, valor in vivos.items():
                if sym in faltan:
                    precios[sym] = (valor, "coingecko", hora)
    if not precios:
        if cached and cached.get("prices") and edad_s is not None:
            # Último recurso: el precio viejo, etiquetado como viejo.
            for coin in cached["prices"]:
                sym = coin.get("symbol")
                if sym in simbolos and coin.get("price_usd") is not None:
                    precios[sym] = (float(coin["price_usd"]), "cache_mercado_vieja",
                                    f"{int(edad_s // 60)} min")
            if precios:
                for sym, (valor, _f, _d) in precios.items():
                    datos[_MONEDA_A_CLAVE[sym]] = valor
                datos["fuente"] = "cache_mercado_vieja"
                datos["cache_edad_s"] = round(edad_s)
                datos["actualizado_en"] = actualizado_en
                datos["disponible"] = True
                minutos = int(edad_s // 60)
                lineas = [f"- {_MONEDA_A_ETIQUETA[s]}: {_money(v)}"
                          for s, (v, _f, _d) in precios.items()]
                return _respuesta(
                    "Este precio NO es actual: la caché de mercado tiene "
                    f"{minutos} minuto(s) de antigüedad "
                    f"(actualizada: {actualizado_en or 'sin fecha'}) y no "
                    "hay velas guardadas más recientes.\n" + "\n".join(lineas),
                    tipo="precio_btc", datos=datos,
                    fuente={"nombre": "Caché de mercado (desactualizada)", "url": None},
                    sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
                )
        pedido_txt = ", ".join(simbolos)
        extra = (" Ni CoinGecko respondió."
                 if coingecko_intentado else "")
        return _respuesta(
            f"Ahora mismo no tengo un precio real disponible para "
            f"{pedido_txt}: no hay caché de mercado ni velas guardadas."
            f"{extra} Pídele al administrador que active el escáner "
            "de mercado y vuelve a preguntarme. No voy a inventar un precio.",
            tipo="precio_btc", datos=datos,
            fuente={"nombre": "Caché de mercado", "url": None},
        )
    for sym, (valor, _f, _d) in precios.items():
        datos[_MONEDA_A_CLAVE[sym]] = valor
    datos["disponible"] = True
    fuentes = {f for _v, f, _d in precios.values()}
    if len(fuentes) == 1:
        fuente_unica = next(iter(fuentes))
        datos["fuente"] = fuente_unica
        if fuente_unica == "cache_mercado":
            detalle = next(d for _v, _f, d in precios.values())
            encabezado = (f"Precios reales de la plataforma (caché de "
                          f"mercado, {detalle}):")
            fuente_nombre = "Caché de mercado"
        elif fuente_unica == "velas_guardadas":
            fecha = next(d for _v, _f, d in precios.values())
            encabezado = ("Precios reales de la plataforma (última vela "
                          f"guardada, no precio en vivo; vela del {fecha}):")
            fuente_nombre = "Velas guardadas"
        else:  # coingecko
            hora = next(d for _v, _f, d in precios.values())
            encabezado = (f"Precios en vivo (CoinGecko, consultado {hora} "
                          "hora de Los Ángeles):")
            fuente_nombre = "CoinGecko (precio en vivo)"
        lineas = [f"- {_MONEDA_A_ETIQUETA[s]}: {_money(v)}"
                  for s, (v, _f, _d) in precios.items()]
    else:
        datos["fuente"] = "mixta"
        encabezado = "Precios (fuentes mezcladas):"
        fuente_nombre = "Varias fuentes"
        lineas = []
        for s, (v, f, d) in precios.items():
            nota = {"cache_mercado": f"caché, {d}",
                    "velas_guardadas": f"vela del {d}",
                    "coingecko": f"CoinGecko {d}"}.get(f, f)
            lineas.append(f"- {_MONEDA_A_ETIQUETA[s]}: {_money(v)} ({nota})")
    # D2 (QA 2026-11-26): con caché fresca la mini-tarjeta necesita
    # la edad real del precio; antes actualizado_en y cache_edad_s
    # solo existían como variables locales (la rama de caché vieja
    # ya los ponía en datos). Solo cuando la caché aportó precio.
    if "cache_mercado" in fuentes and edad_s is not None:
        datos["actualizado_en"] = actualizado_en
        datos["cache_edad_s"] = round(edad_s)
    faltan_txt = [s for s in simbolos if s not in precios]
    if faltan_txt:
        lineas.append(
            "Sin dato para " + ", ".join(faltan_txt) +
            ": no hay caché, ni velas, ni respuesta de CoinGecko.")
    return _respuesta(
        encabezado + "\n" + "\n".join(lineas),
        tipo="precio_btc", datos=datos,
        fuente={"nombre": fuente_nombre, "url": None},
        sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
    )


# B1: monedas con precio en el chat (símbolo, etiqueta, palabras
# que la piden, par de velas/clave de datos).
_MONEDAS_PRECIO: tuple[tuple[str, str, tuple[str, ...], tuple[str | None, str]], ...] = (
    ("BTC", "Bitcoin (BTC)", ("btc", "bitcoin"), ("BTC/USD", "btc_usd")),
    ("ETH", "Ethereum (ETH)", ("eth", "ethereum"), ("ETH/USD", "eth_usd")),
    ("USDT", "Tether (USDT)", ("usdt", "tether"), (None, "usdt_usd")),
    ("BNB", "BNB (BNB)", ("bnb",), (None, "bnb_usd")),
)
_MONEDA_A_CLAVE = {m[0]: m[3][1] for m in _MONEDAS_PRECIO}
_MONEDA_A_ETIQUETA = {m[0]: m[1] for m in _MONEDAS_PRECIO}
# Solo una pregunta de precio explícita merece el viaje a CoinGecko
# (C1): "¿qué es el bitcoin?" es una definición y se responde con
# los datos locales o con "no tengo precio".
_PALABRAS_PRECIO_EXPLICITO = ("precio", "cuanto vale", "cotizacion",
                              "cuanto cuesta", "a cuanto esta")


def _h_senales(db: Session) -> dict:
    rows = db.query(Signal).order_by(Signal.created_at.desc()).limit(5).all()
    if not rows:
        return _respuesta(
            "No hay señales registradas en la plataforma.",
            tipo="senales", datos={"senales": []},
            fuente={"nombre": "Tabla de señales", "url": None},
        )
    lineas = []
    datos = []
    for s in rows:
        lineas.append(f"- {s.symbol} — {str(s.side).upper()}: {s.reason or ''} (estado: {s.status})")
        datos.append({"id": s.id, "symbol": s.symbol, "side": s.side,
                      "reason": s.reason, "status": s.status})
    return _respuesta(
        "Últimas señales (demo/simuladas, no señales reales de mercado):\n"
        + "\n".join(lineas)
        + "\nSon señales demo/simuladas registradas en la plataforma, "
          "no señales reales de mercado ni consejo de inversión.",
        tipo="senales", datos={"senales": datos},
        fuente={"nombre": "Tabla de señales", "url": None},
        sugerencias=["Analiza el mercado", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"],
    )


# F2-10/F3-6: el resumen del último backtest se cachea hasta que
# cambia el fichero (mtime): antes se hacía os.listdir + json.load
# en CADA pregunta de análisis (y en cada /api/ai/ask).
_BACKTEST_CACHE: dict = {"mtime": None, "path": None, "result": None}


def _ultimo_backtest() -> dict | None:
    """Titular real del último backtest guardado en disco, o None.

    Incluye la fecha del run (del run_id, YYYYMMDDHHMMSS, o del
    mtime del fichero): un backtest sin fecha no dice de cuándo es.
    """
    try:
        if not os.path.isdir(RUNS_DIR):
            return None
        files = sorted(f for f in os.listdir(RUNS_DIR) if f.endswith(".json"))
        if not files:
            return None
        path = os.path.join(RUNS_DIR, files[-1])
        mtime = os.path.getmtime(path)
        if _BACKTEST_CACHE["mtime"] == mtime and _BACKTEST_CACHE["path"] == path:
            return _BACKTEST_CACHE["result"]
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        metrics = payload.get("metrics") or {}
        fecha = None
        m = re.search(r"(\d{14})$", str(payload.get("run_id") or ""))
        if m:
            try:
                fecha = dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(
                    tzinfo=dt.timezone.utc).isoformat()
            except ValueError:
                fecha = None
        if fecha is None:
            fecha = dt.datetime.fromtimestamp(mtime, tz=dt.timezone.utc).isoformat()
        result = {
            "run_id": payload.get("run_id"),
            "symbol": payload.get("symbol"),
            "timeframe": payload.get("timeframe"),
            "n_candles": payload.get("n_candles"),
            "net_return_pct": metrics.get("net_return_pct"),
            "fecha": fecha,
        }
        _BACKTEST_CACHE.update({"mtime": mtime, "path": path, "result": result})
        return result
    except Exception:
        return None


def _h_analisis(db: Session) -> dict:
    velas = ingest.latest_candles(db, "BTC/USD", "1h", 200)
    senales = db.query(Signal).order_by(Signal.created_at.desc()).limit(3).all()
    partes: list[str] = []
    datos: dict = {"symbol": "BTC/USD", "n_candles": len(velas),
                   "rsi_14": None, "macd": None, "last_close": None,
                   "senales": [{"symbol": s.symbol, "side": s.side, "status": s.status}
                               for s in senales],
                   "backtest": _ultimo_backtest()}
    if len(velas) >= 35:
        closes = [float(c.close) for c in velas]
        volumes = [float(c.volume) for c in velas]
        resumen = ind.summarize(closes, volumes)
        datos["rsi_14"] = resumen.get("rsi_14")
        datos["macd"] = resumen.get("macd")
        datos["last_close"] = resumen.get("last_close")
        rsi = resumen.get("rsi_14")
        macd = resumen.get("macd") or {}
        partes.append(
            "Análisis de BTC/USD (1h, datos reales de la plataforma, "
            f"{len(velas)} velas; último cierre {_money(resumen.get('last_close'))}):\n"
            f"- RSI (14): {rsi if rsi is None else round(rsi, 1)}"
            + (" (sobrecompra)" if isinstance(rsi, (int, float)) and rsi >= 70
               else " (sobreventa)" if isinstance(rsi, (int, float)) and rsi <= 30
               else " (zona neutra)" if isinstance(rsi, (int, float)) else "")
            + "\n"
            f"- MACD: línea {macd.get('macd_line') if macd.get('macd_line') is None else round(macd['macd_line'], 2)}, "
            f"señal {macd.get('signal_line') if macd.get('signal_line') is None else round(macd['signal_line'], 2)}, "
            f"histograma {macd.get('histogram') if macd.get('histogram') is None else round(macd['histogram'], 2)}."
        )
    else:
        partes.append(
            f"No hay suficientes velas guardadas para calcular indicadores "
            f"({len(velas)}/35 necesarias). Pídele al administrador que "
            f"active el escáner de mercado. No voy a inventar cifras."
        )
    if senales:
        partes.append("Últimas señales: " + "; ".join(
            f"{s.symbol} {str(s.side).upper()} ({s.status})" for s in senales) + ".")
    else:
        partes.append("No hay señales registradas.")
    # F3-6: el análisis lleva la fecha de la última vela (los
    # indicadores son de ese momento, no de "ahora") y la fecha del
    # backtest. Las etiquetas de simulación quedan intactas.
    if velas:
        datos["ultima_vela_en"] = _iso(velas[-1].open_time_utc)
        partes.append(f"Última vela: {datos['ultima_vela_en']}.")
    backtest = datos["backtest"]
    if backtest:
        partes.append(
            f"Último backtest ({backtest.get('run_id')}, "
            f"{backtest.get('fecha') or 'sin fecha'}): "
            f"{backtest.get('symbol')} {backtest.get('timeframe')}, "
            f"{backtest.get('n_candles')} velas, "
            f"rendimiento neto {backtest.get('net_return_pct')}%."
        )
    else:
        partes.append("No hay ningún backtest guardado todavía.")
    partes.append("Esto es un resumen de datos reales en modo simulación, no es consejo de inversión.")
    return _respuesta("\n".join(partes), tipo="analisis", datos=datos,
                       fuente={"nombre": "Velas guardadas + backtest", "url": None},
                       sugerencias=["¿Cuánto vale el bitcoin?", "Muéstrame las últimas señales", "¿Qué hay nuevo?"])


def _h_crear_nota(db: Session, user: User, mensaje: str) -> dict:
    if not user.is_admin:
        return _solo_lectura(user)
    texto = _extraer_despues(mensaje, (r"crea una nota", r"crear una nota", r"nueva nota", r"anota"))
    if not texto:
        return _respuesta(
            "¿Qué quieres que anote? Escríbelo así: «Crea una nota: revisar precios de proveedor».",
            sugerencias=["Crea una nota: revisar precios de proveedor", "¿Qué puedes hacer?"],
        )
    titulo = texto.split("\n")[0][:60].strip() or texto[:60]
    nota = BusinessNote(area="marketing", title=titulo, body=texto)
    db.add(nota)
    db.commit()
    db.refresh(nota)
    # B2: auditoría de la mutación (sin el contenido del usuario).
    audit(db, user, "asistente.crear_nota", "business_note", str(nota.id),
          details={"area": "marketing"})
    return _respuesta(
        f"Nota creada en Negocio > Marketing (id {nota.id}): «{nota.title}».",
        tipo="crear_nota", datos={"id": nota.id, "title": nota.title, "area": "marketing"},
        sugerencias=["Crea una tarea: llamar a un cliente", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_crear_tarea(db: Session, user: User, mensaje: str) -> dict:
    if not user.is_admin:
        return _solo_lectura(user)
    texto = _extraer_despues(mensaje, (r"crea una tarea", r"crear una tarea", r"nueva tarea", r"pendiente"))
    if not texto:
        return _respuesta(
            "¿Qué tarea creo? Escríbelo así: «Crea una tarea: llamar a TJ's».",
            sugerencias=["Crea una tarea: llamar a un cliente", "¿Qué puedes hacer?"],
        )
    titulo = texto.split("\n")[0][:256].strip()
    tarea = BusinessTask(area="marketing", title=titulo, done=False)
    db.add(tarea)
    db.commit()
    db.refresh(tarea)
    # B2: auditoría de la mutación (sin el contenido del usuario).
    audit(db, user, "asistente.crear_tarea", "business_task", str(tarea.id),
          details={"area": "marketing"})
    return _respuesta(
        f"Tarea creada en Negocio > Marketing (id {tarea.id}): «{tarea.title}».",
        tipo="crear_tarea", datos={"id": tarea.id, "title": tarea.title, "area": "marketing"},
        sugerencias=["Crea una nota: revisar precios", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_crear_borrador(db: Session, user: User, mensaje: str) -> dict:
    if not user.is_admin:
        return _solo_lectura(user)
    # Patrones anclados a un verbo de creación: el "borrador" suelto
    # ya no extrae tema (A1). Si no hay verbo, tema queda vacío y se
    # pregunta el tema en vez de crear nada.
    # A-3: "crea un borrador de campaña sobre X" reutiliza este
    # handler (el borrador es de contenido, no una MarketingCampaign):
    # los patrones con "de campana" van ANTES que los genéricos para
    # que el tema sea X y no "de campaña sobre X".
    tema = _extraer_despues(
        mensaje,
        (r"crea un borrador de campa[nñ]a",
         r"crear un borrador de campa[nñ]a",
         r"haz un borrador de campa[nñ]a",
         r"hacer un borrador de campa[nñ]a",
         r"genera un borrador de campa[nñ]a",
         r"generar un borrador de campa[nñ]a",
         r"crea un borrador", r"crear un borrador", r"haz un borrador",
         r"hacer un borrador", r"genera un borrador", r"generar un borrador",
         r"redacta un borrador", r"escribe un borrador", r"nuevo borrador",
         r"crea una publicaci[oó]n", r"crear una publicaci[oó]n",
         r"nueva publicaci[oó]n", r"crea un post", r"crear un post",
         r"nuevo post", r"crea contenido", r"crear contenido",
         r"genera contenido", r"generar contenido"),
    )
    # "borrador sobre X" / "borrador de X": quita la preposición inicial.
    tema = re.sub(r"^(sobre|de|para)\s+", "", tema, flags=re.IGNORECASE).strip()
    if not tema:
        return _respuesta(
            "¿Sobre qué tema creo el borrador? Escríbelo así: «Crea un borrador sobre el nuevo curso».",
            sugerencias=["Crea un borrador sobre el nuevo curso", "¿Qué puedes hacer?"],
        )
    # F3-7: plataforma y fecha se toman del mensaje cuando se
    # mencionan; si no, se usan los defaults (Instagram, mañana) y
    # la confirmación LO DICE explícitamente, no lo esconde.
    norm_b = _norm(mensaje)
    plataforma = "instagram"
    plataforma_mencionada = False
    for cand in ("tiktok", "facebook", "youtube", "linkedin", "threads", "instagram"):
        if re.search(r"\b" + cand + r"\b", norm_b):
            plataforma, plataforma_mencionada = cand, True
            break
    ahora = dt.datetime.now(dt.timezone.utc)
    dias = 1
    fecha_mencionada = False
    if "pasado manana" in norm_b:
        dias, fecha_mencionada = 2, True
    elif "manana" in norm_b:
        dias, fecha_mencionada = 1, True
    elif "hoy" in norm_b:
        dias, fecha_mencionada = 0, True
    else:
        m_fecha = re.search(r"(\d{4})-(\d{2})-(\d{2})", norm_b)
        if m_fecha:
            try:
                f = dt.date(int(m_fecha.group(1)), int(m_fecha.group(2)), int(m_fecha.group(3)))
                dias = (f - ahora.date()).days
                fecha_mencionada = dias >= 0
                if not fecha_mencionada:
                    dias = 1
            except ValueError:
                pass
    titulo = tema[:200]
    item = ContentItem(
        title=titulo,
        text=f"{tema}\n\n[Plantilla (reglas), no IA — borrador creado por el Asistente. Revisa y edita antes de programar.]",
        scheduled_at=ahora + dt.timedelta(days=dias),
        platform=plataforma,
        status="borrador",
        notes="source: plantilla",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # B2: auditoría de la mutación (sin el contenido del usuario).
    audit(db, user, "asistente.crear_borrador", "content_item", str(item.id),
          details={"source": "plantilla", "status": "borrador"})
    if plataforma_mencionada and fecha_mencionada:
        cuando = f"para {plataforma} el {item.scheduled_at.date().isoformat()}"
    elif plataforma_mencionada:
        cuando = (f"para {plataforma} mañana (fecha por defecto: no "
                  "mencionaste fecha)")
    elif fecha_mencionada:
        cuando = (f"para el {item.scheduled_at.date().isoformat()} en "
                  "Instagram (plataforma por defecto: no mencionaste plataforma)")
    else:
        cuando = ("para mañana en Instagram (defaults: no mencionaste "
                  "ni plataforma ni fecha)")
    return _respuesta(
        f"Borrador creado en el Content Engine (id {item.id}): «{item.title}», {cuando}. "
        "Es una plantilla por reglas, no IA: revísalo antes de programarlo.",
        tipo="crear_borrador",
        datos={"id": item.id, "title": item.title, "source": "plantilla",
               "status": "borrador", "platform": plataforma,
               "scheduled_at": _iso(item.scheduled_at)},
        fuente={"nombre": "Content Engine", "url": None},
        sugerencias=["¿Qué citas tengo?", "Muéstrame los contactos", "¿Qué hay nuevo?"],
    )


def _h_listar_citas(db: Session, user: User) -> dict:
    # M1 (resuelto 2026-11-23): prueba no ve citas reales por chat.
    if not user.is_admin:
        return _no_disponible_demo(user)
    ahora = dt.datetime.now(dt.timezone.utc)
    rows = (
        db.query(Appointment)
        .filter(Appointment.status != "cancelada", Appointment.starts_at >= ahora)
        .order_by(Appointment.starts_at.asc()).limit(5).all()
    )
    if not rows:
        return _respuesta(
            "No hay citas próximas registradas.",
            tipo="listar_citas", datos={"citas": []},
        )
    datos = []
    lineas = []
    for a in rows:
        inicio = _iso(a.starts_at) or ""
        datos.append({"id": a.id, "client_name": a.client_name, "service_type": a.service_type,
                      "starts_at": inicio, "duration_min": a.duration_min, "status": a.status})
        lineas.append(f"- {a.client_name or 'Sin cliente'} — {a.service_type}, {inicio} ({a.duration_min} min, {a.status})")
    return _respuesta("Próximas citas:\n" + "\n".join(lineas),
                       tipo="listar_citas", datos={"citas": datos},
                       fuente={"nombre": "Citas (base de datos)", "url": None},
                       sugerencias=["Crea una cita para un cliente mañana a las 10:00", "Muéstrame los contactos", "¿Qué hay nuevo?"])


def _fmt_local_hora(value: dt.datetime) -> str:
    """Fecha/hora en America/Los_Angeles para las confirmaciones."""
    return value.astimezone(TZ_LA).strftime("%d/%m/%Y %H:%M") + " (hora de Los Ángeles)"


def _parse_cita(mensaje_norm: str) -> tuple[dt.datetime | None, str, str, dict | None]:
    """Fecha/hora, cliente, servicio y aclaración de «crea una cita
    para X mañana a las 10:00».

    F2-5: la hora se interpreta en America/Los_Angeles (zona del
    usuario) y se guarda en UTC; la confirmación muestra la hora
    local. Dos ambigüedades NO se asumen y devuelven `aclaracion`:
    - fecha D/M con ambos números <=12 ("5/6": ¿5 de junio o 6 de
      mayo?); si un número es >12, el día es inequívoco (D/M).
    - hora suelta sin minutos ni AM/PM ("a las 10": ¿10:00 de la
      mañana o de la noche?). "10:00" con minutos se lee como las
      10:00 de la mañana (comportamiento anterior, cubierto por tests).
    Sin fecha/hora explícita devuelve None para pedirla (nunca se
    inventa un horario)."""
    ahora_la = dt.datetime.now(TZ_LA)
    ahora = ahora_la.astimezone(dt.timezone.utc)
    fecha: dt.date | None = None
    aclaracion = None
    if "pasado manana" in mensaje_norm:
        fecha = (ahora_la + dt.timedelta(days=2)).date()
    elif "manana" in mensaje_norm:
        fecha = (ahora_la + dt.timedelta(days=1)).date()
    elif "hoy" in mensaje_norm:
        fecha = ahora_la.date()
    else:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", mensaje_norm)
        if m:
            try:
                fecha = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                fecha = None
        else:
            m = re.search(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", mensaje_norm)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                anio = int(m.group(3) or ahora_la.year)
                if a <= 12 and b <= 12 and a != b:
                    meses = ["enero", "febrero", "marzo", "abril", "mayo",
                             "junio", "julio", "agosto", "septiembre",
                             "octubre", "noviembre", "diciembre"]
                    aclaracion = {
                        "pregunta": (f"La fecha {a}/{b} es ambigua: "
                                     f"¿{a} de {meses[b - 1]} o {b} de {meses[a - 1]}?"),
                        "opciones": [f"{a} de {meses[b - 1]}", f"{b} de {meses[a - 1]}"],
                    }
                    return None, "", "consulta", aclaracion
                try:
                    fecha = dt.date(anio, b, a)
                except ValueError:
                    fecha = None
    hora: tuple[int, int] | None = None
    m = re.search(r"(\d{1,2}):(\d{2})", mensaje_norm)
    if m:
        hora = (int(m.group(1)), int(m.group(2)))
        if re.search(r"\b" + str(hora[0]) + r":\d{2}\s*pm\b", mensaje_norm) and hora[0] < 12:
            hora = (hora[0] + 12, hora[1])
    else:
        m = re.search(r"a las (\d{1,2})\s*(am|pm)?\b", mensaje_norm)
        if m:
            h = int(m.group(1))
            marca = m.group(2)
            if marca == "pm" and h < 12:
                hora = (h + 12, 0)
            elif marca == "am":
                hora = (h % 12, 0)
            else:
                aclaracion = {
                    "pregunta": f"¿La cita es a las {h}:00 de la mañana o de la noche?",
                    "opciones": [f"{h}:00 de la mañana", f"{h}:00 de la noche"],
                }
                return None, "", "consulta", aclaracion
    cliente = ""
    m = re.search(r"para\s+([a-z0-9\- ]+?)(?:\s+(?:manana|pasado manana|hoy|el|a las|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2})|$)", mensaje_norm)
    if m:
        cliente = m.group(1).strip().strip(",")
    starts_at = None
    if fecha is not None and hora is not None:
        try:
            local = dt.datetime.combine(fecha, dt.time(hora[0], hora[1]), tzinfo=TZ_LA)
            starts_at = local.astimezone(dt.timezone.utc)
        except ValueError:
            starts_at = None
    return starts_at, cliente, "consulta", aclaracion


def _h_crear_cita(db: Session, user: User, mensaje: str, norm: str) -> dict:
    if not user.is_admin:
        return _solo_lectura(user)
    starts_at, cliente, servicio, aclaracion = _parse_cita(norm)
    if aclaracion is not None:
        return _respuesta(
            "Antes de crear la cita necesito que me confirmes un dato.",
            aclaracion=aclaracion,
            sugerencias=["Crea una cita para un cliente mañana a las 10:00", "¿Qué citas tengo?"],
        )
    if starts_at is None:
        return _respuesta(
            "Para crear la cita necesito fecha y hora. Escríbelo así: "
            "«Crea una cita para María mañana a las 10:00».",
            sugerencias=["Crea una cita para un cliente mañana a las 10:00", "¿Qué citas tengo?"],
        )
    if starts_at <= dt.datetime.now(dt.timezone.utc):
        return _respuesta(
            "Esa fecha y hora ya pasó: dime una fecha futura para la cita.",
            sugerencias=["Crea una cita para un cliente mañana a las 10:00", "¿Qué citas tengo?"],
        )
    contact = None
    if cliente:
        # B5: escapar wildcards LIKE (mismo escapado que crm.py:110-116):
        # un % o _ del usuario no debe actuar como comodín.
        raw = cliente.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        contact = db.query(Contact).filter(
            Contact.name.ilike(f"%{raw}%", escape="\\")
        ).first()
    contact_id = contact.id if contact else None
    client_name = contact.name if contact else cliente
    if not client_name:
        return _respuesta(
            "¿Para qué cliente es la cita? Escríbelo así: "
            "«Crea una cita para María mañana a las 10:00».",
            sugerencias=["Muéstrame los contactos", "¿Qué citas tengo?"],
        )
    if contact_id is not None and _overlaps(db, contact_id, starts_at, 60):
        return _respuesta(
            f"No creé la cita: {client_name} ya tiene una cita que se "
            f"solapa con {_fmt_local_hora(starts_at)} (60 min). Elige otro horario.",
            tipo="crear_cita",
            datos={"conflicto": True, "contact_id": contact_id,
                   "starts_at": starts_at.isoformat(), "solape_comprobado": True},
            sugerencias=["¿Qué citas tengo?", "Crea una cita para un cliente mañana a las 11:00"],
        )
    appt = Appointment(
        contact_id=contact_id, client_name=client_name, service_type=servicio,
        starts_at=starts_at, duration_min=60, status="pendiente",
        notes="Creada por el Asistente.", created_by_user_id=user.id,
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    # B2: auditoría de la mutación (sin el contenido del usuario).
    audit(db, user, "asistente.crear_cita", "appointment", str(appt.id),
          details={"contact_id": contact_id})
    # F2-5 / M2: la confirmación muestra la hora local y, si el
    # cliente NO está en el CRM, dice explícitamente que NO se
    # comprobó el solape (el chequeo solo existe con contacto; la
    # decisión M2 sigue pendiente y no se cambia aquí).
    if contact_id is None:
        nota_solape = (" No se comprobó si se solapa con otra cita "
                       "porque el cliente no está en el CRM.")
    else:
        nota_solape = " Se comprobó que no se solapa con sus otras citas."
    return _respuesta(
        f"Cita creada (id {appt.id}): {client_name} — {servicio}, "
        f"{_fmt_local_hora(starts_at)} (60 min, pendiente).{nota_solape}",
        tipo="crear_cita",
        datos={"id": appt.id, "client_name": client_name, "service_type": servicio,
               "starts_at": starts_at.isoformat(), "duration_min": 60, "status": "pendiente",
               "solape_comprobado": contact_id is not None},
        sugerencias=["¿Qué citas tengo?", "Muéstrame los contactos", "¿Qué hay nuevo?"],
    )


def _h_facturas(db: Session, user: User) -> dict:
    # M1 (resuelto 2026-11-23): prueba no ve facturas reales por chat.
    if not user.is_admin:
        return _no_disponible_demo(user)
    # F2-10: los conteos por estado se agregan en SQL (GROUP BY);
    # los importes siguen sumándose en Python porque el total vive en
    # el JSON `items` (una suma SQL portable de JSON no es simple:
    # SQLite/Postgres difieren). F3-8: ventas = solo PAGADAS.
    por_estado = {"borrador": 0, "enviada": 0, "pagada": 0}
    for estado, n in db.query(Invoice.status, func.count()).group_by(Invoice.status).all():
        if estado in por_estado:
            por_estado[estado] = n
    total_pagado = Decimal("0")
    total_enviado = Decimal("0")
    for inv in db.query(Invoice).filter(Invoice.status.in_(("pagada", "enviada"))).all():
        if inv.status == "pagada":
            total_pagado += _invoice_total(inv)
        elif inv.status == "enviada":
            total_enviado += _invoice_total(inv)
    return _respuesta(
        "Resumen de facturación (ventas = solo facturas PAGADAS):\n"
        f"- Ventas pagadas: {_money(total_pagado)} en {por_estado['pagada']} factura(s).\n"
        f"- Enviadas (aún no son ventas): {_money(total_enviado)} en {por_estado['enviada']} factura(s).\n"
        f"- Borradores: {por_estado['borrador']} factura(s).",
        tipo="facturas",
        datos={"total_pagado": float(total_pagado), "n_pagadas": por_estado["pagada"],
               "total_enviado": float(total_enviado), "n_enviadas": por_estado["enviada"],
               "n_borrador": por_estado["borrador"]},
        fuente={"nombre": "Facturas (base de datos)", "url": None},
        sugerencias=["Muéstrame los contactos", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_contactos(db: Session, user: User) -> dict:
    # M1 (resuelto 2026-11-23): prueba no ve contactos reales por chat.
    if not user.is_admin:
        return _no_disponible_demo(user)
    rows = db.query(Contact).order_by(Contact.id.desc()).limit(10).all()
    if not rows:
        return _respuesta("No hay contactos registrados en el CRM.",
                           tipo="contactos", datos={"contactos": []},
                           fuente={"nombre": "CRM (base de datos)", "url": None})
    datos = [{"id": c.id, "name": c.name, "status": c.status, "email": c.email or ""}
             for c in rows]
    lineas = [f"- {c.name} ({c.status})" + (f" — {c.email}" if c.email else "") for c in rows]
    return _respuesta(
        f"Contactos del CRM ({len(rows)} mostrados):\n" + "\n".join(lineas),
        tipo="contactos", datos={"contactos": datos},
        fuente={"nombre": "CRM (base de datos)", "url": None},
        sugerencias=["¿Cuánto hemos vendido?", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_campanas(db: Session, user: User, norm: str) -> dict:
    # A-3 (2026-11-26): campañas de SOLO LECTURA (listar/estado).
    # M1 (resuelto 2026-11-23): prueba no ve datos reales de
    # marketing por chat. Activar/pausar/finalizar NO se hace desde
    # el chat: es lectura y, para cambios, el módulo Tendencias.
    if not user.is_admin:
        return _no_disponible_demo(user)
    if re.search(r"\b(activa|pausa|finaliza|lanza|desactiva)\b", norm) and "campana" in norm:
        return _respuesta(
            "Desde el chat solo puedo listar campañas y crear borradores; "
            "para activar, pausar o finalizar una campaña ve a Tendencias "
            "> Campañas (/tendencias).",
            tipo="campanas", datos={"campanas": []},
            fuente={"nombre": "Campañas de marketing", "url": "/tendencias"},
            sugerencias=["¿Qué campañas hay?", "Crea un borrador sobre el nuevo curso", "¿Qué puedes hacer?"],
        )
    estado = next((e for e in ("borrador", "activa", "pausada", "finalizada")
                   if re.search(r"\b" + e + r"\b", norm)), None)
    # Estado de una campaña concreta: "¿cómo está la campaña X?"
    if "estado" in norm or "como esta" in norm:
        candidatas = (db.query(MarketingCampaign)
                      .order_by(MarketingCampaign.id.desc()).limit(20).all())
        for c in candidatas:
            if len(_norm(c.name)) >= 4 and _norm(c.name) in norm:
                return _respuesta(
                    f"Campaña «{c.name}» ({c.channel}): estado {c.status}."
                    + (f" Presupuesto: {_money(c.budget)}." if c.budget is not None else "")
                    + (f" Gastado: {_money(c.spend)}." if c.spend else "")
                    + (f" Del {c.starts_on.isoformat() if c.starts_on else ''} al {c.ends_on.isoformat() if c.ends_on else ''}."
                       if c.starts_on or c.ends_on else "")
                    + (f" Notas: {_extracto(c.notes)}" if c.notes else ""),
                    tipo="campanas",
                    datos={"campana": {"id": c.id, "name": c.name, "channel": c.channel,
                                       "status": c.status,
                                       "budget": float(c.budget) if c.budget is not None else None,
                                       "spend": float(c.spend),
                                       "starts_on": c.starts_on.isoformat() if c.starts_on else None,
                                       "ends_on": c.ends_on.isoformat() if c.ends_on else None}},
                    fuente={"nombre": "Campañas de marketing", "url": "/tendencias"},
                    sugerencias=["¿Qué campañas hay?", "Crea un borrador sobre el nuevo curso", "¿Qué puedes hacer?"],
                )
        # "estado" sin nombre que case: se lista y se dice.
    q = db.query(MarketingCampaign)
    if estado:
        q = q.filter(MarketingCampaign.status == estado)
    rows = q.order_by(MarketingCampaign.id.desc()).limit(10).all()
    if not rows:
        texto = ("No hay campañas registradas"
                 + (f" en estado {estado}" if estado else "") + ".")
        return _respuesta(texto, tipo="campanas", datos={"campanas": []},
                           fuente={"nombre": "Campañas de marketing", "url": "/tendencias"})
    datos = [{"id": c.id, "name": c.name, "channel": c.channel, "status": c.status,
              "budget": float(c.budget) if c.budget is not None else None,
              "spend": float(c.spend)} for c in rows]
    lineas = [f"- {c.name} ({c.channel}, {c.status})"
              + (f" — presupuesto {_money(c.budget)}" if c.budget is not None else "")
              for c in rows]
    return _respuesta(f"Campañas ({len(rows)} mostradas):\n" + "\n".join(lineas),
                       tipo="campanas", datos={"campanas": datos},
                       fuente={"nombre": "Campañas de marketing", "url": "/tendencias"},
                       sugerencias=["Crea un borrador sobre el nuevo curso", "¿Qué citas tengo?", "¿Qué hay nuevo?"])


def _h_flujos() -> dict:
    """A-3 (2026-11-26): los flujos NO tienen modelo en el servidor
    (frontend/components/FlujosPanel.tsx: constructor visual 100 %
    en el navegador, guardado en localStorage `grow-flows`,
    ejecución solo simulación). El chat no puede listarlos ni
    activarlos: no hay nada que leer en la BD. Activar/desactivar
    desde el chat queda en backlog: haría falta un modelo de flujos
    en el servidor (sin cambios de esquema en esta corrida)."""
    return _respuesta(
        "Los flujos (automatizaciones) viven solo en tu navegador: se "
        "guardan en el almacenamiento local y su ejecución es solo "
        "simulación — nunca se envía un correo ni se crea nada real. "
        "Por eso el chat no puede listarlos ni activarlos: no hay "
        "datos de flujos en el servidor. Para verlos, crearlos o "
        "correr una simulación, ve a Flujos (/flujos).",
        tipo="flujos", datos={"ruta": "/flujos"},
        fuente={"nombre": "Módulo Flujos", "url": "/flujos"},
        sugerencias=["¿Qué campañas hay?", "¿Qué puedes hacer?", "¿Qué hay nuevo?"],
    )


def _h_clases(db: Session) -> dict:
    rows = db.query(EduClass).order_by(EduClass.id.desc()).limit(10).all()
    if not rows:
        return _respuesta("No hay clases registradas en Estudiar.",
                           tipo="clases", datos={"clases": []},
                           fuente={"nombre": "Clases de Estudiar", "url": None})
    datos = [{"id": c.id, "kind": c.kind, "title": c.title,
              "extracto": _extracto(c.description),
              "scheduled_at": _iso(c.scheduled_at)} for c in rows]
    lineas = []
    for c in rows:
        linea = f"- {c.title} ({c.kind})"
        if c.scheduled_at:
            linea += f" — {_iso(c.scheduled_at)}"
        if c.description and c.description.strip():
            linea += f" — {_extracto(c.description)}"
        lineas.append(linea)
    return _respuesta(f"Clases ({len(rows)} mostradas):\n" + "\n".join(lineas),
                       tipo="clases", datos={"clases": datos},
                       fuente={"nombre": "Clases de Estudiar", "url": None},
                       sugerencias=["¿Qué hay nuevo?", "Muéstrame los contactos", "¿Cuánto vale el bitcoin?"])


def _h_novedades(db: Session) -> dict:
    rows = db.query(HomePost).order_by(HomePost.created_at.desc()).limit(5).all()
    if not rows:
        return _respuesta("No hay novedades publicadas todavía en Inicio.",
                           tipo="novedades", datos={"novedades": []},
                           fuente={"nombre": "Novedades de Inicio", "url": None})
    datos = [{"id": p.id, "title": p.title, "extracto": _extracto(p.body),
              "created_at": _iso(p.created_at)} for p in rows]
    lineas = []
    for p in rows:
        linea = f"- {p.title}"
        if p.created_at:
            linea += f" ({_iso(p.created_at)[:10]})"
        if p.body and p.body.strip():
            linea += f" — {_extracto(p.body)}"
        lineas.append(linea)
    return _respuesta("Últimas novedades:\n" + "\n".join(lineas),
                       tipo="novedades", datos={"novedades": datos},
                       fuente={"nombre": "Novedades de Inicio", "url": None},
                       sugerencias=["¿Qué clases hay?", "Muéstrame los contactos", "¿Cuánto vale el bitcoin?"])


def _h_ayuda() -> dict:
    lineas = ["Puedo ayudarte con esto:"]
    for c in COMANDOS:
        marca = " (solo admin)" if c["requiere_admin"] else ""
        lineas.append(f"- {c['descripcion']} Por ejemplo: «{c['ejemplo']}»{marca}")
    lineas.append("Todo con datos reales de la plataforma; nunca invento cifras.")
    lineas.append(
        "También puedo explicarte cómo hacer cosas («¿cómo creo una "
        "factura?») y buscar información general en Internet, siempre "
        "con su fuente."
    )
    return _respuesta("\n".join(lineas), tipo="ayuda",
                       datos={"comandos": [c["id"] for c in COMANDOS]},
                       fuente={"nombre": "Catálogo de ayuda", "url": None},
                       sugerencias=_SUGERENCIAS_LECTURA)


# ------------------------------------------------- vía rápida sin-respuesta --
# (chat-opt 2026-11-23): un mensaje que claramente NO es una
# pregunta de conocimiento general no debe esperar al presupuesto
# de Internet (5 s) para caer en la bandeja: en producción esa
# espera era el camino lento de cada saludo y cada sinsentido.
# Criterio conservador (mismo resultado visible que antes, solo
# más rápido): saludos/charla corta, o mensaje de 2+ palabras sin
# ninguna marca de pregunta Y sin ninguna palabra española común.
# Los temas sueltos de una palabra ("Bitcoin", "Fotosíntesis")
# SIGUEN yendo a Internet: un tema sin más contexto sí puede
# tener respuesta. El compromiso: un tema de 2+ palabras sin
# marca de pregunta ("Donald Trump") ya no busca en Internet.
_SALUDOS = (
    "hola", "buenos dias", "buenas tardes", "buenas noches", "buenas",
    "gracias", "muchas gracias", "adios", "hasta luego", "que tal",
    "ok", "vale", "si", "no",
)
_MARCAS_PREGUNTA_GENERAL = (
    "que es", "que son", "quien es", "quien son", "quienes son",
    "cuando", "donde", "como", "por que", "porque", "cual", "cuales",
    "cuanto", "cuanta", "cuantos", "cuantas", "dime", "explica",
    "explicame", "busca", "investiga", "significa", "que fue",
    "quien fue", "donde queda", "es el", "es la", "es un", "es una",
    "son los", "son las", "hay ", "habia", "que significa",
)
_PALABRAS_COMUNES_ES = frozenset("""
el la los las de en y a que es un una para con por se su al lo como mas pero
sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta
hay donde quien desde todo nos durante todos uno les ni contra eso ante
ellos esto mi antes algunos yo otro otras otra el tanto esa estos mucho
quienes nada muchos cual poco ella estar estas algunas algo nosotros mis
tu te ti tus ellas tengo tiene tienes hacer puede pueden va van fue son
del se tu su sus mi mis
""".split())


def _sin_respuesta_rapida(norm: str) -> bool:
    """True si el mensaje no merece un viaje a Internet: saludo o
    texto sin marca de pregunta y sin vocabulario español común."""
    limpio = norm.strip("¿?¡!.,").strip()
    if limpio in _SALUDOS or limpio.startswith("hola ") or limpio.startswith("hola,"):
        return True
    if any(m in norm for m in _MARCAS_PREGUNTA_GENERAL):
        return False
    palabras = norm.split()
    if len(palabras) < 2:
        return False
    return not any(p in _PALABRAS_COMUNES_ES for p in palabras)


# M2 (QA 2026-11-26): patrones de PII en la pregunta del usuario.
# Un correo o un teléfono en una pregunta genérica NO se envía a
# DDG/Wikipedia (saldría a terceros) ni se guarda en la bandeja.
_RE_EMAIL = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}",
                       re.IGNORECASE)
_RE_TELEFONO = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\b\d{10}\b")


def _contiene_pii(mensaje: str) -> bool:
    """True si el mensaje parece contener datos personales (correo
    o teléfono). Un número suelto corto (un precio, un año) no
    cuenta: el teléfono son 10 dígitos seguidos o en grupos 3-3-4."""
    texto = mensaje or ""
    if _RE_EMAIL.search(texto):
        return True
    return bool(_RE_TELEFONO.search(texto))


def _h_sin_respuesta(motivo: str | None = None) -> dict:
    """Respuesta estándar cuando nada respondió (va a la bandeja).

    Fase 6, tarea 2: el fallback es explícito — "No sé" + "no tengo
    una fuente para responder eso" — y sugiere qué preguntar o dónde
    buscar en la plataforma. NUNCA se inventa una respuesta: si
    ninguna fuente (reglas, intenciones, ayuda, biblioteca, Internet)
    cubre la pregunta, se declara la ausencia.

    F3-5: `motivo` dice por qué no hubo respuesta: "via_rapida"
    (saludo/sinsentido, sin viajar a Internet),
    "internet_sin_resultado" (Internet no devolvió nada útil) o
    "biblioteca_sin_resultado" (se buscó en Estudiar y no había nada)."""
    return _respuesta(
        "No sé — no tengo una fuente para responder eso. Puedo "
        "consultar precios, señales y análisis del mercado, listar "
        "clases y novedades, y (si eres admin) crear notas, tareas, "
        "borradores y citas; o busca el tema en Estudiar (/estudiar) "
        "o pregúntame «¿Qué puedes hacer?» para ver todo lo que sé "
        "hacer. Tu pregunta quedó registrada para que el "
        "administrador le enseñe una respuesta al asistente.",
        sin_respuesta=True,
        motivo=motivo,
        sugerencias=_SUGERENCIAS_LECTURA,
    )


def _completar(resp: dict, confianza: int | None = None) -> dict:
    """Añade la confianza del match si el handler no la puso."""
    if resp.get("confianza") is None and confianza is not None:
        resp["confianza"] = confianza
    return resp


# --------------------------------------- resumen de módulo (F2-3) --
# Registro real de módulos: etiqueta, pista y ruta copiadas de
# frontend/components/ModuleNav.tsx (MODULES + KEY_BY_HREF). El
# resumen usa SOLO estos datos (más conteos reales de la BD para
# Estudiar): nunca se inventa texto sobre un módulo.
MODULOS_RESUMEN: dict[str, tuple[str, str, str]] = {
    "inicio": ("Inicio", "Noticias y comentarios", "/inicio"),
    "invertir": ("Invertir", "Trading y mercados", "/"),
    "estudiar": ("Estudiar", "Academia", "/estudiar"),
    "crear": ("Crear", "Forge, copies y tendencias", "/crear"),
    "analizador": ("Analizador IA", "Contenido creado con IA", "/analizador"),
    "crm": ("Gestor de Clientes", "Contactos y clientes", "/crm"),
    "referidos": ("Referidos", "Campañas con recompensas", "/referidos"),
    "business": ("Business", "Marketing, Ventas, Legal y Admin", "/business"),
    "espacio": ("Espacio", "Meditación y revelaciones", "/espacio"),
    "facturas": ("Facturas", "Facturas y materiales", "/facturas"),
    "correos": ("Correos", "Plantillas, CRM y registro", "/correos"),
    "chat": ("Chat", "Chat en vivo", "/chat"),
    "recomendaciones": ("Recomendaciones", "Cursos y herramientas", "/recomendaciones"),
    "desarrollo": ("Desarrollo digital", "Adaptación digital para empresas", "/desarrollo"),
    "talento": ("Talento humano", "Equipo, roles y personas", "/talento"),
    "riesgos": ("Gestión de Riesgos", "Riesgos, controles y planes", "/riesgos"),
    "planillas": ("Planillas", "Pagos y registros del equipo", "/planillas"),
    "analisis": ("Análisis de datos", "Datos, reportes y decisiones", "/analisis"),
    "tendencias": ("Tendencias", "Palabras, campañas y anuncios", "/tendencias"),
    "auditor": ("Auditor web", "Velocidad y SEO de una página", "/auditor"),
    "privacidad": ("Privacidad", "Políticas, datos y cumplimiento", "/privacidad"),
    "inventario": ("Inventario", "Control de stock", "/inventario"),
    "perfil": ("Mi perfil", "Foto y datos del usuario", "/perfil"),
    "usuarios": ("Control de usuarios", "Aprobar cuentas, roles y claves", "/usuarios"),
    "ajustador": ("Ajustador", "Mejora continua y agentes", "/ajustador"),
    "terminal": ("Terminal", "Consola de pruebas", "/terminal"),
    "flujos": ("Flujos", "Automatizaciones", "/flujos"),
    "planes": ("Planes", "Precios y prueba gratis", "/planes"),
    "portal": ("Portal cliente", "Tus facturas, citas y contenido", "/portal"),
    "asistente": ("Asistente", "Chat por reglas", "/asistente"),
}


def _detectar_resumen_modulo(norm: str) -> str | None:
    """Clave del módulo si el mensaje pide resumirlo/explicarlo
    ("resume el módulo Estudiar", "qué contiene Facturas"), o None."""
    if not any(k in norm for k in ("resum", "explica el modulo", "que contiene",
                                   "que hay en el modulo", "de que trata el modulo")):
        return None
    tokens = set(norm.split())
    for clave, (label, _hint, _ruta) in MODULOS_RESUMEN.items():
        if clave in tokens or _norm(label) in norm:
            return clave
    return None


def _h_resumen_modulo(db: Session, clave: str, principal=None) -> dict:
    # M8 (QA 2026-11-26): el resumen de módulo respeta el perfil —
    # prueba e invitado no enumeran módulos de admin (usuarios,
    # terminal, auditor, ajustador, facturas, crm, correos...). El
    # gate usa modulos_para() (misma fuente que el menú).
    label, hint, ruta = MODULOS_RESUMEN[clave]
    if principal is not None:
        from app.core.perfiles import modulos_para

        if clave not in modulos_para(principal, db):
            etiqueta = _etiqueta_principal(principal)
            return _respuesta(
                f"El módulo {label} ({ruta}) no está disponible para tu "
                f"perfil ({etiqueta}): no lo ves en el menú y el chat "
                "tampoco puede resumirlo. Pídele a un administrador que "
                "te dé acceso.",
                tipo="resumen_modulo",
                datos={"modulo": clave, "label": label, "ruta": ruta,
                       "no_disponible_perfil": True},
                fuente={"nombre": "Registro de módulos", "url": ruta},
                sugerencias=["¿Qué puedes hacer?", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"],
            )
    texto = f"{label} ({ruta}): {hint}."
    datos: dict = {"modulo": clave, "label": label, "ruta": ruta}
    if clave == "estudiar":
        n_cursos = db.query(Course).count()
        n_clases = db.query(EduClass).count()
        n_videos = db.query(VideoEducativo).count()
        texto += (f" Ahora mismo hay {n_cursos} cursos, {n_clases} "
                  f"clases y {n_videos} vídeos en Estudiar.")
        datos.update({"n_cursos": n_cursos, "n_clases": n_clases, "n_videos": n_videos})
    else:
        texto += f" Ábrelo en {ruta} para ver sus datos reales."
    return _respuesta(texto, tipo="resumen_modulo", datos=datos,
                       fuente={"nombre": "Registro de módulos", "url": ruta},
                       sugerencias=["¿Qué puedes hacer?", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"])


# --------------------------------------- biblioteca de Estudiar (F4-1) --
# F4-2: constante estática de las 6 herramientas de Clases con sus
# anclas reales (frontend/components/ClasesHerramientas.tsx). No hay
# registro backend de estas herramientas: si el frontend renombra un
# id, este enlace se rompe sin que ningún test backend lo detecte
# (el Agente 3 verifica cada ancla en el frontend).
HERRAMIENTAS_CLASES: list[dict] = [
    {"id": "herramienta:calculadora", "tipo": "herramienta",
     "titulo": "Calculadora de interés compuesto",
     "descripcion": "Calcula el interés compuesto de una inversión.",
     "enlace": "/estudiar#herramienta-calculadora", "ruta": "/estudiar",
     "palabras_clave": "calculadora interes compuesto inversion ahorro",
     "precio_usd": None},
    {"id": "herramienta:conversor", "tipo": "herramienta",
     "titulo": "Conversor BTC / USD en vivo",
     "descripcion": "Convierte entre bitcoin y dólares con el precio en vivo.",
     "enlace": "/estudiar#herramienta-conversor", "ruta": "/estudiar",
     "palabras_clave": "conversor btc bitcoin usd dolar precio convertir",
     "precio_usd": None},
    {"id": "herramienta:grafica", "tipo": "herramienta",
     "titulo": "Gráfica BTC/USD · velas de 1 hora",
     "descripcion": "Gráfica de velas de 1 hora de BTC/USD.",
     "enlace": "/estudiar#herramienta-grafica", "ruta": "/estudiar",
     "palabras_clave": "grafica grafico btc bitcoin velas precio mercado",
     "precio_usd": None},
    {"id": "herramienta:indicadores", "tipo": "herramienta",
     "titulo": "Indicadores",
     "descripcion": "Indicadores técnicos de BTC/USD.",
     "enlace": "/estudiar#herramienta-indicadores", "ruta": "/estudiar",
     "palabras_clave": "indicadores rsi macd tecnico analisis",
     "precio_usd": None},
    {"id": "herramienta:bitcoin", "tipo": "herramienta",
     "titulo": "BTC",
     "descripcion": "Datos de Bitcoin en Estudiar.",
     "enlace": "/estudiar#herramienta-bitcoin", "ruta": "/estudiar",
     "palabras_clave": "btc bitcoin",
     "precio_usd": None},
    # B7 (QA 2026-11-26): la 6ª herramienta de Clases (ancla real en
    # frontend/components/ClasesHerramientas.tsx, id
    # "herramienta-rentabilidad", título t.clases.rentTitle).
    {"id": "herramienta:rentabilidad", "tipo": "herramienta",
     "titulo": "Calculadora de rentabilidad",
     "descripcion": "Calcula la rentabilidad de una inversión.",
     "enlace": "/estudiar#herramienta-rentabilidad", "ruta": "/estudiar",
     "palabras_clave": "rentabilidad calculadora inversion retorno ganancia",
     "precio_usd": None},
]


def _indice_biblioteca(db: Session) -> list[dict]:
    """Índice en memoria de la biblioteca (F4-1): Course + EduClass +
    VideoEducativo + las 6 herramientas. Sin tabla nueva: se
    construye por petición desde las 3 consultas ya existentes.
    Campos: id/titulo/tipo/descripcion/enlace/palabras_clave/
    precio_usd/modulo/ruta. F4-4: solo la guía gratuita ($0) enlaza
    descarga directa; los cursos de pago enlazan a su ficha/compra
    (buy_url), NUNCA al PDF por chat.

    A4 (2026-11-26): caché en memoria con TTL 300 s — antes se
    reconstruía 2 veces por mensaje (búsqueda + calificador F4-07).
    La caché se invalida por conteo (si cambia el nº de cursos,
    clases o vídeos, se reconstruye) y por TTL; además los
    endpoints que crean/borran cursos, clases o vídeos llaman a
    invalidar_cache_biblioteca(). Un cambio de título/descripción
    sin alta ni baja tarda como mucho el TTL en verse."""
    ahora = time.monotonic()
    conteos = (db.query(Course).count(), db.query(EduClass).count(),
               db.query(VideoEducativo).count())
    if (_BIBLIOTECA_CACHE["entries"] is not None
            and _BIBLIOTECA_CACHE["conteos"] == conteos
            and ahora - _BIBLIOTECA_CACHE["at"] < _BIBLIOTECA_TTL_S):
        return _BIBLIOTECA_CACHE["entries"]
    entries: list[dict] = _construir_indice_biblioteca(db)
    _BIBLIOTECA_CACHE.update(
        {"entries": entries, "conteos": conteos, "at": ahora})
    return entries


# A4: caché del índice de biblioteca (TTL 300 s + invalidación por
# conteo; ver _indice_biblioteca).
_BIBLIOTECA_TTL_S = 300
_BIBLIOTECA_CACHE: dict = {"entries": None, "conteos": None, "at": 0.0}


def invalidar_cache_biblioteca() -> None:
    """Vacía la caché del índice (la llaman los endpoints que crean,
    editan o borran cursos, clases o vídeos)."""
    _BIBLIOTECA_CACHE.update({"entries": None, "conteos": None, "at": 0.0})


def _construir_indice_biblioteca(db: Session) -> list[dict]:
    """Construye el índice desde cero (sin caché)."""
    entries: list[dict] = []
    for c in db.query(Course).order_by(Course.sort_order.asc(), Course.id.asc()).all():
        precio = float(c.price_usd) if c.price_usd is not None else None
        if precio == 0:
            enlace = f"/api/academy/courses/{c.id}/download"
        else:
            enlace = c.buy_url or None
        entries.append({
            "id": f"curso:{c.slug}", "titulo": c.title, "tipo": c.kind,
            "descripcion": c.description or "", "enlace": enlace,
            "palabras_clave": _norm(f"{c.title} {c.description or ''}"),
            "precio_usd": precio, "modulo": "estudiar", "ruta": "/estudiar",
        })
    for cl in db.query(EduClass).order_by(EduClass.id.desc()).all():
        tipo = "clase_grabada" if cl.kind == "grabada" else "clase_en_vivo"
        entries.append({
            "id": f"clase:{cl.id}", "titulo": cl.title, "tipo": tipo,
            "descripcion": cl.description or "", "enlace": cl.url or None,
            "palabras_clave": _norm(f"{cl.title} {cl.description or ''}"),
            "precio_usd": None, "modulo": "estudiar", "ruta": "/estudiar",
        })
    for v in db.query(VideoEducativo).order_by(VideoEducativo.id.desc()).all():
        entries.append({
            "id": f"video:{v.id}", "titulo": v.titulo, "tipo": "video",
            "descripcion": "", "enlace": v.url or None,
            "palabras_clave": _norm(v.titulo),
            "precio_usd": None, "modulo": "estudiar", "ruta": "/estudiar",
        })
    entries.extend(HERRAMIENTAS_CLASES)
    return entries


_STOP_BIBLIOTECA = frozenset("""
donde esta estan para como tiene hay el la los las que una uno del con
por en de un se su al lo es son este esta estos estas ese esa eso ser
""".split())


def _palabras_biblioteca(norm: str) -> list[str]:
    """Palabras significativas de una consulta de biblioteca: >=4
    letras y fuera de la lista de parada."""
    return [p for p in re.findall(r"[a-z0-9]+", norm)
            if len(p) >= 4 and p not in _STOP_BIBLIOTECA]


# Palabras de tipo genérico de la biblioteca (F4-07): nombran el tipo
# de recurso pero no cuál. Una consulta con tipo + calificadora
# ("manual de cocina") pide UN recurso concreto, no un listado.
_TIPOS_BIBLIOTECA = frozenset((
    "manual", "manuales", "curso", "cursos", "clase", "clases",
    "video", "videos", "guia", "guias", "ebook", "ebooks",
    "herramienta", "herramientas", "pack", "academia",
    "libro", "libros",
))


def _biblioteca_calificador_sin_resultado(db: Session, norm: str) -> bool:
    """Corrección QA F4-07: True si la consulta pide un recurso
    concreto que no existe. La consulta trae un tipo genérico
    ("manual") + al menos una palabra calificadora ("cocina") y
    NINGUNA calificadora casa con ninguna entrada del índice: el
    ranking casaría por la palabra suelta "manual" y devolvería
    otros manuales como si fueran la respuesta. Las consultas de
    listado ("¿Qué manuales hay?", sin calificadora) y las que sí
    casan ("manual de WhatsApp") devuelven False."""
    palabras = _palabras_biblioteca(norm)
    if not any(p in _TIPOS_BIBLIOTECA for p in palabras):
        return False
    calificadoras = [p for p in palabras if p not in _TIPOS_BIBLIOTECA]
    if not calificadoras:
        return False
    for e in _indice_biblioteca(db):
        claves = e.get("palabras_clave") or _norm(
            e["titulo"] + " " + (e.get("descripcion") or ""))
        if any(c in claves for c in calificadoras):
            return False
    return True


def _h_biblioteca_sin_resultado(mensaje: str) -> dict:
    """Respuesta F4-07: sin_respuesta con motivo
    "biblioteca_sin_resultado" y texto explícito de "sin resultados
    en la biblioteca". No se listan recursos relacionados como si
    fueran la respuesta. Fase 6, tarea 2: mismo "No sé" explícito
    que el fallback general."""
    return _respuesta(
        "No sé — no tengo una fuente para responder eso: sin "
        f"resultados en la biblioteca para «{mensaje}». Prueba con "
        "otro título o pregunta «¿Qué manuales hay?» para ver los "
        "disponibles.",
        sin_respuesta=True,
        motivo="biblioteca_sin_resultado",
        sugerencias=_SUGERENCIAS_LECTURA,
    )


def _buscar_biblioteca(db: Session, norm: str) -> list[tuple[int, dict]]:
    """Entradas de la biblioteca que casan con el mensaje, por
    puntuación (palabras que aparecen en título/descripción;
    bonificación por coincidencia en el título). Máx. 5."""
    palabras = _palabras_biblioteca(norm)
    if not palabras:
        return []
    scored: list[tuple[int, dict]] = []
    for e in _indice_biblioteca(db):
        claves = e.get("palabras_clave") or _norm(
            e["titulo"] + " " + (e.get("descripcion") or ""))
        hits = [p for p in palabras if p in claves]
        if not hits:
            continue
        titulo_hits = [p for p in palabras if p in _norm(e["titulo"])]
        score = len(hits) * 10 + (15 if titulo_hits else 0)
        scored.append((score, e))
    scored.sort(key=lambda t: (-t[0], t[1]["titulo"]))
    return scored[:5]


def _h_biblioteca(resultados: list[tuple[int, dict]]) -> dict:
    recursos = [{
        "id": e["id"], "tipo": e["tipo"], "titulo": e["titulo"],
        "descripcion": e.get("descripcion") or "",
        "enlace": e.get("enlace"), "ruta": e.get("ruta"),
        "precio_usd": e.get("precio_usd"),
    } for _score, e in resultados]
    lineas = ["En Estudiar encontré esto:"]
    for r in recursos:
        linea = f"- {r['titulo']} ({r['tipo']})"
        if r["descripcion"]:
            linea += f" — {r['descripcion']}"
        if r["enlace"]:
            linea += f" [{r['enlace']}]"
        if r["precio_usd"] is not None:
            linea += f" (${r['precio_usd']:.2f})"
        lineas.append(linea)
    return _respuesta("\n".join(lineas), tipo="biblioteca",
                       datos={"recursos": recursos, "n": len(recursos)},
                       recursos=recursos,
                       fuente={"nombre": "Biblioteca de Estudiar", "url": "/estudiar"},
                       sugerencias=["¿Qué clases hay?", "¿Qué hay nuevo?", "¿Cuánto vale el bitcoin?"])


# --------------------------------------- ranking de intenciones (F2-1) --
# Puntuación por intención: nº de claves coincidentes + bonificación
# por frase multi-palabra (tema específico) − penalización a las
# genéricas ("mercado", "venta") cuando son la única coincidencia.
# El orden actual es el desempate: a igual puntuación gana la
# intención que antes ganaba por posición en la cadena de `if`.
_INTENCIONES: list[tuple[str, tuple[str, ...], frozenset]] = [
    # "comandos" a secas salía: "Guía de Comandos" casaba con el
    # listado de ayuda. Queda "lista de comandos" como forma explícita.
    ("ayuda", ("ayuda", "que puedes hacer", "que sabes hacer", "lista de comandos"), frozenset()),
    ("crear_cita", ("crea una cita", "agenda una cita", "crear una cita",
                    "agendar una cita", "nueva cita"), frozenset()),
    ("ayuda_tema", tuple(c for a in AYUDAS for c in a["claves"]), frozenset()),
    ("listar_citas", ("cita", "citas", "agenda"), frozenset()),
    ("crear_nota", ("crea una nota", "crear una nota", "nueva nota", "anota"), frozenset()),
    ("crear_tarea", ("crea una tarea", "crear una tarea", "nueva tarea", "pendiente"), frozenset()),
    ("crear_borrador", ("borrador", "contenido", "publicacion", "post"), frozenset()),
    ("precio", ("precio", "cuanto vale", "cotizacion"), frozenset()),
    ("senales", ("senal",), frozenset()),
    ("analisis", ("analisis", "analiza", "mercado", "tendencia"),
     frozenset(("mercado", "tendencia"))),
    ("facturas", ("factura", "venta", "vendid", "ingresos"),
     frozenset(("venta", "vendid"))),
    ("contactos", ("contacto", "clientes"), frozenset()),
    ("campanas", ("campana",), frozenset()),
    ("flujos", ("flujos", "automatizacion", "automatizaciones"), frozenset()),
    ("clases", ("clase", "clases", "curso"), frozenset()),
    ("novedades", ("novedad", "novedades", "que hay nuevo"), frozenset()),
]
_CREACION_IDS = frozenset(("crear_cita", "crear_nota", "crear_tarea", "crear_borrador"))


def _mejor_intencion(norm: str, es_orden: bool) -> tuple[str, int] | None:
    """(id, confianza 0-100) de la mejor intención, o None si ninguna
    clave casa. A igual puntuación gana el orden de la tabla."""
    mejor = None
    for orden, (iid, claves, genericas) in enumerate(_INTENCIONES):
        if iid in _CREACION_IDS and not es_orden:
            continue
        hits = [k for k in claves if k in norm]
        if not hits:
            continue
        score = 35 + 20 * len(hits)
        if any(" " in h for h in hits):
            score += 10
        if genericas and all(h in genericas for h in hits):
            score -= 10
        score = min(95, max(10, score))
        if mejor is None or score > mejor[1] or (score == mejor[1] and orden < mejor[2]):
            mejor = (iid, score, orden)
    if mejor is None:
        # Definición local de BTC/ETH (chat-opt 2026-11-23): "¿qué es
        # el bitcoin?" tiene respuesta local y no va a Internet.
        if re.search(r"\b(bitcoin|btc|ethereum|eth)\b", norm) and any(
            k in norm for k in ("que es", "que son", "que significa")
        ):
            return ("precio", 70)
        return None
    return (mejor[0], mejor[1])


# Intenciones de datos (M6, QA 2026-11-26): precio, señales,
# análisis y facturas se resuelven con datos en vivo. Decisión en
# ejecución (ver test_regla_ensenada_precede_a_intencion_interna):
# las reglas enseñadas SIGUEN ganando a la intención interna, pero
# si una regla responde sobre uno de estos temas (o sobre planes),
# la respuesta lleva la marca "respuesta enseñada, no dato en vivo".
# Reordenar rompería ese test y la regla enseñada por el admin.
_INTENCIONES_DATOS = frozenset(("precio", "senales", "analisis", "facturas"))


def _cubre_intencion_datos(norm: str) -> bool:
    """True si el mensaje casa con una intención de datos (o pregunta
    por planes): la respuesta de regla sobre ese tema debe llevar la
    marca de M6. Las claves genéricas solas ("mercado", "venta") no
    cuentan: "mercado" a secas pide aclaración, no es un dato."""
    if _es_pregunta_planes(norm):
        return True
    mejor = _mejor_intencion(norm, es_orden=False)
    if mejor is None or mejor[0] not in _INTENCIONES_DATOS:
        return False
    claves = next((t[1] for t in _INTENCIONES if t[0] == mejor[0]), ())
    genericas = next((t[2] for t in _INTENCIONES if t[0] == mejor[0]),
                     frozenset())
    hits = [k for k in claves if k in norm]
    return bool(hits) and not all(h in genericas for h in hits)


def _despachar_intencion(iid: str, db: Session, user, mensaje: str, norm: str) -> dict | None:
    if iid == "ayuda":
        return _h_ayuda()
    if iid == "ayuda_tema":
        ayuda = _buscar_ayuda(norm)
        return _h_ayuda_tema(ayuda) if ayuda is not None else None
    if iid == "crear_cita":
        return _h_crear_cita(db, user, mensaje, norm)
    if iid == "listar_citas":
        return _h_listar_citas(db, user)
    if iid == "crear_nota":
        return _h_crear_nota(db, user, mensaje)
    if iid == "crear_tarea":
        return _h_crear_tarea(db, user, mensaje)
    if iid == "crear_borrador":
        return _h_crear_borrador(db, user, mensaje)
    if iid == "precio":
        return _h_precio(db, norm)
    if iid == "senales":
        return _h_senales(db)
    if iid == "analisis":
        return _h_analisis(db)
    if iid == "facturas":
        return _h_facturas(db, user)
    if iid == "contactos":
        return _h_contactos(db, user)
    if iid == "campanas":
        return _h_campanas(db, user, norm)
    if iid == "flujos":
        return _h_flujos()
    if iid == "clases":
        return _h_clases(db)
    if iid == "novedades":
        return _h_novedades(db)
    return None


# Claves cuya única coincidencia no basta para decidir: la palabra
# desnuda es ambigua y pide aclaración (ver _aclaracion_ambigua).
_CLAVES_AMBIGUAS = frozenset(("mercado", "tendencia", "venta", "vendid", "curso"))

# Opciones de aclaración por intención ambigua (F3-07/F4-05).
_ACLARACION_AMBIGUA: dict[str, dict] = {
    "analisis": {
        "pregunta": "«Mercado» puede ser varias cosas: ¿qué quieres ver?",
        "opciones": ["Analiza el mercado", "¿Cuánto vale el bitcoin?",
                     "Muéstrame las últimas señales"],
    },
    "facturas": {
        "pregunta": "¿Qué quieres ver de las ventas?",
        "opciones": ["¿Cuánto hemos vendido?", "Ver todas las facturas",
                     "Resume el módulo Facturas"],
    },
    "clases": {
        "pregunta": "«Curso» puede ser una clase, un manual o un vídeo: ¿qué buscas?",
        "opciones": ["¿Qué clases hay?", "¿Qué manuales hay?",
                     "Resume el módulo Estudiar"],
    },
}


def _aclaracion_ambigua(norm: str, mejor: tuple[str, int] | None) -> dict | None:
    """Corrección QA F3-07/F4-05: una palabra desnuda ambigua no se
    responde por ranking con confianza baja, se aclara con opciones.

    Regla de disparo (las tres condiciones a la vez):
    1. La mejor intención es una de las ambiguas (analisis, facturas
       o clases: "mercado" puede ser análisis/precio/señales,
       "ventas" puede ser varias vistas de facturación y "curso"
       puede ser clase, manual/ebook o vídeo).
    2. TODOS los aciertos de esa intención son claves ambiguas
       ("mercado"/"tendencia", "venta"/"vendid", "curso"): en cuanto
       hay otra clave con contexto real ("analiza", "clase") no se
       aclara, se responde.
    3. El mensaje tiene como mucho 2 palabras ("mercado", "el
       mercado"): con 3 o más ya hay contexto ("mercado de
       camisetas" sigue siendo análisis, "¿Qué cursos hay?" sigue
       siendo clases, "¿Cuánto hemos vendido?" sigue siendo
       facturas). Las demás intenciones ("precio", "ayuda",
       "novedades", "citas"...) no se tocan: una palabra sola suya
       ya es una petición clara.
    Las opciones son mensajes que, al reenviarse (el frontend envía
    el texto del botón como mensaje nuevo), resuelven sin volver a
    aclarar: todos tienen 3+ palabras o aciertan a otra intención."""
    if mejor is None:
        return None
    iid = mejor[0]
    if iid not in _ACLARACION_AMBIGUA:
        return None
    if len(norm.split()) > 2:
        return None
    claves = next((t[1] for t in _INTENCIONES if t[0] == iid), ())
    hits = [k for k in claves if k in norm]
    if not hits or not all(h in _CLAVES_AMBIGUAS for h in hits):
        return None
    return _ACLARACION_AMBIGUA[iid]


def _aclaracion_alternativas(norm: str) -> dict | None:
    """Desambiguación (F3-4): una pregunta "¿A o B?" sin respuesta
    local ni en Internet devuelve las dos opciones en vez de un
    "sin respuesta" seco."""
    if "?" not in norm and " o " not in norm:
        return None
    m = re.search(r"\b([a-z0-9][a-z0-9 \-]{2,40}?)\s+o\s+([a-z0-9][a-z0-9 \-]{2,40})\s*\??$", norm)
    if not m:
        return None
    a, b = m.group(1).strip(), m.group(2).strip()
    if a == b or len(a) < 3 or len(b) < 3:
        return None
    return {"pregunta": f"¿Te refieres a «{a}» o a «{b}»?",
            "opciones": [a, b]}


# --------------------------------------- referencias al último objeto (C-2) --
# Memoria de conversación acotada (2026-11-26): el frontend envía
# los últimos turnos en ChatIn.historial y el backend los usa para
# resolver referencias al último objeto creado ("esa cita",
# "cámbiala a las 11"). Sin persistencia en BD. Si no se puede
# resolver, se pregunta en vez de inventar. Las confirmaciones de
# creación del propio asistente llevan el id ("Cita creada (id 5)"):
# es la única fuente de la referencia — nunca se adivina un id.
_RE_CREACION = (
    ("cita", re.compile(r"Cita creada \(id (\d+)\)")),
    ("nota", re.compile(r"Nota creada en [^()]*\(id (\d+)\)")),
    ("tarea", re.compile(r"Tarea creada en [^()]*\(id (\d+)\)")),
    ("borrador", re.compile(r"Borrador creado en [^()]*\(id (\d+)\)")),
)
_RE_REFERENCIA_TIPO = re.compile(
    r"\b(es[ae]|est[ae]|la|el)\s+(cita|nota|tarea|borrador)\b")
_RE_VERBO_CAMBIO = re.compile(
    r"\b(cambiala|cambialo|muevela|muevelo|reprograma|cambia|mueve)\b")
_RE_VERBO_MOSTRAR = re.compile(
    r"\b(muestra|muestrame|muestrala|muestralo|ensename|ensena|dime|que dice|cuando es|cual es)\b")


def _ultimo_objeto_creado(historial, tipo: str | None = None) -> tuple[str, int] | None:
    """(tipo, id) del último objeto creado según las confirmaciones
    del asistente en el historial, o None. Si `tipo` es None, vale
    cualquier tipo (el más reciente)."""
    turnos = historial or []
    for turno in reversed(turnos):
        if turno.get("rol") != "asistente":
            continue
        texto = turno.get("texto") or ""
        for t, patron in _RE_CREACION:
            if tipo is not None and t != tipo:
                continue
            m = patron.search(texto)
            if m:
                return (t, int(m.group(1)))
    return None


def _detectar_referencia(norm: str) -> tuple[str | None, str | None]:
    """(tipo, acción) si el mensaje refiere al último objeto creado,
    o (None, None). Tipo: "cita"/"nota"/"tarea"/"borrador" o None
    (pronombre: "cámbiala", "muévela"). Acción: "cambiar_hora" o
    "mostrar". Sin referencia explícita no hay nada que resolver:
    "¿qué citas tengo?" es un listado, no una referencia."""
    m = _RE_REFERENCIA_TIPO.search(norm)
    tipo = m.group(2) if m else None
    es_pronombre = _RE_VERBO_CAMBIO.search(norm) is not None and tipo is None
    if tipo is None and not es_pronombre:
        return None, None
    if _RE_VERBO_CAMBIO.search(norm):
        return tipo, "cambiar_hora"
    if _RE_VERBO_MOSTRAR.search(norm):
        return tipo, "mostrar"
    # Referencia sin verbo claro ("¿esa cita?"): mostrar.
    if tipo is not None:
        return tipo, "mostrar"
    return None, None


def _parse_nueva_hora_cita(norm: str, cita: Appointment) -> tuple[dt.datetime | None, dict | None]:
    """Nueva fecha/hora para una cita existente (C-2): misma
    interpretación que _parse_cita (hora en America/Los_Angeles,
    hora suelta sin AM/PM y fecha D/M ambigua piden aclaración en
    vez de asumir), pero la fecha por defecto es la de la cita
    actual, no "mañana"."""
    ahora_la = dt.datetime.now(TZ_LA)
    actual_la = cita.starts_at.astimezone(TZ_LA) if cita.starts_at.tzinfo else cita.starts_at.replace(tzinfo=dt.timezone.utc).astimezone(TZ_LA)
    fecha: dt.date | None = None
    aclaracion = None
    if "pasado manana" in norm:
        fecha = (ahora_la + dt.timedelta(days=2)).date()
    elif "manana" in norm:
        fecha = (ahora_la + dt.timedelta(days=1)).date()
    elif "hoy" in norm:
        fecha = ahora_la.date()
    else:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", norm)
        if m:
            try:
                fecha = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                fecha = None
        else:
            m = re.search(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", norm)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                anio = int(m.group(3) or ahora_la.year)
                if a <= 12 and b <= 12 and a != b:
                    meses = ["enero", "febrero", "marzo", "abril", "mayo",
                             "junio", "julio", "agosto", "septiembre",
                             "octubre", "noviembre", "diciembre"]
                    aclaracion = {
                        "pregunta": (f"La fecha {a}/{b} es ambigua: "
                                     f"¿{a} de {meses[b - 1]} o {b} de {meses[a - 1]}?"),
                        "opciones": [f"{a} de {meses[b - 1]}", f"{b} de {meses[a - 1]}"],
                    }
                    return None, aclaracion
                try:
                    fecha = dt.date(anio, b, a)
                except ValueError:
                    fecha = None
    if fecha is None:
        fecha = actual_la.date()
    hora: tuple[int, int] | None = None
    m = re.search(r"(\d{1,2}):(\d{2})", norm)
    if m:
        hora = (int(m.group(1)), int(m.group(2)))
        if re.search(r"\b" + str(hora[0]) + r":\d{2}\s*pm\b", norm) and hora[0] < 12:
            hora = (hora[0] + 12, hora[1])
    else:
        m = re.search(r"a las (\d{1,2})\s*(am|pm)?\b", norm)
        if m:
            h = int(m.group(1))
            marca = m.group(2)
            if marca == "pm" and h < 12:
                hora = (h + 12, 0)
            elif marca == "am":
                hora = (h % 12, 0)
            else:
                aclaracion = {
                    "pregunta": f"¿La cita es a las {h}:00 de la mañana o de la noche?",
                    "opciones": [f"{h}:00 de la mañana", f"{h}:00 de la noche"],
                }
                return None, aclaracion
    if hora is None:
        return None, None
    try:
        local = dt.datetime.combine(fecha, dt.time(hora[0], hora[1]), tzinfo=TZ_LA)
        return local.astimezone(dt.timezone.utc), None
    except ValueError:
        return None, None


def _h_referencia(db: Session, user: User, mensaje: str, norm: str,
                  historial) -> dict | None:
    """Seguimiento sobre el último objeto creado (C-2). Devuelve
    None si el mensaje no refiere a ningún objeto (el llamador sigue
    el flujo normal). Solo admin: las referencias son seguimientos
    de creaciones que solo el admin puede hacer; prueba nunca tiene
    un objeto creado en su historial."""
    tipo, accion = _detectar_referencia(norm)
    if tipo is None and accion is None:
        return None
    if not user.is_admin:
        return _solo_lectura(user)
    encontrado = _ultimo_objeto_creado(historial, tipo)
    if encontrado is None:
        if accion != "cambiar_hora":
            # Sin objeto en el historial, "muéstrame esa cita" no se
            # puede resolver, pero tampoco se inventa: se sigue el
            # flujo normal (p. ej. "¿cuándo es la cita?" lista las
            # próximas). Solo un cambio sin referencia pide aclaración.
            return None
        que = f"ninguna {tipo}" if tipo else "ningún objeto creado"
        return _respuesta(
            f"No veo {que} en esta conversación: no hay una creación "
            "reciente a la que referirse. Dime cuál quieres cambiar "
            "(por ejemplo, crea primero la cita y luego dime "
            "«cámbiala a las 11»).",
            sugerencias=["¿Qué citas tengo?", "¿Qué puedes hacer?"],
        )
    tipo_real, oid = encontrado
    if accion == "mostrar":
        if tipo_real == "cita":
            obj = db.get(Appointment, oid)
            if obj is None:
                return _respuesta(f"Esa cita (id {oid}) ya no existe.",
                                   sugerencias=["¿Qué citas tengo?"])
            return _respuesta(
                f"Esa cita (id {obj.id}): {obj.client_name or 'Sin cliente'} — "
                f"{obj.service_type}, {_fmt_local_hora(obj.starts_at)} "
                f"({obj.duration_min} min, {obj.status}).",
                tipo="mostrar_cita",
                datos={"id": obj.id, "client_name": obj.client_name,
                       "service_type": obj.service_type,
                       "starts_at": _iso(obj.starts_at),
                       "duration_min": obj.duration_min, "status": obj.status},
                sugerencias=["¿Qué citas tengo?", "Muéstrame los contactos", "¿Qué hay nuevo?"],
            )
        if tipo_real == "nota":
            obj = db.get(BusinessNote, oid)
            if obj is None:
                return _respuesta(f"Esa nota (id {oid}) ya no existe.",
                                   sugerencias=["¿Qué puedes hacer?"])
            return _respuesta(
                f"Esa nota (id {obj.id}): «{obj.title}»\n{obj.body}",
                tipo="mostrar_nota", datos={"id": obj.id, "title": obj.title},
                sugerencias=["¿Qué citas tengo?", "¿Qué puedes hacer?"],
            )
        if tipo_real == "tarea":
            obj = db.get(BusinessTask, oid)
            if obj is None:
                return _respuesta(f"Esa tarea (id {oid}) ya no existe.",
                                   sugerencias=["¿Qué puedes hacer?"])
            estado = "hecha" if obj.done else "pendiente"
            return _respuesta(
                f"Esa tarea (id {obj.id}): «{obj.title}» ({estado}).",
                tipo="mostrar_tarea",
                datos={"id": obj.id, "title": obj.title, "done": obj.done},
                sugerencias=["¿Qué citas tengo?", "¿Qué puedes hacer?"],
            )
        obj = db.get(ContentItem, oid)
        if obj is None:
            return _respuesta(f"Ese borrador (id {oid}) ya no existe.",
                               sugerencias=["¿Qué puedes hacer?"])
        return _respuesta(
            f"Ese borrador (id {obj.id}): «{obj.title}» "
            f"({obj.platform}, {obj.status}).",
            tipo="mostrar_borrador",
            datos={"id": obj.id, "title": obj.title, "platform": obj.platform,
                   "status": obj.status},
            sugerencias=["¿Qué citas tengo?", "¿Qué puedes hacer?"],
        )
    # cambiar_hora: solo citas. Editar notas/tareas/borradores desde
    # el chat es backlog (no en esta corrida): se dice, no se inventa.
    if tipo_real != "cita":
        return _respuesta(
            f"Solo puedo cambiar la hora de una cita desde el chat. "
            f"Ese {tipo_real} se edita en su módulo "
            "(Negocio > Marketing o Crear).",
            sugerencias=["¿Qué citas tengo?", "¿Qué puedes hacer?"],
        )
    cita = db.get(Appointment, oid)
    if cita is None:
        return _respuesta(f"Esa cita (id {oid}) ya no existe.",
                           sugerencias=["¿Qué citas tengo?"])
    nuevo_inicio, aclaracion = _parse_nueva_hora_cita(norm, cita)
    if aclaracion is not None:
        return _respuesta(
            "Antes de cambiar la cita necesito que me confirmes un dato.",
            aclaracion=aclaracion,
            sugerencias=["¿Qué citas tengo?"],
        )
    if nuevo_inicio is None:
        return _respuesta(
            "¿A qué hora la muevo? Escríbelo así: «Cámbiala a las 11:00» "
            "o «Cámbiala a mañana a las 11:00».",
            sugerencias=["¿Qué citas tengo?"],
        )
    if nuevo_inicio <= dt.datetime.now(dt.timezone.utc):
        return _respuesta(
            "Esa fecha y hora ya pasó: dime una fecha futura para la cita.",
            sugerencias=["¿Qué citas tengo?"],
        )
    if cita.contact_id is not None and _overlaps(
            db, cita.contact_id, nuevo_inicio, cita.duration_min,
            exclude_id=cita.id):
        return _respuesta(
            f"No cambié la cita: {cita.client_name} ya tiene una cita que "
            f"se solapa con {_fmt_local_hora(nuevo_inicio)} "
            f"({cita.duration_min} min). Elige otro horario.",
            tipo="cambiar_cita",
            datos={"conflicto": True, "id": cita.id,
                   "starts_at": nuevo_inicio.isoformat(), "solape_comprobado": True},
            sugerencias=["¿Qué citas tengo?"],
        )
    anterior = cita.starts_at
    cita.starts_at = nuevo_inicio
    db.commit()
    db.refresh(cita)
    # B2: auditoría del cambio (sin el contenido del usuario).
    audit(db, user, "asistente.cambiar_cita", "appointment", str(cita.id),
          details={"contact_id": cita.contact_id})
    nota_solape = (" Se comprobó que no se solapa con sus otras citas."
                   if cita.contact_id is not None else
                   " No se comprobó si se solapa con otra cita porque "
                   "el cliente no está en el CRM.")
    return _respuesta(
        f"Cita cambiada (id {cita.id}): {cita.client_name} — "
        f"{cita.service_type}, antes {_fmt_local_hora(anterior)}, ahora "
        f"{_fmt_local_hora(nuevo_inicio)} ({cita.duration_min} min, "
        f"{cita.status}).{nota_solape}",
        tipo="cambiar_cita",
        datos={"id": cita.id, "client_name": cita.client_name,
               "service_type": cita.service_type,
               "starts_at_anterior": _iso(anterior),
               "starts_at": nuevo_inicio.isoformat(),
               "duration_min": cita.duration_min, "status": cita.status,
               "solape_comprobado": cita.contact_id is not None},
        sugerencias=["¿Qué citas tengo?", "Muéstrame los contactos", "¿Qué hay nuevo?"],
    )


def _cortar_en_punto_final(texto: str, limite: int = 600) -> str:
    """Si el texto supera el límite, corta en el último punto final
    antes del límite (F3-4): nunca se devuelve una frase a medias."""
    if len(texto) <= limite:
        return texto
    corte = texto[:limite].rfind(". ")
    if corte > 200:
        return texto[:corte + 1]
    return texto[:limite].rstrip() + "…"


# ------------------------------------------------------------------ endpoints --

class HistorialTurno(BaseModel):
    """Un turno previo de la conversación (C-2, 2026-11-26): el
    frontend envía los últimos turnos para que el backend resuelva
    referencias ("esa cita", "cámbiala a las 11"). Sin persistencia
    en BD en esta corrida: el historial vive solo en la petición."""
    rol: Literal["usuario", "asistente"]
    texto: str = Field("", max_length=MAX_MENSAJE)


class ChatIn(BaseModel):
    # Transversal 2026-11-24: tope Pydantic (antes solo comprobación
    # manual en el handler, que devolvía 400; ahora 422).
    mensaje: str = Field("", max_length=MAX_MENSAJE)
    # C-2: últimos turnos de la conversación (máx. 6), opcionales.
    historial: list[HistorialTurno] | None = Field(default=None, max_length=6)


@router.get("/capacidades")
def capacidades(principal: Principal = Depends(guest_read_guard),
                db: Session = Depends(get_db)):
    # B1 (corrida seguridad 2026-11-23): cliente vinculado -> 403
    # (mismo patrón que crm.py:105). Solo bloquea a clientes
    # vinculados; el rol prueba sin vínculo no cambia (decisión M1
    # de Rubén, pendiente). El invitado pasa: deny_linked_reader
    # devuelve None para Guest (sin id, sin vínculo posible).
    deny_linked_reader(db, principal)
    # M8 (QA 2026-11-26): a no-admin no se le listan los comandos
    # requiere_admin (el frontend ya filtraba los chips, pero la
    # API los exponía a cualquiera).
    es_admin = getattr(principal, "is_admin", False) or (
        not isinstance(principal, Guest) and is_super_admin(principal, db)
    )
    if es_admin:
        return {"comandos": COMANDOS}
    return {"comandos": [c for c in COMANDOS if not c["requiere_admin"]]}


@router.get("/uso")
def uso_asistente(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    """Uso diario del Asistente del usuario actual (Fase 6, tarea 1):
    plan, límite, mensajes de hoy y restantes. Admin/super_admin:
    límite null (sin límite); mensajes_hoy es su conteo real,
    informativo. El invitado no tiene fila: 401 (usa get_current_user).
    B2 (QA 2026-11-26): cliente vinculado -> 403, como en chat y
    capacidades."""
    deny_linked_reader(db, user)
    clave, limite = _plan_usuario(user, db)
    hoy = _mensajes_hoy(db, user.id)
    return {
        "plan": clave,
        "plan_nombre": (
            "Administrador (sin límite)" if limite is None
            else NOMBRES_PLAN[clave]
        ),
        "limite_diario": limite,
        "mensajes_hoy": hoy,
        "restantes": None if limite is None else max(0, limite - hoy),
        "fecha": _hoy_utc().isoformat(),
    }


# ------------------------------------------------- feedback (Fase 6, tarea 3) --

class FeedbackIn(BaseModel):
    pregunta: str = Field("", max_length=1000)
    voto: str = Field("", max_length=8)


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
def dar_feedback(payload: FeedbackIn,
                 request: Request,
                 principal: Principal = Depends(get_current_principal),
                 db: Session = Depends(get_db)):
    """Voto útil / no útil sobre una respuesta del Asistente.

    Se guarda SOLO pregunta + voto + usuario + fecha (nunca la
    respuesta del asistente ni la conversación completa: ver
    AsistenteFeedback). Un "no_util" re-registra la pregunta en la
    bandeja del admin (GET /preguntas) para enseñarle una respuesta;
    el invitado vota pero no entra en la bandeja (misma regla que
    las preguntas "no sé": un anónimo podría llenarla de spam).
    B2 (QA 2026-11-26): cliente vinculado -> 403. M7: mismo limiter
    de chat (20/min por usuario, 5/min por IP para invitado)."""
    deny_linked_reader(db, principal)
    pregunta = (payload.pregunta or "").strip()
    voto = (payload.voto or "").strip().lower()
    if not pregunta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La pregunta no puede estar vacía.",
        )
    if voto not in ("util", "no_util"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El voto debe ser 'util' o 'no_util'.",
        )
    if isinstance(principal, Guest):
        client_ip = request.client.host if request.client else "unknown"
        if not guest_chat_limiter.allow(f"asistente_feedback_guest:{client_ip}"):
            raise too_many_requests(
                "Demasiados votos como invitado. Espera un minuto.",
                guest_chat_limiter.window,
            )
    elif not asistente_limiter.allow(f"asistente_feedback:{principal.id}"):
        raise too_many_requests(
            "Demasiados votos al asistente. Espera un minuto.",
            asistente_limiter.window,
        )
    user_id = None if isinstance(principal, Guest) else principal.id
    fila = AsistenteFeedback(user_id=user_id, pregunta=pregunta[:1000], voto=voto)
    db.add(fila)
    db.commit()
    db.refresh(fila)
    if voto == "no_util" and not isinstance(principal, Guest):
        _registrar_pregunta(db, pregunta[:1000])
    return {"id": fila.id, "voto": fila.voto, "creado_en": _iso(fila.creado_en)}


@router.get("/feedback")
def listar_feedback(
    voto: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Registro de votos del Asistente (solo admin). Las preguntas
    marcadas "no útil" son preguntas sin respuesta que el admin debe
    enseñar (las "no sé" ya están en GET /preguntas, y cada "no útil"
    de un usuario también re-entra ahí). Filtro opcional por voto."""
    q = db.query(AsistenteFeedback)
    if voto:
        q = q.filter(AsistenteFeedback.voto == voto)
    rows = (
        q.order_by(AsistenteFeedback.creado_en.desc(),
                   AsistenteFeedback.id.desc())
        .offset(offset).limit(limit).all()
    )
    ids = [r.user_id for r in rows if r.user_id is not None]
    nombres = (
        {u.id: u.username for u in
         db.query(User).filter(User.id.in_(ids)).all()}
        if ids else {}
    )
    return [
        {
            "id": f.id,
            "pregunta": f.pregunta,
            "voto": f.voto,
            "usuario": nombres.get(f.user_id) if f.user_id is not None else "invitado",
            "creado_en": _iso(f.creado_en),
        }
        for f in rows
    ]


@router.post("/chat")
def chat(payload: ChatIn, request: Request,
         principal: Principal = Depends(get_current_principal),
         db: Session = Depends(get_db)):
    # B1: cliente vinculado -> 403 (ver capacidades()).
    deny_linked_reader(db, principal)
    user = principal
    mensaje = (payload.mensaje or "")
    if not mensaje.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="El mensaje no puede estar vacío.")
    # El tope de 1000 caracteres ya lo impone ChatIn (Pydantic,
    # 422); no se re-chequea aquí.
    # B2: limiter por usuario (20/min, como ai_ask). Tras la
    # validación: los 400 no consumen presupuesto.
    # Fase 1 (2026-11-23): el invitado no tiene user.id — su limiter
    # es por IP, 5/min, con Retry-After.
    if isinstance(principal, Guest):
        client_ip = request.client.host if request.client else "unknown"
        if not guest_chat_limiter.allow(f"guest_chat:{client_ip}"):
            raise too_many_requests(
                "Demasiadas preguntas como invitado. Espera un minuto.",
                guest_chat_limiter.window,
            )
    elif not asistente_limiter.allow(f"asistente_chat:{user.id}"):
        raise too_many_requests(
            "Demasiadas preguntas al asistente. Espera un minuto.",
            asistente_limiter.window,
        )
    norm = _norm(mensaje)
    es_orden = _es_orden_creacion(norm)
    # C-2: "cámbiala a las 11" también es una orden de mutación
    # (cambiar la hora de la cita referida): el replay idempotente
    # la cubre igual que las 4 creaciones.
    es_cambio = _detectar_referencia(norm)[1] == "cambiar_hora"
    # F2-7: idempotencia de reintento (ver core/idempotency.py: el
    # mecanismo EXISTE y encaja sin cambio de esquema — tabla
    # idempotency_keys con (user_id, route, key) — así que se aplica
    # a las 4 mutaciones del chat: nota/tarea/borrador/cita). Solo si
    # el cliente manda Idempotency-Key y solo para órdenes de
    # creación; las lecturas y las preguntas nunca se cachean así.
    # El frontend advierte antes de reenviar (A1); el backend
    # devuelve la respuesta guardada sin re-ejecutar la mutación.
    idem_key = idempotency_key_from(request)
    idem_route = "asistente_chat"
    if idem_key and (es_orden or es_cambio) and not isinstance(principal, Guest):
        replay = check_idempotency(db, idem_key, user, idem_route)
        if replay is not None:
            _status, stored = replay
            return {**stored, "idempotent_replay": True}
    # Fase 6, tarea 1: límite diario por plan (solo usuarios con
    # fila; el invitado no se cuenta: su tope es el limiter por
    # minuto). Después del replay idempotente (un reintento no es un
    # mensaje nuevo) y antes de despachar: cada mensaje aceptado
    # cuenta, responda lo que responda (incluidos "no sé", consejo
    # personalizado y solo-lectura); el 429 por límite no se cuenta.
    if not isinstance(principal, Guest):
        _verificar_limite(db, user)
        # Fase 8 mejoras-v1, tarea 3: el mensaje quedó aceptado (el
        # replay idempotente y el 429 ya pasaron por encima): registra
        # "primera_herramienta" (solo la primera vez) y "uso_semanal"
        # (una vez por semana ISO). Nunca se guarda la pregunta.
        from app.core import analitica

        analitica.registrar_uso_asistente(db, user.id)
    # (0) Pregunta de ayuda "¿cómo...?": ANTES que prohibidos, para
    # que "¿cómo cambio mi clave?" reciba los pasos (test 2026-11-23)
    # y la ORDEN imperativa ("cambia mi clave a X") caiga en el
    # bloqueo como antes.
    ayuda_pregunta = _buscar_ayuda(norm)
    if ayuda_pregunta is not None and ("?" in mensaje or norm.startswith("como ")):
        return _completar(_h_ayuda_tema(ayuda_pregunta), confianza=80)
    # (a0) Prohibido ANTES que las reglas enseñadas (F2-4): una
    # regla enseñada nunca puede reabrir lo prohibido.
    if _contiene_prohibido(norm):
        return _completar(
            _respuesta(_RESPUESTA_PROHIBIDO, sugerencias=_SUGERENCIAS_LECTURA),
            confianza=95)
    # (a0.5) Fase 6, tarea 4: consejo financiero personalizado,
    # ANTES que las reglas enseñadas (una regla nunca puede reabrirlo).
    if _es_consejo_personalizado(norm):
        return _completar(_h_consejo_personalizado(), confianza=95)
    # (a) Reglas enseñadas por el admin (caché de activas, F2-10).
    regla = _regla_activa(db, norm)
    if regla is not None:
        # M6 (QA 2026-11-26): la regla sigue ganando (el test
        # test_regla_ensenada_precede_a_intencion_interna lo exige),
        # pero si responde sobre un dato (precio, señales, análisis,
        # facturas, planes) lleva la marca "respuesta enseñada, no
        # dato en vivo" para no pasar por un dato real.
        texto_regla = regla.respuesta
        datos_regla = {"regla_id": regla.id, "modulo": regla.modulo,
                       "ruta": regla.ruta}
        if _cubre_intencion_datos(norm):
            texto_regla += ("\n\nNota: respuesta enseñada por el "
                            "administrador, no un dato en vivo.")
            datos_regla["respuesta_ensenada_no_dato_vivo"] = True
        return _respuesta(
            texto_regla,
            tipo="regla",
            datos=datos_regla,
            fuente={"nombre": "Regla enseñada por el administrador",
                    "url": regla.ruta or ""},
            sugerencias=_SUGERENCIAS_LECTURA,
            confianza=min(95, 60 + len(regla.patron) // 2),
        )
    # (a1) Planes de suscripción (C2): ANTES que el ranking, para
    # que "¿cuánto vale el plan Esencial?" no caiga en la intención
    # `precio` (BTC). Después de las reglas (M6: una regla sobre
    # planes sigue ganando, pero marcada).
    if _es_pregunta_planes(norm):
        return _completar(_h_planes(db, user, norm), confianza=85)
    # (a2) Referencias al último objeto creado (C-2): el historial
    # de la petición resuelve "esa cita" / "cámbiala a las 11". Si
    # no hay referencia, sigue el flujo normal.
    historial = [
        {"rol": t.rol, "texto": t.texto}
        for t in (payload.historial or [])
    ]
    resp_ref = _h_referencia(db, user, mensaje, norm, historial)
    if resp_ref is not None:
        resp_ref = _completar(resp_ref, confianza=80)
        if (idem_key and es_cambio and not isinstance(principal, Guest)
                and resp_ref.get("accion") is not None
                and resp_ref["accion"].get("tipo") == "cambiar_cita"
                and resp_ref["accion"].get("datos", {}).get("id") is not None):
            try:
                store_idempotency(db, idem_key, user, idem_route, 200, resp_ref)
            except Exception:
                pass
        return resp_ref
    # (b0) Resumir módulo (F2-3): antes que el ranking, para que
    # "resume el módulo Facturas" resuma y no devuelva el resumen
    # de facturación.
    modulo_clave = _detectar_resumen_modulo(norm)
    if modulo_clave is not None:
        return _completar(_h_resumen_modulo(db, modulo_clave, principal), confianza=75)
    # (b) Intenciones internas por ranking (F2-1).
    mejor = _mejor_intencion(norm, es_orden)
    if mejor is not None:
        # Corrección QA F3-07/F4-05: palabra desnuda ambigua -> se
        # pregunta con opciones (tipo="aclaracion") en vez de
        # responder por ranking con confianza baja. No es un fallo
        # (sin_respuesta=False) ni va a la bandeja: la pregunta queda
        # pendiente de la elección del usuario, como la aclaración
        # de citas. La confianza es la del match (baja, y por eso
        # se pregunta).
        acl_ambigua = _aclaracion_ambigua(norm, mejor)
        if acl_ambigua is not None:
            return _completar(_respuesta(
                acl_ambigua["pregunta"], tipo="aclaracion",
                aclaracion=acl_ambigua,
                sugerencias=_SUGERENCIAS_LECTURA), confianza=mejor[1])
        resp = _despachar_intencion(mejor[0], db, user, mensaje, norm)
        if resp is not None:
            resp = _completar(resp, confianza=mejor[1])
            if (idem_key and es_orden and not isinstance(principal, Guest)
                    and resp.get("accion") is not None
                    and resp["accion"].get("tipo") in
                    ("crear_nota", "crear_tarea", "crear_borrador", "crear_cita")
                    and resp["accion"].get("datos", {}).get("id") is not None):
                try:
                    store_idempotency(db, idem_key, user, idem_route, 200, resp)
                except Exception:
                    pass
            return resp
    # (d) Biblioteca de Estudiar (F4-1): después de AYUDAS y antes
    # de Internet; intención separada de `clases`. Las preguntas de
    # "cómo..." no van a la biblioteca: son ayuda o "sin respuesta"
    # (p. ej. "¿Cómo crea contenido el equipo?" no es una búsqueda
    # de un recurso, y antes caía en la bandeja).
    buscar_bib = not norm.lstrip("¿?¡! ").startswith("como ")
    bib = _buscar_biblioteca(db, norm) if buscar_bib else []
    # Corrección QA F4-07: un recurso concreto inexistente ("el
    # manual de cocina") no se responde con otros manuales: se
    # declara la ausencia con motivo "biblioteca_sin_resultado".
    # La comprobación va ANTES de devolver `bib`, porque `bib`
    # trae resultados justo por la palabra genérica ("manual") y
    # son esos resultados los engañosos. La exclusión de "cómo..."
    # se respeta igual que en la búsqueda.
    if buscar_bib and _biblioteca_calificador_sin_resultado(db, norm):
        _registrar_pregunta_para(principal, db, mensaje.strip())
        return _completar(_h_biblioteca_sin_resultado(mensaje.strip()),
                          confianza=0)
    if bib:
        return _completar(_h_biblioteca(bib), confianza=min(90, 50 + bib[0][0]))
    # (e) Internet como fallback: solo la pregunta genérica, nunca
    # datos de la plataforma (ver app/internet.py). Antes de viajar,
    # la vía rápida: saludos y sinsentidos caen a la bandeja sin
    # esperar al presupuesto de Internet.
    if _sin_respuesta_rapida(norm):
        _registrar_pregunta_para(principal, db, mensaje.strip())
        return _completar(_h_sin_respuesta(motivo="via_rapida"), confianza=0)
    # M2 (QA 2026-11-26): preguntas con patrones de PII (correo,
    # teléfono) NO se envían a internet. No van a la bandeja
    # (guardarlas sería almacenar PII) y la respuesta lo dice.
    if _contiene_pii(mensaje):
        return _completar(_respuesta(
            "No puedo enviar esa pregunta a internet porque parece "
            "contener datos personales (un correo o un teléfono). "
            "Reformúlala sin datos personales, o pregúntame por datos "
            "de la plataforma. Tu pregunta no quedó registrada.",
            sin_respuesta=True, motivo="pii_en_pregunta",
            sugerencias=_SUGERENCIAS_LECTURA), confianza=0)
    hallazgo = buscar_en_internet(mensaje.strip())
    if hallazgo is not None:
        consultado = dt.datetime.now(dt.timezone.utc).isoformat()
        fuente = {"nombre": hallazgo["nombre"], "url": hallazgo["url"]}
        # F3-4: corte en punto final + línea de vigencia (la fuente
        # no indica fecha del dato, y no se finge que la tenga).
        texto = _cortar_en_punto_final(hallazgo["texto"])
        fecha_hoy = dt.datetime.now(TZ_LA).strftime("%d/%m/%Y")
        publicado_en = hallazgo.get("publicado_en")
        if publicado_en:
            vigencia = (f"Consultado el {fecha_hoy}; publicado el "
                        f"{publicado_en[:10]}.")
        else:
            vigencia = (f"Consultado el {fecha_hoy}; la fuente no "
                        "indica fecha del dato.")
        texto = texto + "\n\n" + vigencia
        # M2: origen degradado — "Página pública" tiene menos
        # confianza que Wikipedia y lleva la etiqueta "fuente no
        # verificada"; los resultados de búsqueda y el RSS, intermedia.
        confianza = 60
        if hallazgo["nombre"] == "Página pública":
            confianza = 40
            texto += ("\n(Fuente no verificada: es una página pública "
                      "sin contrastar con otra fuente.)")
        elif hallazgo["nombre"] == "DuckDuckGo (resultados)":
            confianza = 50
        elif hallazgo["nombre"] == "Google News (RSS)":
            confianza = 55
        datos = {"fuente": fuente, "consultado_en": consultado,
                 "vigencia": vigencia}
        if publicado_en:
            datos["publicado_en"] = publicado_en
        return _respuesta(
            texto,
            tipo="internet",
            datos=datos,
            fuente=fuente,
            consultado_en=consultado,
            sugerencias=_SUGERENCIAS_LECTURA,
            confianza=confianza,
        )
    # F3-4: desambiguación con opciones en vez de "sin respuesta"
    # cuando la pregunta ofrece dos alternativas ("¿A o B?").
    acl = _aclaracion_alternativas(norm)
    if acl is not None:
        _registrar_pregunta_para(principal, db, mensaje.strip())
        return _respuesta(
            "No estoy seguro de a qué te refieres: elige una opción.",
            aclaracion=acl,
            sin_respuesta=True,
            motivo="internet_sin_resultado",
            sugerencias=_SUGERENCIAS_LECTURA,
            confianza=0,
        )
    # Sin fuente: respuesta clara + registro en la bandeja para que
    # el admin la enseñe. No se inventa nada. (Invitado: solo conteo,
    # sin fila en la bandeja — ver _registrar_pregunta_para.)
    _registrar_pregunta_para(principal, db, mensaje.strip())
    return _completar(_h_sin_respuesta(motivo="internet_sin_resultado"), confianza=0)


# ------------------------------------------------- bandeja y reglas (solo admin) --

def _pregunta_out(p: PreguntaSinRespuesta) -> dict:
    return {
        "id": p.id,
        "pregunta": p.pregunta,
        "veces": p.veces,
        "primera_vez": _iso(p.primera_vez),
        "ultima_vez": _iso(p.ultima_vez),
        "estado": p.estado,
    }


def _regla_out(r: ReglaAsistente) -> dict:
    return {
        "id": r.id,
        "patron": r.patron,
        "respuesta": r.respuesta,
        "modulo": r.modulo,
        "ruta": r.ruta,
        "activo": r.activo,
        "creado_por": r.creado_por,
        "creado_en": _iso(r.creado_en),
    }


class ReglaIn(BaseModel):
    # F2-4: tope de respuesta 2000 caracteres.
    respuesta: str = Field("", max_length=2000)
    # B4 (QA 2026-11-26): mismo tope que las columnas (String(64) y
    # String(128)): sin esto, en Postgres un valor largo daba 500
    # en vez de 422.
    modulo: str | None = Field(default=None, max_length=64)
    ruta: str | None = Field(default=None, max_length=128)


@router.get("/preguntas")
def listar_preguntas(
    estado: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Bandeja "Preguntas por enseñar" (solo admin). F2-10: paginada
    (antes .all() sin límite)."""
    q = db.query(PreguntaSinRespuesta)
    if estado:
        q = q.filter(PreguntaSinRespuesta.estado == estado)
    rows = (
        q.order_by(PreguntaSinRespuesta.veces.desc(),
                   PreguntaSinRespuesta.ultima_vez.desc())
        .offset(offset).limit(limit).all()
    )
    return [_pregunta_out(p) for p in rows]


@router.post("/preguntas/{pregunta_id}/regla", status_code=status.HTTP_201_CREATED)
def crear_regla_desde_pregunta(
    pregunta_id: int,
    payload: ReglaIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """El admin enseña la respuesta a una pregunta de la bandeja: se
    crea la regla (patrón = la pregunta) y la pregunta queda resuelta.
    Nada se auto-escribe: solo este endpoint crea reglas."""
    pregunta = db.get(PreguntaSinRespuesta, pregunta_id)
    if pregunta is None:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    if not (payload.respuesta or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La respuesta no puede estar vacía.",
        )
    # F2-4: una regla enseñada no puede contener nada prohibido (ni
    # en el patrón — la pregunta — ni en la respuesta): 422.
    if _contiene_prohibido(_norm(pregunta.pregunta + " " + payload.respuesta)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La regla contiene contenido prohibido (usuarios, claves, roles, secretos, exchange, pagos u órdenes reales).",
        )
    regla = ReglaAsistente(
        patron=pregunta.pregunta,
        respuesta=payload.respuesta.strip(),
        modulo=(payload.modulo or "").strip() or None,
        ruta=(payload.ruta or "").strip() or None,
        activo=True,
        creado_por=admin.username,
    )
    db.add(regla)
    pregunta.estado = "resuelta"
    db.commit()
    db.refresh(regla)
    invalidar_cache_reglas()
    audit(db, admin, "asistente.crear_regla", "regla_asistente",
          str(regla.id), details={"pregunta_id": pregunta.id})
    return _regla_out(regla)


@router.delete("/preguntas/{pregunta_id}")
def descartar_pregunta(
    pregunta_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Descarta una pregunta de la bandeja (marca descartada, no se
    borra el registro)."""
    pregunta = db.get(PreguntaSinRespuesta, pregunta_id)
    if pregunta is None:
        raise HTTPException(status_code=404, detail="Pregunta no encontrada")
    pregunta.estado = "descartada"
    db.commit()
    audit(db, admin, "asistente.descartar_pregunta",
          "pregunta_sin_respuesta", str(pregunta.id), details={})
    return _pregunta_out(pregunta)


@router.get("/reglas")
def listar_reglas(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reglas enseñadas (solo admin), las activas primero. F2-10:
    paginada (antes .all() sin límite)."""
    rows = (
        db.query(ReglaAsistente)
        .order_by(ReglaAsistente.activo.desc(), ReglaAsistente.id.desc())
        .offset(offset).limit(limit).all()
    )
    return [_regla_out(r) for r in rows]


@router.delete("/reglas/{regla_id}")
def desactivar_regla(
    regla_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Desactiva una regla (no se borra: queda el historial)."""
    regla = db.get(ReglaAsistente, regla_id)
    if regla is None:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    regla.activo = False
    db.commit()
    invalidar_cache_reglas()
    audit(db, admin, "asistente.desactivar_regla", "regla_asistente",
          str(regla.id), details={})
    return _regla_out(regla)
