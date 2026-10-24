"""Person 3C <-> Person 2 adapter. Explicit translation functions; nothing is silently dropped.

Person 3C (AI / interpretation) and Person 2 (deterministic core) were built against different schemas:

  Person 3C                                         Person 2 (canonical)
  ------------------------------------------------  --------------------------------------------------------
  Condition{signal:"hallway_occupancy",op:"==",v}   Condition{op:"eq",device:"hallway_occupancy",attr:"occupied",value}
  Condition{signal:"time_of_day",op:">="|"<=",v}    Condition{op:"time_between",start,end}
  ExpectedBehavior{device_id,capability,relation,v} Behavior{kind:must_not_set|final_state_equals,device,attr,value}
     relation must_not_set                             kind must_not_set
     relation must_set | must_remain                   kind final_state_equals
     lock: capability lock, locked/unlocked            front_door.locked True/False
     security: capability armed, armed/disarmed        security.armed True/False
  Scope{kind,id}                                    Scope{routine_ids,devices,scenario_ids}
  Ambiguity{field,reason,question,options}          ambiguities: [question strings]  (non-empty blocks confirmation)
  repair op add_action_condition{index,condition}   RepairOp add_action_condition{action_id,condition}
  repair op add_condition{condition}                RepairOp add_routine_condition{condition}
  repair op remove_action{index}                    RepairOp remove_action{action_id}
  (none)                                            RepairOp add_action  -> not in the P3C allowlist; rejected for P3C validation

Anything that cannot be translated (unknown signal such as "mode", comparator thresholds, unsupported device) is
returned as an explicit issue / clarification question. Interpretation output is ALWAYS a proposal: it never
confirms a requirement and never produces PASS / FAIL / INCONCLUSIVE.
"""
from __future__ import annotations

from typing import Any, Optional

from .catalog import CATALOG, ROOMS
from .errors import ApiError
from .schemas import Condition, RepairOp, RequirementContent, Routine, Scenario
from .simulator import eval_all
from .validation import hhmm_to_min, validate_requirement

try:  # Person 3C is optional at import time; routes report 503 if it is unavailable.
    from switch_p3c.contracts import InterpretRequest, P3CError, RequirementDraft
    from switch_p3c.nlu.catalog import Catalog, DeviceSpec
    from switch_p3c.nlu.interpreter import apply_clarification as _p3c_clarify
    from switch_p3c.nlu.interpreter import interpret as _p3c_interpret
    from switch_p3c.nlu.provider import OpenAICompatibleProvider
    from switch_p3c.repair import propose_repair as _p3c_propose_repair
    AVAILABLE, IMPORT_ERROR = True, None
except Exception as _e:  # pragma: no cover - exercised only when the package is missing
    AVAILABLE, IMPORT_ERROR = False, type(_e).__name__

ROOM_NAMES = {r["room_id"]: r["name"] for r in ROOMS}
ROOM_ALIASES = {"living_room": "living", "lounge": "living", "bedroom_1": "bedroom"}
DEVICE_TERMS = {"tv": "tv", "television": "tv", "security system": "security", "security": "security",
                "alarm system": "security", "alarm": "security"}
# capability vocabulary Person 3C uses for each canonical device type that a REQUIREMENT may target
# type -> {p3c_capability: (p3c_values, p2_attr, {p3c_value: p2_value})}
REQ_CAPS = {
    "light": {"power": (["on", "off"], "power", {"on": "on", "off": "off"})},
    "tv": {"power": (["on", "off"], "power", {"on": "on", "off": "off"})},
    "lock": {"lock": (["locked", "unlocked"], "locked", {"locked": True, "unlocked": False})},
    "security": {"armed": (["armed", "disarmed"], "armed", {"armed": True, "disarmed": False})},
}
INTERPRETER_SCOPE_NOTE = ("Requirements can target lights, the TV, the security system and the front-door lock. "
                          "Fans, AC, doors and appliances are modeled in the house but are not yet supported as requirement targets.")


def _need():
    if not AVAILABLE:
        raise ApiError(503, "PERSON3C_UNAVAILABLE", f"Person 3C package could not be imported ({IMPORT_ERROR})")


def label(device: str) -> str:
    return CATALOG.get(device, {}).get("label", device)


def room_of(device: str) -> Optional[str]:
    return CATALOG.get(device, {}).get("room")


