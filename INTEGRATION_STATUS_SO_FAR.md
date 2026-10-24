> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# SWITCH integration status — partial delivery (23 Oct 2026)

This ZIP is a **checkpoint**, not a finished full integration. Original source ZIP was not overwritten.

## What was already in the handoff

- Person 1 frontend: 7 pages, 3D villa, local simulator, day/night, animations.
- Person 2 FastAPI backend under `switch_backend/` with deterministic simulator, assertions, fixtures, tests.
- Devices / Integrations page already probes `/health` and lists routines, requirements, candidates.
- No Person C implementation was in the source ZIP. None was invented.

## What this checkpoint added

1. `src/api/switchBackend.js` — expanded client: drafts, confirm, patch, candidates, diff, suggest-fix, approve, replays, report, verify, scenarios, catalog, demo reset, timeouts, structured errors.
2. `src/api/backendBridge.js` — maps Person 2 payloads into UI-shaped requirement and replay records. Device id map (`hallway_light` → `hallwayLight`, etc.). Does **not** invent PASS/FAIL.
3. `src/pages/RequirementsPage.jsx` — additive panel: load requirements from backend, create a draft via `POST /requirements/drafts`. Local browser library is unchanged and still session-only.
4. `src/pages/ReplayLabPage.jsx` — additive panel: check connection, `POST /replays` against `cand-demo-faulty` (or another candidate), show backend verdict, totals, routine diff, per-test reason and violating event, suggest repair, re-run, approve/reject. Local Run Replay is unchanged. FAIL highlight sets room/device when the mapped id exists.

## Tests actually run in this environment

| Suite | Result |
|---|---|
| `switch_backend` pytest (earlier in this session) | all passed |
| `node tests/sim.test.mjs` | 20 passed |
| `node tests/app.test.mjs` | 20 passed |
| `node tests/geometry.test.mjs` | not re-run successfully here (incomplete `three` install in the sandbox node_modules) |
| Frontend production build | not re-run in this checkpoint |
| Browser e2e | not re-run |

Backend hallway fixture (verified via TestClient earlier): `cand-demo-faulty` + occupancy true returns overall **FAIL** on `req-hallway-occupied` because `hallway_light.power` was set to `off` (violating event in the trace). Unknown occupancy scenario exists as `sc-hallway-unknown` and is INCONCLUSIVE, not PASS.

## Not done yet

- Local simulator is still the source for the 3D house timeline and local Replay Lab results. Backend results are shown beside it, not as a full replacement of local replay state.
- Saved Requirements edit / disable / retire still go through the local store, not PATCH on the backend.
- 3D device power is not driven frame-by-frame from the backend trace (only room/device highlight on FAIL).
- Reports page is still local-run based.
- Person C / Alexa+ not present. Do not claim live Alexa.
- No claim that a modeled PASS guarantees a physical home.

## How to try the new panels (Windows)

Terminal 1:
```
cd switch_backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest
python -m app
```

Terminal 2 (project root):
```
npm ci
npm run dev
```

Open Saved Requirements → **Load from backend**. Open Replay Lab → **Run on backend** (candidate `cand-demo-faulty`). Expect FAIL from the API, not a hardcoded label.
