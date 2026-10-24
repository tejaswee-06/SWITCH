"""Extended verification: time-window assertions, seed semantics, requirement relevance + auto-binding,
lifecycle/version integrity, concurrency, reproducibility, approval staleness, reset scoping, restart."""
import json, sqlite3, threading
import pytest
from fastapi.testclient import TestClient
from app import fixtures as F
from app.main import create_app
from app.schemas import Routine, Scenario, RequirementContent
from app.simulator import simulate
from app.assertions import evaluate
from app.regression import run_suite, relevance, affected_devices
from tests.conftest import OWNER, MEMBER, VIEWER, OTHER

CAND = "cand-demo-faulty"
SC = {s.scenario_id: s for s in F.scenarios()}


def ok(r, code=200):
    assert r.status_code == code, r.text
    return r.json()


def err(r, status, code):
    assert r.status_code == status, r.text
    assert r.json()["error"]["code"] == code, r.text
    return r.json()["error"]


def R(**kw):
    d = {"routine_id": "r1", "version": 1, "name": "r1", "triggers": [{"type": "time", "at": "22:45"}],
         "actions": [{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}]}
    d.update(kw)
    return Routine.model_validate(d)


def scen(start="22:00", end="23:59", events=None, seed=0, living="on", occ=True, sid="sc-t"):
    return Scenario.model_validate({"scenario_id": sid, "seed": seed, "start": start, "end": end,
        "initial_state": {"living_light": {"power": living}, "hallway_occupancy": {"occupied": occ}, "hallway_light": {"power": "on"}},
        "events": events or [{"event_id": "e1", "at": start, "kind": "set", "device": "hallway_occupancy", "attr": "occupied", "value": occ}]})


def fs(value, *pre):
    return RequirementContent.model_validate({"title": "t", "source_correction": "c",
        "preconditions": list(pre), "expected_behavior": {"kind": "final_state_equals", "device": "living_light", "attr": "power", "value": value}})


def win(s, e): return {"op": "time_between", "start": s, "end": e}


def check(spec, routines, sc): return evaluate(spec, "CONFIRMED", simulate(routines, sc))


# ---------------- A. time_between for final_state_equals ----------------
def test_window_event_inside_window_passes():
    r = check(fs("off", win("22:00", "23:00")), [R()], scen())          # action at 22:45 < 23:00
    assert r["status"] == "PASS" and "[22:00,23:00)" in r["reason"] and r["evidence_event_ids"]


def test_window_event_outside_window_fails_with_evidence():
    r = check(fs("off", win("22:00", "22:30")), [R()], scen())          # light still 'on' at 22:30; action comes later
    assert r["status"] == "FAIL" and "'on'" in r["reason"]


def test_window_end_is_exclusive_event_at_end_does_not_count():
    assert check(fs("off", win("22:00", "22:45")), [R()], scen())["status"] == "FAIL"     # action AT 22:45 is outside [.,22:45)
    assert check(fs("off", win("22:00", "22:46")), [R()], scen())["status"] == "PASS"     # one minute later it is inside


def test_window_boundary_scenario_coverage():
    sc = scen(end="22:59")
    assert check(fs("off", win("22:59", "23:00")), [R()], sc)["status"] == "PASS"         # last observed minute is the window
    r = check(fs("off", win("23:00", "23:30")), [R()], sc)                                # scenario never reaches this window
    assert r["status"] == "INCONCLUSIVE" and r["details"]["not_exercised"] is True


def test_window_state_unchanged_by_later_events():
    later = R(triggers=[{"type": "time", "at": "23:30"}], actions=[{"action_id": "a1", "device": "living_light", "attr": "power", "value": "on"}])
    both = [R(), later.model_copy(update={"routine_id": "r2"})]
    assert check(fs("off", win("22:00", "23:00")), both, scen())["status"] == "PASS"      # 23:30 write is after the window
    assert check(fs("off"), both, scen())["status"] == "FAIL"                              # but the final state is 'on'


