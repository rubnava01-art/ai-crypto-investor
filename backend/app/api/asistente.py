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
import unicodedata
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import market as market_api
from app.api.backtest import RUNS_DIR
from app.api.bi import _invoice_total
from app.api.marketing import _overlaps
from app.api.portal import deny_linked_reader
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
    require_admin,
)
from app.data import ingest
from app.database import get_db
from app.indicators import technical as ind
from app.internet import buscar_en_internet
from app.models.tables import (
    Appointment,
    BusinessNote,
    BusinessTask,
    Contact,
    ContentItem,
    EduClass,
    HomePost,
    Invoice,
    PreguntaSinRespuesta,
    ReglaAsistente,
    Signal,
    User,
)

router = APIRouter(prefix="/api/asistente", tags=["asistente"])

MAX_MENSAJE = 1000

# B2 (corrida seguridad 2026-11-23): limiter por USUARIO en /chat
# (20/min, como ai_ask). Clave solo por usuario: sobrevive al proxy
# de Render, donde la IP colapsa (ver rate_limit.py).
asistente_limiter = RateLimiter(max_requests=20, window_seconds=60)

# ------------------------------------------------------------------ catálogo --

COMANDOS = [
    {
        "id": "precio_btc",
        "ejemplo": "¿Cuánto vale el bitcoin?",
        "descripcion": "Precio actual de BTC y ETH con datos reales de la plataforma.",
        "requiere_admin": False,
    },
    {
        "id": "senales",
        "ejemplo": "Muéstrame las últimas señales",
        "descripcion": "Resumen de las últimas señales reales registradas.",
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
        "id": "ayuda",
        "ejemplo": "¿Qué puedes hacer?",
        "descripcion": "Lista todo lo que el asistente puede hacer.",
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
    "renombrar",
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
    "usuarios",
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
    "desactiva el",
    "desactivar el",
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


def _respuesta(texto: str, tipo: str | None = None, datos: dict | None = None,
               sugerencias: list[str] | None = None,
               fuente: dict | None = None,
               consultado_en: str | None = None,
               sin_respuesta: bool = False) -> dict:
    accion = None if tipo is None else {"tipo": tipo, "datos": datos or {}}
    return {
        "respuesta": texto,
        "accion": accion,
        "sugerencias": sugerencias if sugerencias is not None else _SUGERENCIAS_LECTURA,
        # Corrida 2026-11-23: fuente de la respuesta (Internet o regla
        # enseñada) + cuándo se consultó; sin_respuesta=True solo
        # cuando nada respondió (la pregunta va a la bandeja).
        "fuente": fuente,
        "consultado_en": consultado_en,
        "sin_respuesta": sin_respuesta,
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
        sugerencias=["¿Qué puedes hacer?", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"],
    )


# ------------------------------------------------- reglas y bandeja (mejora propia) --

def _regla_activa(db: Session, norm: str):
    """Regla enseñada activa cuyo patrón (normalizado) aparece en el
    mensaje; ante varias, gana el patrón más largo (el más específico).
    Las reglas las crea solo el admin y se consultan ANTES que las
    intenciones internas."""
    reglas = (
        db.query(ReglaAsistente)
        .filter(ReglaAsistente.activo == True)  # noqa: E712
        .all()
    )
    mejor = None
    mejor_len = 0
    for regla in reglas:
        patron = _norm(regla.patron)
        if patron and patron in norm and len(patron) > mejor_len:
            mejor, mejor_len = regla, len(patron)
    return mejor


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


def _es_orden_creacion(norm: str) -> bool:
    """True solo si el mensaje es una orden explícita de creación:
    trae un verbo imperativo de creación y NO es una pregunta ni
    una consulta («¿dónde está…?», «¿tienes…?», «muéstrame…»,
    «lista…», «¿cómo crea…?»). Una pregunta cae en listado,
    búsqueda o fallback, nunca en un handler que muta."""
    if "?" in norm or norm.startswith("¿"):
        return False
    if any(f in norm for f in _CONSULTA_FRASES):
        return False
    if _RE_CONSULTA.search(norm):
        return False
    return any(v in norm for v in _VERBOS_CREACION)


# ------------------------------------------------------------------ intenciones --

def _h_precio(db: Session, norm: str) -> dict:
    datos: dict = {"btc_usd": None, "eth_usd": None, "disponible": False, "fuente": "sin_datos"}
    cached = (market_api._PRICES_CACHE or {}).get("payload")
    if cached and cached.get("prices"):
        for coin in cached["prices"]:
            if coin.get("symbol") == "BTC":
                datos["btc_usd"] = coin.get("price_usd")
            elif coin.get("symbol") == "ETH":
                datos["eth_usd"] = coin.get("price_usd")
        if datos["btc_usd"] is not None or datos["eth_usd"] is not None:
            datos["fuente"] = "cache_mercado"
    if datos["fuente"] == "sin_datos":
        # Sin caché: último cierre guardado en velas (datos reales de la
        # plataforma). Nunca se pega al exchange desde el chat: un
        # exchange caído no debe colgar la conversación.
        for symbol, key in (("BTC/USD", "btc_usd"), ("ETH/USD", "eth_usd")):
            velas = ingest.latest_candles(db, symbol, "1h", 1)
            if velas:
                datos[key] = float(velas[-1].close)
        if datos["btc_usd"] is not None or datos["eth_usd"] is not None:
            datos["fuente"] = "velas_guardadas"
    datos["disponible"] = datos["btc_usd"] is not None or datos["eth_usd"] is not None
    if not datos["disponible"]:
        return _respuesta(
            "Ahora mismo no tengo un precio real disponible: no hay caché "
            "de mercado ni velas guardadas para BTC/ETH. Pídele al "
            "administrador que active el escáner de mercado y vuelve a "
            "preguntarme. No voy a inventar un precio.",
            tipo="precio_btc", datos=datos,
        )
    fuente = "caché de mercado" if datos["fuente"] == "cache_mercado" else "última vela guardada"
    return _respuesta(
        f"Precios reales de la plataforma ({fuente}):\n"
        f"- Bitcoin (BTC): {_money(datos['btc_usd'])}\n"
        f"- Ethereum (ETH): {_money(datos['eth_usd'])}",
        tipo="precio_btc", datos=datos,
        sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
    )


def _h_senales(db: Session) -> dict:
    rows = db.query(Signal).order_by(Signal.created_at.desc()).limit(5).all()
    if not rows:
        return _respuesta(
            "No hay señales registradas en la plataforma.",
            tipo="senales", datos={"senales": []},
        )
    lineas = []
    datos = []
    for s in rows:
        lineas.append(f"- {s.symbol} — {str(s.side).upper()}: {s.reason or ''} (estado: {s.status})")
        datos.append({"id": s.id, "symbol": s.symbol, "side": s.side,
                      "reason": s.reason, "status": s.status})
    return _respuesta(
        "Últimas señales reales:\n" + "\n".join(lineas),
        tipo="senales", datos={"senales": datos},
        sugerencias=["Analiza el mercado", "¿Cuánto vale el bitcoin?", "¿Qué hay nuevo?"],
    )


def _ultimo_backtest() -> dict | None:
    """Titular real del último backtest guardado en disco, o None."""
    try:
        if not os.path.isdir(RUNS_DIR):
            return None
        files = sorted(f for f in os.listdir(RUNS_DIR) if f.endswith(".json"))
        if not files:
            return None
        with open(os.path.join(RUNS_DIR, files[-1]), encoding="utf-8") as f:
            payload = json.load(f)
        metrics = payload.get("metrics") or {}
        return {
            "run_id": payload.get("run_id"),
            "symbol": payload.get("symbol"),
            "timeframe": payload.get("timeframe"),
            "n_candles": payload.get("n_candles"),
            "net_return_pct": metrics.get("net_return_pct"),
        }
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
    backtest = datos["backtest"]
    if backtest:
        partes.append(
            f"Último backtest ({backtest.get('run_id')}): "
            f"{backtest.get('symbol')} {backtest.get('timeframe')}, "
            f"{backtest.get('n_candles')} velas, "
            f"rendimiento neto {backtest.get('net_return_pct')}%."
        )
    else:
        partes.append("No hay ningún backtest guardado todavía.")
    partes.append("Esto es un resumen de datos reales en modo simulación, no es consejo de inversión.")
    return _respuesta("\n".join(partes), tipo="analisis", datos=datos,
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
    tema = _extraer_despues(
        mensaje,
        (r"crea un borrador", r"crear un borrador", r"haz un borrador",
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
    titulo = tema[:200]
    ahora = dt.datetime.now(dt.timezone.utc)
    item = ContentItem(
        title=titulo,
        text=f"{tema}\n\n[Plantilla (reglas), no IA — borrador creado por el Asistente. Revisa y edita antes de programar.]",
        scheduled_at=ahora + dt.timedelta(days=1),
        platform="instagram",
        status="borrador",
        notes="source: plantilla",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # B2: auditoría de la mutación (sin el contenido del usuario).
    audit(db, user, "asistente.crear_borrador", "content_item", str(item.id),
          details={"source": "plantilla", "status": "borrador"})
    return _respuesta(
        f"Borrador creado en el Content Engine (id {item.id}): «{item.title}». "
        "Es una plantilla por reglas, no IA: revísalo antes de programarlo.",
        tipo="crear_borrador",
        datos={"id": item.id, "title": item.title, "source": "plantilla",
               "status": "borrador", "platform": "instagram",
               "scheduled_at": _iso(item.scheduled_at)},
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
                       sugerencias=["Crea una cita para un cliente mañana a las 10:00", "Muéstrame los contactos", "¿Qué hay nuevo?"])


def _parse_cita(mensaje_norm: str) -> tuple[dt.datetime | None, str, str]:
    """Fecha/hora, cliente y servicio de «crea una cita para X mañana a
    las 10:00». Fecha por defecto: mañana. Sin fecha/hora explícita
    devuelve None para pedirla (nunca se inventa un horario)."""
    ahora = dt.datetime.now(dt.timezone.utc)
    fecha: dt.date | None = None
    if "pasado manana" in mensaje_norm:
        fecha = (ahora + dt.timedelta(days=2)).date()
    elif "manana" in mensaje_norm:
        fecha = (ahora + dt.timedelta(days=1)).date()
    elif "hoy" in mensaje_norm:
        fecha = ahora.date()
    else:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", mensaje_norm)
        if m:
            fecha = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        else:
            m = re.search(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", mensaje_norm)
            if m:
                fecha = dt.date(int(m.group(3) or ahora.year), int(m.group(2)), int(m.group(1)))
    hora: tuple[int, int] | None = None
    m = re.search(r"(\d{1,2}):(\d{2})", mensaje_norm)
    if m:
        hora = (int(m.group(1)), int(m.group(2)))
    else:
        m = re.search(r"a las (\d{1,2})\b", mensaje_norm)
        if m:
            hora = (int(m.group(1)), 0)
    cliente = ""
    m = re.search(r"para\s+([a-z0-9\- ]+?)(?:\s+(?:manana|pasado manana|hoy|el|a las|\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2})|$)", mensaje_norm)
    if m:
        cliente = m.group(1).strip().strip(",")
    starts_at = None
    if fecha is not None and hora is not None:
        try:
            starts_at = dt.datetime.combine(
                fecha, dt.time(hora[0], hora[1]), tzinfo=dt.timezone.utc)
        except ValueError:
            starts_at = None
    return starts_at, cliente, "consulta"


def _h_crear_cita(db: Session, user: User, mensaje: str, norm: str) -> dict:
    if not user.is_admin:
        return _solo_lectura(user)
    starts_at, cliente, servicio = _parse_cita(norm)
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
            f"solapa con {starts_at.isoformat()} (60 min). Elige otro horario.",
            tipo="crear_cita",
            datos={"conflicto": True, "contact_id": contact_id,
                   "starts_at": starts_at.isoformat()},
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
    return _respuesta(
        f"Cita creada (id {appt.id}): {client_name} — {servicio}, "
        f"{starts_at.isoformat()} (60 min, pendiente).",
        tipo="crear_cita",
        datos={"id": appt.id, "client_name": client_name, "service_type": servicio,
               "starts_at": starts_at.isoformat(), "duration_min": 60, "status": "pendiente"},
        sugerencias=["¿Qué citas tengo?", "Muéstrame los contactos", "¿Qué hay nuevo?"],
    )


def _h_facturas(db: Session, user: User) -> dict:
    # M1 (resuelto 2026-11-23): prueba no ve facturas reales por chat.
    if not user.is_admin:
        return _no_disponible_demo(user)
    facturas = db.query(Invoice).all()
    total_pagado = Decimal("0")
    total_enviado = Decimal("0")
    por_estado = {"borrador": 0, "enviada": 0, "pagada": 0}
    for inv in facturas:
        if inv.status in por_estado:
            por_estado[inv.status] += 1
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
        sugerencias=["Muéstrame los contactos", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_contactos(db: Session, user: User) -> dict:
    # M1 (resuelto 2026-11-23): prueba no ve contactos reales por chat.
    if not user.is_admin:
        return _no_disponible_demo(user)
    rows = db.query(Contact).order_by(Contact.id.desc()).limit(10).all()
    if not rows:
        return _respuesta("No hay contactos registrados en el CRM.",
                           tipo="contactos", datos={"contactos": []})
    datos = [{"id": c.id, "name": c.name, "status": c.status, "email": c.email or ""}
             for c in rows]
    lineas = [f"- {c.name} ({c.status})" + (f" — {c.email}" if c.email else "") for c in rows]
    return _respuesta(
        f"Contactos del CRM ({len(rows)} mostrados):\n" + "\n".join(lineas),
        tipo="contactos", datos={"contactos": datos},
        sugerencias=["¿Cuánto hemos vendido?", "¿Qué citas tengo?", "¿Qué hay nuevo?"],
    )


def _h_clases(db: Session) -> dict:
    rows = db.query(EduClass).order_by(EduClass.id.desc()).limit(10).all()
    if not rows:
        return _respuesta("No hay clases registradas en Estudiar.",
                           tipo="clases", datos={"clases": []})
    datos = [{"id": c.id, "kind": c.kind, "title": c.title,
              "scheduled_at": _iso(c.scheduled_at)} for c in rows]
    lineas = [f"- {c.title} ({c.kind})" + (f" — {_iso(c.scheduled_at)}" if c.scheduled_at else "")
              for c in rows]
    return _respuesta(f"Clases ({len(rows)} mostradas):\n" + "\n".join(lineas),
                       tipo="clases", datos={"clases": datos},
                       sugerencias=["¿Qué hay nuevo?", "Muéstrame los contactos", "¿Cuánto vale el bitcoin?"])


def _h_novedades(db: Session) -> dict:
    rows = db.query(HomePost).order_by(HomePost.created_at.desc()).limit(5).all()
    if not rows:
        return _respuesta("No hay novedades publicadas todavía en Inicio.",
                           tipo="novedades", datos={"novedades": []})
    datos = [{"id": p.id, "title": p.title, "created_at": _iso(p.created_at)} for p in rows]
    lineas = [f"- {p.title}" + (f" ({_iso(p.created_at)[:10]})" if p.created_at else "") for p in rows]
    return _respuesta("Últimas novedades:\n" + "\n".join(lineas),
                       tipo="novedades", datos={"novedades": datos},
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


def _h_sin_respuesta() -> dict:
    """Respuesta estándar cuando nada respondió (va a la bandeja)."""
    return _respuesta(
        "No encontré información sobre eso. Puedo consultar precios, "
        "señales y análisis del mercado, listar clases y novedades, y "
        "(si eres admin) crear notas, tareas, borradores y citas. Tu "
        "pregunta quedó registrada para que el administrador le enseñe "
        "una respuesta al asistente.",
        sin_respuesta=True,
        sugerencias=_SUGERENCIAS_LECTURA,
    )


# ------------------------------------------------------------------ endpoints --

class ChatIn(BaseModel):
    mensaje: str = ""


@router.get("/capacidades")
def capacidades(principal: Principal = Depends(guest_read_guard),
                db: Session = Depends(get_db)):
    # B1 (corrida seguridad 2026-11-23): cliente vinculado -> 403
    # (mismo patrón que crm.py:105). Solo bloquea a clientes
    # vinculados; el rol prueba sin vínculo no cambia (decisión M1
    # de Rubén, pendiente). El invitado pasa: deny_linked_reader
    # devuelve None para Guest (sin id, sin vínculo posible).
    deny_linked_reader(db, principal)
    return {"comandos": COMANDOS}


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
    if len(mensaje) > MAX_MENSAJE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"El mensaje no puede superar {MAX_MENSAJE} caracteres.")
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
    # Orden de resolución (corrida 2026-11-23):
    # (a) reglas enseñadas por el admin, (b) intenciones internas,
    # (c) catálogo de ayuda, (d) Internet como fallback. El catálogo
    # se consulta antes que el bloqueo de prohibidos para que una
    # PREGUNTA de ayuda («¿cómo cambio mi clave?») reciba los pasos;
    # la ORDEN imperativa («cambia mi clave a X») no casa con el
    # catálogo y cae en el bloqueo como antes.
    # (a) Reglas enseñadas (coincidencia de subcadena normalizada).
    regla = _regla_activa(db, norm)
    if regla is not None:
        return _respuesta(
            regla.respuesta,
            tipo="regla",
            datos={"regla_id": regla.id, "modulo": regla.modulo,
                   "ruta": regla.ruta},
            fuente={"nombre": "Regla enseñada por el administrador",
                    "url": regla.ruta or ""},
            sugerencias=_SUGERENCIAS_LECTURA,
        )
    # (b) Intenciones internas, en orden: las creaciones antes que
    # los listados (p. ej. "crea una cita" contiene "cita"). Cada
    # creación exige _es_orden_creacion: una pregunta o consulta
    # nunca muta (A1) y cae en el listado, la ayuda o el fallback.
    if any(k in norm for k in ("ayuda", "que puedes hacer", "comandos", "que sabes hacer")):
        return _h_ayuda()
    if _es_orden_creacion(norm) and any(k in norm for k in ("crea una cita", "agenda una cita", "crear una cita", "agendar una cita", "nueva cita")):
        return _h_crear_cita(db, user, mensaje, norm)
    # (c) Catálogo de ayuda: «¿cómo…?» y temas explícitos de ayuda.
    # Va antes que los listados de lectura: «¿cómo creo una
    # factura?» es ayuda, no un resumen de facturación, y «¿cómo
    # creo una cita?» es ayuda, no el listado de citas (chat-opt
    # 2026-11-23: antes caía en _h_listar_citas).
    ayuda = _buscar_ayuda(norm)
    if ayuda is not None:
        return _h_ayuda_tema(ayuda)
    if any(k in norm for k in ("cita", "citas", "agenda")):
        return _h_listar_citas(db, user)
    if _es_orden_creacion(norm) and any(k in norm for k in ("crea una nota", "crear una nota", "nueva nota", "anota")):
        return _h_crear_nota(db, user, mensaje)
    if _es_orden_creacion(norm) and any(k in norm for k in ("crea una tarea", "crear una tarea", "nueva tarea", "pendiente")):
        return _h_crear_tarea(db, user, mensaje)
    if _es_orden_creacion(norm) and any(k in norm for k in ("borrador", "contenido", "publicacion", "post")):
        return _h_crear_borrador(db, user, mensaje)
    # Prohibido, antes que cualquier intención de lectura: subcadenas
    # fijas y compra/venta de cripto con cantidad intermedia
    # ("compra 0.01 BTC").
    if any(p in norm for p in _PROHIBIDO) or re.search(
        r"\b(compra|comprar|vende|vender|invierte|invertir)\b.{0,30}\b(btc|bitcoin|eth|ethereum|cripto)",
        norm,
    ):
        return _respuesta(_RESPUESTA_PROHIBIDO, sugerencias=_SUGERENCIAS_LECTURA)
    if any(k in norm for k in ("precio", "cuanto vale", "cotizacion")):
        return _h_precio(db, norm)
    if "senal" in norm:
        return _h_senales(db)
    if any(k in norm for k in ("analisis", "analiza", "mercado", "tendencia")):
        return _h_analisis(db)
    if any(k in norm for k in ("factura", "venta", "vendid", "ingresos")):
        return _h_facturas(db, user)
    if any(k in norm for k in ("contacto", "clientes")):
        return _h_contactos(db, user)
    if any(k in norm for k in ("clase", "clases", "curso")):
        return _h_clases(db)
    if any(k in norm for k in ("novedad", "novedades", "que hay nuevo")):
        return _h_novedades(db)
    # Local primero (chat-opt 2026-11-23): "¿qué es el bitcoin?" tiene
    # respuesta local (precio real) y NO debe ir a Internet. El precio
    # ya casa con "cuanto vale/precio/cotizacion"; aquí cubre la
    # pregunta de definición sobre BTC/ETH.
    if re.search(r"\b(bitcoin|btc|ethereum|eth)\b", norm) and any(
        k in norm for k in ("que es", "que son", "que significa")
    ):
        return _h_precio(db, norm)
    # (d) Internet como fallback: solo la pregunta genérica, nunca
    # datos de la plataforma (ver app/internet.py). Antes de viajar,
    # la vía rápida: saludos y sinsentidos caen a la bandeja sin
    # esperar al presupuesto de Internet.
    if _sin_respuesta_rapida(norm):
        _registrar_pregunta_para(principal, db, mensaje.strip())
        return _h_sin_respuesta()
    hallazgo = buscar_en_internet(mensaje.strip())
    if hallazgo is not None:
        consultado = dt.datetime.now(dt.timezone.utc).isoformat()
        fuente = {"nombre": hallazgo["nombre"], "url": hallazgo["url"]}
        return _respuesta(
            hallazgo["texto"],
            tipo="internet",
            datos={"fuente": fuente, "consultado_en": consultado},
            fuente=fuente,
            consultado_en=consultado,
            sugerencias=_SUGERENCIAS_LECTURA,
        )
    # Sin fuente: respuesta clara + registro en la bandeja para que
    # el admin la enseñe. No se inventa nada. (Invitado: solo conteo,
    # sin fila en la bandeja — ver _registrar_pregunta_para.)
    _registrar_pregunta_para(principal, db, mensaje.strip())
    return _h_sin_respuesta()


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
    respuesta: str = ""
    modulo: str | None = None
    ruta: str | None = None


@router.get("/preguntas")
def listar_preguntas(
    estado: str | None = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Bandeja "Preguntas por enseñar" (solo admin)."""
    q = db.query(PreguntaSinRespuesta)
    if estado:
        q = q.filter(PreguntaSinRespuesta.estado == estado)
    rows = (
        q.order_by(PreguntaSinRespuesta.veces.desc(),
                   PreguntaSinRespuesta.ultima_vez.desc())
        .all()
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
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reglas enseñadas (solo admin), las activas primero."""
    rows = (
        db.query(ReglaAsistente)
        .order_by(ReglaAsistente.activo.desc(), ReglaAsistente.id.desc())
        .all()
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
    audit(db, admin, "asistente.desactivar_regla", "regla_asistente",
          str(regla.id), details={})
    return _regla_out(regla)