# ------------------------------------------------------------------------------------------------ catalogs
def interpretation_catalog(household_id: str, routines: list[Routine]) -> "Catalog":
    """Canonical catalog in Person 3C's vocabulary (requirement-targetable devices only)."""
    _need()
    devices = {}
    for did, spec in CATALOG.items():
        caps = REQ_CAPS.get(spec["type"])
        if caps and not spec["read_only"]:
            devices[did] = DeviceSpec(did, spec["room"], spec["type"], {c: v[0] for c, v in caps.items()})
    signals: dict[str, Any] = {f"{r['room_id']}_occupancy": "bool" for r in ROOMS if f"{r['room_id']}_occupancy" in CATALOG}
    signals["time_of_day"] = ("time",)
    return Catalog(household_id, [r["room_id"] for r in ROOMS], devices, {r.routine_id: r.name for r in routines}, signals,
                   provenance="canonical_contract", aliases={"rooms": ROOM_ALIASES, "device_terms": DEVICE_TERMS})


def repair_catalog(household_id: str, routines: list[Routine]) -> "Catalog":
    """Canonical catalog for repair validation, in Person 2's own attr/value vocabulary (all writable devices)."""
    _need()
    devices = {did: DeviceSpec(did, spec["room"], spec["type"], dict(spec["attrs"]))
               for did, spec in CATALOG.items() if not spec["read_only"]}
    signals: dict[str, Any] = {}
    for did, spec in CATALOG.items():
        for attr, vals in spec["attrs"].items():
            signals[f"{did}.{attr}"] = list(vals)
    signals["time_of_day"] = ("time",)
    return Catalog(household_id, [r["room_id"] for r in ROOMS], devices, {r.routine_id: r.name for r in routines}, signals,
                   provenance="canonical_contract")


def llm_provider():
    """Optional OpenAI-compatible provider from env vars. None => deterministic rules only (no external call)."""
    if not AVAILABLE:
        return None
    return OpenAICompatibleProvider.from_env()


def interpreter_status() -> dict:
    p = llm_provider()
    return {"available": AVAILABLE, "import_error": IMPORT_ERROR,
            "mode": "llm_provider_with_rule_cross_check" if p else "deterministic_rules",
            "llm_configured": bool(p),
            "label": ("Optional LLM provider configured (output schema-validated and cross-checked against rules)" if p else
                      "Rule-based interpreter (Person 3C deterministic rules). No live LLM is configured or called."),
            "supported_targets": INTERPRETER_SCOPE_NOTE}


# ------------------------------------------------------------------------------------------------ requirement translation
def _cond_from_p3c(c, issues: list) -> list[dict]:
    sig, op, v = c.signal, c.op, c.value
    if sig.endswith("_occupancy") and sig in CATALOG:
        if op not in ("==", "!="):
            issues.append({"code": "UNSUPPORTED_CONDITION", "path": "preconditions", "message": f"'{sig} {op} {v}' cannot be modeled"})
            return []
        return [{"op": "eq" if op == "==" else "neq", "device": sig, "attr": "occupied", "value": bool(v)}]
    issues.append({"code": "UNSUPPORTED_CONDITION", "path": "preconditions",
                   "message": f"condition '{sig} {op} {v}' has no equivalent in the modeled household"})
    return []


def _time_window(conds) -> tuple[Optional[dict], list]:
    ge = [c.value for c in conds if c.signal == "time_of_day" and c.op in (">=", ">")]
    le = [c.value for c in conds if c.signal == "time_of_day" and c.op in ("<=", "<")]
    if not ge and not le:
        return None, []
    if len(ge) > 1 or len(le) > 1:
        return None, [{"code": "AMBIGUOUS_TIME", "path": "preconditions", "message": "more than one start or end time"}]
    return {"op": "time_between", "start": ge[0] if ge else "00:00", "end": le[0] if le else "00:00"}, []


def _state_hits(content: RequirementContent, sc: Scenario) -> bool:
    """Does any observation point of the scenario satisfy the state preconditions? (selection only, not a verdict)"""
    state_pre = [c for c in content.preconditions if c.op != "time_between"]
    if not state_pre:
        return True
    state = {d: dict(v) for d, v in sc.initial_state.items()}
    points = [{d: dict(v) for d, v in state.items()}]
    if content.expected_behavior.kind == "must_not_set":
        for e in sorted(sc.events, key=lambda e: hhmm_to_min(e.at)):
            if e.kind == "set" and e.device:
                state.setdefault(e.device, {})[e.attr] = e.value
                points.append({d: dict(v) for d, v in state.items()})
    return any(eval_all([("precondition", c) for c in state_pre], p, 0)[0] is True for p in points)


