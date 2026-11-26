"""Fase 5a mejoras-v1, tarea 5 — quizzes cortos por clase.

Revision ID: c4862cad3f00
Revises: d4aa84f45af7
Create Date: 2026-11-25

- edu_quiz_questions (nueva tabla): pregunta por clase, con opciones
  JSON (2-6), correct_index, explicación breve y `source` obligatorio
  (de dónde sale la respuesta: material real de la clase). Sin filas,
  la clase no tiene quiz (PENDIENTE). CASCADE al borrar la clase.
- edu_quiz_attempts (nueva tabla): un intento por envío (usuario,
  clase, aciertos/total, fecha). CASCADE al borrar usuario o clase.
- Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD
  fresca y sobre BD existente donde create_all ya creó las tablas.
- Downgrade: borra ambas tablas (los quizzes solo alimentan
  Estudiar; ningún otro flujo los usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4862cad3f00'
down_revision: Union[str, None] = 'd4aa84f45af7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    names = sa.inspect(conn).get_table_names()
    if "edu_quiz_questions" not in names:
        print("fase5a-quiz: creating table edu_quiz_questions")
        op.create_table(
            "edu_quiz_questions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("class_id", sa.Integer(), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("options", sa.JSON(), nullable=False),
            sa.Column("correct_index", sa.Integer(), nullable=False),
            sa.Column("explanation", sa.Text(), nullable=False),
            sa.Column("source", sa.String(300), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["class_id"], ["edu_classes.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if "edu_quiz_attempts" not in names:
        print("fase5a-quiz: creating table edu_quiz_attempts")
        op.create_table(
            "edu_quiz_attempts",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("class_id", sa.Integer(), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False),
            sa.Column("total", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["class_id"], ["edu_classes.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    names = sa.inspect(conn).get_table_names()
    if "edu_quiz_attempts" in names:
        op.drop_table("edu_quiz_attempts")
    if "edu_quiz_questions" in names:
        op.drop_table("edu_quiz_questions")
