"""System status endpoints. /api/health is public; /api/system/* need auth."""
from fastapi import APIRouter, Depends

from app.config import settings
from app.core.security import get_current_user
from app.core.state import state
from app.models.tables import User
from app.schemas.api import HealthResponse, SystemStatus, utc_now_iso

router = APIRouter(tags=["system"])


@router.get("/api/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        version=settings.app_version,
        mode="demo" if not settings.real_trading_enabled else "live",
        timestamp_utc=utc_now_iso(),
    )


@router.get("/api/system/status", response_model=SystemStatus)
def system_status(user: User = Depends(get_current_user)):
    return SystemStatus(
        mode="demo",
        exchange_connected=False,  # Phase 5: read-only exchange connection
        scanner_running=state.scanner_running,
        simulation_mode=state.simulation_mode,  # type: ignore[arg-type]
        kill_switch=state.kill_switch,
        data_source="DEMO",
        last_update_utc=utc_now_iso(),
    )


@router.get("/api/system/metrics")
def system_metrics(user: User = Depends(get_current_user)):
    from app.core.metrics import snapshot

    return snapshot()
