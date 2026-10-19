"""SQLAlchemy models. All timestamps are UTC. All money uses Numeric (Decimal)."""
import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class ExchangeConnection(Base):
    """Phase 1: stores metadata only. Real API secrets are NEVER stored in Phase 1.

    From Phase 5/8: api_key material must live in an external secrets manager
    (or env), encrypted at rest, with no-withdrawal permissions + IP whitelist.
    """

    __tablename__ = "exchange_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)  # coinbase|kraken
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    permissions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    ip_whitelist: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class MarketCandle(Base):
    __tablename__ = "market_candles"
    __table_args__ = (
        UniqueConstraint("symbol", "timeframe", "open_time_utc", name="uq_candle"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)  # e.g. BTC/USD
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)  # e.g. 1h
    open_time_utc: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    open: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    high: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    low: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    close: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    volume: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # coinbase|kraken|demo


class StrategyVersion(Base):
    __tablename__ = "strategy_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(16), nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="draft", nullable=False
    )  # draft|active|archived
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    strategy_version_id: Mapped[int] = mapped_column(
        ForeignKey("strategy_versions.id"), nullable=True
    )
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # buy|sell|hold
    entry_price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    target_price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    invalidation_price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="generated", nullable=False
    )  # generated|approved|rejected|executed|expired|demo
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class RiskDecision(Base):
    __tablename__ = "risk_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), nullable=False)
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    max_risk_usd: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    position_size: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    decided_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_order_id: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False
    )  # idempotency key / exchange client id
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), nullable=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # buy|sell
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    order_type: Mapped[str] = mapped_column(String(16), default="market", nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False
    )  # pending|approved|sent|executed|partial|cancelled|failed
    mode: Mapped[str] = mapped_column(
        String(16), default="simulation", nullable=False
    )  # simulation|paper|real
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    fills: Mapped[list["Fill"]] = relationship(back_populates="order")


class Fill(Base):
    __tablename__ = "fills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    fee: Mapped[Decimal] = mapped_column(
        Numeric(24, 10), default=Decimal("0"), nullable=False
    )
    filled_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    order: Mapped["Order"] = relationship(back_populates="fills")


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    exit_price: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    pnl_net: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=True)
    opened_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    closed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=True)


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    equity_usd: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    available_usd: Mapped[Decimal] = mapped_column(Numeric(24, 10), nullable=False)
    realized_pnl_usd: Mapped[Decimal] = mapped_column(
        Numeric(24, 10), default=Decimal("0"), nullable=False
    )
    unrealized_pnl_usd: Mapped[Decimal] = mapped_column(
        Numeric(24, 10), default=Decimal("0"), nullable=False
    )
    max_drawdown_pct: Mapped[Decimal] = mapped_column(
        Numeric(10, 4), default=Decimal("0"), nullable=False
    )
    taken_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class SystemEvent(Base):
    __tablename__ = "system_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False)  # info|warn|error
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity: Mapped[str] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=True)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class IdempotencyKey(Base):
    """Infrastructure table (beyond the 12 spec tables): records request
    idempotency keys so retried requests return the original response."""

    __tablename__ = "idempotency_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=True)
    route: Mapped[str] = mapped_column(String(128), nullable=False)
    response_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class AIExplanation(Base):
    """Every signal explanation the assistant gives, logged with the signal
    id so outcomes can later be recorded against it (learning loop)."""

    __tablename__ = "ai_explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_id: Mapped[int | None] = mapped_column(
        ForeignKey("signals.id"), nullable=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    question_excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    answer_excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    confidence: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )  # 0-100, as expressed by the assistant
    outcome: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )  # win | loss | unknown
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    resolved_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AILesson(Base):
    """Structured lessons learned when an explanation's outcome is known."""

    __tablename__ = "ai_lessons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    signal_id: Mapped[int | None] = mapped_column(
        ForeignKey("signals.id"), nullable=True
    )
    claim: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)  # win | loss
    lesson: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
