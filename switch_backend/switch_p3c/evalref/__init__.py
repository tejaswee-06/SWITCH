"""Replay reference stand-in. NOT Person 2's evaluator; contract assumptions are PROPOSED."""
from __future__ import annotations
import os, json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from ..contracts import P3CError

STATUS = {"mode": "SIMULATED", "name": "Person3C replay stand-in", "not_person2_evaluator": True,
          "warning": "This is a small reference stand-in, NOT Person 2's deterministic evaluator."}

def replay(scenario: dict) -> dict:
    """Evaluate simple explicit assertions against a state map; unknown/missing state is INCONCLUSIVE."""
    state = scenario.get("state")
    assertions = scenario.get("assertions")
    if not isinstance(state, dict) or not isinstance(assertions, list) or not assertions:
        return {"result": "INCONCLUSIVE", "reason": "missing state or assertions", "evidence": [], **STATUS}
    ev=[]; unknown=[]; failures=[]
    for a in assertions:
        if not isinstance(a, dict) or not a.get("device_id") or not a.get("capability") or "expected" not in a:
            unknown.append({"assertion": a, "reason": "malformed assertion"}); continue
        key=f"{a['device_id']}.{a['capability']}"
        if key not in state or state[key] is None or state[key] == "UNKNOWN":
            unknown.append({"key": key, "reason": "state missing or unknown"}); continue
        actual=state[key]; ok=actual == a["expected"]
        entry={"trace_event_id": a.get("trace_event_id"), "key": key, "expected": a["expected"], "actual": actual, "matches": ok}
        ev.append(entry)
        if not ok: failures.append(entry)
    result = "INCONCLUSIVE" if unknown else ("FAIL" if failures else "PASS")
    return {"result": result, "reason": "unknown evidence present" if unknown else ("assertion mismatch" if failures else "all supplied assertions matched"),
            "evidence": ev, "unknown": unknown, **STATUS}

class Person2Client:
    """HTTP client for PROPOSED routes only. Does not assert these routes exist on Person 2."""
    PROPOSED_ROUTES={"replay":"POST /api/v1/replay", "requirements":"GET /api/v1/requirements", "routines":"GET /api/v1/routines"}
    def __init__(self, base_url: str | None=None, timeout: float=5.0, token: str | None=None):
        self.base_url=(base_url or os.getenv("SWITCH_CORE_API_URL", "")).rstrip("/")
        self.timeout=timeout
        self.token=token or os.getenv("SWITCH_CORE_API_TOKEN", "")
    def request(self, method: str, path: str, payload: dict | None=None):
        if not self.base_url: raise P3CError("CORE_API_NOT_CONFIGURED", "SWITCH_CORE_API_URL is not configured", {"routes_status":"PROPOSED"}, 503)
        headers={"Accept":"application/json"}
        data=None
        if payload is not None: headers["Content-Type"]="application/json"; data=json.dumps(payload).encode()
        if self.token: headers["Authorization"]="Bearer "+self.token
        req=Request(self.base_url+path, data=data, headers=headers, method=method.upper())
        try:
            with urlopen(req, timeout=self.timeout) as r: return {"status_code":r.status,"data":json.loads(r.read().decode() or "{}")}
        except HTTPError as e: raise P3CError("CORE_API_HTTP_ERROR", f"Person 2 proposed route returned HTTP {e.code}", {"status_code":e.code}, 502)
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as e: raise P3CError("CORE_API_UNAVAILABLE", type(e).__name__, {}, 502)
    def replay(self, payload: dict): return self.request("POST", "/api/v1/replay", payload)
