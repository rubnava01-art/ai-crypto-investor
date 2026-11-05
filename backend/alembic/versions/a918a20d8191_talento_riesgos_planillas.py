"""Talento humano, gestión de riesgos y planillas (2026-11-04).

Revision ID: a918a20d8191
Revises: f3a2c91d7b4e
Create Date: 2026-11-04

Adds ONLY three new tables (empleados, riesgos, planillas) — additive,
never touches existing tables' columns. No seed rows: all three lists
start EMPTY. No SSN, no bank-account fields, no tax math anywhere.

Inspect-first (same safety rule as f3a2c91d7b4e, since the Dockerfile
runs `alembic upgrade head` on boot): create a table only when missing,
add a column only when missing. Must succeed on both states:
  1. Fresh DB: tables missing -> created from the model metadata.
  2. Simulated existing DB: pre-migration schema + create_all already
     made the tables -> nothing to do, upgrade is a no-op.
Tables are derived from the model metadata (not hand-transcribed) so
the schema cannot drift from the models.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a918a20d8191'
down_revision: Union[str, None] = 'f3a2c91d7b4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("empleados", "riesgos", "planillas")


def _table_names(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _create_table_from_model(table) -> None:
    """Create one missing table exactly as the model defines it
    (columns + PK + FKs + unique constraints)."""
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
    # Imported here (not at module top): env.py already puts backend/
    # on sys.path and loads settings before migrations run.
    from app.models.tables import Base

    conn = op.get_bind()
    existing = _table_names(conn)
    for name in _TABLES:
        table = Base.metadata.tables[name]
        if name not in existing:
            print(f"talento-riesgos-planillas: creating table {name}")
            _create_table_from_model(table)
        else:
            # Table already exists (e.g. create_all ran first): add
            # only columns that are missing, never alter existing ones.
            present = _column_names(conn, name)
            for c in table.columns:
                if c.name not in present:
                    print(f"talento-riesgos-planillas: adding {name}.{c.name}")
                    op.add_column(name, sa.Column(c.name, c.type, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    tables = _table_names(conn)
    # Only the tables this migration owns, in FK-safe order
    # (planillas references empleados).
    for name in ("planillas", "riesgos", "empleados"):
        if name in tables:
            op.drop_table(name)
