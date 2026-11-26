"""Fase 1 mejoras-v1, tarea 1 — verificación de correo al registrarse.

Revision ID: f1a5e6c7d8b9
Revises: b7c3e91a4f02
Create Date: 2026-11-25

- users.email_verified (Boolean, False por defecto): las cuentas viejas
  y los registros sin correo quedan en False pero no pasan por
  verificación (el bloqueo solo aplica con correo presente).
- Tabla nueva email_verifications (token SHA-256, TTL 24 h, un solo
  uso; FK a users con CASCADE).

Guards "solo si falta" (patrón 9c2e7b4a1f08): segura sobre BD fresca y
sobre BD existente donde create_all ya creó la tabla/columna.
Downgrade: borra la tabla y la columna (sin tocar datos de usuarios).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a5e6c7d8b9'
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
    # users.email_verified
    existing = _column_names(conn, "users")
    if "email_verified" not in existing:
        print("verificacion-correo: adding column users.email_verified")
        op.add_column(
            "users",
            sa.Column(
                "email_verified", sa.Boolean(), nullable=False,
                server_default=sa.false(),
            ),
        )
    # email_verifications
    table = Base.metadata.tables["email_verifications"]
    if "email_verifications" not in _table_names(conn):
        print("verificacion-correo: creating table email_verifications")
        _create_table_from_model(table)
    else:
        existing = _column_names(conn, "email_verifications")
        for c in table.columns:
            if c.name not in existing:
                print(
                    f"verificacion-correo: adding missing column "
                    f"email_verifications.{c.name}"
                )
                op.add_column(
                    "email_verifications", sa.Column(c.name, c.type, nullable=True)
                )
    present = _index_names(conn, "email_verifications")
    for idx in table.indexes:
        if idx.name not in present:
            op.create_index(
                idx.name, "email_verifications", [c.name for c in idx.columns]
            )


def downgrade() -> None:
    conn = op.get_bind()
    if "email_verifications" in _table_names(conn):
        op.drop_table("email_verifications")
    if "email_verified" in _column_names(conn, "users"):
        op.drop_column("users", "email_verified")
