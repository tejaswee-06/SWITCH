"""Final-integration tests: canonical contract, Person 2 <-> Person 3C translation, journey profile,
Alexa+ Route C (simulated) adapter, new spec routes, persistence/migrations and ML artifact compatibility."""
import json
import re
import sqlite3
import warnings
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import p3c_bridge as PB
from app.catalog import CATALOG, CONTRACT_LOADED, ROOMS, load_contract
from app.main import create_app
from app.schemas import RepairOp, Routine
from app.store import MIGRATIONS, Store
from app import fixtures as F

ROOT = Path(__file__).resolve().parents[2]
OWNER, MEMBER, VIEWER, OTHER = ({"Authorization": f"Bearer {t}"} for t in
                                ("demo-owner-token", "demo-member-token", "demo-viewer-token", "other-owner-token"))
HALL = "Don't turn off the hallway light while someone is there."


def ok(r, code=200):
    assert r.status_code == code, (r.status_code, r.text[:800])
    return r.json()


def err(r, code, ecode):
    assert r.status_code == code, (r.status_code, r.text[:800])
    assert r.json()["error"]["code"] == ecode, r.json()
    return r.json()["error"]


@pytest.fixture()
def j():
    return TestClient(create_app(":memory:", profile="journey"))


def mcp(c, name, args, hdr=OWNER, i=1):
    r = ok(c.post("/integrations/alexa/mcp", headers=hdr, json={"jsonrpc": "2.0", "id": i, "method": "tools/call",
                                                                "params": {"name": name, "arguments": args}}))
    return r["result"]


# ------------------------------------------------------------------ canonical contract
def test_contract_loaded_and_original_person2_devices_unchanged():
    assert CONTRACT_LOADED and len(ROOMS) == 8
    legacy = {"hallway_light": {"power": ["on", "off"]}, "living_light": {"power": ["on", "off"]}, "bedroom_light": {"power": ["on", "off"]},
              "front_door": {"locked": [True, False]}, "hallway_occupancy": {"occupied": [True, False]}, "bedroom_occupancy": {"occupied": [True, False]}}
    for d, attrs in legacy.items():
        assert CATALOG[d]["attrs"] == attrs
    assert CATALOG["hallway_occupancy"]["read_only"] and CATALOG["bedroom_occupancy"]["read_only"]


def test_contract_matches_frontend_simulator_ids_and_rooms():
    c = load_contract()
    engine = (ROOT / "src" / "sim" / "engine.js").read_text()
    fe_devices = set(re.findall(r"^\s{2}(\w+):\s+\{ kind:", engine, re.M))
    fe_rooms = set(re.findall(r"^\s{2}(\w+):\s+\{ name:", engine, re.M))
    mapped = {d["fe_id"] for d in c["devices"] if d["fe_id"]}
    assert fe_devices and mapped == fe_devices, "every browser-simulator device maps 1:1 to a canonical id"
    assert {r["room_id"] for r in c["rooms"]} == fe_rooms
    rooms_js = (ROOT / "src" / "sim" / "rooms.js").read_text()
    order = re.search(r"ROOM_ORDER = \[([^\]]+)\]", rooms_js).group(1)
    assert [x.strip(" '") for x in order.split(",")] == [r["room_id"] for r in sorted(c["rooms"], key=lambda r: r["number"])]
    for r in c["rooms"]:
        assert f"{r['room_id']}_occupancy" in CATALOG and f"{r['room_id']}_light" in CATALOG


# ------------------------------------------------------------------ translation unit tests (P3C <-> P2)
def _p3c_draft(text, routines=None):
    from switch_p3c.contracts import InterpretRequest
    from switch_p3c.nlu.interpreter import interpret
    routines = routines or [F.journey_goodnight_v1()]
    return interpret(InterpretRequest(household_id="hh_demo", text=text), PB.interpretation_catalog("hh_demo", routines), None)


def test_translation_occupancy_must_not_set_maps_to_canonical_condition_and_scenarios():
    d = _p3c_draft(HALL)
    content, issues = PB.draft_to_content(d, {s.scenario_id: s for s in F.journey_scenarios()}, {"goodnight": "Goodnight"})
    assert issues == []
    assert content.expected_behavior.model_dump() == {"kind": "must_not_set", "device": "hallway_light", "attr": "power", "value": "off"}
    assert [c.model_dump(exclude_none=True) for c in content.preconditions] == [{"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": True}]
    assert content.scope.devices == ["hallway_light"] and content.scope.scenario_ids == ["sc-hallway-occupied"]   # edge case excluded
    assert content.interpreter == "p3c_deterministic_rules" and content.ambiguities == []