def test_identical_timestamps_use_documented_order():
    off = R(routine_id="w-off", priority=20, triggers=[{"type": "event", "name": "go"}])
    on = R(routine_id="w-on", priority=10, triggers=[{"type": "event", "name": "go"}],
           actions=[{"action_id": "a1", "device": "living_light", "attr": "power", "value": "on"}])
    ev = [{"event_id": "e1", "at": "22:30", "kind": "fire", "name": "go"}]
    s = scen(events=ev, living="off")
    assert check(fs("off", win("22:00", "23:00")), [off, on], s)["status"] == "PASS"      # lower priority number first; off writes last
    off2 = off.model_copy(update={"priority": 5})
    assert check(fs("off", win("22:00", "23:00")), [off2, on], s)["status"] == "FAIL"     # on writes last


@pytest.mark.parametrize("pre", [
    {"op": "time_between", "start": None, "end": "23:00"},        # missing time info
    {"op": "time_between", "start": "25:99", "end": "23:00"},     # malformed
    {"op": "time_between", "start": "banana", "end": "23:00"},
    win("22:30", "22:30"),                                          # empty/ambiguous window
    win("23:00", "22:00"),                                          # wraps midnight: unsupported for final_state_equals
    {"op": "gt", "device": "hallway_occupancy", "attr": "occupied", "value": True},   # unsupported operator
])
def test_window_ambiguous_or_unsupported_is_inconclusive_never_pass(pre):
    spec = RequirementContent.model_construct(**{**fs("off").model_dump(), "preconditions": [__import__("app.schemas", fromlist=["Condition"]).Condition.model_validate(pre)],
                                                 "expected_behavior": fs("off").expected_behavior, "scope": fs("off").scope})
    r = evaluate(spec, "CONFIRMED", simulate([R()], scen()))
    assert r["status"] == "INCONCLUSIVE"


def test_window_ending_at_midnight_supported_and_two_windows_rejected():
    assert check(fs("off", win("23:00", "00:00")), [R()], scen())["status"] == "PASS"
    assert check(fs("off", win("22:00", "23:00"), win("22:10", "23:30")), [R()], scen())["status"] == "INCONCLUSIVE"


def test_state_precondition_plus_window_combined():
    occ = {"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": True}
    assert check(fs("off", occ, win("22:00", "23:00")), [R()], scen())["status"] == "PASS"
    r = check(fs("off", occ, win("22:00", "23:00")), [R()], scen(occ=False))
    assert r["status"] == "INCONCLUSIVE" and r["details"]["not_exercised"]


def test_unknown_state_in_window_is_inconclusive():
    guarded = R(actions=[{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off",
                          "conditions": [{"op": "eq", "device": "hallway_occupancy", "attr": "occupied", "value": False}]}])
    s = scen(occ=None, events=[{"event_id": "e1", "at": "22:00", "kind": "fire", "name": "noop"}])
    assert check(fs("off", win("22:00", "23:00")), [guarded], s)["status"] == "INCONCLUSIVE"


def mns(*pre, value="off"):
    return RequirementContent.model_validate({"title": "t", "source_correction": "c", "preconditions": list(pre),
        "expected_behavior": {"kind": "must_not_set", "device": "living_light", "attr": "power", "value": value}})


def test_must_not_set_window_boundaries():
    mid = [{"event_id": "e0", "at": "22:10", "kind": "set", "device": "hallway_occupancy", "attr": "occupied", "value": True}]
    inside = check(mns(win("22:00", "22:30")), [R(triggers=[{"type": "time", "at": "22:29"}])], scen(events=mid))
    edge = check(mns(win("22:00", "22:30")), [R(triggers=[{"type": "time", "at": "22:30"}])], scen(events=mid))
    start = check(mns(win("22:29", "22:31")), [R(triggers=[{"type": "time", "at": "22:29"}])], scen(events=mid))
    assert inside["status"] == "FAIL" and edge["status"] == "PASS" and start["status"] == "FAIL"   # end exclusive, start inclusive


