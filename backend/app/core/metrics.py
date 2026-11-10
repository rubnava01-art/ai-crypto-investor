"""Request metrics middleware + /api/system/metrics endpoint data."""
import time
from collections import Counter

from starlette.middleware.base import BaseHTTPMiddleware

_counters: Counter = Counter()
_started_at = time.monotonic()

# Latencia por ruta (recomendación de la auditoría del Agente 2, 2026-10-29):
# la media global no dice qué ruta es lenta. La clave es la plantilla de
# ruta ("/api/users/{user_id}"), nunca la URL cruda, para no crecer con
# IDs ni parámetros. Tope de rutas registradas: una ruta nueva más allá
# del tope simplemente no se registra (el proceso no crece sin límite).
_MAX_ROUTES = 64
_route_stats: dict[str, dict[str, float | int]] = {}


def _record_route(route: str, latency_ms: float, is_error: bool) -> None:
    stats = _route_stats.get(route)
    if stats is None:
        if len(_route_stats) >= _MAX_ROUTES:
            return
        stats = {"requests": 0, "errors": 0, "latency_ms_total": 0.0}
        _route_stats[route] = stats
    stats["requests"] += 1
    if is_error:
        stats["errors"] += 1
    stats["latency_ms_total"] += latency_ms


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        _counters["requests_total"] += 1
        start = time.monotonic()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            _counters["errors_total"] += 1
            raise
        finally:
            # La plantilla la fija el router durante call_next; sin ruta
            # (p. ej. 404) se agrupa como "unmatched".
            route = request.scope.get("route")
            template = getattr(route, "path", None) or "unmatched"
            latency_ms = (time.monotonic() - start) * 1000
            _record_route(template, latency_ms, status >= 500)
        if status >= 500:
            _counters["errors_total"] += 1
        _counters["latency_ms_total"] += latency_ms
        return response


def snapshot() -> dict:
    total = _counters["requests_total"]
    routes = sorted(
        (
            {
                "route": route,
                "requests": stats["requests"],
                "errors": stats["errors"],
                "avg_latency_ms": round(stats["latency_ms_total"] / stats["requests"], 2),
            }
            for route, stats in _route_stats.items()
        ),
        key=lambda row: row["avg_latency_ms"],
        reverse=True,
    )[:10]
    return {
        "uptime_seconds": round(time.monotonic() - _started_at, 1),
        "requests_total": total,
        "errors_total": _counters["errors_total"],
        "avg_latency_ms": round(_counters["latency_ms_total"] / total, 2) if total else 0,
        "routes": routes,
    }
