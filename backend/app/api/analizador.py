"""Analizador IA — estima si el contenido de una URL parece creado con IA.

v1, sin estado y sin servicios externos: descarga la página en el servidor,
extrae el texto legible y calcula indicadores transparentes. NO es un
detector concluyente: el resultado es siempre una ESTIMACIÓN POR INDICIOS
(bajo/medio/alto), nunca un veredicto ("es IA" / "no es IA").

Defensas: reutiliza validate_url y check_host_allowed del módulo Auditor
(solo http/https, sin credenciales, bloqueo de IPs privadas/loopback/
link-local/reservadas incluso tras resolver DNS, en la URL inicial y en
cada redirección). Además: timeout total 10 s, tope 1 MB, máx. 3
redirecciones y rate limit por usuario. No hay cambios de esquema, no hay
variables de entorno nuevas y no se guarda nada.

Además de los 4 indicadores de texto que dan la banda, el Analizador
revisa la estructura de la página (título, meta description, h1, alt de
imágenes, enlaces internos/externos, lang, viewport, Open Graph). Esas
revisiones NO suman puntos: solo dan contexto sobre cómo está construida
la página y generan los próximos pasos concretos.
"""
import re
import time
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.auditor import USER_AGENT, check_host_allowed, validate_url
from app.core.rate_limit import RateLimiter
from app.core.security import get_current_user
from app.models.tables import User

router = APIRouter(prefix="/api/analizador", tags=["analizador"])

TOTAL_TIMEOUT = 10.0
MAX_BODY = 1 * 1024 * 1024  # 1 MB
MAX_REDIRECTS = 3

# Límite generoso, mismo patrón que backtest/auditor: el fetch saliente es
# trabajo pesado y el rol prueba también puede analizar.
analizador_limiter = RateLimiter(max_requests=30, window_seconds=60)

DESCARGO = (
    "Estimación por indicios, no un veredicto: ningún detector puede afirmar "
    "con certeza si un texto fue creado con IA. Usa este resultado como una "
    "señal más, no como prueba."
)

REGLA = (
    "Puntos (máx. 4): +1 si hay 3 o más frases genéricas típicas de IA; "
    "+1 si el texto tiene 100 o más palabras y su diversidad léxica es menor "
    "de 0.40; +1 si la frase promedio supera 25 palabras; +1 si hay 3 o más "
    "frases repetidas. 0–1 puntos = indicio bajo, 2 = medio, 3–4 = alto. "
    "Las revisiones de estructura de la página no suman puntos: solo dan "
    "contexto y generan los próximos pasos."
)

# Rangos habituales para las revisiones de estructura (no son verdades
# absolutas, solo los valores que se suelen recomendar).
TITULO_MIN, TITULO_MAX = 30, 60
DESCRIPCION_MIN, DESCRIPCION_MAX = 120, 160
OG_ESPERADAS = ("og:title", "og:description", "og:image")

# Frases genéricas que aparecen con frecuencia en texto generado con IA.
# Son señales débiles por separado: solo suman un punto en conjunto (3+).
FRASES_GENERICAS_ES = [
    "en conclusión",
    "es importante destacar",
    "en el panorama actual",
    "en un mundo cada vez más",
    "cabe destacar",
    "a lo largo de este artículo",
    "en última instancia",
    "es fundamental",
    "en el ámbito de",
    "en resumen",
]
FRASES_GENERICAS_EN = [
    "in conclusion",
    "it is important to note",
    "in today's fast-paced world",
    "in the ever-evolving landscape",
    "it's worth noting",
    "when it comes to",
    "in summary",
    "delve into",
    "moreover",
    "furthermore",
]

_EMOJI_RANGES = [(0x1F300, 0x1FAFF), (0x2600, 0x27BF), (0x1F000, 0x1F2FF)]
_BLOQUES = {
    "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "header", "footer", "tr", "br", "hr", "blockquote",
}
_OCULTOS = {"script", "style", "noscript", "template"}


class AnalizarRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class IndicadorOut(BaseModel):
    nombre: str
    valor: str
    detalle: str
    punto: bool = False
    # "contenido" (indicadores de texto, los únicos que puntúan) o
    # "estructura" (revisiones de la página, solo contexto).
    categoria: str = "contenido"
    # Seriedad del hallazgo: "error" | "advertencia" | "aviso".
    severidad: str = "aviso"
    # True si la revisión está bien (o es solo informativa).
    pasa: bool = True


