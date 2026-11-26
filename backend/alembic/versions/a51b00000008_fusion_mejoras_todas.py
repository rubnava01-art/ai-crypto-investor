"""Fusion mejoras-todas: une las dos cabezas tras el merge.

Revision ID: a51b00000008
Revises: a51b00000007, ef98abd287f8
Create Date: 2026-11-26

La rama mejoras-v1 (Fases 1-8) partia de b7c3e91a4f02 y terminaba en
a51b00000007; el contenido remoto sync #72 (servicios + calculadora)
partia del mismo b7c3e91a4f02 y terminaba en ef98abd287f8
(contact_messages). Al fusionar ambas ramas quedaban dos cabezas.
Esta revision de fusion (sin cambios de esquema) restaura una sola
cabeza: a51b00000008. Downgrade: no hace nada (no hay nada que
deshacer; las dos ramas padre siguen existiendo).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a51b00000008'
down_revision: Union[str, Sequence[str], None] = ('a51b00000007', 'ef98abd287f8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