def test_unsupported_operator_never_treated_as_neq_in_simulation():
    from app.simulator import eval_condition
    from app.schemas import Condition
    assert eval_condition(Condition(op="gt", device="hallway_occupancy", attr="occupied", value=True), {"hallway_occupancy": {"occupied": False}}, 0)[0] is None


# ---------------- B. seed semantics ----------------
def test_seed_has_no_effect_because_simulator_is_fully_deterministic():
    a = simulate([F.goodnight_faulty_candidate()], scen(sid="s", seed=0, events=[{"event_id": "e1", "at": "22:30", "kind": "fire", "name": "goodnight"}]))
    b = simulate([F.goodnight_faulty_candidate()], scen(sid="s", seed=987654, events=[{"event_id": "e1", "at": "22:30", "kind": "fire", "name": "goodnight"}]))
    assert a["seed"] == 0 and b["seed"] == 987654          # recorded
    assert a["result_hash"] == b["result_hash"] and a["trace"] == b["trace"]


# ---------------- C. relevance + automatic binding ----------------
def hall_auto():
    d = F.req_hallway().model_dump(exclude_none=True)
    d["scope"] = {"routine_ids": [], "devices": ["hallway_light"], "scenario_ids": []}
    return RequirementContent.model_validate(d)


def rq(i, spec, status="CONFIRMED"): return {"requirement_id": i, "version": 1, "status": status, "spec": spec}


def test_auto_binding_reports_unexercised_scenarios_and_never_hides_unknown():
    unexercised = F.scenarios()[0].model_copy(update={"scenario_id": "sc-empty-hall", "initial_state": {**F.scenarios()[0].initial_state, "hallway_occupancy": {"occupied": False}}})
    scs = {s.scenario_id: s for s in [*F.scenarios(), unexercised]}
    base = F.goodnight_baseline()
    s = run_suite([base], base, [rq("R1", hall_auto())], scs)
    by = {t["scenario_id"]: t["status"] for t in s["tests"]}
    assert by == {"sc-hallway-occupied": "PASS", "sc-hallway-unknown": "INCONCLUSIVE"} and s["overall"] == "INCONCLUSIVE"
    assert [n["scenario_id"] for n in s["not_exercised"]] == ["sc-empty-hall"] and all(t["binding"] == "auto" for t in s["tests"])
    only = {k: v for k, v in scs.items() if k != "sc-hallway-unknown"}
    s2 = run_suite([base], base, [rq("R1", hall_auto())], only)
    assert s2["overall"] == "PASS" and s2["totals"]["not_exercised"] == 1                  # visible, not silently dropped
    bad = F.goodnight_faulty_candidate()
    assert run_suite([bad], bad, [rq("R1", hall_auto())], only)["overall"] == "FAIL"


def test_auto_binding_with_no_exercising_scenario_is_inconclusive():
    sc = F.scenarios()[0].model_copy(update={"initial_state": {**F.scenarios()[0].initial_state, "hallway_occupancy": {"occupied": False}}})
    base = F.goodnight_baseline()
    s = run_suite([base], base, [rq("R1", hall_auto())], {sc.scenario_id: sc})
    assert s["overall"] == "INCONCLUSIVE" and s["tests"][0]["scenario_id"] is None and s["totals"]["PASS"] == 0
    assert run_suite([base], base, [rq("R1", hall_auto())], {})["overall"] == "INCONCLUSIVE"        # no scenarios at all


def test_explicit_binding_still_honoured():
    base = F.goodnight_baseline()
    s = run_suite([base], base, [rq("R1", F.req_hallway())], SC)
    assert [t["scenario_id"] for t in s["tests"]] == ["sc-hallway-occupied"] and s["tests"][0]["binding"] == "explicit"


