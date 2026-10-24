"""crear: copy drafts + trend notes (Plataforma Unificada — Fase 3)

Revision ID: e9f63d1b42c8
Revises: d8e52c0a31b7
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f63d1b42c8'
down_revision: Union[str, None] = 'd8e52c0a31b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'copy_drafts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('topic', sa.String(length=200), nullable=False),
        sa.Column('platform', sa.String(length=32), nullable=False),
        sa.Column('tone', sa.String(length=32), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('demo', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'trend_notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('source', sa.String(length=120), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('published_on', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('trend_notes')
    op.drop_table('copy_drafts')
