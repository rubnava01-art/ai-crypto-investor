"""Pydantic schemas for the Phase 1 API. Money is serialized as strings (Decimal-safe)."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ---------- auth ----------
class LoginRequest(BaseModel):
    # Acotados (Fase 2, M10/B2): sin max_length el body no estaba acotado
    # y bcrypt falla (401) con más de 72 bytes; ahora se rechaza con 422
    # explícito antes de tocar bcrypt. El login NO impone mínimo (decisión
    # de Rubén 2026-11-02: el mínimo 12 aplica solo a fijar contraseñas
    # nuevas o cambiadas, nunca a entrar con una ya existente).
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    # Fase 1 mejoras-v1, tarea 3: código TOTP (6 dígitos) o código de
    # recuperación. Opcional: solo se exige cuando la cuenta tiene el
    # 2FA activado. Sin él, el login de una cuenta con 2FA es 401.
    totp_code: str | None = Field(default=None, max_length=16)

    # S-1b (corrida 2026-11-24): validar tras strip — "   " es 422 y
    # " ruben " entra como "ruben" (el strip vive aquí, no solo en el
    # endpoint, para que ningún otro llamador vea el nombre sin recortar).
    @field_validator("username")
    @classmethod
    def _strip_username(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("username no puede estar vacío")
        return v

    @field_validator("password")
    @classmethod
    def _password_within_bcrypt_cap(cls, v: str) -> str:
        from app.core.security import check_password_bytes

        try:
            check_password_bytes(v)
        except ValueError as e:
            raise ValueError(str(e)) from e
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- system ----------
class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    mode: str
    timestamp_utc: str
    # Fase 3 (M14/quick-win #3): which build is actually serving, so the
    # next "route missing in prod" is diagnosed in seconds, not by
    # guessing. "unknown" when the deploy pipeline provides no SHA.
    git_sha: str = "unknown"
    built_utc: str | None = None
    # 2026-11-05: conectividad real con la base de datos ("ok" / "error",
    # "unknown" solo si el ping no se pudo ejecutar). El endpoint sigue
    # devolviendo HTTP 200 aunque la BD falle: Render usa /api/health
    # como health check y un reinicio por un fallo transitorio de la BD
    # empeoraría la caída en vez de diagnosticarla.
    database: str = "unknown"
    # Fase 8 mejoras-v1, tarea 2: cabeza de migración (revisión
    # Alembic) y estado de las migraciones frente a la BD ("al_dia" |
    # "pendientes" | "desconocido" si no hay tabla alembic_version,
    # como en una BD creada con create_all). Sin secretos ni datos
    # sensibles: solo identificadores de revisión.
    alembic_head: str = "unknown"
    migraciones: str = "desconocido"


class SystemStatus(BaseModel):
    mode: Literal["demo", "live"] = "demo"
    exchange_connected: bool = False
    scanner_running: bool = False
    simulation_mode: Literal["simulation", "paper", "real"] = "simulation"
    kill_switch: bool = False
    data_source: str = "DEMO"
    # Fase 5 (2026-11-23, P2-2): última ingesta REAL de mercado (max
    # open_time de MarketCandle o último SystemEvent de scanner).
    # None = nunca ha habido ingesta (el frontend lo muestra como
    # "sin datos todavía"); antes era utcnow(), engañoso.
    last_update_utc: str | None = None


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
class SignalHistoryOut(BaseModel):
    """Historial real de señales iguales anteriores (mismo símbolo y lado).

    Cuenta señales distintas con resultado resuelto por el ciclo de
    aprendizaje (ai_explanations.outcome win/loss, contra objetivo e
    invalidación con velas posteriores). Sin resultados resueltos el
    historial es None y la UI dice "sin historial" — nunca se inventa.
    """

    wins: int = 0
    losses: int = 0
    total: int = 0
    win_rate_pct: float | None = None


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
    # Fase 5a, tarea 3: confianza expresada por el asistente (chat-potencia,
    # ai_explanations.confidence, 0-100) para esta señal, si la hay; None
    # cuando el asistente nunca explicó esta señal.
    confidence_pct: float | None = None
    history: SignalHistoryOut | None = None


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
