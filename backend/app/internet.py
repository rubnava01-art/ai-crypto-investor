"""Consulta en Internet SIN clave para el Asistente (corrida
2026-11-23, Agente 2; optimizado 2026-11-23, corrida chat-opt).

Solo se envía la pregunta genérica del usuario (nunca datos de la
plataforma: ni contactos, facturas, citas, precios internos ni
nada del CRM). Fuentes, en orden de preferencia:

1. DuckDuckGo Instant Answer (sin clave).
2. Wikipedia REST summary en español, con fallback en inglés.
3. Fetch directo de una página pública (la URL del resumen de
   DuckDuckGo) como último recurso.

Optimización 2026-11-23 (chat-opt): las tres fuentes de la fase 1
corren EN PARALELO (ThreadPoolExecutor, un httpx.Client propio por
hilo) en vez de en serie, y el presupuesto global baja de 10 s a
5 s (TIMEOUT_FUENTE_S=4 s por fuente). El peor caso medido con
mocks lentos (3 s/fuente, sin resultado) pasa de ~9 s a ~3 s; el
caso Wiki (DDG sin texto + Wikipedia ES) pasa de ~2.4 s a ~1.2 s
con fuentes de 1.2 s. La preferencia se mantiene: DDG con texto
gana siempre; si DDG no trae texto, gana Wikipedia ES, luego EN;
el fetch directo solo se intenta si DDG dio URL sin texto y
ninguna Wikipedia respondió. Caché en memoria con TTL 900 s
(también para los "sin resultado", para no reintentar lo mismo
sin parar). Sin dependencias nuevas: httpx ya está en requirements.txt.
"""
import html
import re
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, quote_plus, urljoin, urlparse

import httpx

from app.api.auditor import check_host_allowed, validate_url

# Presupuesto por fuente y global (chat-opt 2026-11-23): 4 s por
# fuente en paralelo + 1 s de margen para el fetch directo = 5 s
# de peor caso. Antes: 8 s por fuente en serie, 10 s global.
TIMEOUT_FUENTE_S = 4.0
PRESUPUESTO_TOTAL_S = 5.0
# Nombres viejos (compatibilidad con tests/imports existentes).
TIMEOUT_S = TIMEOUT_FUENTE_S
CACHE_TTL_S = 900
# Q10 (QA 2026-11-23): tope FIFO de entradas al caché (mismo patrón
# que el ticker de mercado). Sin tope, cada pregunta distinta era
# una entrada viva 900 s sin poda.
CACHE_MAX_ENTRADAS = 500
# Q2 (QA 2026-11-23): tope de cuerpo en el fetch directo, mismo
# orden que el auditor (1 MB).
MAX_CUERPO_DIRECTO_BYTES = 1 * 1024 * 1024
MAX_REDIRECTS_DIRECTO = 5

_cache: dict[str, tuple[float, dict | None]] = {}


def _cache_put(clave: str, resultado: dict | None) -> None:
    """Guarda en caché con tope FIFO: al superar el máximo se evicta
    la entrada más antigua (el dict conserva orden de inserción)."""
    _cache[clave] = (time.monotonic(), resultado)
    while len(_cache) > CACHE_MAX_ENTRADAS:
        _cache.pop(next(iter(_cache)))

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


def _nuevo_cliente() -> httpx.Client:
    # trust_env=False: el cliente NO lee HTTP(S)_PROXY del entorno.
    # En este VM el proxy de egress rompe el parseo de httpx
    # (InvalidURL al construir el cliente); en producción
    # (Render) no hay proxy y la salida es directa. Además, un
    # fallo de red nunca debe tumbar el chat: todo se captura.
    # Cada hilo crea SU propio cliente: httpx.Client no se comparte
    # entre hilos.
    return httpx.Client(timeout=TIMEOUT_FUENTE_S, follow_redirects=True,
                        trust_env=False)


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


