"""Consulta en Internet SIN clave para el Asistente (corrida
2026-11-23, Agente 2; optimizado 2026-11-23, corrida chat-opt;
ampliado 2026-11-26, corrida asistente Agente 2).

Solo se envía la pregunta genérica del usuario (nunca datos de la
plataforma: ni contactos, facturas, citas, precios internos ni
nada del CRM). Fuentes, en orden de preferencia:

1. DuckDuckGo Instant Answer (sin clave).
2. Wikipedia REST summary en español, con fallback en inglés.
3. Noticias vía RSS público (Google News RSS, ES) cuando la
   pregunta es de actualidad, con fecha de publicación.
4. Resultados de búsqueda de DuckDuckGo (títulos/snippets/
   enlaces) cuando Instant Answer/Wikipedia no responden.
5. Fetch directo de una página pública (la URL del resumen de
   DuckDuckGo) como último recurso.
6. Precios en vivo vía CoinGecko API pública (sin llave), solo
   como fallback de _h_precio cuando no hay caché ni velas
   (precio_coingecko, no parte de buscar_en_internet).

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
(120 s para los "sin resultado", M9) y tope FIFO 500 entradas.
Sin dependencias nuevas: httpx ya está en requirements.txt.

Seguridad (M1, corrida 2026-11-26): DDG/Wikipedia/RSS/DDG-
resultados ya no siguen redirecciones a ciegas: cada salto se
revalida con validate_url/check_host_allowed (como _fetch_directo)
y el cuerpo se topa a 1 MB antes de parsear el JSON. El TOCTOU de
DNS rebinding (check_host_allowed resuelve, httpx vuelve a
resolver) sigue abierto: documentado como riesgo aceptado, porque
el usuario no puede pedir URLs arbitrarias — solo se fetchean
URLs de DDG/Google News o de hosts fijos en el código.
"""
import html
import json
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
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
# M9 (QA 2026-11-26): los "sin resultado" caducan antes (120 s en
# vez de 900 s): un fallo transitorio de la fuente no deja la
# pregunta en "No sé" 15 minutos.
CACHE_TTL_SIN_RESULTADO_S = 120
# Q10 (QA 2026-11-23): tope FIFO de entradas al caché (mismo patrón
# que el ticker de mercado). Sin tope, cada pregunta distinta era
# una entrada viva 900 s sin poda.
CACHE_MAX_ENTRADAS = 500
# Q2 (QA 2026-11-23): tope de cuerpo en el fetch directo, mismo
# orden que el auditor (1 MB).
MAX_CUERPO_DIRECTO_BYTES = 1 * 1024 * 1024
MAX_REDIRECTS_DIRECTO = 5
# M1 (QA 2026-11-26): mismo tope antes de parsear JSON en DDG/
# Wikipedia/RSS/resultados/CoinGecko; máx. de redirecciones
# seguidas a mano en esas fuentes.
MAX_JSON_BYTES = 1 * 1024 * 1024
MAX_REDIRECTS_JSON = 5
# C1 (2026-11-26): precios en vivo de respaldo (CoinGecko API
# pública, sin llave). Timeout propio: el precio es un fallback y
# no debe comerse el presupuesto del chat.
TIMEOUT_COINGECKO_S = 4.0
COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "USDT": "tether",
    "BNB": "binancecoin",
}

# El caché guarda (vencimiento_monotonic, resultado): los "sin
# resultado" (None) vencen a los 120 s (M9) y los aciertos a los
# 900 s. Sin ámbito por usuario/rol (M9 QA 2026-11-23): el
# contenido cacheado es público (DDG/Wikipedia/página pública),
# nunca datos de plataforma.
_cache: dict[str, tuple[float, dict | None]] = {}


def _cache_put(clave: str, resultado: dict | None) -> None:
    """Guarda en caché con tope FIFO: al superar el máximo se evicta
    la entrada más antigua (el dict conserva orden de inserción).
    Los "sin resultado" caducan a los 120 s (M9)."""
    ttl = CACHE_TTL_SIN_RESULTADO_S if resultado is None else CACHE_TTL_S
    _cache[clave] = (time.monotonic() + ttl, resultado)
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


