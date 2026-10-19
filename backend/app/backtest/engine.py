"""Event-driven backtest engine (no lookahead).

At step i, the strategy sees only closes[0..i-1] (closed candles) and any
trade executes at close[i]. Fees + slippage applied on both sides.
"""
import csv
import io
import math
from dataclasses import dataclass, field
from decimal import Decimal

from app.core import risk_math
from app.indicators import technical as ind
from app.strategy import engine as strat


@dataclass
class BacktestConfig:
    symbol: str = "BTC/USD"
    timeframe: str = "1h"
    fee_rate: Decimal = Decimal("0.001")
    slippage_rate: Decimal = Decimal("0.0005")
    initial_equity: Decimal = Decimal("20.00")
    risk_pct: Decimal = Decimal("1.0")
    train_pct: float = 0.6
    val_pct: float = 0.2
    strategy_name: str = "trend-momentum"
    strategy_version: str = "0.1.0"


@dataclass
class TradeRecord:
    entry_idx: int
    exit_idx: int
    side: str
    entry_price: float
    exit_price: float
    quantity: float
    fee_paid: float
    pnl_net: float
    exit_reason: str


@dataclass
class BacktestResult:
    config: BacktestConfig
    trades: list[TradeRecord] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)
    baseline_equity: list[float] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def to_csv(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["entry_idx", "exit_idx", "side", "entry_price", "exit_price",
                    "quantity", "fee_paid", "pnl_net", "exit_reason"])
        for t in self.trades:
            w.writerow([t.entry_idx, t.exit_idx, t.side, t.entry_price, t.exit_price,
                        t.quantity, t.fee_paid, t.pnl_net, t.exit_reason])
        return buf.getvalue()


def run_backtest(closes: list[float], config: BacktestConfig) -> BacktestResult:
    n = len(closes)
    if n < 80:
        raise ValueError(f"need at least 80 closes, got {n}")
    result = BacktestResult(config=config)

    cash = float(config.initial_equity)
    position_qty = 0.0
    entry_price = 0.0
    stop_price = 0.0
    target_price = 0.0
    equity_curve = []

    # Baseline: buy & hold at first close
    base_qty = float(config.initial_equity) / closes[0]

    for i in range(60, n):
        snapshot = ind.summarize(closes[:i], None)
        candidate = strat.evaluate(config.symbol, snapshot)
        price = closes[i]

        # Manage open position: stop / target / sell signal
        if position_qty > 0:
            exit_reason = None
            if price <= stop_price:
                exit_reason = "stop"
            elif price >= target_price:
                exit_reason = "target"
            elif candidate.side == "sell":
                exit_reason = "signal"
            if exit_reason:
                proceeds = position_qty * price
                fee = proceeds * float(config.fee_rate) + proceeds * float(config.slippage_rate)
                pnl = proceeds - fee - (position_qty * entry_price)
                result.trades.append(TradeRecord(
                    entry_idx=i, exit_idx=i, side="buy",
                    entry_price=entry_price, exit_price=price,
                    quantity=position_qty, fee_paid=fee, pnl_net=pnl,
                    exit_reason=exit_reason,
                ))
                cash += proceeds - fee
                position_qty = 0.0

        # Open new position
        if position_qty == 0 and candidate.side == "buy" and candidate.entry_price:
            entry = candidate.entry_price
            stop = candidate.invalidation_price or entry * 0.99
            target = candidate.target_price or entry * 1.02
            qty = float(risk_math.position_quantity(
                Decimal(str(cash)), config.risk_pct,
                Decimal(str(entry)), Decimal(str(stop))))
            cost = qty * entry
            fee = cost * float(config.fee_rate) + cost * float(config.slippage_rate)
            # Scale down if cost+fee exceeds cash (same balance rule as live guard)
            if cost + fee > cash and (cost + fee) > 0:
                scale = cash / (cost + fee)
                qty *= scale
                cost = qty * entry
                fee = cost * float(config.fee_rate) + cost * float(config.slippage_rate)
            if qty > 0:
                # round-trip cost guard (same rule as live)
                ok, _ = risk_math.round_trip_cost_ok(
                    Decimal(str(qty)), Decimal(str(entry)), Decimal(str(target)),
                    config.fee_rate, config.slippage_rate)
                if ok:
                    cash -= cost + fee
                    position_qty, entry_price = qty, entry
                    stop_price, target_price = stop, target

        equity_curve.append(cash + position_qty * price)
        result.baseline_equity.append(base_qty * price)

    result.equity_curve = equity_curve
    result.metrics = compute_metrics(result, float(config.initial_equity))
    return result


def compute_metrics(result: BacktestResult, initial: float) -> dict:
    trades = result.trades
    final = result.equity_curve[-1] if result.equity_curve else initial
    net_return_pct = (final - initial) / initial * 100

    # Max drawdown on equity curve
    peak, max_dd = initial, 0.0
    for e in result.equity_curve:
        peak = max(peak, e)
        max_dd = max(max_dd, (peak - e) / peak * 100 if peak else 0)

    wins = [t for t in trades if t.pnl_net > 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0.0
    expectancy = sum(t.pnl_net for t in trades) / len(trades) if trades else 0.0

    # Sharpe on per-trade returns (risk-free 0); None if < 2 trades
    sharpe = None
    if len(trades) >= 2:
        rets = [t.pnl_net / initial for t in trades]
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        if var > 0:
            sharpe = mean / math.sqrt(var)

    base_final = result.baseline_equity[-1] if result.baseline_equity else initial
    baseline_return_pct = (base_final - initial) / initial * 100

    return {
        "net_return_pct": round(net_return_pct, 2),
        "baseline_return_pct": round(baseline_return_pct, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_per_trade": round(sharpe, 3) if sharpe is not None else None,
        "win_rate_pct": round(win_rate, 1),
        "expectancy_usd": round(expectancy, 4),
        "n_trades": len(trades),
        "final_equity_usd": round(final, 2),
    }


def split_train_val_test(n: int, train_pct: float, val_pct: float):
    t = int(n * train_pct)
    v = int(n * val_pct)
    return (0, t), (t, t + v), (t + v, n)