def test_translation_lock_security_and_time_window_values():
    sc = {s.scenario_id: s for s in F.journey_scenarios()}
    lock, _ = PB.draft_to_content(_p3c_draft("Never unlock the front door after 11pm"), sc, {})
    assert lock.expected_behavior.model_dump() == {"kind": "must_not_set", "device": "front_door", "attr": "locked", "value": False}
    assert lock.preconditions[0].model_dump(exclude_none=True) == {"op": "time_between", "start": "23:00", "end": "00:00"}
    sec, _ = PB.draft_to_content(_p3c_draft("Make sure the security system is armed after goodnight"), sc, {"goodnight": "Goodnight"})
    assert sec.expected_behavior.model_dump() == {"kind": "final_state_equals", "device": "security", "attr": "armed", "value": True}
    assert sec.scope.routine_ids == ["goodnight"]


def test_translation_never_silently_drops_unsupported_condition():
    d = _p3c_draft("keep the bedroom 2 light on at night")       # P3C emits mode==night; the household has no mode signal
    assert d.expected_behavior.device_id == "bedroom2_light"      # room alias + span-aware matching ("bedroom 2" != "bedroom")
    content, issues = PB.draft_to_content(d, {s.scenario_id: s for s in F.journey_scenarios()}, {})
    assert content is None and issues[0]["code"] == "UNSUPPORTED_CONDITION"


def test_repair_ops_translate_and_add_action_is_outside_p3c_allowlist():
    cand = F.journey_goodnight_candidate()
    ops = [RepairOp(op="add_action_condition", action_id="a3", condition=F.HALL_OCC_FALSE)]
    assert PB.p2_ops_to_p3c(ops, cand) == [{"op": "add_action_condition", "index": 2,
                                            "condition": {"signal": "hallway_occupancy.occupied", "op": "==", "value": False}}]
    v = PB.validate_repair("hh_demo", [F.journey_goodnight_v1()], cand, ops, "req-x", ["E0006"])
    assert v["status"] == "NEEDS_HUMAN_REVIEW" and v["verified"] is False and v["deployed"] is False
    bad = [RepairOp(op="add_action", action={"action_id": "z", "device": "tv", "attr": "power", "value": "on"})]
    with pytest.raises(Exception) as e:
        PB.p2_ops_to_p3c(bad, cand)
    assert "REPAIR_REJECTED_BY_VALIDATOR" in str(getattr(e.value, "code", e.value))


# ------------------------------------------------------------------ journey: correction -> regression -> approval
def test_journey_seed_profile_starts_before_the_hallway_requirement(j):
    h = ok(j.get("/health"))
    assert h["seed_profile"] == "journey" and h["environment"] == "SIMULATED DEMO" and h["alexa_plus"]["connection_status"] == "not_configured"
    reqs = ok(j.get("/requirements", headers=VIEWER))
    assert {r["requirement_id"]: r["status"] for r in reqs} == {"req-living-light-off": "CONFIRMED", "req-security-armed": "CONFIRMED", "req-bathroom-light-on": "DISABLED"}
    scen = {s["scenario_id"]: s["edge_case"] for s in ok(j.get("/scenarios", headers=VIEWER))}
    assert scen == {"sc-hallway-occupied": False, "sc-house-empty": False, "sc-hallway-sensor-offline": True}


