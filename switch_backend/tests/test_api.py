"""Integration + negative API tests (real SQLite, real simulator, no mocks)."""
import pytest
from app import fixtures as F
from tests.conftest import OWNER, MEMBER, VIEWER, OTHER

CAND = "cand-demo-faulty"
def ok(r, code=200):
    assert r.status_code == code, r.text
    return r.json()
def err(r, status, code):
    assert r.status_code == status, r.text
    assert r.json()["error"]["code"] == code, r.text
    assert "Traceback" not in r.text
    return r.json()["error"]

def test_full_demo_workflow(client):
    # 1-3 draft -> confirm -> retrieve (fallback interpreter; no AI configured)
    d = ok(client.post("/requirements/drafts", headers=MEMBER, json={
        "source_correction": "Don't turn off the hallway light while someone is there.",
        "routine_ids": ["goodnight"], "scenario_ids": ["sc-hallway-occupied"]}), 201)
    assert d["status"] == "DRAFT" and d["interpreter"] == "rule_based_fallback" and d["version"] == 1
    # a draft is never enforced
    run0 = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND, "requirement_ids": [d["requirement_id"]]}), 201)
    assert run0["suite"]["excluded"][0]["status"] == "DRAFT" and run0["suite"]["overall"] == "INCONCLUSIVE"
    c = ok(client.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 1}))
    assert c["status"] == "CONFIRMED" and c["confirmation"]["by"] == "olivia"
    assert ok(client.get(f"/requirements/{d['requirement_id']}", headers=VIEWER))["status"] == "CONFIRMED"
    # 4-7 candidate diff + replay FAIL with evidence
    diff = ok(client.get(f"/candidates/{CAND}/diff", headers=VIEWER))
    assert any(x["kind"] == "removed" and "actions[a1]" in x["path"] for x in diff["changes"])
    run1 = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert run1["suite"]["overall"] == "FAIL" and run1["environment"] == "SIMULATED DEMO"
    fails = [t for t in run1["suite"]["tests"] if t["status"] == "FAIL"]
    assert {t["requirement_id"] for t in fails} == {"req-hallway-occupied", d["requirement_id"]}
    t = fails[0]; ev = {e["event_id"]: e for e in t["trace"]}[t["evidence_event_ids"][0]]
    assert ev["device"] == "hallway_light" and ev["previous"] == "on" and ev["resulting"] == "off" and ev["routine_version"] == 2
    assert run1["baseline_comparison"]["overall"] == "PASS" and run1["baseline_comparison"]["regressed_vs_baseline"]
    # 8-10 suggested repair is isolated + unverified, then rerun
    fix = ok(client.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    assert fix["verified"] is False and fix["parent_candidate_id"] == CAND and fix["repair_source"] == "deterministic_fallback"
    assert ok(client.get(f"/candidates/{CAND}", headers=VIEWER))["routine"]["actions"][0]["conditions"] == []   # parent untouched
    assert ok(client.get("/routines", headers=VIEWER))[0]["version"] == 1                                       # baseline untouched
    err(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "VERIFICATION_REQUIRED")
    run2 = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    assert run2["suite"]["overall"] == "PASS" and run2["suite"]["totals"]["FAIL"] == 0
    cmp = run2["comparison_to_previous_run"]
    assert cmp["previous_run_id"] == run1["run_id"] and len(cmp["fixed"]) == 2 and cmp["newly_failing"] == []
    # 11-12 report; earlier evidence intact
    rep = ok(client.get(f"/replays/{run2['run_id']}/report", headers=VIEWER))
    assert rep["reproducibility"]["requirement_versions"]["req-hallway-occupied"] == 1 and rep["summary"][0].startswith("Run ")
    assert ok(client.get(f"/replays/{run1['run_id']}", headers=VIEWER))["suite"]["overall"] == "FAIL"
    assert len(ok(client.get("/replays", headers=VIEWER))) == 3
    # 13 authorization on approval
    err(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=MEMBER, json={"decision": "approve"}), 403, "FORBIDDEN")
    err(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=VIEWER, json={"decision": "approve"}), 403, "FORBIDDEN")
    a = ok(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve", "note": "ok"}))
    assert a["status"] == "APPROVED" and a["deployed"] is False and a["run_id"] == run2["run_id"]
    assert ok(client.get(f"/replays/{run2['run_id']}/report", headers=OWNER))["reviewer_decisions"][0]["decided_by"] == "olivia"
    err(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "INVALID_TRANSITION")

def test_reset_makes_demo_repeatable(client):
    ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    ok(client.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    err(client.post("/demo/reset", headers=MEMBER), 403, "FORBIDDEN")
    ok(client.post("/demo/reset", headers=OWNER))
    assert ok(client.get("/replays", headers=OWNER)) == [] and len(ok(client.get("/candidates", headers=OWNER))) == 1
    assert ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)["suite"]["overall"] == "FAIL"

def test_replay_results_identical_across_runs(client):
    a = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    b = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert a["run_id"] != b["run_id"]
    strip = lambda r: [{k: v for k, v in t.items()} for t in r["suite"]["tests"]]
    assert strip(a) == strip(b) and a["suite"]["input_fingerprint"] == b["suite"]["input_fingerprint"]

# ---------- repair negatives ----------
def test_bad_repair_fixes_one_breaks_another_and_cannot_be_approved(client):
    ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    ops = [{"op": "remove_action", "action_id": "a1"}, {"op": "remove_action", "action_id": "a2"}]
    fix = ok(client.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={"repair_ops": ops}), 201)
    assert fix["repair_source"] == "external_proposal"
    run = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    cmp = run["comparison_to_previous_run"]
    assert [x["requirement_id"] for x in cmp["fixed"]] == ["req-hallway-occupied"]
    assert [x["requirement_id"] for x in cmp["newly_failing"]] == ["req-living-light-off"]
    assert run["suite"]["overall"] == "FAIL" and run["baseline_comparison"]["regressed_vs_baseline"]
    err(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "SUITE_NOT_PASSING")
    r = ok(client.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "reject"}))
    assert r["status"] == "REJECTED"

