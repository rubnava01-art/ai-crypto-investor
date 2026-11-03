"""Retention pruning (Fase 3, M5): growth tables, bounded and logged.

What gets pruned — and what NEVER does:
- system_events older than 90 days (operational log, no FK references).
- idempotency_keys older than 24h (replay window; see core/idempotency).
- trend_searches older than 180 days (per-user search history).
- signals older than 180 days, ONLY when nothing references them (no
  risk_decisions row and no order with signal_id): deleting a signal
  still referenced would break foreign keys, so those stay.
- NEVER user content: posts, comments, contacts, invoices, chat, revelations,
  emotion entries, inventory, compliance items, courses. NEVER audit logs
  (forensic trail) — they are not on this list.

Pruning is throttled to once a day via maybe_daily_prune(), wired into
the scanner loop (which already ticks every 60s when the scanner runs);
tests call prune_stale_rows() directly. Every run logs its counts.
"""
import datetime as dt
import logging
import time

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.models.tables import (
    IdempotencyKey,
    Order,
    RiskDecision,
    Signal,
    SystemEvent,
    TrendSearch,
)

logger = logging.getLogger("ai-crypto-investor")

SYSTEM_EVENTS_RETENTION_DAYS = 90
IDEMPOTENCY_RETENTION_HOURS = 24
TREND_SEARCHES_RETENTION_DAYS = 180
SIGNALS_RETENTION_DAYS = 180

_last_prune_monotonic: float = 0.0
_PRUNE_INTERVAL_SECONDS = 24 * 3600


def prune_stale_rows(db: Session) -> dict[str, int]:
    """Delete stale growth-table rows. One commit. Returns counts."""
    now = dt.datetime.now(dt.timezone.utc)
    counts: dict[str, int] = {}
    counts["system_events"] = (
        db.query(SystemEvent)
        .filter(
            SystemEvent.created_at
            < now - dt.timedelta(days=SYSTEM_EVENTS_RETENTION_DAYS)
        )
        .delete(synchronize_session=False)
    )
    counts["idempotency_keys"] = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.created_at
            < now - dt.timedelta(hours=IDEMPOTENCY_RETENTION_HOURS)
        )
        .delete(synchronize_session=False)
    )
    counts["trend_searches"] = (
        db.query(TrendSearch)
        .filter(
            TrendSearch.created_at
            < now - dt.timedelta(days=TREND_SEARCHES_RETENTION_DAYS)
        )
        .delete(synchronize_session=False)
    )
    # Signals only when unreferenced (FK-safe by construction).
    signal_cutoff = now - dt.timedelta(days=SIGNALS_RETENTION_DAYS)
    counts["signals"] = (
        db.query(Signal)
        .filter(
            Signal.created_at < signal_cutoff,
            ~exists().where(RiskDecision.signal_id == Signal.id),
            ~exists().where(Order.signal_id == Signal.id),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    logger.info("retention prune: %s", counts)
    return counts


def maybe_daily_prune(db: Session) -> dict[str, int] | None:
    """Prune at most once per day (per process). Returns counts, or None
    when throttled. Never raises: retention must not break the loop."""
    global _last_prune_monotonic
    now = time.monotonic()
    if now - _last_prune_monotonic < _PRUNE_INTERVAL_SECONDS:
        return None
    _last_prune_monotonic = now
    try:
        return prune_stale_rows(db)
    except Exception:  # noqa: BLE001 - retention is best-effort
        logger.exception("retention prune failed (ignored)")
        return None
