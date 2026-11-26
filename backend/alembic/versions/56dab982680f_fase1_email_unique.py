"""Fase 1 mejoras-v1, corrección F2 — users.email UNIQUE.

Revision ID: 56dab982680f
Revises: a3b7c2d4e5f6
Create Date: 2026-11-25

- UNIQUE uq_users_email sobre users.email: dos cuentas ya no pueden
  registrar/verificar el mismo correo. Postgres y SQLite permiten
  varios NULL, así que las cuentas sin correo (todas las viejas y los
  registros sin correo) no chocan.

Chequeo previo: antes de crear la restricción se buscan correos
duplicados (no nulos); si los hay, la migración ABORTA con la lista y
no crea nada — el operador resuelve los duplicados primero y reintenta.
Sin acceso a la BD de desarrollo (Neon) desde este entorno, la revisión
de datos reales queda PENDIENTE (ver informe de la corrección).

Guards "solo si falta" (patrón 9c2e7b4a1f08). Downgrade: borra la
restricción (sin tocar datos de usuarios).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '56dab982680f'
down_revision: Union[str, None] = 'a3b7c2d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = "uq_users_email"


def _unique_constraint_names(conn, table: str) -> set[str]:
    return {
        c["name"]
        for c in sa.inspect(conn).get_unique_constraints(table)
        if c["name"]
    }


def upgrade() -> None:
    conn = op.get_bind()
    # Chequeo previo: duplicados exactos (lo que la restricción
    # exige). Si los hay, abortar ANTES de crear nada.
    duplicates = conn.execute(
        sa.text(
            "SELECT email, COUNT(*) AS n FROM users "
            "WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if duplicates:
        detail = ", ".join(f"{email} (x{n})" for email, n in duplicates)
        raise RuntimeError(
            "uq_users_email: hay correos duplicados en users y la "
            f"migración no puede continuar: {detail}. Resuelve los "
            "duplicados (fusiona o borra las cuentas sobrantes) y "
            "reintenta la migración."
        )
    if CONSTRAINT_NAME not in _unique_constraint_names(conn, "users"):
        print(f"email-unique: adding constraint {CONSTRAINT_NAME} on users.email")
        # Batch mode: SQLite no admite ALTER de restricciones y la
        # migración se prueba sobre SQLite (el patrón de las demás
        # migraciones); en Postgres es un ALTER normal.
        with op.batch_alter_table("users") as batch_op:
            batch_op.create_unique_constraint(CONSTRAINT_NAME, ["email"])


def downgrade() -> None:
    conn = op.get_bind()
    if CONSTRAINT_NAME in _unique_constraint_names(conn, "users"):
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
