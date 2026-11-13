"""add requested_plan to users (A2, corrida 2026-11-13)

Revision ID: 88f6de1c6bb9
Revises: f1ec8b9c5bf4
Create Date: 2026-11-13

Adds the nullable `requested_plan` column to the EXISTING users table:
the plan the visitor chose on the landing (Esencial $19 / Crecimiento
$49 / Negocio Total $99) before registering, so the admin sees it in
Control de usuarios when approving the pending account. Canonical
stored values: "esencial" | "crecimiento" | "total".

Why this migration exists: SQLAlchemy create_all() only creates tables
that do not exist yet — it never adds columns to a table that already
exists. The Dockerfile already runs `alembic upgrade head` on boot,
so the next deploy applies it automatically.

The upgrade guards the column (only adds it when missing) so it is
safe on any database state, including a fresh database where create_all
may already have created the table with the column (same pattern as
d485eb364382, user profile columns).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '88f6de1c6bb9'
down_revision: Union[str, None] = 'f1ec8b9c5bf4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = {c['name'] for c in sa.inspect(conn).get_columns('users')}
    if 'requested_plan' not in existing:
        op.add_column(
            'users', sa.Column('requested_plan', sa.String(length=32), nullable=True)
        )


def downgrade() -> None:
    conn = op.get_bind()
    existing = {c['name'] for c in sa.inspect(conn).get_columns('users')}
    if 'requested_plan' in existing:
        op.drop_column('users', 'requested_plan')
