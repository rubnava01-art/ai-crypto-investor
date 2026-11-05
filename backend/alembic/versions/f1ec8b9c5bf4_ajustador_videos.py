"""Ajustador y videos educativos (2026-11-05).

Revision ID: f1ec8b9c5bf4
Revises: a918a20d8191
Create Date: 2026-11-05

Adds ONLY two new tables (ajustes, videos_educativos) — additive,
never touches existing tables' columns. No seed rows: both lists start
EMPTY. No invented content anywhere.

Inspect-first (same safety rule as a918a20d8191, since the Dockerfile
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
revision: str = 'f1ec8b9c5bf4'
down_revision: Union[str, None] = 'a918a20d8191'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("ajustes", "videos_educativos")


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
            print(f"ajustador-videos: creating table {name}")
            _create_table_from_model(table)
        else:
            # Table already exists (e.g. create_all ran first): add
            # only columns that are missing, never alter existing ones.
            present = _column_names(conn, name)
            for c in table.columns:
                if c.name not in present:
                    print(f"ajustador-videos: adding {name}.{c.name}")
                    op.add_column(name, sa.Column(c.name, c.type, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    tables = _table_names(conn)
    for name in ("videos_educativos", "ajustes"):
        if name in tables:
            op.drop_table(name)