def select_scenarios(content: RequirementContent, scenarios: dict[str, Scenario]) -> list[str]:
    """Bind a new requirement to the household's non-edge scenarios in which its preconditions can hold.
    Deterministic; an empty result is left empty so replay reports INCONCLUSIVE (never a silent PASS)."""
    return sorted(sid for sid, sc in scenarios.items() if not sc.edge_case and _state_hits(content, sc))


def _value_word(device: str, attr: str, value) -> str:
    if attr == "armed":
        return "armed" if value else "disarmed"
    if attr == "locked":
        return "locked" if value else "unlocked"
    return str(value).upper()


def human_title(content_like: dict, routines: dict[str, str]) -> str:
    b = content_like["expected_behavior"]
    dev, attr, val = b["device"], b["attr"], b["value"]
    lab = label(dev)
    if b["kind"] == "must_not_set":
        if attr == "power" and val == "off":
            core = f"Do not turn off the {lab.lower()}"
        elif attr == "power" and val == "on":
            core = f"Do not turn on the {lab.lower()}"
        else:
            core = f"Never set the {lab.lower()} to {_value_word(dev, attr, val)}"
    else:
        verb = "are" if lab.endswith("lights") else "is"
        core = f"{lab} {verb} {_value_word(dev, attr, val).lower()}"
        rids = content_like.get("scope", {}).get("routine_ids") or []
        if rids:
            core += f" after {routines.get(rids[0], rids[0])}"
    tails = []
    for c in content_like.get("preconditions", []):
        if c.get("op") in ("eq", "neq") and str(c.get("device", "")).endswith("_occupancy"):
            room = ROOM_NAMES.get(room_of(c["device"]) or "", c["device"]).split(" &")[0]
            occupied = (c["value"] is True) == (c["op"] == "eq")
            tails.append(f"while the {room.lower()} is {'occupied' if occupied else 'empty'}")
        elif c.get("op") == "time_between":
            tails.append(f"between {c['start']} and {c['end']}")
    return (core + (" " + " and ".join(tails) if tails else ""))[:140]


def draft_to_content(draft: "RequirementDraft", scenarios: dict[str, Scenario], routines: dict[str, str]) -> tuple[Optional[RequirementContent], list[dict]]:
    """Translate a Person 3C RequirementDraft into Person 2 RequirementContent. Returns (content|None, issues)."""
    issues: list[dict] = []
    e = draft.expected_behavior
    if e is None:
        return None, issues
    spec = CATALOG.get(e.device_id)
    caps = REQ_CAPS.get(spec["type"]) if spec else None
    if not spec or not caps or e.capability not in caps:
        issues.append({"code": "UNSUPPORTED_DEVICE", "path": "expected_behavior",
                       "message": f"'{e.device_id}.{e.capability}' cannot be a requirement target. {INTERPRETER_SCOPE_NOTE}"})
        return None, issues
    if e.comparator:
        issues.append({"code": "UNSUPPORTED_COMPARATOR", "path": "expected_behavior", "message": "threshold comparisons are not modeled"})
        return None, issues
    vals, attr, vmap = caps[e.capability]
    if e.value not in vmap:
        issues.append({"code": "INVALID_VALUE", "path": "expected_behavior.value", "message": f"{e.value!r} not in {vals}"})
        return None, issues
    pre: list[dict] = []
    for c in draft.preconditions:
        if c.signal == "time_of_day":
            continue
        pre += _cond_from_p3c(c, issues)
    win, w_issues = _time_window(draft.preconditions)
    issues += w_issues
    if win:
        pre.append(win)
    if issues:                         # an untranslatable condition would silently change the meaning -> no draft
        return None, issues
    scope = {"routine_ids": [draft.scope.id] if draft.scope.kind == "routine" and draft.scope.id else [],
             "devices": [e.device_id], "scenario_ids": []}
    body = {"source_correction": draft.source_correction, "scope": scope, "preconditions": pre,
            "expected_behavior": {"kind": "must_not_set" if e.relation == "must_not_set" else "final_state_equals",
                                  "device": e.device_id, "attr": attr, "value": vmap[e.value]},
            "ambiguities": [a.question for a in draft.ambiguities],
            "confidence": draft.provenance.heuristic_confidence,
            "interpreter": f"p3c_{draft.provenance.interpreter}"}
    body["title"] = human_title(body, routines)
    content = RequirementContent.model_validate(body)
    content.scope.scenario_ids = select_scenarios(content, scenarios)
    if not content.scope.scenario_ids:
        issues.append({"code": "NO_EXERCISING_SCENARIO", "path": "scope.scenario_ids",
                       "message": "no household scenario exercises these preconditions; a replay will report INCONCLUSIVE until one exists"})
    issues += validate_requirement(content)
    return content, issues


