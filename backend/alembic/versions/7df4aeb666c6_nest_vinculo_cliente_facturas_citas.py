"""NEST — vínculo usuario↔cliente + facturas por cliente + 6 tablas nuevas

Revision ID: 7df4aeb666c6
Revises: 4ee0458a0ceb
Create Date: 2026-11-17

Corrida multiagente 2026-11-17 (plan conjunto §1): los 4 módulos NEST
viven dentro de Negocio > Marketing, paraguas /api/business/marketing/*.

1. `crm_contacts.user_id` INTEGER NULL, FK→`users.id`, UNIQUE, índice.
   Backfill NULL: el admin liga a mano; nunca se empareja por email.
2. `invoices.contact_id` INTEGER NULL, FK→`crm_contacts.id`
   ON DELETE SET NULL, índice. Backfill NULL.
3. Índices `ix_invoices_created_at`, `ix_invoices_status`.
4. Tablas nuevas (§2 del plan): appointments, marketing_campaigns,
   content_ideas, content_templates, content_items, business_costs.

Las tablas nuevas TAMBIÉN se crean aquí (guardadas, solo si faltan),
aunque `create_all` las cree al arrancar: el test
`test_fresh_migration_head_equals_models` exige que el esquema migrado
desde cero sea idéntico a los modelos, y sin esto la migración fresca
no tendría las 6 tablas. El patrón es el de `a918a20d8191` /
`f3a2c91d7b4e`: crear la tabla desde el modelo cuando falta, añadir
solo las columnas que falten cuando ya existe, nunca alterar nada más.

Guards "solo si falta" en todo (mismo patrón que `4ee0458a0ceb`): la
migración es segura sobre BD fresca y sobre BD existente donde
`create_all` ya creó las tablas nuevas.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7df4aeb666c6'
down_revision: Union[str, None] = '4ee0458a0ceb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TABLES = (
    "appointments",
    "marketing_campaigns",
    "content_ideas",
    "content_templates",
    "content_items",
    "business_costs",
)

# (tabla, nombre de índice, columnas) en tablas existentes.
_INDEXES = (
    ("crm_contacts", "ix_crm_contacts_user_id", ["user_id"]),
    ("invoices", "ix_invoices_contact_id", ["contact_id"]),
    ("invoices", "ix_invoices_created_at", ["created_at"]),
    ("invoices", "ix_invoices_status", ["status"]),
)


def _table_names(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def _unique_names(conn, table: str) -> set[str]:
    return {u["name"] for u in sa.inspect(conn).get_unique_constraints(table)}


def _fk_names(conn, table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(conn).get_foreign_keys(table)}


def _has_duplicates(conn, table: str, columns: list[str]) -> bool:
    cols = ", ".join(columns)
    sql = (
        f"SELECT COUNT(*) FROM (SELECT {cols} FROM {table} "
        f"WHERE {cols} IS NOT NULL "
        f"GROUP BY {cols} HAVING COUNT(*) > 1) AS dup"
    )
    return (conn.execute(sa.text(sql)).scalar() or 0) > 0


def _create_table_from_model(table) -> None:
    """Create one missing table exactly as the model defines it
    (columns + PK + FKs + unique constraints), patrón f3a2c91d7b4e."""
    columns = []
    for c in table.columns:
        kwargs: dict = {"nullable": c.nullable, "primary_key": c.primary_key}
        columns.append(sa.Column(c.name, c.type, **kwargs))
    constraints = []
    for fk in table.foreign_keys:
        constraints.append(
            sa.ForeignKeyConstraint(
                [fk.parent.name],
                [f"{fk.column.table.name}.{fk.column.name}"],
                ondelete=fk.ondelete,
            )
        )
    for constraint in table.constraints:
        if isinstance(constraint, sa.UniqueConstraint):
            constraints.append(
                sa.UniqueConstraint(
                    *[col.name for col in constraint.columns],
                    name=constraint.name,
                )
            )
    op.create_table(table.name, *columns, *constraints)


def _create_table_indexes(conn, table) -> None:
    """Create the model's __table_args__ indexes for a table."""
    present = _index_names(conn, table.name)
    for idx in table.indexes:
        if idx.name not in present:
            op.create_index(idx.name, table.name, [c.name for c in idx.columns])


def _add_missing_columns(conn, table) -> None:
    existing = _column_names(conn, table.name)
    for c in table.columns:
        if c.name not in existing:
            print(f"nest: adding missing column {table.name}.{c.name}")
            op.add_column(table.name, sa.Column(c.name, c.type, nullable=True))


def _create_fk(conn, table: str, name: str, column: str, referred: str,
               ondelete: str | None = None) -> None:
    """Create an FK if missing. SQLite needs batch mode (copy-and-move);
    Postgres takes the plain op. Never breaks the boot chain: on
    failure warns and continues (the API still validates the link).

    La guarda es por (columna, tabla referida), no solo por nombre:
    en una BD fresca la migración base f3a2c91d7b4e ya crea la tabla
    con la FK del modelo (sin nombre), y añadirla otra vez la
    duplicaría."""
    ref_table, ref_col = referred.split(".")
    for fk in sa.inspect(conn).get_foreign_keys(table):
        if (
            fk.get("constrained_columns") == [column]
            and fk.get("referred_table") == ref_table
        ):
            return
    if name in _fk_names(conn, table):
        return
    try:
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table(table) as batch_op:
                batch_op.create_foreign_key(
                    name, ref_table, [column], [ref_col], ondelete=ondelete
                )
        else:
            op.create_foreign_key(
                name, table, ref_table, [column], [ref_col], ondelete=ondelete
            )
    except Exception as e:  # noqa: BLE001 - boot must not die on an FK
        print(f"WARNING nest: could not create FK {name} on {table}: {e}")


