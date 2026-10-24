"""Trace-based assertion evaluator. Independent of the API, store and any AI.

Status semantics
  PASS         preconditions held at >=1 observation point, no violation, nothing unknown
  FAIL         a recorded executed transition violates the requirement (evidence ids given)
  INCONCLUSIVE unknown state, incomplete/empty trace, unsupported behavior, unconfirmed
               requirement, or preconditions never exercised (vacuous truth is NOT a pass)
"""
from typing import Any
import re
from .schemas import RequirementContent
from .simulator import eval_all, cond_expr
from .validation import hhmm_to_min
from .catalog import SUPPORTED_CONDITION_OPS

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

PASS, FAIL, INCONCLUSIVE = "PASS", "FAIL", "INCONCLUSIVE"


def _same(a: Any, b: Any) -> bool:
    return type(a) is type(b) and a == b


def _res(status, reason, evidence=None, **details):
    return {"status": status, "reason": reason, "evidence_event_ids": evidence or [], "details": details}


def _pre(spec: RequirementContent, state: dict, minute: int):
    return eval_all([("precondition", c) for c in spec.preconditions], state, minute)[0]


def _unsupported_precondition(spec: RequirementContent):
    for i, c in enumerate(spec.preconditions):
        if c.op not in SUPPORTED_CONDITION_OPS:
            return f"preconditions[{i}]: unsupported operator '{c.op}'; cannot evaluate"
        if c.op == "time_between":
            if not (c.start and c.end and _HHMM.match(c.start) and _HHMM.match(c.end)):
                return f"preconditions[{i}]: time_between needs valid HH:MM start and end; time information missing or ambiguous"
        elif c.device is None or c.attr is None:
            return f"preconditions[{i}]: '{c.op}' needs device and attr"
    return None


def evaluate(spec: RequirementContent, status: str, sim: dict) -> dict:
    if status != "CONFIRMED":
        return _res(INCONCLUSIVE, f"requirement status is {status}; only CONFIRMED requirements are enforced")
    if not sim.get("complete", False):
        return _res(INCONCLUSIVE, f"simulation incomplete: {sim.get('error')}")
    if not sim["trace"]:
        return _res(INCONCLUSIVE, "trace is empty; nothing was observed")
    bad = _unsupported_precondition(spec)
    if bad:
        return _res(INCONCLUSIVE, bad, unsupported=True)
    b = spec.expected_behavior
    if b.kind == "must_not_set":
        return _must_not_set(spec, sim)
    if b.kind == "final_state_equals":
        return _final_state_equals(spec, sim)
    return _res(INCONCLUSIVE, f"unsupported behavior kind '{b.kind}'")


def _must_not_set(spec: RequirementContent, sim: dict) -> dict:
    b = spec.expected_behavior
    scope_r = set(spec.scope.routine_ids)
    exercised, unknown_pts, violations, undecidable, guarded = [], [], [], [], []
    for e in sim["trace"]:
        minute = hhmm_to_min(e["sim_time"])
        pre = _pre(spec, e["state_before"], minute)
        if pre is True:
            exercised.append(e["event_id"])
        elif pre is None:
            unknown_pts.append(e["event_id"])
        if e["type"] != "action" or e["device"] != b.device or e["attr"] != b.attr:
            continue
        if scope_r and e["routine_id"] not in scope_r:
            continue
        if pre is False:
            continue
        if e["outcome"] == "indeterminate" and _same(e["target_value"], b.value):
            undecidable.append(e["event_id"])
        elif pre is None:
            if e["outcome"] == "executed" and e["changed"] and _same(e["resulting"], b.value):
                undecidable.append(e["event_id"])
        elif e["outcome"] == "executed" and e["changed"] and _same(e["resulting"], b.value):
            violations.append(e["event_id"])
        elif e["outcome"] == "skipped" and _same(e["target_value"], b.value):
            guarded.append(e["event_id"])
    pre_txt = " AND ".join(cond_expr(c) for c in spec.preconditions) or "always"
    if violations:
        return _res(FAIL, f"{b.device}.{b.attr} was set to {b.value!r} while [{pre_txt}] held "
                          f"(violating event {', '.join(violations)})", violations, guarded_events=guarded)
    if undecidable or (unknown_pts and not exercised):
        return _res(INCONCLUSIVE, "a precondition or guard depended on UNKNOWN state; cannot establish compliance",
                    undecidable, unknown_observation_points=unknown_pts)
    if not exercised:
        return _res(INCONCLUSIVE, f"preconditions [{pre_txt}] never held in this scenario; requirement was not exercised", not_exercised=True)
    return _res(PASS, f"no event set {b.device}.{b.attr} to {b.value!r} while [{pre_txt}] held "
                      f"({len(exercised)} observation point(s) checked)", guarded, exercised_observation_points=len(exercised))


