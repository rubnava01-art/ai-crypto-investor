"""Suscripciones y pagos — Fase 7 mejoras-v1 (PREPARAR, NO ACTIVAR).

No hay pago en línea ni cobro real: la suscripción la crea el
administrador a mano (POST /api/suscripciones/admin) y el usuario
solo puede cancelar la suya (POST /api/suscripciones/mia/cancelar).
Ninguna llamada a pasarela real, ninguna clave: ver
app/pagos_proveedor.py (todo método real lanza "no configurado").

Reglas documentadas (decisiones de esta fase):
- Una suscripción por usuario (user_id único). Sin fila no hay
  suscripción: el usuario es prueba.
- Plan canónico: "esencial" | "crecimiento" | "negocio_total"
  ($19 / $49 / $99 al mes, 14 días de prueba gratis). El alias
  histórico "total" (User.requested_plan, elegido al registrarse)
  significa "negocio_total" y se normaliza al entrar.
- Estados: prueba_activa | activa | cancelada | vencida | en_pausa
  (ver el modelo Suscripcion). La cancelación NO borra datos y
  conserva el acceso hasta el fin del periodo pagado o de la
  prueba (acceso_hasta); pasado ese momento el acceso efectivo
  termina (estado efectivo "vencida") sin reescribir la fila.
- Aviso de fin de prueba: la lógica (pruebas_por_vencer) vive
  aquí; el ENVÍO está desacoplado como la verificación de correo
  de Fase 1 — no hay proveedor de correo configurado, así que el
  aviso queda encolado como PENDIENTE y no sale ningún correo.
  Dentro de la app el aviso es el banner de Mi perfil (prueba que
  vence en <= 3 días).
- El plan de la suscripción es la fuente del límite diario del
  Asistente (Fase 6): si hay suscripción con acceso, manda su plan;
  si hay fila de suscripción SIN acceso (en_pausa, vencida o fin de
  periodo pasado), el límite es "prueba" — User.requested_plan NO
  se usa en ese caso (corrección QA H2-1 Fase 7, 2026-11-25: el
  plan elegido al registrarse solo vale mientras no exista fila de
  suscripción); sin fila, manda User.requested_plan; sin plan,
  "prueba".
"""

import datetime as dt
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.hardening import audit
from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.models.tables import PendingActivation, Suscripcion, User
from app.pagos_proveedor import estado_proveedor

router = APIRouter(prefix="/api/suscripciones", tags=["suscripciones"])

# Precios reales únicos (no hay precios de pago único).
DIAS_PRUEBA = 14
DIAS_AVISO_PRUEBA = 3
DIAS_PERIODO_PAGO = 30

PLANES: dict[str, dict] = {
    "esencial": {"nombre": "Esencial", "precio_mensual_usd": 19},
    "crecimiento": {"nombre": "Crecimiento", "precio_mensual_usd": 49},
    "negocio_total": {"nombre": "Negocio Total", "precio_mensual_usd": 99},
}
_ALIAS_PLAN = {"total": "negocio_total"}
ESTADOS = ("prueba_activa", "activa", "cancelada", "vencida", "en_pausa")
ESTADOS_ADMIN = ("prueba_activa", "activa", "en_pausa", "vencida")

SIN_PROVEEDOR_CORREO = (
    "Sin proveedor de correo configurado: el aviso queda pendiente "
    "y no se envía ningún correo."
)


def normalizar_plan(valor: str | None) -> str:
    """Canónico de plan: acepta "total" como alias de
    "negocio_total" (histórico: requested_plan / tarjetas de plan).
    Rechaza cualquier otro valor con ValueError en español."""
    clave = (valor or "").strip().lower()
    clave = _ALIAS_PLAN.get(clave, clave)
    if clave not in PLANES:
        raise ValueError(
            "El plan debe ser uno de: esencial, crecimiento o negocio_total."
        )
    return clave


def plan_a_requested_plan(plan: str) -> str:
    """Clave histórica que guarda User.requested_plan ("total" en
    vez de "negocio_total"): se sincroniza al activar para que el
    fallback del Asistente y Control de usuarios sigan viendo el
    plan elegido."""
    return "total" if plan == "negocio_total" else plan


def plan_a_clave_asistente(plan: str) -> str:
    """Clave que usa el Asistente (LIMITES_MENSAJES_POR_DIA):
    "total" para Negocio Total."""
    return "total" if plan == "negocio_total" else plan


