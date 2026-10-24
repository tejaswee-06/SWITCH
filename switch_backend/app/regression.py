"""Regression suite orchestration: select requirements, run them against
deterministic simulations, aggregate honestly (nothing skipped silently)."""
from typing import Optional
from .schemas import Routine, Scenario, RequirementContent
from .simulator import simulate, sha, SIMULATOR_VERSION
from .assertions import evaluate, PASS, FAIL, INCONCLUSIVE


def affected_devices(routine: Routine, routines: list[Routine]) -> tuple[set, set]:
    """(direct, indirect) devices a routine can write. Indirect = writes made by OTHER enabled routines whose
    `state` triggers can be fired by the (transitive) effects of this routine. Purely structural."""
    direct = {a.device for a in routine.actions}
    seen, frontier, indirect = {routine.routine_id}, set(direct), set()
    pool = [r for r in routines if r.enabled and r.routine_id != routine.routine_id]
    while frontier:
        nxt = set()
        for r in pool:
            if r.routine_id in seen:
                continue
            if any(t.type == "state" and t.device in frontier for t in r.triggers):
                seen.add(r.routine_id)
                w = {a.device for a in r.actions}
                indirect |= w
                nxt |= w
        frontier = nxt
    return direct, indirect - direct


def relevance(spec: RequirementContent, routine: Routine, routines: Optional[list[Routine]] = None) -> tuple[str, str]:
    """Structured, deterministic requirement relevance for a routine.
    -> (direct|indirect|global|ambiguous|none, reason). 'ambiguous' and 'none' are NOT run, but are reported."""
    s = spec.scope
    direct, indirect = affected_devices(routine, routines or [routine])
    devs = set(s.devices) | {spec.expected_behavior.device}
    if s.routine_ids:
        if routine.routine_id in s.routine_ids:
            return "direct", f"routine '{routine.routine_id}' is listed in scope.routine_ids"
        if devs & (direct | indirect):
            return "ambiguous", (f"scope lists routines {s.routine_ids} but '{routine.routine_id}' also writes "
                                 f"{sorted(devs & (direct | indirect))}; scope is NOT extended automatically - edit the requirement scope or select it explicitly")
        return "none", f"scope.routine_ids {s.routine_ids} does not include '{routine.routine_id}'"
    if s.devices:
        if set(s.devices) & direct:
            return "direct", f"routine writes scoped device(s) {sorted(set(s.devices) & direct)}"
        if set(s.devices) & indirect:
            return "indirect", f"routine reaches scoped device(s) {sorted(set(s.devices) & indirect)} through state-trigger cascades"
        return "none", f"routine does not write or cascade to scoped devices {s.devices}"
    return "global", "requirement has no routine/device scope; it applies to every candidate"


def applicable(spec: RequirementContent, routine: Routine, routines: Optional[list[Routine]] = None) -> bool:
    return relevance(spec, routine, routines)[0] in ("direct", "indirect", "global")


def overall(totals: dict) -> str:
    if totals[FAIL]:
        return FAIL
    if totals[INCONCLUSIVE] or not (totals[PASS]):
        return INCONCLUSIVE
    return PASS


