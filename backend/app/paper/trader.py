"""Continuous paper trading (Phase 4).

Each cycle: evaluate the strategy per symbol on closed candles, manage open
paper positions (stop/target/sell-signal), and open new ones only when the
server-side risk guard approves. Everything is recorded as Order/Fill/Trade
rows with mode='paper' — no real funds, no real orders.
"""
import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.config import settings
from app.data import ingest
from app.indicators import technical as ind
from app.models.tables import Fill, Order, Signal, SystemEvent, Trade
from app.risk import guard as risk_guard
from app.strategy import engine as strat

SYMBOLS = ("BTC/USD", "ETH/USD")
FEE_RATE = Decimal("0.001")


def _paper_equity(db: Session) -> Decimal:
    paper_order_ids = {
        o.id for o in db.query(Order).filter(Order.mode == "paper").all()
    }
    pnl = Decimal("0")
    for t in db.query(Trade).filter(Trade.closed_at.isnot(None)).all():
        if t.order_id in paper_order_ids and t.pnl_net is not None:
            pnl += t.pnl_net
    return Decimal(settings.initial_capital_usd) + pnl


def _open_paper_trades(db: Session) -> list[Trade]:
    paper_order_ids = [
        o.id for o in db.query(Order).filter(Order.mode == "paper").all()
    ]
    if not paper_order_ids:
        return []
    return (
        db.query(Trade)
        .filter(Trade.order_id.in_(paper_order_ids), Trade.closed_at.is_(None))
        .all()
    )


def _close_trade(db: Session, trade: Trade, exit_price: Decimal, reason: str) -> None:
    order = db.query(Order).filter(Order.id == trade.order_id).first()
    fills = db.query(Fill).filter(Fill.order_id == trade.order_id).all()
    qty = sum((f.quantity for f in fills), Decimal("0"))
    fee = exit_price * qty * FEE_RATE
    db.add(Fill(order_id=trade.order_id, price=exit_price, quantity=-qty, fee=fee))
    cost_basis = (trade.entry_price or Decimal("0")) * qty
    proceeds = exit_price * qty - fee
    trade.exit_price = exit_price
    trade.pnl_net = proceeds - cost_basis
    trade.closed_at = dt.datetime.now(dt.timezone.utc)
    if order:
        order.status = "executed"
    db.add(
        SystemEvent(
            level="info",
            category="paper",
            message=f"paper trade closed ({reason}): {trade.symbol} pnl {trade.pnl_net:.4f}",
        )
    )


def paper_cycle(db: Session) -> dict:
    """Run one paper-trading cycle. Returns a summary dict."""
    summary = {"evaluated": [], "opened": 0, "closed": 0}
    equity = _paper_equity(db)

    for symbol in SYMBOLS:
        candles = ingest.latest_candles(db, symbol, "1h", 200)
        if len(candles) < 61:
            continue
        closed = candles[:-1]
        closes = [float(c.close) for c in closed]
        snapshot = ind.summarize(closes, [float(c.volume) for c in closed])
        candidate = strat.evaluate(symbol, snapshot)
        price = Decimal(str(closed[-1].close))

        # Manage open paper trades for this symbol
        for trade in _open_paper_trades(db):
            if trade.symbol != symbol:
                continue
            order = db.query(Order).filter(Order.id == trade.order_id).first()
            sig = db.query(Signal).filter(Signal.id == order.signal_id).first() if order else None
            stop = Decimal(str(sig.invalidation_price)) if sig and sig.invalidation_price else None
            target = Decimal(str(sig.target_price)) if sig and sig.target_price else None
            reason = None
            if stop is not None and price <= stop:
                reason = "stop"
            elif target is not None and price >= target:
                reason = "target"
            elif candidate.side == "sell":
                reason = "signal"
            if reason:
                _close_trade(db, trade, price, reason)
                summary["closed"] += 1

        # Open new position
        if candidate.side == "buy":
            signal, decision, result = risk_guard.decide_and_persist(
                db, candidate, equity
            )
            summary["evaluated"].append(
                {"symbol": symbol, "side": "buy", "approved": result.approved}
            )
            if result.approved and result.quantity:
                entry = Decimal(str(candidate.entry_price))
                fee = entry * result.quantity * FEE_RATE
                order = Order(
                    client_order_id=f"paper-{uuid.uuid4().hex[:16]}",
                    signal_id=signal.id,
                    symbol=symbol,
                    side="buy",
                    quantity=result.quantity,
                    order_type="market",
                    status="executed",
                    mode="paper",
                )
                db.add(order)
                db.flush()
                db.add(
                    Fill(order_id=order.id, price=entry, quantity=result.quantity, fee=fee)
                )
                db.add(
                    Trade(
                        order_id=order.id,
                        symbol=symbol,
                        side="buy",
                        entry_price=entry,
                    )
                )
                summary["opened"] += 1
        else:
            # persist hold/sell evaluations as signals for the audit trail
            risk_guard.decide_and_persist(db, candidate, equity)
            summary["evaluated"].append(
                {"symbol": symbol, "side": candidate.side, "approved": False}
            )

    db.commit()
    return summary
