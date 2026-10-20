"""Aggregate dashboard endpoint: one request instead of nine.

Returns the exact same payloads as the individual GET endpoints so the
frontend can load the whole dashboard in a single round trip (important on
free-tier hosting with cold starts). The individual endpoints remain the
canonical API; this is a read-only convenience composition of them.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import misc, portfolio, signals, system
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _dump(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model  # plain dicts pass through


@router.get("")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "system": _dump(system.system_status(user)),
        "balances": _dump(portfolio.balances(user)),
        "performance": _dump(portfolio.performance(user)),
        "signals": _dump(signals.list_signals(user, db)),
        "strategies": [_dump(s) for s in misc.list_strategies(user, db)],
        "modes": _dump(misc.get_modes(user)),
        "operations": _dump(misc.operations(user, db)),
        "risk": _dump(misc.risk_limits(user)),
        "logs": [_dump(e) for e in misc.logs(user, db)],
    }
