"""Aggregate dashboard endpoint: one request instead of nine.

Returns the exact same payloads as the individual GET endpoints so the
frontend can load the whole dashboard in a single round trip (important on
free-tier hosting with cold starts). The individual endpoints remain the
canonical API; this is a read-only convenience composition of them.

Partial-failure tolerance: a single failing section degrades to null instead
of failing the whole dashboard with a 500 — the frontend renders that section
as unavailable and shows a warning, while the other eight sections still load.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import misc, portfolio, signals, system
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _dump(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model  # plain dicts pass through


def _safe(name, fn):
    """Run one dashboard section; on failure log it and degrade to null."""
    try:
        return fn()
    except Exception:
        logger.exception("dashboard section %r failed, degrading to null", name)
        return None


@router.get("")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "system": _safe("system", lambda: _dump(system.system_status(user))),
        "balances": _safe("balances", lambda: _dump(portfolio.balances(user))),
        "performance": _safe("performance", lambda: _dump(portfolio.performance(user))),
        "signals": _safe("signals", lambda: _dump(signals.list_signals(user, db))),
        "strategies": _safe("strategies", lambda: [_dump(s) for s in misc.list_strategies(user, db)]),
        "modes": _safe("modes", lambda: _dump(misc.get_modes(user))),
        "operations": _safe("operations", lambda: _dump(misc.operations(user, db))),
        "risk": _safe("risk", lambda: _dump(misc.risk_limits(user))),
        "logs": _safe("logs", lambda: [_dump(e) for e in misc.logs(user, db)]),
    }
