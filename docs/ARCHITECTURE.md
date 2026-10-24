# SWITCH architecture

```
                         ┌──────────────────────────── Browser (React + three.js, Vite) ───────────────────────────┐
                         │  7 pages · 3D villa (public/models/switch_villa.glb) · Alexa+ panel (SIMULATED)        │
                         │                                                                                          │
                         │  src/state/appStore.js ── single store ──┬── house simulator (src/sim/engine.js):       │
                         │        │                                  │     live device/sensor state, thermal model,   │
                         │        │                                  │     user toggles, "Run in sim" of the canonical │
                         │        │                                  │     live routine. Never decides PASS/FAIL.      │
                         │        ▼                                  │                                                │
                         │  src/state/canonicalWorkflow.js ──────────┘  workflow provider (backend online)         │
                         │  src/api/canonicalMap.js  pure mapping: backend JSON → view models (no verdicts computed) │
                         │  src/api/switchBackend.js HTTP client (VITE_SWITCH_API_URL)                               │
                         │  offline fallback: src/sim/switch.js browser workflow, labelled "LOCAL"                  │
                         └───────────────────────────────┬──────────────────────────────────────────────────────────┘
                                                         │ HTTPS/JSON (local), bearer demo token, household scope
┌────────────────────────────────────────────── switch_backend (FastAPI, Python 3.13) ─────────────────────────────────┐
│ app/main.py  auth · validation · error format · routes                                                                │
│ app/services.py  requirement lifecycle · candidates · replays · repairs · approvals · reports (household-scoped)      │
│   ├─ app/simulator.py   deterministic event queue, explicit ordering, three-valued conditions, result hash             │
│   ├─ app/assertions.py  the ONLY place PASS / FAIL / INCONCLUSIVE are assigned                                         │
│   ├─ app/regression.py  relevance, scenario binding, suite aggregation (nothing skipped silently)                     │
│   ├─ app/diff.py        routine diff, constrained repair application, deterministic guard-restore proposal            │
│   └─ app/store.py       SQLite, ordered migrations (001–003), append-only triggers                                     │
│ app/p3c_bridge.py  Person 3C ↔ Person 2 translation (catalogs, drafts, repair ops, explanations)                       │
│ app/alexa_adapter.py  Alexa+ Route C: MCP-style JSON-RPC tools → services (SIMULATED, no Amazon)                       │
│ switch_p3c/  Person 3C: interpreter + clarification, constrained-repair validator, optional LLM provider (off),        │
│              CASAS activity-context model artifacts (optional, never used for verdicts)                              │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                       contracts/canonical_home.json — rooms and device ids shared by all of the above
```

## Trust boundaries

1. **Interpretation is a proposal.** Person 3C turns text into a draft; `POST /requirements/interpret` stores nothing.
   A draft becomes enforced only via `POST /requirements/{id}/confirm` by an owner, with the exact version.
2. **Only `app/assertions.py` assigns results.** The frontend copies `suite.overall` and each test's `status`; the
   mapping tests assert this for every recorded report. The Alexa+ adapter returns the backend's verdict verbatim.
3. **Repairs are candidates.** `suggest-fix` creates a new immutable candidate with `verified:false`; the P3C validator
   checks it against the constrained allowlist and canonical catalog; approval is refused until the latest *full* run of
   that exact candidate is PASS and not stale. Approval is a record; deployment is not implemented.
4. **Unknown never becomes PASS.** Unknown sensor state, unsupported operators, unbound scenarios and unexercised
   preconditions yield INCONCLUSIVE; exploratory edge-case runs never count towards approval.
5. **Simulated everywhere.** Every device, sensor, scenario and Alexa+ response is modeled; the UI labels it.

## One canonical state for house, timeline, reports and Alexa+

* Workflow data (requirements, candidates, runs, assertions, decisions) comes from the backend. The store keeps the raw
  payloads and re-derives every view from them after each call, so Replay Lab, Reports, Home, Why SWITCH and the Alexa+
  panel cannot disagree.
* Replay Lab's 3D house renders `stateAt(initial, trace, seq)` built from the backend trace (`initial_state` +
  ordered events) — the same events listed in the timeline and exported in the report.
* The live house simulator runs the canonical baseline routine (mapped to browser steps) so "Run in sim" executes the
  routine the backend verifies; candidates never run on the house.

## Determinism and reproducibility

Explicit scenario events, fixed queue ordering, no wall clock or randomness, pinned versions in every run, and
`/replays/{id}/verify` re-simulation. Verified by tests (identical inputs → identical traces and hashes; reset →
identical evidence ids and trace hash through the browser store and in the browser E2E).

## Offline fallback

If the backend is unreachable (or `?offline` is used), the store keeps the original browser workflow
(`src/sim/switch.js`). Every result is labelled as the in-browser simulator / LOCAL, local runs are never mixed into
backend reports, and the Alexa+ panel refuses to answer instead of inventing results.
