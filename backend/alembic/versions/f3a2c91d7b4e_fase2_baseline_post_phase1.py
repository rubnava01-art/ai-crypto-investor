"""Fase 2 baseline: post-Phase-1 tables/columns + indexes + uniques.

Revision ID: f3a2c91d7b4e
Revises: d485eb364382
Create Date: 2026-11-02

Why this migration exists (A4): after Phase 1, every new module table
(revelations, invoices, referrals, ...) and every new column only
existed because `Base.metadata.create_all()` runs at startup — and
create_all NEVER adds a column to an existing table. The next column
change on an existing table would have silently failed in production
while /api/health stayed green. This migration makes the schema
explicit: after it, the migrated schema equals the models.

CRITICAL SAFETY (the Dockerfile runs `alembic upgrade head && uvicorn`,
so a failing migration = total API outage): EVERY step here is
inspect-first — create only what is missing, add only missing columns,
create only missing indexes/uniques. It must succeed on ALL THREE
database states:
  1. Fresh DB: only the 6 old migrations applied (tables missing).
  2. Simulated production: 6 old migrations + create_all for the later
     tables (tables present, columns present).
  3. Real production (Postgres): same as (2) plus real rows.
Uniques are skip-or-warn, NEVER break: if duplicates already exist,
the constraint is skipped with a printed warning and the upgrade
continues (the API enforces the same rules, so behavior never depends
on the constraint alone).

How tables are created: derived from the model metadata itself (not
hand-transcribed), so a transcription typo cannot drift the schema
from the models. The models-vs-head test (tests/test_migrations_fase2.py)
fails if they ever diverge again.

Downgrade note: it removes ONLY what this migration owns (the two new
tables, the indexes, the uniques, users.token_version). It deliberately
does NOT drop the post-Phase-1 tables: those predate this migration
and hold user data created via create_all — dropping them on downgrade
would destroy data this migration never created.
"""

import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = 'f3a2c91d7b4e'
down_revision: Union[str, None] = 'd485eb364382'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Explicit indexes (Fase 3, M6): hot ORDER BY created_at DESC listings
# and hot FK joins. Names match the model Index definitions.
_INDEXES: list[tuple[str, str, list[str]]] = [
    ("signals", "ix_signals_created_at", ["created_at"]),
    ("risk_decisions", "ix_risk_decisions_signal_id", ["signal_id"]),
    ("orders", "ix_orders_created_at", ["created_at"]),
    ("orders", "ix_orders_mode_symbol_status", ["mode", "symbol", "status"]),
    ("fills", "ix_fills_order_id", ["order_id"]),
    ("system_events", "ix_system_events_created_at", ["created_at"]),
    ("audit_logs", "ix_audit_logs_user_id", ["user_id"]),
    ("referrals", "ix_referrals_campaign_id", ["campaign_id"]),
    ("home_comments", "ix_home_comments_post_id", ["post_id"]),
    ("trend_searches", "ix_trend_searches_user_id", ["user_id"]),
]


