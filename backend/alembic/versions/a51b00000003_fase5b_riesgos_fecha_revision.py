"""Fase 5b mejoras-v1, tarea 4 — Riesgos: fecha de revisión.

Revision ID: a51b00000003
Revises: a51b00000002
Create Date: 2026-11-25

- riesgos.fecha_revision (Date, NULL): fecha en la que hay que revisar
  el riesgo. Backfill NULL (sin fecha fijada; no se inventa ninguna).
- Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD fresca
  y sobre BD existente donde create_all ya creó la columna.
- Downgrade: borra la columna (la fecha solo alimenta la matriz y la
  vista del registro; ningún otro flujo la usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000003'
down_revision: Union[str, None] = 'a51b00000002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "fecha_revision" not in _column_names(conn, "riesgos"):
        print("fase5b-riesgos: adding column riesgos.fecha_revision")
        op.add_column(
            "riesgos",
            sa.Column("fecha_revision", sa.Date(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "fecha_revision" in _column_names(conn, "riesgos"):
        op.drop_column("riesgos", "fecha_revision")
