"""Acceso — perfil y módulos visibles (corrida 2026-11-23, Agente 2).

GET /api/acceso/perfil devuelve el rol efectivo y la lista de
módulos que el frontend (ModuleNav) debe mostrar para ese perfil.
Es la contraparte en servidor del filtrado del menú: el cierre real
de datos vive en los routers (require_modulo en perfiles.py).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.perfiles import (
    contacto_vinculado_id,
    es_cliente_vinculado,
    modulos_para,
)
from app.core.security import effective_role, get_current_user
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/acceso", tags=["acceso"])


@router.get("/perfil")
def perfil(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rol = effective_role(user, db)
    vinculado = es_cliente_vinculado(db, user)
    return {
        "role": rol,
        "is_admin": user.is_admin,
        "es_cliente_vinculado": vinculado,
        "contacto_id": contacto_vinculado_id(db, user),
        "modulos": sorted(modulos_para(user, db)),
    }