def _questions(draft: "RequirementDraft", cat: "Catalog") -> list[dict]:
    out = []
    for a in draft.ambiguities:
        opts = []
        for o in a.options:
            if o in CATALOG:
                opts.append({"value": o, "label": label(o)})
            elif o in ROOM_NAMES:
                opts.append({"value": o, "label": ROOM_NAMES[o]})
            else:
                opts.append({"value": o, "label": o})
        answer_key = {"device": "device_id", "room": "room", "routine": "routine_id"}.get(a.field)
        out.append({"field": a.field, "question": a.question, "reason": a.reason, "options": opts, "answer_key": answer_key})
    return out


def interpret(household_id: str, text: str, routines: list[Routine], scenarios: dict[str, Scenario],
              context: Optional[dict] = None, answers: Optional[dict] = None) -> dict:
    """Natural language -> Person 3C draft -> canonical RequirementContent proposal. Never stores, never confirms."""
    _need()
    cat = interpretation_catalog(household_id, routines)
    provider = llm_provider()
    answers = dict(answers or {})
    ctx = dict(context or {})
    if answers.get("device_id"):
        # A device answer is fed back as the interpreter's own `selected_device_id` context and the text is re-interpreted,
        # so the behaviour and occupancy room are derived for that device (P3C's merge cannot recover a skipped behaviour).
        ctx["selected_device_id"] = answers.pop("device_id")
    try:
        draft = _p3c_interpret(InterpretRequest(household_id=household_id, text=text, context=ctx), cat, provider)
        if answers:
            draft = _p3c_clarify(draft, answers, cat)
    except P3CError as e:
        raise ApiError(422 if e.http_status in (400, 422) else e.http_status, e.code, e.message,
                       [{"code": e.code, "path": "text", "message": e.message, **({"supported": INTERPRETER_SCOPE_NOTE} if e.code.startswith("UNSUPPORTED") else {})}])
    except ValueError as e:   # pydantic validation of the request
        raise ApiError(422, "INVALID_INPUT", "correction text is invalid", [{"code": "SCHEMA", "path": "text", "message": str(e)[:200]}])
    names = {r.routine_id: r.name for r in routines}
    content, issues = draft_to_content(draft, scenarios, names)
    questions = _questions(draft, cat)
    for i in issues:
        if i["code"] in ("UNSUPPORTED_CONDITION", "AMBIGUOUS_TIME", "UNSUPPORTED_DEVICE", "UNSUPPORTED_COMPARATOR"):
            questions.append({"field": "condition", "question": i["message"] + ". Rephrase with a supported condition (room occupancy or a clock time such as 'after 10 pm').",
                              "reason": i["code"], "options": [], "answer_key": None})
    return {
        "status": "PROPOSAL", "household_id": household_id, "source_correction": text,
        "interpreter": interpreter_status(),
        "provenance": draft.provenance.model_dump(mode="json"),
        "interpretation": draft.model_dump(mode="json"),
        "structured": content.model_dump(exclude_none=True) if content else None,
        "needs_clarification": bool(draft.ambiguities) or content is None,
        "can_create_draft": content is not None and not [i for i in issues if i["code"] not in ("NO_EXERCISING_SCENARIO",)],
        "questions": questions, "issues": issues,
        "note": "Proposal only. It becomes a DRAFT when saved and an enforced requirement only after explicit confirmation.",
    }


# ------------------------------------------------------------------------------------------------ repair translation
def _p2_cond_to_p3c(c: Condition) -> dict:
    if c.op == "time_between":
        return {"signal": "time_of_day", "op": ">=", "value": c.start}
    return {"signal": f"{c.device}.{c.attr}", "op": "==" if c.op == "eq" else "!=", "value": c.value}


def routine_to_p3c(r: Routine) -> dict:
    return {"routine_id": r.routine_id, "version": r.version,
            "conditions": [_p2_cond_to_p3c(c) for c in r.conditions],
            "actions": [{"action_id": a.action_id, "device_id": a.device, "capability": a.attr, "value": a.value,
                         "conditions": [_p2_cond_to_p3c(c) for c in a.conditions]} for a in r.actions]}


