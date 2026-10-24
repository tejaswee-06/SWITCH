> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# SWITCH Person A + Person B integration status

Date: 23 October 2026

## Preservation

- Person A's original seven-page frontend, 3D villa/model assets, simulator, styling, and store remain in place. Integration changes are additive around the existing application.
- Person B's FastAPI deterministic backend and its tests remain under `switch_backend/`.
- Person C / Alexa+ implementation was not supplied and has not been invented or integrated.
- Both layers are explicitly **SIMULATED DEMO**. No physical-device, Amazon account, or live Alexa connection is claimed.

## Integrated behavior

- The original browser simulator still runs and its existing Replay Lab controls remain available.
- A shared API client calls the Person B FastAPI backend at `VITE_SWITCH_API_URL` (default `http://127.0.0.1:8000`).
- Saved Requirements automatically checks the API and supports backend listing, draft creation, explicit confirmation, title edits (new version returns to DRAFT), disable, retire, and version/audit history. The original local requirement library remains available separately.
- Replay Lab automatically checks backend health, loads candidates, runs a backend replay, displays evaluator verdict/totals/diff/assertion reasons/violating events, proposes a deterministic repair, reruns the new candidate, and records approve/reject decisions through the API.
- Backend event trace can be scrubbed and used as the modeled state source for the existing 3D house. The local browser simulator remains available via the view toggle. This is a visualization of backend simulation data, not live device state.
- Reports includes backend run history and exports actual backend report JSON/Markdown separately from local session-only reports.
- Added `start-switch.bat` and `start-switch.ps1` to launch the backend and Vite frontend simultaneously on Windows.
- Corrected backend requirement response mapping (Person B returns requirement fields at the top level) and mapped UI approval/rejection actions to the API's `approve`/`reject` contract.

## Verification evidence

- `node tests/sim.test.mjs`: 20 passed.
- `node tests/app.test.mjs`: 20 passed.
- `python -m pytest -q switch_backend`: all tests passed (101 tests in this run).
- TypeScript parser syntax checks passed for modified JSX/JS files: `ReplayLabPage.jsx`, `RequirementsPage.jsx`, `ReportsPage.jsx`, `backendBridge.js`, `switchBackend.js`.
- API acceptance smoke test confirmed: faulty candidate returns FAIL; deterministic repair creates a new candidate; rerun returns PASS (3 PASS, 0 FAIL, 0 INCONCLUSIVE); backend report returns 200; approval is recorded without deployment.
- Full browser run and fresh production build were **not** verified in this workspace. `npm ci` could not complete because npm registry DNS/network requests failed (`EAI_AGAIN`). Install dependencies on a connected machine and run `npm ci`, `npm test`, and `npm run build` before relying on a fresh production build.

## Important limitations

- Local and backend runs are kept explicitly separate rather than silently merged into one database or state store. Backend trace scrubber can drive the house display, but it does not mutate the local simulator's underlying state.
- Backend requirement editing currently offers a title edit through the UI; richer scope/precondition/expected-behavior editing remains available through the documented API but is not yet exposed as a full frontend editor.
- Person C / Alexa+ adapter, live account/device integrations, and deployment to physical devices are not implemented in this package.
- Demo token is public by design and must never be used outside local demo use.