def test_cascade_relevance_is_indirect_and_ambiguous_scope_is_reported_not_dropped():
    trig = R(routine_id="cascade", triggers=[{"type": "state", "device": "living_light", "attr": "power", "value": "off"}],
             actions=[{"action_id": "a1", "device": "hallway_light", "attr": "power", "value": "off"}])
    start = R(routine_id="start", actions=[{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}])
    d, i = affected_devices(start, [start, trig])
    assert d == {"living_light"} and i == {"hallway_light"}
    assert relevance(hall_auto(), start, [start, trig])[0] == "indirect"
    assert relevance(hall_auto(), start, [start])[0] == "none"
    assert relevance(F.req_hallway(), start, [start, trig])[0] == "ambiguous"      # scope lists 'goodnight' but 'start' reaches the light
    s = run_suite([start, trig], start, [rq("R1", F.req_hallway())], SC)
    assert s["not_applicable"][0]["ambiguous"] is True and s["overall"] == "INCONCLUSIVE"   # nothing ran -> never PASS
    glob = RequirementContent.model_validate({**F.req_living_off().model_dump(exclude_none=True), "scope": {}})
    assert relevance(glob, start, [start])[0] == "global"


# ---------------- API helpers ----------------
def draft_confirm(client, structured, text="rule"):
    d = ok(client.post("/requirements/drafts", headers=MEMBER, json={"source_correction": text, "structured": structured}), 201)
    return ok(client.post(f"/requirements/{d['requirement_id']}/confirm", headers=OWNER, json={"version": 1}))


NEW_DEVICE_REQ = {"title": "Hallway light stays on while occupied (device-scoped)", "scope": {"devices": ["hallway_light"]},
                  "preconditions": [F.OCC_TRUE], "expected_behavior": {"kind": "must_not_set", "device": "hallway_light", "attr": "power", "value": "off"}}


def test_repaired_routine_is_checked_against_all_relevant_saved_requirements_not_only_the_original():
    c = TestClient(create_app(":memory:"))
    new = draft_confirm(c, NEW_DEVICE_REQ)
    run1 = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert {t["requirement_id"] for t in run1["suite"]["tests"] if t["status"] == "FAIL"} == {"req-hallway-occupied", new["requirement_id"]}
    fix = ok(c.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    run2 = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    ids = {t["requirement_id"] for t in run2["suite"]["tests"]}
    assert {"req-hallway-occupied", "req-living-light-off", "req-front-door-locked", new["requirement_id"]} <= ids
    mine = {t["scenario_id"]: t["status"] for t in run2["suite"]["tests"] if t["requirement_id"] == new["requirement_id"]}
    assert mine == {"sc-hallway-occupied": "PASS", "sc-hallway-unknown": "INCONCLUSIVE"}          # unrelated INCONCLUSIVE stays visible
    assert run2["suite"]["overall"] == "INCONCLUSIVE" and run2["suite"]["totals"]["FAIL"] == 0
    err(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "SUITE_NOT_PASSING")


# ---------------- D. lifecycle + version integrity ----------------
@pytest.fixture()
def c(): return TestClient(create_app(":memory:"))


def new_draft(c):
    return ok(c.post("/requirements/drafts", headers=MEMBER, json={"source_correction": "x", "structured": NEW_DEVICE_REQ}), 201)


def test_draft_is_not_enforced_and_confirmation_needs_owner(c):
    d = new_draft(c)
    err(c.post(f"/requirements/{d['requirement_id']}/confirm", headers=MEMBER, json={"version": 1}), 403, "FORBIDDEN")
    err(c.post(f"/requirements/{d['requirement_id']}/confirm", headers=VIEWER, json={"version": 1}), 403, "FORBIDDEN")
    err(c.post("/requirements/drafts", headers=VIEWER, json={"source_correction": "x", "structured": NEW_DEVICE_REQ}), 403, "FORBIDDEN")
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert d["requirement_id"] in {e["requirement_id"] for e in run["suite"]["excluded"]}
    assert d["requirement_id"] not in {t["requirement_id"] for t in run["suite"]["tests"]}


def test_invalid_transitions(c):
    d = new_draft(c); rid = d["requirement_id"]
    ok(c.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}))
    err(c.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}), 409, "INVALID_TRANSITION")       # already confirmed
    err(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "CONFIRMED"}), 422, "INVALID_TRANSITION")
    err(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "DRAFT"}), 422, "INVALID_TRANSITION")
    err(c.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 1, "status": "DISABLED"}), 403, "FORBIDDEN")
    err(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1}), 422, "EMPTY_PATCH")
    ok(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "RETIRED"}))
    err(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "content": {"title": "z"}}), 409, "INVALID_TRANSITION")
    err(c.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}), 409, "INVALID_TRANSITION")          # retired is terminal


