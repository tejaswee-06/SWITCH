"""Unit tests: validation, simulator, assertions, diff/repair, regression aggregation, determinism."""
import pytest
from pydantic import ValidationError
from app import fixtures as F
from app.schemas import Routine, Scenario, RepairOp, RequirementContent
from app.validation import validate_routine, validate_scenario, validate_requirement
from app.simulator import simulate
from app.assertions import evaluate
from app.diff import diff_routines, apply_repair, RepairError
from app.regression import run_suite, compare, overall

SC = {s.scenario_id: s for s in F.scenarios()}
def R(d): return Routine.model_validate(d)
def reqs(*pairs, status="CONFIRMED"):
    return [{"requirement_id": n, "version": 1, "status": status, "spec": s} for n, s in pairs]
def codes(issues): return {i["code"] for i in issues}

def routine(**over):
    d = F.goodnight_baseline().model_dump(exclude_none=True); d.update(over); return R(d)

# ---------- routine validation ----------
def test_valid_baseline():
    assert validate_routine(F.goodnight_baseline()) == []

def test_unknown_device():
    r = routine(actions=[{"action_id": "a1", "device": "toaster", "attr": "power", "value": "on"}])
    assert "UNKNOWN_DEVICE" in codes(validate_routine(r))

def test_unsupported_condition_operator():
    r = routine(conditions=[{"op": "gt", "device": "hallway_occupancy", "attr": "occupied", "value": True}])
    assert "UNSUPPORTED_CONDITION" in codes(validate_routine(r))

def test_unsupported_capability_action_on_sensor():
    r = routine(actions=[{"action_id": "a1", "device": "hallway_occupancy", "attr": "occupied", "value": False}])
    assert "CAPABILITY_UNSUPPORTED" in codes(validate_routine(r))

