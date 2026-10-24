# SWITCH — Person B (Deterministic Core / Backend)  ·  SIMULATED DEMO

> **Integrated package:** this backend contains Person 2 deterministic replay and the integrated Person 3C interpretation/repair/ML/Alexa-simulation modules. Person 3C routes share Person 2 authentication and household scope. Person 2 remains the only PASS/FAIL/INCONCLUSIVE evaluator. All household/device and Alexa behavior remains simulated; no physical devices are controlled.

## Setup (Windows PowerShell)
```powershell
cd switch_backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
python -m pytest                       # backend + Person 3C integration tests
$env:SWITCH_DB = "data\switch.db"      # optional; default is data\switch.db
python -m app                          # http://127.0.0.1:8000  (docs: /docs)
# second terminal:
python scripts\demo.py                 # full 9-step demo; re-runnable (it calls /demo/reset)
python -m app.benchmark                # synthetic benchmark, prints actual results
```
Env: `SWITCH_DB` (sqlite path), `SWITCH_ENV` (`demo` default; enables seed + `/demo/reset`), `SWITCH_CORS_ORIGINS` (default `localhost:3000,5173`), `SWITCH_HOST`, `SWITCH_PORT`.
Migrations run automatically on start (`app/store.py`, ordered, recorded in `schema_migrations`).

## Architecture
`main.py` (auth, errors, routes) → `services.py` (lifecycle, household scoping, persistence, reports) → pure modules:
`simulator.py` (deterministic engine) → `assertions.py` (trace evaluator, no AI) → `regression.py` (suite) · `diff.py` (diff/repair) · `validation.py` · `catalog.py`.
AI never appears in the decision path. Fallback interpreter is a single regex rule, labelled `rule_based_fallback`.

**Determinism contract:** queue key `(sim_minute, class_rank, seq)`; rank 0 scenario events (by time then declared order), 1 clock ticks, 2 state-change triggers. Routines for one event run by `(priority asc, routine_id)`; later writer wins; contradictory writes are recorded in `conflicts`. No wall clock, no sleeps, no randomness (`seed` is recorded and deliberately has NO effect: every supported scenario is fully determined by explicit inputs, so randomness was not added; tested). `result_hash` = sha256 of trace+states.

**Result semantics:** PASS needs preconditions to have held at ≥1 observation point and no violation. Unknown/missing sensor state, empty/incomplete trace, unbound scenario, unconfirmed requirement, or never-exercised preconditions → INCONCLUSIVE (never PASS). Suite = FAIL if any FAIL; INCONCLUSIVE if any INCONCLUSIVE or zero tests; else PASS. DRAFT/DISABLED/RETIRED requirements are listed under `excluded`, never silently dropped.

**Approval rule:** `approve` needs role `owner`, a latest *full* replay of that exact candidate = PASS, and that replay must not be stale (confirmed requirements/scenarios unchanged since, else 409 `STALE_REPLAY`). `reject` always allowed. Approval is recorded only; deployment is NOT IMPLEMENTED.
**Edit rule:** editing a requirement's content creates version N+1 and returns it to DRAFT (not enforced until re-confirmed). History is kept.

## Auth (demo)
`Authorization: Bearer <token>` — DEMO-ONLY seeded tokens: `demo-owner-token` (owner, hh_demo), `demo-member-token` (member), `demo-viewer-token` (viewer), `other-owner-token` (hh_other). Roles: viewer=read, member=draft/candidate/replay/suggest, owner=confirm/approve/disable/retire/reset. Foreign-household records return 404. Replace with the project's real auth before any non-demo use.

## API (all implemented and tested)
Errors: `{"error":{"code","message","details":[{code,path,message}]}}`.
| Route | Notes |
|---|---|
| GET `/health` | no auth |
| POST `/demo/reset` | owner; reseeds |
| GET `/catalog`, `/routines`, `/scenarios` | read |
| POST `/routines/validate` | body = routine; `{valid, issues}` |
| POST `/requirements/drafts` | `{source_correction, structured?, routine_ids?, scenario_ids?}` → 201 DRAFT |
| POST `/requirements/{id}/confirm` | `{version}` owner; 409 `NEEDS_CLARIFICATION` if ambiguities |
| GET `/requirements?status&device&routine_id&last_result` · GET `/requirements/{id}` · GET `/requirements/{id}/versions` | |
| PATCH `/requirements/{id}` | `{expected_version, content?, status?(DISABLED/RETIRED), note?}` |
| POST `/candidates` · GET `/candidates` · GET `/candidates/{id}` · GET `/candidates/{id}/diff` | candidate version must be > baseline |
| POST `/candidates/{id}/suggest-fix` | `{repair_ops?}`; omitted → deterministic guard-restore; returns NEW unverified candidate |
| POST `/replays` | `{candidate_id, requirement_ids?, compare_to_run_id?}`; omitted ids = full suite |
| GET `/replays` · GET `/replays/{run_id}` · GET `/replays/{run_id}/report` · GET `/replays/{run_id}/verify` | runs are append-only; `verify` re-simulates from the recorded routine/requirement/scenario versions (read-only) and reports `reproduced` + differences; report adds `failure_evidence` (actual violating trace events) |
| POST `/candidates/{id}/approve` | `{decision: approve|reject, note?}` |

