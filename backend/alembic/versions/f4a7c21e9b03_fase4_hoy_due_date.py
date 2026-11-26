"""Fase 4 mejoras-v1, tarea 7 — fecha de vencimiento para el panel "Hoy".

Revision ID: f4a7c21e9b03
Revises: f2a1c3e5d789
Create Date: 2026-11-25

- business_tasks.due_date (Date, NULL): fecha de vencimiento opcional
  de la tarea. Sin ella no se puede decir "vencida o de hoy": el panel
  "Hoy" solo cuenta las tareas pendientes CON fecha <= hoy.
- invoices.due_date (Date, NULL): fecha de vencimiento opcional de la
  factura. Sin ella una factura enviada solo es "por cobrar"; con ella
  es "vencida" (<= hoy) o "por vencer" (dentro de 7 días).

Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD fresca
y sobre BD existente donde create_all ya creó la columna.
Downgrade: borra ambas columnas (las fechas solo alimentan "Hoy";
ningún otro flujo las usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a7c21e9b03'
down_revision: Union[str, None] = 'f2a1c3e5d789'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "due_date" not in _column_names(conn, "business_tasks"):
        print("fase4-hoy: adding column business_tasks.due_date")
        op.add_column(
            "business_tasks",
            sa.Column("due_date", sa.Date(), nullable=True),
        )
    if "due_date" not in _column_names(conn, "invoices"):
        print("fase4-hoy: adding column invoices.due_date")
        op.add_column(
            "invoices",
            sa.Column("due_date", sa.Date(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "due_date" in _column_names(conn, "business_tasks"):
        op.drop_column("business_tasks", "due_date")
    if "due_date" in _column_names(conn, "invoices"):
        op.drop_column("invoices", "due_date")
