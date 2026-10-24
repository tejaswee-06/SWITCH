"""Record real API payloads for the canonical journey into tests/fixtures/backend_journey.json.

The frontend mapping tests (tests/canonical.test.mjs) consume this file, so the browser view-model mapping is tested
against actual Person 2 responses, not hand-written guesses. Re-run after any backend schema change:

    python switch_backend/scripts/record_fixtures.py
"""
import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "switch_backend"))
from fastapi.testclient import TestClient  # noqa: E402
from app.main import create_app  # noqa: E402

O = {"Authorization": "Bearer demo-owner-token"}
M = {"Authorization": "Bearer demo-member-token"}
HALL = "Don't turn off the hallway light while someone is there."


def ok(r, code=200):
    assert r.status_code == code, (r.status_code, r.text[:500])
    return r.json()


def main():
    c = TestClient(create_app(":memory:", profile="journey"))
    out = {"note": "Recorded from the real backend (journey profile). Timestamps and generated ids vary per recording."}
    out["health"] = ok(c.get("/health"))
    out["routines"] = ok(c.get("/routines", headers=O))
    out["scenarios"] = ok(c.get("/scenarios", headers=O))
    out["requirements_initial"] = ok(c.get("/requirements", headers=O))
    out["candidates_initial"] = ok(c.get("/candidates", headers=O))
    out["interpret_ambiguous"] = ok(c.post("/requirements/interpret", headers=M, json={"text": "Don't turn off the light while someone is there"}))
    out["interpret_hallway"] = ok(c.post("/requirements/interpret", headers=M, json={"text": HALL}))
    d = ok(c.post("/requirements/drafts", headers=M, json={"source_correction": HALL, "structured": out["interpret_hallway"]["structured"]}), 201)
    out["draft"] = d
    out["confirmed"] = ok(c.post(f"/requirements/{d['requirement_id']}/confirm", headers=O, json={"version": 1}))
    run1 = ok(c.post("/replays", headers=M, json={"candidate_id": "cand-demo-faulty", "via": "web_ui"}), 201)
    out["report_fail"] = ok(c.get(f"/replays/{run1['run_id']}/report", headers=O))
    fix = ok(c.post("/candidates/cand-demo-faulty/suggest-fix", headers=M, json={}), 201)
    out["fix_candidate"] = fix
    run2 = ok(c.post("/replays", headers=M, json={"candidate_id": fix["candidate_id"], "via": "web_ui"}), 201)
    ok(c.post(f"/candidates/{fix['candidate_id']}/review", headers=O, json={"decision": "approve", "note": "guard restored"}))
    out["report_pass"] = ok(c.get(f"/replays/{run2['run_id']}/report", headers=O))
    ex = ok(c.post("/replays", headers=M, json={"candidate_id": fix["candidate_id"], "extra_scenario_ids": ["sc-hallway-sensor-offline"]}), 201)
    out["report_exploratory"] = ok(c.get(f"/replays/{ex['run_id']}/report", headers=O))
    out["requirements_final"] = ok(c.get("/requirements", headers=O))
    out["candidates_final"] = ok(c.get("/candidates", headers=O))
    out["versions"] = ok(c.get(f"/requirements/{d['requirement_id']}/versions", headers=O))
    out["alexa_status"] = ok(c.get("/integrations/alexa/status", headers=O))
    dest = ROOT / "tests" / "fixtures" / "backend_journey.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=1, default=str))
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
