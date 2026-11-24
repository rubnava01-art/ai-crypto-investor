"""Benchmark repetible del chat del Asistente (corrida 2026-11-23, optimización).

Uso (desde backend/):
    .venv/bin/python ../scripts/benchmark-asistente.py [--out RUTA_JSON]

Conjunto FIJO de preguntas (no cambiar entre ANTES y DESPUÉS):
  - locales: intenciones internas (precios, señales, análisis, nota,
    citas, facturas, contactos, clases, novedades, ayuda).
  - ayuda: los 9 temas del catálogo de ayuda.
  - internet: con mocks de las fuentes (la salida de red de este VM
    está bloqueada: el tiempo REAL de Internet NO se puede medir aquí).
    El mock duerme SLEEP_S por llamada de fuente para simular fuentes
    lentas y medir la lógica (secuencial vs paralela) y el presupuesto.
  - sin-respuesta: deben caer a la bandeja de enseñanza.
  - local-primero: "¿Qué es el bitcoin?" tiene respuesta local (precio)
    y NO debe ir a Internet.
  - prohibido: respuesta inmediata, sin Internet.

Modos por pregunta (campo "modo"):
  - "directo": sin mock; mide el camino real en este VM (red bloqueada:
    los intentos de Internet fallan rápido por DNS/conexión, NO es el
    tiempo real de Internet en producción).
  - "mock": fuentes mockeadas con SLEEP_S por llamada (por defecto 1.2 s).
  - "mock-lento": fuentes mockeadas con 3.0 s por llamada y sin
    resultados: mide el PEOR CASO (presupuesto global).

El limiter del chat (20/min por usuario) se vacía antes de cada
pregunta (asistente_limiter.clear(), método previsto para tests):
sin eso el benchmark se comería su propio presupuesto.

Limpieza: la pregunta de creación deja una nota y las preguntas sin
respuesta dejan filas en la bandeja; el script las borra al final
para que dos corridas sean comparables.

Salida: tabla Markdown por stdout + JSON con los tiempos (--out).
"""
import argparse
import json
import os
import sys
import tempfile
import time

DB_FD, DB_PATH = tempfile.mkstemp(suffix=".db")
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
sys.path.insert(0, os.path.abspath("."))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.database import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.tables import (  # noqa: E402
    Base, BusinessNote, PreguntaSinRespuesta, User,
)
import app.internet as internet_mod  # noqa: E402
from app.api.asistente import asistente_limiter  # noqa: E402

# ---------------------------------------------------------------- preguntas --

PREGUNTAS = [
    # (id, categoría, modo, pregunta)
    ("precio", "local", "directo", "¿Cuánto vale el bitcoin?"),
    ("senales", "local", "directo", "Muéstrame las últimas señales"),
    ("analisis", "local", "directo", "Analiza el mercado"),
    ("crear_nota", "local", "directo", "Crea una nota: revisar precios de proveedor"),
    ("listar_citas", "local", "directo", "¿Qué citas tengo?"),
    ("facturas", "local", "directo", "¿Cuánto hemos vendido?"),
    ("contactos", "local", "directo", "Muéstrame los contactos"),
    ("clases", "local", "directo", "¿Qué clases hay?"),
    ("novedades", "local", "directo", "¿Qué hay nuevo?"),
    ("ayuda", "local", "directo", "¿Qué puedes hacer?"),
    ("ayuda_factura", "ayuda", "directo", "¿Cómo creo una factura?"),
    ("ayuda_invitar", "ayuda", "directo", "¿Cómo invito a un cliente?"),
    ("ayuda_cita", "ayuda", "directo", "¿Cómo creo una cita?"),
    ("ayuda_nota", "ayuda", "directo", "¿Cómo creo una nota?"),
    ("ayuda_borrador", "ayuda", "directo", "¿Cómo creo un borrador?"),
    ("ayuda_senales", "ayuda", "directo", "¿Cómo veo las señales?"),
    ("ayuda_clave", "ayuda", "directo", "¿Cómo cambio mi clave?"),
    ("ayuda_novedad", "ayuda", "directo", "¿Cómo publico una novedad?"),
    ("ayuda_mis_facturas", "ayuda", "directo", "¿Cómo veo mis facturas?"),
    ("internet_ddg", "internet", "mock", "¿Qué es la fotosíntesis?"),
    ("internet_wiki", "internet", "mock", "¿Cuál es la capital de Francia?"),
    ("internet_lento", "internet", "mock-lento", "¿Qué es el zqxwvutl de prueba?"),
    ("sinresp_gibberish", "sin-respuesta", "directo", "asdfqwer zxcv plokm"),
    ("sinresp_hola", "sin-respuesta", "directo", "Hola"),
    ("local_primero_btc", "local-primero", "mock", "¿Qué es el bitcoin?"),
    ("prohibido", "prohibido", "directo", "Compra 0.01 BTC ahora"),
]