def _ahora() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _con_utc(valor: dt.datetime | None) -> dt.datetime | None:
    """SQLite (tests) devuelve los DateTime(timezone=True) SIN zona
    horaria; Postgres sí la devuelve. Normalizar al leer evita
    comparar aware con naive."""
    if valor is None:
        return None
    if valor.tzinfo is None:
        return valor.replace(tzinfo=dt.timezone.utc)
    return valor


def estado_efectivo(sub: Suscripcion, ahora: dt.datetime | None = None) -> str:
    """Estado con fecha: una prueba/activa con su fin pasado y una
    cancelada con acceso_hasta pasado se leen como "vencida" sin
    reescribir la fila (la fecha manda, no un cron)."""
    ahora = ahora or _ahora()
    prueba_fin = _con_utc(sub.prueba_fin)
    renovacion_en = _con_utc(sub.renovacion_en)
    acceso_hasta = _con_utc(sub.acceso_hasta)
    if sub.estado == "prueba_activa":
        if prueba_fin is not None and ahora > prueba_fin:
            return "vencida"
    elif sub.estado == "activa":
        if renovacion_en is not None and ahora > renovacion_en:
            return "vencida"
    elif sub.estado == "cancelada":
        if acceso_hasta is not None and ahora > acceso_hasta:
            return "vencida"
    return sub.estado


def tiene_acceso(sub: Suscripcion, ahora: dt.datetime | None = None) -> bool:
    """¿La suscripción da acceso ahora? Sí en prueba_activa y
    activa vigentes, y en cancelada mientras no pase acceso_hasta.
    No en vencida ni en_pausa."""
    return estado_efectivo(sub, ahora) in ("prueba_activa", "activa", "cancelada")


def dias_restantes_prueba(
    sub: Suscripcion, ahora: dt.datetime | None = None
) -> int | None:
    """Días naturales completos que quedan de prueba (None si no es
    una prueba con fin). 0 = vence hoy; negativo = ya venció."""
    prueba_fin = _con_utc(sub.prueba_fin)
    if prueba_fin is None:
        return None
    ahora = ahora or _ahora()
    return math.floor((prueba_fin - ahora).total_seconds() / 86400)


def clave_plan_asistente_para_usuario(db: Session, user: User) -> str | None:
    """Clave de plan del Asistente desde la suscripción vigente.

    - Sin fila de suscripción: None (entonces manda
      User.requested_plan, el plan elegido al registrarse).
    - Fila CON acceso: la clave de su plan.
    - Fila SIN acceso (en_pausa, vencida o fin de periodo pasado):
      "prueba" explícito, NO None (corrección QA H2-1 Fase 7,
      2026-11-25). Devolver None aquí haría que el Asistente cayera
      a User.requested_plan y un usuario pausado o vencido
      conservaría el límite del plan que el admin le activó en su
      día (p. ej. total/1000). La fila de suscripción, una vez
      existe, es la única fuente del límite: requested_plan solo
      vale mientras no hay fila.

    Admin: el Asistente no pasa por aquí (sin límite, ver
    asistente._plan_usuario)."""
    sub = (
        db.query(Suscripcion)
        .filter(Suscripcion.user_id == user.id)
        .first()
    )
    if sub is None:
        return None
    if not tiene_acceso(sub):
        return "prueba"
    return plan_a_clave_asistente(sub.plan)


def pruebas_por_vencer(
    db: Session, dias: int = DIAS_AVISO_PRUEBA, ahora: dt.datetime | None = None
) -> list[Suscripcion]:
    """Pruebas que vencen en `dias` días o menos (y aún no
    vencieron): estado prueba_activa y prueba_fin en
    (ahora, ahora + (dias + 1) días). La frontera es la MISMA que
    el banner de Mi perfil (frontend/lib/suscripcion.ts,
    mostrarAvisoPrueba): días naturales completos restantes
    (floor) entre 0 y `dias` inclusive — una prueba que vence en 3
    días y 12 h tiene 3 días restantes y avisa en los dos lados
    (corrección QA H3-2 Fase 7, 2026-11-25: antes el backend exigía
    fin <= ahora + 3 días exactos y esa prueba solo salía en el
    banner). Las canceladas y las ya vencidas NO avisan de
    "pronto": una cancelada ya eligió irse y una vencida ya no es
    "pronto". Ordenadas por fin de prueba."""
    ahora = ahora or _ahora()
    limite = ahora + dt.timedelta(days=dias + 1)
    # Filtrado en Python (no en SQL): SQLite guarda los DateTime
    # sin zona horaria y la comparación SQL aware/naive no es
    # fiable entre dialectos; el volumen de pruebas es pequeño.
    candidatas = (
        db.query(Suscripcion)
        .filter(
            Suscripcion.estado == "prueba_activa",
            Suscripcion.prueba_fin.isnot(None),
        )
        .order_by(Suscripcion.prueba_fin)
        .all()
    )
    return [
        s
        for s in candidatas
        if (fin := _con_utc(s.prueba_fin)) is not None
        and ahora < fin < limite
    ]