def test_disabled_requirement_is_listed_as_not_enforced_and_can_be_reconfirmed_only_by_owner(c):
    rid = "req-front-door-locked"
    ok(c.patch(f"/requirements/{rid}", headers=OWNER, json={"expected_version": 1, "status": "DISABLED"}))
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    assert [e["status"] for e in run["suite"]["excluded"]] == ["DISABLED"] and rid not in {t["requirement_id"] for t in run["suite"]["tests"]}
    err(c.post(f"/requirements/{rid}/confirm", headers=MEMBER, json={"version": 1}), 403, "FORBIDDEN")
    assert ok(c.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}))["status"] == "CONFIRMED"


def test_conflicting_version_updates_are_rejected_not_overwritten(c):
    rid = "req-living-light-off"
    ok(c.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 1, "content": {"title": "A"}}))
    err(c.patch(f"/requirements/{rid}", headers=MEMBER, json={"expected_version": 1, "content": {"title": "B"}}), 409, "VERSION_CONFLICT")
    v = ok(c.get(f"/requirements/{rid}/versions", headers=VIEWER))
    assert [x["content"]["title"] for x in v["versions"]][1:] == ["A"] and v["versions"][0]["content"]["title"].startswith("Goodnight leaves")
    err(c.post(f"/requirements/{rid}/confirm", headers=OWNER, json={"version": 1}), 409, "VERSION_CONFLICT")        # stale version number


def test_concurrent_confirms_exactly_one_wins():
    app = create_app(":memory:"); svc = app.state.svc
    owner = {"user_id": "olivia", "household_id": "hh_demo", "role": "owner"}
    member = {"user_id": "mia", "household_id": "hh_demo", "role": "member"}
    rid = svc.create_draft(member, {"source_correction": "x", "structured": NEW_DEVICE_REQ})["requirement_id"]
    results, barrier = [], threading.Barrier(8)

    def go():
        barrier.wait()
        try:
            svc.confirm(owner, rid, 1); results.append("ok")
        except Exception as e:
            results.append(getattr(e, "code", repr(e)))
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert results.count("ok") == 1 and results.count("INVALID_TRANSITION") == 7, results
    assert len([a for a in app.state.store.all("SELECT 1 FROM audit_log WHERE action='requirement_confirmed' AND entity_id=?", (rid,))]) == 1


def test_concurrent_candidate_creation_same_version_exactly_one():
    app = create_app(":memory:"); svc = app.state.svc
    member = {"user_id": "mia", "household_id": "hh_demo", "role": "member"}
    r = F.goodnight_baseline().model_copy(deep=True); r.version = 7
    out, barrier = [], threading.Barrier(6)

    def go():
        barrier.wait()
        try:
            svc.create_candidate(member, r); out.append("ok")
        except Exception as e:
            out.append(getattr(e, "code", repr(e)))
    ts = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert out.count("ok") == 1 and out.count("VERSION_CONFLICT") == 5, out


def test_history_tables_are_append_only_at_db_level(c):
    fix, _ = repaired_pass(c)
    ok(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}))   # so every table has rows
    st = c.app.state.store
    for sql in ("UPDATE requirement_versions SET content='{}'", "UPDATE replays SET json='{}'", "UPDATE audit_log SET action='x'",
                "UPDATE approvals SET decision='x'", "UPDATE routines SET json='{}'", "UPDATE scenarios SET json='{}'"):
        with pytest.raises(sqlite3.DatabaseError):
            st.run(sql)


