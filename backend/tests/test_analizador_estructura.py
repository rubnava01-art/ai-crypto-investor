"""Tests de las revisiones de estructura del Analizador IA (2026-11-06).

Cubre: extraer_estructura desde HTML real (lang, meta, h1, alt, enlaces
internos/externos con la URL final como base), las 9 revisiones de
analizar_pagina (título, meta description, h1, alt de imágenes, enlaces
internos/externos, lang, viewport, Open Graph), el orden de los próximos
pasos por severidad, el desglose de la banda y la respuesta del endpoint
con indicadores agrupados por categoría.
"""
import httpx

from app.api import analizador as analizador_mod
from app.api.analizador import (
    analizar_pagina,
    analizar_texto,
    extraer_estructura,
    fetch_texto,
)

HOST_PUBLICO = "http://93.184.216.34"

TEXTO_BAJO = (
    "Fui al mercado y compré pan, queso y fruta. "
    "Mi hija eligió las fresas. "
    "Llovió un rato, así que volvimos temprano a casa."
)


def _estructura_base(**cambios):
    """Página completa y correcta; cada test cambia solo lo que prueba."""
    base = {
        "titulo_len": 45,
        "meta_description": "x" * 140,
        "viewport": True,
        "og_presentes": ["og:title", "og:description", "og:image"],
        "h1": 1,
        "imagenes": 4,
        "imagenes_con_alt": 4,
        "enlaces_internos": 3,
        "enlaces_externos": 2,
        "lang": "es",
    }
    base.update(cambios)
    return base


def _por_nombre(resultado):
    return {ind.nombre: ind for ind in resultado["indicadores"]}


def test_extraer_estructura_html_real():
    html = (
        '<html lang="es"><head><title>Guía completa de riego</title>'
        '<meta name="description" content="' + "d" * 140 + '">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta property="og:title" content="Guía completa de riego">'
        '<meta property="og:image" content="https://ejemplo.com/img.jpg">'
        "</head><body><h1>Riego</h1>"
        '<img src="a.jpg" alt="planta"><img src="b.jpg">'
        '<a href="/otra">interno relativo</a>'
        '<a href="https://ejemplo.com/mas">interno absoluto</a>'
        '<a href="https://fuera.com/x">externo</a>'
        '<a href="#arriba">ancla</a><a href="mailto:a@b.com">correo</a>'
        "<p>Hola mundo.</p></body></html>"
    )
    est = extraer_estructura(html.encode(), "text/html", "https://ejemplo.com/nota")
    assert est is not None
    assert est["titulo_len"] == len("Guía completa de riego")
    assert est["meta_description"] == "d" * 140
    assert est["viewport"] is True
    assert est["og_presentes"] == ["og:title", "og:image"]
    assert est["h1"] == 1
    assert (est["imagenes"], est["imagenes_con_alt"]) == (2, 1)
    assert est["enlaces_internos"] == 2
    assert est["enlaces_externos"] == 1
    assert est["lang"] == "es"


def test_extraer_estructura_no_html():
    assert extraer_estructura(b"hola", "text/plain") is None


def test_analizar_pagina_completa_sin_pasos():
    res = analizar_pagina(_estructura_base())
    assert len(res["indicadores"]) == 9
    assert all(ind.categoria == "estructura" for ind in res["indicadores"])
    assert all(ind.pasa for ind in res["indicadores"])
    assert res["siguientes_pasos"] == []


def test_analizar_pagina_sin_estructura():
    assert analizar_pagina(None) == {"indicadores": [], "siguientes_pasos": []}


def test_analizar_pagina_titulo():
    sin = _por_nombre(analizar_pagina(_estructura_base(titulo_len=0)))
    assert sin["Título de la página"].severidad == "error"
    assert not sin["Título de la página"].pasa

    corto = _por_nombre(analizar_pagina(_estructura_base(titulo_len=12)))
    assert corto["Título de la página"].severidad == "advertencia"
    assert "12 caracteres" in corto["Título de la página"].valor

    largo = _por_nombre(analizar_pagina(_estructura_base(titulo_len=80)))
    assert largo["Título de la página"].severidad == "advertencia"
    assert "80 caracteres" in largo["Título de la página"].valor


def test_analizar_pagina_meta_description():
    ausente = _por_nombre(analizar_pagina(_estructura_base(meta_description=None)))
    assert ausente["Meta description"].severidad == "advertencia"
    assert ausente["Meta description"].valor == "Ausente"

    corta = _por_nombre(analizar_pagina(_estructura_base(meta_description="x" * 60)))
    assert corta["Meta description"].severidad == "aviso"
    assert not corta["Meta description"].pasa

    larga = _por_nombre(analizar_pagina(_estructura_base(meta_description="x" * 200)))
    assert larga["Meta description"].severidad == "aviso"


def test_analizar_pagina_h1():
    sin = _por_nombre(analizar_pagina(_estructura_base(h1=0)))
    assert sin["Encabezado h1"].severidad == "error"

    varios = _por_nombre(analizar_pagina(_estructura_base(h1=3)))
    assert varios["Encabezado h1"].severidad == "advertencia"
    assert "3 encabezados" in varios["Encabezado h1"].valor