def test_interpret_is_read_only_and_ambiguity_returns_questions_with_options(j):
    p = ok(j.post("/requirements/interpret", headers=VIEWER, json={"text": "Don't turn off the light while someone is there"}))
    assert p["structured"] is None and p["needs_clarification"] and not p["can_create_draft"]
    q = p["questions"][0]
    assert q["field"] == "device" and q["answer_key"] == "device_id" and {"value": "hallway_light", "label": "Hallway lights"} in q["options"]
    p2 = ok(j.post("/requirements/interpret", headers=VIEWER, json={"text": "Don't turn off the light while someone is there", "answers": {"device_id": "hallway_light"}}))
    assert p2["can_create_draft"] and p2["structured"]["expected_behavior"]["device"] == "hallway_light"
    assert len(ok(j.get("/requirements", headers=VIEWER))) == 3, "interpretation never stores anything"
    e = err(j.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "Don't turn off the light while someone is there", "interpreter": "p3c"}), 422, "NEEDS_CLARIFICATION")
    assert e["details"][0]["answer_key"] == "device_id"
    err(j.post("/requirements/interpret", headers=VIEWER, json={"text": "Don't let the fan turn off"}), 422, "UNSUPPORTED_DEVICE")
    err(j.post("/requirements/interpret", headers=VIEWER, json={"text": "Text me when the hallway light turns off"}), 422, "UNSUPPORTED_ACTION")


def _journey_to_fail(c):
    d = ok(c.post("/requirements/drafts", headers=MEMBER, json={"source_correction": HALL, "interpreter": "p3c"}), 201)
    assert d["status"] == "DRAFT" and d["confirmation"] is None and d["interpreter"].startswith("p3c_")
    err(c.post(f"/requirements/{d['requirement_id']}/confirm", headers=MEMBER, json={"version": 1}), 403, "FORBIDDEN")
    r = ok(c.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 1}))
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": "cand-demo-faulty", "via": "web_ui"}), 201)
    return r, run


