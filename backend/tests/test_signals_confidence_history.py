"""Señales: confianza e historial (Fase 5a, tarea 3).

La confianza es la expresada por el asistente (chat-potencia,
ai_explanations.confidence). El historial cuenta señales DISTINTAS
con el mismo símbolo y lado cuyo resultado ya se resolvió (outcome
win/loss del ciclo de aprendizaje). Sin datos: confianza null e
historial null — la UI dice "sin historial", nunca se inventa.
"""
import datetime as dt
from decimal import Decimal

from app.database import SessionLocal
from app.models.tables import AIExplanation, Signal, utcnow

_counter = [0]


def _make_signal(db, symbol, side, created_at):
    sig = Signal(
        symbol=symbol,
        side=side,
        entry_price=Decimal("100"),
        target_price=Decimal("102") if side == "buy" else Decimal("98"),
        invalidation_price=Decimal("99") if side == "buy" else Decimal("101"),
        reason="test",
        status="generated",
        created_at=created_at,
    )
    db.add(sig)
    db.flush()
    return sig


def _explain(db, signal_id, confidence, outcome):
    row = AIExplanation(
        signal_id=signal_id,
        user_id=None,
        question_excerpt="¿Por qué esta señal?",
        answer_excerpt="Explicación de prueba.",
        confidence=Decimal(str(confidence)) if confidence is not None else None,
        outcome=outcome,
    )
    db.add(row)
    db.commit()
    return row


def test_signal_without_explanations_has_no_confidence_or_history(client, admin_headers):
    _ = client
    db = SessionLocal()
    try:
        _counter[0] += 1
        symbol = f"NOH{_counter[0]}/USD"
        sig = _make_signal(db, symbol, "buy", utcnow())
        db.commit()
        sig_id = sig.id
    finally:
        db.close()
    r = client.get(f"/api/signals/{sig_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["confidence_pct"] is None
    assert body["history"] is None


def test_signal_confidence_comes_from_assistant_explanation(client, admin_headers):
    db = SessionLocal()
    try:
        _counter[0] += 1
        symbol = f"CON{_counter[0]}/USD"
        sig = _make_signal(db, symbol, "buy", utcnow())
        db.commit()
        _explain(db, sig.id, 75, None)
        # Una segunda explicación más reciente manda (confianza 60).
        _explain(db, sig.id, 60, None)
        sig_id = sig.id
    finally:
        db.close()
    r = client.get(f"/api/signals/{sig_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["confidence_pct"] == 60.0
    # Sin resultado resuelto, sigue sin historial.
    assert r.json()["history"] is None


def test_signal_history_counts_equal_previous_signals(client, admin_headers):
    db = SessionLocal()
    try:
        _counter[0] += 1
        symbol = f"HIS{_counter[0]}/USD"
        base = utcnow()
        # Tres señales anteriores iguales: 2 ganadas, 1 perdida.
        for i, outcome in enumerate(("win", "win", "loss")):
            s = _make_signal(db, symbol, "buy", base + dt.timedelta(seconds=i))
            db.commit()
            _explain(db, s.id, 70, outcome)
        # La señal actual, sin resultado todavía.
        current = _make_signal(db, symbol, "buy", base + dt.timedelta(seconds=10))
        db.commit()
        current_id = current.id
    finally:
        db.close()
    r = client.get(f"/api/signals/{current_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    history = r.json()["history"]
    assert history == {"wins": 2, "losses": 1, "total": 3, "win_rate_pct": 66.7}


def test_signal_history_excludes_own_outcome(client, admin_headers):
    db = SessionLocal()
    try:
        _counter[0] += 1
        symbol = f"OWN{_counter[0]}/USD"
        base = utcnow()
        s = _make_signal(db, symbol, "sell", base)
        db.commit()
        _explain(db, s.id, 80, "win")
        current = _make_signal(db, symbol, "sell", base + dt.timedelta(seconds=5))
        db.commit()
        _explain(db, current.id, 55, "win")
        current_id = current.id
    finally:
        db.close()
    r = client.get(f"/api/signals/{current_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    # Su propio win no se cuenta: solo la anterior.
    assert r.json()["history"] == {"wins": 1, "losses": 0, "total": 1, "win_rate_pct": 100.0}
    assert r.json()["confidence_pct"] == 55.0


def test_signal_history_ignores_other_symbols_and_sides(client, admin_headers):
    db = SessionLocal()
    try:
        _counter[0] += 1
        symbol = f"OTR{_counter[0]}/USD"
        base = utcnow()
        s = _make_signal(db, symbol, "buy", base)
        db.commit()
        _explain(db, s.id, 70, "win")
        # Mismo símbolo, lado contrario: no es "señal igual".
        other_side = _make_signal(db, symbol, "sell", base + dt.timedelta(seconds=1))
        db.commit()
        other_side_id = other_side.id
    finally:
        db.close()
    r = client.get(f"/api/signals/{other_side_id}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["history"] is None
