"""Semantic validation. Every issue: {code, path, message}. Never raises on bad
user data; callers decide how to surface the list."""
import re
from typing import Any
from .catalog import (CATALOG, SUPPORTED_CONDITION_OPS, SUPPORTED_TRIGGER_TYPES,
                      SUPPORTED_BEHAVIOR_KINDS, EVENT_KINDS)
from .schemas import Routine, Scenario, RequirementContent, Condition

_ID = re.compile(r"^[a-z0-9][a-z0-9_\-]*$")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def issue(code: str, path: str, message: str) -> dict:
    return {"code": code, "path": path, "message": message}


def hhmm_to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def min_to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _check_device_attr(device, attr, path, issues, writable=False):
    if device not in CATALOG:
        issues.append(issue("UNKNOWN_DEVICE", path, f"unknown device '{device}'"))
        return False
    if attr not in CATALOG[device]["attrs"]:
        issues.append(issue("UNKNOWN_ATTRIBUTE", path, f"device '{device}' has no attribute '{attr}'"))
        return False
    if writable and CATALOG[device]["read_only"]:
        issues.append(issue("CAPABILITY_UNSUPPORTED", path,
                            f"device '{device}' is read-only (sensor); it cannot be the target of an action"))
        return False
    return True


def _check_value(device, attr, value, path, issues):
    allowed = CATALOG[device]["attrs"][attr]
    if not any(type(value) is type(a) and value == a for a in allowed):
        issues.append(issue("INVALID_VALUE", path, f"value {value!r} not allowed for {device}.{attr}; allowed: {allowed}"))


def validate_condition(c: Condition, path: str) -> list[dict]:
    out: list[dict] = []
    if c.op not in SUPPORTED_CONDITION_OPS:
        return [issue("UNSUPPORTED_CONDITION", path, f"unsupported condition operator '{c.op}'; supported: {list(SUPPORTED_CONDITION_OPS)}")]
    if c.op == "time_between":
        for f in ("start", "end"):
            v = getattr(c, f)
            if v is None or not _HHMM.match(v):
                out.append(issue("INVALID_TIME", f"{path}.{f}", "time_between needs HH:MM start and end"))
    else:
        if c.device is None or c.attr is None:
            return [issue("INVALID_CONDITION", path, f"'{c.op}' needs device and attr")]
        if _check_device_attr(c.device, c.attr, path, out):
            _check_value(c.device, c.attr, c.value, f"{path}.value", out)
    return out


def validate_routine(r: Routine) -> list[dict]:
    out: list[dict] = []
    if not _ID.match(r.routine_id):
        out.append(issue("INVALID_ID", "routine_id", "routine_id must match [a-z0-9][a-z0-9_-]*"))
    if r.version < 1:
        out.append(issue("INVALID_VERSION", "version", "version must be >= 1"))
    if not r.triggers:
        out.append(issue("NO_TRIGGER", "triggers", "at least one trigger is required"))
    if not r.actions:
        out.append(issue("NO_ACTION", "actions", "at least one action is required"))
    for i, t in enumerate(r.triggers):
        p = f"triggers[{i}]"
        if t.type not in SUPPORTED_TRIGGER_TYPES:
            out.append(issue("UNSUPPORTED_TRIGGER", p, f"unsupported trigger type '{t.type}'"))
        elif t.type == "event" and not t.name:
            out.append(issue("INVALID_TRIGGER", p, "event trigger needs 'name'"))
        elif t.type == "time" and (t.at is None or not _HHMM.match(t.at)):
            out.append(issue("INVALID_TIME", p, "time trigger needs HH:MM 'at'"))
        elif t.type == "state":
            if t.device and t.attr and _check_device_attr(t.device, t.attr, p, out):
                _check_value(t.device, t.attr, t.value, p, out)
            elif not (t.device and t.attr):
                out.append(issue("INVALID_TRIGGER", p, "state trigger needs device, attr, value"))
    for i, c in enumerate(r.conditions):
        out += validate_condition(c, f"conditions[{i}]")
    seen = set()
    for i, a in enumerate(r.actions):
        p = f"actions[{i}]"
        if not a.action_id or a.action_id in seen:
            out.append(issue("DUPLICATE_ACTION_ID", p, f"action_id '{a.action_id}' is empty or duplicated"))
        seen.add(a.action_id)
        if _check_device_attr(a.device, a.attr, p, out, writable=True):
            _check_value(a.device, a.attr, a.value, f"{p}.value", out)
        for j, c in enumerate(a.conditions):
            out += validate_condition(c, f"{p}.conditions[{j}]")
    return out


