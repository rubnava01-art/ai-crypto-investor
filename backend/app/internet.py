"""Consulta en Internet SIN clave para el Asistente (corrida
2026-11-23, Agente 2).

Solo se envía la pregunta genérica del usuario (nunca datos de la
plataforma: ni contactos, facturas, citas, precios internos ni
nada del CRM). Fuentes, en orden:

1. DuckDuckGo Instant Answer (sin clave).
2. Wikipedia REST summary en español, con fallback en inglés.
3. Fetch directo de una página pública (la URL del resumen de
   DuckDuckGo) como último recurso.

Timeout 8 s por fuente, con un presupuesto global de 10 s para toda
la búsqueda (M2, QA 2026-11-23): sin él, 4 fuentes lentas en serie
podían tardar ~32 s dentro de una petición de chat. Cada petición
usa min(8 s, tiempo restante del presupuesto); agotado el
presupuesto, las fuentes que faltan se saltan. Caché en memoria con
TTL 900 s (también para los "sin resultado", para no reintentar lo
mismo sin parar).
Sin dependencias nuevas: httpx ya está en requirements.txt.
"""
import html
import re
import time
from urllib.parse import quote, quote_plus

import httpx

TIMEOUT_S = 8.0
PRESUPUESTO_TOTAL_S = 10.0
CACHE_TTL_S = 900

_cache: dict[str, tuple[float, dict | None]] = {}

_PREGUNTA_LIDER = (
    "que es", "qué es", "que son", "qué son", "quien es", "quién es",
    "quienes son", "quiénes son", "que significa", "qué significa",
    "que fue", "qué fue", "cuando fue", "cuándo fue", "donde esta",
    "dónde está", "donde queda", "dónde queda",
)


def limpiar_cache() -> None:
    """Vacía el caché (para tests)."""
    _cache.clear()


def _titulo_desde_pregunta(pregunta: str) -> str:
    """Título probable para Wikipedia: quita el interrogativo y los
    signos de pregunta; si no queda nada útil, devuelve la pregunta
    tal cual (recortada)."""
    texto = pregunta.strip().strip("¿?¡!").strip()
    bajo = texto.lower()
    for lider in _PREGUNTA_LIDER:
        if bajo.startswith(lider + " "):
            texto = texto[len(lider):].strip()
            break
    texto = texto.strip("¿?¡!").strip()
    return texto[:120] if texto else pregunta.strip()[:120]


def _restante(deadline: float) -> float:
    """Segundos que quedan del presupuesto global (nunca negativos)."""
    return max(0.0, deadline - time.monotonic())


def _desde_ddg(client: httpx.Client, pregunta: str, timeout: float) -> dict | None:
    try:
        r = client.get(
            "https://api.duckduckgo.com/",
            params={
                "q": pregunta, "format": "json",
                "no_html": "1", "skip_disambig": "1",
            },
            timeout=timeout,
        )
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except ValueError:
        return None
    abstract = (data.get("AbstractText") or "").strip()
    url = (data.get("AbstractURL") or "").strip()
    if abstract:
        return {
            "nombre": "DuckDuckGo",
            # B2 (QA 2026-11-23): la pregunta va codificada en la URL
            # de fallback (antes iba sin codificar).
            "url": url or "https://duckduckgo.com/?q=" + quote_plus(pregunta),
            "texto": abstract,
        }
    if url:
        return {"nombre": "DuckDuckGo", "url": url, "texto": ""}
    return None


def _desde_wikipedia(client: httpx.Client, titulo: str, deadline: float) -> dict | None:
    titulo_q = quote(titulo, safe="")
    for lang in ("es", "en"):
        restante = _restante(deadline)
        if restante <= 0:
            break
        try:
            r = client.get(
                f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{titulo_q}",
                timeout=min(TIMEOUT_S, restante),
            )
        except httpx.HTTPError:
            continue
        if r.status_code != 200:
            continue
        try:
            data = r.json()
        except ValueError:
            continue
        if data.get("type") == "disambiguation":
            continue
        extract = (data.get("extract") or "").strip()
        if not extract:
            continue
        url = (data.get("content_urls") or {}).get("desktop", {}).get("page") or ""
        return {
            "nombre": f"Wikipedia ({lang})",
            "url": url,
            "texto": extract,
        }
    return None


def _texto_visible(html_text: str, limite: int = 600) -> str:
    """Texto visible de una página pública: quita scripts/estilos y
    etiquetas; primer párrafo con sustancia."""
    sin_scripts = re.sub(
        r"<(script|style)[^>]*>.*?</\1>", " ",
        html_text, flags=re.IGNORECASE | re.DOTALL,
    )
    texto = re.sub(r"<[^>]+>", " ", sin_scripts)
    texto = html.unescape(texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return texto[:limite]


def _fetch_directo(client: httpx.Client, url: str, timeout: float) -> dict | None:
    try:
        r = client.get(url, headers={"User-Agent": "GrowBusinessPlatform/1.0"},
                       timeout=timeout)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    texto = _texto_visible(r.text)
    if len(texto) < 80:
        return None
    return {"nombre": "Página pública", "url": url, "texto": texto}


def buscar_en_internet(pregunta: str) -> dict | None:
    """Busca una pregunta genérica en Internet.

    Devuelve {"nombre", "url", "texto"} o None si ninguna fuente
    responde con algo útil. Nunca recibe ni envía datos de la
    plataforma: el llamador pasa solo la pregunta del usuario.
    Presupuesto global PRESUPUESTO_TOTAL_S (10 s): el peor caso no
    pasa de ~10 s aunque todas las fuentes sean lentas.
    """
    clave = (pregunta or "").strip().lower()
    if not clave:
        return None
    ahora = time.monotonic()
    hit = _cache.get(clave)
    if hit and ahora - hit[0] < CACHE_TTL_S:
        return hit[1]
    resultado: dict | None = None
    deadline = time.monotonic() + PRESUPUESTO_TOTAL_S
    try:
        # trust_env=False: el cliente NO lee HTTP(S)_PROXY del entorno.
        # En este VM el proxy de egress rompe el parseo de httpx
        # (InvalidURL al construir el cliente); en producción
        # (Render) no hay proxy y la salida es directa. Además, un
        # fallo de red nunca debe tumbar el chat: todo se captura.
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=True,
                          trust_env=False) as client:
            restante = _restante(deadline)
            ddg = _desde_ddg(client, pregunta.strip(),
                             timeout=min(TIMEOUT_S, restante)) if restante > 0 else None
            if ddg and ddg.get("texto"):
                resultado = ddg
            else:
                wiki = _desde_wikipedia(client, _titulo_desde_pregunta(pregunta), deadline)
                if wiki:
                    resultado = wiki
                elif ddg and ddg.get("url"):
                    restante = _restante(deadline)
                    if restante > 0:
                        directo = _fetch_directo(client, ddg["url"],
                                                 timeout=min(TIMEOUT_S, restante))
                        if directo:
                            resultado = directo
    except Exception:
        resultado = None
    _cache[clave] = (ahora, resultado)
    return resultado