# M3 (2026-11-26): reutilizar clientes HTTP por hilo en vez de 3
# clientes nuevos por pregunta. Un executor persistente (un solo
# pool de 3 hilos para todo el proceso) + un cliente por hilo en
# threading.local: cada hilo del pool reutiliza su cliente entre
# preguntas (keep-alive) y entre las fases de una misma pregunta.
# trust_env=False se conserva: el cliente se construye con
# _nuevo_cliente(). Si httpx.Client cambia bajo los pies (tests que
# lo monkeypatchean por un falso), NO se cachea: se crea un cliente
# fresco por tarea, como antes, para no servir un falso obsoleto.
_EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="internet-asistente")
_CLIENTES_HILO = threading.local()
_CLIENT_FACTORY_ORIGINAL = httpx.Client


def _cliente_hilo() -> httpx.Client:
    """Cliente HTTP del hilo actual (reutilizado entre preguntas)."""
    if httpx.Client is not _CLIENT_FACTORY_ORIGINAL:
        return _nuevo_cliente()
    client = getattr(_CLIENTES_HILO, "client", None)
    if client is None:
        client = _nuevo_cliente()
        _CLIENTES_HILO.client = client
    return client


def _get_json_topado(client: httpx.Client, url: str, timeout: float,
                     max_bytes: int = MAX_JSON_BYTES) -> dict | None:
    """GET JSON con defensas SSRF (M1): las redirecciones NO se
    siguen a ciegas — cada salto se revalida con validate_url +
    check_host_allowed (máx. 5) — y el cuerpo se topa a 1 MB antes
    de parsear el JSON. La URL inicial es una constante del código
    (host fijo: DDG/Wikipedia/Google News/CoinGecko), no entrada
    del usuario; los saltos sí vienen de terceros y se validan.
    Devuelve el JSON como dict, o None ante cualquier fallo. Los
    clientes falsos de los tests no tienen .content: en ese caso se
    usa r.json() directamente (mismo resultado visible)."""
    current = url
    for _salto in range(MAX_REDIRECTS_JSON + 1):
        try:
            r = client.get(current, timeout=timeout, follow_redirects=False)
        except httpx.HTTPError:
            return None
        except Exception:
            return None
        if r.status_code in (301, 302, 303, 307, 308):
            location = r.headers.get("location") if hasattr(r, "headers") else None
            if not location:
                return None
            nxt = urljoin(current, location)
            if urlparse(nxt).scheme not in ("http", "https"):
                return None
            try:
                nxt = validate_url(nxt)
                check_host_allowed(nxt)
            except Exception:
                return None
            current = nxt
            continue
        if r.status_code != 200:
            return None
        contenido = getattr(r, "content", None)
        if contenido is not None:
            if len(contenido) > max_bytes:
                return None
            try:
                data = json.loads(contenido.decode("utf-8", errors="replace"))
            except (ValueError, UnicodeDecodeError):
                return None
            return data if isinstance(data, dict) else None
        try:
            data = r.json()
        except ValueError:
            return None
        return data if isinstance(data, dict) else None
    return None


def _desde_ddg(client: httpx.Client, pregunta: str, timeout: float) -> dict | None:
    data = _get_json_topado(
        client,
        "https://api.duckduckgo.com/?q=" + quote_plus(pregunta)
        + "&format=json&no_html=1&skip_disambig=1",
        timeout,
    )
    if data is None:
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
    data = _get_json_topado(
        client,
        f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{titulo_q}",
        timeout,
    )
    if data is None:
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


