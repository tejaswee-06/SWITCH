> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# SWITCH integrated project — Person 1 + Person 2

This package combines the existing Nirvana Smart Home Twin / SWITCH frontend with the supplied Person 2 deterministic backend. Person 2's `switch_backend` source, tests, contract and docs are copied into this repo unchanged. No Person C implementation was included or modified; the backend's documented Person C entry points remain available.

## What's integrated

- Existing 3D smart-home twin, pages, local simulator, replay UX and existing tests are preserved.
- Person 2 FastAPI service is included at `switch_backend/`.
- The Devices / Integrations page has an additive **Test backend connection** panel. It checks `/health`, then loads `/routines`, `/requirements`, and `/candidates` from the backend and shows returned counts.
- `src/api/switchBackend.js` provides a reusable authenticated API client for the rest of the UI/Person C adapter.
- The frontend explicitly distinguishes the local simulated home from the local backend API. The frontend's 3D state is not silently overwritten by backend fixtures.
- Person C's safe API handoff points are retained: `POST /requirements/drafts`, `POST /candidates/{id}/suggest-fix`, and `GET /replays/{id}/report`. See `switch_backend/docs/INTEGRATION_CONTRACT.md`.

## Run on Windows

### Terminal 1 — backend
From the project root:
```powershell
cd switch_backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest
python -m app
```
Backend: http://127.0.0.1:8000  
API docs: http://127.0.0.1:8000/docs  
Health: http://127.0.0.1:8000/health

If PowerShell blocks activation, use `Set-ExecutionPolicy -Scope Process Bypass`, then activate again.

### Terminal 2 — frontend
From the project root (the folder containing `package.json`):
```powershell
npm ci
copy .env.example .env.local
npm run dev
```
Vite will print its local URL, usually http://localhost:5173. The frontend uses `VITE_SWITCH_API_URL=http://127.0.0.1:8000` by default. Restart Vite after changing `.env.local`.

### Test the connection
Open **Devices / Integrations** and select **Test backend connection**. A successful response shows `SIMULATED DEMO` and the routine, requirement, and candidate counts. If it fails, first confirm the backend `/health` endpoint responds and check the browser console for CORS/network errors.

## Person C boundary

Person C work is intentionally not authored or overwritten in this integration. The supplied Person 2 API retains the documented draft interpretation and constrained repair entry points. Connect Person C's adapter to those contracts only after the team provides the actual Person C implementation and agrees on its interface.

## Truth and safety boundaries

- `demo-owner-token` is a local demo-only token. Do not deploy it or expose it in production.
- No live Alexa+ / Amazon account connection or physical-device control is implemented by this package.
- The 3D house and its local interactions remain simulated.
- Backend PASS/FAIL/INCONCLUSIVE results must come from the deterministic backend, not AI-generated text.
- A proposed repair is not verified until the relevant regression suite has been rerun. Approval is a human review record, not deployment.

## Known integration boundary

This is a safe additive integration: the frontend currently probes and displays backend API data separately; the existing browser-side simulator remains the source for the 3D house and its local replay visuals. A complete replacement of browser replay actions with backend replay responses would require a deliberate schema-to-UI mapping and end-to-end acceptance test. No unsupported claim of full live data synchronization is made.

## Person 3C integration (added)

The integrated backend now exposes authenticated Person 3C endpoints that reuse the Person 2 household principal:

- `GET /person3c/status`
- `POST /person3c/interpret` — produces a DRAFT only
- `POST /person3c/repair/propose` — constrained proposal only
- `GET /person3c/alexa/status` — simulated route and live-blocker status
- `POST /person3c/mcp` — local MCP-style JSON-RPC simulation

The Devices / Integrations page contains a Person 3C correction interpreter panel. Interpretations remain drafts. “Create Person 2 DRAFT” submits the original correction to Person 2's draft endpoint; review and explicit confirmation still happen in Saved Requirements. Person 2 replay remains the sole source of PASS/FAIL/INCONCLUSIVE.

Person 3C's current catalog is still a documented local fixture, not yet a canonical mapping to Person 2's smaller device catalog. Do not treat a proposal as active until identifiers and semantics are reconciled. Alexa+ and the MCP-style adapter are SIMULATED; live Alexa+ is BLOCKED pending verified access, Streamable HTTP, MCP 2025-11-25, OAuth 2.1 + PKCE, a remote URL, and a developer account.

See `PERSON3C_VERIFICATION_REPORT.md` for actual test commands and unresolved blockers.
