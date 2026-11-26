"""Cola de correo desacoplada (Fase 1 mejoras-v1, tarea 1).

PENDIENTE: requiere al dueño — no hay proveedor de correo
configurado (ni SMTP ni API de envío). Este módulo es el stub: registra
cada correo que el sistema querría enviar (destinatario, asunto,
cuerpo) en memoria y en el log, sin mandar nada real. Cuando Rubén
elija proveedor (p. ej. Resend, SendGrid o SMTP propio), el envío se
implementa aquí, en este único punto, sin tocar los endpoints.

La cola es en memoria por diseño (mismo supuesto que el limiter de
login y los challenges matemáticos: un solo worker): un reinicio del
tier gratuito la vacía, y el reenvío vuelve a emitir el correo.
"""
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class QueuedEmail:
    to: str
    subject: str
    body: str


# Cola en memoria: lo único que existe hasta que haya proveedor real.
OUTBOX: list[QueuedEmail] = []


def queue_email(to: str, subject: str, body: str) -> QueuedEmail:
    """Registra un correo pendiente de envío (stub: no envía nada).

    PENDIENTE: requiere al dueño — conectar un proveedor real aquí.
    """
    email = QueuedEmail(to=to, subject=subject, body=body)
    OUTBOX.append(email)
    logger.info(
        "Correo encolado (STUB, sin envío real) para %s: %s", to, subject
    )
    return email


def list_outbox() -> list[QueuedEmail]:
    """Copia de la cola (para tests y diagnóstico)."""
    return list(OUTBOX)


def clear_outbox() -> None:
    """Vacía la cola (solo para tests)."""
    OUTBOX.clear()