def p2_ops_to_p3c(ops: list[RepairOp], routine: Routine) -> list[dict]:
    idx = {a.action_id: i for i, a in enumerate(routine.actions)}
    out = []
    for i, op in enumerate(ops):
        if op.op == "add_action_condition" and op.action_id in idx and op.condition:
            out.append({"op": "add_action_condition", "index": idx[op.action_id], "condition": _p2_cond_to_p3c(op.condition)})
        elif op.op == "add_routine_condition" and op.condition:
            out.append({"op": "add_condition", "condition": _p2_cond_to_p3c(op.condition)})
        elif op.op == "remove_action" and op.action_id in idx:
            out.append({"op": "remove_action", "index": idx[op.action_id]})
        else:
            raise ApiError(422, "REPAIR_REJECTED_BY_VALIDATOR",
                           f"repair op {i} ('{op.op}') is outside the constrained repair allowlist or references an unknown action",
                           [{"code": "DISALLOWED_REPAIR_OPERATION", "path": f"repair[{i}]", "message": op.op}])
    return out


def validate_repair(household_id: str, routines: list[Routine], candidate: Routine, ops: list[RepairOp],
                    failed_requirement_id: str, evidence_event_ids: list[str]) -> dict:
    """Run the Person 3C constrained-repair validator on a Person 2 repair (translated). Raises ApiError on rejection."""
    _need()
    try:
        return _p3c_propose_repair(household_id=household_id, failed_requirement_id=failed_requirement_id,
                                   routine_id=candidate.routine_id, routine_version=candidate.version,
                                   baseline_routine=routine_to_p3c(candidate), trace_event_ids=evidence_event_ids or ["none"],
                                   operations=p2_ops_to_p3c(ops, candidate), catalog=repair_catalog(household_id, routines))
    except P3CError as e:
        raise ApiError(422, "REPAIR_REJECTED_BY_VALIDATOR", e.message, [{"code": e.code, "path": "repair", "message": e.message}])


def _cond_text(c: Condition) -> str:
    if c.op == "time_between":
        return f"time between {c.start} and {c.end}"
    if str(c.device).endswith("_occupancy"):
        room = ROOM_NAMES.get(room_of(c.device) or "", c.device).split(" &")[0].lower()
        occ = (c.value is True) == (c.op == "eq")
        return f"the {room} is {'occupied' if occ else 'empty'}"
    return f"{label(c.device).lower()} {c.attr} {'is' if c.op == 'eq' else 'is not'} {c.value}"


def explain_repair(failing_tests: list[dict], candidate: Routine, ops: list[RepairOp]) -> str:
    """Deterministic, trace-grounded explanation (template text, not generated by a model)."""
    parts = []
    for t in failing_tests[:3]:
        ev = next((e for e in t.get("trace", []) if e["event_id"] in t.get("evidence_event_ids", [])), None)
        if ev:
            parts.append(f"In scenario {t['scenario_id']}, action {ev.get('action_id')} of {ev.get('routine_id')} v{ev.get('routine_version')} "
                         f"set {label(ev['device']).lower()} {ev['attr']} {ev.get('previous')!r} -> {ev.get('resulting')!r} at {ev['sim_time']} "
                         f"(event {ev['event_id']}), violating {t['requirement_id']} v{t['requirement_version']}.")
        else:
            parts.append(f"{t['requirement_id']} failed in {t['scenario_id']}: {t.get('reason')}.")
    acts = {a.action_id: a for a in candidate.actions}
    for op in ops:
        if op.op == "add_action_condition" and op.action_id in acts:
            parts.append(f"The proposal restores the condition \"only when {_cond_text(op.condition)}\" on action {op.action_id} "
                         f"({label(acts[op.action_id].device).lower()} -> {acts[op.action_id].value!r}), which the baseline routine had, "
                         f"so that action is skipped in the failing situation.")
        elif op.op == "add_routine_condition":
            parts.append(f"The proposal restores the routine-level condition \"{_cond_text(op.condition)}\".")
        elif op.op == "remove_action" and op.action_id in acts:
            parts.append(f"The proposal removes action {op.action_id} ({label(acts[op.action_id].device).lower()}).")
    parts.append("This is a proposal: it is NOT verified until the regression suite is re-run on the new candidate, and only a person can approve it.")
    return " ".join(parts)
