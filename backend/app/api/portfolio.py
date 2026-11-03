"""Portfolio endpoints.

Fase 3 (M17): these used to return FIXED demo figures ($20 / 0.00)
regardless of what the paper trader actually did — honest labels, but
numbers that never moved. Now they are computed from the real paper
rows (Order/Fill/Trade, mode='paper'):
- equity = initial capital + realized PnL of closed paper trades.
- available = equity - cost basis of open paper trades.
- realized = sum of closed paper PnL; fees = sum of paper fill fees.
- unrealized = open positions marked at the latest stored candle close
  for their symbol (DB only, no network); when no candle exists for a
  symbol, that position marks at its entry price (unrealized 0 for it)
  — a stated convention, never an invented price.
- max_drawdown = worst peak-to-trough of the closed-trade equity curve.
demo=False now: these ARE the paper portfolio figures (paper is still
not real money — the mode is paper, and the simulation labels elsewhere
stay). With no paper trades at all, the figures equal the starting
capital with zero PnL — which is the true paper state, not a placeholder.
"""
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import Fill, MarketCandle, Order, Trade, User
from app.schemas.api import BalancesResponse, PerformanceResponse, utc_now_iso

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


def _paper_stats(db: Session) -> dict:
    capital = Decimal(str(settings.initial_capital_usd))
    realized = (
        db.query(func.coalesce(func.sum(Trade.pnl_net), 0))
        .join(Order, Trade.order_id == Order.id)
        .filter(Order.mode == "paper", Trade.closed_at.isnot(None))
        .scalar()
    )
    realized = Decimal(str(realized or 0))
    fees = (
        db.query(func.coalesce(func.sum(Fill.fee), 0))
        .join(Order, Fill.order_id == Order.id)
        .filter(Order.mode == "paper")
        .scalar()
    )
    fees = Decimal(str(fees or 0))
    open_trades = (
        db.query(Trade)
        .join(Order, Trade.order_id == Order.id)
        .filter(Order.mode == "paper", Trade.closed_at.is_(None))
        .all()
    )
    # Cost basis + unrealized per open trade, from stored candles.
    open_cost = Decimal("0")
    unrealized = Decimal("0")
    for trade in open_trades:
        fills = (
            db.query(Fill).filter(Fill.order_id == trade.order_id).all()
        )
        qty = sum((f.quantity for f in fills), Decimal("0"))
        entry = trade.entry_price or Decimal("0")
        open_cost += entry * qty
        last_candle = (
            db.query(MarketCandle)
            .filter(MarketCandle.symbol == trade.symbol)
            .order_by(MarketCandle.open_time_utc.desc())
            .first()
        )
        mark = (
            Decimal(str(last_candle.close)) if last_candle is not None else entry
        )
        unrealized += (mark - entry) * qty
    # Drawdown from the closed-trade equity curve, in close order.
    closed = (
        db.query(Trade)
        .join(Order, Trade.order_id == Order.id)
        .filter(Order.mode == "paper", Trade.closed_at.isnot(None))
        .order_by(Trade.closed_at.asc())
        .all()
    )
    equity_curve = capital
    peak = capital
    max_dd = Decimal("0")
    for trade in closed:
        equity_curve += trade.pnl_net or Decimal("0")
        peak = max(peak, equity_curve)
        if peak > 0:
            dd = (peak - equity_curve) / peak * Decimal("100")
            max_dd = max(max_dd, dd)
    equity = capital + realized
    return {
        "equity": equity,
        "available": equity - open_cost,
        "realized": realized,
        "unrealized": unrealized,
        "max_drawdown": max_dd,
        "fees": fees,
    }


@router.get("/balances", response_model=BalancesResponse)
def balances(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stats = _paper_stats(db)
    return BalancesResponse(
        equity_usd=str(stats["equity"]),
        available_usd=str(stats["available"]),
        demo=False,
        as_of_utc=utc_now_iso(),
    )


@router.get("/performance", response_model=PerformanceResponse)
def performance(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stats = _paper_stats(db)
    return PerformanceResponse(
        realized_pnl_usd=str(stats["realized"]),
        unrealized_pnl_usd=str(stats["unrealized"]),
        max_drawdown_pct=str(stats["max_drawdown"]),
        fees_paid_usd=str(stats["fees"]),
        demo=False,
        as_of_utc=utc_now_iso(),
    )
