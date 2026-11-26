"""Quizzes cortos por clase (Fase 5a, tarea 5).

Preguntas creadas solo por el admin, con `source` obligatorio (de
dónde sale la respuesta). Sin preguntas, la clase no tiene quiz:
GET responde has_quiz=False y el envío es 422 — nunca se inventan
preguntas. GET no filtra las respuestas; la corrección llega solo al
enviar.
"""
from app.database import SessionLocal
from app.models.tables import EduClass


def _make_class(db, title):
    row = EduClass(kind="grabada", title=title, description="", url="")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def _question_payload(**over):
    payload = {
        "question": "¿Qué es Bitcoin según el material de la clase?",
        "options": ["Una moneda digital", "Un banco central", "Una acción", "Un bono"],
        "correct_index": 0,
        "explanation": "El material dice que es una moneda digital descentralizada.",
        "source": "Descripción de la clase",
    }
    payload.update(over)
    return payload


def test_quiz_empty_class_has_no_quiz(client, admin_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz vacío")
    finally:
        db.close()
    r = client.get(f"/api/clases/classes/{cid}/quiz", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"class_id": cid, "has_quiz": False, "questions": []}
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/submit",
        json={"answers": {}},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


def test_quiz_flow_create_answer_correct(client, admin_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz flujo")
    finally:
        db.close()
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/questions",
        json=_question_payload(),
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    qid = r.json()["id"]

    # GET no filtra la respuesta correcta ni la explicación.
    r = client.get(f"/api/clases/classes/{cid}/quiz", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_quiz"] is True
    assert len(body["questions"]) == 1
    assert "correct_index" not in body["questions"][0]
    assert "explanation" not in body["questions"][0]

    # Acierto: corrección inmediata con explicación.
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/submit",
        json={"answers": {str(qid): 0}},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["score"] == 1 and result["total"] == 1
    assert result["results"][0]["correct"] is True
    assert "moneda digital" in result["results"][0]["explanation"]

    # Fallo: la corrección dice cuál era la correcta.
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/submit",
        json={"answers": {str(qid): 2}},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["score"] == 0
    assert r.json()["results"][0]["correct"] is False
    assert r.json()["results"][0]["correct_index"] == 0


def test_quiz_create_validates_options_and_source(client, admin_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz validación")
    finally:
        db.close()
    base = f"/api/clases/classes/{cid}/quiz/questions"
    # Sin fuente: 422 (la pregunta debe nacer del material real).
    r = client.post(base, json=_question_payload(source=""), headers=admin_headers)
    assert r.status_code == 422, r.text
    # correct_index fuera de rango: 422.
    r = client.post(base, json=_question_payload(correct_index=4), headers=admin_headers)
    assert r.status_code == 422, r.text
    # Opciones repetidas o vacías: 422.
    r = client.post(
        base,
        json=_question_payload(options=["A", "A", "B"]),
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text
    # Una sola opción: 422.
    r = client.post(base, json=_question_payload(options=["Solo"]), headers=admin_headers)
    assert r.status_code == 422, r.text


def test_quiz_submit_rejects_unknown_question(client, admin_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz desconocida")
    finally:
        db.close()
    client.post(
        f"/api/clases/classes/{cid}/quiz/questions",
        json=_question_payload(),
        headers=admin_headers,
    )
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/submit",
        json={"answers": {"999999": 0}},
        headers=admin_headers,
    )
    assert r.status_code == 422, r.text


def test_quiz_create_requires_admin(client, viewer_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz permisos")
    finally:
        db.close()
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/questions",
        json=_question_payload(),
        headers=viewer_headers,
    )
    assert r.status_code == 403, r.text
    # El rol prueba sí puede hacer el quiz (lectura + envío), pero sin
    # preguntas sigue siendo 422, no 403.
    r = client.get(f"/api/clases/classes/{cid}/quiz", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json()["has_quiz"] is False


def test_quiz_delete_question(client, admin_headers):
    db = SessionLocal()
    try:
        cid = _make_class(db, "Quiz borrado")
    finally:
        db.close()
    r = client.post(
        f"/api/clases/classes/{cid}/quiz/questions",
        json=_question_payload(),
        headers=admin_headers,
    )
    qid = r.json()["id"]
    r = client.delete(
        f"/api/clases/classes/{cid}/quiz/questions/{qid}", headers=admin_headers
    )
    assert r.status_code == 204, r.text
    r = client.get(f"/api/clases/classes/{cid}/quiz", headers=admin_headers)
    assert r.json()["has_quiz"] is False
