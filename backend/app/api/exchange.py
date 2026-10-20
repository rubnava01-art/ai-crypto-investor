"""Exchange connection endpoints (Phase 5): read-only.

No endpoint here accepts or stores API secrets — keys live in env only.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.database import get_db
from app.exchange import adapter
from app.models.tables import ExchangeConnection, User

router = APIRouter(prefix="/api/exchange", tags=["exchange"])


class ExchangeStatus(BaseModel):
    configured: bool
    exchange: str | None = None
    read_only: bool = True
    detail: str = ""


class BalancesResponse(BaseModel):
    source: str
    updated_utc: str
    balances: dict


class RegisterConnectionRequest(BaseModel):
    exchange: str  # kraken | coinbase
    label: str


@router.get("/status", response_model=ExchangeStatus)
def exchange_status(user: User = Depends(get_current_user)):
    if not adapter.is_configured():
        return ExchangeStatus(
            configured=False,
            detail="No read-only API keys configured. See docs/exchange-setup.md.",
        )
    try:
        info = adapter.ReadOnlyAdapter().fetch_status()
        return ExchangeStatus(
            configured=True,
            exchange=info["exchange"],
            detail=f"status={info['status']}",
        )
    except Exception as e:  # noqa: BLE001
        return ExchangeStatus(
            configured=True, detail=f"reachable but error: {type(e).__name__}"
        )


@router.get("/balances", response_model=BalancesResponse)
def exchange_balances(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not adapter.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Exchange not configured (no read-only API keys).",
        )
    try:
        raw = adapter.ReadOnlyAdapter().fetch_balance()
    except adapter.ExchangeNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Exchange error: {type(e).__name__}",
        )
    balances = {
        cur: {"free": str(v.get("free")), "used": str(v.get("used")), "total": str(v.get("total"))}
        for cur, v in raw.get("total", {}).items()
        if isinstance(v, dict) and (v.get("total") or 0) > 0
    } if isinstance(raw.get("total"), dict) else {}
    # ccxt balance shape: {'BTC': {'free':..,'used':..,'total':..}, ...}
    if not balances and isinstance(raw, dict):
        balances = {
            cur: {
                "free": str(v.get("free")),
                "used": str(v.get("used")),
                "total": str(v.get("total")),
            }
            for cur, v in raw.items()
            if isinstance(v, dict) and v.get("total")
        }
    return BalancesResponse(
        source="kraken",
        updated_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
        balances=balances,
    )


@router.post("/connections", status_code=status.HTTP_201_CREATED)
def register_connection(
    payload: RegisterConnectionRequest,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Register connection METADATA only. Secrets are never accepted here."""
    if payload.exchange not in ("kraken", "coinbase"):
        raise HTTPException(status_code=400, detail="exchange must be kraken|coinbase")
    conn = ExchangeConnection(
        user_id=user.id,
        exchange=payload.exchange,
        label=payload.label,
        permissions=["read"],
        ip_whitelist=[],
        is_active=False,
    )
    db.add(conn)
    db.commit()
    return {"id": conn.id, "exchange": conn.exchange, "label": conn.label}


class LiveBalanceResponse(BaseModel):
    connected: bool
    exchange: str = "kraken"
    real_trading_enabled: bool = False
    balances: dict = {}
    detail: str = ""


@router.get("/live", response_model=LiveBalanceResponse)
def live_balance(user: User = Depends(require_admin)):
    """Validate the owner's Kraken keys (env only) with a read-only balance
    call. Never returns or logs key material. Admin only."""
    from app.config import settings

    if not ((settings.kraken_api_key or "").strip()
            and (settings.kraken_api_secret or "").strip()):
        return LiveBalanceResponse(
            connected=False,
            real_trading_enabled=settings.real_trading_enabled,
            detail="Kraken keys not configured on the server yet.",
        )
    try:
        from app.execution.engine import _real_exchange

        ex = _real_exchange()
        raw = ex.fetch_balance()
        totals = raw.get("total") or {}
        balances = {
            cur: str(amt)
            for cur, amt in totals.items()
            if amt and float(amt) > 0
        }
        return LiveBalanceResponse(
            connected=True,
            real_trading_enabled=settings.real_trading_enabled,
            balances=balances,
            detail="Keys accepted by Kraken. Balances are read live; "
                   "the key must have NO withdrawal permission.",
        )
    except Exception as e:  # noqa: BLE001 - report a clean reason, never secrets
        return LiveBalanceResponse(
            connected=False,
            real_trading_enabled=settings.real_trading_enabled,
            detail=f"Kraken rejected the keys or is unreachable: {type(e).__name__}",
        )
