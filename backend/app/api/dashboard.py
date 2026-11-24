"""Aggregate dashboard endpoint: one request instead of nine.

Returns the exact same payloads as the individual GET endpoints so the
frontend can load the whole dashboard in a single round trip (important on
free-tier hosting with cold starts). The individual endpoints remain the
canonical API; this is a read-only convenience composition of them.

Partial-failure tolerance: a single failing section degrades to null instead
of failing the whole dashboard with a 500 — the frontend renders that section
as unavailable and shows a warning, while the other eight sections still load.

Gating por perfil (corrección H1, QA 2026-11-23): este endpoint compone
llamando a los handlers directamente, sin pasar por los routers donde
vive `require_modulo("invertir")`, así que las secciones se gatean
AQUÍ con `modulos_para()` — un `None` significa "sin acceso", no un
fallo (el frontend lo renderiza como vacío, igual que una sección
caída). Reglas:

- Invertir (balances, performance, strategies, modes, operations,
  risk): solo si el perfil tiene el módulo "invertir".
- logs: solo admin (B6: eventos internos del sistema).
- system y signals: para cualquier autenticado — la landing (/) los
  usa y el chat demo (M1) permite señales a prueba.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import misc, portfolio, signals, system
from app.core.perfiles import modulos_para
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
    modulos = modulos_para(user, db)
    tiene_invertir = "invertir" in modulos
    es_admin = bool(user.is_admin)
    return {
        # Fase 5 (2026-11-23): system_status necesita la sesión para
        # la última ingesta real — el dashboard ya la tiene y la pasa
        # (antes se llamaba sin db porque no la usaba).
        "system": _safe("system", lambda: _dump(system.system_status(user, db))),
        # Portfolio now computes from paper rows, so it needs the session
        # (Fase 3, M17) — the dashboard already holds one, pass it through.
        "balances": _safe("balances", lambda: _dump(portfolio.balances(user, db))) if tiene_invertir else None,
        "performance": _safe("performance", lambda: _dump(portfolio.performance(user, db))) if tiene_invertir else None,
        "signals": _safe("signals", lambda: _dump(signals.list_signals(user, db))),
        "strategies": _safe("strategies", lambda: [_dump(s) for s in misc.list_strategies(user, db)]) if tiene_invertir else None,
        "modes": _safe("modes", lambda: _dump(misc.get_modes(user))) if tiene_invertir else None,
        "operations": _safe("operations", lambda: _dump(misc.operations(user, db))) if tiene_invertir else None,
        "risk": _safe("risk", lambda: _dump(misc.risk_limits(user))) if tiene_invertir else None,
        "logs": _safe("logs", lambda: [_dump(e) for e in misc.logs(user, db)]) if es_admin else None,
    }
