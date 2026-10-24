> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# SWITCH Integrated Verification Report

Date: 2026-10-23

## Integration delivered in this workspace

- Person 1 frontend baseline preserved; added a Person 3C correction-interpreter panel to Devices / Integrations.
- Person 2 FastAPI deterministic backend preserved as the authoritative replay/evaluator and persistence layer.
- Person 3C package, existing model artifacts, interpreter, constrained repair proposals, local MCP-style adapter, benchmark fixtures, notebook, and documentation copied into `switch_backend/`.
- New authenticated Person 3C routes: `/person3c/status`, `/person3c/interpret`, `/person3c/repair/propose`, `/person3c/alexa/status`, `/person3c/mcp`.
- Person 3C routes reuse Person 2 authentication and household identity. Interpretation stays DRAFT. AI does not assign replay verdicts. Alexa+ remains SIMULATED; live route is BLOCKED pending external access and required transport/authentication.

## Tests actually run

- `PYTHONPATH=switch_backend python -m pytest -q switch_backend`: **119 passed** after integration (including Person 2 tests, Person 3C tests, and three new integration tests).
- `node tests/sim.test.mjs`: **20 passed**.
- `node tests/app.test.mjs`: **20 passed**.
- `node tests/geometry.test.mjs`: **not run successfully**; Node reported `ERR_MODULE_NOT_FOUND` for package `three` in this environment.
- `npm run build`: **not run**, because the chained command stopped after the missing `three` dependency. A clean npm install/build remains outstanding; network registry access may be required.
- Manual API smoke test: `GET /person3c/status` returned 200; `POST /person3c/interpret` returned a hallway occupancy correction as `DRAFT`; `GET /person3c/alexa/status` returned `SIMULATED` and live `BLOCKED`.

## Known warnings and blockers

- The environment has scikit-learn 1.8.0 but artifacts were serialized with 1.9.1. Tests passed with `InconsistentVersionWarning`; this is not a clean-version compatibility proof. Backend requirements now pin the artifact metadata versions; rerun tests in that clean environment.
- Person 3C interpreter uses its own local fixture catalog. A canonical mapping to Person 2's smaller catalog and routine/device identifiers still needs contract-level reconciliation before activating interpreted requirements.
- Person 3C `repair/propose` creates a proposal only; the frontend's current backend repair/replay flow remains Person 2's deterministic repair flow. A full unified candidate-diff adapter needs canonical mapping between the two repair schemas.
- Browser E2E and production frontend build were not verified because frontend dependencies were absent/incomplete in this environment.
- Live Alexa+, live LLM provider, and physical-home device integration are not configured or claimed.
- Existing ML metrics in artifact metadata are synthetic-only and must not be represented as real CASAS results.

## Recommended acceptance run on a connected machine

1. `cd switch_backend && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt`
2. `python -m pytest -q`
3. From project root: `npm ci`, `npm test`, `npm run build`.
4. Start backend and frontend, open Devices / Integrations, test Person 3C, interpret a hallway occupancy correction, then create a separate Person 2 draft and explicitly confirm it in Saved Requirements.
5. In Replay Lab, run the faulty candidate, inspect deterministic failure evidence, apply the constrained backend repair, rerun, and inspect the actual evaluator result and report.
