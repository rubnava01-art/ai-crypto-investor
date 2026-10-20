"""AI Crypto Investor — Phase 1 API skeleton (+ Phase 2 market data)."""
import asyncio
import datetime as dt
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.security import hash_password
from app.core.state import state
from app.data import ingest
from app.database import Base, SessionLocal, engine
from app.models.tables import Signal, StrategyVersion, SystemEvent, User


def seed_demo_data() -> None:
    """Create tables and seed the admin user + DEMO content (Phase 1 only)."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            pwd_hash = settings.admin_password_hash or hash_password("admin")
            db.add(
                User(
                    username=settings.admin_username,
                    password_hash=pwd_hash,
                    is_admin=True,
                )
            )
        # Demo read-only "prueba" account (view + tests only, no controls).
        if db.query(User).filter(User.username == "prueba").first() is None:
            db.add(
                User(
                    username="prueba",
                    password_hash=hash_password("prueba"),
                    is_admin=False,
                )
            )
        sv = db.query(StrategyVersion).order_by(StrategyVersion.id).first()
        if sv is None:
            sv = StrategyVersion(
                name="trend-momentum",
                version="0.1.0",
                config_json={
                    "timeframe": "1h",
                    "symbols": ["BTC/USD", "ETH/USD"],
                    "max_trades_per_day": 3,
                },
                status="draft",
                notes="DEMO skeleton — real strategy logic arrives in Phase 3.",
            )
            db.add(sv)
            db.flush()  # populate sv.id (never assume it is 1: the sequence may
            # have advanced after a rolled-back insert, e.g. on Postgres)
        if db.query(Signal).count() == 0:
            now = dt.datetime.now(dt.timezone.utc)
            db.add_all(
                [
                    Signal(
                        strategy_version_id=sv.id,
                        symbol="BTC/USD",
                        side="hold",
                        reason="DEMO: waiting for real market data (Phase 2).",
                        status="demo",
                        created_at=now,
                    ),
                    Signal(
                        strategy_version_id=sv.id,
                        symbol="ETH/USD",
                        side="hold",
                        reason="DEMO: waiting for real market data (Phase 2).",
                        status="demo",
                        created_at=now,
                    ),
                ]
            )
        if db.query(SystemEvent).count() == 0:
            db.add(
                SystemEvent(
                    level="info",
                    category="system",
                    message="Phase 1 skeleton initialized. All data shown is DEMO.",
                )
            )
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_demo_data()
    task = asyncio.create_task(_scanner_loop())
    yield
    task.cancel()


async def _scanner_loop() -> None:
    """Phase 2: while the scanner flag is on, ingest 1h candles every 60s.

    Runs in-process (single worker assumption, declared in README).
    """
    await asyncio.sleep(5)  # let the app finish starting
    while True:
        try:
            if state.scanner_running:
                db = SessionLocal()
                try:
                    for symbol in ("BTC/USD", "ETH/USD"):
                        try:
                            ingest.ingest_ohlcv(db, "kraken", symbol, "1h", limit=100)
                        except Exception as e:  # noqa: BLE001 - never kill the loop
                            db.add(
                                SystemEvent(
                                    level="warn",
                                    category="scanner",
                                    message=f"ingest failed for {symbol}: {type(e).__name__}",
                                )
                            )
                            db.commit()
                    # Continuous paper trading (Phase 4)
                    if state.simulation_mode == "paper":
                        try:
                            from app.paper import trader as paper_trader

                            summary = paper_trader.paper_cycle(db)
                            if summary["opened"] or summary["closed"]:
                                db.add(
                                    SystemEvent(
                                        level="info",
                                        category="paper",
                                        message=f"paper cycle: opened={summary['opened']} closed={summary['closed']}",
                                    )
                                )
                                db.commit()
                        except Exception as e:  # noqa: BLE001
                            db.rollback()
                            db.add(
                                SystemEvent(
                                    level="error",
                                    category="paper",
                                    message=f"paper cycle failed: {type(e).__name__}",
                                )
                            )
                            db.commit()
                finally:
                    db.close()
        except Exception:  # noqa: BLE001 - loop must survive
            pass
        await asyncio.sleep(60)


def create_app() -> FastAPI:
    from app.ai import api as ai_api
    from app.api import auth, backtest, exchange, market, misc, portfolio, signals, strategy, system, users

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    from app.core.hardening import SecurityHeadersMiddleware
    from app.core.metrics import MetricsMiddleware

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(MetricsMiddleware)
    app.include_router(auth.router)
    app.include_router(system.router)
    app.include_router(portfolio.router)
    app.include_router(signals.router)
    app.include_router(misc.strategies_router)
    app.include_router(misc.scanner_router)
    app.include_router(misc.simulation_router)
    app.include_router(misc.operations_router)
    app.include_router(misc.risk_router)
    app.include_router(misc.logs_router)
    app.include_router(market.router)
    app.include_router(strategy.router)
    app.include_router(backtest.router)
    app.include_router(exchange.router)
    app.include_router(users.router)
    app.include_router(ai_api.router)
    return app


app = create_app()