@pytest.mark.parametrize("ops", [[{"op": "format_disk"}], [{"op": "add_action_condition", "action_id": "nope", "condition": F.OCC_FALSE}],
                                 [{"unknown_field": 1}], [{"op": "add_action", "action": {"action_id": "z", "device": "ghost", "attr": "power", "value": "on"}}]])
def test_invalid_repair_diff_rejected(client, ops):
    err(client.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={"repair_ops": ops}), 422, "REPAIR_INVALID")

def test_fix_requires_replay_first_and_ai_unavailable_fallback(client):
    err(client.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 409, "REPLAY_REQUIRED")
    # no AI configured + unrecognised phrasing -> explicit error, nothing fabricated
    err(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "Make my home cozier"}), 422, "INTERPRETATION_UNAVAILABLE")

def test_nothing_to_repair_on_passing_candidate(client):
    base = F.goodnight_baseline().model_copy(update={"version": 4})
    c = ok(client.post("/candidates", headers=MEMBER, json={"routine": base.model_dump(exclude_none=True)}), 201)
    assert ok(client.post("/replays", headers=MEMBER, json={"candidate_id": c["candidate_id"]}), 201)["suite"]["overall"] == "PASS"
    err(client.post(f"/candidates/{c['candidate_id']}/suggest-fix", headers=MEMBER, json={}), 409, "NOTHING_TO_REPAIR")

# ---------- candidate / routine negatives ----------
def test_invalid_candidates_rejected(client):
    base = F.goodnight_baseline().model_dump(exclude_none=True)
    err(client.post("/candidates", headers=MEMBER, json={"routine": {**base, "version": 2, "actions": [{"action_id": "a1", "device": "toaster", "attr": "power", "value": "on"}]}}), 422, "ROUTINE_INVALID")
    err(client.post("/candidates", headers=MEMBER, json={"routine": {"routine_id": "x"}}), 422, "ROUTINE_INVALID")
    err(client.post("/candidates", headers=MEMBER, json={"routine": {**base, "version": 1}}), 409, "VERSION_CONFLICT")        # not newer than baseline
    err(client.post("/candidates", headers=MEMBER, json={"routine": {**base, "version": 2}}), 409, "VERSION_CONFLICT")        # duplicate of seeded candidate v2
    err(client.post("/candidates", headers=MEMBER, json={"routine": {**base, "routine_id": "ghost", "version": 2}}), 404, "ROUTINE_NOT_FOUND")
    err(client.post("/candidates", headers=VIEWER, json={"routine": {**base, "version": 5}}), 403, "FORBIDDEN")
    err(client.post("/replays", headers=MEMBER, json={"candidate_id": "cand-missing"}), 404, "NOT_FOUND")
    v = ok(client.post("/routines/validate", headers=VIEWER, json={**base, "conditions": [{"op": "gt", "device": "hallway_occupancy", "attr": "occupied", "value": True}]}))
    assert v["valid"] is False and v["issues"][0]["code"] == "UNSUPPORTED_CONDITION"

def test_unknown_sensor_candidate_is_inconclusive_not_pass(client):
    # sensor-unknown scenario bound to a confirmed requirement -> suite must not PASS
    r = ok(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "Don't turn off the hallway light while someone is there.",
           "routine_ids": ["goodnight"], "scenario_ids": ["sc-hallway-unknown"]}), 201)
    ok(client.post(f"/requirements/{r['requirement_id']}/confirm", headers=OWNER, json={"version": 1}))
    base = F.goodnight_baseline().model_copy(update={"version": 3})
    c = ok(client.post("/candidates", headers=MEMBER, json={"routine": base.model_dump(exclude_none=True)}), 201)
    run = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": c["candidate_id"]}), 201)
    t = next(t for t in run["suite"]["tests"] if t["requirement_id"] == r["requirement_id"])
    assert t["status"] == "INCONCLUSIVE" and run["suite"]["overall"] == "INCONCLUSIVE"
    err(client.post(f"/candidates/{c['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "SUITE_NOT_PASSING")

# ---------- requirement lifecycle ----------
def test_malformed_and_ambiguous_requirements(client):
    err(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "x", "structured": {"title": "t"}}), 422, "REQUIREMENT_INVALID")
    bad = {"title": "t", "expected_behavior": {"kind": "must_not_set", "device": "ghost", "attr": "power", "value": "off"}}
    e = err(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "x", "structured": bad}), 422, "REQUIREMENT_INVALID")
    assert e["details"][0]["code"] == "UNKNOWN_DEVICE"
    amb = {"title": "Lights", "expected_behavior": {"kind": "must_not_set", "device": "hallway_light", "attr": "power", "value": "off"},
           "ambiguities": ["Which routines does this apply to?"], "confidence": 0.4}
    d = ok(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "Stop the lights going off", "structured": amb}), 201)
    err(client.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 1}), 409, "NEEDS_CLARIFICATION")
    assert ok(client.get(f"/requirements/{d['requirement_id']}", headers=OWNER))["status"] == "DRAFT"

