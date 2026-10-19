"""Read-only exchange adapter (Phase 5).

- API keys come ONLY from environment variables, never from the DB, logs, or requests.
- The adapter exposes read operations only (balance, status, fees). It cannot
  place orders by construction: no order methods exist on this class.
- Live verification requires the user to create read-only API keys
  (no withdrawal permission + IP whitelist) and set them in .env.
"""
import ccxt

from app.config import settings
from app.data import _compat

_compat.apply_shims()


class ExchangeNotConfigured(Exception):
    pass


class ReadOnlyAdapter:
    exchange_id = "kraken"  # spec: Coinbase Advanced first, Kraken after

    def __init__(self):
        key = (settings.kraken_api_key or "").strip()
        secret = (settings.kraken_api_secret or "").strip()
        if not key or not secret:
            raise ExchangeNotConfigured(
                "KRAKEN_API_KEY / KRAKEN_API_SECRET are not set. "
                "Create read-only keys (no withdrawal, IP whitelist) and add them to .env."
            )
        cls = getattr(ccxt, self.exchange_id)
        self._ex = cls(
            {
                "apiKey": key,
                "secret": secret,
                "enableRateLimit": True,
                "proxies": _compat.proxy_dict() or None,
                "timeout": 15000,
            }
        )

    def fetch_balance(self) -> dict:
        """Returns {currency: {free, used, total}} — read-only."""
        return self._ex.fetch_balance()

    def fetch_status(self) -> dict:
        status = self._ex.fetch_status()
        return {
            "exchange": self.exchange_id,
            "status": status.get("status", "unknown"),
            "updated": status.get("updated"),
        }


def is_configured() -> bool:
    return bool((settings.kraken_api_key or "").strip()) and bool(
        (settings.kraken_api_secret or "").strip()
    )
