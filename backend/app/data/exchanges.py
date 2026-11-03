"""Exchange clients (public endpoints only — no API keys in Phase 2).

Wraps ccxt with retries + backoff. All timestamps normalized to UTC.

Fase 3 (M16): circuit breaker per exchange. A dead exchange used to
cost every caller 3 attempts x 15s timeout with backoff; now, after a
final NETWORK failure (not a bad-request ExchangeError — the exchange
answering "bad symbol" is alive), the breaker opens for 60s and further
calls fail fast without touching the network. Any success closes it.
The breaker is fail-fast only: callers already treat failures as
503/stale, so an open breaker surfaces exactly like an outage.
"""
import threading
import time

import ccxt

from app.data import _compat

_compat.apply_shims()

SUPPORTED = ("kraken", "coinbase")
SYMBOLS = ("BTC/USD", "ETH/USD")

_BREAKER_OPEN_SECONDS = 60.0
_breaker_open_until: dict[str, float] = {}
_breaker_lock = threading.Lock()


class CircuitOpenError(RuntimeError):
    """Raised (fast, no network) while an exchange's breaker is open."""


def reset_circuit_breakers() -> None:
    """Test helper: close every breaker."""
    with _breaker_lock:
        _breaker_open_until.clear()


def _breaker_open(exchange_id: str) -> bool:
    with _breaker_lock:
        until = _breaker_open_until.get(exchange_id)
    return until is not None and time.monotonic() < until


def _breaker_trip(exchange_id: str) -> None:
    with _breaker_lock:
        _breaker_open_until[exchange_id] = time.monotonic() + _BREAKER_OPEN_SECONDS


def _breaker_reset(exchange_id: str) -> None:
    with _breaker_lock:
        _breaker_open_until.pop(exchange_id, None)


def make_exchange(exchange_id: str):
    if exchange_id not in SUPPORTED:
        raise ValueError(f"unsupported exchange: {exchange_id}")
    cls = getattr(ccxt, exchange_id)
    return cls(
        {
            "enableRateLimit": True,
            "proxies": _compat.proxy_dict() or None,
            "timeout": 15000,
        }
    )


def fetch_ohlcv(exchange_id: str, symbol: str, timeframe: str = "1h", limit: int = 100,
                attempts: int = 3):
    """Return list of [ts_ms, open, high, low, close, volume]. Retries on network errors."""
    if _breaker_open(exchange_id):
        raise CircuitOpenError(f"exchange circuit open: {exchange_id}")
    ex = make_exchange(exchange_id)
    last_err = None
    for attempt in range(attempts):
        try:
            result = ex.fetch_ohlcv(symbol, timeframe, limit=limit)
            _breaker_reset(exchange_id)
            return result
        except (ccxt.NetworkError, ccxt.ExchangeError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    # Only network death trips the breaker: an ExchangeError means the
    # exchange answered (bad symbol, rate limit shape, ...) — alive.
    if isinstance(last_err, ccxt.NetworkError):
        _breaker_trip(exchange_id)
    raise last_err  # type: ignore[misc]


def fetch_ticker(exchange_id: str, symbol: str, attempts: int = 3) -> dict:
    if _breaker_open(exchange_id):
        raise CircuitOpenError(f"exchange circuit open: {exchange_id}")
    ex = make_exchange(exchange_id)
    last_err = None
    for attempt in range(attempts):
        try:
            result = ex.fetch_ticker(symbol)
            _breaker_reset(exchange_id)
            return result
        except (ccxt.NetworkError, ccxt.ExchangeError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    if isinstance(last_err, ccxt.NetworkError):
        _breaker_trip(exchange_id)
    raise last_err  # type: ignore[misc]
