"""Tests del Analizador IA (2026-10-30).

Cubre: auth (401 sin token), URL inválida (422), bloqueo SSRF (403 a IPs
privadas/loopback/link-local, también tras redirección), timeout con mock,
contenido no textual, tope de 1 MB, cálculo de indicadores y bandas,
presencia del descargo honesto y rate limit por usuario.
"""
import httpx
import pytest

from app.api import analizador as analizador_mod
from app.api.analizador import analizar_texto, fetch_texto

HOST_PUBLICO = "http://93.184.216.34"

TEXTO_ALTO = (
    "En conclusión, es importante destacar que cabe destacar la relevancia "
    "fundamental del análisis exhaustivo y detallado de cada variable "
    "estratégica dentro del proceso integral de transformación digital "
    "contemporánea y sus implicaciones metodológicas. "
) * 4

TEXTO_MEDIO = (
    "En conclusión, el informe describe un proceso largo y lleno de pasos "
    "intermedios que requieren atención constante y revisión cuidadosa de "
    "cada documento, cada registro y cada evidencia disponible. "
    "Es importante destacar que el equipo revisó todos los archivos con "
    "paciencia, con método y con criterio, sin omitir ningún detalle "
    "relevante para la decisión final del proyecto. "
    "Cabe destacar que la propuesta incluye varias etapas encadenadas que "
    "dependen entre sí y que solo avanzan cuando la anterior queda "
    "completamente cerrada y validada por los responsables."
)

TEXTO_BAJO = (
    "Fui al mercado y compré pan, queso y fruta. "
    "Mi hija eligió las fresas. "
    "Llovió un rato, así que volvimos temprano a casa."
)


def _respuesta_html(texto: str) -> httpx.Response:
    html = f"<html><head><title>Nota de prueba</title></head><body><p>{texto}</p></body></html>"
    return httpx.Response(200, headers={"content-type": "text/html"}, content=html.encode())


def test_analizador_requires_auth(client):
    r = client.post("/api/analizador/analizar", json={"url": "https://ejemplo.com"})
    assert r.status_code == 401


def test_analizador_url_invalida(client, admin_headers):
    for mala in ["", "no-es-una-url", "ftp://ejemplo.com/archivo", "https://"]:
        r = client.post("/api/analizador/analizar", json={"url": mala}, headers=admin_headers)
        assert r.status_code == 422, (mala, r.text)


def test_analizador_ssrf_bloqueado(client, admin_headers):
    for bloqueada in [
        "http://127.0.0.1/admin",
        "http://10.0.0.5/interno",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/local",
    ]:
        r = client.post(
            "/api/analizador/analizar", json={"url": bloqueada}, headers=admin_headers
        )
        assert r.status_code == 403, (bloqueada, r.text)


def test_analizador_fetch_mock_ok():
    def handler(request):
        return _respuesta_html("Hola mundo. Este es un texto corto y variado.")

    transport = httpx.MockTransport(handler)
    final_url, titulo, texto = fetch_texto(f"{HOST_PUBLICO}/nota", transport=transport)
    assert titulo == "Nota de prueba"
    assert "Hola mundo" in texto


def test_analizador_fetch_redireccion_a_privada_bloqueada():
    def handler(request):
        if "93.184.216.34" in str(request.url):
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secreto"})
        return httpx.Response(200, content=b"no deberia llegar")

    transport = httpx.MockTransport(handler)
    with pytest.raises(Exception) as excinfo:
        fetch_texto(f"{HOST_PUBLICO}/redir", transport=transport)
    assert excinfo.value.status_code == 403


def test_analizador_fetch_timeout_y_no_texto():
    def timeout_handler(request):
        raise httpx.TimeoutException("lento", request=request)

    with pytest.raises(Exception) as excinfo:
        fetch_texto(f"{HOST_PUBLICO}/lento", transport=httpx.MockTransport(timeout_handler))
    assert excinfo.value.status_code == 502
    assert "Tiempo de espera" in excinfo.value.detail

    def imagen_handler(request):
        return httpx.Response(200, headers={"content-type": "image/png"}, content=b"\x89PNG")

    with pytest.raises(Exception) as excinfo:
        fetch_texto(f"{HOST_PUBLICO}/img.png", transport=httpx.MockTransport(imagen_handler))
    assert excinfo.value.status_code == 422


def test_analizador_fetch_tope_1mb():
    def grande_handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/plain"}, content=b"x" * (1024 * 1024 + 1)
        )

    with pytest.raises(Exception) as excinfo:
        fetch_texto(f"{HOST_PUBLICO}/grande", transport=httpx.MockTransport(grande_handler))
    assert excinfo.value.status_code == 502


def test_analizador_indicadores_y_bandas():
    alto = analizar_texto(TEXTO_ALTO)
    assert alto["puntaje"] >= 3 and alto["banda"] == "alto"
    assert alto["palabras"] >= 100

    medio = analizar_texto(TEXTO_MEDIO)
    assert medio["puntaje"] == 2 and medio["banda"] == "medio"

    bajo = analizar_texto(TEXTO_BAJO)
    assert bajo["puntaje"] <= 1 and bajo["banda"] == "bajo"


def test_analizador_endpoint_descargo(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        analizador_mod,
        "fetch_texto",
        lambda url: ("https://ejemplo.com/nota", "Nota", TEXTO_MEDIO),
    )
    r = client.post(
        "/api/analizador/analizar",
        json={"url": "https://ejemplo.com/nota"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["banda"] in ("bajo", "medio", "alto")
    assert data["etiqueta_banda"].startswith("Indicio ")
    assert "no un veredicto" in data["descargo"]
    assert data["regla"] and data["indicadores"]
    assert data["titulo"] == "Nota"


def test_analizador_rate_limit(client, viewer_headers, monkeypatch):
    monkeypatch.setattr(
        analizador_mod,
        "fetch_texto",
        lambda url: ("https://ejemplo.com/nota", "Nota", TEXTO_BAJO),
    )
    ultimo = None
    for _ in range(31):
        ultimo = client.post(
            "/api/analizador/analizar",
            json={"url": "https://ejemplo.com/nota"},
            headers=viewer_headers,
        )
    assert ultimo is not None and ultimo.status_code == 429
