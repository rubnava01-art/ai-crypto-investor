"""Fase 7 mejoras-v1, tarea 1 — Suscripciones (preparar, NO activar).

Revision ID: a51b00000006
Revises: a51b00000005
Create Date: 2026-11-25

- Tabla nueva `suscripciones` (una fila por usuario: user_id único;
  plan esencial|crecimiento|negocio_total; estado prueba_activa |
  activa | cancelada | vencida | en_pausa; prueba_inicio/fin,
  renovacion_en, cancelada_en, acceso_hasta; proveedor e id en el
  proveedor, NULL por ahora — sin pasarela conectada; índices en
  prueba_fin y estado). Sin backfill: la tabla nace vacía; sin fila
  no hay suscripción (el usuario es prueba) y nada cambia para las
  cuentas existentes.
- Downgrade: borra la tabla (las suscripciones las crea el admin a
  mano y se pueden recrear; ningún otro flujo borra datos por
  cancelar: la cancelación solo cambia el estado). Guardas "solo si
  falta" como en a51b00000004/05: la baseline crea las tablas desde
  los modelos pero SIN índices.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000006'
down_revision: Union[str, None] = 'a51b00000005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "suscripciones" not in sa.inspect(conn).get_table_names():
        print("fase7-pagos: creating table suscripciones")
        op.create_table(
            "suscripciones",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("plan", sa.String(length=32), nullable=False),
            sa.Column("estado", sa.String(length=32), nullable=False),
            sa.Column("prueba_inicio", sa.DateTime(timezone=True), nullable=True),
            sa.Column("prueba_fin", sa.DateTime(timezone=True), nullable=True),
            sa.Column("renovacion_en", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelada_en", sa.DateTime(timezone=True), nullable=True),
            sa.Column("acceso_hasta", sa.DateTime(timezone=True), nullable=True),
            sa.Column("proveedor", sa.String(length=32), nullable=True),
            sa.Column(
                "proveedor_suscripcion_id", sa.String(length=128), nullable=True
            ),
            sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
            sa.Column("actualizado_en", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_suscripciones_user_id"),
        )
    if "ix_suscripciones_prueba_fin" not in _index_names(conn, "suscripciones"):
        print("fase7-pagos: creating index ix_suscripciones_prueba_fin")
        op.create_index(
            "ix_suscripciones_prueba_fin", "suscripciones", ["prueba_fin"]
        )
    if "ix_suscripciones_estado" not in _index_names(conn, "suscripciones"):
        print("fase7-pagos: creating index ix_suscripciones_estado")
        op.create_index("ix_suscripciones_estado", "suscripciones", ["estado"])


def downgrade() -> None:
    conn = op.get_bind()
    if "suscripciones" in sa.inspect(conn).get_table_names():
        for name in (
            "ix_suscripciones_prueba_fin",
            "ix_suscripciones_estado",
        ):
            if name in _index_names(conn, "suscripciones"):
                op.drop_index(name, table_name="suscripciones")
        op.drop_table("suscripciones")