# Marcas de pregunta de actualidad (C1, 2026-11-26): con alguna de
# estas, la pregunta va al RSS de noticias ANTES que a Wikipedia
# (un resumen enciclopédico no es actualidad). "novedades" a secas
# NO va: es la intención de novedades de la plataforma.
_MARCAS_NOTICIAS = (
    "noticia", "noticias", "actualidad", "ultima hora",
    "que paso hoy", "que ha pasado", "que esta pasando",
    "que paso con", "que ha pasado con", "ultimas noticias",
)


def _es_pregunta_noticias(pregunta: str) -> bool:
    bajo = (pregunta or "").lower()
    return any(m in bajo for m in _MARCAS_NOTICIAS)


def _fecha_pubdate(raw: str | None) -> str | None:
    """pubDate de RSS (RFC 2822) a ISO UTC, o None si no parsea."""
    if not raw:
        return None
    try:
        fecha = parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError):
        return None
    if fecha is None:
        return None
    import datetime as _dt

    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=_dt.timezone.utc)
    return fecha.astimezone(_dt.timezone.utc).isoformat()


def _desde_rss_noticias(client: httpx.Client, pregunta: str,
                        timeout: float) -> dict | None:
    """Noticias vía Google News RSS público (ES, sin llave).

    Devuelve los 3 primeros titulares con su fecha de publicación
    (publicado_en = ISO del más reciente). Sin fecha no hay noticia:
    si el RSS no trae items con título, devuelve None."""
    # Tema de búsqueda: la pregunta sin interrogativos ni signos.
    tema = (pregunta or "").strip().strip("¿?¡!").strip()
    for lider in ("que noticias hay de ", "que noticias hay sobre ",
                  "noticias de ", "noticias sobre ", "que paso con ",
                  "que ha pasado con "):
        if tema.lower().startswith(lider):
            tema = tema[len(lider):].strip()
            break
    if not tema:
        return None
    url = ("https://news.google.com/rss/search?q=" + quote_plus(tema)
           + "&hl=es-419&gl=US&ceid=US:es-419")
    try:
        r = client.get(url, timeout=timeout, follow_redirects=False)
    except httpx.HTTPError:
        return None
    except Exception:
        return None
    if r.status_code in (301, 302, 303, 307, 308):
        # El RSS no debería redirigir; si lo hace, se sigue UN salto
        # validado (misma defensa que _get_json_topado).
        location = r.headers.get("location") if hasattr(r, "headers") else None
        if not location:
            return None
        nxt = urljoin(url, location)
        if urlparse(nxt).scheme not in ("http", "https"):
            return None
        try:
            nxt = validate_url(nxt)
            check_host_allowed(nxt)
        except Exception:
            return None
        try:
            r = client.get(nxt, timeout=timeout, follow_redirects=False)
        except Exception:
            return None
    if r.status_code != 200:
        return None
    contenido = getattr(r, "content", None)
    if contenido is not None:
        if len(contenido) > MAX_JSON_BYTES:
            return None
        cuerpo = contenido.decode("utf-8", errors="replace")
    else:
        cuerpo = getattr(r, "text", "") or ""
    try:
        raiz = ET.fromstring(cuerpo)
    except ET.ParseError:
        return None
    items: list[dict] = []
    for item in raiz.iter("item"):
        titulo = (item.findtext("title") or "").strip()
        enlace = (item.findtext("link") or "").strip()
        fecha = _fecha_pubdate(item.findtext("pubDate"))
        if titulo:
            items.append({"titulo": titulo, "enlace": enlace,
                          "publicado_en": fecha})
        if len(items) >= 3:
            break
    if not items:
        return None
    lineas = ["Últimas noticias (Google News):"]
    for it in items:
        linea = f"- {it['titulo']}"
        if it["publicado_en"]:
            linea += f" ({it['publicado_en'][:10]})"
        lineas.append(linea)
    return {
        "nombre": "Google News (RSS)",
        "url": url,
        "texto": "\n".join(lineas),
        "publicado_en": items[0]["publicado_en"],
        "items": items,
    }


