"""NEST — Test exprés para Brief de Marca (tabla brand_briefs)

Revision ID: 9c2e7b4a1f08
Revises: 7df4aeb666c6
Create Date: 2026-11-17

Una fila por contacto del CRM con las 8 respuestas del test, texto
libre, vacías al inicio. `contact_id` UNIQUE (un brief por contacto),
FK -> crm_contacts.id ON DELETE CASCADE (al borrar el contacto se va
su brief).

Guards "solo si falta" (patrón 7df4aeb666c6): la migración es segura
sobre BD fresca y sobre BD existente donde `create_all` ya creó la
tabla. Downgrade: borra la tabla.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c2e7b4a1f08'
down_revision: Union[str, None] = '7df4aeb666c6'
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
    (columns + PK + FKs + unique constraints), patrón 7df4aeb666c6."""
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
    table = Base.metadata.tables["brand_briefs"]
    if "brand_briefs" not in _table_names(conn):
        print("brand-brief: creating table brand_briefs")
        _create_table_from_model(table)
    else:
        existing = _column_names(conn, "brand_briefs")
        for c in table.columns:
            if c.name not in existing:
                print(f"brand-brief: adding missing column brand_briefs.{c.name}")
                op.add_column(
                    "brand_briefs", sa.Column(c.name, c.type, nullable=True)
                )
    present = _index_names(conn, "brand_briefs")
    for idx in table.indexes:
        if idx.name not in present:
            op.create_index(idx.name, "brand_briefs", [c.name for c in idx.columns])
    # UNIQUE en contact_id (guarda por columnas: create_all ya crea el
    # UNIQUE de la columna sin nombre; crearlo otra vez lo duplicaría).
    has_unique = any(
        list(u.get("column_names") or []) == ["contact_id"]
        for u in sa.inspect(conn).get_unique_constraints("brand_briefs")
    )
    if not has_unique:
        try:
            if conn.dialect.name == "sqlite":
                with op.batch_alter_table("brand_briefs") as batch_op:
                    batch_op.create_unique_constraint(
                        "uq_brand_briefs_contact_id", ["contact_id"]
                    )
            else:
                op.create_unique_constraint(
                    "uq_brand_briefs_contact_id", "brand_briefs", ["contact_id"]
                )
        except Exception as e:  # noqa: BLE001 - boot must not die on a unique
            print(f"WARNING brand-brief: could not create unique: {e}")


def downgrade() -> None:
    conn = op.get_bind()
    if "brand_briefs" in _table_names(conn):
        op.drop_table("brand_briefs")
