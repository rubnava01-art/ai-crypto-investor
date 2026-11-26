"""Fase 8 mejoras-v1, tareas 3 y 4 — Analítica de eventos y correos del sistema.

Revision ID: a51b00000007
Revises: a51b00000006
Create Date: 2026-11-25

- Tabla nueva `eventos_analitica` (tarea 3): un evento por fila (tipo,
  user_id nullable, referencia, creado_en) con unicidad
  (tipo, user_id, referencia) para que cada evento se registre una sola
  vez donde corresponde. Sin backfill: la tabla nace vacía, no se
  inventan eventos pasados ni datos históricos.
- Tabla nueva `email_envios` (tarea 4): guarda de deduplicación de
  correos del sistema (user_id, tipo, fecha, único por día). No guarda
  cuerpos de correo.
- Columna nueva `users.last_login_at` (tarea 4): último inicio de
  sesión correcto, NULL = nunca ha entrado. Base para detectar
  inactividad (reactivación).
- Downgrade: borra las dos tablas y la columna (no hay datos que
  conservar: los eventos son agregados reconstruibles y los correos
  quedan PENDIENTES de proveedor). Guardas "solo si falta" como en
  a51b00000006: la baseline crea las tablas desde los modelos pero SIN
  índices ni la UNIQUE de email_envios.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000007'
down_revision: Union[str, None] = 'a51b00000006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def _constraint_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_unique_constraints(table)}


def _columns(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "eventos_analitica" not in sa.inspect(conn).get_table_names():
        print("fase8-analitica: creating table eventos_analitica")
        op.create_table(
            "eventos_analitica",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("tipo", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("referencia", sa.String(length=128), nullable=False),
            sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "tipo", "user_id", "referencia",
                name="uq_eventos_analitica_tipo_usuario_ref",
            ),
        )
    if "ix_eventos_analitica_tipo" not in _index_names(conn, "eventos_analitica"):
        op.create_index(
            "ix_eventos_analitica_tipo", "eventos_analitica", ["tipo"]
        )
    if "ix_eventos_analitica_creado_en" not in _index_names(conn, "eventos_analitica"):
        op.create_index(
            "ix_eventos_analitica_creado_en", "eventos_analitica", ["creado_en"]
        )
    if "email_envios" not in sa.inspect(conn).get_table_names():
        print("fase8-correos: creating table email_envios")
        op.create_table(
            "email_envios",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("tipo", sa.String(length=32), nullable=False),
            sa.Column("fecha", sa.Date(), nullable=False),
            sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id", "tipo", "fecha",
                name="uq_email_envios_usuario_tipo_fecha",
            ),
        )
    if "users" in sa.inspect(conn).get_table_names():
        if "last_login_at" not in _columns(conn, "users"):
            print("fase8-correos: adding column users.last_login_at")
            op.add_column(
                "users",
                sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    if "eventos_analitica" in sa.inspect(conn).get_table_names():
        for name in (
            "ix_eventos_analitica_tipo",
            "ix_eventos_analitica_creado_en",
        ):
            if name in _index_names(conn, "eventos_analitica"):
                op.drop_index(name, table_name="eventos_analitica")
        op.drop_table("eventos_analitica")
    if "email_envios" in sa.inspect(conn).get_table_names():
        op.drop_table("email_envios")
    if "users" in sa.inspect(conn).get_table_names():
        if "last_login_at" in _columns(conn, "users"):
            op.drop_column("users", "last_login_at")