def test_full_journey_fail_repair_rerun_approve_with_provenance(j):
    req, run = _journey_to_fail(j)
    rid = req["requirement_id"]
    assert run["suite"]["overall"] == "FAIL" and run["suite"]["totals"]["FAIL"] == 1 and run["suite"]["totals"]["PASS"] == 4
    fail = next(t for t in run["suite"]["tests"] if t["status"] == "FAIL")
    assert fail["requirement_id"] == rid and fail["evidence_event_ids"]
    ev = next(e for e in fail["trace"] if e["event_id"] == fail["evidence_event_ids"][0])
    assert (ev["type"], ev["device"], ev["attr"], ev["previous"], ev["resulting"], ev["state_before"]["hallway_occupancy"]["occupied"]) == \
           ("action", "hallway_light", "power", "on", "off", True)
    assert fail["initial_state"]["hallway_light"]["power"] == "on"
    assert ok(j.get(f"/requirements/{rid}", headers=VIEWER))["last_result"]["status"] == "FAIL"
    # repair: preview (nothing created) then the real unverified candidate
    prev = ok(j.post("/person3c/repair/propose", headers=MEMBER, json={"candidate_id": "cand-demo-faulty"}))
    assert prev["verified"] is False and prev["p3c_validation"]["status"] == "NEEDS_HUMAN_REVIEW"
    n_cand = len(ok(j.get("/candidates", headers=VIEWER)))
    fix = ok(j.post("/candidates/cand-demo-faulty/suggest-fix", headers=MEMBER, json={}), 201)
    assert len(ok(j.get("/candidates", headers=VIEWER))) == n_cand + 1
    pv = fix["repair_provenance"]
    assert fix["verified"] is False and pv["ai_model_used"] is False and pv["proposer"] == "rule_based_restore_guard"
    assert pv["validator"]["status"] == "passed" and pv["evidence"]["evidence_event_ids"] == fail["evidence_event_ids"]
    assert fail["evidence_event_ids"][0] in pv["explanation"] and "NOT verified" in pv["explanation"]
    assert fix["repair_ops"] == [{"op": "add_action_condition", "action_id": "a3", "condition": F.HALL_OCC_FALSE}]
    # not verified until rerun -> approval refused
    err(j.post(f"/candidates/{fix['candidate_id']}/review", headers=OWNER, json={"decision": "approve"}), 409, "VERIFICATION_REQUIRED")
    run2 = ok(j.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    assert run2["suite"]["overall"] == "PASS" and run2["suite"]["totals"] == {**run2["suite"]["totals"], "PASS": 5, "FAIL": 0, "INCONCLUSIVE": 0}
    assert run2["comparison_to_previous_run"]["fixed"][0]["requirement_id"] == rid and not run2["comparison_to_previous_run"]["newly_failing"]
    err(j.post(f"/candidates/{fix['candidate_id']}/review", headers=MEMBER, json={"decision": "approve"}), 403, "FORBIDDEN")
    a = ok(j.post(f"/candidates/{fix['candidate_id']}/review", headers=OWNER, json={"decision": "approve", "note": "guard restored"}))
    assert a["status"] == "APPROVED" and a["deployed"] is False
    rep = ok(j.get(f"/replays/{run2['run_id']}/report", headers=VIEWER))
    assert rep["reviewer_decisions"][0]["decision"] == "approve" and rep["repair_provenance"]["validator"]["status"] == "passed"
    assert rep["integration"]["integration_mode"] == "simulated_demo" and rep["integration"]["invoked_via"] == "api"


def test_exploratory_edge_case_is_inconclusive_and_does_not_count_for_approval(j):
    _, run = _journey_to_fail(j)
    fix = ok(j.post("/candidates/cand-demo-faulty/suggest-fix", headers=MEMBER, json={}), 201)
    ex = ok(j.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"], "extra_scenario_ids": ["sc-hallway-sensor-offline"]}), 201)
    assert ex["kind"] == "exploratory" and ex["suite"]["overall"] == "INCONCLUSIVE"
    unk = [t for t in ex["suite"]["tests"] if t["scenario_id"] == "sc-hallway-sensor-offline" and t["status"] != "PASS"]
    assert unk and all(t["status"] == "INCONCLUSIVE" for t in unk), "unknown sensor state never becomes PASS"
    err(j.post(f"/candidates/{fix['candidate_id']}/review", headers=OWNER, json={"decision": "approve"}), 409, "VERIFICATION_REQUIRED")
    err(j.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"], "extra_scenario_ids": ["sc-nope"]}), 404, "NOT_FOUND")


def test_journey_replay_is_deterministic(j):
    _journey_to_fail(j)
    a = ok(j.post("/replays", headers=MEMBER, json={"candidate_id": "cand-demo-faulty"}), 201)
    b = ok(j.post("/replays", headers=MEMBER, json={"candidate_id": "cand-demo-faulty"}), 201)
    key = lambda r: [(t["requirement_id"], t["scenario_id"], t["status"], t["sim_result_hash"], tuple(t["evidence_event_ids"])) for t in r["suite"]["tests"]]
    assert key(a) == key(b) and a["suite"]["input_fingerprint"] == b["suite"]["input_fingerprint"]
    assert ok(j.get(f"/replays/{b['run_id']}/verify", headers=VIEWER))["reproduced"] is True


def test_reset_restores_journey_and_is_repeatable(j):
    _journey_to_fail(j)
    ok(j.post("/demo/reset", headers=OWNER, json={}))
    assert len(ok(j.get("/requirements", headers=VIEWER))) == 3
    _, run = _journey_to_fail(j)
    assert run["suite"]["overall"] == "FAIL"
    ok(j.post("/demo/reset", headers=OWNER, json={"profile": "regression"}))
    assert ok(j.get("/health"))["seed_profile"] == "regression"
    assert "req-hallway-occupied" in {r["requirement_id"] for r in ok(j.get("/requirements", headers=VIEWER))}


def test_household_scoping_on_new_routes(j):
    d = ok(j.post("/requirements/drafts", headers=MEMBER, json={"source_correction": HALL, "interpreter": "p3c"}), 201)
    err(j.get(f"/requirements/{d['requirement_id']}", headers=OTHER), 404, "NOT_FOUND")
    res = mcp(j, "switch_get_requirement", {"requirement_id": d["requirement_id"]}, hdr=OTHER)
    assert res["isError"] and res["structuredContent"]["error"]["code"] == "NOT_FOUND"
    err(j.get("/routines/goodnight/diff?from=1&to=2", headers=OTHER), 404, "NOT_FOUND")
    assert j.post("/requirements/interpret", json={"text": HALL}).status_code == 401


def test_stored_draft_with_residual_ambiguity_cannot_be_confirmed(j):
    p = ok(j.post("/requirements/interpret", headers=MEMBER, json={"text": HALL}))
    s = p["structured"]; s["ambiguities"] = ["Which scenario should cover guests?"]
    d = ok(j.post("/requirements/drafts", headers=MEMBER, json={"source_correction": HALL, "structured": s}), 201)
    err(j.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 1}), 409, "NEEDS_CLARIFICATION")
    e = ok(j.patch(f"/requirements/{d['requirement_id']}", headers=MEMBER, json={"expected_version": 1, "content": {"ambiguities": []}, "note": "clarified"}))
    assert e["version"] == 2 and e["status"] == "DRAFT"
    assert ok(j.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 2}))["status"] == "CONFIRMED"
    hist = ok(j.get(f"/requirements/{d['requirement_id']}/versions", headers=VIEWER))
    assert [v["version"] for v in hist["versions"]] == [1, 2]


