"""SQLAlchemy models. All timestamps are UTC. All money uses Numeric (Decimal)."""
import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
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
    # Perfil editable (paquete 2026-10-28): nombre, correo, dirección y
    # foto. Todo opcional y vacío al inicio — nunca se inventa contenido.
    # La foto es un data URL (base64, máx. ~500KB) guardado en la DB para
    # que sobreviva a los reinicios del tier gratuito de Render (sin disco).
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class SuperAdminGrant(Base):
    """Marks a user as super admin — the tier above admin (Acceso, 2026-10-26).

    Kept as a separate table (not a column on users) so existing databases
    need no migration: create_all adds it, and the seed grants it to the
    owner admin account. A super admin passes every admin gate and, in
    addition, is the only tier that can grant/revoke super admin status
    or touch another super admin's account.
    """

    __tablename__ = "super_admin_grants"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    granted_at: Mapped[dt.datetime] = mapped_column(
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


class Contact(Base):
    """CRM contact (Plataforma Unificada — Fase 1).

    The connective tissue between modules: leads and customers from the
    Academy (Estudiar), Cohley brand work, RIV Goods and manual entry.
    `source`: manual|academia|cohley|rivgoods|otro.
    `status`: nuevo|contactado|interesado|cliente|inactivo.
    """

    __tablename__ = "crm_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    phone: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    source: Mapped[str] = mapped_column(
        String(32), default="manual", nullable=False
    )  # manual|academia|cohley|rivgoods|otro
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="nuevo", nullable=False
    )  # nuevo|contactado|interesado|cliente|inactivo
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class CopyDraft(Base):
    """A generated social-media copy kept in the Crear module (Fase 3).

    `demo` records whether the text came from the local stub model (True)
    or a real configured AI provider (False) — the UI labels demo copies
    honestly instead of pretending they are real AI output.
    """

    __tablename__ = "copy_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    platform: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # instagram|threads|facebook
    tone: Mapped[str] = mapped_column(String(32), default="directo", nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class TrendNote(Base):
    """A trend/research note feeding the Crear module (Fase 3).

    Seeded ONLY with topics Rubén actually published on Threads
    (@rubenpromkt, vía @tecnologia) per threads-tecnologia/used-posts.txt;
    new notes are added manually/by research — never invented.
    """

    __tablename__ = "trend_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    source: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    published_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Revelation(Base):
    """A personal revelation/reflection note in the Espacio module.

    Written by Rubén himself (meditation reflections, ideas, lessons) —
    never generated or invented by the system. Any authenticated user
    reads; only admins write/delete.
    """

    __tablename__ = "revelations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Invoice(Base):
    """An invoice generated in the Facturas module.

    Items are stored as JSON: [{description, qty, unit_price}]. Totals
    are computed from items + tax_rate; the backend never invents
    amounts — every line comes from the admin's form (or from the
    materials calculator, which the admin reviews before adding).
    `status`: borrador|enviada|pagada. v1 tracks invoices only; it does
    not charge cards or move money.
    """

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    client_email: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    client_phone: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    items: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="borrador", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class EduClass(Base):
    """A class in the Estudiar module: recorded or live.

    `kind`: grabada (a recorded video: url points to the recording) or
    envivo (a scheduled live session: url points to the meeting room and
    scheduled_at is the start time). Classes are added by the admin only
    — the system never invents classes, links, or schedules. Lists start
    empty.
    """

    __tablename__ = "edu_classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    scheduled_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class EmailTemplate(Base):
    """A reusable email template in the Correos module (HubSpot-style).

    Body supports personalization tokens replaced at compose time:
    {{nombre}}, {{negocio}}, {{telefono}}, {{email}}. Templates are
    written by the admin — never generated or invented by the system.
    """

    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class EmailLog(Base):
    """A record of an email prepared (or sent) from the Correos module.

    v1 does NOT send mail from the server (no SMTP configured): the
    composer produces a ready email + a Gmail compose link, and the admin
    sends it from his own inbox. `status`: preparado (ready, not yet
    sent by the admin) or enviado (admin confirmed he sent it). The log
    is the contact's email timeline — the HubSpot-style activity record.
    """

    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contact_name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    template_name: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    subject: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="preparado", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Course(Base):
    """Academia catalog item (Plataforma Unificada — Fase 2, módulo Estudiar).

    Seeded with Rubén's REAL catalog: the 6 Hotmart ebooks ($19.99), the
    Pack Creador Completo ($59.99) and the $400 Academy. Prices/URLs come
    from the documented records — never invented.
    `kind`: ebook|pack|academia.
    """

    __tablename__ = "academy_courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    price_usd: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False
    )
    kind: Mapped[str] = mapped_column(
        String(16), default="ebook", nullable=False
    )  # ebook|pack|academia
    buy_url: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    delivery_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class CourseEnrollment(Base):
    """Delivery record: a CRM contact bought/received a course (Fase 2).

    One row per (contact, course). `purchased` = the sale happened;
    `delivered` = the content was actually handed over, with timestamps
    for both so the Academy fulfillment is auditable from the CRM.
    """

    __tablename__ = "academy_enrollments"
    __table_args__ = (
        UniqueConstraint("contact_id", "course_id", name="uq_enrollment_contact_course"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(
        ForeignKey("crm_contacts.id"), nullable=False
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("academy_courses.id"), nullable=False
    )
    purchased: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    purchased_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    delivered_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class ReferralCampaign(Base):
    """Referral campaign (Plataforma Unificada — módulo Referidos).

    A business (optionally an existing CRM contact) runs a campaign:
    existing customers share the campaign's share_code, and when a
    referred person becomes a new client the referral is tracked here.

    `reward_type`: fixed (a fixed amount, currency of the business) or
    percentage (a % of the referred client's first purchase).
    `status`: active|paused|ended.
    Rewards are TRACKED only (pending/confirmed/rewarded on the
    Referral row) — v1 processes no actual money movement.
    """

    __tablename__ = "referral_campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    business_contact_id: Mapped[int | None] = mapped_column(
        ForeignKey("crm_contacts.id"), nullable=True
    )
    share_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    reward_type: Mapped[str] = mapped_column(
        String(16), default="fixed", nullable=False
    )  # fixed|percentage
    reward_value: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), nullable=False
    )
    reward_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="active", nullable=False
    )  # active|paused|ended
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Referral(Base):
    """One tracked referral inside a campaign.

    `code` is the referral code presented when the referred person was
    brought in — it defaults to the campaign's share_code and may be a
    referrer-specific code set by the admin.
    `status`: pending (referred, not yet a client) -> confirmed (became
    a client) -> rewarded (reward recorded as given). Forward-only.
    """

    __tablename__ = "referrals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("referral_campaigns.id"), nullable=False
    )
    referrer_name: Mapped[str] = mapped_column(String(128), nullable=False)
    referrer_contact: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    referred_name: Mapped[str] = mapped_column(String(128), nullable=False)
    referred_contact: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", nullable=False
    )  # pending|confirmed|rewarded
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class BusinessNote(Base):
    """A note inside one Business area (Plataforma Unificada — módulo Business).

    Notes are scoped per area and never mixed: each row belongs to
    exactly one area (marketing|ventas|legal|administrativo) and the
    API only ever lists or creates notes inside the requested area.
    """

    __tablename__ = "business_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    area: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class BusinessTask(Base):
    """A task inside one Business area (Plataforma Unificada — módulo Business).

    Same per-area scoping as BusinessNote. `done` toggles without
    deleting the row so completed work stays visible in its area.
    """

    __tablename__ = "business_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    area: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class ChatMessage(Base):
    """A message in the Chat en vivo module (paquete 2026-10-28).

    Any authenticated user (admin or prueba) can read and post; only
    admins delete (moderation). The panel polls every ~5s — near-real-time
    without WebSocket infra, which the free tier does not support well.
    `author_label` snapshots the author's display name at post time so
    history stays readable if the profile changes later. No seed
    messages: the chat starts empty.
    """

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    author_username: Mapped[str] = mapped_column(String(64), nullable=False)
    author_label: Mapped[str] = mapped_column(String(100), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Recommendation(Base):
    """An admin-managed recommendation (módulo Recomendaciones, 2026-10-28).

    Recommends Estudiar courses and Crear tools: `category` is
    curso|herramienta, `url` points at the course/tool. Starts EMPTY —
    the system never invents recommendations. Admin CRUD, prueba
    read-only.
    """

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    url: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    category: Mapped[str] = mapped_column(
        String(16), default="curso", nullable=False
    )  # curso|herramienta
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class DigitalProject(Base):
    """A business digital-adaptation project (módulo Desarrollo digital).

    Linked to an existing CRM contact (the company being adapted).
    `stage`: diagnostico|propuesta|desarrollo|entrega, forward in
    practice but editable back by the admin. `notes` holds the
    adaptation plan / meeting notes. Starts EMPTY. Admin CRUD, prueba
    read-only.
    """

    __tablename__ = "digital_projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int | None] = mapped_column(
        ForeignKey("crm_contacts.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    stage: Mapped[str] = mapped_column(
        String(32), default="diagnostico", nullable=False
    )  # diagnostico|propuesta|desarrollo|entrega
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class DigitalTask(Base):
    """A task inside a digital-adaptation project (Desarrollo digital)."""

    __tablename__ = "digital_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("digital_projects.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class TrendSearch(Base):
    """A keyword a user researched in the Tendencias module.

    User-scoped history only (keyword + date) — no volumes, no trend
    scores, nothing invented. The research itself comes from live Google
    autocomplete suggestions (see tendencias.py); this table only
    remembers what the user already searched.
    """

    __tablename__ = "trend_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    keyword: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class WebAudit(Base):
    """A single-page web audit from the Auditor module.

    Only what was actually fetched and measured is stored: HTTP status,
    final URL, redirect count, TTFB, total time, size, HTTPS flag, the
    SEO checklist (as JSON) and the transparent score (% of checks
    passed). No crawl, no sitemap check, no Core Web Vitals — the UI
    says so explicitly.
    """

    __tablename__ = "web_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    final_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    redirect_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ttfb_ms: Mapped[float] = mapped_column(nullable=False)
    total_ms: Mapped[float] = mapped_column(nullable=False)
    size_kb: Mapped[float] = mapped_column(nullable=False)
    is_https: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checks_json: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
