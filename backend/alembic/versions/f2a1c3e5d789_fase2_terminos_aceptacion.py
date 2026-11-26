"""Fase 2 mejoras-v1, tarea 1 — aceptación de Términos y Privacidad.

Revision ID: f2a1c3e5d789
Revises: 56dab982680f
Create Date: 2026-11-25

- users.terms_accepted_at (DateTime, NULL): fecha en que el usuario
  aceptó los Términos y la Política de privacidad al registrarse.
  NULL en cuentas viejas y en cuentas creadas por un admin.

Guardia "solo si falta" (patrón f1a5e6c7d8b9): segura sobre BD fresca
y sobre BD existente donde create_all ya creó la columna.
Downgrade: borra la columna (no hay datos que preservar: la fecha
solo registra el consentimiento del registro).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a1c3e5d789'
down_revision: Union[str, None] = '56dab982680f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    if "terms_accepted_at" not in _column_names(conn, "users"):
        print("fase2-legal: adding column users.terms_accepted_at")
        op.add_column(
            "users",
            sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "terms_accepted_at" in _column_names(conn, "users"):
        op.drop_column("users", "terms_accepted_at")
