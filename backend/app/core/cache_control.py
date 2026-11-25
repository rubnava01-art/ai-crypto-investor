"""Cache-Control for explicitly static/safe GET endpoints (M4, 2026-11-13).

Only the GET endpoints listed in _CACHEABLE_GET_PATHS get
`Cache-Control: private, max-age=60`. Everything else — dashboard,
all mutable endpoints, all user-specific reads — gets no cache
directive from this middleware (the client already sends
`cache: "no-store"` on its fetches, and no-store stays the default).

Why `private`: these responses are served to an authenticated user,
so they must never sit in a shared cache — only the user's own
browser/proxy may reuse them for 60 s. The lists are the same for
every reader (not per-user data), they just change rarely — the
invoices list carries client names/contact details, so `private`
(rather than a shared cache) is what keeps that safe.

- /api/academy/courses — academia catalog (seeded; only an admin edit
  changes it).
- /api/clases/classes — recorded/live classes registered by the admin.
- /api/inicio/posts — Inicio news feed (only changes when the admin
  posts; 60 s of staleness is acceptable for news).
- /api/recomendaciones — recommendations list (admin-curated).
- /api/videos — educational videos list (admin-curated; only an
  admin edit changes it).
- /api/correos/templates — email templates (admin-curated; only an
  admin edit changes them).
- /api/business/marketing/contenido/plantillas — content templates
  (admin-curated; only an admin edit changes them).
- /api/crear/trends — trend notes (admin-curated; only an admin
  create/delete changes them).
- /api/facturas/invoices — saved invoices list (2026-11-22; shared
  admin-managed list, the same rows for every reader — only linked
  readers are denied outright — and every in-app mutation
  create/status-change/delete invalidates the client memo, so the
  list after saving never shows stale rows; another admin's change
  in another tab can take up to 60 s to appear, the same trade-off
  already accepted for templates/trends).
- /api/talento, /api/riesgos, /api/planillas — Gestión lists
  (2026-11-24; same trade-off as invoices: shared admin-managed
  lists, every in-app mutation invalidates the client memo in
  lib/api/empresa.ts. Talento/Planillas return [] for prueba and the
  full list for admin — `private` keeps that per-browser, so one
  role's cached rows can never leak to another user; the client memo
  is also cleared on every token change.)
- /api/inventario/items — stock list (2026-11-25; same trade-off:
  same rows for every authenticated reader, only the admin writes,
  every in-app mutation invalidates the client memo in
  lib/api/inventario.ts).

Deliberately NOT cached: /api/dashboard (per-user aggregate),
/api/market/prices and /api/market/ticker (live data with their own
server-side TTL + stale flag), any POST/PATCH/DELETE, and any
per-user or mutable read (CRM, correos, perfil, users).
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
        "/api/videos",
        "/api/correos/templates",
        "/api/business/marketing/contenido/plantillas",
        "/api/crear/trends",
        "/api/facturas/invoices",
        "/api/talento",
        "/api/riesgos",
        "/api/planillas",
        "/api/inventario/items",
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
