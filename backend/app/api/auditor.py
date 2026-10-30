"""Auditor web — single-page speed/performance/SEO audit (2026-10-28).

Enter a URL, get honestly measured numbers for THAT page only:

- HTTP status, final URL, redirect count, TTFB, total load time,
  page size (KB), HTTPS yes/no.
- An SEO checklist where every item shows pass/fail WITH the found
  value (title + length, meta description + length, H1 count,
  canonical, og tags, viewport, html lang, images missing alt, robots
  noindex warning, internal/external link counts).
- A transparent score: 0–100 = percentage of checklist items passed,
  always displayed WITH the full checklist. The UI states explicitly
  that this is a basic single-page review, NOT a Lighthouse or
  PageSpeed score. No crawl, no sitemap check, no Core Web Vitals —
  nothing is claimed that was not fetched.

SSRF PROTECTION (mandatory, server-side fetch of user-supplied URLs):
- http(s) only, no credentials in the URL, hostname required.
- The hostname is resolved via DNS and EVERY resolved IP is checked:
  private, loopback, link-local, reserved, multicast, unspecified, or
  simply not globally routable → the URL is rejected (403) before any
  request is made. Literal IPs get the same check. "localhost" and
  metadata hosts (metadata.google.internal) are blocklisted by name.
- Every redirect hop is re-validated the same way (max 5 redirects);
  a redirect to a non-http(s) scheme is rejected.
- Timeout 15s total, max body 2MB, browser-like User-Agent.

Residual limitation, stated honestly: DNS is checked before each hop,
but a hostile DNS could theoretically swap an answer between the
check and the connection (TOCTOU / DNS rebinding). The per-hop
validation plus the redirect cap is the practical mitigation at this
scope; the endpoint must never run on a network where reaching
internal services would be catastrophic.

Audits are saved (user, URL, score, metrics, checks, timestamp).
Listing shows the caller's own audits; admins see everyone's.
"""
import ipaddress
import socket
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.rate_limit import auditor_limiter
from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import User, WebAudit

router = APIRouter(prefix="/api/auditor", tags=["auditor"])

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TOTAL_TIMEOUT = 15.0
MAX_BODY = 2 * 1024 * 1024  # 2 MB
MAX_REDIRECTS = 5

BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata"}
BLOCKED_SUFFIXES = (".localhost", ".internal")


# ------------------------------------------------------------------ #
# URL validation + SSRF protection                                    #
# ------------------------------------------------------------------ #
def validate_url(raw: str) -> str:
    """Validate the user-supplied URL. Returns the stripped URL or
    raises 422. Only http(s), a hostname, and no embedded credentials."""
    url = (raw or "").strip()
    if not url:
        raise HTTPException(status_code=422, detail="Escribe una URL.")
    if len(url) > 2048:
        raise HTTPException(status_code=422, detail="La URL es demasiado larga (máx. 2048 caracteres).")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=422, detail="Solo se permiten URLs http:// o https://.")
    if not parsed.hostname:
        raise HTTPException(status_code=422, detail="La URL necesita un dominio (ej. https://ejemplo.com).")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=422, detail="No se permiten URLs con usuario y contraseña.")
    return url


