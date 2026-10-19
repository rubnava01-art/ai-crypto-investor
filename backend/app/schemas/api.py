"""Pydantic schemas for the Phase 1 API. Money is serialized as strings (Decimal-safe)."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ---------- auth ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- system ----------
class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    mode: str
    timestamp_utc: str


class SystemStatus(BaseModel):
    mode: Literal["demo", "live"] = "demo"
    exchange_connected: bool = False
    scanner_running: bool = False
    simulation_mode: Literal["simulation", "paper", "real"] = "simulation"
    kill_switch: bool = False
    data_source: str = "DEMO"
    last_update_utc: str


# ---------- portfolio ----------
class BalancesResponse(BaseModel):
    equity_usd: str
    available_usd: str
    currency: str = "USD"
    demo: bool = True
    as_of_utc: str


class PerformanceResponse(BaseModel):
    realized_pnl_usd: str
    unrealized_pnl_usd: str
    max_drawdown_pct: str
    fees_paid_usd: str
    demo: bool = True
    as_of_utc: str


# ---------- signals ----------
class SignalOut(BaseModel):
    id: int
    symbol: str
    side: Literal["buy", "sell", "hold"]
    entry_price: str | None = None
    target_price: str | None = None
    invalidation_price: str | None = None
    reason: str = ""
    status: str = "demo"
    created_utc: str


class SignalsResponse(BaseModel):
    signals: list[SignalOut]
    demo: bool = True


# ---------- strategies ----------
class StrategyOut(BaseModel):
    id: int
    name: str
    version: str
    status: str
    notes: str = ""


# ---------- scanner ----------
class ScannerState(BaseModel):
    running: bool


# ---------- simulation ----------
class SimulationModes(BaseModel):
    modes: list[str] = ["simulation", "paper", "real"]
    current: str = "simulation"
    real_enabled: bool = False


class SetModeRequest(BaseModel):
    mode: Literal["simulation", "paper", "real"]


# ---------- operations ----------
class OrderOut(BaseModel):
    id: int
    client_order_id: str
    symbol: str
    side: str
    quantity: str
    status: str
    mode: str
    created_utc: str


class OperationsResponse(BaseModel):
    orders: list[OrderOut] = []
    trades: list[dict] = []


# ---------- risk ----------
class RiskLimits(BaseModel):
    max_risk_per_trade_pct: str
    max_daily_loss_usd: str
    max_trades_per_day: int
    spot_only: bool = True
    no_leverage: bool = True
    kill_switch: bool = False


class KillSwitchResponse(BaseModel):
    kill_switch: bool
    engaged_utc: str
    idempotent_replay: bool = False


# ---------- logs ----------
class LogEntry(BaseModel):
    id: int
    level: str
    category: str
    message: str
    created_utc: str


# ---------- AI assistant ----------
class AIAskRequest(BaseModel):
    question: str
    signal_id: int | None = None


class AIAskResponse(BaseModel):
    answer: str
    refused: bool
    demo: bool
    confidence: float | None = None
    signal_id: int | None = None


class CalibrationBucket(BaseModel):
    bucket: str
    n: int
    claimed_avg_pct: float
    actual_win_pct: float
    miscalibrated: bool


class AILessonsResponse(BaseModel):
    summary_es: str
    calibration: list[CalibrationBucket]
    demo_note: str = (
        "Las lecciones describen el pasado; un backtest o una racha "
        "no prueban rentabilidad futura."
    )


class AIStatusResponse(BaseModel):
    provider: str
    configured: bool
    demo: bool