def _final_state_equals(spec: RequirementContent, sim: dict) -> dict:
    """final_state_equals semantics (documented contract)
      * state preconditions (eq/neq) are evaluated against the scenario's INITIAL state (unchanged behaviour).
      * a time_between precondition defines an observation window [start,end): the assertion checks the
        device state AT THE END of that window (all trace events with sim_time < end applied, none at/after it).
        Boundaries: start inclusive, end exclusive. 'end' == 00:00 means midnight (24:00). Any other window that
        wraps midnight, an empty window (start == end), more than one window, or a scenario that does not
        observe the window end -> INCONCLUSIVE (never PASS).
      * without time_between the state at the scenario's end is checked.
    """
    b = spec.expected_behavior
    windows = [c for c in spec.preconditions if c.op == "time_between"]
    state_pre = [c for c in spec.preconditions if c.op != "time_between"]
    if state_pre:
        pre = eval_all([("precondition", c) for c in state_pre], sim["initial_state"], hhmm_to_min("00:00"))[0]
        if pre is None:
            return _res(INCONCLUSIVE, "initial state needed by preconditions is UNKNOWN")
        if pre is False:
            return _res(INCONCLUSIVE, "preconditions do not hold in the scenario's initial state; not exercised", not_exercised=True)
    cutoff = None                                   # minute at which the observed state is taken (exclusive)
    win_txt = ""
    if windows:
        if len(windows) > 1:
            return _res(INCONCLUSIVE, "more than one time_between precondition is not supported for final_state_equals")
        w = windows[0]
        s_m, e_m = hhmm_to_min(w.start), hhmm_to_min(w.end)
        if e_m == 0 and s_m > 0:
            e_m = 1440
        if s_m == e_m:
            return _res(INCONCLUSIVE, "time window is empty (start == end); ambiguous")
        if s_m > e_m:
            return _res(INCONCLUSIVE, "a time window that wraps midnight is not supported for final_state_equals")
        lo, hi = sim["window"]["start_min"], sim["window"]["end_min"]
        if hi < e_m - 1 or lo >= e_m or hi < s_m:
            return _res(INCONCLUSIVE, f"scenario {sim['window']['start']}-{sim['window']['end']} does not observe the end of window "
                                       f"[{w.start},{w.end}); not exercised", not_exercised=True)
        cutoff, win_txt = e_m, f" at end of window [{w.start},{w.end})"
    inside = [e for e in sim["trace"] if cutoff is None or hhmm_to_min(e["sim_time"]) < cutoff]
    touching = [e for e in inside if e["type"] == "action" and e["device"] == b.device and e["attr"] == b.attr]
    undecided = [e["event_id"] for e in touching if e["outcome"] == "indeterminate"]
    if undecided:
        return _res(INCONCLUSIVE, "an action on the target device could not be evaluated (UNKNOWN state)", undecided)
    if cutoff is None:
        state = sim["final_state"]
    else:
        later = next((e for e in sim["trace"] if hhmm_to_min(e["sim_time"]) >= cutoff), None)
        state = later["state_before"] if later is not None else sim["final_state"]
    final = state[b.device][b.attr]
    evidence = [e["event_id"] for e in touching][-3:]
    if final is None:
        return _res(INCONCLUSIVE, f"{b.device}.{b.attr}{win_txt} is UNKNOWN", evidence)
    if _same(final, b.value):
        return _res(PASS, f"{b.device}.{b.attr} == {b.value!r}{win_txt or ' (final)'}", evidence, final_value=final)
    return _res(FAIL, f"{b.device}.{b.attr} is {final!r}{win_txt or ' (final)'}, expected {b.value!r}", evidence, final_value=final)
