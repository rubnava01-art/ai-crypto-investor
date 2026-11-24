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
    Course,
    EduClass,
    HomePost,
    Invoice,
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
                  "las clases grabadas y en vivo, los vídeos y las 5 "
                  "herramientas (calculadora de interés compuesto, "
                  "conversor BTC/USD, gráfica, indicadores y BTC). La "
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
                  "(#herramienta-indicadores) y BTC "
                  "(#herramienta-bitcoin)."),
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

def _h_precio(db: Session, norm: str) -> dict:
    # F3-2: la edad del caché se mira antes de presentar el precio.
    # Caché fresca (<=300 s): precio actual. Caché vieja: se cae a
    # las velas guardadas CON su fecha; si tampoco hay velas, el
    # precio viejo se presenta solo como viejo (con su antigüedad en
    # minutos y su fecha de actualización), nunca como actual.
    datos: dict = {"btc_usd": None, "eth_usd": None, "disponible": False, "fuente": "sin_datos"}
    cached = (market_api._PRICES_CACHE or {}).get("payload")
    edad_s = None
    actualizado_en = None
    if cached and cached.get("prices"):
        edad_s = time.monotonic() - float((market_api._PRICES_CACHE or {}).get("at") or 0.0)
        actualizado_en = cached.get("updated_utc")
        if edad_s <= 300:
            for coin in cached["prices"]:
                if coin.get("symbol") == "BTC":
                    datos["btc_usd"] = coin.get("price_usd")
                elif coin.get("symbol") == "ETH":
                    datos["eth_usd"] = coin.get("price_usd")
            if datos["btc_usd"] is not None or datos["eth_usd"] is not None:
                datos["fuente"] = "cache_mercado"
    if datos["fuente"] == "sin_datos":
        # Sin caché fresca: último cierre guardado en velas (datos
        # reales de la plataforma) con la fecha de la vela. Nunca se
        # pega al exchange desde el chat.
        fecha_vela = None
        for symbol, key in (("BTC/USD", "btc_usd"), ("ETH/USD", "eth_usd")):
            velas = ingest.latest_candles(db, symbol, "1h", 1)
            if velas:
                datos[key] = float(velas[-1].close)
                fecha_vela = _iso(velas[-1].open_time_utc)
        if datos["btc_usd"] is not None or datos["eth_usd"] is not None:
            datos["fuente"] = "velas_guardadas"
            datos["fecha_vela"] = fecha_vela
    datos["disponible"] = datos["btc_usd"] is not None or datos["eth_usd"] is not None
    if not datos["disponible"]:
        if cached and cached.get("prices") and edad_s is not None:
            # Último recurso: el precio viejo, etiquetado como viejo.
            for coin in cached["prices"]:
                if coin.get("symbol") == "BTC":
                    datos["btc_usd"] = coin.get("price_usd")
                elif coin.get("symbol") == "ETH":
                    datos["eth_usd"] = coin.get("price_usd")
            datos["fuente"] = "cache_mercado_vieja"
            datos["cache_edad_s"] = round(edad_s)
            datos["actualizado_en"] = actualizado_en
            datos["disponible"] = datos["btc_usd"] is not None or datos["eth_usd"] is not None
            if datos["disponible"]:
                minutos = int(edad_s // 60)
                return _respuesta(
                    "Este precio NO es actual: la caché de mercado tiene "
                    f"{minutos} minuto(s) de antigüedad "
                    f"(actualizada: {actualizado_en or 'sin fecha'}) y no "
                    "hay velas guardadas más recientes.\n"
                    f"- Bitcoin (BTC): {_money(datos['btc_usd'])}\n"
                    f"- Ethereum (ETH): {_money(datos['eth_usd'])}",
                    tipo="precio_btc", datos=datos,
                    fuente={"nombre": "Caché de mercado (desactualizada)", "url": None},
                    sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
                )
        return _respuesta(
            "Ahora mismo no tengo un precio real disponible: no hay caché "
            "de mercado ni velas guardadas para BTC/ETH. Pídele al "
            "administrador que active el escáner de mercado y vuelve a "
            "preguntarme. No voy a inventar un precio.",
            tipo="precio_btc", datos=datos,
            fuente={"nombre": "Caché de mercado", "url": None},
        )
    if datos["fuente"] == "velas_guardadas":
        fecha = datos.get("fecha_vela") or "sin fecha"
        return _respuesta(
            "Precios reales de la plataforma (última vela guardada, "
            f"no precio en vivo; vela del {fecha}):\n"
            f"- Bitcoin (BTC): {_money(datos['btc_usd'])}\n"
            f"- Ethereum (ETH): {_money(datos['eth_usd'])}",
            tipo="precio_btc", datos=datos,
            fuente={"nombre": "Velas guardadas", "url": None},
            sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
        )
    return _respuesta(
        "Precios reales de la plataforma (caché de mercado, actual):\n"
        f"- Bitcoin (BTC): {_money(datos['btc_usd'])}\n"
        f"- Ethereum (ETH): {_money(datos['eth_usd'])}",
        tipo="precio_btc", datos=datos,
        fuente={"nombre": "Caché de mercado", "url": None},
        sugerencias=["Analiza el mercado", "Muéstrame las últimas señales", "¿Qué hay nuevo?"],
    )


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
        "Últimas señales reales:\n" + "\n".join(lineas),
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


def _h_clases(db: Session) -> dict:
    rows = db.query(EduClass).order_by(EduClass.id.desc()).limit(10).all()
    if not rows:
        return _respuesta("No hay clases registradas en Estudiar.",
                           tipo="clases", datos={"clases": []},
                           fuente={"nombre": "Clases de Estudiar", "url": None})
    datos = [{"id": c.id, "kind": c.kind, "title": c.title,
              "scheduled_at": _iso(c.scheduled_at)} for c in rows]
    lineas = [f"- {c.title} ({c.kind})" + (f" — {_iso(c.scheduled_at)}" if c.scheduled_at else "")
              for c in rows]
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
    datos = [{"id": p.id, "title": p.title, "created_at": _iso(p.created_at)} for p in rows]
    lineas = [f"- {p.title}" + (f" ({_iso(p.created_at)[:10]})" if p.created_at else "") for p in rows]
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


def _h_sin_respuesta(motivo: str | None = None) -> dict:
    """Respuesta estándar cuando nada respondió (va a la bandeja).

    F3-5: `motivo` dice por qué no hubo respuesta: "via_rapida"
    (saludo/sinsentido, sin viajar a Internet),
    "internet_sin_resultado" (Internet no devolvió nada útil) o
    "biblioteca_sin_resultado" (se buscó en Estudiar y no había nada)."""
    return _respuesta(
        "No encontré información sobre eso. Puedo consultar precios, "
        "señales y análisis del mercado, listar clases y novedades, y "
        "(si eres admin) crear notas, tareas, borradores y citas. Tu "
        "pregunta quedó registrada para que el administrador le enseñe "
        "una respuesta al asistente.",
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


def _h_resumen_modulo(db: Session, clave: str) -> dict:
    label, hint, ruta = MODULOS_RESUMEN[clave]
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
# F4-2: constante estática de las 5 herramientas de Clases con sus
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
]


def _indice_biblioteca(db: Session) -> list[dict]:
    """Índice en memoria de la biblioteca (F4-1): Course + EduClass +
    VideoEducativo + las 5 herramientas. Sin tabla nueva: se
    construye por petición desde las 3 consultas ya existentes.
    Campos: id/titulo/tipo/descripcion/enlace/palabras_clave/
    precio_usd/modulo/ruta. F4-4: solo la guía gratuita ($0) enlaza
    descarga directa; los cursos de pago enlazan a su ficha/compra
    (buy_url), NUNCA al PDF por chat."""
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
    fueran la respuesta."""
    return _respuesta(
        "No encontré ese recurso en la biblioteca: sin resultados en "
        f"la biblioteca para «{mensaje}». Prueba con otro título o "
        "pregunta «¿Qué manuales hay?» para ver los disponibles.",
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

class ChatIn(BaseModel):
    # Transversal 2026-11-24: tope Pydantic (antes solo comprobación
    # manual en el handler, que devolvía 400; ahora 422).
    mensaje: str = Field("", max_length=MAX_MENSAJE)


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
    if idem_key and es_orden and not isinstance(principal, Guest):
        replay = check_idempotency(db, idem_key, user, idem_route)
        if replay is not None:
            _status, stored = replay
            return {**stored, "idempotent_replay": True}
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
    # (a) Reglas enseñadas por el admin (caché de activas, F2-10).
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
            confianza=min(95, 60 + len(regla.patron) // 2),
        )
    # (b0) Resumir módulo (F2-3): antes que el ranking, para que
    # "resume el módulo Facturas" resuma y no devuelva el resumen
    # de facturación.
    modulo_clave = _detectar_resumen_modulo(norm)
    if modulo_clave is not None:
        return _completar(_h_resumen_modulo(db, modulo_clave), confianza=75)
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
    hallazgo = buscar_en_internet(mensaje.strip())
    if hallazgo is not None:
        consultado = dt.datetime.now(dt.timezone.utc).isoformat()
        fuente = {"nombre": hallazgo["nombre"], "url": hallazgo["url"]}
        # F3-4: corte en punto final + línea de vigencia (la fuente
        # no indica fecha del dato, y no se finge que la tenga).
        texto = _cortar_en_punto_final(hallazgo["texto"])
        fecha_hoy = dt.datetime.now(TZ_LA).strftime("%d/%m/%Y")
        texto = (texto + "\n\nConsultado el " + fecha_hoy +
                 "; la fuente no indica fecha del dato.")
        return _respuesta(
            texto,
            tipo="internet",
            datos={"fuente": fuente, "consultado_en": consultado,
                   "vigencia": f"Consultado el {fecha_hoy}; la fuente no indica fecha del dato."},
            fuente=fuente,
            consultado_en=consultado,
            sugerencias=_SUGERENCIAS_LECTURA,
            confianza=60,
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
    modulo: str | None = None
    ruta: str | None = None


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
