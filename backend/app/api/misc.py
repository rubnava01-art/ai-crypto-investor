"""Strategies, scanner, simulation-mode, operations, risk, and logs endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.core.idempotency import (
    check_idempotency,
    idempotency_key_from,
    store_idempotency,
)
from app.core.hardening import audit
from app.core.security import get_current_user
from app.core.state import state
from app.database import get_db
from app.models.tables import Order, StrategyVersion, SystemEvent, User
from app.schemas.api import (
    KillSwitchResponse,
    LogEntry,
    OperationsResponse,
    OrderOut,
    RiskLimits,
    ScannerState,
    SetModeRequest,
    SimulationModes,
    StrategyOut,
    utc_now_iso,
)

strategies_router = APIRouter(prefix="/api/strategies", tags=["strategies"])
scanner_router = APIRouter(prefix="/api/scanner", tags=["scanner"])
simulation_router = APIRouter(prefix="/api/simulation", tags=["simulation"])
operations_router = APIRouter(prefix="/api", tags=["operations"])
risk_router = APIRouter(prefix="/api/risk", tags=["risk"])
logs_router = APIRouter(prefix="/api/logs", tags=["logs"])


# ---------- strategies ----------
@strategies_router.get("", response_model=list[StrategyOut])
def list_strategies(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = db.query(StrategyVersion).order_by(StrategyVersion.id).all()
    return [
        StrategyOut(
            id=r.id, name=r.name, version=r.version, status=r.status, notes=r.notes
        )
        for r in rows
    ]


# ---------- scanner ----------
@scanner_router.post("/start", response_model=ScannerState)
def scanner_start(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    # Phase 1: flips a flag. Phase 2 wires the real market-data loop.
    state.scanner_running = True
    audit(db, user, "scanner.start", "scanner", details={"running": True})
    return ScannerState(running=True)


@scanner_router.post("/stop", response_model=ScannerState)
def scanner_stop(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    state.scanner_running = False
    audit(db, user, "scanner.stop", "scanner", details={"running": False})
    return ScannerState(running=False)


# ---------- simulation ----------
@simulation_router.get("/modes", response_model=SimulationModes)
def get_modes(user: User = Depends(get_current_user)):
    return SimulationModes(
        current=state.simulation_mode,
        real_enabled=settings.real_trading_enabled,
    )


@simulation_router.post("/mode", response_model=SimulationModes)
def set_mode(
    payload: SetModeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.mode == "real":
        # HARD-DISABLED in Phase 1. Phase 8 requires 30d paper + written approval.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Real trading is disabled. It requires Phase 8 criteria and explicit written authorization.",
        )
    old = state.simulation_mode
    state.simulation_mode = payload.mode
    audit(db, user, "simulation.mode", "simulation",
          details={"from": old, "to": payload.mode})
    return SimulationModes(
        current=state.simulation_mode, real_enabled=settings.real_trading_enabled
    )


# ---------- operations (READ side) ----------
@operations_router.get("/operations", response_model=OperationsResponse)
def operations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orders = db.query(Order).order_by(Order.created_at.desc()).limit(50).all()
    return OperationsResponse(
        orders=[
            OrderOut(
                id=o.id,
                client_order_id=o.client_order_id,
                symbol=o.symbol,
                side=o.side,
                quantity=str(o.quantity),
                status=o.status,
                mode=o.mode,
                created_utc=o.created_at.isoformat(),
            )
            for o in orders
        ],
        trades=[],
    )


# ---------- operations (WRITE side, separated) ----------
class CreateOrderRequest(BaseModel):
    symbol: str
    side: str  # buy | sell
    quantity: str
    mode: str = "simulation"  # simulation | paper | sandbox


@operations_router.post("/orders", response_model=OrderOut)
def create_order(
    payload: CreateOrderRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create + execute an order. Requires Idempotency-Key header.

    Real mode is rejected (403). Simulation/paper fill instantly at market.
    The server-side risk guard runs before anything is created.
    """
    from decimal import Decimal as _D

    from app.core.state import state as _state
    from app.execution import engine as _exec
    from app.models.tables import Order as _Order
    from app.risk import guard as _guard
    from app.strategy.engine import SignalCandidate as _Candidate

    key = idempotency_key_from(request)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="Idempotency-Key header is required for order creation",
        )
    route = "POST /api/orders"
    replay = check_idempotency(db, key, user, route)
    if replay is not None:
        status_code, response = replay
        return OrderOut(**response)

    if payload.mode == "real":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Real trading is disabled (Phase 8 gate).",
        )
    if payload.mode not in ("simulation", "paper", "sandbox"):
        raise HTTPException(status_code=400, detail="mode must be simulation|paper|sandbox")
    if payload.side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be buy|sell")
    try:
        qty = _D(str(payload.quantity))
        if qty <= 0:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="quantity must be a positive decimal")

    if _state.kill_switch:
        raise HTTPException(status_code=423, detail="Kill switch engaged.")

    # Server-side risk check on a synthetic candidate at current market price
    try:
        price = _exec._market_price(payload.symbol)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Market price unavailable.",
        )
    candidate = _Candidate(
        symbol=payload.symbol,
        side=payload.side,
        entry_price=float(price),
        target_price=float(price * _D("1.02")),
        invalidation_price=float(price * _D("0.99")),
        reason="manual order via API",
    )
    result = _guard.apply_risk(db, candidate, _D(settings.initial_capital_usd))
    if not result.approved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Risk rejected: {result.reason}",
        )

    order = _Order(
        client_order_id=key,  # idempotency key doubles as client order id
        symbol=payload.symbol,
        side=payload.side,
        quantity=qty,
        order_type="market",
        status="pending",
        mode=payload.mode,
    )
    db.add(order)
    db.commit()

    try:
        order = _exec.execute(db, order, price=price)
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)
        )

    response = OrderOut(
        id=order.id,
        client_order_id=order.client_order_id,
        symbol=order.symbol,
        side=order.side,
        quantity=str(order.quantity),
        status=order.status,
        mode=order.mode,
        created_utc=order.created_at.isoformat(),
    )
    store_idempotency(db, key, user, route, 200, response.model_dump(mode="json"))
    return response