def test_confirmation_authorization_and_version_conflicts(client):
    d = ok(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "Don't turn off the hallway light while someone is there."}), 201)
    rid = d["requirement_id"]
    err(client.post(f"/requirements/{rid}/confirm", headers=MEMBER, json={"version": 1}), 403, "FORBIDDEN")
    err(client.post(f"/requirements/{rid}/confirm", headers=VIEWER, json={"version": 1}), 403, "FORBIDDEN")
    err(client.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 7}), 409, "VERSION_CONFLICT")
    err(client.post(f"/requirements/{rid}/confirm", headers={}, json={"version": 1}), 401, "UNAUTHENTICATED")
    err(client.post(f"/requirements/{rid}/confirm", headers={"Authorization": "Bearer nope"}, json={"version": 1}), 401, "UNAUTHENTICATED")
    ok(client.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}))
    err(client.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}), 409, "INVALID_TRANSITION")

def test_edit_preserves_history_and_returns_to_draft(client):
    rid = "req-hallway-occupied"
    err(client.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 9, "content": {"title": "x"}}), 409, "VERSION_CONFLICT")
    e = ok(client.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 1, "content": {"title": "Hallway light stays on when occupied"}}))
    assert e["version"] == 2 and e["status"] == "DRAFT" and e["confirmation"] is None
    vs = ok(client.get(f"/requirements/{rid}/versions", headers=VIEWER))
    assert [v["version"] for v in vs["versions"]] == [1, 2] and vs["versions"][0]["content"]["title"].startswith("Do not turn off")
    run = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)            # edited draft is no longer enforced
    assert rid in {x["requirement_id"] for x in run["suite"]["excluded"]} and run["requirement_versions"][rid] == 2
    err(client.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 2, "content": {"expected_behavior": {"kind": "must_not_set", "device": "ghost", "attr": "power", "value": "off"}}}), 422, "REQUIREMENT_INVALID")
    ok(client.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 2}))

def test_disable_retire_not_enforced(client):
    rid = "req-front-door-locked"
    err(client.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 1, "status": "DISABLED"}), 403, "FORBIDDEN")
    err(client.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "CONFIRMED"}), 422, "INVALID_TRANSITION")
    ok(client.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "DISABLED"}))
    run = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert rid in {x["requirement_id"] for x in run["suite"]["excluded"]} and run["suite"]["totals"]["total"] == 2
    ok(client.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "RETIRED"}))
    err(client.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}), 409, "INVALID_TRANSITION")
    assert [r["requirement_id"] for r in ok(client.get("/requirements?status=RETIRED", headers=OWNER))] == [rid]

# ---------- household isolation ----------
def test_cross_household_isolation(client):
    for path in ("/requirements/req-hallway-occupied", f"/candidates/{CAND}", f"/candidates/{CAND}/diff"):
        err(client.get(path, headers=OTHER), 404, "NOT_FOUND")
    err(client.post("/replays", headers=OTHER, json={"candidate_id": CAND}), 404, "NOT_FOUND")
    err(client.post("/requirements/req-hallway-occupied/confirm", headers=OTHER, json={"version": 1}), 404, "NOT_FOUND")
    err(client.patch("/requirements/req-hallway-occupied", headers=OTHER, json={"expected_version": 1, "status": "RETIRED"}), 404, "NOT_FOUND")
    err(client.post(f"/candidates/{CAND}/approve", headers=OTHER, json={"decision": "reject"}), 404, "NOT_FOUND")
    assert ok(client.get("/requirements", headers=OTHER)) == [] and ok(client.get("/candidates", headers=OTHER)) == []
    run = ok(client.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    err(client.get(f"/replays/{run['run_id']}", headers=OTHER), 404, "NOT_FOUND")
    err(client.get(f"/replays/{run['run_id']}/report", headers=OTHER), 404, "NOT_FOUND")

def test_validation_error_format_and_health(client):
    e = err(client.post("/replays", headers=MEMBER, json={"nope": 1}), 422, "VALIDATION_ERROR")
    assert e["details"]
    h = ok(client.get("/health"))
    assert h["environment"] == "SIMULATED DEMO" and h["device_control"] == "none"
