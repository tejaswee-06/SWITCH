from fastapi.testclient import TestClient
from app.main import create_app

OWNER = {"Authorization": "Bearer demo-owner-token"}
OTHER = {"Authorization": "Bearer other-owner-token"}


def test_person3c_status_uses_authenticated_household_and_discloses_boundaries():
    c = TestClient(create_app())
    r = c.get("/person3c/status", headers=OWNER)
    assert r.status_code == 200
    body = r.json()
    assert body["household_id"] == "hh_demo"
    assert body["evaluator_authority"] == "Person 2 deterministic backend only"
    assert body["alexa"]["mode"] == "SIMULATED DEMO"
    assert body["alexa"]["live_status"]["status"] == "BLOCKED"


def test_person3c_interpretation_is_draft_and_household_scoped():
    c = TestClient(create_app())
    r = c.post("/person3c/interpret", headers=OWNER, json={
        "text": "Do not turn off the hallway light while someone is there", "context": {}
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["household_id"] == "hh_demo"
    assert body["status"] == "DRAFT"
    assert body["expected_behavior"]["relation"] == "must_not_set"
    assert body["expected_behavior"]["value"] == "off"

    r2 = c.post("/person3c/interpret", headers=OTHER, json={
        "text": "Do not turn off the hallway light while someone is there", "context": {}
    })
    assert r2.status_code == 200, r2.text
    assert r2.json()["household_id"] == "hh_other"


def test_person3c_requires_auth_and_never_exposes_live_alexa_claim():
    c = TestClient(create_app())
    assert c.get("/person3c/status").status_code == 401
    r = c.get("/person3c/alexa/status", headers=OWNER)
    assert r.status_code == 200
    assert r.json()["status"] == "SIMULATED"
    assert r.json()["live"]["status"] == "BLOCKED"


def test_person3c_repair_route_returns_unverified_review_proposal():
    c = TestClient(create_app())
    payload = {
        "failed_requirement_id": "req-hallway-occupied",
        "routine_id": "goodnight",
        "routine_version": 1,
        "baseline_routine": {"actions": [{"device_id": "hallway_light", "capability": "power", "value": "on"}], "conditions": []},
        "trace_event_ids": ["trace-event-9"],
        "operations": [{"op": "change_action_value", "index": 0, "value": "off"}],
    }
    r = c.post("/person3c/repair/propose", headers=OWNER, json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "NEEDS_HUMAN_REVIEW"
    assert body["verified"] is False
    assert body["deployed"] is False
