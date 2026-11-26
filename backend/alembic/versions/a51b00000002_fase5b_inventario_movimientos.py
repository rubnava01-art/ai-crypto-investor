"""Fase 5b mejoras-v1, tarea 3 — Inventario: historial de movimientos.

Revision ID: a51b00000002
Revises: a51b00000001
Create Date: 2026-11-25

- inventory_movements (nueva tabla): una fila por cambio real de
  cantidad (tipo entrada|venta|ajuste, delta con signo, cantidad
  final, motivo, fecha). CASCADE al borrar el producto.
- Sin backfill: los productos existentes no tienen historial inventado;
  el historial nace con los movimientos que ocurren desde ahora (la
  creación con stock inicial registra una entrada).
- Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD fresca
  y sobre BD existente donde create_all ya creó la tabla.
- Downgrade: borra la tabla (el historial solo alimenta la vista por
  producto; ningún otro flujo lo usa).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000002'
down_revision: Union[str, None] = 'a51b00000001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    names = sa.inspect(conn).get_table_names()
    if "inventory_movements" not in names:
        print("fase5b-inventario: creating table inventory_movements")
        op.create_table(
            "inventory_movements",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.Integer(), nullable=False),
            sa.Column("tipo", sa.String(16), nullable=False),
            sa.Column("cantidad_delta", sa.Integer(), nullable=False),
            sa.Column("cantidad_final", sa.Integer(), nullable=False),
            sa.Column("motivo", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_inventory_movements_item_id", "inventory_movements", ["item_id"])


def downgrade() -> None:
    conn = op.get_bind()
    names = sa.inspect(conn).get_table_names()
    if "inventory_movements" in names:
        op.drop_table("inventory_movements")