def run_suite(routines: list[Routine], target: Routine, requirements: list[dict],
              scenarios: dict[str, Scenario], include_traces: bool = True) -> dict:
    """requirements: [{requirement_id, version, status, spec: RequirementContent}]
    Scenario binding: explicit `scope.scenario_ids` are used as given. If a requirement has NONE, it is auto-bound
    to every scenario in the household; scenarios where it is not exercised are listed under `not_exercised`
    (visible, not counted). If no scenario exercises it the requirement yields one INCONCLUSIVE test - never a PASS."""
    tests, excluded, not_applicable, not_exercised, sims = [], [], [], [], {}
    for rq in sorted(requirements, key=lambda x: x["requirement_id"]):
        head = {"requirement_id": rq["requirement_id"], "requirement_version": rq["version"]}
        if rq["status"] != "CONFIRMED":
            excluded.append({**head, "status": rq["status"], "reason": f"{rq['status']} requirements are not enforced"})
            continue
        rel, why = relevance(rq["spec"], target, routines)
        if rel in ("none", "ambiguous"):
            not_applicable.append({**head, "relevance": rel, "ambiguous": rel == "ambiguous", "reason": why})
            continue
        head["relevance"] = rel
        explicit = list(rq["spec"].scope.scenario_ids)
        auto = not explicit
        sc_ids = sorted(explicit) if explicit else sorted(scenarios)
        head["binding"] = "auto" if auto else "explicit"
        if not sc_ids:
            tests.append({**head, "scenario_id": None, "scenario_version": None, "status": INCONCLUSIVE,
                          "reason": "no scenario is bound to this requirement and the household has none; it cannot be evaluated",
                          "evidence_event_ids": [], "details": {}})
            continue
        exercised_any = False
        for sid in sc_ids:
            sc = scenarios.get(sid)
            if sc is None:
                tests.append({**head, "scenario_id": sid, "scenario_version": None, "status": INCONCLUSIVE,
                              "reason": f"scenario '{sid}' not found", "evidence_event_ids": [], "details": {}})
                exercised_any = True
                continue
            if sid not in sims:
                sims[sid] = simulate(routines, sc)
            sim = sims[sid]
            res = evaluate(rq["spec"], rq["status"], sim)
            if auto and res["details"].get("not_exercised"):
                not_exercised.append({**head, "scenario_id": sid, "scenario_version": sc.version, "reason": res["reason"]})
                continue
            exercised_any = True
            t = {**head, "scenario_id": sid, "scenario_version": sc.version, **res,
                 "sim_result_hash": sim["result_hash"], "final_state": sim["final_state"], "conflicts": sim["conflicts"]}
            if include_traces:
                t["trace"] = sim["trace"]
                t["initial_state"] = sim["initial_state"]
            tests.append(t)
        if auto and not exercised_any:
            tests.append({**head, "scenario_id": None, "scenario_version": None, "status": INCONCLUSIVE,
                          "reason": f"auto-bound to {len(sc_ids)} scenario(s) but none exercised this requirement; cannot establish compliance",
                          "evidence_event_ids": [], "details": {"checked_scenarios": sc_ids}})
    totals = {PASS: 0, FAIL: 0, INCONCLUSIVE: 0}
    for t in tests:
        totals[t["status"]] += 1
    return {"overall": overall(totals), "totals": {**totals, "total": len(tests), "excluded": len(excluded),
            "not_applicable": len(not_applicable), "not_exercised": len(not_exercised)},
            "tests": tests, "excluded": excluded, "not_applicable": not_applicable, "not_exercised": not_exercised,
            "input_fingerprint": sha({"simulator": SIMULATOR_VERSION,
                                      "routines": [r.model_dump(exclude_none=True) for r in sorted(routines, key=lambda r: r.routine_id)],
                                      "requirements": [(r["requirement_id"], r["version"], r["status"]) for r in requirements],
                                      "scenarios": {k: v.version for k, v in sorted(scenarios.items())}})}


def compare(prev_tests: list[dict], new_tests: list[dict]) -> dict:
    key = lambda t: (t["requirement_id"], t["scenario_id"])
    p = {key(t): t for t in prev_tests}
    out = {"newly_failing": [], "fixed": [], "unchanged": [], "new_tests": []}
    for t in new_tests:
        k = key(t)
        row = {"requirement_id": k[0], "scenario_id": k[1], "before": p[k]["status"] if k in p else None, "after": t["status"]}
        if k not in p:
            out["new_tests"].append(row)
        elif p[k]["status"] == PASS and t["status"] != PASS:
            out["newly_failing"].append(row)
        elif p[k]["status"] != PASS and t["status"] == PASS:
            out["fixed"].append(row)
        else:
            out["unchanged"].append(row)
    return out