def _desde_ddg_resultados(client: httpx.Client, pregunta: str,
                          timeout: float) -> dict | None:
    """Búsqueda general vía resultados de DuckDuckGo (HTML, sin
    llave): títulos, snippets y enlaces de los 3 primeros
    resultados. Solo se usa cuando Instant Answer/Wikipedia no
    responden. El HTML se parsea con regex (sin dependencias
    nuevas); si el formato cambia, devuelve None y el chat cae al
    fetch directo o a "No sé"."""
    url = "https://html.duckduckgo.com/html/?q=" + quote_plus(pregunta)
    try:
        r = client.get(url, timeout=timeout, follow_redirects=False,
                       headers={"User-Agent": "GrowBusinessPlatform/1.0"})
    except httpx.HTTPError:
        return None
    except Exception:
        return None
    saltos = 0
    while r.status_code in (301, 302, 303, 307, 308):
        location = r.headers.get("location") if hasattr(r, "headers") else None
        if not location or saltos >= MAX_REDIRECTS_JSON:
            return None
        nxt = urljoin(url, location)
        if urlparse(nxt).scheme not in ("http", "https"):
            return None
        try:
            nxt = validate_url(nxt)
            check_host_allowed(nxt)
        except Exception:
            return None
        try:
            r = client.get(nxt, timeout=timeout, follow_redirects=False,
                           headers={"User-Agent": "GrowBusinessPlatform/1.0"})
        except Exception:
            return None
        saltos += 1
    if r.status_code != 200:
        return None
    contenido = getattr(r, "content", None)
    if contenido is not None:
        if len(contenido) > MAX_JSON_BYTES:
            return None
        cuerpo = contenido.decode("utf-8", errors="replace")
    else:
        cuerpo = getattr(r, "text", "") or ""
    titulos = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        cuerpo, flags=re.IGNORECASE | re.DOTALL)
    snippets = re.findall(
        r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
        cuerpo, flags=re.IGNORECASE | re.DOTALL)
    items: list[dict] = []
    for i, (enlace, titulo_html) in enumerate(titulos[:3]):
        titulo = re.sub(r"<[^>]+>", " ", titulo_html)
        titulo = html.unescape(re.sub(r"\s+", " ", titulo)).strip()
        snippet = ""
        if i < len(snippets):
            snippet = html.unescape(
                re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", snippets[i]))).strip()
        if not titulo:
            continue
        items.append({"titulo": titulo, "enlace": enlace.strip(),
                      "snippet": snippet})
    if not items:
        return None
    lineas = ["Resultados en DuckDuckGo:"]
    for j, it in enumerate(items, 1):
        linea = f"{j}. {it['titulo']}"
        if it["snippet"]:
            linea += f" — {it['snippet']}"
        if it["enlace"]:
            linea += f" [{it['enlace']}]"
        lineas.append(linea)
    return {
        "nombre": "DuckDuckGo (resultados)",
        "url": url,
        "texto": "\n".join(lineas),
        "items": items,
    }


def precio_coingecko(simbolos: list[str]) -> dict | None:
    """Precios en vivo vía CoinGecko API pública (sin llave), solo
    como fallback de _h_precio cuando no hay caché de mercado ni
    velas guardadas. Devuelve {simbolo: precio_usd} con los
    símbolos pedidos que respondieron, o None si no hay ninguno.
    Nunca levanta: cualquier fallo devuelve None."""
    ids = [COINGECKO_IDS[s] for s in simbolos if s in COINGECKO_IDS]
    if not ids:
        return None
    url = ("https://api.coingecko.com/api/v3/simple/price?ids="
           + ",".join(ids) + "&vs_currencies=usd")
    try:
        client = _nuevo_cliente()
        data = _get_json_topado(client, url, TIMEOUT_COINGECKO_S)
    except Exception:
        return None
    if not data:
        return None
    inverso = {v: k for k, v in COINGECKO_IDS.items()}
    out: dict[str, float] = {}
    for coin_id, valores in data.items():
        simbolo = inverso.get(coin_id)
        if simbolo is None or not isinstance(valores, dict):
            continue
        precio = valores.get("usd")
        if isinstance(precio, (int, float)) and precio > 0:
            out[simbolo] = float(precio)
    return out or None


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
    """Ejecuta fn(cliente, *args) con el cliente del hilo (M3:
    reutilizado entre preguntas; con el cliente falso de los tests
    se crea uno fresco por tarea)."""
    return fn(_cliente_hilo(), *args)


def buscar_en_internet(pregunta: str) -> dict | None:
    """Busca una pregunta genérica en Internet.

    Devuelve {"nombre", "url", "texto"} (+ "publicado_en" e "items"
    cuando la fuente los trae) o None si ninguna fuente responde
    con algo útil. Nunca recibe ni envía datos de la plataforma:
    el llamador pasa solo la pregunta del usuario.
    Presupuesto global PRESUPUESTO_TOTAL_S (5 s): el peor caso no
    pasa de ~5 s aunque todas las fuentes sean lentas. Las fuentes
    de la fase 1 (DDG, Wiki ES, Wiki EN) se lanzan en paralelo; la
    preferencia DDG > Wiki ES > Wiki EN se mantiene esperando a DDG
    primero (si trae texto, se devuelve sin esperar a las
    Wikipedias) y luego a ES antes que a EN. Si la pregunta es de
    actualidad, el RSS de noticias corre en paralelo y gana a
    Wikipedia. Si nada responde, se intentan los resultados de
    búsqueda de DuckDuckGo y, en último lugar, el fetch directo de
    la URL de DDG (como antes).
    """
    clave = (pregunta or "").strip().lower()
    if not clave:
        return None
    ahora = time.monotonic()
    hit = _cache.get(clave)
    if hit and ahora < hit[0]:
        return hit[1]
    resultado: dict | None = None
    ddg_url: str | None = None
    deadline = time.monotonic() + PRESUPUESTO_TOTAL_S
    titulo = _titulo_desde_pregunta(pregunta)
    es_noticias = _es_pregunta_noticias(pregunta)
    try:
        # Executor persistente (M3): los hilos —y sus clientes—
        # sobreviven entre preguntas. No se cierra por llamada.
        ddg_f = _EXECUTOR.submit(_tarea_con_cliente, _desde_ddg,
                                  pregunta.strip(), TIMEOUT_FUENTE_S)
        wiki_es_f = _EXECUTOR.submit(_tarea_con_cliente, _desde_wikipedia_idioma,
                                     titulo, "es", TIMEOUT_FUENTE_S)
        wiki_en_f = _EXECUTOR.submit(_tarea_con_cliente, _desde_wikipedia_idioma,
                                     titulo, "en", TIMEOUT_FUENTE_S)
        rss_f = None
        if es_noticias:
            rss_f = _EXECUTOR.submit(_tarea_con_cliente, _desde_rss_noticias,
                                     pregunta.strip(), TIMEOUT_FUENTE_S)
        # Actualidad: el RSS manda sobre Wikipedia (y sobre un
        # resumen enciclopédico de DDG); se espera a que responda.
        if es_noticias and rss_f is not None:
            try:
                rss = rss_f.result(timeout=_restante(deadline))
            except Exception:
                rss = None
            if rss:
                resultado = rss
        if resultado is None:
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
        # Búsqueda general (C1): resultados de DuckDuckGo cuando
        # Instant Answer/Wikipedia no responden, con lo que quede
        # del presupuesto.
        if resultado is None:
            restante = _restante(deadline)
            if restante > 0:
                try:
                    res_f = _EXECUTOR.submit(
                        _tarea_con_cliente, _desde_ddg_resultados,
                        pregunta.strip(), min(TIMEOUT_FUENTE_S, restante))
                    resultado = res_f.result(timeout=_restante(deadline))
                except Exception:
                    resultado = None
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
    except Exception:
        resultado = None
    _cache_put(clave, resultado)
    return resultado
