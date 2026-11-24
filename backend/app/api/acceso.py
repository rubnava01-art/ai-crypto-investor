"""Acceso — perfil y módulos visibles (corrida 2026-11-23, Agente 2).

GET /api/acceso/perfil devuelve el rol efectivo y la lista de
módulos que el frontend (ModuleNav) debe mostrar para ese perfil.
Es la contraparte en servidor del filtrado del menú: el cierre real
de datos vive en los routers (require_modulo en perfiles.py).

Fase 1 (2026-11-23, mejoras óptimas): el endpoint también responde
para el invitado (token guest:<uuid>) con role "invitado" y su
conjunto fijo {inicio, estudiar, planes, asistente}, bajo el
limiter de lecturas de invitado (30/min por IP).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.perfiles import (
    contacto_vinculado_id,
    es_cliente_vinculado,
    modulos_para,
)
from app.core.security import (
    Guest,
    Principal,
    effective_role,
    guest_read_guard,
)
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/acceso", tags=["acceso"])


@router.get("/perfil")
def perfil(
    principal: Principal = Depends(guest_read_guard),
    db: Session = Depends(get_db),
):
    if isinstance(principal, Guest):
        return {
            "role": "invitado",
            "is_admin": False,
            "es_cliente_vinculado": False,
            "contacto_id": None,
            "modulos": sorted(modulos_para(principal, db)),
        }
    user: User = principal
    rol = effective_role(user, db)
    vinculado = es_cliente_vinculado(db, user)
    return {
        "role": rol,
        "is_admin": user.is_admin,
        "es_cliente_vinculado": vinculado,
        "contacto_id": contacto_vinculado_id(db, user),
        "modulos": sorted(modulos_para(user, db)),
    }