def ip_is_blocked(ip_str: str) -> bool:
    """True when an IP must never be fetched: anything that is not a
    globally routable public address."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or not ip.is_global
    )


def resolve_host(hostname: str) -> list[str]:
    """Resolve a hostname to its IPs. Raises 502 when DNS fails."""
    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise HTTPException(status_code=502, detail=f"No se pudo resolver el dominio: {hostname}")
    ips = sorted({info[4][0] for info in infos if info[4]})
    if not ips:
        raise HTTPException(status_code=502, detail=f"No se pudo resolver el dominio: {hostname}")
    return ips


def check_host_allowed(url: str) -> None:
    """SSRF gate for one URL (initial URL and every redirect hop).
    Raises 403 when the destination is blocked, 502 when DNS fails."""
    host = (urlparse(url).hostname or "").lower()
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_SUFFIXES):
        raise HTTPException(status_code=403, detail="URL bloqueada por seguridad (destino interno o reservado).")
    for ip in resolve_host(host):
        if ip_is_blocked(ip):
            raise HTTPException(
                status_code=403,
                detail="URL bloqueada por seguridad: el dominio resuelve a una dirección privada o reservada.",
            )


# ------------------------------------------------------------------ #
# SEO extraction (stdlib html.parser only)                            #
# ------------------------------------------------------------------ #
class _SEOParser(HTMLParser):
    def __init__(self, base_host: str):
        super().__init__(convert_charrefs=True)
        self.base_host = base_host
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.canonical = ""
        self.lang = ""
        self.h1_count = 0
        self.img_total = 0
        self.img_missing_alt = 0
        self.internal_links = 0
        self.external_links = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_d = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = (attrs_d.get("name") or attrs_d.get("property") or "").lower()
            if name and "content" in attrs_d:
                self.meta[name] = attrs_d["content"]
        elif tag == "link":
            if attrs_d.get("rel", "").lower() == "canonical" and attrs_d.get("href"):
                self.canonical = attrs_d["href"]
        elif tag == "html":
            self.lang = attrs_d.get("lang", "")
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "img":
            self.img_total += 1
            if not attrs_d.get("alt", "").strip():
                self.img_missing_alt += 1
        elif tag == "a":
            href = attrs_d.get("href", "").strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                return
            parsed = urlparse(href)
            host = (parsed.hostname or "").lower()
            if not host or host == self.base_host:
                self.internal_links += 1
            else:
                self.external_links += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def _check(check_id: str, label: str, passed: bool, value: str, ideal: str) -> dict:
    return {"id": check_id, "label": label, "passed": passed, "value": value, "ideal": ideal}


def extract_seo(html: str, base_url: str) -> list[dict]:
    """Build the SEO checklist from one page's HTML. Every item shows
    pass/fail WITH the found value — nothing is hidden behind the
    score."""
    parser = _SEOParser((urlparse(base_url).hostname or "").lower())
    parser.feed(html)
    title = parser.title.strip()
    description = parser.meta.get("description", "").strip()
    robots = parser.meta.get("robots", "").strip()
    checks = [
        _check("title_present", "Título presente", bool(title), title or "ausente", "título no vacío"),
        _check("title_length", "Longitud del título", 30 <= len(title) <= 60, f"{len(title)} caracteres", "30–60 caracteres"),
        _check("description_present", "Meta descripción presente", bool(description), description or "ausente", "descripción no vacía"),
        _check("description_length", "Longitud de la descripción", 50 <= len(description) <= 160, f"{len(description)} caracteres", "50–160 caracteres"),
        _check("h1_one", "Un solo H1", parser.h1_count == 1, f"{parser.h1_count} H1", "exactamente 1"),
        _check("canonical", "Canonical presente", bool(parser.canonical), parser.canonical or "ausente", "enlace canonical"),
        _check("og_title", "og:title presente", bool(parser.meta.get("og:title", "").strip()), parser.meta.get("og:title", "").strip() or "ausente", "og:title"),
        _check("og_description", "og:description presente", bool(parser.meta.get("og:description", "").strip()), parser.meta.get("og:description", "").strip() or "ausente", "og:description"),
        _check("og_image", "og:image presente", bool(parser.meta.get("og:image", "").strip()), parser.meta.get("og:image", "").strip() or "ausente", "og:image"),
        _check("viewport", "Meta viewport (móvil)", bool(parser.meta.get("viewport", "").strip()), parser.meta.get("viewport", "").strip() or "ausente", "viewport"),
        _check("html_lang", "Idioma en <html lang>", bool(parser.lang.strip()), parser.lang.strip() or "ausente", "atributo lang"),
        _check(
            "images_alt",
            "Imágenes con alt",
            parser.img_missing_alt == 0,
            f"{parser.img_missing_alt} de {parser.img_total} sin alt",
            "0 sin alt",
        ),
        _check(
            "robots_noindex",
            "Sin noindex en robots",
            "noindex" not in robots.lower(),
            robots or "sin meta robots",
            "sin noindex",
        ),
        _check("links", "Enlaces internos / externos", True, f"{parser.internal_links} internos / {parser.external_links} externos", "informativo"),
    ]
    return checks


def compute_score(checks: list[dict]) -> int:
    """Transparent score: percentage of checklist items passed. The
    'links' item is informational and always passes, so it counts
    toward the total like any other item — the checklist itself shows
    exactly what went into the number."""
    if not checks:
        return 0
    passed = sum(1 for c in checks if c["passed"])
    return round(100 * passed / len(checks))


# ------------------------------------------------------------------ #
# Fetch + audit                                                       #
# ------------------------------------------------------------------ #
def fetch_url_audit(url: str, transport=None) -> dict:
    """Fetch one page with SSRF checks on every hop and honestly
    measured metrics. Returns a dict ready to store/serialize. Raises
    HTTPException (422/403/502) on validation, blocking, or fetch
    failure. `transport` is injectable for tests (httpx.MockTransport)."""
    url = validate_url(url)
    started = time.monotonic()
    current = url
    redirects = 0
    ttfb_ms = 0.0
    body = b""
    status = 0
    content_type = ""
    with httpx.Client(transport=transport, follow_redirects=False, trust_env=False) as client:
        while True:
            check_host_allowed(current)
            remaining = TOTAL_TIMEOUT - (time.monotonic() - started)
            if remaining <= 0:
                raise HTTPException(status_code=502, detail="Tiempo de espera agotado (15s).")
            hop_started = time.monotonic()
            try:
                with client.stream(
                    "GET",
                    current,
                    headers={"User-Agent": USER_AGENT},
                    timeout=httpx.Timeout(remaining),
                ) as resp:
                    ttfb_ms = (time.monotonic() - hop_started) * 1000
                    status = resp.status_code
                    content_type = resp.headers.get("content-type", "")
                    if status in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            final_url = current
                            break
                        if redirects >= MAX_REDIRECTS:
                            raise HTTPException(status_code=502, detail="Demasiadas redirecciones (máx. 5).")
                        nxt = urljoin(current, location)
                        if urlparse(nxt).scheme not in ("http", "https"):
                            raise HTTPException(status_code=502, detail="Redirección a un esquema no permitido.")
                        redirects += 1
                        current = nxt
                        continue
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in resp.iter_bytes(65536):
                        total += len(chunk)
                        if total > MAX_BODY:
                            raise HTTPException(status_code=502, detail="La página supera el límite de 2MB.")
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    final_url = current
                    break
            except HTTPException:
                raise
            except httpx.TimeoutException:
                raise HTTPException(status_code=502, detail="Tiempo de espera agotado (15s).")
            except httpx.HTTPError:
                raise HTTPException(status_code=502, detail="No se pudo obtener la página (error de conexión).")
    total_ms = (time.monotonic() - started) * 1000
    is_html = "text/html" in content_type.lower()
    if is_html:
        try:
            html = body.decode("utf-8", errors="replace")
        except Exception:
            html = ""
        checks = extract_seo(html, final_url)
        score: int | None = compute_score(checks)
        note = ""
    else:
        checks = []
        score = None
        note = "La URL no devolvió HTML, así que no se pudo hacer la revisión SEO (solo métricas de carga)."
    return {
        "url": url,
        "final_url": final_url,
        "status": status,
        "redirect_count": redirects,
        "ttfb_ms": round(ttfb_ms, 1),
        "total_ms": round(total_ms, 1),
        "size_kb": round(len(body) / 1024, 1),
        "is_https": urlparse(final_url).scheme == "https",
        "score": score,
        "checks": checks,
        "note": note,
    }


# ------------------------------------------------------------------ #
# API                                                                 #
# ------------------------------------------------------------------ #
class AuditCreate(BaseModel):
    url: str


class AuditCheckOut(BaseModel):
    id: str
    label: str
    passed: bool
    value: str
    ideal: str


class AuditOut(BaseModel):
    id: int
    url: str
    final_url: str
    status: int
    redirect_count: int
    ttfb_ms: float
    total_ms: float
    size_kb: float
    is_https: bool
    score: int | None
    checks: list[AuditCheckOut]
    note: str
    owner_username: str | None = None
    created_at: str | None = None


def _out(row: WebAudit, users_by_id: dict[int, str]) -> AuditOut:
    return AuditOut(
        id=row.id,
        url=row.url,
        final_url=row.final_url,
        status=row.status,
        redirect_count=row.redirect_count,
        ttfb_ms=row.ttfb_ms,
        total_ms=row.total_ms,
        size_kb=row.size_kb,
        is_https=row.is_https,
        score=row.score,
        checks=[AuditCheckOut(**c) for c in (row.checks_json or [])],
        note=row.note or "",
        owner_username=users_by_id.get(row.user_id) if row.user_id else None,
        created_at=row.created_at.isoformat() if row.created_at else None,
    )


@router.post("/audits", response_model=AuditOut, status_code=201)
def run_audit(
    payload: AuditCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Fetch saliente desde el servidor: límite por usuario antes de salir.
    if not auditor_limiter.allow(f"auditor:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas auditorías. Espera un minuto.",
        )
    result = fetch_url_audit(payload.url)
    row = WebAudit(
        user_id=user.id,
        url=result["url"],
        final_url=result["final_url"],
        status=result["status"],
        redirect_count=result["redirect_count"],
        ttfb_ms=result["ttfb_ms"],
        total_ms=result["total_ms"],
        size_kb=result["size_kb"],
        is_https=result["is_https"],
        score=result["score"],
        checks_json=result["checks"],
        note=result["note"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row, {user.id: user.username})


@router.get("/audits", response_model=list[AuditOut])
def list_audits(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(WebAudit).order_by(WebAudit.id.desc())
    if not user.is_admin:
        query = query.filter(WebAudit.user_id == user.id)
    rows = query.limit(20).all()
    user_ids = {r.user_id for r in rows if r.user_id}
    names = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [_out(r, names) for r in rows]