def test_analizar_pagina_alt_imagenes():
    sin_img = _por_nombre(analizar_pagina(_estructura_base(imagenes=0, imagenes_con_alt=0)))
    assert sin_img["Imágenes y texto alternativo"].pasa

    completo = _por_nombre(analizar_pagina(_estructura_base(imagenes=2, imagenes_con_alt=2)))
    assert "100 %" in completo["Imágenes y texto alternativo"].valor

    poco = _por_nombre(analizar_pagina(_estructura_base(imagenes=4, imagenes_con_alt=1)))
    assert poco["Imágenes y texto alternativo"].severidad == "advertencia"
    assert "25 %" in poco["Imágenes y texto alternativo"].valor

    mitad = _por_nombre(analizar_pagina(_estructura_base(imagenes=4, imagenes_con_alt=3)))
    assert mitad["Imágenes y texto alternativo"].severidad == "aviso"


def test_analizar_pagina_enlaces_lang_viewport_og():
    res = _por_nombre(
        analizar_pagina(
            _estructura_base(
                enlaces_internos=0,
                enlaces_externos=0,
                lang=None,
                viewport=False,
                og_presentes=[],
            )
        )
    )
    assert res["Enlaces internos"].severidad == "aviso"
    assert not res["Enlaces internos"].pasa
    # Los enlaces externos son solo contexto: nunca fallan.
    assert res["Enlaces externos"].pasa
    assert res["Idioma de la página (lang)"].severidad == "advertencia"
    assert res["Meta viewport (móvil)"].severidad == "advertencia"
    assert res["Open Graph"].valor == "Sin etiquetas Open Graph"

    parcial = _por_nombre(
        analizar_pagina(_estructura_base(og_presentes=["og:title"]))
    )
    assert "Parcial (1 de 3)" in parcial["Open Graph"].valor
    assert not parcial["Open Graph"].pasa


def test_analizar_pagina_pasos_ordenados_por_severidad():
    res = analizar_pagina(
        _estructura_base(
            titulo_len=0,  # error
            h1=0,  # error
            meta_description=None,  # advertencia
            lang=None,  # advertencia
            enlaces_internos=0,  # aviso
        )
    )
    pasos = res["siguientes_pasos"]
    assert len(pasos) == 5
    # Los dos errores van primero, luego las advertencias, luego el aviso.
    assert "título único" in pasos[0]
    assert "h1" in pasos[1]
    assert "meta description" in pasos[2]
    assert "lang" in pasos[3]
    assert "enlaces internos" in pasos[4]


def test_analizar_texto_desglose_suma_puntaje():
    res = analizar_texto(TEXTO_BAJO)
    assert len(res["desglose"]) == 4
    assert sum(fila.puntos for fila in res["desglose"]) == res["puntaje"]
    assert all(fila.maximo == 1 for fila in res["desglose"])
    # Los indicadores de texto llevan categoría y severidad.
    assert all(ind.categoria == "contenido" for ind in res["indicadores"])
    assert all(ind.severidad in ("aviso", "advertencia") for ind in res["indicadores"])


def test_analizador_endpoint_con_estructura(client, admin_headers, monkeypatch):
    def fake_fetch(url):
        html = (
            '<html><head><title>Corto</title></head><body><h1>T</h1>'
            "<p>" + TEXTO_BAJO + "</p></body></html>"
        )
        est = extraer_estructura(html.encode(), "text/html", "https://ejemplo.com/nota")
        return ("https://ejemplo.com/nota", "Corto", TEXTO_BAJO, est)

    monkeypatch.setattr(analizador_mod, "fetch_texto", fake_fetch)
    r = client.post(
        "/api/analizador/analizar",
        json={"url": "https://ejemplo.com/nota"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["puntaje_maximo"] == 4
    assert len(data["desglose"]) == 4
    assert sum(f["puntos"] for f in data["desglose"]) == data["puntaje"]
    categorias = {ind["categoria"] for ind in data["indicadores"]}
    assert categorias == {"contenido", "estructura"}
    estructura = [ind for ind in data["indicadores"] if ind["categoria"] == "estructura"]
    assert len(estructura) == 9
    assert all("severidad" in ind and "pasa" in ind for ind in estructura)
    # Título corto (5) + sin meta + sin lang + sin viewport + sin OG + sin
    # enlaces internos: hay pasos, y el de título va entre los primeros.
    assert data["siguientes_pasos"]
    assert any("título" in paso for paso in data["siguientes_pasos"])
    assert "no suman puntos" in data["regla"]


def test_analizador_endpoint_sin_estructura(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        analizador_mod,
        "fetch_texto",
        lambda url: ("https://ejemplo.com/nota.txt", "Sin título", TEXTO_BAJO, None),
    )
    r = client.post(
        "/api/analizador/analizar",
        json={"url": "https://ejemplo.com/nota.txt"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert all(ind["categoria"] == "contenido" for ind in data["indicadores"])
    assert data["siguientes_pasos"] == []


def test_analizador_fetch_devuelve_estructura():
    def handler(request):
        html = (
            '<html lang="en"><head><title>Nota</title></head>'
            "<body><h1>Hola</h1><p>Hola mundo. Texto corto.</p></body></html>"
        )
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=html.encode()
        )

    final_url, titulo, texto, estructura = fetch_texto(
        f"{HOST_PUBLICO}/nota", transport=httpx.MockTransport(handler)
    )
    assert titulo == "Nota"
    assert estructura is not None
    assert estructura["lang"] == "en"
    assert estructura["h1"] == 1
