"""System status endpoints. /api/health is public; /api/system/* need auth.

Fase 3 (M14): health and system status used to disagree — health said
"live" when the real flag was on while system_status hardcoded
mode="demo", exchange_connected=False, data_source="DEMO" always. Now
both derive from the same facts: mode follows the real-trading flag,
exchange_connected follows the read-only adapter configuration (no
network call), and health carries the build git_sha + timestamp so a
stale Render deploy is visible instead of guessed.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text

from app import database
from app.config import build_git_sha, build_timestamp_utc, settings
from app.core.security import get_current_user
from app.core.state import state
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
def system_status(user: User = Depends(get_current_user)):
    live = bool(settings.real_trading_enabled)
    return SystemStatus(
        mode="live" if live else "demo",
        exchange_connected=adapter.is_configured(),
        scanner_running=state.scanner_running,
        simulation_mode=state.simulation_mode,  # type: ignore[arg-type]
        kill_switch=state.kill_switch,
        data_source="LIVE" if live else "DEMO",
        last_update_utc=utc_now_iso(),
    )


@router.get("/api/system/metrics")
def system_metrics(user: User = Depends(get_current_user)):
    from app.core.metrics import snapshot

    return snapshot()