def encolar_aviso_prueba(sub: Suscripcion, usuario: User) -> dict:
    """Envío DESACOPLADO del aviso de fin de prueba (mismo patrón
    que la verificación de correo de Fase 1): sin proveedor de
    correo configurado el aviso queda PENDIENTE y NO sale ningún
    correo. Cuando haya proveedor, aquí se encolará el envío real
    y este dict dirá enviado=true."""
    return {
        "user_id": usuario.id,
        "username": usuario.username,
        "email": usuario.email,
        "plan": sub.plan,
        "prueba_fin": _iso(sub.prueba_fin),
        "dias_restantes": dias_restantes_prueba(sub),
        "correo": {
            "estado": "pendiente",
            "motivo": "sin_proveedor_correo",
            "detalle": SIN_PROVEEDOR_CORREO,
        },
    }


class SuscripcionOut(BaseModel):
    id: int
    user_id: int
    plan: str
    plan_nombre: str
    precio_mensual_usd: int
    estado: str
    estado_efectivo: str
    acceso_activo: bool
    prueba_inicio: str | None = None
    prueba_fin: str | None = None
    renovacion_en: str | None = None
    cancelada_en: str | None = None
    acceso_hasta: str | None = None
    dias_restantes_prueba: int | None = None
    creado_en: str | None = None
    actualizado_en: str | None = None


def _iso(valor: dt.datetime | None) -> str | None:
    normalizado = _con_utc(valor)
    return normalizado.isoformat() if normalizado is not None else None


def _out(sub: Suscripcion, ahora: dt.datetime | None = None) -> SuscripcionOut:
    ahora = ahora or _ahora()
    info = PLANES[sub.plan]
    return SuscripcionOut(
        id=sub.id,
        user_id=sub.user_id,
        plan=sub.plan,
        plan_nombre=info["nombre"],
        precio_mensual_usd=info["precio_mensual_usd"],
        estado=sub.estado,
        estado_efectivo=estado_efectivo(sub, ahora),
        acceso_activo=tiene_acceso(sub, ahora),
        prueba_inicio=_iso(sub.prueba_inicio),
        prueba_fin=_iso(sub.prueba_fin),
        renovacion_en=_iso(sub.renovacion_en),
        cancelada_en=_iso(sub.cancelada_en),
        acceso_hasta=_iso(sub.acceso_hasta),
        dias_restantes_prueba=dias_restantes_prueba(sub, ahora),
        creado_en=_iso(sub.creado_en),
        actualizado_en=_iso(sub.actualizado_en),
    )


