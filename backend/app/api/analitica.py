"""Resumen de analítica de eventos (Fase 8 mejoras-v1, tarea 3).

Solo admin. Solo conteos agregados por tipo de evento y periodo
(eventos y usuarios únicos); nunca lista usuarios ni eventos
individuales. Sin servicio externo: los datos salen de la tabla
`eventos_analitica`, que nace vacía.
"""

import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core import analitica
from app.core.security import require_admin
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/analitica", tags=["analitica"])


@router.get("/resumen")
def resumen_analitica(
    desde: dt.date | None = Query(default=None, description="Fecha inicial (AAAA-MM-DD)"),
    hasta: dt.date | None = Query(default=None, description="Fecha final (AAAA-MM-DD)"),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Conteos por tipo de evento en el periodo (fechas inclusivas)."""
    return analitica.resumen(db, desde=desde, hasta=hasta)
