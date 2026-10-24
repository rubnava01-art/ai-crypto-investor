"""academia: courses + enrollments (Plataforma Unificada — Fase 2)

Revision ID: d8e52c0a31b7
Revises: c7d41b9e52f0
Create Date: 2026-10-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e52c0a31b7'
down_revision: Union[str, None] = 'c7d41b9e52f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'academy_courses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('price_usd', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('buy_url', sa.String(length=512), nullable=False),
        sa.Column('delivery_note', sa.Text(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug'),
    )
    op.create_table(
        'academy_enrollments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('contact_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('purchased', sa.Boolean(), nullable=False),
        sa.Column('delivered', sa.Boolean(), nullable=False),
        sa.Column('purchased_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['contact_id'], ['crm_contacts.id']),
        sa.ForeignKeyConstraint(['course_id'], ['academy_courses.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('contact_id', 'course_id', name='uq_enrollment_contact_course'),
    )


def downgrade() -> None:
    op.drop_table('academy_enrollments')
    op.drop_table('academy_courses')
