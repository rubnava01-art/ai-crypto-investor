"""Fase 8 mejoras-v1 — Monitoreo de errores y chequeo de salud (tarea 2).

/api/health ampliado: db alcanzable, cabeza Alembic y estado de
migraciones, sin secretos. Registro centralizado mínimo de errores
500: ruta, método y marca temporal en el log del servidor, sin datos
personales (nunca contraseñas, tokens ni cuerpos de login/registro).
"""
import logging

from fastapi.testclient import TestClient


def test_f8_health_ampliado(client):
    r = client.get("/api/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["database"] in ("ok", "error")
    assert body["git_sha"]
    # La cabeza es la migración de fusión mejoras-todas (une
    # a51b00000007 de mejoras-v1 y ef98abd287f8 de sync #72).
    assert body["alembic_head"] == "a51b00000008"
    # En la BD de tests (create_all, sin tabla alembic_version) el
    # estado es "desconocido", no inventado.
    assert body["migraciones"] == "desconocido"


def test_f8_error_500_queda_registrado_sin_datos_sensibles(app, caplog):
    def _romper():
        raise RuntimeError("fallo simulado fase8")

    app.add_api_route("/_test/fase8/error500", _romper, methods=["POST"])
    with TestClient(app, raise_server_exceptions=False) as c:
        with caplog.at_level(logging.ERROR, logger="ai-crypto-investor"):
            r = c.post(
                "/_test/fase8/error500",
                json={"username": "alguien", "password": "SecretoFase8123"},
            )
    assert r.status_code == 500, r.text
    assert "error_id" in r.json()
    # El cliente no recibe la traza.
    assert "fallo simulado" not in r.text
    registro = "\n".join(
        rec.getMessage() + "\n" + (rec.exc_text or "") for rec in caplog.records
    )
    assert "error 500" in registro
    assert "POST" in registro
    assert "/_test/fase8/error500" in registro
    # Marca temporal ISO en el registro.
    assert "T" in registro and ("+00:00" in registro or "Z" in registro)
    # Nada sensible en el log: ni la contraseña ni el cuerpo.
    assert "SecretoFase8123" not in registro
    assert "fallo simulado" in registro  # la traza sí queda en el log