def _desde_wikipedia_idioma(client: httpx.Client, titulo: str, lang: str,
                            timeout: float) -> dict | None:
    """Resumen de Wikipedia en un idioma (una sola llamada)."""
    titulo_q = quote(titulo, safe="")
    try:
        r = client.get(
            f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{titulo_q}",
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
    if data.get("type") == "disambiguation":
        return None
    extract = (data.get("extract") or "").strip()
    if not extract:
        return None
    url = (data.get("content_urls") or {}).get("desktop", {}).get("page") or ""
    return {"nombre": f"Wikipedia ({lang})", "url": url, "texto": extract}


def _desde_wikipedia(client: httpx.Client, titulo: str, deadline: float) -> dict | None:
    """Resumen de Wikipedia ES con fallback EN (serie; la versión
    paralela vive en buscar_en_internet). Se conserva para
    compatibilidad con tests que la llaman directamente."""
    for lang in ("es", "en"):
        restante = _restante(deadline)
        if restante <= 0:
            break
        resultado = _desde_wikipedia_idioma(
            client, titulo, lang, timeout=min(TIMEOUT_FUENTE_S, restante))
        if resultado:
            return resultado
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
    """Fetch directo de una página pública con defensas SSRF (Q2).

    Reutiliza validate_url/check_host_allowed del auditor: la URL
    inicial se valida antes del fetch y CADA redirección se
    revalida (follow_redirects desactivado por petición; se sigue
    manual, máx. 5 saltos, como el auditor). Cuerpo topado a 1 MB
    (stream con corte): una página enorme ya no se carga entera en
    memoria por pregunta. Cualquier bloqueo o fallo devuelve None
    (el llamador cae al "sin respuesta"); nunca levanta.
    """
    try:
        url = validate_url(url)
        check_host_allowed(url)
    except Exception:
        return None
    current = url
    redirects = 0
    try:
        while True:
            try:
                with client.stream(
                    "GET",
                    current,
                    headers={"User-Agent": "GrowBusinessPlatform/1.0"},
                    timeout=timeout,
                    follow_redirects=False,
                ) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        location = r.headers.get("location")
                        if not location:
                            return None
                        if redirects >= MAX_REDIRECTS_DIRECTO:
                            return None
                        nxt = urljoin(current, location)
                        if urlparse(nxt).scheme not in ("http", "https"):
                            return None
                        try:
                            nxt = validate_url(nxt)
                            check_host_allowed(nxt)
                        except Exception:
                            return None
                        redirects += 1
                        current = nxt
                        continue
                    if r.status_code != 200:
                        return None
                    chunks: list[bytes] = []
                    total = 0
                    for chunk in r.iter_bytes(65536):
                        total += len(chunk)
                        if total > MAX_CUERPO_DIRECTO_BYTES:
                            return None
                        chunks.append(chunk)
                    texto = _texto_visible(b"".join(chunks).decode("utf-8", errors="replace"))
            except Exception:
                return None
            if len(texto) < 80:
                return None
            return {"nombre": "Página pública", "url": current, "texto": texto}
    except Exception:
        return None


def _tarea_con_cliente(fn, *args):
    """Ejecuta fn(cliente, *args) con un cliente propio del hilo."""
    with _nuevo_cliente() as client:
        return fn(client, *args)


def buscar_en_internet(pregunta: str) -> dict | None:
    """Busca una pregunta genérica en Internet.

    Devuelve {"nombre", "url", "texto"} o None si ninguna fuente
    responde con algo útil. Nunca recibe ni envía datos de la
    plataforma: el llamador pasa solo la pregunta del usuario.
    Presupuesto global PRESUPUESTO_TOTAL_S (5 s): el peor caso no
    pasa de ~5 s aunque todas las fuentes sean lentas. Las tres
    fuentes de la fase 1 (DDG, Wiki ES, Wiki EN) se lanzan en
    paralelo; la preferencia DDG > Wiki ES > Wiki EN se mantiene
    esperando a DDG primero (si trae texto, se devuelve sin esperar
    a las Wikipedias) y luego a ES antes que a EN.
    """
    clave = (pregunta or "").strip().lower()
    if not clave:
        return None
    ahora = time.monotonic()
    hit = _cache.get(clave)
    if hit and ahora - hit[0] < CACHE_TTL_S:
        return hit[1]
    resultado: dict | None = None
    ddg_url: str | None = None
    deadline = time.monotonic() + PRESUPUESTO_TOTAL_S
    titulo = _titulo_desde_pregunta(pregunta)
    try:
        # Sin `with`: el __exit__ del executor esperaría (wait=True) a
        # las tareas en vuelo y anularía la salida rápida cuando DDG
        # ya respondió. Se cierra a mano sin esperar (las tareas que
        # sigan corriendo terminan solas en su hilo).
        ex = ThreadPoolExecutor(max_workers=3)
        try:
            ddg_f = ex.submit(_tarea_con_cliente, _desde_ddg,
                              pregunta.strip(), TIMEOUT_FUENTE_S)
            wiki_es_f = ex.submit(_tarea_con_cliente, _desde_wikipedia_idioma,
                                  titulo, "es", TIMEOUT_FUENTE_S)
            wiki_en_f = ex.submit(_tarea_con_cliente, _desde_wikipedia_idioma,
                                  titulo, "en", TIMEOUT_FUENTE_S)
            # DDG manda: si trae texto, no se espera a las Wikipedias.
            try:
                ddg = ddg_f.result(timeout=_restante(deadline))
            except Exception:
                ddg = None
            if ddg and ddg.get("texto"):
                resultado = ddg
            else:
                if ddg and ddg.get("url"):
                    ddg_url = ddg["url"]
                # Wikipedia ES antes que EN (mismo orden que antes).
                try:
                    wiki = wiki_es_f.result(timeout=_restante(deadline))
                except Exception:
                    wiki = None
                if wiki:
                    resultado = wiki
                else:
                    try:
                        wiki = wiki_en_f.result(timeout=_restante(deadline))
                    except Exception:
                        wiki = None
                    if wiki:
                        resultado = wiki
            # El fetch directo solo usa la URL de DDG y solo si nada
            # respondió con texto: último recurso, con lo que quede.
            if resultado is None and ddg_url:
                restante = _restante(deadline)
                if restante > 0:
                    try:
                        directo = _tarea_con_cliente(
                            _fetch_directo, ddg_url,
                            min(TIMEOUT_FUENTE_S, restante))
                        if directo:
                            resultado = directo
                    except Exception:
                        pass
        finally:
            # Las tareas que sigan en vuelo ya no se necesitan: se
            # cancelan las pendientes sin esperar a las que corren.
            for f in (ddg_f, wiki_es_f, wiki_en_f):
                f.cancel()
            ex.shutdown(wait=False, cancel_futures=True)
    except Exception:
        resultado = None
    _cache_put(clave, resultado)
    return resultado
