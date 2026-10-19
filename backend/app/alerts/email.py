"""Email alerts (Phase 7). SMTP via stdlib; no third-party service needed.

Configured via ALERT_SMTP_* env vars. If unconfigured, alerts are logged
instead of sent (never crash the app because alerts are down).
"""
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("alerts")


def is_configured() -> bool:
    return bool(settings.alert_smtp_host and settings.alert_email_to)


def send_alert(subject: str, body: str) -> bool:
    """Return True if sent (or would-be-sent logged when unconfigured)."""
    full_subject = f"[AI Crypto Investor] {subject}"
    if not is_configured():
        log.warning("alert not configured, dropping: %s", full_subject)
        return False
    msg = EmailMessage()
    msg["Subject"] = full_subject
    msg["From"] = settings.alert_email_from
    msg["To"] = settings.alert_email_to
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.alert_smtp_host, settings.alert_smtp_port, timeout=15) as s:
            s.starttls()
            if settings.alert_smtp_user:
                s.login(settings.alert_smtp_user, settings.alert_smtp_password)
            s.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001 - alerts must never break trading logic
        log.error("alert send failed: %s", e)
        return False
