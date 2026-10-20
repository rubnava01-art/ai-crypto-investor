"""Aggregate dashboard endpoint tests."""


def _auth(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "secret"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_dashboard_aggregate_shape(client):
    r = client.get("/api/dashboard", headers=_auth(client))
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("system", "balances", "performance", "signals", "strategies",
                "modes", "operations", "risk", "logs"):
        assert key in body, f"missing {key}"
    assert isinstance(body["strategies"], list)
    assert isinstance(body["logs"], list)
    assert "equity_usd" in body["balances"]


def test_dashboard_requires_auth(client):
    assert client.get("/api/dashboard").status_code in (401, 403)


def test_dashboard_matches_individual_endpoints(client):
    h = _auth(client)
    agg = client.get("/api/dashboard", headers=h).json()
    indiv = client.get("/api/system/status", headers=h).json()
    assert agg["system"]["mode"] == indiv["mode"]
    assert agg["modes"]["current"] == client.get("/api/simulation/modes", headers=h).json()["current"]