def test_invalid_state_value_and_duplicate_action_id():
    r = routine(actions=[{"action_id": "a1", "device": "hallway_light", "attr": "power", "value": "dim"},
                         {"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}])
    assert {"INVALID_VALUE", "DUPLICATE_ACTION_ID"} <= codes(validate_routine(r))

def test_malformed_routine_schema_rejected():
    with pytest.raises(ValidationError):
        R({"routine_id": "x", "version": 1, "name": "x", "triggers": "nope", "actions": []})
    with pytest.raises(ValidationError):
        R({**F.goodnight_baseline().model_dump(exclude_none=True), "bogus": 1})

def test_bad_time_and_trigger():
    r = routine(triggers=[{"type": "time", "at": "25:99"}, {"type": "telepathy"}])
    assert {"INVALID_TIME", "UNSUPPORTED_TRIGGER"} <= codes(validate_routine(r))

def test_scenario_validation():
    bad = Scenario.model_validate({"scenario_id": "s", "initial_state": {"ghost": {"x": 1}},
        "events": [{"event_id": "e", "at": "10:00", "kind": "teleport"}]})
    assert {"UNKNOWN_DEVICE", "UNSUPPORTED_EVENT"} <= codes(validate_scenario(bad))

def test_requirement_validation_malformed():
    spec = RequirementContent.model_validate({"title": "t", "source_correction": "c",
        "expected_behavior": {"kind": "vibes", "device": "hallway_light", "attr": "power", "value": "off"}})
    assert "UNSUPPORTED_BEHAVIOR" in codes(validate_requirement(spec))

# ---------- simulator ----------
def test_trace_records_transition_with_conditions():
    sim = simulate([F.goodnight_faulty_candidate()], SC["sc-hallway-occupied"])
    a1 = next(e for e in sim["trace"] if e["type"] == "action" and e["action_id"] == "a1")
    assert (a1["previous"], a1["resulting"], a1["outcome"], a1["changed"]) == ("on", "off", "executed", True)
    assert a1["state_before"]["hallway_occupancy"]["occupied"] is True and a1["routine_version"] == 2

def test_guard_blocks_action_and_records_condition():
    sim = simulate([F.goodnight_baseline()], SC["sc-hallway-occupied"])
    a1 = next(e for e in sim["trace"] if e["type"] == "action" and e["action_id"] == "a1")
    assert a1["outcome"] == "skipped" and a1["conditions"][0]["result"] is False
    assert sim["final_state"]["hallway_light"]["power"] == "on"

def test_unknown_state_is_indeterminate_not_executed():
    sim = simulate([F.goodnight_baseline()], SC["sc-hallway-unknown"])
    a1 = next(e for e in sim["trace"] if e["type"] == "action" and e["action_id"] == "a1")
    assert a1["outcome"] == "indeterminate" and sim["indeterminate"] and sim["final_state"]["hallway_light"]["power"] == "on"

def test_priority_tiebreak_later_writer_wins_and_conflict_recorded():
    mk = lambda rid, pr, v: R({"routine_id": rid, "version": 1, "name": rid, "priority": pr, "triggers": [{"type": "event", "name": "goodnight"}],
                               "actions": [{"action_id": "a1", "device": "hallway_light", "attr": "power", "value": v}]})
    sim = simulate([mk("b", 50, "off"), mk("a", 50, "on")], SC["sc-hallway-occupied"])   # equal priority -> routine_id order: a then b
    assert sim["final_state"]["hallway_light"]["power"] == "off" and len(sim["conflicts"]) == 1

def test_simultaneous_scenario_events_keep_declared_order():
    sc = Scenario.model_validate({"scenario_id": "s", "start": "10:00", "end": "11:00", "initial_state": {"hallway_light": {"power": "on"}},
        "events": [{"event_id": "e2", "at": "10:05", "kind": "set", "device": "hallway_light", "attr": "power", "value": "off"},
                   {"event_id": "e1", "at": "10:05", "kind": "set", "device": "hallway_light", "attr": "power", "value": "on"}]})
    sim = simulate([], sc)
    assert [e["source"] for e in sim["trace"]] == ["e2", "e1"] and sim["final_state"]["hallway_light"]["power"] == "on"

def test_state_trigger_chain_and_loop_limit():
    chain = R({"routine_id": "chain", "version": 1, "name": "c", "triggers": [{"type": "state", "device": "hallway_light", "attr": "power", "value": "off"}],
               "actions": [{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}]})
    sc = Scenario.model_validate({"scenario_id": "s", "initial_state": {"hallway_light": {"power": "on"}, "living_light": {"power": "on"}},
        "events": [{"event_id": "e", "at": "10:00", "kind": "set", "device": "hallway_light", "attr": "power", "value": "off"}]})
    assert simulate([chain], sc)["final_state"]["living_light"]["power"] == "off"
    ping = lambda n, a, b: R({"routine_id": n, "version": 1, "name": n, "triggers": [{"type": "state", "device": "hallway_light", "attr": "power", "value": a}],
                              "actions": [{"action_id": "a1", "device": "hallway_light", "attr": "power", "value": b}]})
    res = simulate([ping("p1", "off", "on"), ping("p2", "on", "off")], sc, max_events=50)
    assert res["complete"] is False and "limit" in res["error"]

def test_time_trigger_fires_from_simulated_clock():
    r = R({"routine_id": "t", "version": 1, "name": "t", "triggers": [{"type": "time", "at": "22:45"}],
           "actions": [{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}]})
    sim = simulate([r], SC["sc-hallway-occupied"])
    assert sim["final_state"]["living_light"]["power"] == "off" and any(e["type"] == "clock_tick" and e["sim_time"] == "22:45" for e in sim["trace"])

# ---------- determinism ----------
def test_determinism_identical_inputs_identical_results():
    outs = [simulate([F.goodnight_faulty_candidate()], SC["sc-hallway-occupied"]) for _ in range(25)]
    assert len({o["result_hash"] for o in outs}) == 1 and all(o["trace"] == outs[0]["trace"] for o in outs)
    suites = [run_suite([F.goodnight_faulty_candidate()], F.goodnight_faulty_candidate(), reqs(("R1", F.req_hallway()), ("R2", F.req_living_off())), SC) for _ in range(10)]
    assert all(s == suites[0] for s in suites)

# ---------- assertions ----------
def ev(spec, sim, status="CONFIRMED"): return evaluate(spec, status, sim)

def test_fail_cites_violating_event():
    sim = simulate([F.goodnight_faulty_candidate()], SC["sc-hallway-occupied"])
    r = ev(F.req_hallway(), sim)
    assert r["status"] == "FAIL" and r["evidence_event_ids"] == ["E0003"]

def test_pass_requires_exercised_preconditions():
    sim = simulate([F.goodnight_baseline()], SC["sc-hallway-occupied"])
    assert ev(F.req_hallway(), sim)["status"] == "PASS"
    sim2 = simulate([F.goodnight_faulty_candidate()], F.scenarios()[0].model_copy(update={"initial_state": {**F.scenarios()[0].initial_state, "hallway_occupancy": {"occupied": False}}}))
    assert ev(F.req_hallway(), sim2)["status"] == "INCONCLUSIVE"       # preconditions never held: vacuous != pass

def test_missing_sensor_is_inconclusive():
    sim = simulate([F.goodnight_faulty_candidate()], SC["sc-hallway-unknown"])
    assert ev(F.req_hallway(), sim)["status"] == "INCONCLUSIVE"

def test_unconfirmed_incomplete_and_empty_trace_inconclusive():
    sim = simulate([F.goodnight_baseline()], SC["sc-hallway-occupied"])
    assert ev(F.req_hallway(), sim, status="DRAFT")["status"] == "INCONCLUSIVE"
    assert ev(F.req_hallway(), {**sim, "complete": False, "error": "x"})["status"] == "INCONCLUSIVE"
    assert ev(F.req_hallway(), {**sim, "trace": []})["status"] == "INCONCLUSIVE"

def test_unsupported_behavior_kind_inconclusive():
    spec = F.req_hallway().model_copy(update={"expected_behavior": F.req_hallway().expected_behavior.model_copy(update={"kind": "vibes"})})
    assert ev(spec, simulate([F.goodnight_baseline()], SC["sc-hallway-occupied"]))["status"] == "INCONCLUSIVE"

def test_final_state_semantics():
    sim = simulate([F.goodnight_baseline()], SC["sc-hallway-occupied"])
    assert ev(F.req_living_off(), sim)["status"] == "PASS"
    broken = routine(actions=[a for a in F.goodnight_baseline().model_dump(exclude_none=True)["actions"] if a["action_id"] != "a2"])
    assert ev(F.req_living_off(), simulate([broken], SC["sc-hallway-occupied"]))["status"] == "FAIL"

# ---------- diff / repair ----------
def test_diff_shows_removed_guard():
    ch = diff_routines(F.goodnight_baseline(), F.goodnight_faulty_candidate())
    assert any(c["kind"] == "removed" and c["path"] == "actions[a1].conditions" for c in ch)

def test_diff_covers_triggers_actions_params():
    b = F.goodnight_baseline(); c = b.model_copy(deep=True); c.version = 2
    c.triggers = [R({**b.model_dump(exclude_none=True), "triggers": [{"type": "time", "at": "23:00"}]}).triggers[0]]
    c.actions[1].value = "on"
    paths = {x["path"] for x in diff_routines(b, c)}
    assert {"triggers", "actions[a2].value", "version"} <= paths

def test_repair_restores_guard_and_is_isolated():
    cand = F.goodnight_faulty_candidate()
    fixed = apply_repair(cand, [RepairOp(op="add_action_condition", action_id="a1", condition=F.OCC_FALSE)], 3)
    assert fixed.actions[0].conditions and not cand.actions[0].conditions and fixed.version == 3

@pytest.mark.parametrize("op", [
    {"op": "format_disk"}, {"op": "add_action_condition", "action_id": "zz", "condition": F.OCC_FALSE},
    {"op": "add_action_condition", "action_id": "a1", "condition": {"op": "gt", "device": "hallway_occupancy", "attr": "occupied", "value": True}},
    {"op": "add_action", "action": {"action_id": "a9", "device": "ghost", "attr": "power", "value": "on"}}])
def test_invalid_repair_rejected(op):
    with pytest.raises(RepairError):
        apply_repair(F.goodnight_faulty_candidate(), [RepairOp.model_validate(op)], 3)

def test_noop_repair_rejected():
    with pytest.raises(RepairError):
        apply_repair(F.goodnight_baseline(), [RepairOp(op="add_action_condition", action_id="a1", condition=F.OCC_FALSE)], 3)

# ---------- regression aggregation ----------
def test_suite_never_passes_when_tests_skipped_or_inconclusive():
    r = F.goodnight_baseline()
    nosc = F.req_hallway().model_copy(update={"scope": F.req_hallway().scope.model_copy(update={"scenario_ids": []})})
    s = run_suite([r], r, reqs(("R1", F.req_hallway()), ("R9", nosc)), SC)
    assert s["overall"] == "INCONCLUSIVE" and s["totals"]["INCONCLUSIVE"] == 1
    d = run_suite([r], r, reqs(("R1", F.req_hallway()), status="DRAFT"), SC)
    assert d["overall"] == "INCONCLUSIVE" and d["excluded"] and d["totals"]["total"] == 0
    assert overall({"PASS": 0, "FAIL": 0, "INCONCLUSIVE": 0}) == "INCONCLUSIVE"

def test_compare_detects_newly_failing():
    p = [{"requirement_id": "R", "scenario_id": "s", "status": "PASS"}]
    n = [{"requirement_id": "R", "scenario_id": "s", "status": "FAIL"}]
    assert compare(p, n)["newly_failing"]
