"""Portfolio endpoints. Phase 1 returns DEMO data, clearly labeled."""
from fastapi import APIRouter, Depends

from app.config import settings
from app.core.security import get_current_user
from app.models.tables import User
from app.schemas.api import BalancesResponse, PerformanceResponse, utc_now_iso

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/balances", response_model=BalancesResponse)
def balances(user: User = Depends(get_current_user)):
    # Phase 1: DEMO equity. Phase 5 will read real balances (read-only).
    return BalancesResponse(
        equity_usd=settings.initial_capital_usd,
        available_usd=settings.initial_capital_usd,
        demo=True,
        as_of_utc=utc_now_iso(),
    )


@router.get("/performance", response_model=PerformanceResponse)
def performance(user: User = Depends(get_current_user)):
    return PerformanceResponse(
        realized_pnl_usd="0.00",
        unrealized_pnl_usd="0.00",
        max_drawdown_pct="0.00",
        fees_paid_usd="0.00",
        demo=True,
        as_of_utc=utc_now_iso(),
    )
