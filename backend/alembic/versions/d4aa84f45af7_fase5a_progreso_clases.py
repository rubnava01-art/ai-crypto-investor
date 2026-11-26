"""Fase 5a mejoras-v1, tarea 4 — progreso por usuario y clase.

Revision ID: d4aa84f45af7
Revises: f4a7c21e9b03
Create Date: 2026-11-25

- edu_progress (nueva tabla): una fila por (user_id, class_id) con
  completed + completed_at. Sin fila, la clase no está empezada.
  UNIQUE(user_id, class_id); CASCADE al borrar usuario o clase.
- Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD
  fresca y sobre BD existente donde create_all ya creó la tabla.
- Downgrade: borra la tabla (el progreso solo alimenta Estudiar;
  ningún otro flujo lo usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4aa84f45af7'
down_revision: Union[str, None] = 'f4a7c21e9b03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    if "edu_progress" not in sa.inspect(conn).get_table_names():
        print("fase5a-progreso: creating table edu_progress")
        op.create_table(
            "edu_progress",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("class_id", sa.Integer(), nullable=False),
            sa.Column("completed", sa.Boolean(), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["class_id"], ["edu_classes.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "class_id", name="uq_edu_progress_user_class"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "edu_progress" in sa.inspect(conn).get_table_names():
        op.drop_table("edu_progress")
