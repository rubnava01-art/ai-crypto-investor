"""Cache-Control for explicitly static/safe GET endpoints (M4, 2026-11-13).

Only the GET endpoints listed in _CACHEABLE_GET_PATHS get
`Cache-Control: private, max-age=60`. Everything else — dashboard,
all mutable endpoints, all user-specific reads — gets no cache
directive from this middleware (the client already sends
`cache: "no-store"` on its fetches, and no-store stays the default).

Why `private`: these responses are served to an authenticated user,
so they must never sit in a shared cache — only the user's own
browser/proxy may reuse them for 60 s. The data itself is not
personal (public catalogs and lists), it just changes rarely:

- /api/academy/courses — academia catalog (seeded; only an admin edit
  changes it).
- /api/clases/classes — recorded/live classes registered by the admin.
- /api/inicio/posts — Inicio news feed (only changes when the admin
  posts; 60 s of staleness is acceptable for news).
- /api/recomendaciones — recommendations list (admin-curated).

Deliberately NOT cached: /api/dashboard (per-user aggregate),
/api/market/prices and /api/market/ticker (live data with their own
server-side TTL + stale flag), any POST/PATCH/DELETE, and any
per-user or mutable read (CRM, correos, facturas, perfil, users).
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

CACHE_CONTROL_VALUE = "private, max-age=60"

_CACHEABLE_GET_PATHS = frozenset(
    {
        "/api/academy/courses",
        "/api/clases/classes",
        "/api/inicio/posts",
        "/api/recomendaciones",
    }
)


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Adds `Cache-Control: private, max-age=60` to 200 responses of
    the allowlisted GET endpoints only."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if (
            request.method == "GET"
            and request.url.path in _CACHEABLE_GET_PATHS
            and response.status_code == 200
        ):
            response.headers["Cache-Control"] = CACHE_CONTROL_VALUE
        return response