Repair ops (constrained): `add_action_condition{action_id,condition}`, `add_routine_condition{condition}`, `remove_action{action_id}`, `add_action{action}`.
Error codes: `UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, VALIDATION_ERROR/ROUTINE_INVALID/REQUIREMENT_INVALID/REPAIR_INVALID/INTERPRETATION_UNAVAILABLE 422, VERSION_CONFLICT/INVALID_TRANSITION/NEEDS_CLARIFICATION/REPLAY_REQUIRED/NOTHING_TO_REPAIR/VERIFICATION_REQUIRED/SUITE_NOT_PASSING/STALE_REPLAY/REPRODUCTION_IMPOSSIBLE 409`; unknown routes/methods also use this format (`NOT_FOUND 404`, `METHOD_NOT_ALLOWED 405`).

## Person 3C integrated routes

| Route | Behavior |
|---|---|
| GET `/person3c/status` | Interpreter, ML artifact readiness, evaluator boundary, Alexa route status |
| POST `/person3c/interpret` | Authenticated-household correction interpretation; returns DRAFT only |
| POST `/person3c/repair/propose` | Constrained candidate proposal; never approves or deploys |
| GET `/person3c/alexa/status` | Explicit SIMULATED / BLOCKED-live status |
| POST `/person3c/mcp` | Local MCP-style JSON-RPC adapter, scoped to authenticated household |

The interpretation catalog currently uses Person 3C's documented local fixture because a canonical cross-module catalog mapping is not yet defined. Treat the result as a proposal and verify identifiers against Person 2 before confirmation. ML artifacts were serialized with scikit-learn 1.9.1; use the pinned requirements and rerun artifact compatibility checks in the target environment.

## Handoff
**Person A (UI):** statuses `PASS|FAIL|INCONCLUSIVE`; requirement status `DRAFT|CONFIRMED|DISABLED|RETIRED`; candidate status `PENDING_REVIEW|APPROVED|REJECTED`. Show `environment` ("SIMULATED DEMO") from every replay. Drive the timeline from `suite.tests[i].trace[]`. Trace event: `event_id, seq, sim_time, type(external_event|clock_tick|routine_fired|action), routine_id, routine_version, source_event, action_id, device, attr, target_value, previous, resulting, changed, outcome(executed|skipped|indeterminate), conditions[{scope,expr,actual,result(true|false|null)}], state_before`. Assertions point to `evidence_event_ids`. Diff = `routine_diff[{path,kind,before,after,summary}]`. Demo flow = reset → GET requirement → GET candidate diff → POST replay → POST suggest-fix → POST replay → GET report → POST approve (owner).
**Person C (AI):** call `POST /requirements/drafts` with `structured` = RequirementContent (`title, scope{routine_ids,devices,scenario_ids}, preconditions[Condition], expected_behavior{kind:must_not_set|final_state_equals,device,attr,value}, ambiguities[], confidence, interpreter`); non-empty `ambiguities` blocks confirmation. Repairs: send `repair_ops` to `suggest-fix`; they are schema-validated and result in an unverified candidate. Never write pass/fail — only `POST /replays` does.

## Semantics added in this revision
- **`final_state_equals` + `time_between`:** the window `[start,end)` selects an observation instant: the device state is read at the END of the window (events with sim_time < end applied; start inclusive for coverage, end exclusive). `end=00:00` means midnight. Scenario must observe the window end, else INCONCLUSIVE (`not_exercised`). Unsupported (always INCONCLUSIVE, never PASS): wrap-around windows other than ending at 00:00, empty windows (start==end), >1 window, malformed/missing times, unsupported operators. State (eq/neq) preconditions are still evaluated on the scenario's initial state.
- **Requirement relevance (structured, deterministic):** `direct` (routine in `scope.routine_ids`, or writes a scoped/behavior device) · `indirect` (reaches the device through state-trigger cascades of other routines) · `global` (no scope) → run. `ambiguous` (scope names other routines but this routine also writes the device) and `none` → listed in `suite.not_applicable` with reason + `ambiguous` flag, never silently dropped (an all-ambiguous suite can never be PASS).
- **Scenario binding:** explicit `scope.scenario_ids` are used as given (`binding:"explicit"`). With none, the requirement is auto-bound to every household scenario (`binding:"auto"`); scenarios that never exercise it appear in `suite.not_exercised`; unknown-state scenarios stay as INCONCLUSIVE tests; if nothing exercises it → one INCONCLUSIVE test.
- **Integrity:** confirm/patch/approve/replay/candidate-create are atomic (`BEGIN IMMEDIATE`; concurrent confirms: exactly one wins). Migration `002_integrity` adds DB triggers making requirement versions, routines, scenarios, replays, approvals and audit rows append-only (UPDATE aborts), plus indexes.
- **Demo reset** (`POST /demo/reset`) is demo-mode only (`SWITCH_ENV=demo`, 404 otherwise), owner of `hh_demo` only, and deletes only the `hh_demo`/`hh_other` rows. Other households are untouched (tested).
- Replays now record `routine_versions` and `requirement_statuses`; before/after comparisons report `same_scenario_versions` and warn when scenarios differ.

