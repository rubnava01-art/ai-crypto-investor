"""Corrida 2026-11-23, optimización del chat (chat-opt).

Cubre lo optimizado, sin Internet real (mocks de httpx.Client como
el benchmark scripts/benchmark-asistente.py):
- paralelización de las fuentes de Internet + presupuesto global 5 s
  (antes 10 s en serie) + caché.
- intención local antes que Internet ("¿qué es el bitcoin?" -> precio).
- vía rápida sin-respuesta (saludos/sinsentidos a la bandeja sin
  esperar a Internet).
- "¿cómo creo una cita?" es ayuda, no el listado de citas.
- sin regresión: prohibidos, reglas enseñadas y respuestas locales
  siguen igual.

Fixtures compartidas (client, admin_headers). Sin login propio.
"""
import time

import app.internet as internet_mod
from app.api.asistente import asistente_limiter
from app.database import get_db
from app.models.tables import PreguntaSinRespuesta

CHAT = "/api/asistente/chat"


def _chat(client, headers, mensaje: str):
    asistente_limiter.clear()
    return client.post(CHAT, json={"mensaje": mensaje}, headers=headers)


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def _fake_client(sleep_s, resultados):
    """httpx.Client falso: duerme sleep_s por llamada (respetando el
    timeout que le pasan) y devuelve las respuestas enlatadas."""
    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url, **k):
            timeout = k.get("timeout")
            espera = sleep_s if timeout is None else min(sleep_s, timeout)
            time.sleep(espera)
            for parte, payload in resultados.items():
                if parte in url:
                    return _Resp(200, payload)
            return _Resp(404, {})

    return FakeClient


def _mock_wiki():
    return {
        "api.duckduckgo.com": {
            "AbstractText": "",
            "AbstractURL": "https://es.wikipedia.org/wiki/Par%C3%ADs",
        },
        "es.wikipedia.org": {
            "type": "article",
            "extract": "París es la capital de Francia y su ciudad más poblada.",
            "content_urls": {"desktop": {"page": "https://es.wikipedia.org/wiki/Par%C3%ADs"}},
        },
        "en.wikipedia.org": {"type": "article", "extract": "", "content_urls": {}},
    }


# ------------------------------------------------- paralelización y presupuesto --

def test_internet_paralelo_wiki_mas_rapido_que_serie(client, admin_headers, monkeypatch):
    """DDG sin texto + Wiki ES: en serie serían 2 x 1.2 s = 2.4 s;
    en paralelo, ~1.2 s."""
    internet_mod.limpiar_cache()
    monkeypatch.setattr(internet_mod.httpx, "Client",
                        _fake_client(1.2, _mock_wiki()))
    t0 = time.perf_counter()
    r = _chat(client, admin_headers, "¿Cuál es la capital de Francia?")
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert r.json()["fuente"]["nombre"] == "Wikipedia (es)"
    assert "París" in r.json()["respuesta"]
    assert dt < 2.0, f"las fuentes no corren en paralelo: {dt:.2f} s"


def test_internet_presupuesto_global_5s_peor_caso(client, admin_headers, monkeypatch):
    """Todas las fuentes lentas (3 s) y sin resultado: el peor caso
    no pasa de ~5 s (antes, ~9-10 s con el presupuesto de 10 s)."""
    internet_mod.limpiar_cache()
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(3.0, {}))
    t0 = time.perf_counter()
    r = _chat(client, admin_headers, "¿Qué es el zqxwvutl de prueba?")
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert r.json()["sin_respuesta"] is True
    assert dt < 6.0, f"presupuesto global roto: {dt:.2f} s"
    assert internet_mod.PRESUPUESTO_TOTAL_S == 5.0
    assert internet_mod.TIMEOUT_FUENTE_S == 4.0


def test_internet_cache_evita_segundo_viaje(client, admin_headers, monkeypatch):
    """La segunda pregunta idéntica sale del caché (900 s): no vuelve
    a llamar a las fuentes, aunque ahora sean lentas."""
    internet_mod.limpiar_cache()
    monkeypatch.setattr(internet_mod.httpx, "Client",
                        _fake_client(1.2, _mock_wiki()))
    r = _chat(client, admin_headers, "¿Cuál es la capital de Francia?")
    assert r.status_code == 200, r.text
    # Las fuentes ahora tardan 5 s cada una: si no hubiera caché, la
    # segunda pregunta tardaría segundos; con caché es instantánea.
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(5.0, {}))
    t0 = time.perf_counter()
    r = _chat(client, admin_headers, "¿Cuál es la capital de Francia?")
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert "París" in r.json()["respuesta"]
    assert dt < 1.0, f"el caché no evitó el viaje: {dt:.2f} s"
    internet_mod.limpiar_cache()


