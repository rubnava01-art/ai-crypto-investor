"""Lectura del registro de auditoría (Fase 1 mejoras-v1, tarea 6).

La tabla audit_logs ya existe y las acciones sensibles de admin ya se
escriben ahí (usuarios: crear/actualizar/aprobar/rechazar/borrar;
kill switch activar/desactivar; modo de simulación; scanner;
órdenes; vínculos del portal; conexiones de exchange; 2FA; correo).
Lo que faltaba era LEERLO: este endpoint es solo super admin, con
filtros por acción, actor y entidad.

La lectura NO se audita a sí misma (cada lectura escribiría una fila
e inundaría el registro). El historial se conserva al borrar un
usuario: la fila queda con actor anónimo (user_id NULL), nunca se
borra (ver _detach_user_references en users.py).
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import require_super_admin
from app.database import get_db
from app.models.tables import AuditLog, User

router = APIRouter(prefix="/api/admin/audit-log", tags=["auditoria"])


class AuditLogOut(BaseModel):
    id: int
    actor_id: int | None = None
    actor_username: str | None = None
    action: str
    entity: str | None = None
    entity_id: str | None = None
    details: dict = {}
    created_at: str | None = None


@router.get("", response_model=list[AuditLogOut])
def list_audit_log(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    action: str | None = Query(default=None, description="Filtra por acción exacta"),
    user_id: int | None = Query(default=None, description="Filtra por actor"),
    entity: str | None = Query(default=None, description="Filtra por entidad"),
    super_admin: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action.strip())
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    if entity:
        query = query.filter(AuditLog.entity == entity.strip())
    rows = (
        query.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()
    )
    actor_ids = {r.user_id for r in rows if r.user_id is not None}
    names = (
        {
            u.id: u.username
            for u in db.query(User).filter(User.id.in_(actor_ids)).all()
        }
        if actor_ids
        else {}
    )
    return [
        AuditLogOut(
            id=r.id,
            actor_id=r.user_id,
            actor_username=names.get(r.user_id) if r.user_id else None,
            action=r.action,
            entity=r.entity,
            entity_id=r.entity_id,
            details=dict(r.details_json or {}),
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]
