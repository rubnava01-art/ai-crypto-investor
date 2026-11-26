"""Fase 6 mejoras-v1, tarea 3 — Feedback útil / no útil del Asistente.

Revision ID: a51b00000005
Revises: a51b00000004
Create Date: 2026-11-25

- Tabla nueva `asistente_feedback` (user_id NULL si es invitado,
  pregunta, voto util|no_util, creado_en; índice (voto, creado_en)):
  un voto por respuesta, sin guardar la respuesta del asistente ni
  la conversación completa (ver el modelo). Sin backfill: nace vacía.
- Downgrade: borra la tabla (los votos son derivados del uso; ningún
  otro flujo la lee). Guardas "solo si falta" como en a51b00000004:
  la baseline f3a2 crea las tablas desde los modelos pero SIN índices.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000005'
down_revision: Union[str, None] = 'a51b00000004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "asistente_feedback" not in sa.inspect(conn).get_table_names():
        print("fase6-asistente: creating table asistente_feedback")
        op.create_table(
            "asistente_feedback",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("pregunta", sa.String(length=1000), nullable=False),
            sa.Column("voto", sa.String(length=8), nullable=False),
            sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_asistente_feedback_voto_fecha" not in _index_names(
        conn, "asistente_feedback"
    ):
        print("fase6-asistente: creating index ix_asistente_feedback_voto_fecha")
        op.create_index(
            "ix_asistente_feedback_voto_fecha",
            "asistente_feedback",
            ["voto", "creado_en"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "asistente_feedback" in sa.inspect(conn).get_table_names():
        if "ix_asistente_feedback_voto_fecha" in _index_names(
            conn, "asistente_feedback"
        ):
            op.drop_index(
                "ix_asistente_feedback_voto_fecha",
                table_name="asistente_feedback",
            )
        op.drop_table("asistente_feedback")
