"""Mensajes de contacto público (tabla contact_messages)

Revision ID: ef98abd287f8
Revises: b7c3e91a4f02
Create Date: 2026-11-25

Servicios + Calculadora (2026-11-25): buzón del formulario público
de /contacto. Una fila por mensaje: nombre, email, servicio, mensaje,
estado (nuevo/leído/respondido) y created_at. Sin IP guardada (PII).
Índice en created_at para el listado admin (TAREA 2).

Guards "solo si falta" (patrón 9c2e7b4a1f08): segura sobre BD fresca
y sobre BD existente donde `create_all` ya creó la tabla (la
migración baseline f3a2c91d7b4e crea además todas las tablas del
modelo al correr). Downgrade: borra la tabla.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef98abd287f8'
down_revision: Union[str, None] = 'b7c3e91a4f02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def _create_table_from_model(table) -> None:
    """Create one missing table exactly as the model defines it
    (columns + PK + FKs + unique constraints), patrón 9c2e7b4a1f08."""
    columns = []
    for c in table.columns:
        kwargs: dict = {"nullable": c.nullable, "primary_key": c.primary_key}
        columns.append(sa.Column(c.name, c.type, **kwargs))
    constraints = []
    for fk in table.foreign_keys:
        constraints.append(
            sa.ForeignKeyConstraint(
                [fk.parent.name],
                [f"{fk.column.table.name}.{fk.column.name}"],
                ondelete=fk.ondelete,
            )
        )
    for constraint in table.constraints:
        if isinstance(constraint, sa.UniqueConstraint):
            constraints.append(
                sa.UniqueConstraint(
                    *[col.name for col in constraint.columns],
                    name=constraint.name,
                )
            )
    op.create_table(table.name, *columns, *constraints)


def upgrade() -> None:
    from app.models.tables import Base

    conn = op.get_bind()
    table = Base.metadata.tables["contact_messages"]
    if "contact_messages" not in _table_names(conn):
        print("contacto: creating table contact_messages")
        _create_table_from_model(table)
    else:
        existing = _column_names(conn, "contact_messages")
        for c in table.columns:
            if c.name not in existing:
                print(f"contacto: adding missing column contact_messages.{c.name}")
                op.add_column(
                    "contact_messages", sa.Column(c.name, c.type, nullable=True)
                )
    present = _index_names(conn, "contact_messages")
    for idx in table.indexes:
        if idx.name not in present:
            op.create_index(idx.name, "contact_messages", [c.name for c in idx.columns])


def downgrade() -> None:
    conn = op.get_bind()
    if "contact_messages" in _table_names(conn):
        op.drop_table("contact_messages")
