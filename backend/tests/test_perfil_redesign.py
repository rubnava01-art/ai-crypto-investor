"""Tests for the 2026-11-17 profile redesign: bio, ubicación, negocio
(handle + descripción) y habilidades (skills) en /api/profile/me.

The new fields are optional and empty at first — nothing is invented.
Skills are stored as a JSON list (max 8, each max 40 chars); the
business handle strips a leading @ and only allows letters, digits,
_ . - . Uses the shared admin_headers / viewer_headers fixtures.
"""


def test_profile_new_fields_empty_by_default(client, admin_headers):
    r = client.get("/api/profile/me", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bio"] is None
    assert body["location"] is None
    assert body["business_handle"] is None
    assert body["business_description"] is None
    assert body["skills"] is None


def test_profile_viewer_saves_new_fields_roundtrip(client, viewer_headers):
    r = client.put(
        "/api/profile/me",
        json={
            "bio": "Marketing y ventas con IA para negocios latinos.",
            "location": "Ontario, California",
            "business_handle": "@rivgoods",
            "business_description": "Tienda thrift: piezas únicas, precios justos.",
            "skills": ["Ventas", "Marketing", "  Diseño  ", "Ventas"],
        },
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bio"] == "Marketing y ventas con IA para negocios latinos."
    assert body["location"] == "Ontario, California"
    # Leading @ is stripped on save.
    assert body["business_handle"] == "rivgoods"
    assert body["business_description"] == "Tienda thrift: piezas únicas, precios justos."
    # Trimmed, empties dropped, duplicates removed, order kept.
    assert body["skills"] == ["Ventas", "Marketing", "Diseño"]

    r = client.get("/api/profile/me", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json()["skills"] == ["Ventas", "Marketing", "Diseño"]


def test_profile_new_fields_clear_with_empty(client, viewer_headers):
    client.put(
        "/api/profile/me",
        json={"bio": "algo", "location": "aquí", "skills": ["Una"]},
        headers=viewer_headers,
    )
    r = client.put(
        "/api/profile/me",
        json={
            "bio": "",
            "location": "",
            "business_handle": "",
            "business_description": "",
            "skills": [],
        },
        headers=viewer_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bio"] is None
    assert body["location"] is None
    assert body["business_handle"] is None
    assert body["business_description"] is None
    assert body["skills"] is None


def test_profile_new_fields_validation(client, viewer_headers):
    # Bio too long (281 chars).
    r = client.put("/api/profile/me", json={"bio": "x" * 281}, headers=viewer_headers)
    assert r.status_code == 422, r.text
    # Location too long.
    r = client.put(
        "/api/profile/me", json={"location": "x" * 121}, headers=viewer_headers
    )
    assert r.status_code == 422, r.text
    # Handle with a space / disallowed char.
    r = client.put(
        "/api/profile/me", json={"business_handle": "mi negocio!"}, headers=viewer_headers
    )
    assert r.status_code == 422, r.text
    # More than 8 skills.
    r = client.put(
        "/api/profile/me",
        json={"skills": [f"H{i}" for i in range(9)]},
        headers=viewer_headers,
    )
    assert r.status_code == 422, r.text
    # One skill too long (41 chars).
    r = client.put(
        "/api/profile/me", json={"skills": ["x" * 41]}, headers=viewer_headers
    )
    assert r.status_code == 422, r.text
    # Non-string skill.
    r = client.put("/api/profile/me", json={"skills": [42]}, headers=viewer_headers)
    assert r.status_code == 422, r.text
