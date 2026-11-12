"""E3 (corrida 2026-11-10, Clases) — validación de URL en EduClassCreate.

Contrato: url vacía = opcional (201); con valor debe ser URL absoluta
http:// o https:// (201). Cualquier otro esquema (javascript:, data:,
vbscript:, file:) o URL sin esquema -> 422. La normalización de URLs sin
esquema vive en el frontend; el backend solo valida el esquema.
"""

import pytest


def _create(client, admin_headers, url):
    return client.post(
        "/api/clases/classes",
        json={"kind": "grabada", "title": "Clase URL", "url": url},
        headers=admin_headers,
    )


@pytest.fixture()
def _cleanup(client, admin_headers):
    created = []

    yield created

    for cid in created:
        client.delete(f"/api/clases/classes/{cid}", headers=admin_headers)


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "file:///etc/passwd",
        "ftp://example.com/archivo",
    ],
)
def test_url_scheme_no_permitido_rechazado(client, admin_headers, bad_url):
    r = _create(client, admin_headers, bad_url)
    assert r.status_code == 422, r.text


def test_url_sin_esquema_rechazada(client, admin_headers):
    # Sin esquema no se normaliza en backend: la normalización vive en el
    # frontend. Una URL como "zoom.us/j/123" se guarda rota como enlace
    # relativo, así que se rechaza y el frontend antepone https://.
    for url in ["zoom.us/j/123", "meet.google.com/abc-defg-hij", "//example.com/x"]:
        r = _create(client, admin_headers, url)
        assert r.status_code == 422, r.text


@pytest.mark.parametrize("good_url", ["https://example.com/video", "http://localhost:8000/clase"])
def test_url_http_https_aceptada(client, admin_headers, _cleanup, good_url):
    r = _create(client, admin_headers, good_url)
    assert r.status_code == 201, r.text
    _cleanup.append(r.json()["id"])
    assert r.json()["url"] == good_url


def test_url_vacia_aceptada(client, admin_headers, _cleanup):
    r = _create(client, admin_headers, "")
    assert r.status_code == 201, r.text
    _cleanup.append(r.json()["id"])
    assert r.json()["url"] == ""


def test_url_solo_espacios_aceptada_como_vacia(client, admin_headers, _cleanup):
    r = _create(client, admin_headers, "   ")
    assert r.status_code == 201, r.text
    _cleanup.append(r.json()["id"])
    assert r.json()["url"] == ""


def test_url_esquema_sin_host_rechazada(client, admin_headers):
    # "https:" sin host no es una URL utilizable.
    r = _create(client, admin_headers, "https:sin-host")
    assert r.status_code == 422, r.text
