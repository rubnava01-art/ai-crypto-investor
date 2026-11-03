"""Idempotency handling for state-changing endpoints.

Clients send an `Idempotency-Key` header. The first request executes and its
response is stored; a retry with the same key returns the stored response
without re-executing (prevents duplicate orders on network retries).

Fase 2 (M4): the scope is (user_id, route, key). The old code accepted
a `route` argument but ignored it in the lookup, and the column had a
global unique — so two users (or two routes) colliding on one key got a
confusing 409. Keys older than IDEMPOTENCY_TTL_HOURS are pruned
opportunistically on store, so the table cannot grow forever and a key
can legitimately be reused after a day.
"""
import datetime as dt

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.tables import IdempotencyKey, User

IDEMPOTENCY_TTL_HOURS = 24


def prune_idempotency_keys(db: Session, max_age_hours: int = IDEMPOTENCY_TTL_HOURS) -> int:
    """Delete idempotency rows older than `max_age_hours`. Returns the count."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=max_age_hours)
    deleted = (
        db.query(IdempotencyKey)
        .filter(IdempotencyKey.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def check_idempotency(db: Session, key: str, user: User, route: str):
    """Return the stored (status_code, response) if this user+route+key
    was seen, else None."""
    record = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.key == key,
            IdempotencyKey.user_id == user.id,
            IdempotencyKey.route == route,
        )
        .first()
    )
    if record is None:
        return None
    return record.status_code, record.response_json


def store_idempotency(
    db: Session, key: str, user: User, route: str, status_code: int, response: dict
) -> None:
    # Bounded cleanup on every store: the table only ever holds the last
    # 24h of keys, no background job needed.
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=IDEMPOTENCY_TTL_HOURS)
    db.query(IdempotencyKey).filter(
        IdempotencyKey.created_at < cutoff
    ).delete(synchronize_session=False)
    db.add(
        IdempotencyKey(
            key=key,
            user_id=user.id,
            route=route,
            response_json=response,
            status_code=status_code,
        )
    )
    db.commit()


def idempotency_key_from(request: Request) -> str | None:
    return request.headers.get("Idempotency-Key")
