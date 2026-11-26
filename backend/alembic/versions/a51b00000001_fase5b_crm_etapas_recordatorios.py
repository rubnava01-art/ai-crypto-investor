"""Fase 5b mejoras-v1, tarea 1 — CRM: etapas de venta, historial y recordatorios.

Revision ID: a51b00000001
Revises: c4862cad3f00
Create Date: 2026-11-25

- crm_contacts.stage (String(16), default "nuevo"): etapa de venta
  nuevo|contactado|propuesta|negociacion|ganado|perdido, distinta del
  `status` general que ya existía. Backfill "nuevo" (los contactos
  existentes nacen en la primera etapa; no se inventa historial).
- crm_stage_history (nueva tabla): una fila por cambio real de etapa
  (from_stage NULL solo en la fila inicial del alta). CASCADE al
  borrar el contacto.
- crm_reminders (nueva tabla): recordatorio fecha + nota + hecho.
  CASCADE al borrar el contacto.
- Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD fresca
  y sobre BD existente donde create_all ya creó columna/tablas.
- Downgrade: borra las dos tablas y la columna stage (el historial y
  los recordatorios solo alimentan el CRM y "Hoy"; ningún otro flujo
  los usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000001'
down_revision: Union[str, None] = 'c4862cad3f00'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "stage" not in _column_names(conn, "crm_contacts"):
        print("fase5b-crm: adding column crm_contacts.stage")
        op.add_column(
            "crm_contacts",
            sa.Column("stage", sa.String(16), nullable=False, server_default="nuevo"),
        )
    names = sa.inspect(conn).get_table_names()
    if "crm_stage_history" not in names:
        print("fase5b-crm: creating table crm_stage_history")
        op.create_table(
            "crm_stage_history",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("contact_id", sa.Integer(), nullable=False),
            sa.Column("from_stage", sa.String(16), nullable=True),
            sa.Column("to_stage", sa.String(16), nullable=False),
            sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["contact_id"], ["crm_contacts.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_crm_stage_history_contact_id", "crm_stage_history", ["contact_id"])
    if "crm_reminders" not in names:
        print("fase5b-crm: creating table crm_reminders")
        op.create_table(
            "crm_reminders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("contact_id", sa.Integer(), nullable=False),
            sa.Column("remind_date", sa.Date(), nullable=False),
            sa.Column("note", sa.Text(), nullable=False),
            sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["contact_id"], ["crm_contacts.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_crm_reminders_contact_id", "crm_reminders", ["contact_id"])


def downgrade() -> None:
    conn = op.get_bind()
    names = sa.inspect(conn).get_table_names()
    if "crm_reminders" in names:
        op.drop_table("crm_reminders")
    if "crm_stage_history" in names:
        op.drop_table("crm_stage_history")
    if "stage" in _column_names(conn, "crm_contacts"):
        op.drop_column("crm_contacts", "stage")
