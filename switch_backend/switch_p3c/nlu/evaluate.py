"""Correction-interpretation metrics against a labelled JSONL set."""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path

from pydantic import ValidationError
from ..contracts import InterpretRequest, P3CError
from .catalog import demo_catalog
from .interpreter import interpret

FIELDS = ["device", "room", "routine", "condition", "time", "expected", "scope"]


def _pred_fields(d) -> dict:
    e = d.expected_behavior
    return {"device": e.device_id if e else (d.scope.id if d.scope.kind == "device" else None),
            "room": d.room, "routine": d.scope.id if d.scope.kind == "routine" else None,
            "condition": sorted([[c.signal, c.op, c.value] for c in d.preconditions if c.signal != "time_of_day"]),
            "time": sorted([[c.signal, c.op, c.value] for c in d.preconditions if c.signal == "time_of_day"]),
            "expected": [e.relation, e.capability, e.value, e.comparator] if e else None, "scope": d.scope.kind}


def load(path) -> list[dict]:
    return [json.loads(l) for l in Path(path).read_text().splitlines() if l.strip()]


def evaluate(rows: list[dict], provider=None) -> dict:
    cat = demo_catalog()
    tp, fp, fn = defaultdict(int), defaultdict(int), defaultdict(int)
    n_clean = exact = 0
    dec_ok = dec_n = 0
    amb_exact = amb_n = 0
    schema_valid = produced = 0
    unsup_n = unsup_ok = unsup_code_ok = 0
    errors = []
    for r in rows:
        g = r["gold"]
        try:
            d = interpret(InterpretRequest(household_id="hh_demo", text=r["text"], context=r["context"]), cat, provider)
            pred_dec = "needs_clarification" if d.needs_clarification else "draft_ready"
            produced += 1
            schema_valid += 1  # RequirementDraft construction validates the schema (extra=forbid)
            code = None
        except P3CError as e:
            d, pred_dec, code = None, "rejected", e.code
        except ValidationError:  # request-schema rejection (e.g. blank text) == INVALID_INPUT at the API layer
            d, pred_dec, code = None, "rejected", "INVALID_INPUT"
        dec_n += 1
        dec_ok += pred_dec == g["decision"]
        if g["decision"] != pred_dec:
            errors.append({"id": r["id"], "text": r["text"], "gold_decision": g["decision"], "pred_decision": pred_dec, "error_code": code,
                           "pred_title": d.title if d else None})
        if g["decision"] == "rejected":
            unsup_n += 1
            unsup_ok += pred_dec == "rejected"
            unsup_code_ok += code == g["error_code"]
            if pred_dec == "rejected" and code != g["error_code"]:
                errors.append({"id": r["id"], "text": r["text"], "gold_error": g["error_code"], "pred_error": code})
        elif g["decision"] == "needs_clarification":
            amb_n += 1
            if d is not None:
                got = sorted({a.field for a in d.ambiguities})
                amb_exact += got == g["ambiguous"]
                if got != g["ambiguous"]:
                    errors.append({"id": r["id"], "text": r["text"], "gold_ambiguous": g["ambiguous"], "pred_ambiguous": got})
        else:  # clean case: field-level scoring
            n_clean += 1
            pf = _pred_fields(d) if d is not None and pred_dec == "draft_ready" else {k: None for k in FIELDS}
            gf = {k: g["conditions" if k == "condition" else k] for k in FIELDS}
            ok_all = True
            for k in FIELDS:
                gv, pv = gf[k], pf[k]
                g_present = gv not in (None, [], "")
                p_present = pv not in (None, [], "")
                if g_present and p_present and gv == pv:
                    tp[k] += 1
                elif not g_present and not p_present:
                    continue  # correctly empty
                else:
                    ok_all = False
                    if p_present:
                        fp[k] += 1
                    if g_present:
                        fn[k] += 1
                    errors.append({"id": r["id"], "text": r["text"], "field": k, "gold": gv, "pred": pv})
            exact += ok_all
    def prf(k):
        p = tp[k] / (tp[k] + fp[k]) if tp[k] + fp[k] else None
        rc = tp[k] / (tp[k] + fn[k]) if tp[k] + fn[k] else None
        f1 = 2 * p * rc / (p + rc) if p and rc else (0.0 if p is not None and rc is not None else None)
        return {"precision": p, "recall": rc, "f1": f1, "tp": tp[k], "fp": fp[k], "fn": fn[k]}
    return {"n_cases": len(rows), "n_clean": n_clean, "n_needs_clarification": amb_n, "n_should_reject": unsup_n,
            "decision_accuracy": dec_ok / dec_n, "exact_structured_match_rate_clean": exact / n_clean if n_clean else None,
            "per_field": {k: prf(k) for k in FIELDS},
            "clarification_ambiguity_field_exact": amb_exact / amb_n if amb_n else None,
            "schema_valid_output_rate": schema_valid / produced if produced else None,
            "unsupported_rejection_rate": unsup_ok / unsup_n if unsup_n else None,
            "unsupported_error_code_exact": unsup_code_ok / unsup_n if unsup_n else None, "errors": errors}


if __name__ == "__main__":
    import sys
    m = evaluate(load(sys.argv[1]))
    show = {k: v for k, v in m.items() if k != "errors"}
    print(json.dumps(show, indent=2)); print("n_errors:", len(m["errors"]))
    if len(sys.argv) > 2:
        for e in m["errors"]:
            print(e)
