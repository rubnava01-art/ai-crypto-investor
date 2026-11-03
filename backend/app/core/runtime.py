"""Persisted runtime state (Fase 2, A3) + startup reconciliation (M15).

The free tier sleeps: in-memory RuntimeState used to evaporate on every
cold start — silently disengaging the kill switch, resetting the mode
and stopping the scanner. These rows are the durable copy; the
in-memory state is only a mirror.

Boot safety rules (applied in restore_runtime_state, never silently
overridden):
- A persisted kill switch STAYS engaged across restarts. The kill
  switch alert itself promises "no automatic resume".
- The scanner does NOT auto-resume while the kill switch is engaged,
  even if its persisted row says running: resuming automatic paper
  trading from a killed state would break that promise. The admin
  restarts it explicitly after releasing the kill switch. (The guard
  would reject new buys anyway, but intent matters more than the
  backstop.)
- A persisted "real" mode is honored only if the real-trading gates
  are on at boot (flag + keys); otherwise it falls back to
  "simulation" and the correction is persisted + logged. Real mode is
  never resurrected without its gates.
"""
import datetime as dt
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.core.state import state
from app.models.tables import Order, RuntimeSetting, SystemEvent

logger = logging.getLogger("ai-crypto-investor")

KEY_KILL_SWITCH = "kill_switch"
KEY_SCANNER = "scanner_running"
KEY_MODE = "simulation_mode"

# Pending = committed but not yet executed. In create_order the window
# between commit and execute is milliseconds inside one request, so a
# pending order older than this can only be a crashed request — never a
# live execution. Fresh pending orders are never touched.
STALE_PENDING_SECONDS = 3600


def _get(db: Session, key: str) -> str | None:
    row = db.get(RuntimeSetting, key)
    return row.value if row else None


def persist_runtime_setting(db: Session, key: str, value: str) -> None:
    """Upsert one runtime row (commits: callers use it after their own
    audit/commit, so no open transaction is disturbed)."""
    row = db.get(RuntimeSetting, key)
    if row is None:
        db.add(RuntimeSetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def sync_state_to_db(db: Session) -> None:
    """Write the whole in-memory mirror to the DB (used by tests and
    by any future bulk-sync path; endpoints persist individually)."""
    for key, value in (
        (KEY_KILL_SWITCH, "true" if state.kill_switch else "false"),
        (KEY_SCANNER, "true" if state.scanner_running else "false"),
        (KEY_MODE, state.simulation_mode),
    ):
        row = db.get(RuntimeSetting, key)
        if row is None:
            db.add(RuntimeSetting(key=key, value=value))
        else:
            row.value = value
    db.commit()


def restore_runtime_state(db: Session) -> dict:
    """Startup: seed missing rows with safe defaults, then apply the
    persisted rows to memory under the boot safety rules above.
    Returns a summary dict (logged by the caller)."""
    default_mode = settings.default_simulation_mode
    if default_mode not in ("simulation", "paper"):
        default_mode = "simulation"
    defaults = {
        KEY_KILL_SWITCH: "false",
        KEY_SCANNER: "false",
        KEY_MODE: default_mode,
    }
    for key, value in defaults.items():
        if db.get(RuntimeSetting, key) is None:
            db.add(RuntimeSetting(key=key, value=value))
    db.commit()

    kill = _get(db, KEY_KILL_SWITCH) == "true"
    mode = _get(db, KEY_MODE) or "simulation"
    if mode not in ("simulation", "paper", "real"):
        mode = "simulation"
    scanner_wanted = _get(db, KEY_SCANNER) == "true"

    notes: list[str] = []
    if mode == "real" and not (
        settings.real_trading_enabled
        and (settings.kraken_api_key or "").strip()
        and (settings.kraken_api_secret or "").strip()
    ):
        # Real mode without its gates at boot: fall back, persist the
        # correction, and say so — never silently run real-adjacent.
        mode = "simulation"
        persist_runtime_setting(db, KEY_MODE, mode)
        notes.append("real mode without gates -> simulation")
        db.add(
            SystemEvent(
                level="warning",
                category="system",
                message="Persisted mode 'real' without real-trading gates at boot; fell back to simulation.",
            )
        )
        db.commit()
    # Scanner resumes only from a clean state: never while killed.
    scanner = scanner_wanted and not kill
    if scanner_wanted and kill:
        notes.append("scanner held stopped: kill switch engaged")
        db.add(
            SystemEvent(
                level="warning",
                category="system",
                message="Scanner resume suppressed at boot: kill switch is engaged.",
            )
        )
        db.commit()

    state.kill_switch = kill
    state.simulation_mode = mode
    state.scanner_running = scanner
    summary = {
        "kill_switch": kill,
        "scanner_running": scanner,
        "scanner_wanted": scanner_wanted,
        "simulation_mode": mode,
        "notes": notes,
    }
    logger.info("restored runtime state: %s", summary)
    return summary


def reconcile_stale_pending_orders(db: Session) -> int:
    """Startup cleanup (M15): pending orders older than
    STALE_PENDING_SECONDS are crash leftovers — mark them failed so
    they stop blocking the duplicate guard (same symbol+side) forever.
    Fresh pending orders are never touched. Returns the count."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(
        seconds=STALE_PENDING_SECONDS
    )
    stale = (
        db.query(Order)
        .filter(Order.status == "pending", Order.created_at < cutoff)
        .all()
    )
    for order in stale:
        order.status = "failed"
    if stale:
        db.add(
            SystemEvent(
                level="warning",
                category="execution",
                message=(
                    f"Startup reconciliation: {len(stale)} stale pending "
                    f"order(s) older than {STALE_PENDING_SECONDS}s marked failed."
                ),
            )
        )
    db.commit()
    return len(stale)
