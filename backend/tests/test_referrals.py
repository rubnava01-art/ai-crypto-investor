"""Referral campaigns tests (Plataforma Unificada — módulo Referidos):
admin manages campaigns/referrals; 'prueba' reads only (403 on writes);
referral status moves forward-only pending -> confirmed -> rewarded;
referrals only register on active campaigns; rewards are tracked, never paid.

Logins come from the shared session fixtures in conftest (admin_headers /
viewer_headers): the login endpoint is rate-limited, so modules must not
log in on their own."""


def _campaign(**kw):
    base = {
        "name": "Recomienda y Gana",
        "reward_type": "fixed",
        "reward_value": "25",
        "reward_note": "Descuento en la próxima visita.",
        "status": "active",
    }
    base.update(kw)
    return base


def _referral(**kw):
    base = {
        "referrer_name": "Ana Cliente",
        "referrer_contact": "ana@example.com",
        "referred_name": "Luis Nuevo",
        "referred_contact": "luis@example.com",
    }
    base.update(kw)
    return base


def test_referrals_admin_flow(client, admin_headers):
    h = admin_headers
    r = client.post("/api/referrals/campaigns", json=_campaign(), headers=h)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["name"] == "Recomienda y Gana"
    assert c["share_code"]  # auto-generated, e.g. RECO-7K2P
    assert c["reward_type"] == "fixed" and c["reward_value"] == "25.00"
    assert c["status"] == "active"
    assert c["referrals_count"] == 0
    cid = c["id"]

    # register a referral: code defaults to the campaign share code
    r = client.post(f"/api/referrals/campaigns/{cid}/referrals", json=_referral(), headers=h)
    assert r.status_code == 201, r.text
    ref = r.json()
    assert ref["status"] == "pending"
    assert ref["code"] == c["share_code"]
    rid = ref["id"]

    # explicit referrer-specific code is kept
    r = client.post(
        f"/api/referrals/campaigns/{cid}/referrals",
        json=_referral(referrer_name="Bea", referred_name="Carlos", code="bea-99"),
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["code"] == "BEA-99"

    # list per campaign + status filter
    r = client.get(f"/api/referrals/campaigns/{cid}/referrals", headers=h)
    assert r.status_code == 200
    assert len(r.json()) == 2
    r = client.get(f"/api/referrals/campaigns/{cid}/referrals", params={"status": "pending"}, headers=h)
    assert len(r.json()) == 2

    # forward-only transitions: pending -> confirmed -> rewarded
    r = client.patch(f"/api/referrals/referrals/{rid}", json={"status": "rewarded"}, headers=h)
    assert r.status_code == 422, r.text  # cannot skip confirmed
    r = client.patch(f"/api/referrals/referrals/{rid}", json={"status": "confirmed"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    r = client.patch(f"/api/referrals/referrals/{rid}", json={"status": "rewarded"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rewarded"
    r = client.patch(f"/api/referrals/referrals/{rid}", json={"status": "pending"}, headers=h)
    assert r.status_code == 422  # no going back

    # campaign counters reflect the flow
    r = client.get(f"/api/referrals/campaigns/{cid}", headers=h)
    assert r.json()["referrals_count"] == 2
    assert r.json()["confirmed_count"] == 1
    assert r.json()["rewarded_count"] == 1

    # pause the campaign: new referrals rejected, existing ones still readable
    r = client.put(f"/api/referrals/campaigns/{cid}", json={"status": "paused"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "paused"
    r = client.post(f"/api/referrals/campaigns/{cid}/referrals", json=_referral(), headers=h)
    assert r.status_code == 422, r.text

    # missing entities -> 404
    assert client.get("/api/referrals/campaigns/999999", headers=h).status_code == 404
    assert client.post("/api/referrals/campaigns/999999/referrals", json=_referral(), headers=h).status_code == 404
    assert client.patch("/api/referrals/referrals/999999", json={"status": "confirmed"}, headers=h).status_code == 404


def test_referrals_campaign_validation(client, admin_headers):
    h = admin_headers
    assert client.post("/api/referrals/campaigns", json=_campaign(reward_type="puntos"), headers=h).status_code == 422
    assert client.post("/api/referrals/campaigns", json=_campaign(status="loco"), headers=h).status_code == 422
    assert client.post("/api/referrals/campaigns", json=_campaign(reward_value="-5"), headers=h).status_code == 422
    assert client.post("/api/referrals/campaigns", json=_campaign(name=""), headers=h).status_code == 422
    # percentage above 100 is rejected
    assert client.post("/api/referrals/campaigns", json=_campaign(reward_type="percentage", reward_value="150"), headers=h).status_code == 422
    # unknown CRM contact as business -> 404
    assert client.post("/api/referrals/campaigns", json=_campaign(business_contact_id=999999), headers=h).status_code == 404
    # valid percentage campaign works
    r = client.post("/api/referrals/campaigns", json=_campaign(name="10% Amigos", reward_type="percentage", reward_value="10"), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["reward_value"] == "10.00"


def test_referrals_business_contact_link(client, admin_headers):
    h = admin_headers
    r = client.post(
        "/api/crm/contacts",
        json={"name": "Negocio Referidos", "source": "manual", "status": "cliente"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    contact_id = r.json()["id"]

    r = client.post("/api/referrals/campaigns", json=_campaign(name="Campaña Negocio", business_contact_id=contact_id), headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["business_contact_id"] == contact_id
    assert r.json()["business_name"] == "Negocio Referidos"


def test_referrals_requires_auth(client):
    assert client.get("/api/referrals/campaigns").status_code == 401
    assert client.post("/api/referrals/campaigns", json=_campaign()).status_code == 401


def test_referrals_viewer_read_only(client, admin_headers, viewer_headers):
    h_admin = admin_headers
    r = client.post("/api/referrals/campaigns", json=_campaign(name="Solo Lectura Ref"), headers=h_admin)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    r = client.post(f"/api/referrals/campaigns/{cid}/referrals", json=_referral(), headers=h_admin)
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    h = viewer_headers
    # can read
    r = client.get("/api/referrals/campaigns", headers=h)
    assert r.status_code == 200
    assert any(x["id"] == cid for x in r.json())
    r = client.get(f"/api/referrals/campaigns/{cid}/referrals", headers=h)
    assert r.status_code == 200
    assert any(x["id"] == rid for x in r.json())
    # cannot write
    assert client.post("/api/referrals/campaigns", json=_campaign(), headers=h).status_code == 403
    assert client.put(f"/api/referrals/campaigns/{cid}", json={"status": "paused"}, headers=h).status_code == 403
    assert client.post(f"/api/referrals/campaigns/{cid}/referrals", json=_referral(), headers=h).status_code == 403
    assert client.patch(f"/api/referrals/referrals/{rid}", json={"status": "confirmed"}, headers=h).status_code == 403