# ---------------- E. repair / approval ----------------
def repaired_pass(c):
    ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    fix = ok(c.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    assert run["suite"]["overall"] == "PASS"
    return fix, run


def test_same_scenario_inputs_used_before_and_after_and_baseline_never_mutated(c):
    before = ok(c.get("/routines", headers=VIEWER))
    fix, run2 = repaired_pass(c)
    cmp = run2["comparison_to_previous_run"]
    assert cmp["same_scenario_versions"] is True and cmp["same_requirement_versions"] is True
    assert {(x["requirement_id"], x["scenario_id"]) for x in cmp["fixed"] + cmp["unchanged"]} == {(t["requirement_id"], t["scenario_id"]) for t in run2["suite"]["tests"]}
    ok(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}))
    assert ok(c.get("/routines", headers=VIEWER)) == before          # approval is not deployment; baseline untouched
    assert ok(c.get(f"/candidates/{CAND}", headers=VIEWER))["routine"]["actions"][0]["conditions"] == []


def test_comparison_warns_when_scenario_versions_differ(c):
    ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    fix = ok(c.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    sc = F.scenarios()[0].model_copy(update={"version": 2})
    c.app.state.store.run("INSERT INTO scenarios VALUES (?,?,?,?)", ("hh_demo", sc.scenario_id, 2, json.dumps(sc.model_dump())))
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)
    assert run["comparison_to_previous_run"]["same_scenario_versions"] is False and "WARNING" in run["comparison_to_previous_run"]["inputs_note"]


def test_approval_refused_when_replay_is_stale(c):
    fix, _ = repaired_pass(c)
    ok(c.patch("/requirements/req-front-door-locked", headers=MEMBER, json={"expected_version": 1, "content": {"title": "edited"}}))      # returns to DRAFT
    err(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "STALE_REPLAY")
    ok(c.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"]}), 201)                                                # fresh full replay
    assert ok(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}))["status"] == "APPROVED"


def test_approval_refused_when_a_new_confirmed_requirement_appeared(c):
    fix, _ = repaired_pass(c)
    draft_confirm(c, NEW_DEVICE_REQ)
    err(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}), 409, "STALE_REPLAY")


