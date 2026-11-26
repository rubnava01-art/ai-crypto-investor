"""Fase 6 mejoras-v1, tarea 1 — Límites de uso del Asistente por plan.

Revision ID: a51b00000004
Revises: a51b00000003
Create Date: 2026-11-25

- Tabla nueva `asistente_uso_diario` (user_id, fecha DATE UTC,
  mensajes, actualizado_en; única por (user_id, fecha)): contador
  de mensajes del Asistente por usuario y día. Sin backfill: la
  tabla nace vacía y el contador empieza en 0 para todos.
- Downgrade: borra la tabla (el contador es derivado: se puede
  reconstruir desde cero; ningún otro flujo la lee).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000004'
down_revision: Union[str, None] = 'a51b00000003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "asistente_uso_diario" not in sa.inspect(conn).get_table_names():
        print("fase6-asistente: creating table asistente_uso_diario")
        op.create_table(
            "asistente_uso_diario",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("fecha", sa.Date(), nullable=False),
            sa.Column("mensajes", sa.Integer(), nullable=False),
            sa.Column("actualizado_en", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "fecha", name="uq_asistente_uso_user_fecha"),
        )
    # La baseline f3a2 crea las tablas que faltan desde los modelos
    # PERO SIN índices: si la tabla ya existe (creada por la baseline
    # en una BD fresca), el índice aún falta y hay que crearlo aquí.
    if "ix_asistente_uso_fecha" not in _index_names(conn, "asistente_uso_diario"):
        print("fase6-asistente: creating index ix_asistente_uso_fecha")
        op.create_index(
            "ix_asistente_uso_fecha", "asistente_uso_diario", ["fecha"]
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "asistente_uso_diario" in sa.inspect(conn).get_table_names():
        if "ix_asistente_uso_fecha" in _index_names(conn, "asistente_uso_diario"):
            op.drop_index("ix_asistente_uso_fecha", table_name="asistente_uso_diario")
        op.drop_table("asistente_uso_diario")
