"""user profile columns (paquete plataforma 2026-10-28)

Revision ID: d485eb364382
Revises: e9f63d1b42c8
Create Date: 2026-10-28

Adds the editable-profile columns to the EXISTING users table.

Why this migration exists: SQLAlchemy create_all() only creates tables
that do not exist yet — it never adds columns to a table that already
exists. The 2026-10-28 bundle added display_name / email / address /
avatar_data_url to the User model, so on the live database (where users
already exists) the app crashed at startup with UndefinedColumn when
seed code queried User. This migration adds those columns; the
Dockerfile already runs `alembic upgrade head` on boot, so the next
deploy applies it automatically.

The upgrade guards each column (only adds it when missing) so it is
safe on any database state, including a fresh database where create_all
may already have created the table with the columns.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd485eb364382'
down_revision: Union[str, None] = 'e9f63d1b42c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = [
    ('display_name', sa.String(length=100)),
    ('email', sa.String(length=255)),
    ('address', sa.String(length=500)),
    ('avatar_data_url', sa.Text()),
]


def upgrade() -> None:
    conn = op.get_bind()
    existing = {c['name'] for c in sa.inspect(conn).get_columns('users')}
    for name, coltype in _COLUMNS:
        if name not in existing:
            op.add_column('users', sa.Column(name, coltype, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column('users', name)