@router.get("/mia")
def mi_suscripcion(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Suscripción propia (o null si no hay) + estado honesto del
    pago en línea: sin fila no hay suscripción y el usuario es
    prueba; el pago en línea aún no está activo."""
    sub = (
        db.query(Suscripcion)
        .filter(Suscripcion.user_id == user.id)
        .first()
    )
    return {
        "suscripcion": _out(sub) if sub is not None else None,
        "pago_en_linea": estado_proveedor(),
    }


@router.post("/mia/cancelar")
def cancelar_mi_suscripcion(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Cancelar MI suscripción en un clic. Regla: estado ->
    cancelada, acceso hasta el fin del periodo pagado o de la
    prueba (acceso_hasta); sin borrar datos. Idempotente: cancelar
    dos veces devuelve lo mismo sin romper nada. Solo la propia:
    no hay parámetro de usuario, así que nadie puede cancelar la
    suscripción de otro. Honestidad (corrección QA H3-3 Fase 7,
    2026-11-25): una suscripción en_pausa NO tiene acceso activo
    que conservar — cancelarla no promete acceso hasta
    renovacion_en, ni siquiera si esa fecha es futura; si el fin de
    periodo ya pasó, el mensaje dice que el acceso ya había
    terminado, con su fecha real."""
    sub = (
        db.query(Suscripcion)
        .filter(Suscripcion.user_id == user.id)
        .first()
    )
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No tienes ninguna suscripción para cancelar.",
        )
    ahora = _ahora()
    if estado_efectivo(sub, ahora) == "vencida":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tu suscripción ya está vencida: no hay nada que cancelar.",
        )
    if sub.estado == "cancelada":
        acceso_hasta = _con_utc(sub.acceso_hasta)
        if acceso_hasta is None:
            mensaje = "Tu suscripción ya estaba cancelada y no quedaba acceso restante."
        elif acceso_hasta <= ahora:
            mensaje = (
                "Tu suscripción ya estaba cancelada. Tu acceso ya "
                "había terminado el " + acceso_hasta.date().isoformat() + "."
            )
        else:
            mensaje = (
                "Tu suscripción ya estaba cancelada. Conservas el acceso "
                "hasta " + acceso_hasta.date().isoformat() + "."
            )
        return {
            "suscripcion": _out(sub, ahora),
            "mensaje": mensaje,
        }
    fin_periodo = sub.prueba_fin if sub.estado == "prueba_activa" else sub.renovacion_en
    fin_periodo = _con_utc(fin_periodo)
    if sub.estado == "en_pausa":
        # En pausa no hay acceso activo que conservar: el acceso
        # termina con la cancelación (o ya había terminado si el fin
        # de periodo pasó). Nunca se promete "conservas el acceso".
        sub.estado = "cancelada"
        sub.cancelada_en = ahora
        sub.acceso_hasta = fin_periodo if (fin_periodo is not None and fin_periodo <= ahora) else ahora
        db.commit()
        db.refresh(sub)
        audit(
            db,
            user,
            "suscripcion.cancelada",
            "suscripcion",
            entity_id=str(sub.id),
            details={"plan": sub.plan},
        )
        if fin_periodo is not None and fin_periodo <= ahora:
            mensaje = (
                "Suscripción cancelada. Tu acceso ya había terminado "
                "el " + fin_periodo.date().isoformat() + ": tu suscripción "
                "estaba en pausa y no quedaba acceso restante. Tus "
                "datos no se borran."
            )
        else:
            mensaje = (
                "Suscripción cancelada. Tu suscripción estaba en "
                "pausa y no tenías acceso activo. Tus datos no se "
                "borran."
            )
        return {"suscripcion": _out(sub, ahora), "mensaje": mensaje}
    sub.estado = "cancelada"
    sub.cancelada_en = ahora
    sub.acceso_hasta = fin_periodo or ahora
    db.commit()
    db.refresh(sub)
    audit(
        db,
        user,
        "suscripcion.cancelada",
        "suscripcion",
        entity_id=str(sub.id),
        details={"plan": sub.plan},
    )
    return {
        "suscripcion": _out(sub, ahora),
        "mensaje": (
            "Suscripción cancelada. Conservas el acceso hasta "
            + sub.acceso_hasta.date().isoformat()
            + ". Tus datos no se borran."
        ),
    }


class ActivarSuscripcionIn(BaseModel):
    user_id: int
    plan: str
    estado: str = "prueba_activa"

    @field_validator("plan")
    @classmethod
    def _plan(cls, v: str) -> str:
        try:
            return normalizar_plan(v)
        except ValueError as e:
            raise ValueError(str(e)) from e

    @field_validator("estado")
    @classmethod
    def _estado(cls, v: str) -> str:
        estado = (v or "").strip().lower()
        if estado not in ESTADOS_ADMIN:
            raise ValueError(
                "El estado debe ser uno de: " + ", ".join(ESTADOS_ADMIN) + "."
            )
        return estado


