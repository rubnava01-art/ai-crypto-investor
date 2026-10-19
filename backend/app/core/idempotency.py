"""Idempotency handling for state-changing endpoints.

Clients send an `Idempotency-Key` header. The first request executes and its
response is stored; a retry with the same key returns the stored response
without re-executing (prevents duplicate orders on network retries).
"""
from fastapi import Request
from sqlalchemy.orm import Session

from app.models.tables import IdempotencyKey, User


def check_idempotency(db: Session, key: str, user: User, route: str):
    """Return the stored (status_code, response) if this key was seen, else None."""
    record = (
        db.query(IdempotencyKey)
        .filter(IdempotencyKey.key == key, IdempotencyKey.user_id == user.id)
        .first()
    )
    if record is None:
        return None
    return record.status_code, record.response_json


def store_idempotency(
    db: Session, key: str, user: User, route: str, status_code: int, response: dict
) -> None:
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
