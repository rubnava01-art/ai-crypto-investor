"""System status endpoints. /api/health is public; /api/system/* need auth.

Fase 3 (M14): health and system status used to disagree — health said
"live" when the real flag was on while system_status hardcoded
mode="demo", exchange_connected=False, data_source="DEMO" always. Now
both derive from the same facts: mode follows the real-trading flag,
exchange_connected follows the read-only adapter configuration (no
network call), and health carries the build git_sha + timestamp so a
stale Render deploy is visible instead of guessed.
"""
import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import database
from app.config import build_git_sha, build_timestamp_utc, settings
from app.core.security import get_current_user, require_admin
from app.core.state import state
from app.database import get_db
from app.exchange import adapter
from app.models.tables import User
from app.schemas.api import HealthResponse, SystemStatus, utc_now_iso

router = APIRouter(tags=["system"])


def _database_status() -> str:
    """Ping ligero a la BD (SELECT 1). "ok" si responde, "error" si no.

    2026-11-05: la caída de la API del 3–4 de noviembre no dejaba saber
    si la base de datos estaba implicada; health ahora lo dice en claro.
    """
    try:
        with database.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "error"


@router.get("/api/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        version=settings.app_version,
        mode="live" if settings.real_trading_enabled else "demo",
        timestamp_utc=utc_now_iso(),
        git_sha=build_git_sha(),
        built_utc=build_timestamp_utc(),
        database=_database_status(),
    )


@router.get("/api/system/status", response_model=SystemStatus)
def system_status(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    live = bool(settings.real_trading_enabled)
    return SystemStatus(
        mode="live" if live else "demo",
        exchange_connected=adapter.is_configured(),
        scanner_running=state.scanner_running,
        simulation_mode=state.simulation_mode,  # type: ignore[arg-type]
        kill_switch=state.kill_switch,
        data_source="LIVE" if live else "DEMO",
        # Fase 5 (2026-11-23, P2-2): última ingesta REAL, no now().
        # Máxima open_time de las velas guardadas; si aún no hay
        # velas, último evento de scanner; si tampoco hay, None
        # ("sin ingesta todavía") en vez de una hora inventada.
        last_update_utc=_last_ingest_utc(db),
    )


def _last_ingest_utc(db: Session | None) -> str | None:
    """Última ingesta real de mercado (o None si nunca hubo).

    Si `db` no es una sesión real (llamada directa sin sesión, p.
    ej. desde otro handler), abre una propia con SessionLocal.
    """
    from sqlalchemy import func

    from app.models.tables import MarketCandle, SystemEvent

    if db is None or not isinstance(db, Session):
        own = database.SessionLocal()
        try:
            return _last_ingest_utc(own)
        finally:
            own.close()
    ultima_vela = db.query(func.max(MarketCandle.open_time_utc)).scalar()
    if ultima_vela is not None:
        value = ultima_vela
    else:
        ultimo_scanner = (
            db.query(func.max(SystemEvent.created_at))
            .filter(SystemEvent.category == "scanner")
            .scalar()
        )
        value = ultimo_scanner
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


@router.get("/api/system/metrics")
def system_metrics(user: User = Depends(require_admin)):
    # B6 (corrida seguridad 2026-11-23): contadores y latencias
    # internas, solo admin. Sin llamador no-admin en el frontend.
    from app.core.metrics import snapshot

    return snapshot()