class DesgloseOut(BaseModel):
    """Una fila del desglose de la banda: qué regla, cuántos puntos dio."""

    nombre: str
    puntos: int
    maximo: int = 1
    detalle: str


class AnalizarResponse(BaseModel):
    url: str
    final_url: str
    titulo: str
    palabras: int
    indicadores: list[IndicadorOut]
    puntaje: int
    puntaje_maximo: int = 4
    desglose: list[DesgloseOut] = []
    siguientes_pasos: list[str] = []
    banda: str
    etiqueta_banda: str
    regla: str
    descargo: str


class _TextoParser(HTMLParser):
    """Extrae título y texto visible; ignora scripts, estilos y etiquetas.

    Además recoge señales de estructura de la página (lang, meta
    description, viewport, Open Graph, h1, alt de imágenes y enlaces
    internos/externos). `host_base` es el host de la URL final: los
    enlaces relativos y del mismo host cuentan como internos.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.titulo = ""
        self._en_titulo = False
        self._oculto = 0
        self._partes: list[str] = []
        self.lang: str | None = None
        self.meta_description: str | None = None
        self.viewport = False
        self.og: dict[str, bool] = {clave: False for clave in OG_ESPERADAS}
        self.h1 = 0
        self.imagenes = 0
        self.imagenes_con_alt = 0
        self.enlaces_internos = 0
        self.enlaces_externos = 0
        self.host_base = ""

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._en_titulo = True
        elif tag in _OCULTOS:
            self._oculto += 1
        elif tag in _BLOQUES and self._oculto == 0:
            self._partes.append("\n")
        # Señales de estructura (independientes del texto visible).
        if tag == "html":
            for clave, valor in attrs:
                if clave == "lang" and valor.strip() and self.lang is None:
                    self.lang = valor.strip()
        elif tag == "meta":
            datos = dict(attrs)
            nombre = (datos.get("name") or "").lower()
            propiedad = (datos.get("property") or "").lower()
            contenido = (datos.get("content") or "").strip()
            if nombre == "description" and contenido and self.meta_description is None:
                self.meta_description = contenido
            if nombre == "viewport" and contenido:
                self.viewport = True
            if propiedad in self.og and contenido:
                self.og[propiedad] = True
        elif tag == "h1":
            self.h1 += 1
        elif tag == "img":
            self.imagenes += 1
            if (dict(attrs).get("alt") or "").strip():
                self.imagenes_con_alt += 1
        elif tag == "a":
            href = (dict(attrs).get("href") or "").strip()
            if not href or href.startswith("#") or href.lower().startswith(
                ("mailto:", "tel:", "javascript:")
            ):
                return
            if href.startswith(("http://", "https://", "//")):
                host = urlparse(
                    href if "://" in href else "https:" + href
                ).netloc.lower()
                if host == self.host_base:
                    self.enlaces_internos += 1
                else:
                    self.enlaces_externos += 1
            else:
                self.enlaces_internos += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._en_titulo = False
        elif tag in _OCULTOS:
            self._oculto = max(0, self._oculto - 1)
        elif tag in _BLOQUES and self._oculto == 0:
            self._partes.append("\n")

    def handle_data(self, data):
        if self._oculto:
            return
        if self._en_titulo:
            self.titulo += data
        else:
            self._partes.append(data)

    def texto(self) -> str:
        lineas = [ln.strip() for ln in "\n".join(self._partes).splitlines()]
        return "\n".join(ln for ln in lineas if ln)


def extraer_texto(body: bytes, content_type: str) -> tuple[str, str]:
    """Devuelve (título, texto legible). Solo se llama con contenido textual."""
    texto_plano = body.decode("utf-8", errors="replace")
    if "text/html" not in content_type.lower():
        return "", texto_plano.strip()
    parser = _TextoParser()
    parser.feed(texto_plano)
    return parser.titulo.strip(), parser.texto()


def extraer_estructura(body: bytes, content_type: str, base_url: str = "") -> dict | None:
    """Señales de estructura de la página para las revisiones que no
    puntúan. Solo para HTML; devuelve None si el contenido no es HTML."""
    if "text/html" not in content_type.lower():
        return None
    parser = _TextoParser()
    parser.host_base = urlparse(base_url).netloc.lower() if base_url else ""
    parser.feed(body.decode("utf-8", errors="replace"))
    return {
        "titulo_len": len(parser.titulo.strip()),
        "meta_description": parser.meta_description,
        "viewport": parser.viewport,
        "og_presentes": [clave for clave, ok in parser.og.items() if ok],
        "h1": parser.h1,
        "imagenes": parser.imagenes,
        "imagenes_con_alt": parser.imagenes_con_alt,
        "enlaces_internos": parser.enlaces_internos,
        "enlaces_externos": parser.enlaces_externos,
        "lang": parser.lang,
    }


def _contar_emojis(texto: str) -> int:
    return sum(
        1
        for ch in texto
        if any(inicio <= ord(ch) <= fin for inicio, fin in _EMOJI_RANGES)
    )


def analizar_texto(texto: str) -> dict:
    """Indicadores transparentes sobre un texto. Función pura (testeable)."""
    tokens = re.findall(r"\w+", texto.lower(), flags=re.UNICODE)
    palabras = len(tokens)
    frases = [f.strip() for f in re.split(r"[.!?¡!¿…\n]+", texto) if f.strip()]
    n_frases = len(frases)

    normalizado = " ".join(texto.lower().split())
    genericas = [
        frase
        for frase in FRASES_GENERICAS_ES + FRASES_GENERICAS_EN
        if frase in normalizado
    ]
    ocurrencias = sum(normalizado.count(frase) for frase in genericas)

    repetidas = sum(
        1 for _, c in Counter(" ".join(f.lower().split()) for f in frases).items() if c > 1
    )

    ttr = len(set(tokens)) / palabras if palabras else 0.0
    largo_promedio = palabras / n_frases if n_frases else 0.0
    emojis = _contar_emojis(texto)
    lineas_lista = sum(
        1 for ln in texto.splitlines() if re.match(r"\s*([-*•]|\d+[.)])\s", ln)
    )

    punto_genericas = len(genericas) >= 3
    punto_ttr = palabras >= 100 and ttr < 0.40
    punto_largo = largo_promedio > 25
    punto_repetidas = repetidas >= 3
    puntaje = sum([punto_genericas, punto_ttr, punto_largo, punto_repetidas])
    banda = "bajo" if puntaje <= 1 else "medio" if puntaje == 2 else "alto"

    def _sev(punto: bool) -> str:
        return "advertencia" if punto else "aviso"

    indicadores = [
        IndicadorOut(
            nombre="Palabras",
            valor=str(palabras),
            detalle="Tamaño del texto analizado.",
        ),
        IndicadorOut(
            nombre="Frases genéricas típicas de IA",
            valor=f"{len(genericas)} distintas ({ocurrencias} ocurrencias)",
            detalle="Frases de la lista corta (español + inglés) halladas en el texto"
            + (f": {', '.join(genericas)}." if genericas else "."),
            punto=punto_genericas,
            severidad=_sev(punto_genericas),
            pasa=not punto_genericas,
        ),
        IndicadorOut(
            nombre="Diversidad léxica",
            valor=f"{ttr:.2f}",
            detalle="Palabras distintas / palabras totales. Menor de 0.40 con 100+ "
            "palabras sugiere vocabulario repetitivo (solo puntúa con 100+ palabras).",
            punto=punto_ttr,
            severidad=_sev(punto_ttr),
            pasa=not punto_ttr,
        ),
        IndicadorOut(
            nombre="Largo promedio de frase",
            valor=f"{largo_promedio:.1f} palabras",
            detalle="Frases muy largas y uniformes son un rasgo frecuente del texto generado.",
            punto=punto_largo,
            severidad=_sev(punto_largo),
            pasa=not punto_largo,
        ),
        IndicadorOut(
            nombre="Frases repetidas",
            valor=str(repetidas),
            detalle="Frases distintas que aparecen más de una vez en el texto.",
            punto=punto_repetidas,
            severidad=_sev(punto_repetidas),
            pasa=not punto_repetidas,
        ),
        IndicadorOut(
            nombre="Emojis",
            valor=str(emojis),
            detalle="Señal informativa (no suma puntos): los textos generados para "
            "redes suelen abusar de emojis.",
        ),
        IndicadorOut(
            nombre="Líneas de lista",
            valor=str(lineas_lista),
            detalle="Señal informativa (no suma puntos): viñetas y listas numeradas "
            "son un formato típico del texto generado.",
        ),
    ]
    desglose = [
        DesgloseOut(
            nombre="Frases genéricas típicas de IA",
            puntos=int(punto_genericas),
            detalle="Suma 1 punto si hay 3 o más frases genéricas distintas.",
        ),
        DesgloseOut(
            nombre="Diversidad léxica",
            puntos=int(punto_ttr),
            detalle="Suma 1 punto si hay 100+ palabras y la diversidad es menor de 0.40.",
        ),
        DesgloseOut(
            nombre="Largo promedio de frase",
            puntos=int(punto_largo),
            detalle="Suma 1 punto si la frase promedio supera 25 palabras.",
        ),
        DesgloseOut(
            nombre="Frases repetidas",
            puntos=int(punto_repetidas),
            detalle="Suma 1 punto si hay 3 o más frases repetidas.",
        ),
    ]
    return {
        "palabras": palabras,
        "indicadores": indicadores,
        "puntaje": puntaje,
        "banda": banda,
        "desglose": desglose,
    }


def analizar_pagina(estructura: dict | None) -> dict:
    """Revisiones de estructura de la página (no puntúan, solo dan
    contexto). Función pura (testeable): recibe el dict de
    extraer_estructura. Devuelve indicadores con categoría "estructura" y
    los próximos pasos concretos, ordenados por severidad (errores,
    advertencias y luego avisos). Sin estructura (contenido no HTML),
    devuelve listas vacías."""
    if not estructura:
        return {"indicadores": [], "siguientes_pasos": []}

    indicadores: list[IndicadorOut] = []
    pasos: list[tuple[int, str]] = []
    orden = {"error": 0, "advertencia": 1, "aviso": 2}

    def agregar(nombre, valor, detalle, severidad, pasa, paso=None):
        indicadores.append(
            IndicadorOut(
                nombre=nombre,
                valor=valor,
                detalle=detalle,
                categoria="estructura",
                severidad=severidad,
                pasa=pasa,
            )
        )
        if paso is not None:
            pasos.append((orden[severidad], paso))

    # 1. Título (longitud ideal 30–60 caracteres).
    n_titulo = estructura["titulo_len"]
    if n_titulo == 0:
        agregar(
            "Título de la página",
            "Sin título",
            "La página no tiene título: es lo primero que se ve en los "
            "resultados de búsqueda y en la pestaña del navegador.",
            "error",
            False,
            "Escribe un título único de 30 a 60 caracteres que describa el contenido de la página.",
        )
    elif n_titulo < TITULO_MIN:
        agregar(
            "Título de la página",
            f"{n_titulo} caracteres (corto)",
            "Un título de menos de 30 caracteres dice poco en los resultados de búsqueda.",
            "advertencia",
            False,
            "Amplía el título hasta 30–60 caracteres, sin rellenarlo de palabras clave.",
        )
    elif n_titulo > TITULO_MAX:
        agregar(
            "Título de la página",
            f"{n_titulo} caracteres (largo)",
            "Un título de más de 60 caracteres se corta en los resultados de búsqueda.",
            "advertencia",
            False,
            "Recorta el título a 30–60 caracteres, con lo importante al principio.",
        )
    else:
        agregar(
            "Título de la página",
            f"{n_titulo} caracteres",
            "Longitud dentro del rango habitual (30–60 caracteres).",
            "aviso",
            True,
        )

    # 2. Meta description (ideal 120–160 caracteres).
    desc = estructura["meta_description"]
    if desc is None:
        agregar(
            "Meta description",
            "Ausente",
            "Sin meta description, los buscadores inventan el fragmento que "
            "se muestra bajo el título.",
            "advertencia",
            False,
            "Añade una meta description de 120 a 160 caracteres que resuma la página.",
        )
    elif len(desc) < DESCRIPCION_MIN:
        agregar(
            "Meta description",
            f"{len(desc)} caracteres (corta)",
            "Una meta description de menos de 120 caracteres aprovecha poco "
            "el espacio del resultado.",
            "aviso",
            False,
            "Amplía la meta description hasta 120–160 caracteres.",
        )
    elif len(desc) > DESCRIPCION_MAX:
        agregar(
            "Meta description",
            f"{len(desc)} caracteres (larga)",
            "Una meta description de más de 160 caracteres se corta en los "
            "resultados de búsqueda.",
            "aviso",
            False,
            "Recorta la meta description a 120–160 caracteres.",
        )
    else:
        agregar(
            "Meta description",
            f"{len(desc)} caracteres",
            "Longitud dentro del rango habitual (120–160 caracteres).",
            "aviso",
            True,
        )

    # 3. Encabezado h1 (uno por página).
    n_h1 = estructura["h1"]
    if n_h1 == 0:
        agregar(
            "Encabezado h1",
            "Sin h1",
            "La página no tiene un encabezado principal que diga de qué trata.",
            "error",
            False,
            "Añade un único encabezado h1 que describa el tema principal de la página.",
        )
    elif n_h1 > 1:
        agregar(
            "Encabezado h1",
            f"{n_h1} encabezados h1",
            "Más de un h1 confunde sobre cuál es el tema principal de la página.",
            "advertencia",
            False,
            "Deja un solo h1 por página y convierte los demás en h2.",
        )
    else:
        agregar(
            "Encabezado h1",
            "1 encabezado h1",
            "Un solo encabezado principal, como se recomienda.",
            "aviso",
            True,
        )

    # 4. Imágenes y texto alternativo.
    n_img = estructura["imagenes"]
    n_alt = estructura["imagenes_con_alt"]
    if n_img == 0:
        agregar(
            "Imágenes y texto alternativo",
            "Sin imágenes",
            "La página no tiene imágenes: no hay texto alternativo que revisar.",
            "aviso",
            True,
        )
    else:
        pct = round(100 * n_alt / n_img)
        faltan = n_img - n_alt
        if pct == 100:
            agregar(
                "Imágenes y texto alternativo",
                f"{n_alt} de {n_img} con alt (100 %)",
                "Todas las imágenes tienen texto alternativo.",
                "aviso",
                True,
            )
        else:
            paso_alt = (
                f"Añade texto alternativo descriptivo a las {faltan} "
                f"{'imagen' if faltan == 1 else 'imágenes'} que no lo tienen."
            )
            agregar(
                "Imágenes y texto alternativo",
                f"{n_alt} de {n_img} con alt ({pct} %)",
                "Las imágenes sin texto alternativo no se describen a los "
                "lectores de pantalla ni a los buscadores.",
                "advertencia" if pct < 50 else "aviso",
                False,
                paso_alt,
            )

    # 5. Enlaces internos.
    n_int = estructura["enlaces_internos"]
    if n_int == 0:
        agregar(
            "Enlaces internos",
            "0 enlaces internos",
            "La página no enlaza a ninguna otra página del mismo sitio.",
            "aviso",
            False,
            "Añade enlaces internos hacia páginas relacionadas de tu propio sitio.",
        )
    else:
        agregar(
            "Enlaces internos",
            f"{n_int} {'enlace' if n_int == 1 else 'enlaces'}",
            "La página enlaza a otras páginas del mismo sitio.",
            "aviso",
            True,
        )

    # 6. Enlaces externos (solo contexto, nunca un problema).
    n_ext = estructura["enlaces_externos"]
    agregar(
        "Enlaces externos",
        f"{n_ext} {'enlace' if n_ext == 1 else 'enlaces'}",
        "Enlaces hacia otros sitios. Es solo contexto: no tenerlos no es un problema.",
        "aviso",
        True,
    )

    # 7. Atributo lang de <html>.
    lang = estructura["lang"]
    if not lang:
        agregar(
            "Idioma de la página (lang)",
            "Sin atributo lang",
            "Sin lang, los navegadores y lectores de pantalla no saben en "
            "qué idioma está la página.",
            "advertencia",
            False,
            'Añade lang="es" (o el idioma del contenido) a la etiqueta <html>.',
        )
    else:
        agregar(
            "Idioma de la página (lang)",
            lang,
            "Idioma declarado en la etiqueta <html>.",
            "aviso",
            True,
        )

    # 8. Meta viewport (móvil).
    if not estructura["viewport"]:
        agregar(
            "Meta viewport (móvil)",
            "Sin meta viewport",
            "Sin viewport, la página puede verse mal en el móvil.",
            "advertencia",
            False,
            'Añade <meta name="viewport" content="width=device-width, initial-scale=1"> en el <head>.',
        )
    else:
        agregar(
            "Meta viewport (móvil)",
            "Presente",
            "La página declara cómo debe verse en el móvil.",
            "aviso",
            True,
        )

    # 9. Open Graph (vista previa al compartir).
    presentes = estructura["og_presentes"]
    faltan_og = [clave for clave in OG_ESPERADAS if clave not in presentes]
    if not presentes:
        agregar(
            "Open Graph",
            "Sin etiquetas Open Graph",
            "Sin Open Graph, al compartir el enlace se muestra una vista "
            "previa pobre o genérica.",
            "aviso",
            False,
            "Añade og:title, og:description y og:image para controlar la vista previa al compartir.",
        )
    elif faltan_og:
        agregar(
            "Open Graph",
            f"Parcial ({len(presentes)} de 3)",
            "Faltan algunas etiquetas Open Graph para la vista previa al compartir.",
            "aviso",
            False,
            f"Completa las etiquetas Open Graph que faltan: {', '.join(faltan_og)}.",
        )
    else:
        agregar(
            "Open Graph",
            "og:title, og:description y og:image",
            "Vista previa completa para compartir en redes.",
            "aviso",
            True,
        )

    pasos.sort(key=lambda item: item[0])
    return {
        "indicadores": indicadores,
        "siguientes_pasos": [paso for _, paso in pasos],
    }


def fetch_texto(url: str, transport=None) -> tuple[str, str, str, dict | None]:
    """Descarga una URL con defensas SSRF en cada salto. Devuelve
    (url_final, título, texto, estructura). Lanza HTTPException en español ante
    cualquier problema. `transport` es inyectable para tests."""
    url = validate_url(url)
    started = time.monotonic()
    current = url
    redirects = 0
    with httpx.Client(transport=transport, follow_redirects=False, trust_env=False) as client:
        while True:
            check_host_allowed(current)
            remaining = TOTAL_TIMEOUT - (time.monotonic() - started)
            if remaining <= 0:
                raise HTTPException(
                    status_code=502, detail="Tiempo de espera agotado (10 s)."
                )
            try:
                with client.stream(
                    "GET",
                    current,
                    headers={"User-Agent": USER_AGENT},
                    timeout=httpx.Timeout(remaining),
                ) as resp:
                    status = resp.status_code
                    content_type = resp.headers.get("content-type", "")
                    if status in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise HTTPException(
                                status_code=502,
                                detail="La redirección no indica destino.",
                            )
                        if redirects >= MAX_REDIRECTS:
                            raise HTTPException(
                                status_code=502,
                                detail="Demasiadas redirecciones (máx. 3).",
                            )
                        nxt = urljoin(current, location)
                        if urlparse(nxt).scheme not in ("http", "https"):
                            raise HTTPException(
                                status_code=502,
                                detail="Redirección a un esquema no permitido.",
                            )
                        redirects += 1
                        current = nxt
                        continue
                    if status != 200:
                        raise HTTPException(
                            status_code=502,
                            detail=f"La página respondió con el código HTTP {status}.",
                        )
                    if "text/" not in content_type.lower():
                        raise HTTPException(
                            status_code=422,
                            detail=f"La URL no devolvió contenido de texto (tipo: {content_type or 'desconocido'}).",
                        )
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in resp.iter_bytes(65536):
                        total += len(chunk)
                        if total > MAX_BODY:
                            raise HTTPException(
                                status_code=502,
                                detail="La página supera el límite de 1 MB.",
                            )
                        chunks.append(chunk)
                    body = b"".join(chunks)
                    final_url = current
                    break
            except HTTPException:
                raise
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=502, detail="Tiempo de espera agotado (10 s)."
                )
            except httpx.HTTPError:
                raise HTTPException(
                    status_code=502,
                    detail="No se pudo obtener la página (error de conexión).",
                )
    titulo, texto = extraer_texto(body, content_type)
    estructura = extraer_estructura(body, content_type, final_url)
    if not texto.strip():
        raise HTTPException(
            status_code=422, detail="La página no contiene texto legible."
        )
    return final_url, titulo, texto, estructura


@router.post("/analizar", response_model=AnalizarResponse)
def analizar_url(
    payload: AnalizarRequest,
    user: User = Depends(get_current_user),
):
    # Cualquier usuario autenticado puede analizar (como comentar en Inicio);
    # el control es SSRF + rate limit, no el rol.
    if not analizador_limiter.allow(f"analizador:{user.id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas revisiones. Espera un minuto.",
        )
    final_url, titulo, texto, estructura = fetch_texto(payload.url)
    resultado = analizar_texto(texto)
    pagina = analizar_pagina(estructura)
    return AnalizarResponse(
        url=payload.url.strip(),
        final_url=final_url,
        titulo=titulo or "Sin título",
        palabras=resultado["palabras"],
        indicadores=resultado["indicadores"] + pagina["indicadores"],
        puntaje=resultado["puntaje"],
        puntaje_maximo=4,
        desglose=resultado["desglose"],
        siguientes_pasos=pagina["siguientes_pasos"],
        banda=resultado["banda"],
        etiqueta_banda=f"Indicio {resultado['banda']} de contenido generado con IA",
        regla=REGLA,
        descargo=DESCARGO,
    )