def _drop_column(conn, table: str, column: str) -> None:
    """Drop a column; SQLite needs batch mode for ALTER TABLE."""
    try:
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_column(column)
        else:
            op.drop_column(table, column)
    except Exception as e:  # noqa: BLE001 - downgrade best-effort
        print(f"WARNING nest downgrade: could not drop {table}.{column}: {e}")


def _create_unique(conn, name: str, table: str, columns: list[str]) -> None:
    # Guarda por columnas (no solo por nombre): create_all ya crea el
    # UNIQUE de la columna sin nombre; crearlo otra vez lo duplicaría.
    for u in sa.inspect(conn).get_unique_constraints(table):
        if list(u.get("column_names") or []) == columns:
            return
    if name in _unique_names(conn, table):
        return
    if _has_duplicates(conn, table, columns):
        print(
            f"WARNING nest: duplicate values in {table}.{columns}; "
            f"SKIPPING unique constraint {name} (API still enforces it)."
        )
        return
    try:
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table(table) as batch_op:
                batch_op.create_unique_constraint(name, columns)
        else:
            op.create_unique_constraint(name, table, columns)
    except Exception as e:  # noqa: BLE001 - boot must not die on a unique
        print(f"WARNING nest: could not create unique {name}: {e}")


def _drop_constraint_best_effort(conn, table: str, name: str, type_: str) -> None:
    try:
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_constraint(name, type_=type_)
        else:
            op.drop_constraint(name, table, type_=type_)
    except Exception as e:  # noqa: BLE001 - downgrade best-effort
        print(f"WARNING nest downgrade: could not drop {name} on {table}: {e}")


def upgrade() -> None:
    from app.models.tables import Base

    conn = op.get_bind()

    # 1. Columnas nuevas en tablas existentes (guardadas).
    if "crm_contacts" in _table_names(conn):
        if "user_id" not in _column_names(conn, "crm_contacts"):
            op.add_column(
                "crm_contacts", sa.Column("user_id", sa.Integer(), nullable=True)
            )
    if "invoices" in _table_names(conn):
        if "contact_id" not in _column_names(conn, "invoices"):
            op.add_column(
                "invoices", sa.Column("contact_id", sa.Integer(), nullable=True)
            )

    # 2. FKs (guardadas; ON DELETE SET NULL para invoices.contact_id:
    # la factura conserva su snapshot si se borra el contacto).
    if "crm_contacts" in _table_names(conn):
        _create_fk(
            conn, "crm_contacts", "fk_crm_contacts_user_id_users",
            "user_id", "users.id",
        )
    if "invoices" in _table_names(conn):
        _create_fk(
            conn, "invoices", "fk_invoices_contact_id_crm_contacts",
            "contact_id", "crm_contacts.id", ondelete="SET NULL",
        )

    # 3. UNIQUE en crm_contacts.user_id (1 usuario ↔ 1 contacto).
    if "crm_contacts" in _table_names(conn):
        _create_unique(conn, "uq_crm_contacts_user_id", "crm_contacts", ["user_id"])

    # 4. Índices en tablas existentes (guardados).
    for table_name, index_name, columns in _INDEXES:
        if table_name not in _table_names(conn):
            continue
        if index_name not in _index_names(conn, table_name):
            op.create_index(index_name, table_name, columns)

    # 5. Tablas nuevas: crear desde el modelo si faltan; si ya existen
    # (create_all corrió antes), solo completar columnas/índices.
    existing = _table_names(conn)
    for name in _NEW_TABLES:
        table = Base.metadata.tables[name]
        if name not in existing:
            print(f"nest: creating table {name}")
            _create_table_from_model(table)
            _create_table_indexes(conn, table)
        else:
            _add_missing_columns(conn, table)
            _create_table_indexes(conn, table)


def downgrade() -> None:
    conn = op.get_bind()
    tables = _table_names(conn)

    # 1. Tablas nuevas (orden seguro por FK: content_items referencia
    # ideas/plantillas/copies; el resto no se referencia entre sí).
    for name in (
        "content_items",
        "business_costs",
        "content_templates",
        "content_ideas",
        "marketing_campaigns",
        "appointments",
    ):
        if name in tables:
            op.drop_table(name)

    # 2. Índices en tablas existentes.
    for table_name, index_name, _columns in _INDEXES:
        if table_name in tables and index_name in _index_names(conn, table_name):
            try:
                op.drop_index(index_name, table_name=table_name)
            except Exception as e:  # noqa: BLE001 - downgrade best-effort
                print(f"WARNING nest downgrade: could not drop index {index_name}: {e}")

    # 3. UNIQUE + FKs.
    if "crm_contacts" in tables:
        if "uq_crm_contacts_user_id" in _unique_names(conn, "crm_contacts"):
            _drop_constraint_best_effort(
                conn, "crm_contacts", "uq_crm_contacts_user_id", "unique"
            )
        if "fk_crm_contacts_user_id_users" in _fk_names(conn, "crm_contacts"):
            _drop_constraint_best_effort(
                conn, "crm_contacts", "fk_crm_contacts_user_id_users", "foreignkey"
            )
    if "invoices" in tables:
        if "fk_invoices_contact_id_crm_contacts" in _fk_names(conn, "invoices"):
            _drop_constraint_best_effort(
                conn, "invoices", "fk_invoices_contact_id_crm_contacts", "foreignkey"
            )

    # 4. Columnas (patrón 4ee0458a0ceb; batch en SQLite).
    if "crm_contacts" in tables and "user_id" in _column_names(conn, "crm_contacts"):
        _drop_column(conn, "crm_contacts", "user_id")
    if "invoices" in tables and "contact_id" in _column_names(conn, "invoices"):
        _drop_column(conn, "invoices", "contact_id")