@router.post("/admin", status_code=status.HTTP_201_CREATED)
def activar_suscripcion_admin(
    payload: ActivarSuscripcionIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """El ADMIN crea o actualiza la suscripción de un usuario (la
    activación manual de hoy, sin pago en línea): prueba_activa
    arranca 14 días de prueba; activa abre un periodo de 30 días;
    en_pausa y vencida cierran el acceso. Sincroniza
    User.requested_plan SOLO al activar con acceso (prueba_activa o
    activa): con en_pausa o vencida no se sincroniza (corrección QA
    H2-1 Fase 7, 2026-11-25) — el plan elegido al registrarse se
    conserva tal cual, y el límite del Asistente ya no depende de él
    cuando existe fila de suscripción sin acceso (ver
    clave_plan_asistente_para_usuario)."""
    objetivo = db.get(User, payload.user_id)
    if objetivo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existe ningún usuario con ese id.",
        )
    # Corrección QA H2-2 (Fase 7, 2026-11-25): un usuario pendiente
    # de aprobación no puede iniciar sesión (ver auth.py), así que
    # activarle una suscripción pondría a correr el reloj de los 14
    # días de prueba para alguien que aún no puede entrar. El admin
    # debe aprobarlo primero en Control de usuarios.
    if (
        db.query(PendingActivation)
        .filter(PendingActivation.user_id == objetivo.id)
        .first()
        is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este usuario aún está pendiente de aprobación y no "
                "puede iniciar sesión: apruébalo primero en Control "
                "de usuarios y después actívale la suscripción, para "
                "que el periodo de prueba no empiece antes de que "
                "pueda entrar."
            ),
        )
    ahora = _ahora()
    sub = (
        db.query(Suscripcion)
        .filter(Suscripcion.user_id == objetivo.id)
        .first()
    )
    creado = sub is None
    if creado:
        sub = Suscripcion(user_id=objetivo.id, plan=payload.plan, estado=payload.estado)
        db.add(sub)
    sub.plan = payload.plan
    sub.estado = payload.estado
    if payload.estado == "prueba_activa":
        sub.prueba_inicio = ahora
        sub.prueba_fin = ahora + dt.timedelta(days=DIAS_PRUEBA)
        sub.renovacion_en = sub.prueba_fin
        sub.acceso_hasta = sub.prueba_fin
        sub.cancelada_en = None
    elif payload.estado == "activa":
        sub.renovacion_en = ahora + dt.timedelta(days=DIAS_PERIODO_PAGO)
        sub.acceso_hasta = sub.renovacion_en
        sub.cancelada_en = None
    else:  # en_pausa | vencida: sin acceso
        sub.acceso_hasta = None
        sub.cancelada_en = None
    if payload.estado in ("prueba_activa", "activa"):
        objetivo.requested_plan = plan_a_requested_plan(payload.plan)
    db.commit()
    db.refresh(sub)
    audit(
        db,
        admin,
        "suscripcion.activada_admin",
        "suscripcion",
        entity_id=str(sub.id),
        details={"user_id": objetivo.id, "plan": sub.plan, "estado": sub.estado},
    )
    # Fase 8 mejoras-v1, tarea 3: "paso_a_pago" al activar una
    # suscripción de pago ("activa") o al iniciar una prueba
    # ("prueba_activa"). Referencia = clave del plan: una vez por
    # usuario y plan. Pausar o vencer no genera evento.
    if sub.estado in ("prueba_activa", "activa"):
        from app.core import analitica

        analitica.registrar_evento(
            db, analitica.TIPO_PASO_A_PAGO, objetivo.id, sub.plan
        )
    return {"suscripcion": _out(sub, ahora), "creada": creado}


@router.get("/admin/usuario/{user_id}")
def suscripcion_de_usuario_admin(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Suscripción de un usuario (vista del admin, p. ej. desde
    Control de usuarios). Null si no tiene."""
    sub = (
        db.query(Suscripcion)
        .filter(Suscripcion.user_id == user_id)
        .first()
    )
    return {"suscripcion": _out(sub) if sub is not None else None}


@router.get("/admin/avisos-prueba")
def avisos_prueba_admin(
    dias: int = Query(DIAS_AVISO_PRUEBA, ge=1, le=14),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Pruebas que vencen en `dias` días (por defecto 3): lista para
    el admin + aviso encolado por usuario. El correo NO sale: sin
    proveedor, cada aviso queda PENDIENTE (ver `correo` de cada
    aviso). Las canceladas y las ya vencidas no aparecen."""
    subs = pruebas_por_vencer(db, dias=dias)
    usuarios = {
        u.id: u
        for u in db.query(User)
        .filter(User.id.in_([s.user_id for s in subs]))
        .all()
    }
    return {
        "dias": dias,
        "avisos": [
            encolar_aviso_prueba(s, usuarios[s.user_id])
            for s in subs
            if s.user_id in usuarios
        ],
        "correo": {
            "estado": "pendiente",
            "motivo": "sin_proveedor_correo",
            "detalle": SIN_PROVEEDOR_CORREO,
        },
    }