def validate_scenario(s: Scenario) -> list[dict]:
    out: list[dict] = []
    if not _ID.match(s.scenario_id):
        out.append(issue("INVALID_ID", "scenario_id", "scenario_id must match [a-z0-9][a-z0-9_-]*"))
    for f in ("start", "end"):
        if not _HHMM.match(getattr(s, f)):
            out.append(issue("INVALID_TIME", f, "HH:MM required"))
    if out:
        return out
    lo, hi = hhmm_to_min(s.start), hhmm_to_min(s.end)
    if lo > hi:
        out.append(issue("INVALID_TIME", "start", "start must be <= end (scenarios do not cross midnight)"))
    for dev, attrs in s.initial_state.items():
        for attr, val in attrs.items():
            if _check_device_attr(dev, attr, f"initial_state.{dev}.{attr}", out) and val is not None:
                _check_value(dev, attr, val, f"initial_state.{dev}.{attr}", out)
    ids = set()
    for i, e in enumerate(s.events):
        p = f"events[{i}]"
        if e.event_id in ids:
            out.append(issue("DUPLICATE_EVENT_ID", p, f"duplicate event_id {e.event_id}"))
        ids.add(e.event_id)
        if e.kind not in EVENT_KINDS:
            out.append(issue("UNSUPPORTED_EVENT", p, f"unsupported event kind '{e.kind}'"))
            continue
        if not _HHMM.match(e.at):
            out.append(issue("INVALID_TIME", p, "HH:MM required")); continue
        if not (lo <= hhmm_to_min(e.at) <= hi):
            out.append(issue("EVENT_OUT_OF_RANGE", p, "event outside scenario start/end"))
        if e.kind == "fire" and not e.name:
            out.append(issue("INVALID_EVENT", p, "fire event needs name"))
        if e.kind == "set":
            if e.device and e.attr and _check_device_attr(e.device, e.attr, p, out):
                if e.value is not None:       # null == sensor reports unknown
                    _check_value(e.device, e.attr, e.value, p, out)
            else:
                out.append(issue("INVALID_EVENT", p, "set event needs device, attr, value"))
    return out


def validate_requirement(c: RequirementContent) -> list[dict]:
    out: list[dict] = []
    if not c.title.strip() or not c.source_correction.strip():
        out.append(issue("INVALID_REQUIREMENT", "title", "title and source_correction are required"))
    b = c.expected_behavior
    if b.kind not in SUPPORTED_BEHAVIOR_KINDS:
        out.append(issue("UNSUPPORTED_BEHAVIOR", "expected_behavior.kind",
                         f"unsupported kind '{b.kind}'; supported: {list(SUPPORTED_BEHAVIOR_KINDS)}"))
    elif _check_device_attr(b.device, b.attr, "expected_behavior", out):
        _check_value(b.device, b.attr, b.value, "expected_behavior.value", out)
    for i, p in enumerate(c.preconditions):
        out += validate_condition(p, f"preconditions[{i}]")
    for d in c.scope.devices:
        if d not in CATALOG:
            out.append(issue("UNKNOWN_DEVICE", "scope.devices", f"unknown device '{d}'"))
    if c.confidence is not None and not (0.0 <= c.confidence <= 1.0):
        out.append(issue("INVALID_CONFIDENCE", "confidence", "confidence must be within [0,1]"))
    return out
