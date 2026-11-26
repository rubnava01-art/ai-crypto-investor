"""Correos de bienvenida y reactivación (Fase 8 mejoras-v1, tarea 4).

PENDIENTE: requiere al dueño — no hay proveedor de correo
configurado (ni SMTP ni API de envío). Como en Fase 1
(app/core/email_outbox.py), el ENVÍO está desacoplado: aquí solo
viven las PLANTILLAS (español, sin prometer nada que no exista) y la
lógica de disparo; cada correo queda encolado en la cola stub y NO
sale ningún correo real hasta que Rubén elija proveedor.

Disparo de la bienvenida: tras la APROBACIÓN por admin en Control de
usuarios (POST /api/users/{id}/approve), no antes — una cuenta
pendiente no puede entrar, así que darle la bienvenida antes sería
engañoso. Solo si el usuario tiene correo; sin correo no hay nada
que encolar. Una vez por usuario y día (guarda email_envios).

Reactivación: "inactivo" = sin inicio de sesión en
INACTIVIDAD_DIAS_REACTIVACION días (30). El valor 30 es PROPUESTA
pendiente del dueño: no es una decisión tomada, es el umbral que se
aplica hasta que él diga otro. Se cuentan también las cuentas que
nunca entraron (last_login_at NULL) si fueron creadas hace más de 30
días. No se envía nada real: la función lista candidatos y el
endpoint admin los muestra; el envío queda PENDIENTE de proveedor.
"""

import datetime as dt

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.email_outbox import queue_email
from app.core.security import is_super_admin
from app.models.tables import EmailEnvio, PendingActivation, User, utcnow

TIPO_BIENVENIDA = "bienvenida"
TIPO_REACTIVACION = "reactivacion"

# Propuesta pendiente del dueño (ver docstring): días sin entrar para
# considerar a un usuario inactivo y candidato a reactivación.
INACTIVIDAD_DIAS_REACTIVACION = 30


def plantilla_bienvenida(
    nombre: str, plan_nombre: str | None = None, verificado: bool = True
) -> tuple[str, str]:
    """Asunto y cuerpo del correo de bienvenida (español).

    No promete nada que no exista: habla del acceso aprobado y de los
    planes reales ($19/$49/$99, 14 días gratis) solo si se pasa el
    plan elegido al registrarse. Si el correo aún no está verificado,
    lo dice en claro: la bienvenida llega tras la aprobación, pero
    entrar exige verificar primero.
    """
    asunto = "Bienvenido a Grow Business Platform"
    if verificado:
        apertura = (
            "Tu cuenta en Grow Business Platform ha sido aprobada. Ya puedes "
            "iniciar sesión y usar la plataforma."
        )
    else:
        # Sin verificar no se puede entrar (el login bloquea con 403 a
        # no verificados): la apertura no promete la entrada, dice que
        # llegará al verificar el correo.
        apertura = (
            "Tu cuenta en Grow Business Platform ha sido aprobada. Cuando "
            "verifiques tu correo podrás iniciar sesión y usar la "
            "plataforma."
        )
    lineas = [
        f"Hola {nombre},",
        "",
        apertura,
    ]
    if not verificado:
        lineas.append(
            "Antes de entrar, verifica tu correo con el enlace que te "
            "enviamos al registrarte."
        )
    if plan_nombre:
        lineas.append(
            f"Te registraste con interés en el plan {plan_nombre}. "
            "Los planes son Esencial $19/mes, Crecimiento $49/mes y "
            "Negocio Total $99/mes, con 14 días de prueba gratis."
        )
    lineas += [
        "",
        "Si tienes dudas, responde a este correo.",
        "",
        "Grow Business Platform",
    ]
    return asunto, "\n".join(lineas)


def plantilla_reactivacion(nombre: str) -> tuple[str, str]:
    """Asunto y cuerpo del correo de reactivación (español)."""
    asunto = "Te extrañamos en Grow Business Platform"
    cuerpo = "\n".join(
        [
            f"Hola {nombre},",
            "",
            "Hace tiempo que no entras a Grow Business Platform. "
            "Tus herramientas, clases y contenidos siguen ahí cuando "
            "quieras volver.",
            "",
            "Inicia sesión y retoma donde lo dejaste.",
            "",
            "Grow Business Platform",
        ]
    )
    return asunto, cuerpo


