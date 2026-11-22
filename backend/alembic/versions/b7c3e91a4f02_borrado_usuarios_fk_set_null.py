"""borrado de usuarios: ondelete en las FK a users (bug 2026-11-21)

Revision ID: b7c3e91a4f02
Revises: 9c2e7b4a1f08
Create Date: 2026-11-21

DELETE /api/users/{id} devolvía 409 en producción ("La operación
viola una regla de integridad de datos") para cualquier usuario con
acciones auditadas: AuditLog.user_id —y las demás FK a users sin
ondelete— bloqueaba el borrado en Postgres/Neon. El usuario de
prueba tmp_clave_prueba (id 7) quedó atascado en vivo por esto.

Cambios (solo Postgres; en SQLite la migración no hace nada porque
SQLite no aplica las FK y create_all ya crea las tablas nuevas con
el ondelete del modelo):
- SET NULL en las FK anulables: audit_logs, idempotency_keys,
  ai_explanations, crm_contacts, chat_messages, trend_searches,
  web_audits, appointments.created_by_user_id,
  business_costs.created_by_user_id. El historial se conserva: las
  filas quedan con user_id NULL (actor anónimo).
- CASCADE en exchange_connections.user_id (metadatos propios del
  usuario, se borran con él). super_admin_grants y
  pending_activations ya eran CASCADE; home_posts y home_comments
  ya eran SET NULL.

El handler delete_user/reject hace además la misma limpieza de
forma explícita (ver _detach_user_references en app/api/users.py),
así el borrado funciona en cualquier BD y en BD creadas antes de
esta migración. El upgrade inspecciona la FK real de cada tabla
(nombre y ondelete actual) y solo la recrea cuando hace falta, así
es seguro en cualquier estado de la base.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c3e91a4f02'
down_revision: Union[str, None] = '9c2e7b4a1f08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tabla, columna, ondelete deseado)
_CHANGES = [
    ("exchange_connections", "user_id", "CASCADE"),
    ("audit_logs", "user_id", "SET NULL"),
    ("idempotency_keys", "user_id", "SET NULL"),
    ("ai_explanations", "user_id", "SET NULL"),
    ("crm_contacts", "user_id", "SET NULL"),
    ("chat_messages", "user_id", "SET NULL"),
    ("trend_searches", "user_id", "SET NULL"),
    ("web_audits", "user_id", "SET NULL"),
    ("appointments", "created_by_user_id", "SET NULL"),
    ("business_costs", "created_by_user_id", "SET NULL"),
]


def _set_ondelete(conn, table: str, column: str, action: str | None) -> None:
    """Recrea la FK a users de (table, column) con el ondelete dado
    (None = sin ondelete), solo si existe y no lo tiene ya."""
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return
    fks = [
        fk for fk in inspector.get_foreign_keys(table)
        if fk["constrained_columns"] == [column]
        and fk["referred_table"] == "users"
    ]
    if not fks:
        return
    fk = fks[0]
    current = (fk.get("options") or {}).get("ondelete")
    if current == action:
        return
    name = fk["name"]
    op.drop_constraint(name, table, type_="foreignkey")
    op.create_foreign_key(
        name, table, "users", [column], ["id"], ondelete=action
    )


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return
    for table, column, action in _CHANGES:
        _set_ondelete(conn, table, column, action)


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return
    for table, column, _action in _CHANGES:
        _set_ondelete(conn, table, column, None)
