"""NEST — Test de migración Alembic 7df4aeb666c6 (plan conjunto §7).

Estilo _run_alembic de test_fase2_backend.py: BD temporal, upgrade a
head -> las columnas y tablas nuevas existen; downgrade a
4ee0458a0ceb -> desaparecen. No toca la BD de la suite.
"""
import os

import sqlalchemy as sa
from sqlalchemy import create_engine


def _run_alembic(db_file, target, downgrade=False):
    from alembic import command
    from alembic.config import Config

    from app.config import settings

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = Config()
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    old_url = settings.database_url
    # env.py sobrescribe sqlalchemy.url con settings.database_url: por
    # eso se muta el setting (y se restaura en finally).
    settings.database_url = f"sqlite:///{db_file}"
    try:
        if downgrade:
            command.downgrade(cfg, target)
        else:
            command.upgrade(cfg, target)
    finally:
        settings.database_url = old_url


def _columns(engine, table):
    insp = sa.inspect(engine)
    return {c["name"] for c in insp.get_columns(table)}


def _indexes(engine, table):
    insp = sa.inspect(engine)
    return {i["name"] for i in insp.get_indexes(table)}


def _fks(engine, table):
    insp = sa.inspect(engine)
    return {
        (fk["constrained_columns"][0], fk["referred_table"])
        for fk in insp.get_foreign_keys(table)
    }


NEW_TABLES = (
    "appointments",
    "marketing_campaigns",
    "content_ideas",
    "content_templates",
    "content_items",
    "business_costs",
)


def test_migracion_nest_upgrade_head(tmp_path):
    db_file = tmp_path / "nest.db"
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        # Columnas nuevas en tablas existentes
        assert "user_id" in _columns(engine, "crm_contacts")
        assert "contact_id" in _columns(engine, "invoices")
        # FKs
        assert ("user_id", "users") in _fks(engine, "crm_contacts")
        assert ("contact_id", "crm_contacts") in _fks(engine, "invoices")
        # Índices nuevos
        assert "ix_crm_contacts_user_id" in _indexes(engine, "crm_contacts")
        assert "ix_invoices_contact_id" in _indexes(engine, "invoices")
        assert "ix_invoices_created_at" in _indexes(engine, "invoices")
        assert "ix_invoices_status" in _indexes(engine, "invoices")
        # Tablas nuevas con sus columnas clave
        tables = set(sa.inspect(engine).get_table_names())
        for name in NEW_TABLES:
            assert name in tables, name
        assert "starts_at" in _columns(engine, "appointments")
        assert "channel" in _columns(engine, "marketing_campaigns")
        assert "body" in _columns(engine, "content_templates")
        assert "scheduled_at" in _columns(engine, "content_items")
        assert "amount" in _columns(engine, "business_costs")
        assert "ix_appointments_starts_at" in _indexes(engine, "appointments")
        assert "ix_business_costs_date" in _indexes(engine, "business_costs")
    finally:
        engine.dispose()


def test_migracion_nest_downgrade_a_4ee0458a0ceb(tmp_path):
    db_file = tmp_path / "nest-down.db"
    _run_alembic(db_file, "head")
    _run_alembic(db_file, "4ee0458a0ceb", downgrade=True)
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        assert "user_id" not in _columns(engine, "crm_contacts")
        assert "contact_id" not in _columns(engine, "invoices")
        tables = set(sa.inspect(engine).get_table_names())
        for name in NEW_TABLES:
            assert name not in tables, name
        # Lo anterior a la migración sigue intacto
        assert "bio" in _columns(engine, "users")
    finally:
        engine.dispose()


def test_migracion_nest_upgrade_idempotente_sobre_create_all(tmp_path):
    """BD existente simulada: create_all ya creó las tablas nuevas y
    las columnas; upgrade head debe ser un no-op sin errores."""
    from app.models.tables import Base

    db_file = tmp_path / "nest-mixed.db"
    _run_alembic(db_file, "4ee0458a0ceb")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        engine.dispose()
    _run_alembic(db_file, "head")
    engine = create_engine(f"sqlite:///{db_file}")
    try:
        assert "user_id" in _columns(engine, "crm_contacts")
        assert "contact_id" in _columns(engine, "invoices")
        tables = set(sa.inspect(engine).get_table_names())
        for name in NEW_TABLES:
            assert name in tables, name
    finally:
        engine.dispose()