def test_spec_route_aliases_and_routine_diff(j):
    d = ok(j.get("/routines/goodnight/diff?from=1&to=2", headers=VIEWER))
    assert d["from"]["kind"] == "baseline" and d["to"]["kind"] == "candidate"
    assert any(c["kind"] == "removed" and c["path"] == "actions[a3].conditions" for c in d["changes"])
    err(j.get("/routines/goodnight/diff?from=1&to=9", headers=VIEWER), 404, "NOT_FOUND")
    base = F.journey_goodnight_v1().model_dump(exclude_none=True); base["version"] = 7
    c = ok(j.post("/routines/candidates", headers=MEMBER, json={"routine": base}), 201)
    assert c["status"] == "PENDING_REVIEW"
    assert ok(j.post(f"/candidates/{c['candidate_id']}/review", headers=OWNER, json={"decision": "reject"}))["status"] == "REJECTED"
    bad = dict(base, version=8, actions=[{"action_id": "x", "device": "toaster", "attr": "power", "value": "on"}])
    err(j.post("/routines/candidates", headers=MEMBER, json={"routine": bad}), 422, "ROUTINE_INVALID")


# ------------------------------------------------------------------ Alexa+ Route C (simulated)
def test_alexa_status_is_simulated_and_never_connected(j):
    s = ok(j.get("/integrations/alexa/status", headers=VIEWER))
    assert s["route"] == "C" and s["label"] == "SIMULATED DEMO" and s["integration_mode"] == "simulated_demo"
    assert s["connection_status"] == "not_configured" and s["live"]["status"] == "BLOCKED" and s["last_health_check"] is None
    hc = ok(j.post("/integrations/alexa/test", headers=VIEWER))
    assert hc["ok"] and hc["connection_status"] == "not_configured" and "no Amazon endpoint" in hc["scope"]
    s2 = ok(j.get("/integrations/alexa/status", headers=VIEWER))
    assert s2["last_health_check"]["ok"] and s2["capabilities_verified_by_last_check"] == s2["capabilities"]


