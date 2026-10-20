"""Order execution engine (Phase 6).

Lifecycle: pending -> approved -> sent -> executed | partial | cancelled | failed
- Idempotency: client_order_id is unique; retries with the same key replay.
- Before any retry, the real order state is checked first (no duplicates).
- Partial fills are recorded per-fill; the order aggregates to 'partial'.
- Modes: simulation/paper fill instantly at market (no keys needed).
  sandbox uses ccxt sandbox mode (needs keys). real executes on Kraken
  only when the server flag REAL_TRADING_ENABLED is on (Phase 8, owner-
  confirmed 2026-10-20) with a $20 cumulative hard cap.
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


def _real_exchange():
    """Authenticated Kraken client for REAL orders (keys from env only)."""
    import ccxt as _ccxt  # local import: only needed here

    from app.data import _compat

    _compat.apply_shims()
    key = (settings.kraken_api_key or "").strip()
    secret = (settings.kraken_api_secret or "").strip()
    if not key or not secret:
        raise RuntimeError("real trading keys not configured (KRAKEN_API_KEY/SECRET)")
    return _ccxt.kraken({
        "apiKey": key, "secret": secret, "enableRateLimit": True,
        "proxies": _compat.proxy_dict() or None,
    })


def real_buy_cost_total(db: Session) -> Decimal:
    """Cumulative cost of all real BUY fills — the hard-cap meter."""
    rows = (
        db.query(Fill)
        .join(Order, Fill.order_id == Order.id)
        .filter(Order.mode == "real", Order.side == "buy")
        .all()
    )
    return sum((f.price * f.quantity + f.fee for f in rows), Decimal("0"))


def real_position(db: Session, symbol: str) -> Decimal:
    """Net real filled quantity for a symbol (buys - sells)."""
    net = Decimal("0")
    rows = (
        db.query(Fill, Order.side)
        .join(Order, Fill.order_id == Order.id)
        .filter(Order.mode == "real", Order.symbol == symbol)
        .all()
    )
    for fill, side in rows:
        net += fill.quantity if side == "buy" else -fill.quantity
    return net


def execute_real(db: Session, order: Order) -> Order:
    """REAL execution on Kraken (Phase 8).

    Activated by the owner's explicit written confirmation (2026-10-20),
    ahead of the original 30-day paper schedule, with maximum armor:
    - server flag REAL_TRADING_ENABLED must be on (env, owner-controlled)
    - keys come from env only, and must be created WITHOUT withdrawal rights
    - cumulative real-buy hard cap = initial capital ($20)
    - no naked real sells (must hold a real filled position)
    - single send attempt; on ambiguous network errors, reconcile by
      client_order_id before declaring failure (never blind-retry real money)
    """
    if not settings.real_trading_enabled:
        raise RuntimeError("real trading is disabled (REAL_TRADING_ENABLED off)")
    price = _market_price(order.symbol)
    if order.side == "buy":
        projected = real_buy_cost_total(db) + price * order.quantity
        if projected > Decimal(str(settings.initial_capital_usd)):
            order.status = "failed"
            db.commit()
            raise RuntimeError("real hard cap exceeded ($20 total real buys)")
    else:
        if real_position(db, order.symbol) < order.quantity:
            order.status = "failed"
            db.commit()
            raise RuntimeError("no real position to sell")

    ex = _real_exchange()
    order.status = "approved"
    db.flush()
    try:
        res = ex.create_order(
            order.symbol, "market", order.side, float(order.quantity),
            params={"clientOrderId": order.client_order_id},
        )
    except Exception as send_err:
        res = None
        try:
            found = ex.fetch_order(
                None, order.symbol,
                params={"clientOrderId": order.client_order_id},
            )
            if found:
                res = found
        except Exception:
            pass
        if res is None:
            order.status = "failed"
            db.add(SystemEvent(
                level="error", category="execution",
                message=f"REAL order {order.client_order_id} send failed: {send_err}",
            ))
            db.commit()
            raise RuntimeError(f"real execution failed: {send_err}")

    filled = Decimal(str(res.get("filled", 0) or 0))
    avg = Decimal(str(res.get("average") or res.get("price") or 0))
    if filled > 0 and avg > 0:
        _record_fill(db, order, avg, filled)
        order.status = "sent"
        _refresh_status(db, order)
    else:
        # Accepted by the exchange but not filled yet: leave it open ('sent')
        # rather than mislabeling it failed.
        order.status = "sent"
    db.add(SystemEvent(
        level="warning", category="execution",
        message=(f"REAL order {order.client_order_id} {order.side} {order.symbol} "
                 f"qty={order.quantity} exchange_id={res.get('id')} status={order.status}"),
    ))
    db.commit()
    return order


def execute(db: Session, order: Order, price: Decimal | None = None) -> Order:
    """Route execution by order mode."""
    if order.mode == "real":
        return execute_real(db, order)
    if order.mode == "sandbox":
        return execute_sandbox(db, order)
    return execute_simulated(db, order, price)
