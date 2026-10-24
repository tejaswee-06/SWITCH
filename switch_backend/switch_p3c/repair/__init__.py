"""Constrained, non-mutating repair proposals. Proposals are never deployments."""
from __future__ import annotations
from copy import deepcopy
from typing import Any
from ..contracts import P3CError, new_id
from ..nlu.catalog import Catalog

ALLOWED_OPS = {"add_condition", "modify_condition", "remove_action", "change_action_value", "add_action_condition"}
# add_action_condition: append a condition to ONE existing action (e.g. restore an occupancy guard). Added so the
# canonical Person 2 repair op of the same name can be validated here without loss of meaning.

def _validate_action(action: dict, catalog: Catalog) -> None:
    did = action.get("device_id") or action.get("target_device")
    cap = action.get("capability") or action.get("attribute")
    if did not in catalog.devices:
        raise P3CError("UNKNOWN_DEVICE", f"unknown device: {did}", {"device_id": did}, 422)
    if cap not in catalog.devices[did].capabilities:
        raise P3CError("UNSUPPORTED_CAPABILITY", f"unsupported capability {cap} for {did}", {"device_id": did, "capability": cap}, 422)
    value = action.get("value", action.get("to"))
    if value is not None and not catalog.valid_value(did, cap, value):
        raise P3CError("INVALID_VALUE", f"invalid value for {did}.{cap}", {"value": value}, 422)

def propose_repair(*, household_id: str, failed_requirement_id: str, routine_id: str, routine_version: int,
                   baseline_routine: dict, trace_event_ids: list[str], operations: list[dict], catalog: Catalog) -> dict:
    if household_id != catalog.household_id:
        raise P3CError("HOUSEHOLD_SCOPE_ERROR", "household mismatch", {}, 403)
    if not failed_requirement_id or not routine_id or routine_version < 1:
        raise P3CError("INVALID_REPAIR_CONTEXT", "requirement, routine and positive version are required", {}, 422)
    if not trace_event_ids or any(not isinstance(x, str) or not x for x in trace_event_ids):
        raise P3CError("EVIDENCE_REQUIRED", "trace event IDs are required", {}, 422)
    if not operations:
        raise P3CError("EMPTY_REPAIR", "at least one operation is required", {}, 422)
    before = deepcopy(baseline_routine)
    after = deepcopy(baseline_routine)
    actions = after.setdefault("actions", [])
    conditions = after.setdefault("conditions", [])
    diff = []
    for i, op in enumerate(operations):
        if not isinstance(op, dict) or op.get("op") not in ALLOWED_OPS:
            raise P3CError("DISALLOWED_REPAIR_OPERATION", "operation is not in the allowlist", {"allowed": sorted(ALLOWED_OPS), "index": i}, 422)
        kind = op["op"]
        if kind in ("add_condition", "modify_condition"):
            cond = deepcopy(op.get("condition", {}))
            signal = cond.get("signal")
            if not signal or not catalog.valid_signal(signal):
                raise P3CError("UNKNOWN_SIGNAL", "condition signal is not in catalog", {"signal": signal}, 422)
            if kind == "add_condition":
                conditions.append(cond)
                diff.append({"op": kind, "before": None, "after": deepcopy(cond)})
            else:
                idx = op.get("index")
                if not isinstance(idx, int) or idx < 0 or idx >= len(conditions):
                    raise P3CError("INVALID_INDEX", "condition index out of range", {"index": idx}, 422)
                old = deepcopy(conditions[idx]); conditions[idx] = cond
                diff.append({"op": kind, "index": idx, "before": old, "after": deepcopy(cond)})
        elif kind == "add_action_condition":
            idx = op.get("index")
            if not isinstance(idx, int) or idx < 0 or idx >= len(actions):
                raise P3CError("INVALID_INDEX", "action index out of range", {"index": idx}, 422)
            _validate_action(actions[idx], catalog)
            cond = deepcopy(op.get("condition", {}))
            signal = cond.get("signal")
            if not signal or not catalog.valid_signal(signal):
                raise P3CError("UNKNOWN_SIGNAL", "condition signal is not in catalog", {"signal": signal}, 422)
            old = deepcopy(actions[idx])
            actions[idx].setdefault("conditions", []).append(cond)
            diff.append({"op": kind, "index": idx, "before": old, "after": deepcopy(actions[idx])})
        elif kind == "remove_action":
            idx = op.get("index")
            if not isinstance(idx, int) or idx < 0 or idx >= len(actions):
                raise P3CError("INVALID_INDEX", "action index out of range", {"index": idx}, 422)
            old = deepcopy(actions.pop(idx))
            _validate_action(old, catalog)
            diff.append({"op": kind, "index": idx, "before": old, "after": None})
        elif kind == "change_action_value":
            idx = op.get("index")
            if not isinstance(idx, int) or idx < 0 or idx >= len(actions):
                raise P3CError("INVALID_INDEX", "action index out of range", {"index": idx}, 422)
            old = deepcopy(actions[idx]); _validate_action(old, catalog)
            new_value = op.get("value")
            did = old.get("device_id") or old.get("target_device")
            cap = old.get("capability") or old.get("attribute")
            if not catalog.valid_value(did, cap, new_value):
                raise P3CError("INVALID_VALUE", "proposed value is not allowed by catalog", {"device_id": did, "capability": cap, "value": new_value}, 422)
            actions[idx]["value"] = new_value
            diff.append({"op": kind, "index": idx, "before": old, "after": deepcopy(actions[idx])})
    return {"proposal_id": new_id("repair"), "household_id": household_id, "failed_requirement_id": failed_requirement_id,
            "routine_id": routine_id, "routine_version": routine_version, "trace_event_ids": list(trace_event_ids),
            "operation_count": len(diff), "diff": diff, "before": before, "after": after,
            "status": "NEEDS_HUMAN_REVIEW", "verified": False, "deployed": False,
            "note": "PROPOSAL ONLY. Baseline was not mutated. Person 2 deterministic replay and human review are required."}