def _table_names(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _column_names(conn, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _index_names(conn, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(conn).get_indexes(table)}


def _unique_names(conn, table: str) -> set[str]:
    return {u["name"] for u in sa.inspect(conn).get_unique_constraints(table)}


def _row_count(conn, table: str) -> int:
    return conn.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0


def _create_unique(conn, name: str, table: str, columns: list[str]) -> None:
    """Create a unique constraint portably. SQLite has no ALTER for
    constraints: batch mode (copy-and-move) is required there, while
    Postgres takes the plain op. Without this branch the migration
    dies on SQLite with NotImplementedError."""
    if conn.dialect.name == "sqlite":
        with op.batch_alter_table(table) as batch_op:
            batch_op.create_unique_constraint(name, columns)
    else:
        op.create_unique_constraint(name, table, columns)


def _drop_unique(conn, name: str, table: str) -> None:
    """Best-effort portable unique drop (used by downgrade only)."""
    try:
        if conn.dialect.name == "sqlite":
            with op.batch_alter_table(table) as batch_op:
                batch_op.drop_constraint(name, type_="unique")
        else:
            op.drop_constraint(name, table, type_="unique")
    except Exception as e:  # noqa: BLE001 - downgrade best-effort
        print(f"WARNING fase2-baseline downgrade: could not drop {name}: {e}")


def _has_duplicates(conn, table: str, columns: list[str], where: str = "") -> bool:
    cols = ", ".join(columns)
    sql = (
        f"SELECT COUNT(*) FROM (SELECT {cols} FROM {table} "
        + (f"WHERE {where} " if where else "")
        + f"GROUP BY {cols} HAVING COUNT(*) > 1) AS dup"
    )
    return (conn.execute(sa.text(sql)).scalar() or 0) > 0


def _create_table_from_model(table) -> None:
    """Create one missing table exactly as the model defines it
    (columns + PK + FKs + unique constraints)."""
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


def _add_missing_columns(conn, table) -> None:
    """Add model columns missing from an existing table (the A4 case:
    users.token_version on a live users table)."""
    existing = _column_names(conn, table.name)
    has_rows = _row_count(conn, table.name) > 0
    for c in table.columns:
        if c.name in existing:
            continue
        kwargs: dict = {"nullable": c.nullable}
        if table.name == "users" and c.name == "token_version":
            # Existing users must get 0, not NULL, on a NOT NULL column.
            kwargs["server_default"] = sa.text("0")
        elif has_rows and not c.nullable:
            # Never fail the boot chain on an unexpected non-nullable
            # column: add it nullable and warn loudly instead.
            print(
                f"WARNING fase2-baseline: adding {table.name}.{c.name} "
                "as NULLABLE (table has rows, no server default); "
                "review nullability manually."
            )
            kwargs["nullable"] = True
        op.add_column(table.name, sa.Column(c.name, c.type, **kwargs))


def upgrade() -> None:
    # Imported here (not at module top): env.py already puts backend/
    # on sys.path and loads settings before migrations run.
    from app.models.tables import Base

    conn = op.get_bind()
    existing = _table_names(conn)

    # 1. Tables: create what is missing, complete what drifted.
    for table in Base.metadata.tables.values():
        if table.name not in existing:
            print(f"fase2-baseline: creating table {table.name}")
            _create_table_from_model(table)
        else:
            _add_missing_columns(conn, table)

    # 2. Explicit indexes (idempotent).
    for table_name, index_name, columns in _INDEXES:
        if table_name not in _table_names(conn):
            continue
        if index_name not in _index_names(conn, table_name):
            op.create_index(index_name, table_name, columns)

    # 3. Uniques, skip-or-warn on duplicates (never break the boot).
    # 3a. invoices.number
    if "invoices" in _table_names(conn):
        if "uq_invoices_number" not in _unique_names(conn, "invoices"):
            if _has_duplicates(conn, "invoices", ["number"]):
                print(
                    "WARNING fase2-baseline: duplicate invoice numbers "
                    "exist; SKIPPING unique constraint uq_invoices_number "
                    "(API still enforces uniqueness on new invoices)."
                )
            else:
                _create_unique(conn, "uq_invoices_number", "invoices", ["number"])
    # 3b. inventory_items.sku (empty SKUs included: any repeat blocks it)
    if "inventory_items" in _table_names(conn):
        if "uq_inventory_items_sku" not in _unique_names(conn, "inventory_items"):
            if _has_duplicates(conn, "inventory_items", ["sku"]):
                print(
                    "WARNING fase2-baseline: duplicate SKUs exist; "
                    "SKIPPING unique constraint uq_inventory_items_sku "
                    "(API still enforces uniqueness on new non-empty SKUs)."
                )
            else:
                _create_unique(conn, "uq_inventory_items_sku", "inventory_items", ["sku"])
    # 3c. Idempotency scope (user_id, route, key) replaces the old
    # global unique on key alone (M4). On Postgres the old constraint
    # is dropped; on SQLite it cannot be dropped without a table
    # rebuild, so it is left (stricter, harmless) and the composite is
    # still created for uniformity.
    if "idempotency_keys" in _table_names(conn):
        uniques = _unique_names(conn, "idempotency_keys")
        if "uq_idempotency_user_route_key" not in uniques:
            _create_unique(
                conn,
                "uq_idempotency_user_route_key",
                "idempotency_keys",
                ["user_id", "route", "key"],
            )
        if conn.dialect.name == "postgresql" and "idempotency_keys_key_key" in uniques:
            op.drop_constraint(
                "idempotency_keys_key_key", "idempotency_keys", type_="unique"
            )
    # 3d. Referral dedup (campaign_id, referred_contact), partial: only
    # rows with a contact participate (empty contacts stay exempt).
    if "referrals" in _table_names(conn):
        if "uq_referral_campaign_contact" not in _index_names(conn, "referrals"):
            if _has_duplicates(
                conn, "referrals", ["campaign_id", "referred_contact"],
                where="referred_contact <> ''",
            ):
                print(
                    "WARNING fase2-baseline: duplicate (campaign, contact) "
                    "referrals exist; SKIPPING partial unique index "
                    "uq_referral_campaign_contact (API still dedups new rows)."
                )
            else:
                op.execute(
                    sa.text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "uq_referral_campaign_contact ON referrals "
                        "(campaign_id, referred_contact) "
                        "WHERE referred_contact <> ''"
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    tables = _table_names(conn)

    def _drop_index_if_exists(table: str, name: str) -> None:
        if table in tables and name in _index_names(conn, table):
            op.drop_index(name, table_name=table)

    def _drop_unique_if_exists(table: str, name: str) -> None:
        if table in tables and name in _unique_names(conn, table):
            _drop_unique(conn, name, table)

    # Partial referral index (an index, not a constraint).
    _drop_index_if_exists("referrals", "uq_referral_campaign_contact")
    _drop_unique_if_exists("invoices", "uq_invoices_number")
    _drop_unique_if_exists("inventory_items", "uq_inventory_items_sku")
    _drop_unique_if_exists("idempotency_keys", "uq_idempotency_user_route_key")
    for table_name, index_name, _columns in _INDEXES:
        _drop_index_if_exists(table_name, index_name)
    if "users" in tables and "token_version" in _column_names(conn, "users"):
        op.drop_column("users", "token_version")
    # Only the tables this migration OWNS (new in Fase 2). Post-Phase-1
    # tables are deliberately left alone (see module docstring).
    for table_name in ("runtime_settings", "real_cap_counters"):
        if table_name in tables:
            op.drop_table(table_name)
