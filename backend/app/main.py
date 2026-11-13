"""Grow Business Platform — Phase 1 API skeleton (+ Phase 2 market data)."""
import asyncio
import datetime as dt
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.config import (
    assert_production_secrets,
    build_git_sha,
    settings,
    validate_cors_origins,
)

logger = logging.getLogger("ai-crypto-investor")
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
        # Super admin tier (Acceso, 2026-10-26): the owner admin account
        # holds the top tier. Runs on every startup (not only on empty DB)
        # so existing databases gain it without a migration.
        from app.models.tables import SuperAdminGrant

        owner = db.query(User).filter(User.username == settings.admin_username).first()
        if owner is not None and (
            db.query(SuperAdminGrant)
            .filter(SuperAdminGrant.user_id == owner.id)
            .first()
            is None
        ):
            db.add(SuperAdminGrant(user_id=owner.id))
            db.commit()
        # Demo read-only "prueba" account (view + tests only, no controls).
        # Decisión de Rubén 2026-11-02: la siembra ocurre SOLO con el flag
        # explícito SEED_DEMO_ACCOUNTS=true Y fuera de producción. En
        # producción nunca se crea. Una fila "prueba" que ya exista en la
        # base NO se borra aquí: borrarla es destructivo y necesita su
        # palabra aparte; solo se deja de sembrar.
        if settings.seed_demo_accounts and settings.environment != "production":
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
        # Grow Business Platform — Fase 2: seed the REAL Academia catalog
        # (Hotmart ebooks + Pack + Academy) into the Estudiar module.
        from app.api.academy import seed_academy_catalog

        seed_academy_catalog(db)
        # Grow Business Platform — Fase 3: seed the trends panel with the
        # topics Rubén actually published on Threads (vía @tecnologia).
        from app.api.crear import seed_trend_notes

        seed_trend_notes(db)
        # Módulo Privacidad (2026-10-28): seed the compliance checklist
        # Rubén defined (20 items in 6 categories) when empty.
        from app.api.privacidad import seed_privacidad_items

        seed_privacidad_items(db)
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail closed en producción antes de sembrar nada (corrida 3 agentes).
    assert_production_secrets()
    seed_demo_data()
    # Fase 2/3: restore persisted runtime state + reconcile crash
    # leftovers BEFORE the scanner loop starts, so the loop never runs
    # on reset (in-memory) state. Never breaks boot: a failure here is
    # logged, not fatal — the app must still serve (the old behavior
    # was "reset state", which is the safe fallback).
    db = SessionLocal()
    try:
        from app.core.runtime import reconcile_stale_pending_orders, restore_runtime_state

        summary = restore_runtime_state(db)
        stale = reconcile_stale_pending_orders(db)
        logger.info(
            "build git_sha=%s runtime=%s stale_pending_reconciled=%s",
            build_git_sha(),
            summary,
            stale,
        )
    except Exception:  # noqa: BLE001 - boot must not die on restore
        logger.exception("runtime restore/reconciliation failed; using in-memory state")
    finally:
        db.close()
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
            # Retention (Fase 3, M5): at most once a day, best-effort,
            # independent of the scanner flag — growth tables prune even
            # when the scanner is off.
            try:
                from app.core.retention import maybe_daily_prune

                _ret_db = SessionLocal()
                try:
                    maybe_daily_prune(_ret_db)
                finally:
                    _ret_db.close()
            except Exception:  # noqa: BLE001 - retention never kills the loop
                pass
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
    from app.api import academy, ajustador, analizador, auth, auditor, backtest, business, chat, clases, correos, crear, crm, dashboard, desarrollo, espacio, exchange, facturas, inicio, inventario, market, misc, portfolio, privacidad, profile, recomendaciones, referrals, signals, strategy, system, talento_riesgos_planillas, tendencias, users

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )

    # Handlers globales (corrida 3 agentes): un IntegrityError ya no es un
    # 500 crudo sino un 409 explicable, y cualquier otro fallo inesperado
    # devuelve un 500 con ID de correlación sin filtrar trazas al cliente.
    # Las HTTPException existentes no se ven afectadas (su handler propio
    # tiene prioridad en Starlette).
    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request, exc):
        return JSONResponse(
            status_code=409,
            content={
                "detail": "La operación viola una regla de integridad de datos "
                "(registro relacionado o duplicado)."
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request, exc):
        error_id = uuid.uuid4().hex[:12]
        logger.exception(
            "unhandled error [%s] %s %s", error_id, request.method, request.url.path
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Error interno del servidor.", "error_id": error_id},
        )
    # Fail closed (Fase 3, M11): '*' + credentials must never serve.
    validate_cors_origins(settings.cors_origins)
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
    # M4 (2026-11-13): Cache-Control: private, max-age=60 ONLY on the
    # explicitly allowlisted near-static GETs (see
    # app/core/cache_control.py). No-store stays the default elsewhere.
    from app.core.cache_control import CacheControlMiddleware

    app.add_middleware(CacheControlMiddleware)
    # Added last = outermost: compresses every JSON response (typical
    # list/dashboard payloads shrink ~70-80% on the wire). Binary PDF
    # downloads are already compressed and stay untouched in practice.
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    # Outermost of all (added last): global 120s request timeout (M16).
    from app.core.timeout import RequestTimeoutMiddleware

    app.add_middleware(RequestTimeoutMiddleware)
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
    app.include_router(crm.router)
    app.include_router(academy.router)
    app.include_router(crear.router)
    app.include_router(referrals.router)
    app.include_router(business.router)
    app.include_router(espacio.router)
    app.include_router(facturas.router)
    app.include_router(clases.router)
    app.include_router(correos.router)
    app.include_router(dashboard.router)
    app.include_router(profile.router)
    app.include_router(chat.router)
    app.include_router(recomendaciones.router)
    app.include_router(desarrollo.router)
    app.include_router(tendencias.router)
    app.include_router(auditor.router)
    app.include_router(privacidad.router)
    app.include_router(inicio.router)
    app.include_router(inventario.router)
    app.include_router(talento_riesgos_planillas.talento_router)
    app.include_router(talento_riesgos_planillas.riesgos_router)
    app.include_router(talento_riesgos_planillas.planillas_router)
    app.include_router(ajustador.ajustes_router)
    app.include_router(ajustador.videos_router)
    app.include_router(analizador.router)
    app.include_router(ai_api.router)
    return app


app = create_app()
