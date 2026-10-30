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
    "frases repetidas. 0–1 puntos = indicio bajo, 2 = medio, 3–4 = alto."
)

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


class AnalizarResponse(BaseModel):
    url: str
    final_url: str
    titulo: str
    palabras: int
    indicadores: list[IndicadorOut]
    puntaje: int
    banda: str
    etiqueta_banda: str
    regla: str
    descargo: str


class _TextoParser(HTMLParser):
    """Extrae título y texto visible; ignora scripts, estilos y etiquetas."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.titulo = ""
        self._en_titulo = False
        self._oculto = 0
        self._partes: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._en_titulo = True
        elif tag in _OCULTOS:
            self._oculto += 1
        elif tag in _BLOQUES and self._oculto == 0:
            self._partes.append("\n")

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
        ),
        IndicadorOut(
            nombre="Diversidad léxica",
            valor=f"{ttr:.2f}",
            detalle="Palabras distintas / palabras totales. Menor de 0.40 con 100+ "
            "palabras sugiere vocabulario repetitivo (solo puntúa con 100+ palabras).",
            punto=punto_ttr,
        ),
        IndicadorOut(
            nombre="Largo promedio de frase",
            valor=f"{largo_promedio:.1f} palabras",
            detalle="Frases muy largas y uniformes son un rasgo frecuente del texto generado.",
            punto=punto_largo,
        ),
        IndicadorOut(
            nombre="Frases repetidas",
            valor=str(repetidas),
            detalle="Frases distintas que aparecen más de una vez en el texto.",
            punto=punto_repetidas,
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
    return {
        "palabras": palabras,
        "indicadores": indicadores,
        "puntaje": puntaje,
        "banda": banda,
    }


def fetch_texto(url: str, transport=None) -> tuple[str, str, str]:
    """Descarga una URL con defensas SSRF en cada salto. Devuelve
    (url_final, título, texto). Lanza HTTPException en español ante
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
    if not texto.strip():
        raise HTTPException(
            status_code=422, detail="La página no contiene texto legible."
        )
    return final_url, titulo, texto


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
    final_url, titulo, texto = fetch_texto(payload.url)
    resultado = analizar_texto(texto)
    return AnalizarResponse(
        url=payload.url.strip(),
        final_url=final_url,
        titulo=titulo or "Sin título",
        palabras=resultado["palabras"],
        indicadores=resultado["indicadores"],
        puntaje=resultado["puntaje"],
        banda=resultado["banda"],
        etiqueta_banda=f"Indicio {resultado['banda']} de contenido generado con IA",
        regla=REGLA,
        descargo=DESCARGO,
    )
