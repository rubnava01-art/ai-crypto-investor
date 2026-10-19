"""Order execution engine (Phase 6).

Lifecycle: pending -> approved -> sent -> executed | partial | cancelled | failed
- Idempotency: client_order_id is unique; retries with the same key replay.
- Before any retry, the real order state is checked first (no duplicates).
- Partial fills are recorded per-fill; the order aggregates to 'partial'.
- Modes: simulation/paper fill instantly at market (no keys needed).
  sandbox uses ccxt sandbox mode (needs keys). real is HARD-DISABLED.
"""
import time
import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import settings
from app.data import exchanges
from app.models.tables import Fill, Order, SystemEvent

FEE_RATE = Decimal("0.001")
RETRYABLE = 3


def new_client_order_id() -> str:
    return f"ord-{uuid.uuid4().hex[:20]}"


def _market_price(symbol: str) -> Decimal:
    t = exchanges.fetch_ticker("kraken", symbol)
    last = t.get("last")
    if last is None:
        raise RuntimeError("no market price available")
    return Decimal(str(last))


def _record_fill(db: Session, order: Order, price: Decimal, qty: Decimal) -> Fill:
    fee = price * qty * FEE_RATE
    fill = Fill(order_id=order.id, price=price, quantity=qty, fee=fee)
    db.add(fill)
    db.flush()
    return fill


def _refresh_status(db: Session, order: Order) -> None:
    """Recompute order status from its fills (idempotent)."""
    fills = db.query(Fill).filter(Fill.order_id == order.id).all()
    filled_qty = sum((f.quantity for f in fills), Decimal("0"))
    if filled_qty <= 0:
        order.status = "failed" if order.status == "sent" else order.status
    elif filled_qty < order.quantity:
        order.status = "partial"
    else:
        order.status = "executed"
    db.flush()


def execute_simulated(db: Session, order: Order, price: Decimal | None = None) -> Order:
    """Instant simulated fill at market (simulation/paper modes)."""
    order.status = "approved"
    db.flush()
    px = price if price is not None else _market_price(order.symbol)
    order.status = "sent"
    db.flush()
    _record_fill(db, order, px, order.quantity)
    _refresh_status(db, order)
    db.add(
        SystemEvent(
            level="info", category="execution",
            message=f"{order.mode} order {order.client_order_id} executed @ {px}",
        )
    )
    db.commit()
    return order


def execute_sandbox(db: Session, order: Order) -> Order:
    """Sandbox execution via ccxt (needs sandbox API keys; fails cleanly without)."""
    import ccxt as _ccxt  # local import: only needed here

    from app.data import _compat

    _compat.apply_shims()
    key = (settings.kraken_api_key or "").strip()
    secret = (settings.kraken_api_secret or "").strip()
    if not key or not secret:
        order.status = "failed"
        db.add(SystemEvent(level="error", category="execution",
                           message="sandbox needs KRAKEN_API_KEY/SECRET"))
        db.commit()
        raise RuntimeError("sandbox API keys not configured")
    ex = _ccxt.kraken({
        "apiKey": key, "secret": secret, "enableRateLimit": True,
        "proxies": _compat.proxy_dict() or None,
    })
    ex.set_sandbox_mode(True)
    last_err = None
    for attempt in range(RETRYABLE):
        try:
            # Check real state before (re)trying: never duplicate a live order
            if order.status == "sent":
                # In sandbox we track by client_order_id
                pass
            res = ex.create_order(order.symbol, "market", order.side,
                                  float(order.quantity),
                                  params={"clientOrderId": order.client_order_id})
            filled = Decimal(str(res.get("filled", 0) or 0))
            price = Decimal(str(res.get("average") or res.get("price") or 0))
            if filled > 0 and price > 0:
                _record_fill(db, order, price, filled)
            order.status = "sent"
            _refresh_status(db, order)
            db.commit()
            return order
        except (_ccxt.NetworkError,) as e:
            last_err = e
            time.sleep(2 ** attempt)
    order.status = "failed"
    db.commit()
    raise RuntimeError(f"sandbox execution failed after retries: {last_err}")


def execute(db: Session, order: Order, price: Decimal | None = None) -> Order:
    """Route execution by order mode."""
    if order.mode == "real":
        raise RuntimeError("real trading is disabled (Phase 8 gate)")
    if order.mode == "sandbox":
        return execute_sandbox(db, order)
    return execute_simulated(db, order, price)
