"""Small, hand-authored SYNTHETIC regression benchmark. Results are whatever the
engine actually returns; nothing here is a measured real-world rate."""
import json, sys
from . import fixtures as F
from .schemas import Routine, Scenario, RepairOp, Condition
from .regression import run_suite, compare
from .diff import apply_repair
from .simulator import simulate
from .assertions import evaluate

B = F.goodnight_baseline


def _reqs(*pairs):
    return [{"requirement_id": n, "version": 1, "status": "CONFIRMED", "spec": s} for n, s in pairs]


def _status(routine, reqs, scen, others=()):
    s = run_suite([*others, routine], routine, reqs, {x.scenario_id: x for x in scen}, include_traces=False)
    return s


def _routine(rid, prio, power, trig="goodnight", conds=None):
    return Routine.model_validate({"routine_id": rid, "version": 1, "name": rid, "priority": prio,
        "triggers": [{"type": "event", "name": trig}],
        "actions": [{"action_id": "a1", "device": "hallway_light", "attr": "power", "value": power, "conditions": conds or []}]})


def cases() -> list[dict]:
    out = []
    sc = F.scenarios()
    r123 = _reqs(("R1", F.req_hallway()), ("R2", F.req_living_off()), ("R3", F.req_door_locked()))
    # 1 contradictory writes
    on, off = _routine("lights-on", 10, "on"), _routine("lights-off", 20, "off")
    wide = F.req_hallway().model_copy(update={"scope": F.req_hallway().scope.model_copy(update={"routine_ids": []})})
    s = _status(off, _reqs(("R1", wide)), sc, others=[on])
    sim = simulate([on, off], sc[0])
    out.append({"case": "contradictory_writes", "expected": "R1=FAIL and 1 conflict recorded (priority 20 writer wins)",
                "actual": f"R1={s['tests'][0]['status']}, conflicts={len(sim['conflicts'])}", "ok": s["tests"][0]["status"] == "FAIL" and len(sim["conflicts"]) == 1})
    # 2 removed occupancy guard
    s = _status(F.goodnight_faulty_candidate(), r123, sc)
    out.append({"case": "removed_occupancy_condition", "expected": "R1=FAIL, R2=PASS, R3=PASS", "actual": ", ".join(f"{t['requirement_id']}={t['status']}" for t in s["tests"]),
                "ok": [t["status"] for t in s["tests"]] == ["FAIL", "PASS", "PASS"]})
    # 3 changed time-of-day condition
    def tod(start, end):
        r = B().model_copy(deep=True); r.actions[1].conditions = [Condition(op="time_between", start=start, end=end)]
        return Routine.model_validate(r.model_dump(exclude_none=True))
    ok_s = _status(tod("22:00", "06:00"), _reqs(("R2", F.req_living_off())), sc)["tests"][0]["status"]
    bad_s = _status(tod("08:00", "12:00"), _reqs(("R2", F.req_living_off())), sc)["tests"][0]["status"]
    out.append({"case": "changed_time_of_day_condition", "expected": "22:00-06:00 window=PASS; 08:00-12:00 window=FAIL", "actual": f"{ok_s}; {bad_s}", "ok": (ok_s, bad_s) == ("PASS", "FAIL")})
    # 4 event ordering changes final state
    req = _reqs(("R2", F.req_living_off().model_copy(update={"scope": F.req_living_off().scope.model_copy(update={"routine_ids": [], "devices": ["hallway_light"]}),
                "expected_behavior": F.req_living_off().expected_behavior.model_copy(update={"device": "hallway_light"})})))
    a = _status(_routine("w-off", 20, "off"), req, sc, others=[_routine("w-on", 10, "on")])["tests"][0]["status"]
    b = _status(_routine("w-off", 5, "off"), req, sc, others=[_routine("w-on", 10, "on")])["tests"][0]["status"]
    out.append({"case": "changed_event_ordering", "expected": "off-writer last=PASS; off-writer first=FAIL", "actual": f"{a}; {b}", "ok": (a, b) == ("PASS", "FAIL")})
    # 5 repair that breaks another requirement
    bad = apply_repair(F.goodnight_faulty_candidate(), [RepairOp(op="remove_action", action_id="a1"), RepairOp(op="remove_action", action_id="a2")], 3)
    before = _status(F.goodnight_faulty_candidate(), r123, sc); after = _status(bad, r123, sc)
    cmp = compare(before["tests"], after["tests"])
    out.append({"case": "repair_breaks_other_requirement", "expected": "R1 fixed, R2 newly failing", "actual": f"fixed={[x['requirement_id'] for x in cmp['fixed']]}, newly_failing={[x['requirement_id'] for x in cmp['newly_failing']]}",
                "ok": [x["requirement_id"] for x in cmp["fixed"]] == ["R1"] and [x["requirement_id"] for x in cmp["newly_failing"]] == ["R2"]})
    # 6 unknown sensor state
    unk = Scenario.model_validate({**sc[1].model_dump(), "scenario_id": "sc-unk"})
    spec = F.req_hallway().model_copy(update={"scope": F.req_hallway().scope.model_copy(update={"scenario_ids": ["sc-hallway-unknown"]})})
    s = _status(B(), _reqs(("R1", spec)), sc)
    out.append({"case": "unknown_sensor_state", "expected": "INCONCLUSIVE, suite not PASS", "actual": f"{s['tests'][0]['status']}, suite={s['overall']}", "ok": s["tests"][0]["status"] == "INCONCLUSIVE" and s["overall"] != "PASS"})
    # 7 time-window final_state_equals (previously always INCONCLUSIVE)
    from .schemas import RequirementContent
    def win_req(e):
        return RequirementContent.model_validate({"title": "t", "source_correction": "c", "scope": {"scenario_ids": ["sc-hallway-occupied"]},
            "preconditions": [{"op": "time_between", "start": "22:00", "end": e}],
            "expected_behavior": {"kind": "final_state_equals", "device": "living_light", "attr": "power", "value": "off"}})
    t_r = Routine.model_validate({"routine_id": "timer", "version": 1, "name": "t", "triggers": [{"type": "time", "at": "22:45"}],
        "actions": [{"action_id": "a1", "device": "living_light", "attr": "power", "value": "off"}]})
    w_in = _status(t_r, _reqs(("W", win_req("23:00"))), sc)["tests"][0]["status"]
    w_edge = _status(t_r, _reqs(("W", win_req("22:45"))), sc)["tests"][0]["status"]
    out.append({"case": "time_window_final_state", "expected": "action at 22:45 inside [22:00,23:00)=PASS; at exclusive end [22:00,22:45)=FAIL",
                "actual": f"{w_in}; {w_edge}", "ok": (w_in, w_edge) == ("PASS", "FAIL")})
    # 8 automatic scenario binding keeps unknown-state visible and never passes
    auto = F.req_hallway().model_copy(update={"scope": F.req_hallway().scope.model_copy(update={"routine_ids": [], "scenario_ids": []})})
    s = _status(B(), _reqs(("R1", auto)), sc)
    out.append({"case": "auto_binding_unknown_scenario_visible", "expected": "occupied=PASS, unknown=INCONCLUSIVE, suite=INCONCLUSIVE",
                "actual": ", ".join(f"{t['scenario_id']}={t['status']}" for t in s["tests"]) + f", suite={s['overall']}",
                "ok": {t["scenario_id"]: t["status"] for t in s["tests"]} == {"sc-hallway-occupied": "PASS", "sc-hallway-unknown": "INCONCLUSIVE"} and s["overall"] == "INCONCLUSIVE"})
    # 9 ambiguous scope is reported, not silently dropped, and cannot yield PASS
    other = _routine("sneaky", 50, "off", trig="goodnight")
    s = _status(other, _reqs(("R1", F.req_hallway())), sc)
    out.append({"case": "ambiguous_scope_reported", "expected": "R1 listed as ambiguous not_applicable; suite not PASS",
                "actual": f"ambiguous={[n['requirement_id'] for n in s['not_applicable'] if n['ambiguous']]}, suite={s['overall']}",
                "ok": [n["requirement_id"] for n in s["not_applicable"] if n["ambiguous"]] == ["R1"] and s["overall"] != "PASS"})
    return out


if __name__ == "__main__":
    res = cases()
    json.dump(res, sys.stdout, indent=2); print()
    sys.exit(0 if all(c["ok"] for c in res) else 1)