def encolar_correo_unico(
    db: Session, user: User, tipo: str, to: str, subject: str, body: str
) -> bool:
    """Encola el correo (stub) si hoy aún no se encoló ese tipo para
    ese usuario. Devuelve True si se encoló, False si ya existía uno
    hoy (deduplicación por (usuario, tipo, fecha), impuesta también
    por la UNIQUE de email_envios). Hace commit propio de la fila.
    Ante una carrera (doble aprobación a la vez) la UNIQUE de la BD
    gana y se devuelve False sin romper la petición (mismo patrón que
    analitica.registrar_evento): la aprobación ya quedó persistida,
    así que approve_user no debe devolver 500 por el correo.
    """
    hoy = utcnow().date()
    existente = (
        db.query(EmailEnvio)
        .filter(
            EmailEnvio.user_id == user.id,
            EmailEnvio.tipo == tipo,
            EmailEnvio.fecha == hoy,
        )
        .first()
    )
    if existente is not None:
        return False
    db.add(EmailEnvio(user_id=user.id, tipo=tipo, fecha=hoy))
    try:
        db.commit()
    except IntegrityError:
        # Otra aprobación concurrente ganó la UNIQUE: no duplicar.
        db.rollback()
        return False
    # El commit va antes de encolar: si la carrera se pierde, no
    # queda un correo en la cola sin su fila de deduplicación.
    queue_email(to, subject, body)
    return True


def encolar_bienvenida(db: Session, user: User) -> bool:
    """Encola la bienvenida tras la aprobación (si tiene correo).

    False si no hay correo o si ya se encoló hoy. El envío real queda
    PENDIENTE de proveedor (cola stub).
    """
    if not user.email:
        return False
    nombre = user.display_name or user.username
    plan_nombre = None
    if user.requested_plan:
        plan_nombre = {
            "esencial": "Esencial",
            "crecimiento": "Crecimiento",
            "total": "Negocio Total",
        }.get(user.requested_plan)
    asunto, cuerpo = plantilla_bienvenida(nombre, plan_nombre, user.email_verified)
    return encolar_correo_unico(
        db, user, TIPO_BIENVENIDA, user.email, asunto, cuerpo
    )


def candidatos_reactivacion(
    db: Session,
    dias: int = INACTIVIDAD_DIAS_REACTIVACION,
    hoy: dt.datetime | None = None,
) -> list[dict]:
    """Usuarios candidatos al correo de reactivación.

    Inactivo = último inicio de sesión hace más de `dias` días, o
    nunca ha entrado y la cuenta se creó hace más de `dias` días.
    Solo cuentas con correo (sin correo no hay a dónde escribir),
    sin contar admins (operadores, incluidos super admins) ni cuentas
    pendientes de aprobación (nunca pudieron entrar). Excluye a quien
    ya recibió la reactivación hoy (no se dispara dos veces el mismo
    día).
    Devuelve solo los datos mínimos para el listado admin.
    """
    ahora = hoy or utcnow()
    limite = ahora - dt.timedelta(days=dias)
    fecha_hoy = ahora.date()
    pendientes = {
        row[0] for row in db.query(PendingActivation.user_id).all()
    }
    ya_enviados_hoy = {
        row[0]
        for row in db.query(EmailEnvio.user_id)
        .filter(
            EmailEnvio.tipo == TIPO_REACTIVACION,
            EmailEnvio.fecha == fecha_hoy,
        )
        .all()
    }
    candidatos = []
    for user in (
        db.query(User)
        .filter(User.email.isnot(None), User.is_admin.is_(False))
        .order_by(User.id)
        .all()
    ):
        if user.id in pendientes or user.id in ya_enviados_hoy:
            continue
        if is_super_admin(user, db):
            continue
        ultimo = user.last_login_at
        if ultimo is not None:
            if ultimo.tzinfo is None:
                ultimo = ultimo.replace(tzinfo=dt.timezone.utc)
            if ultimo > limite:
                continue
            dias_inactivo = (ahora - ultimo).days
            referencia = ultimo
        else:
            creado = user.created_at
            if creado.tzinfo is None:
                creado = creado.replace(tzinfo=dt.timezone.utc)
            if creado > limite:
                continue
            dias_inactivo = (ahora - creado).days
            referencia = creado
        candidatos.append(
            {
                "user_id": user.id,
                "username": user.username,
                "email": user.email,
                "ultimo_acceso": referencia.isoformat(),
                "dias_inactivo": dias_inactivo,
            }
        )
    return candidatos