## AI (Person C) boundary
No AI service was provided and none is called. `/health` reports `ai_interpreter: not_configured`. Integration contract: `docs/INTEGRATION_CONTRACT.md`. No AI-related environment variable exists yet.

## Limitations (truthful)
- Standalone: not integrated with the real frontend/AI code (not provided); browser journey NOT VERIFIED. CORS only for `SWITCH_CORS_ORIGINS` (default localhost:3000,5173).
- Demo auth (static seeded tokens), not production auth. SQLite, single process; no PostgreSQL. Not production-ready.
- Catalog: 3 lights, 1 lock, 2 occupancy sensors only; operators eq/neq/time_between; no cross-midnight scenarios.
- Relevance is structural (scope + state-trigger cascades); it does not infer semantic intent. Auto-binding runs every household scenario.
- Approval refuses suites that are INCONCLUSIVE (even for unrelated requirements); there is no override flag. Unrelated FAIL/INCONCLUSIVE results stay visible in the report.
- Routine create/import API is candidate-only; baseline update after approval/deployment is NOT IMPLEMENTED. Export (PDF) NOT IMPLEMENTED. Live Alexa/device integration NOT IMPLEMENTED.
- Benchmark is 9 hand-authored synthetic cases; it says nothing about real-world accuracy. No custom ML.

## Final integration additions (23 Oct 2026)

Full contract: [`../docs/CONTRACTS.md`](../docs/CONTRACTS.md). Status and evidence: [`../FINAL_SUBMISSION_STATUS.md`](../FINAL_SUBMISSION_STATUS.md).

* **Canonical catalog** — `app/catalog.py` now derives from `../contracts/canonical_home.json` (35 devices, 8 rooms, the
  same ids as the 3D villa). The six original devices are unchanged.
* **Seed profiles** — `regression` (original fixtures; default for `create_app()` and the test-suite) and `journey`
  (product demo; default for `python -m app`). `POST /demo/reset {"profile": "journey"|"regression"}`.
* **Person 3C ↔ Person 2** — `app/p3c_bridge.py`: canonical Person 3C catalogs, draft → RequirementContent translation
  (untranslatable conditions produce questions, never silent drops), scenario selection, repair-op translation and
  validation through the Person 3C constrained-repair validator, trace-grounded explanations.
  New: `POST /requirements/interpret` (read-only proposal + questions), `POST /requirements/drafts {"interpreter":"p3c"}`.
  `/person3c/interpret` and `/person3c/repair/propose` now use the canonical catalogs; the latter also accepts
  `{"candidate_id": …}` for a read-only canonical preview.
* **Repair provenance** — migration `003_repair_provenance`; candidates carry proposer, validator result, evidence run and
  event ids, explanation, `ai_model_used:false`, `verified:false`.
* **Exploratory runs** — `POST /replays {"extra_scenario_ids": [...]}` adds edge-case scenarios (e.g. the hallway sensor
  offline); kind `exploratory`; never used for approval; never changes `last_result`.
* **Spec route names** — `POST /routines/candidates`, `GET /routines/{id}/diff?from=&to=`, `POST /candidates/{id}/review`.
* **Alexa+ Route C (SIMULATED)** — `app/alexa_adapter.py`; `GET /integrations/alexa/status`, `POST /integrations/alexa/test`,
  `POST /integrations/alexa/mcp` (`/person3c/mcp` is an alias). See [`../docs/ALEXA_PLUS_INTEGRATION.md`](../docs/ALEXA_PLUS_INTEGRATION.md).
* **Run provenance** — each replay records `integration {integration_mode, source_provenance, invoked_via, correlation_id,
  adapter_version}`; test records include `initial_state` (used by the UI to replay the trace in the 3D house).
* **CORS default** now also allows `127.0.0.1:5173` and the Vite preview port `4173`.
* Tests: `tests/test_final_integration.py` (21 tests). Fixtures for the frontend mapping tests:
  `python scripts/record_fixtures.py` → `../tests/fixtures/backend_journey.json`.
