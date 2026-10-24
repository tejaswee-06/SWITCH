"""Routine diff + constrained repair application. Pure functions."""
from .schemas import Routine, Condition, Action, RepairOp
from .simulator import canonical, cond_expr
from .catalog import SUPPORTED_REPAIR_OPS
from .validation import validate_routine, validate_condition


class RepairError(Exception):
    def __init__(self, issues): self.issues = issues; super().__init__("invalid repair")


def _c(c: Condition) -> str: return canonical(c.model_dump(exclude_none=True))


def _act_desc(a: Action) -> str: return f"{a.action_id} ({a.device}.{a.attr}={a.value!r})"


def _cond_changes(path, before, after, owner):
    b, a = {_c(x): x for x in before}, {_c(x): x for x in after}
    out = []
    for k, x in b.items():
        if k not in a:
            out.append({"path": path, "kind": "removed", "before": x.model_dump(exclude_none=True), "after": None,
                        "summary": f"Condition removed from {owner}: {cond_expr(x)}"})
    for k, x in a.items():
        if k not in b:
            out.append({"path": path, "kind": "added", "before": None, "after": x.model_dump(exclude_none=True),
                        "summary": f"Condition added to {owner}: {cond_expr(x)}"})
    return out


def diff_routines(base: Routine, cand: Routine) -> list[dict]:
    ch = []
    if base.version != cand.version:
        ch.append({"path": "version", "kind": "changed", "before": base.version, "after": cand.version,
                   "summary": f"Routine version {base.version} -> {cand.version}"})
    for f in ("name", "enabled", "priority"):
        if getattr(base, f) != getattr(cand, f):
            ch.append({"path": f, "kind": "changed", "before": getattr(base, f), "after": getattr(cand, f),
                       "summary": f"{f}: {getattr(base, f)!r} -> {getattr(cand, f)!r}"})
    bt = {canonical(t.model_dump(exclude_none=True)): t for t in base.triggers}
    ct = {canonical(t.model_dump(exclude_none=True)): t for t in cand.triggers}
    for k, t in bt.items():
        if k not in ct:
            ch.append({"path": "triggers", "kind": "removed", "before": t.model_dump(exclude_none=True), "after": None, "summary": f"Trigger removed: {k}"})
    for k, t in ct.items():
        if k not in bt:
            ch.append({"path": "triggers", "kind": "added", "before": None, "after": t.model_dump(exclude_none=True), "summary": f"Trigger added: {k}"})
    ch += _cond_changes("conditions", base.conditions, cand.conditions, "routine")
    ba, ca = {a.action_id: a for a in base.actions}, {a.action_id: a for a in cand.actions}
    for i, a in ba.items():
        if i not in ca:
            ch.append({"path": f"actions[{i}]", "kind": "removed", "before": a.model_dump(exclude_none=True), "after": None,
                       "summary": f"Action removed: {_act_desc(a)}"})
    for i, a in ca.items():
        if i not in ba:
            ch.append({"path": f"actions[{i}]", "kind": "added", "before": None, "after": a.model_dump(exclude_none=True),
                       "summary": f"Action added: {_act_desc(a)}"})
            continue
        b = ba[i]
        for f in ("device", "attr", "value"):
            if getattr(a, f) != getattr(b, f):
                ch.append({"path": f"actions[{i}].{f}", "kind": "changed", "before": getattr(b, f), "after": getattr(a, f),
                           "summary": f"Action {i} {f}: {getattr(b, f)!r} -> {getattr(a, f)!r}"})
        ch += _cond_changes(f"actions[{i}].conditions", b.conditions, a.conditions, f"action {_act_desc(a)}")
    return ch


def apply_repair(routine: Routine, ops: list[RepairOp], new_version: int) -> Routine:
    """Apply a constrained machine-readable diff to a COPY; validate the result."""
    r = routine.model_copy(deep=True)
    r.version = new_version
    issues = []
    for i, op in enumerate(ops):
        p = f"repair[{i}]"
        if op.op not in SUPPORTED_REPAIR_OPS:
            issues.append({"code": "UNSUPPORTED_REPAIR_OP", "path": p, "message": f"unsupported op '{op.op}'; supported: {list(SUPPORTED_REPAIR_OPS)}"}); continue
        tgt = next((a for a in r.actions if a.action_id == op.action_id), None) if op.action_id else None
        if op.op == "add_action_condition":
            if tgt is None or op.condition is None:
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "needs existing action_id and condition"}); continue
            issues += validate_condition(op.condition, p + ".condition")
            if any(_c(x) == _c(op.condition) for x in tgt.conditions):
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "condition already present (no-op repair)"}); continue
            tgt.conditions.append(op.condition)
        elif op.op == "add_routine_condition":
            if op.condition is None:
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "needs condition"}); continue
            issues += validate_condition(op.condition, p + ".condition")
            if any(_c(x) == _c(op.condition) for x in r.conditions):
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "condition already present (no-op repair)"}); continue
            r.conditions.append(op.condition)
        elif op.op == "remove_action":
            if tgt is None:
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "unknown action_id"}); continue
            r.actions.remove(tgt)
        elif op.op == "add_action":
            if op.action is None or any(a.action_id == op.action.action_id for a in r.actions):
                issues.append({"code": "INVALID_REPAIR", "path": p, "message": "needs a new action with unique action_id"}); continue
            r.actions.append(op.action)
    if not issues:
        issues = validate_routine(r)
    if issues:
        raise RepairError(issues)
    return r


def derive_restore_guard_ops(base: Routine, cand: Routine, devices: set[str]) -> list[RepairOp]:
    """Deterministic fallback repair: restore conditions that the baseline had on
    actions (or routine) touching the failing devices and the candidate lost."""
    ops: list[RepairOp] = []
    touched = {a.action_id for a in cand.actions if a.device in devices}
    if not touched:
        return ops
    have = {_c(c) for c in cand.conditions}
    for c in base.conditions:
        if _c(c) not in have:
            ops.append(RepairOp(op="add_routine_condition", condition=c))
    ba = {a.action_id: a for a in base.actions}
    for a in cand.actions:
        if a.action_id in touched and a.action_id in ba:
            have = {_c(c) for c in a.conditions}
            for c in ba[a.action_id].conditions:
                if _c(c) not in have:
                    ops.append(RepairOp(op="add_action_condition", action_id=a.action_id, condition=c))
    return ops
