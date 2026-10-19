"""Phase 7: rate limiting, security headers, audit trail, alerts, metrics."""
from unittest.mock import patch

import pytest

from app.core.rate_limit import RateLimiter, login_limiter
from app.models.tables import AuditLog


@pytest.fixture(autouse=True)
def _reset_limiter():
    login_limiter._hits.clear()
    yield
    login_limiter._hits.clear()


def test_rate_limiter_blocks_after_window():
    rl = RateLimiter(max_requests=3, window_seconds=60)
    assert rl.allow("k") and rl.allow("k") and rl.allow("k")
    assert not rl.allow("k")


def test_login_rate_limited(client):
    # 10 allowed per minute per IP; hammer it
    statuses = set()
    for _ in range(14):
        r = client.post(
            "/api/auth/login", json={"username": "admin", "password": "wrong"}
        )
        statuses.add(r.status_code)
    assert 429 in statuses


def test_security_headers_present(client, auth_headers):
    r = client.get("/api/system/status", headers=auth_headers)
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" in r.headers


def test_kill_switch_writes_audit_and_alerts(client, auth_headers):
    from app.alerts import email as alert_email

    with patch.object(alert_email, "send_alert", return_value=True) as mock_send:
        r = client.post(
            "/api/risk/kill-switch",
            headers={**auth_headers, "Idempotency-Key": "audit-test-1"},
        )
    assert r.status_code == 200
    mock_send.assert_called_once()
    assert "KILL SWITCH" in mock_send.call_args[0][0]


def test_scanner_start_audited(client, auth_headers):
    r = client.post("/api/scanner/start", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["running"] is True
    r = client.post("/api/scanner/stop", headers=auth_headers)
    assert r.json()["running"] is False


def test_metrics_endpoint(client, auth_headers):
    r = client.get("/api/system/metrics", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["requests_total"] > 0
    assert "uptime_seconds" in body


def test_email_alert_no_config_returns_false():
    from app.alerts import email as alert_email

    with patch.object(alert_email.settings, "alert_smtp_host", ""), \
         patch.object(alert_email.settings, "alert_email_to", ""):
        assert alert_email.send_alert("t", "b") is False