MOCK_SLEEP_S = 1.2
MOCK_LENTO_SLEEP_S = 3.0


class _Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def _fake_client_factory(sleep_s, resultados):
    """httpx.Client falso: duerme sleep_s por llamada y devuelve las
    respuestas enlatadas de `resultados` (dict url-parte -> payload)."""
    import httpx as _httpx  # noqa: F401  (solo para el tipo de error)

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url, **k):
            # Respeta el timeout como lo haría httpx (el presupuesto
            # global se mide con tiempos reales, no con sleeps fijos).
            timeout = k.get("timeout")
            espera = sleep_s if timeout is None else min(sleep_s, timeout)
            time.sleep(espera)
            for parte, payload in resultados.items():
                if parte in url:
                    return _Resp(200, payload)
            return _Resp(404, {})

    return FakeClient


def _mock_resultados():
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


def _mock_resultados_ddg_hit():
    # DDG sí trae resumen: el camino corto (sin Wikipedia ni fetch).
    d = _mock_resultados()
    d["api.duckduckgo.com"] = {
        "AbstractText": "La fotosíntesis es el proceso por el que las plantas convierten luz en energía.",
        "AbstractURL": "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis",
    }
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    if db.query(User).filter(User.username == "admin").count() == 0:
        db.add(User(username="admin", password_hash=hash_password("secret"), is_admin=True))
        db.commit()
    db.close()

    application = create_app()

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    application.dependency_overrides[get_db] = override_get_db
    client = TestClient(application)
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Limpieza previa (por si una corrida anterior quedó a medias).
    db = TestingSession()
    db.query(BusinessNote).filter(BusinessNote.title.like("revisar precios%")).delete()
    db.query(PreguntaSinRespuesta).filter(
        PreguntaSinRespuesta.pregunta.in_([p[3] for p in PREGUNTAS])).delete()
    db.commit()
    db.close()

    resultados = []
    _REAL_CLIENT = internet_mod.httpx.Client
    for pid, categoria, modo, pregunta in PREGUNTAS:
        asistente_limiter.clear()
        internet_mod.limpiar_cache()
        if modo == "mock":
            if pid == "internet_ddg":
                res = _mock_resultados_ddg_hit()
            elif pid == "internet_wiki":
                res = _mock_resultados()
            else:
                # local-primero: las fuentes no saben nada de bitcoin;
                # antes del arreglo el chat pierde ~3.6 s en Internet.
                res = {}
            internet_mod.httpx.Client = _fake_client_factory(MOCK_SLEEP_S, res)
        elif modo == "mock-lento":
            internet_mod.httpx.Client = _fake_client_factory(MOCK_LENTO_SLEEP_S, {})
        t0 = time.perf_counter()
        try:
            resp = client.post("/api/asistente/chat", json={"mensaje": pregunta}, headers=headers)
            status = resp.status_code
            body = resp.json() if status == 200 else {}
        except Exception as e:  # noqa: BLE001 - el benchmark no debe morir
            status, body = -1, {"error": str(e)}
        dt_ms = (time.perf_counter() - t0) * 1000
        internet_mod.httpx.Client = _REAL_CLIENT  # nunca contaminar la siguiente pregunta
        resultados.append({
            "id": pid, "categoria": categoria, "modo": modo,
            "pregunta": pregunta, "ms": round(dt_ms, 1), "status": status,
            "tipo": (body.get("accion") or {}).get("tipo"),
            "sin_respuesta": body.get("sin_respuesta"),
            "fuente": (body.get("fuente") or {}).get("nombre"),
        })
        print(f"{pid:22s} {categoria:14s} {modo:10s} {dt_ms:8.1f} ms  "
              f"status={status} tipo={resultados[-1]['tipo']} "
              f"sin_respuesta={body.get('sin_respuesta')} "
              f"fuente={resultados[-1]['fuente']}")

    # Limpieza posterior: la nota creada y las filas de bandeja.
    db = TestingSession()
    db.query(BusinessNote).filter(BusinessNote.title.like("revisar precios%")).delete()
    db.query(PreguntaSinRespuesta).filter(
        PreguntaSinRespuesta.pregunta.in_([p[3] for p in PREGUNTAS])).delete()
    db.commit()
    db.close()

    total = sum(x["ms"] for x in resultados)
    print(f"\nTOTAL {total:.1f} ms  PROMEDIO {total / len(resultados):.1f} ms  "
          f"N={len(resultados)}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"total_ms": round(total, 1), "n": len(resultados),
                       "resultados": resultados}, f, ensure_ascii=False, indent=2)
        print(f"JSON: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
