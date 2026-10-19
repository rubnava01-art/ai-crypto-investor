"""Request metrics middleware + /api/system/metrics endpoint data."""
import time
from collections import Counter

from starlette.middleware.base import BaseHTTPMiddleware

_counters: Counter = Counter()
_started_at = time.monotonic()


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        _counters["requests_total"] += 1
        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            _counters["errors_total"] += 1
            raise
        if response.status_code >= 500:
            _counters["errors_total"] += 1
        _counters["latency_ms_total"] += (time.monotonic() - start) * 1000
        return response


def snapshot() -> dict:
    total = _counters["requests_total"]
    return {
        "uptime_seconds": round(time.monotonic() - _started_at, 1),
        "requests_total": total,
        "errors_total": _counters["errors_total"],
        "avg_latency_ms": round(_counters["latency_ms_total"] / total, 2) if total else 0,
    }