def test_internet_ddg_con_texto_no_espera_wiki(client, admin_headers, monkeypatch):
    """DDG trae resumen: la respuesta sale sin esperar a las
    Wikipedias lentas (3 s)."""
    internet_mod.limpiar_cache()
    res = _mock_wiki()
    res["api.duckduckgo.com"] = {
        "AbstractText": "La fotosíntesis convierte luz en energía.",
        "AbstractURL": "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis",
    }
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(3.0, res))
    t0 = time.perf_counter()
    r = _chat(client, admin_headers, "¿Qué es la fotosíntesis?")
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    assert r.json()["fuente"]["nombre"] == "DuckDuckGo"
    assert dt < 4.0, f"DDG con texto esperó a Wiki: {dt:.2f} s"


# ------------------------------------------------- local antes que Internet --

def test_que_es_bitcoin_responde_precio_local_sin_internet(
    client, admin_headers, monkeypatch
):
    """«¿Qué es el bitcoin?» tiene respuesta local (precio real) y no
    va a Internet: con las fuentes mockeadas lentas y vacías, antes
    tardaba ~3.6 s y caía en sin_respuesta; ahora es precio local."""
    internet_mod.limpiar_cache()
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(3.0, {}))
    t0 = time.perf_counter()
    r = _chat(client, admin_headers, "¿Qué es el bitcoin?")
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "precio_btc", body
    assert body["sin_respuesta"] is False
    assert dt < 1.0, f"fue a Internet en vez de responder en local: {dt:.2f} s"


def test_que_es_ethereum_tambien_local(client, admin_headers, monkeypatch):
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(3.0, {}))
    r = _chat(client, admin_headers, "¿Qué es Ethereum?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "precio_btc", r.json()


# ------------------------------------------------- vía rápida sin-respuesta --

def test_saludo_y_sinsentido_caen_rapido_en_bandeja(
    client, admin_headers, monkeypatch, app
):
    """«Hola» y un sinsentido no viajan a Internet: con fuentes
    lentas (3 s) la respuesta es inmediata y queda en la bandeja."""
    internet_mod.limpiar_cache()
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(3.0, {}))
    for mensaje in ("Hola", "asdfqwer zxcv plokm"):
        t0 = time.perf_counter()
        r = _chat(client, admin_headers, mensaje)
        dt = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        assert r.json()["sin_respuesta"] is True, r.json()
        assert dt < 1.0, f"{mensaje!r} esperó a Internet: {dt:.2f} s"
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    try:
        filas = db.query(PreguntaSinRespuesta).filter(
            PreguntaSinRespuesta.pregunta.in_(("Hola", "asdfqwer zxcv plokm"))
        ).all()
        assert len(filas) == 2, [f.pregunta for f in filas]
        for f in filas:
            db.delete(f)
        db.commit()
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def test_tema_de_una_palabra_sigue_yendo_a_internet(
    client, admin_headers, monkeypatch
):
    """Contrapeso de la vía rápida: un tema suelto de una palabra
    («Fotosíntesis») SIGUE buscando en Internet."""
    internet_mod.limpiar_cache()
    res = _mock_wiki()
    res["api.duckduckgo.com"] = {
        "AbstractText": "La fotosíntesis convierte luz en energía.",
        "AbstractURL": "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis",
    }
    monkeypatch.setattr(internet_mod.httpx, "Client", _fake_client(0.1, res))
    r = _chat(client, admin_headers, "Fotosíntesis")
    assert r.status_code == 200, r.text
    assert r.json()["fuente"]["nombre"] == "DuckDuckGo", r.json()


# ------------------------------------------------- ayuda antes que listado --

def test_como_creo_una_cita_es_ayuda_no_listado(client, admin_headers):
    r = _chat(client, admin_headers, "¿Cómo creo una cita?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accion"]["tipo"] == "ayuda", body
    assert body["accion"]["datos"]["tema"] == "crear_cita", body
    assert "/business" in body["respuesta"]
    # El listado real sigue funcionando para la pregunta de listado.
    r = _chat(client, admin_headers, "¿Qué citas tengo?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "listar_citas", r.json()


def test_como_agendo_una_cita_es_ayuda(client, admin_headers):
    r = _chat(client, admin_headers, "¿Cómo agendo una cita?")
    assert r.status_code == 200, r.text
    assert r.json()["accion"]["tipo"] == "ayuda", r.json()