# ---------- risk ----------
@risk_router.get("/limits", response_model=RiskLimits)
def risk_limits(user: User = Depends(get_current_user)):
    return RiskLimits(
        max_risk_per_trade_pct=settings.max_risk_per_trade_pct,
        max_daily_loss_usd=settings.max_daily_loss_usd,
        max_trades_per_day=settings.max_trades_per_day,
        kill_switch=state.kill_switch,
    )


@risk_router.post("/kill-switch", response_model=KillSwitchResponse)
def kill_switch(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Emergency stop. Idempotent via Idempotency-Key header (replays return the
    original response without re-executing)."""
    key = idempotency_key_from(request)
    route = "POST /api/risk/kill-switch"
    if key:
        replay = check_idempotency(db, key, user, route)
        if replay is not None:
            status_code, response = replay
            response = dict(response)
            response["idempotent_replay"] = True
            return KillSwitchResponse(**response)

    state.kill_switch = True
    db.add(
        SystemEvent(level="error", category="risk", message="Kill switch ENGAGED")
    )
    db.commit()
    audit(db, user, "risk.kill_switch", "risk", details={"engaged": True})
    from app.alerts import email as alert_email

    alert_email.send_alert(
        "KILL SWITCH ENGAGED",
        f"The emergency kill switch was engaged by {user.username} at {utc_now_iso()}. "
        "All trading activity is halted. No automatic resume will occur.",
    )
    response = KillSwitchResponse(
        kill_switch=True, engaged_utc=utc_now_iso(), idempotent_replay=False
    )
    if key:
        store_idempotency(
            db, key, user, route, 200, response.model_dump(mode="json")
        )
    return response


# ---------- logs ----------
@logs_router.get("", response_model=list[LogEntry])
def logs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(SystemEvent).order_by(SystemEvent.created_at.desc()).limit(100).all()
    )
    return [
        LogEntry(
            id=r.id,
            level=r.level,
            category=r.category,
            message=r.message,
            created_utc=r.created_at.isoformat(),
        )
        for r in rows
    ]
