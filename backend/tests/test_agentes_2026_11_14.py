"""Tests de regresión — corrida 3 agentes 2026-11-14 (Agente 3, backend).

Fijan el veredicto de la auditoría: ningún endpoint de mercado es público.
Si en el futuro se abre uno (p. ej. /api/public/ticker), estos tests deberán
actualizarse conscientemente; no deben pasar en silencio con un 200 nuevo.

Solo usa el fixture compartido `client`; no crea nada en la BD ni consume
presupuesto de login (límite 10/min por IP en toda la suite).
"""


def test_market_ticker_requires_auth(client):
    r = client.get("/api/market/ticker?symbol=BTC/USD")
    assert r.status_code == 401, r.text


def test_market_prices_requires_auth(client):
    r = client.get("/api/market/prices")
    assert r.status_code == 401, r.text


def test_market_candles_requires_auth(client):
    r = client.get("/api/market/candles?symbol=BTC/USD&timeframe=1h")
    assert r.status_code == 401, r.text


def test_market_indicators_requires_auth(client):
    r = client.get("/api/market/indicators?symbol=BTC/USD&timeframe=1h")
    assert r.status_code == 401, r.text


def test_health_is_public(client):
    """Contraste: /api/health es el único endpoint público de datos
    (estado de la BD); no exige JWT y no devuelve datos de mercado."""
    r = client.get("/api/health")
    assert r.status_code == 200, r.text
    assert "database" in r.json()
