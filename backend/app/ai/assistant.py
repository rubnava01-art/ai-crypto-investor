"""Technical-focus AI assistant.

READ-ONLY BY CONSTRUCTION:
- The tool registry below contains ONLY read tools: get_signals,
  get_indicators, get_backtest_summary, get_risk_state.
- No order tool, no risk tool, no config tool, no execution tool exists in
  this package. There is no code path from a user question to an order,
  a risk change, or real-money state. Tests assert this invariant.
- This module imports nothing from the money-moving backend modules
  (execution engine, risk guard, exchange adapters, paper trader).
"""
import datetime as dt
import json
import os
import re

from sqlalchemy.orm import Session

from app.ai import guardrails
from app.ai.learning import extract_confidence, log_explanation
from app.ai.models import AIModel, AIModelError, get_model
from app.config import settings
from app.core.hardening import audit
from app.core.state import state
from app.indicators import technical as indicators
from app.models.tables import MarketCandle, RiskDecision, Signal, User, utcnow

READ_ONLY_TOOLS = (
    "get_signals",
    "get_indicators",
    "get_backtest_summary",
    "get_risk_state",
)

SYMBOLS = ("BTC/USD", "ETH/USD")

_SIGNAL_REF_RE = re.compile(r"#(\d+)")


# ---------------------------------------------------------------- tools ---

def _tool_get_signals(db: Session, limit: int = 10) -> list[dict]:
    rows = (
        db.query(Signal).order_by(Signal.created_at.desc()).limit(limit).all()
    )
    return [
        {
            "id": s.id,
            "symbol": s.symbol,
            "side": s.side,
            "entry": str(s.entry_price) if s.entry_price is not None else None,
            "target": str(s.target_price) if s.target_price is not None else None,
            "invalidation": (
                str(s.invalidation_price) if s.invalidation_price is not None else None
            ),
            "reason": s.reason,
            "status": s.status,
            "created_utc": s.created_at.isoformat(),
        }
        for s in rows
    ]


def _tool_get_indicators(db: Session, symbol: str) -> dict:
    candles = (
        db.query(MarketCandle)
        .filter(MarketCandle.symbol == symbol)
        .order_by(MarketCandle.open_time_utc.desc())
        .limit(60)
        .all()
    )
    if not candles:
        return {"symbol": symbol, "error": "no candle data"}
    closes = [float(c.close) for c in reversed(candles)]
    volumes = [float(c.volume) for c in reversed(candles)]
    snap = indicators.summarize(closes, volumes)
    snap["symbol"] = symbol
    snap["source"] = candles[0].source
    snap["as_of_utc"] = candles[0].open_time_utc.isoformat()
    return snap


