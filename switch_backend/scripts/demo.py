"""End-to-end demo against a RUNNING server (SIMULATED DEMO). Usage: python scripts/demo.py [base_url]"""
import sys, httpx
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
OWNER = {"Authorization": "Bearer demo-owner-token"}
MEMBER = {"Authorization": "Bearer demo-member-token"}
c = httpx.Client(base_url=BASE, timeout=10)

def step(n, title): print(f"\n=== Step {n}: {title}")
def call(m, path, h, **kw):
    r = c.request(m, path, headers=h, **kw)
    assert r.status_code < 300, f"{m} {path} -> {r.status_code} {r.text}"
    return r.json()

print("ENVIRONMENT:", call("GET", "/health", {})["environment"])
call("POST", "/demo/reset", OWNER, json={"profile": "regression"})   # this script narrates the original fixture set
step(1, "Saved expectation")
rq = call("GET", "/requirements/req-hallway-occupied", MEMBER)
print(f"{rq['requirement_id']} v{rq['version']} [{rq['status']}] confirmed by {rq['confirmation']['by']}\n  IF {rq['preconditions'][0]['device']}.{rq['preconditions'][0]['attr']} == True THEN {rq['expected_behavior']['device']}.{rq['expected_behavior']['attr']} must not be set to {rq['expected_behavior']['value']!r}")
step(2, "Routine change (baseline v1 -> candidate v2)")
for ch in call("GET", "/candidates/cand-demo-faulty/diff", MEMBER)["changes"]: print(" -", ch["summary"])
step(3, "Run replay"); r1 = call("POST", "/replays", MEMBER, json={"candidate_id": "cand-demo-faulty"})
step(4, "Failure evidence"); print("suite:", r1["suite"]["overall"], r1["suite"]["totals"])
for t in r1["suite"]["tests"]:
    print(f"  {t['status']:<12} {t['requirement_id']}  {t['reason']}")
    if t["status"] == "FAIL":
        ev = {e["event_id"]: e for e in t["trace"]}[t["evidence_event_ids"][0]]
        print(f"    evidence {ev['event_id']} @{ev['sim_time']} {ev['routine_id']} v{ev['routine_version']}: {ev['device']}.{ev['attr']} {ev['previous']} -> {ev['resulting']} (occupancy was {ev['state_before']['hallway_occupancy']['occupied']})")
step(5, "Suggest repair (isolated candidate, NOT yet verified)")
fix = call("POST", "/candidates/cand-demo-faulty/suggest-fix", MEMBER, json={})
print(" candidate", fix["candidate_id"], "verified =", fix["verified"]); [print("  -", x["summary"]) for x in fix["routine_diff_vs_parent"]]
step(6, "Re-run same scenario + step 7 regression suite"); r2 = call("POST", "/replays", MEMBER, json={"candidate_id": fix["candidate_id"]})
for t in r2["suite"]["tests"]: print(f"  {t['status']:<12} {t['requirement_id']} @ {t['scenario_id']}")
print(" suite:", r2["suite"]["overall"], "| fixed:", [x["requirement_id"] for x in r2["comparison_to_previous_run"]["fixed"]], "| newly failing:", r2["comparison_to_previous_run"]["newly_failing"])
step(8, "Report"); rep = call("GET", f"/replays/{r2['run_id']}/report", MEMBER)
print(" run", rep["run_id"], "| fingerprint", rep["reproducibility"]["input_fingerprint"][:16], "| simulator", rep["simulator_version"], "| req versions", rep["reproducibility"]["requirement_versions"])
step(9, "Human approval")
mem = c.post(f"/candidates/{fix['candidate_id']}/approve", headers=MEMBER, json={"decision": "approve"}); print(" member approve ->", mem.status_code, mem.json()["error"]["code"])
print(" owner approve  ->", call("POST", f"/candidates/{fix['candidate_id']}/approve", OWNER, json={"decision": "approve", "note": "demo"}))
step(10, "Reproduce the stored run from its pinned versions (read-only)")
v = call("GET", f"/replays/{r2['run_id']}/verify", MEMBER)
print(" reproduced =", v["reproduced"], "| pinned routines", v["pinned"]["routines"], "| requirements", v["pinned"]["requirements"])