def test_alexa_jsonrpc_protocol_and_errors(j):
    init = ok(j.post("/integrations/alexa/mcp", headers=VIEWER, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}))
    assert init["result"]["protocolVersion"] == "2025-11-25" and init["result"]["_meta"]["liveAlexaPlus"] == "BLOCKED"
    tools = ok(j.post("/integrations/alexa/mcp", headers=VIEWER, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))["result"]["tools"]
    assert [t["name"] for t in tools] == ["switch_integration_status", "switch_create_correction_draft", "switch_get_requirement", "switch_confirm_requirement",
                                          "switch_list_routines", "switch_preview_routine_change", "switch_run_replay", "switch_get_replay_report",
                                          "switch_propose_repair", "switch_record_review_decision", "switch_list_requirements"]
    assert all(t["inputSchema"]["additionalProperties"] is False for t in tools)
    u = ok(j.post("/integrations/alexa/mcp", headers=VIEWER, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "unlock_everything", "arguments": {}}}))
    assert u["error"]["code"] == -32602
    assert ok(j.post("/integrations/alexa/mcp", headers=VIEWER, json={"jsonrpc": "1.0", "method": "x"}))["error"]["code"] == -32600
    assert ok(j.post("/integrations/alexa/mcp", headers=VIEWER, json={"jsonrpc": "2.0", "id": 4, "method": "nope"}))["error"]["code"] == -32601
    r = mcp(j, "switch_run_replay", {"candidate_id": "cand-demo-faulty", "extra": 1})
    assert r["isError"] and r["structuredContent"]["error"]["code"] == "INVALID_ARGUMENTS"
    assert j.post("/integrations/alexa/mcp", json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"}).status_code == 401


def test_alexa_tools_drive_the_real_workflow_and_enforce_human_gates(j):
    d = mcp(j, "switch_create_correction_draft", {"text": "Alexa, " + HALL})["structuredContent"]
    assert d["action_kind"] == "DRAFT_SAVED_NOT_CONFIRMED" and d["draft"]["status"] == "DRAFT"
    rid = d["draft"]["requirement_id"]
    assert ok(j.get(f"/requirements/{rid}", headers=VIEWER))["status"] == "DRAFT", "the adapter uses the same store as the UI"
    assert mcp(j, "switch_confirm_requirement", {"requirement_id": rid, "version": 1, "explicit_user_confirmation": False})["isError"]
    assert mcp(j, "switch_confirm_requirement", {"requirement_id": rid, "version": 1, "explicit_user_confirmation": True}, hdr=MEMBER)["isError"]
    assert not mcp(j, "switch_confirm_requirement", {"requirement_id": rid, "version": 1, "explicit_user_confirmation": True})["isError"]
    prev = mcp(j, "switch_preview_routine_change", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    assert prev["action_kind"] == "PREVIEW_NO_LIVE_CHANGE" and rid in {a["requirement_id"] for a in prev["affected_requirements"]}
    run = mcp(j, "switch_run_replay", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    assert run["overall"] == "FAIL" and run["findings"][0]["evidence_event_ids"]
    stored = ok(j.get(f"/replays/{run['run_id']}", headers=VIEWER))
    assert stored["integration"]["invoked_via"] == "alexa_simulated" and stored["integration"]["correlation_id"] == run["correlation_id"]
    fix = mcp(j, "switch_propose_repair", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    assert fix["verified"] is False and fix["action_kind"] == "UNVERIFIED_CANDIDATE_CREATED_NOT_APPLIED"
    early = mcp(j, "switch_record_review_decision", {"candidate_id": fix["candidate_id"], "decision": "approve", "explicit_user_confirmation": True})
    assert early["isError"] and early["structuredContent"]["error"]["code"] == "VERIFICATION_REQUIRED"
    assert mcp(j, "switch_run_replay", {"candidate_id": fix["candidate_id"]})["structuredContent"]["overall"] == "PASS"
    dec = mcp(j, "switch_record_review_decision", {"candidate_id": fix["candidate_id"], "decision": "approve", "explicit_user_confirmation": True})["structuredContent"]
    assert dec["decision"]["status"] == "APPROVED" and dec["decision"]["deployed"] is False
    legacy = ok(j.post("/person3c/mcp", headers=OWNER, json={"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                                                            "params": {"name": "switch_interpret_correction", "arguments": {"household_id": "hh_demo", "text": "don't turn the light off"}}}))
    assert legacy["result"]["structuredContent"]["action_kind"] == "CLARIFICATION_NEEDED_NOTHING_SAVED"


# ------------------------------------------------------------------ persistence & migrations
def test_fresh_file_database_migrates_seeds_and_persists_across_restart(tmp_path):
    db = tmp_path / "switch.db"
    c1 = TestClient(create_app(str(db), profile="journey"))
    d = ok(c1.post("/requirements/drafts", headers=MEMBER, json={"source_correction": HALL, "interpreter": "p3c"}), 201)
    c2 = TestClient(create_app(str(db), profile="journey"))           # restart: no reseed, data kept
    assert ok(c2.get(f"/requirements/{d['requirement_id']}", headers=VIEWER))["status"] == "DRAFT"
    names = [r[0] for r in sqlite3.connect(db).execute("SELECT name FROM schema_migrations ORDER BY name")]
    assert names == [m[0] for m in MIGRATIONS] == ["001_initial", "002_integrity", "003_repair_provenance"]


def test_existing_v2_database_is_upgraded_to_003(tmp_path, monkeypatch):
    db = tmp_path / "old.db"
    import app.store as S
    monkeypatch.setattr(S, "MIGRATIONS", MIGRATIONS[:2])
    Store(str(db))
    monkeypatch.setattr(S, "MIGRATIONS", MIGRATIONS)
    Store(str(db))
    cols = [r[1] for r in sqlite3.connect(db).execute("PRAGMA table_info(candidates)")]
    assert "repair_provenance" in cols


# ------------------------------------------------------------------ ML artifact compatibility
def test_ml_artifact_loads_without_version_mismatch_in_pinned_environment():
    import numpy, pandas, sklearn
    from switch_p3c.casas.inference import ActivityModel
    from switch_p3c.config import ARTIFACT_DIR
    meta = json.loads((ARTIFACT_DIR / "casas_training_metadata.json").read_text())
    if (sklearn.__version__, numpy.__version__, pandas.__version__) != (meta["sklearn"], meta["numpy"], meta["pandas"]):
        pytest.skip(f"environment differs from the pinned artifact versions {meta['sklearn']}/{meta['numpy']}/{meta['pandas']}")
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        m = ActivityModel.load(ARTIFACT_DIR)
    assert m.ready, m.error
    assert not [x for x in w if "InconsistentVersion" in type(x.message).__name__ or "version" in str(x.message).lower()]


# ------------------------------------------------------------------ assistant contract (no raw JSON for people)
def test_alexa_every_tool_returns_human_text_not_serialized_json(j):
    """content[0].text is what a voice/chat surface would speak; it must never be a JSON dump of the result."""
    texts = []
    for name, args in [("switch_integration_status", {}), ("switch_list_routines", {}), ("switch_list_requirements", {}),
                       ("switch_get_requirement", {"requirement_id": "req-living-light-off"}),
                       ("switch_preview_routine_change", {"candidate_id": "cand-demo-faulty"})]:
        r = mcp(j, name, args)
        assert not r["isError"], name
        texts.append(r["content"][0]["text"])
    run = mcp(j, "switch_run_replay", {"candidate_id": "cand-demo-faulty"})
    texts.append(run["content"][0]["text"])
    rep = mcp(j, "switch_get_replay_report", {"run_id": run["structuredContent"]["run_id"]})
    texts.append(rep["content"][0]["text"])
    for t in texts:
        assert t and not t.lstrip().startswith(("{", "[")) and '"structuredContent"' not in t and '":' not in t, t


def test_alexa_explain_failure_and_repair_carry_readable_evidence(j):
    d = mcp(j, "switch_create_correction_draft", {"text": "Alexa, " + HALL})["structuredContent"]
    mcp(j, "switch_confirm_requirement", {"requirement_id": d["draft"]["requirement_id"], "version": 1, "explicit_user_confirmation": True})
    reqs = mcp(j, "switch_list_requirements", {"status": "CONFIRMED"})["structuredContent"]["requirements"]
    assert d["draft"]["requirement_id"] in {r["requirement_id"] for r in reqs} and all(r["status"] == "CONFIRMED" for r in reqs)
    prev = mcp(j, "switch_preview_routine_change", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    assert prev["before"]["routine_id"] == prev["after"]["routine_id"] and prev["before"] != prev["after"]
    run = mcp(j, "switch_run_replay", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    rep = mcp(j, "switch_get_replay_report", {"run_id": run["run_id"]})["structuredContent"]
    fd = rep["failure_details"][0]
    assert fd["requirement_id"] == run["findings"][0]["requirement_id"] and fd["requirement_title"] and fd["events"]
    assert {e["event_id"] for e in fd["events"]} == set(run["findings"][0]["evidence_event_ids"]), "explanation is grounded in the recorded trace"
    lst = mcp(j, "switch_list_routines", {})["structuredContent"]
    faulty = next(c for c in lst["candidates"] if c["candidate_id"] == "cand-demo-faulty")
    assert faulty["last_full_run"] == {"run_id": run["run_id"], "overall": "FAIL"}
    fix = mcp(j, "switch_propose_repair", {"candidate_id": "cand-demo-faulty"})["structuredContent"]
    assert fix["parent_candidate_id"] == "cand-demo-faulty" and fix["before"] != fix["after"] and fix["verified"] is False
    assert mcp(j, "switch_list_requirements", {"status": "BOGUS"})["isError"], "closed enum is enforced"


def test_cors_allows_any_loopback_port_but_not_other_sites(j):
    ok_ = j.options("/health", headers={"Origin": "http://127.0.0.1:5174", "Access-Control-Request-Method": "GET"})
    assert ok_.headers.get("access-control-allow-origin") == "http://127.0.0.1:5174"
    bad = j.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert bad.headers.get("access-control-allow-origin") is None
    assert ok(j.get("/"))["health"] == "/health"
