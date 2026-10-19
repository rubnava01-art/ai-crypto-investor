"""Regression test: seed_demo_data must not assume strategy_version id == 1.

On Postgres, a rolled-back insert advances the id sequence, so the seeded
StrategyVersion may not get id 1. The seed must use the row's real id for
demo signals (this exact failure took down the first Render deploy).
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.main import seed_demo_data
import app.main as mainmod
from app.models.tables import Signal, StrategyVersion


def _fk_engine(path):
    eng = create_engine(f"sqlite:///{path}")

    @event.listens_for(eng, "connect")
    def _fk_on(dbapi_con, _rec):
        dbapi_con.execute("PRAGMA foreign_keys=ON")

    return eng


def test_seed_uses_existing_strategy_version_id(tmp_path):
    eng = _fk_engine(tmp_path / "t1.db")
    Base.metadata.create_all(bind=eng)
    mk = sessionmaker(bind=eng)
    db = mk()
    # Simulate Postgres after a rolled-back insert: an existing strategy
    # version whose id is NOT 1, and no signals yet.
    db.add(StrategyVersion(id=7, name="trend-momentum", version="0.1.0",
                           config_json={}, status="draft", notes=""))
    db.commit()
    db.close()

    old_engine, old_session = mainmod.engine, mainmod.SessionLocal
    mainmod.engine = eng
    mainmod.SessionLocal = sessionmaker(bind=eng)
    try:
        seed_demo_data()  # must not raise IntegrityError
    finally:
        mainmod.engine, mainmod.SessionLocal = old_engine, old_session

    db = mk()
    try:
        signals = db.query(Signal).all()
        assert len(signals) == 2
        assert {s.strategy_version_id for s in signals} == {7}
    finally:
        db.close()


def test_seed_fresh_db_signals_match_created_version(tmp_path):
    eng = _fk_engine(tmp_path / "t2.db")
    Base.metadata.create_all(bind=eng)
    old_engine, old_session = mainmod.engine, mainmod.SessionLocal
    mainmod.engine = eng
    mainmod.SessionLocal = sessionmaker(bind=eng)
    try:
        seed_demo_data()
    finally:
        mainmod.engine, mainmod.SessionLocal = old_engine, old_session

    db = sessionmaker(bind=eng)()
    try:
        sv = db.query(StrategyVersion).one()
        signals = db.query(Signal).all()
        assert len(signals) == 2
        assert {s.strategy_version_id for s in signals} == {sv.id}
    finally:
        db.close()
