"""Fase 1 mejoras-v1, tarea 3 — 2FA TOTP para admin y super admin.

Revision ID: a3b7c2d4e5f6
Revises: f1a5e6c7d8b9
Create Date: 2026-11-25

- users.totp_secret (secreto base32, nullable), users.totp_enabled
  (Boolean, False por defecto) y users.totp_recovery_codes (JSON con
  los SHA-256 de los 10 códigos de recuperación, nullable).

Guards "solo si falta" (patrón 9c2e7b4a1f08). Downgrade: borra las
tres columnas (sin tocar datos de usuarios).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b7c2d4e5f6'
down_revision: Union[str, None] = 'f1a5e6c7d8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("totp_secret", sa.String(64)),
    ("totp_enabled", sa.Boolean()),
    ("totp_recovery_codes", sa.JSON()),
)


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()
    existing = _column_names(conn, "users")
    for name, coltype in _COLUMNS:
        if name not in existing:
            print(f"2fa: adding column users.{name}")
            default = sa.false() if name == "totp_enabled" else None
            op.add_column(
                "users",
                sa.Column(
                    name, coltype, nullable=True if name != "totp_enabled" else False,
                    server_default=default,
                ),
            )


def downgrade() -> None:
    conn = op.get_bind()
    existing = _column_names(conn, "users")
    for name, _ in _COLUMNS:
        if name in existing:
            op.drop_column("users", name)