def test_targeted_replay_cannot_be_used_to_approve(c):
    fix, _ = repaired_pass(c)
    # approval looks only at the latest FULL replay, so a later targeted run must not change that
    ok(c.post("/replays", headers=MEMBER, json={"candidate_id": fix["candidate_id"], "requirement_ids": ["req-hallway-occupied"]}), 201)
    assert ok(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve"}))["deployed"] is False


def test_audit_trail_preserves_run_and_approval(c):
    fix, run2 = repaired_pass(c)
    ok(c.post(f"/candidates/{fix['candidate_id']}/approve", headers=OWNER, json={"decision": "approve", "note": "ship it"}))
    acts = [(a["action"], a["entity_id"]) for a in c.app.state.store.all("SELECT action, entity_id FROM audit_log ORDER BY id")]
    assert ("candidate_created", fix["candidate_id"]) in acts and ("replay_completed", run2["run_id"]) in acts and ("candidate_approved", fix["candidate_id"]) in acts
    rep = ok(c.get(f"/replays/{run2['run_id']}/report", headers=VIEWER))
    assert rep["reviewer_decisions"][0]["note"] == "ship it" and rep["repair_ops"] and rep["candidate_status"] == "APPROVED"


# ---------------- F. reproducibility + reports ----------------
def test_report_contains_required_fields_and_failure_evidence_from_real_trace(c):
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    rep = ok(c.get(f"/replays/{run['run_id']}/report", headers=VIEWER))
    for k in ("run_id", "simulator_version", "requirement_versions", "scenario_versions", "routine_versions", "routine_diff", "suite", "reproducibility", "safety_statement", "reviewer_decisions"):
        assert k in rep, k
    fe = rep["failure_evidence"][0]
    assert fe["events"] and fe["events"][0]["device"] == "hallway_light" and fe["events"][0]["resulting"] == "off"
    assert rep["safety_statement"].startswith("SIMULATED DEMO")


def test_old_reports_stay_reproducible_after_requirement_and_scenario_edits(c):
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    stored = ok(c.get(f"/replays/{run['run_id']}", headers=VIEWER))
    assert ok(c.get(f"/replays/{run['run_id']}/verify", headers=VIEWER))["reproduced"] is True
    ok(c.patch("/requirements/req-hallway-occupied", headers=MEMBER, json={"expected_version": 1, "content": {"title": "Edited later"}}))
    sc = F.scenarios()[0].model_copy(update={"version": 2, "description": "changed"})
    c.app.state.store.run("INSERT INTO scenarios VALUES (?,?,?,?)", ("hh_demo", sc.scenario_id, 2, json.dumps(sc.model_dump())))
    assert ok(c.get(f"/replays/{run['run_id']}", headers=VIEWER)) == stored                 # stored evidence untouched
    v = ok(c.get(f"/replays/{run['run_id']}/verify", headers=VIEWER))
    assert v["reproduced"] is True and v["pinned"]["requirements"]["req-hallway-occupied"] == 1 and v["pinned"]["scenarios"]["sc-hallway-occupied"] == 1


def test_verify_detects_tampering_and_is_household_scoped(c):
    run = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    err(c.get(f"/replays/{run['run_id']}/verify", headers=OTHER), 404, "NOT_FOUND")
    st = c.app.state.store
    st.run("DROP TRIGGER replays_immutable")                                                   # simulate out-of-band tampering
    rec = json.loads(st.one("SELECT json FROM replays WHERE run_id=?", (run["run_id"],))["json"])
    victim = next(t for t in rec["suite"]["tests"] if t["status"] == "FAIL")
    victim["status"] = "PASS"                                                                  # forge a failing result into a pass
    st.run("UPDATE replays SET json=? WHERE run_id=?", (json.dumps(rec), run["run_id"]))
    v = ok(c.get(f"/replays/{run['run_id']}/verify", headers=VIEWER))
    assert v["reproduced"] is False and v["differences"]


def test_identical_inputs_identical_modeled_results_ignoring_ids_and_timestamps(c):
    a = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    b = ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    for r in (a, b):
        r.pop("run_id"); r.pop("created_at"); r.pop("comparison_to_previous_run", None)
    assert a == b


# ---------------- G. API / persistence / security ----------------
def test_errors_are_consistent_json_and_never_echo_tokens(c):
    e = err(c.get("/definitely/not/a/route"), 404, "NOT_FOUND"); assert "detail" not in e
    err(c.delete("/health"), 405, "METHOD_NOT_ALLOWED")
    r = c.get("/requirements", headers={"Authorization": "Bearer super-secret-token-123"})
    err(r, 401, "UNAUTHENTICATED"); assert "super-secret-token-123" not in r.text
    err(c.get("/requirements"), 401, "UNAUTHENTICATED")
    assert c.post("/candidates", headers=MEMBER, content=b"{not json").status_code == 422


@pytest.mark.parametrize("path", ["/requirements/req-hallway-occupied", f"/candidates/{CAND}", f"/candidates/{CAND}/diff"])
def test_other_household_cannot_read(c, path):
    err(c.get(path, headers=OTHER), 404, "NOT_FOUND")
    assert ok(c.get("/requirements", headers=OTHER)) == [] and ok(c.get("/routines", headers=OTHER)) == []
    err(c.post("/replays", headers=OTHER, json={"candidate_id": CAND}), 404, "NOT_FOUND")
    err(c.post(f"/candidates/{CAND}/approve", headers=OTHER, json={"decision": "reject"}), 404, "NOT_FOUND")


def test_persistence_survives_restart_and_restart_does_not_reseed(tmp_path):
    db = str(tmp_path / "s.db")
    a = TestClient(create_app(db))
    run = ok(a.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
    fix = ok(a.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
    b = TestClient(create_app(db))                                                 # "server restart"
    assert ok(b.get(f"/replays/{run['run_id']}", headers=VIEWER))["suite"]["overall"] == "FAIL"
    assert {x["candidate_id"] for x in ok(b.get("/candidates", headers=VIEWER))} == {CAND, fix["candidate_id"]}
    assert ok(b.get(f"/replays/{run['run_id']}/verify", headers=VIEWER))["reproduced"] is True


def test_empty_and_partially_initialised_database(tmp_path):
    db = str(tmp_path / "e.db")
    sqlite3.connect(db).close()                                                    # empty file
    assert TestClient(create_app(db)).get("/health").status_code == 200
    db2 = str(tmp_path / "p.db")
    app = create_app(db2, auto_seed=False)                                         # schema only, no households
    t = TestClient(app)
    err(t.get("/requirements", headers=OWNER), 401, "UNAUTHENTICATED")
    assert TestClient(create_app(db2)).get("/requirements", headers=OWNER).status_code == 200      # seeds into an empty DB only


# ---------------- H. reset / demo-only boundaries ----------------
def test_reset_only_touches_demo_households_and_is_repeatable(c):
    st = c.app.state.store
    st.run("INSERT INTO households VALUES ('hh_real','Real')")
    st.run("INSERT INTO requirements VALUES ('req-real','hh_real',1,'CONFIRMED',NULL,NULL,'t','u','t')")
    st.run("INSERT INTO requirement_versions VALUES ('req-real',1,'{}','u','t','n')")
    st.run("INSERT INTO audit_log (household_id,actor,action,at) VALUES ('hh_real','u','keep','t')")
    for _ in range(3):                                   # repeated cycles must not accumulate state
        ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)
        ok(c.post(f"/candidates/{CAND}/suggest-fix", headers=MEMBER, json={}), 201)
        new_draft(c)
        ok(c.post("/demo/reset", headers=OWNER))
        assert len(ok(c.get("/requirements", headers=OWNER))) == 3 and len(ok(c.get("/candidates", headers=OWNER))) == 1 and ok(c.get("/replays", headers=OWNER)) == []
        assert ok(c.post("/replays", headers=MEMBER, json={"candidate_id": CAND}), 201)["suite"]["overall"] == "FAIL"
        ok(c.post("/demo/reset", headers=OWNER))
    assert st.one("SELECT 1 FROM requirements WHERE requirement_id='req-real'") and st.one("SELECT 1 FROM requirement_versions WHERE requirement_id='req-real'")
    assert st.one("SELECT 1 FROM audit_log WHERE action='keep'") and st.one("SELECT 1 FROM households WHERE household_id='hh_real'")


def test_reset_is_restricted_and_disabled_outside_demo(c, monkeypatch):
    err(c.post("/demo/reset", headers=MEMBER), 403, "FORBIDDEN")
    err(c.post("/demo/reset", headers=OTHER), 403, "FORBIDDEN")           # another household's owner cannot wipe the demo
    err(c.post("/demo/reset", headers={}), 401, "UNAUTHENTICATED")
    monkeypatch.setenv("SWITCH_ENV", "production")
    prod = TestClient(create_app(":memory:"))
    assert prod.get("/health").json()["environment"] == "UNSPECIFIED"
    err(prod.post("/demo/reset", headers=OWNER), 401, "UNAUTHENTICATED")  # nothing seeded: demo tokens do not exist outside demo mode


def test_no_device_deployment_surface_exists(c):
    paths = set(c.app.openapi()["paths"])
    assert not any("deploy" in p for p in paths)
    assert c.get("/health").json()["device_control"] == "none"
