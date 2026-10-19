"""Exchange clients (public endpoints only — no API keys in Phase 2).

Wraps ccxt with retries + backoff. All timestamps normalized to UTC.
"""
import time

import ccxt

from app.data import _compat

_compat.apply_shims()

SUPPORTED = ("kraken", "coinbase")
SYMBOLS = ("BTC/USD", "ETH/USD")


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
    ex = make_exchange(exchange_id)
    last_err = None
    for attempt in range(attempts):
        try:
            return ex.fetch_ohlcv(symbol, timeframe, limit=limit)
        except (ccxt.NetworkError, ccxt.ExchangeError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise last_err  # type: ignore[misc]


def fetch_ticker(exchange_id: str, symbol: str, attempts: int = 3) -> dict:
    ex = make_exchange(exchange_id)
    last_err = None
    for attempt in range(attempts):
        try:
            return ex.fetch_ticker(symbol)
        except (ccxt.NetworkError, ccxt.ExchangeError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise last_err  # type: ignore[misc]
