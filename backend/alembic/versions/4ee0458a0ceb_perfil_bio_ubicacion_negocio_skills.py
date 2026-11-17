"""add bio/location/business/skills to users (rediseño perfil 2026-11-17)

Revision ID: 4ee0458a0ceb
Revises: 88f6de1c6bb9
Create Date: 2026-11-17

Adds five nullable columns to the EXISTING users table for the profile
redesign (estilo tarjeta de red): bio corta, ubicación, handle y
descripción del negocio, y habilidades (skills, lista JSON).

Why this migration exists: SQLAlchemy create_all() only creates tables
that do not exist yet — it never adds columns to a table that already
exists. The Dockerfile already runs `alembic upgrade head` on boot,
so the next deploy applies it automatically.

The upgrade guards each column (only adds it when missing) so it is
safe on any database state, including a fresh database where create_all
may already have created the table with the columns (same pattern as
88f6de1c6bb9, requested_plan).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4ee0458a0ceb'
down_revision: Union[str, None] = '88f6de1c6bb9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    ('bio', sa.String(length=280)),
    ('location', sa.String(length=120)),
    ('business_handle', sa.String(length=64)),
    ('business_description', sa.String(length=500)),
    ('skills', sa.JSON()),
]


def upgrade() -> None:
    conn = op.get_bind()
    existing = {c['name'] for c in sa.inspect(conn).get_columns('users')}
    for name, coltype in COLUMNS:
        if name not in existing:
            op.add_column('users', sa.Column(name, coltype, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    existing = {c['name'] for c in sa.inspect(conn).get_columns('users')}
    for name, _ in COLUMNS:
        if name in existing:
            op.drop_column('users', name)
