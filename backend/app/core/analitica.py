"""Analítica de eventos (Fase 8 mejoras-v1, tarea 3).

Sin servicio externo, sin cookies de terceros. Solo se guardan el tipo
de evento y referencias (plan, semana ISO); nunca contenido privado:
ni preguntas del chat, ni datos de negocio, ni cuerpos de mensajes.
La tabla nace vacía: no se inventan eventos pasados ni datos
históricos.

Eventos canónicos:
- "registro": al crear la cuenta (registro público). Una vez por usuario.
- "primera_herramienta": primer uso del Asistente por usuario. Una vez
  por usuario (el Asistente es la herramienta registrada hoy; otras
  herramientas pueden llamar a registrar_evento con su propio tipo
  cuando se instrumenten).
- "uso_semanal": un evento por usuario y semana ISO, agregado (no por
  mensaje). Referencia "2026-W48".
- "paso_a_pago": cuando el admin activa una suscripción de pago o
  inicia una prueba (POST /api/suscripciones/admin con estado
  "activa" o "prueba_activa"). Referencia = clave del plan. Una vez
  por usuario y plan (una reactivación del mismo plan no duplica el
  conteo; un cambio de plan sí genera un evento nuevo).
"""

import datetime as dt

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.tables import EventoAnalitica, utcnow

TIPO_REGISTRO = "registro"
TIPO_PRIMERA_HERRAMIENTA = "primera_herramienta"
TIPO_USO_SEMANAL = "uso_semanal"
TIPO_PASO_A_PAGO = "paso_a_pago"

TIPOS_EVENTO = frozenset(
    {
        TIPO_REGISTRO,
        TIPO_PRIMERA_HERRAMIENTA,
        TIPO_USO_SEMANAL,
        TIPO_PASO_A_PAGO,
    }
)


def semana_iso(fecha: dt.date | None = None) -> str:
    """Semana ISO como "2026-W48" (año ISO + número de semana)."""
    fecha = fecha or utcnow().date()
    iso = fecha.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def registrar_evento(
    db: Session, tipo: str, user_id: int | None, referencia: str = ""
) -> bool:
    """Registra el evento si aún no existe (tipo, user_id, referencia).

    Devuelve True si se creó una fila nueva, False si ya existía (el
    evento no se duplica). Hace commit propio: los llamadores (registro,
    chat, activación) ya usan commits puntuales (audit, cupo diario).
    Ante una carrera (dos peticiones a la vez) la UNIQUE de la BD gana
    y se devuelve False sin romper la petición.
    """
    if tipo not in TIPOS_EVENTO:
        raise ValueError(f"tipo de evento desconocido: {tipo}")
    existente = (
        db.query(EventoAnalitica)
        .filter(
            EventoAnalitica.tipo == tipo,
            EventoAnalitica.user_id == user_id,
            EventoAnalitica.referencia == referencia,
        )
        .first()
    )
    if existente is not None:
        return False
    db.add(
        EventoAnalitica(tipo=tipo, user_id=user_id, referencia=referencia)
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def registrar_uso_asistente(db: Session, user_id: int) -> None:
    """Marca el uso del Asistente de un usuario autenticado.

    Registra "primera_herramienta" (solo la primera vez) y
    "uso_semanal" (una vez por semana ISO). Se llama después de que el
    límite diario acepta el mensaje, así que un reintento idempotente
    o un 429 por límite no cuentan como uso.
    """
    registrar_evento(db, TIPO_PRIMERA_HERRAMIENTA, user_id)
    registrar_evento(db, TIPO_USO_SEMANAL, user_id, semana_iso())


def resumen(
    db: Session,
    desde: dt.date | None = None,
    hasta: dt.date | None = None,
) -> dict:
    """Resumen agregado por tipo de evento en un periodo.

    Solo conteos (eventos y usuarios únicos por tipo); nunca lista
    usuarios ni eventos individuales. `desde`/`hasta` son fechas
    inclusivas; sin ellas, todo el historial.
    """
    query = db.query(EventoAnalitica)
    if desde is not None:
        query = query.filter(
            func.date(EventoAnalitica.creado_en) >= desde.isoformat()
        )
    if hasta is not None:
        query = query.filter(
            func.date(EventoAnalitica.creado_en) <= hasta.isoformat()
        )
    conteos = dict(
        query.with_entities(EventoAnalitica.tipo, func.count())
        .group_by(EventoAnalitica.tipo)
        .all()
    )
    usuarios = dict(
        query.with_entities(
            EventoAnalitica.tipo, func.count(func.distinct(EventoAnalitica.user_id))
        )
        .group_by(EventoAnalitica.tipo)
        .all()
    )
    return {
        "desde": desde.isoformat() if desde else None,
        "hasta": hasta.isoformat() if hasta else None,
        "conteos": {tipo: conteos.get(tipo, 0) for tipo in sorted(TIPOS_EVENTO)},
        "usuarios_unicos": {
            tipo: usuarios.get(tipo, 0) for tipo in sorted(TIPOS_EVENTO)
        },
    }