def _tool_get_backtest_summary() -> dict:
    runs_dir = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "..", "data", "backtests"
    )
    runs_dir = os.path.normpath(runs_dir)
    try:
        files = sorted(
            (f for f in os.listdir(runs_dir) if f.endswith(".json")),
            reverse=True,
        )
    except OSError:
        files = []
    if not files:
        return {"runs": 0, "note": "no backtest runs yet"}
    try:
        with open(os.path.join(runs_dir, files[0]), encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return {"runs": len(files), "note": "latest run unreadable"}
    metrics = payload.get("metrics", {})
    return {
        "runs": len(files),
        "latest_run_id": payload.get("run_id"),
        "symbol": payload.get("symbol"),
        "n_candles": payload.get("n_candles"),
        "net_return_pct": metrics.get("net_return_pct"),
        "max_drawdown_pct": metrics.get("max_drawdown_pct"),
        "win_rate_pct": metrics.get("win_rate_pct"),
        "expectancy_usd": metrics.get("expectancy_usd"),
        "note": "Un buen backtest no prueba rentabilidad futura.",
    }


def _tool_get_risk_state(db: Session) -> dict:
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    decisions = (
        db.query(RiskDecision)
        .filter(RiskDecision.decided_at >= dt.datetime.now(dt.timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ))
        .count()
    )
    return {
        "kill_switch": state.kill_switch,
        "simulation_mode": state.simulation_mode,
        "real_trading_enabled": settings.real_trading_enabled,
        "max_risk_per_trade_pct": settings.max_risk_per_trade_pct,
        "max_daily_loss_usd": settings.max_daily_loss_usd,
        "max_trades_per_day": settings.max_trades_per_day,
        "risk_decisions_today": decisions,
        "as_of_utc": today,
    }


def tool_registry() -> dict:
    """The ONLY tools the assistant may call. Read-only, by construction."""
    return {
        "get_signals": _tool_get_signals,
        "get_indicators": _tool_get_indicators,
        "get_backtest_summary": _tool_get_backtest_summary,
        "get_risk_state": _tool_get_risk_state,
    }


# ------------------------------------------------------------- answering ---

def _fmt_indicator_line(symbol: str, snap: dict) -> str:
    if "error" in snap:
        return f"{symbol}: sin datos ({snap['error']})"
    rsi = snap.get("rsi_14")
    macd = snap.get("macd") or {}
    parts = [
        f"RSI(14) {rsi:.1f}" if rsi is not None else "RSI n/d",
        f"MACD hist {macd.get('histogram'):.2f}" if macd.get("histogram") is not None else "MACD n/d",
        f"SMA20 {snap['sma_20']:.2f}" if snap.get("sma_20") else "SMA20 n/d",
        f"SMA50 {snap['sma_50']:.2f}" if snap.get("sma_50") else "SMA50 n/d",
        f"último cierre {snap['last_close']:.2f}" if snap.get("last_close") else "",
        f"fuente {snap.get('source')}",
    ]
    return ", ".join(p for p in parts if p)


def _build_prompt(db: Session, question: str, signal_id: int | None) -> str:
    tools = tool_registry()
    lines = [f"PREGUNTA: {question.strip()[:1000]}", ""]
    for symbol in SYMBOLS:
        snap = tools["get_indicators"](db, symbol)
        lines.append(f"INDICADORES {symbol}: {_fmt_indicator_line(symbol, snap)}")
    lines.append("")
    signals = tools["get_signals"](db, limit=5)
    if signals:
        for s in signals:
            lines.append(
                f"SEÑAL: #{s['id']} {s['symbol']} {s['side']} "
                f"(entrada {s['entry']}, objetivo {s['target']}, "
                f"invalidación {s['invalidation']}) — {s['reason']} [{s['status']}]"
            )
    else:
        lines.append("SEÑAL: sin señales registradas")
    lines.append("")
    bt = tools["get_backtest_summary"]()
    if bt.get("runs"):
        lines.append(
            f"BACKTEST: {bt['runs']} corridas; última {bt.get('latest_run_id')} "
            f"({bt.get('symbol')}): retorno neto {bt.get('net_return_pct')}%, "
            f"drawdown máx {bt.get('max_drawdown_pct')}%, acierto {bt.get('win_rate_pct')}%. "
            f"{bt.get('note')}"
        )
    else:
        lines.append("BACKTEST: sin corridas registradas")
    risk = tools["get_risk_state"](db)
    lines.append(
        f"RIESGO: kill_switch={'ACTIVO' if risk['kill_switch'] else 'inactivo'}, "
        f"modo={risk['simulation_mode']}, decisiones hoy={risk['risk_decisions_today']}/"
        f"{risk['max_trades_per_day']}, riesgo máx por operación "
        f"{risk['max_risk_per_trade_pct']}%, pérdida diaria máx "
        f"${risk['max_daily_loss_usd']}, trading real "
        f"{'HABILITADO' if risk['real_trading_enabled'] else 'DESHABILITADO'}"
    )
    lines.append("")
    lines.append(
        "Responde en español, de forma técnica y concisa. Si expresas "
        "confianza, dala como porcentaje calibrado (p. ej. «confianza 65%») "
        "y reconoce la incertidumbre. Termina recordando que esto no es "
        "recomendación de inversión."
    )
    return "\n".join(lines)


def _extract_signal_id(question: str, explicit: int | None) -> int | None:
    if explicit is not None:
        return explicit
    m = _SIGNAL_REF_RE.search(question or "")
    return int(m.group(1)) if m else None


def ask(
    db: Session,
    user: User | None,
    question: str,
    signal_id: int | None = None,
    model: AIModel | None = None,
) -> dict:
    """Main entry point. Returns {answer, refused, demo, confidence,
    signal_id}. Never raises for model failures — degrades to a safe message."""
    sid = _extract_signal_id(question, signal_id)

    # 1. Input sanitization — manipulation attempts are refused + audited.
    is_injection, attempt_type = guardrails.classify_input(question or "")
    if is_injection:
        guardrails.audit_manipulation(
            db, user, attempt_type or "unknown", question or ""
        )
        return {
            "answer": guardrails.REFUSAL_ES,
            "refused": True,
            "demo": True,
            "confidence": None,
            "signal_id": sid,
        }

    # 2. Gather read-only context and call the model with the anchor
    #    re-asserted on this turn.
    mdl = model or get_model()
    prompt = _build_prompt(db, question, sid)
    try:
        answer = mdl.complete(guardrails.SYSTEM_ANCHOR, prompt)
    except AIModelError:
        audit(
            db, user, action="ai.model_error", entity="ai_assistant",
            details={"provider": mdl.name},
        )
        return {
            "answer": guardrails.SAFE_FALLBACK_ES,
            "refused": False,
            "demo": not mdl.configured,
            "confidence": None,
            "signal_id": sid,
        }

    # 3. Output validation — block false order/risk claims.
    valid, violation = guardrails.validate_output(answer)
    if not valid:
        guardrails.audit_output_violation(db, user, violation or "unknown")
        return {
            "answer": guardrails.SAFE_FALLBACK_ES,
            "refused": True,
            "demo": not mdl.configured,
            "confidence": None,
            "signal_id": sid,
        }

    # 4. Log the explanation for the learning loop.
    confidence = extract_confidence(answer)
    log_explanation(
        db,
        user.id if user else None,
        sid,
        question or "",
        answer,
        confidence,
    )
    return {
        "answer": answer,
        "refused": False,
        "demo": not mdl.configured,
        "confidence": float(confidence) if confidence is not None else None,
        "signal_id": sid,
    }
