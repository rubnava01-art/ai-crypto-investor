"""Tests for Tendencias + Auditor web modules (2026-10-28).

Covers: URL validation, SSRF rejection (literal IPs, localhost,
metadata host), SEO extraction on sample HTML, score math, suggestion
parsing with mocked HTTP, and endpoint behavior (auth, validation,
SSRF 403, mocked fetch, own-vs-admin audit visibility). No test hits
the real network: suggestion fetches use fakes, auditor fetches use
httpx.MockTransport with patched DNS, and SSRF rejections happen
before any request is made.
"""
import httpx
import pytest

from app.api import auditor as auditor_mod
from app.api import tendencias as tendencias_mod
from app.api.auditor import (
    check_host_allowed,
    compute_score,
    extract_seo,
    fetch_url_audit,
    ip_is_blocked,
    validate_url,
)
from app.api.tendencias import (
    build_query,
    fetch_question_suggestions,
    fetch_suggestions_for_query,
)

SAMPLE_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
<title>Guía completa de creatina para entrenar mejor</title>
<meta name="description" content="La creatina explicada: dosis, beneficios, mitos y cómo tomarla cada día para rendir más.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://ejemplo.com/guia">
<meta property="og:title" content="Guía creatina">
<meta property="og:description" content="Desc og">
<meta name="robots" content="noindex, nofollow">
</head>
<body>
<h1>Guía</h1>
<h1>Otra</h1>
<img src="a.jpg" alt="pesas">
<img src="b.jpg">
<img src="c.jpg" alt="">
<a href="/interno">int</a>
<a href="relativa">rel</a>
<a href="https://otro.com/fuera">ext</a>
<a href="#ancla">ancla</a>
<a href="mailto:a@b.com">mail</a>
</body>
</html>
"""

DESC = "La creatina explicada: dosis, beneficios, mitos y cómo tomarla cada día para rendir más."


def _check_map(checks):
    return {c["id"]: c for c in checks}


# ------------------------------------------------------------------ #
# URL validation                                                      #
# ------------------------------------------------------------------ #
def test_validate_url_accepts_http_https():
    assert validate_url("https://ejemplo.com/pagina") == "https://ejemplo.com/pagina"
    assert validate_url("http://ejemplo.com") == "http://ejemplo.com"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "ftp://ejemplo.com/x",
        "javascript:alert(1)",
        "ejemplo.com/sin-esquema",
        "http://user:pass@ejemplo.com/",
        "https://",
    ],
)
def test_validate_url_rejects(bad):
    with pytest.raises(Exception) as exc:
        validate_url(bad)
    assert getattr(exc.value, "status_code", None) == 422


# ------------------------------------------------------------------ #
# SSRF                                                                #
# ------------------------------------------------------------------ #
@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.0.1", "169.254.169.254", "0.0.0.0", "::1", "100.64.0.1"],
)
def test_ip_is_blocked(ip):
    assert ip_is_blocked(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34"])
def test_ip_is_allowed(ip):
    assert ip_is_blocked(ip) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://10.0.0.5/x",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8000/x",
        "http://metadata.google.internal/",
        "http://[::1]/x",
    ],
)
def test_check_host_allowed_blocks(url):
    with pytest.raises(Exception) as exc:
        check_host_allowed(url)
    assert getattr(exc.value, "status_code", None) == 403


def test_check_host_allowed_public_literal():
    # Literal public IPs need no DNS and must pass the gate.
    check_host_allowed("http://8.8.8.8/")
    check_host_allowed("https://1.1.1.1/x")


# ------------------------------------------------------------------ #
# SEO extraction + score                                              #
# ------------------------------------------------------------------ #
def test_extract_seo_sample():
    checks = _check_map(extract_seo(SAMPLE_HTML, "https://ejemplo.com/guia"))
    assert checks["title_present"]["passed"] is True
    assert checks["title_length"]["passed"] is True  # 45 chars, in 30-60
    assert checks["title_length"]["value"] == "45 caracteres"
    assert checks["description_present"]["passed"] is True
    assert checks["description_length"]["value"] == f"{len(DESC)} caracteres"
    assert checks["description_length"]["passed"] is (50 <= len(DESC) <= 160)
    assert checks["h1_one"]["passed"] is False  # 2 H1s
    assert checks["h1_one"]["value"] == "2 H1"
    assert checks["canonical"]["passed"] is True
    assert checks["og_title"]["passed"] is True
    assert checks["og_description"]["passed"] is True
    assert checks["og_image"]["passed"] is False  # missing
    assert checks["viewport"]["passed"] is True
    assert checks["html_lang"]["passed"] is True
    assert checks["html_lang"]["value"] == "es"
    assert checks["images_alt"]["passed"] is False
    assert checks["images_alt"]["value"] == "2 de 3 sin alt"
    assert checks["robots_noindex"]["passed"] is False
    assert checks["links"]["value"] == "2 internos / 1 externos"


def test_compute_score():
    def mk(n_pass, n_total):
        return [{"passed": i < n_pass} for i in range(n_total)]

    assert compute_score(mk(14, 14)) == 100
    assert compute_score(mk(7, 14)) == 50
    assert compute_score(mk(0, 14)) == 0
    assert compute_score([]) == 0


# ------------------------------------------------------------------ #
# Suggestions parsing (mocked HTTP, no network)                       #
# ------------------------------------------------------------------ #
class _StubResp:
    def __init__(self, status_code, payload=None, raise_exc=None):
        self.status_code = status_code
        self._payload = payload
        self._raise_exc = raise_exc

    def json(self):
        if self._raise_exc:
            raise self._raise_exc
        return self._payload


def test_fetch_suggestions_for_query_parses_firefox_format():
    def fake_get(url, params=None, headers=None, timeout=None, **_kwargs):
        assert "suggestqueries.google.com" in url
        assert params["client"] == "firefox"
        return _StubResp(200, ["qué creatina", ["qué es la creatina", "qué creatina tomar", 123]])

    suggestions, ok = fetch_suggestions_for_query("qué creatina", http_get=fake_get)
    assert ok is True
    assert suggestions == ["qué es la creatina", "qué creatina tomar"]


def test_fetch_suggestions_for_query_failures():
    def fake_403(url, params=None, headers=None, timeout=None, **_kwargs):
        return _StubResp(403, None)

    def fake_boom(url, params=None, headers=None, timeout=None, **_kwargs):
        raise httpx.ConnectError("down", request=None)

    def fake_bad_json(url, params=None, headers=None, timeout=None, **_kwargs):
        return _StubResp(200, {"not": "a list"})

    assert fetch_suggestions_for_query("x", http_get=fake_403) == ([], False)
    assert fetch_suggestions_for_query("x", http_get=fake_boom) == ([], False)
    assert fetch_suggestions_for_query("x", http_get=fake_bad_json) == ([], False)


def test_fetch_question_suggestions_dedupes_and_groups():
    def fake_fetcher(query):
        return (["qué es x", "Qué es X", "qué x tomar"], True)

    results, ok = fetch_question_suggestions("x", fetcher=fake_fetcher)
    assert ok is True
    assert results["es"] == ["qué es x", "qué x tomar"]
    assert results["en"] == ["qué es x", "qué x tomar"]
    assert build_query("creatina", "vs") == "creatina vs"
    assert build_query("creatina", "qué") == "qué creatina"


def test_fetch_question_suggestions_all_failing():
    def fake_fetcher(query):
        raise RuntimeError("boom")

    results, ok = fetch_question_suggestions("x", fetcher=fake_fetcher)
    assert ok is False
    assert results == {"es": [], "en": []}


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #
def test_tendencias_research_endpoint_mocked(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        tendencias_mod,
        "fetch_question_suggestions",
        lambda kw: ({"es": ["qué es creatina"], "en": ["what is creatine"]}, True),
    )
    r = client.get("/api/tendencias/research", params={"keyword": "creatina"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["keyword"] == "creatina"
    assert body["es"] == ["qué es creatina"]
    assert body["en"] == ["what is creatine"]
    assert body["warning"] is None
    r = client.get("/api/tendencias/searches", headers=admin_headers)
    assert r.status_code == 200
    assert any(row["keyword"] == "creatina" for row in r.json())


def test_tendencias_requires_auth_and_validates(client):
    r = client.get("/api/tendencias/research", params={"keyword": "x"})
    assert r.status_code == 401
    r = client.get("/api/tendencias/searches")
    assert r.status_code == 401


def test_auditor_rejects_blocked_and_bad_urls(client, admin_headers):
    r = client.post("/api/auditor/audits", json={"url": "http://127.0.0.1/admin"}, headers=admin_headers)
    assert r.status_code == 403, r.text
    r = client.post("/api/auditor/audits", json={"url": "http://169.254.169.254/latest/"}, headers=admin_headers)
    assert r.status_code == 403, r.text
    r = client.post("/api/auditor/audits", json={"url": "ftp://ejemplo.com/x"}, headers=admin_headers)
    assert r.status_code == 422, r.text


def _mock_audit(url):
    return {
        "url": url,
        "final_url": url,
        "status": 200,
        "redirect_count": 0,
        "ttfb_ms": 120.0,
        "total_ms": 300.0,
        "size_kb": 42.0,
        "is_https": url.startswith("https://"),
        "score": 80,
        "checks": [{"id": "title_present", "label": "Título presente", "passed": True, "value": "T", "ideal": "título"}],
        "note": "",
    }


def test_auditor_endpoints_mocked_and_visibility(client, admin_headers, viewer_headers, monkeypatch):
    monkeypatch.setattr(auditor_mod, "fetch_url_audit", _mock_audit)
    admin_url = "https://admin-only.ejemplo/audit"
    viewer_url = "https://viewer.ejemplo/audit"
    r = client.post("/api/auditor/audits", json={"url": admin_url}, headers=admin_headers)
    assert r.status_code == 201, r.text
    assert r.json()["score"] == 80
    r = client.post("/api/auditor/audits", json={"url": viewer_url}, headers=viewer_headers)
    assert r.status_code == 201, r.text
    admin_list = client.get("/api/auditor/audits", headers=admin_headers).json()
    viewer_list = client.get("/api/auditor/audits", headers=viewer_headers).json()
    admin_urls = [a["url"] for a in admin_list]
    viewer_urls = [a["url"] for a in viewer_list]
    assert admin_url in admin_urls and viewer_url in admin_urls  # admin sees all
    assert viewer_url in viewer_urls and admin_url not in viewer_urls  # viewer sees own only


def test_fetch_url_audit_with_redirect_mock_transport(monkeypatch):
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/final"})
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=SAMPLE_HTML,
        )

    monkeypatch.setattr(auditor_mod, "resolve_host", lambda host: ["93.184.216.34"])
    result = fetch_url_audit("https://ejemplo.com/old", transport=httpx.MockTransport(handler))
    assert result["status"] == 200
    assert result["redirect_count"] == 1
    assert result["final_url"] == "https://ejemplo.com/final"
    assert result["is_https"] is True
    assert result["score"] is not None
    assert result["size_kb"] > 0
    assert result["ttfb_ms"] >= 0


def test_fetch_url_audit_rejects_redirect_to_private(monkeypatch):
    def handler(request):
        return httpx.Response(301, headers={"location": "http://127.0.0.1/secret"})

    real_resolve = auditor_mod.resolve_host
    monkeypatch.setattr(
        auditor_mod,
        "resolve_host",
        lambda host: ["93.184.216.34"] if host == "ejemplo.com" else real_resolve(host),
    )
    with pytest.raises(Exception) as exc:
        fetch_url_audit("https://ejemplo.com/old", transport=httpx.MockTransport(handler))
    # The first hop is public, but the redirect target is a literal
    # private IP: the per-hop re-validation must reject it (403),
    # before any request to it is made.
    assert getattr(exc.value, "status_code", None) == 403
