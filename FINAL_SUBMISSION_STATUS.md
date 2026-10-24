# SWITCH — final submission status (authoritative)

Date: 23 Oct 2026 · Release: `SWITCH_FINAL_SUBMISSION_READY.zip` (release 2: experience upgrade) · Environment label: **SIMULATED DEMO**

This document replaces the earlier, mutually inconsistent status files (`FINAL_INTEGRATION_STATUS.md`,
`INTEGRATION_FINAL_STATUS.md`, `INTEGRATION_STATUS_SO_FAR.md`, `PROGRESS_README.md`, `INTEGRATION_GUIDE.md`,
`PERSON3C_VERIFICATION_REPORT.md`, `MANIFEST.md`), which are kept unchanged below a "HISTORICAL — superseded" banner.
Every claim here is backed by a test or a reproducible demo step; anything not executed is listed as such.

## 0. Release 2: experience upgrade (read this first)

Baseline: `SWITCH_FINAL_SUBMISSION_READY_TERRACOTTA_SKY_BG.zip` (release 1 plus your theme toggle and terracotta light
theme, both preserved). Full list of changes: [CHANGELOG.md](./CHANGELOG.md). Demo script:
[docs/JUDGE_WALKTHROUGH.md](docs/JUDGE_WALKTHROUGH.md). Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

**Why the assistant showed raw JSON:**
1. The panel's "Show tool result" printed the whole MCP response with `JSON.stringify`.
2. Read-only tools had no spoken text, so the backend filled `content[0].text` with `json.dumps(result)`.
3. Follow-ups like "why did it fail?" were routed to "create a correction draft".
4. The conversation was lost whenever the drawer closed.

All four are fixed: a deterministic intent router, a context-tracking session that calls the real backend tools, and
typed result cards.

| Feature (release 2) | Status | Evidence |
|---|---|---|
| Assistant: natural-language journey (correction → confirm → what changed → check → why → fix → rerun → approve) on the real backend | IMPLEMENTED (assistant itself SIMULATED: deterministic routing stands in for Alexa+) | `tests/assistant.test.mjs` real-backend journey; E2E assistant checks |
| Assistant: no raw JSON in the normal UI; typed cards; readable "technical details" | IMPLEMENTED | pytest `test_alexa_every_tool_returns_human_text_not_serialized_json`; assistant view-model tests; E2E "no raw JSON" |
| Assistant: confirmations, approval gates, duplicate-send guard, offline / outage error with Retry | IMPLEMENTED | assistant session tests; E2E outage → Retry |
| Assistant: optional LLM provider | BLOCKED (none configured); deterministic routing is used and the status card says so | status card / `GET /health` |
| Landing: giant SWITCH typewriter (no layout shift, cursor, reduced motion, accessible name) + CTAs | IMPLEMENTED | E2E landing checks; `docs/screenshots/journey-landing*.png` |
| React Bits Orb (upstream source + CSS, WebGL2, hover/follow/click pulse, pause off-screen, fallback) | IMPLEMENTED | E2E "Orb initialises WebGL2" → `ready` under SwiftShader; error boundary + CSS fallback |
| SWITCH logo (from the supplied intro video) | IMPLEMENTED | `public/brand/`; landing, sidebar, favicon |
| Floating dock (10 working items, magnification, bounce, tooltips, badges, keyboard, mobile) | IMPLEMENTED | E2E "every destination…", "keyboard arrow navigation" |
| 3D villa | IMPLEMENTED (unchanged; also previewed on the landing page) | `tests/geometry.test.mjs` 19/19; E2E canvas checks |
| Light / dark themes | IMPLEMENTED (your theme CSS preserved) | E2E theme toggles; light screenshots |

**Release 2 test results** (executed in this Linux container; the 3D view used SwiftShader software WebGL in headless
Chromium):

| Suite | Command | Result |
|---|---|---|
| Frontend unit + assistant | `npm test` | **77 / 77 pass** (20 sim + 20 store + 19 GLB geometry + 9 canonical + 9 assistant, incl. a real-backend spoken journey) |
| Store ↔ real backend | `npm run test:integration` | **8 / 8 pass** |
| Backend + Person 3C | `npm run backend:test` | **143 / 143 pass** (119 original + 24 integration) |
| Production build | `npm run build` | **succeeds** (warnings: three.js chunk size; upstream Orb's `'use client'` directive ignored by Vite) |
| Browser E2E | `node tools/e2e_journey.mjs` | **65 / 65 pass on a clean install of this ZIP**: landing (typewriter, no layout shift, cursor, Orb `ready`, themes, phone, both CTAs, reduced motion), the full UI journey, the assistant journey from the dock (incl. backend outage → honest error → Retry), all 10 dock destinations + keyboard, axe on 7 pages, keyboard, phone/tablet, offline label, no console errors. Results: `docs/e2e-journey-results.json` |

**Not executed in release 2:**
- Windows launchers (no Windows host).
- A real GPU.
- A live LLM.
- Amazon / Alexa+ (blocked, §3).
- The original Person 1 `tools/e2e.mjs` suite.

The final packaging step added a backend CORS change (any loopback port is allowed) and a `GET /` page; both are covered by pytest (143/143) and were applied after that browser run.

Sections 1–9 below describe release 1 and still apply, except that the test counts in §5–§6 are superseded by the
table above.

## 1. Product in one paragraph

SWITCH preserves a household's explicitly confirmed correction as a versioned regression requirement, replays it
deterministically when a related routine changes, shows the evidence (ordered trace + failed assertion), proposes a
constrained repair, reruns the relevant suite and records a human decision. Canonical journey:
*"Don't turn off the hallway light while someone is there"* → Person 3C interpretation → DRAFT → explicit
confirmation → `req-… v1` → Goodnight edit `v2` drops the occupancy guard → replay with occupancy=true → **FAIL** at
event `E0006` (hallway light ON→OFF while occupied) → rule-based repair `v3` (validated, NOT VERIFIED) → rerun
**PASS 5/5** → owner approves (recorded, not deployed) → report retained. Reset → identical evidence and trace hash.

## 2. Baseline found in the handed-over ZIP (before this work)

| Check | Result |
|---|---|
| `npm test` | 59/59 pass |
| `npm run build` | **FAILED** — `ReportsPage.jsx` imported `SWITCH_API_BASE` from `backendBridge.js`, which did not export it |
| Replay Lab | **crashed on render** — `hl` used before its `const` declaration (temporal dead zone) |
| `pytest` (backend) | 119/119 pass (with the pinned scikit-learn 1.9.1 / NumPy 2.5.3 / pandas 3.0.5) |
| Integration | backend shown in separate side panels next to the browser engine; 6-device backend catalog vs 26-device house; Person 3C on its own fixture catalog and repair format; Alexa adapter used a parallel reference evaluator |
| Windows quick start | `set SWITCH_ENV=demo && …` set the value `"demo "` (trailing space) → demo mode off, no seed/tokens |
| CORS | default allowed `localhost:5173` but not `127.0.0.1:5173` / preview port → app silently fell back offline |
| `npm run backend:dev` | could not start (`app.main:app` is `None` unless `SWITCH_DB` is set) |

## 3. Feature status

Legend: **IMPLEMENTED** (code + reproducible test/demo evidence) · **SIMULATED** (works locally, no external
connection) · **BLOCKED** (needs unavailable access) · **NOT IMPLEMENTED**.

| Feature | Status | Evidence |
|---|---|---|
| Seven-page app shell, navigation, design system | IMPLEMENTED | E2E pages + screenshots `docs/screenshots/journey-*.png`; axe scans |
| 3D villa (original GLB, rooms 1–8, exterior/cutaway/room tour/walk, day/night, fullscreen, device animation) | IMPLEMENTED (unchanged geometry/assets) | `tests/geometry.test.mjs` 19/19; E2E canvas checks; `journey-home.png`, `journey-replay-house.png` |
| 3D house replays the canonical backend trace (state at selected event, failed device outlined) | IMPLEMENTED | E2E "3D replay state at the offending event"; `journey-replay-house.png` |
| Shared canonical room/device contract (`contracts/canonical_home.json`) | IMPLEMENTED | pytest contract tests; `tests/canonical.test.mjs` |
| Correction capture → interpretation (Person 3C rules on canonical catalog) → clarification → DRAFT | IMPLEMENTED | `test_interpret_is_read_only…`, store + browser E2E |
| Explicit confirmation, stable ids, version history, edit (structured) / disable / re-enable / retire | IMPLEMENTED | pytest (lifecycle tests), `backend_store.test.mjs`, E2E |
| Deterministic simulator, explicit event ordering, reproducibility (`/verify`) | IMPLEMENTED | `test_core.py`, `test_journey_replay_is_deterministic`, E2E repeatability |
| Assertion evaluator owns PASS/FAIL/INCONCLUSIVE; unknown → INCONCLUSIVE | IMPLEMENTED | `test_core.py`, `test_extended.py`, exploratory edge-case tests; mapping test "verdicts copied verbatim" |
| Constrained repair proposal (rule-based) + Person 3C validator + provenance + trace-grounded explanation | IMPLEMENTED | `test_full_journey_fail_repair_rerun_approve_with_provenance` |
| Repair not verified until rerun; approval refused unless latest full run PASS and not stale | IMPLEMENTED | pytest approval tests; E2E "approve disabled"; Alexa adapter gate test |
| Human review decision recorded; deployment | IMPLEMENTED (record) / **NOT IMPLEMENTED** (deployment, by design) | `deployed:false` asserted |
| Reports from canonical runs; JSON / Markdown export | IMPLEMENTED | E2E export checks (JSON equals backend record) |
| PDF export | IMPLEMENTED via browser print dialog (print stylesheet), no server-side PDF | E2E checks the control; print dialog itself not automated |
| Persistence (SQLite), migrations 001–003, household scoping, roles | IMPLEMENTED | `test_fresh_file_database…`, `test_existing_v2_database_is_upgraded_to_003`, scoping tests |
| Exploratory edge-case runs (sensor offline) | IMPLEMENTED | `test_exploratory_edge_case…`; E2E-store test |
| Offline fallback (browser engine) with LOCAL labels | IMPLEMENTED | `backend_store.test.mjs` offline test; E2E `?offline` |
| Alexa+ experience (Route C, in-app, MCP-style tools → real services) | **SIMULATED** | `test_alexa_*` (3 tests); E2E Alexa flow; `docs/ALEXA_PLUS_INTEGRATION.md` |
| Live Alexa+ (MCP server for Alexa+ / Agent Skill) | **BLOCKED** | needs Alexa developer access, OAuth 2.1 + PKCE, public HTTPS Streamable HTTP endpoint |
| Live LLM interpretation | **BLOCKED** (optional provider code present, unconfigured; no external call is made) | `test_malformed_provider_output_uses_fallback`, `test_provider_timeout_uses_rule_fallback` |
| Activity-context ML model (CASAS artifacts) | IMPLEMENTED (optional, not used for verdicts) | `test_ml_artifact_loads_without_version_mismatch…`, P3C tests |
| Physical devices, Home Assistant / SmartThings importers, routine import from Amazon | NOT IMPLEMENTED | labelled in Devices / Integrations |
| User validation, competitor benchmark, measured accuracy claims | NOT IMPLEMENTED (no figures are claimed) | — |

## 4. What changed (summary)

**Backend (Person 2, additive):** catalog derived from the shared contract (original 6 devices unchanged); `journey` seed
profile (product demo) alongside the original `regression` profile (tests); exploratory runs; `initial_state` in test
records; repair provenance (migration 003); spec route names (`/routines/candidates`, `/routines/{id}/diff`,
`/candidates/{id}/review`); `/requirements/interpret`; Person 3C-backed drafts; run integration provenance; CORS default
fix; `python -m app` defaults to the journey profile; demo script resets the profile it narrates.

**Person 3C reconciliation:** `app/p3c_bridge.py` (canonical catalogs, explicit translation tables, scenario selection,
repair-op translation + validation, explanations); interpreter made catalog-driven (room aliases, span-aware room
matching, lock/thermostat by kind, catalog-declared TV/security terms) — the P3C interpretation benchmark output is
byte-identical before and after (dev 1.00 / test 1.00 / blind 0.972 exact-match); new validator op `add_action_condition`.
Integrated `/person3c/*` routes use the canonical catalogs; `/person3c/mcp` routes to the canonical adapter.

**Alexa+:** Route C adapter (`app/alexa_adapter.py`) with the spec's tool contract, closed input schemas, explicit
confirmation flags, status/health-check endpoints; in-app panel (`src/ui/AlexaPanel.jsx`) labelled SIMULATED DEMO.

**Frontend:** build fixed; Replay Lab crash fixed; store uses the backend as the canonical workflow provider
(`src/state/canonicalWorkflow.js`) with pure mapping (`src/api/canonicalMap.js`) and the original browser engine kept as
the labelled offline fallback; duplicate side panels folded into the main controls; Requirements gains clarification
answers and a structured editor; Reports reads canonical records (JSON/Markdown/print-PDF); Why SWITCH gains "Your
recorded journey"; Devices/Integrations shows real statuses and the Alexa+ test; Settings gains engine choice, backend
reset, privacy/retention; engine provenance shown next to results; 3D viewer pauses rendering when off-screen or the tab
is hidden; accessibility (ARIA, heading order, contrast token) and phone-width overflow fixes; page title/favicon.

## 5. Test results (executed in this environment)

Environment: Linux container, Node 22.22, npm 10.9, Python 3.13.17, Chromium (Playwright, SwiftShader software WebGL).

| Suite | Command | Result |
|---|---|---|
| Frontend unit (simulator, app store, GLB geometry, canonical contract + mapping) | `npm test` | **68 / 68 pass** (20 + 20 + 19 + 9) |
| Store ↔ real backend integration | `npm run test:integration` | **8 / 8 pass** |
| Backend + Person 3C | `npm run backend:test` (`pytest`) | **140 / 140 pass** (119 original + 21 new) |
| Production build | `npm run build` | **succeeds** (Vite chunk-size warning for the three.js bundle only) |
| Browser E2E journey | `node tools/e2e_journey.mjs` | **46 / 46 pass** on the clean install (§6) |
| P3C interpretation benchmark | `switch_p3c.nlu.evaluate` on dev/test/blind | unchanged vs baseline (byte-identical metrics JSON) |

## 6. End-to-end browser results

**Clean-install run `2026-10-23T11:30:48.116Z`: 46 passed, 0 failed** — the release ZIP extracted into a new
directory, started with `./start-switch.sh` (fresh venv + `pip install`, `npm ci`), real Vite frontend + real FastAPI
backend (journey profile) in Chromium. Results: `docs/e2e-journey-results.json`; screenshots `docs/screenshots/journey-*.png`.

| Result | Check |
|---|---|
| PASS | home: SIMULATED DEMO badge, backend connected, 3D canvas present |
| PASS | home: Alexa+ entry point is labelled simulated |
| PASS | run1: correction becomes a saved DRAFT (not enforced) |
| PASS | run1: explicit confirmation persists CONFIRMED v1 |
| PASS | replay: faulty candidate produces deterministic FAIL |
| PASS | replay: failure is the confirmed hallway requirement at a trace event |
| PASS | replay: timeline flags the violating event |
| PASS | replay: selected-requirement panel shows the evidence event id |
| PASS | replay: approve is disabled while the suite FAILs |
| PASS | 3D/timeline/store agree: highlight is the hallway light in the hallway |
| PASS | 3D replay state at the offending event: hallway occupied and light OFF |
| PASS | backend report agrees with the UI (run, verdict, evidence event) |
| PASS | repair: proposed diff shown and marked NOT VERIFIED |
| PASS | repair: candidate advanced to v3, approval still disabled |
| PASS | rerun: repaired candidate PASSes the relevant suite |
| PASS | approval: explicit human decision recorded (nothing deployed) |
| PASS | reports: latest report shows PASS, decision and backend provenance |
| PASS | export JSON = canonical backend record for that run |
| PASS | export Markdown contains verdict, evidence and provenance |
| PASS | PDF path: print button present (browser print dialog) |
| PASS | why: recorded journey shows correction, FAIL, repair, rerun and decision from records |
| PASS | integrations: Alexa+ labelled SIMULATED DEMO (never CONNECTED) |
| PASS | integrations: harmless connection test passes and status stays not_configured |
| PASS | reset: backend household re-seeded (3 requirements, no runs) |
| PASS | run2: correction becomes a saved DRAFT (not enforced) |
| PASS | run2: explicit confirmation persists CONFIRMED v1 |
| PASS | repeatability: same evidence event and trace hash after reset |
| PASS | alexa: propose-fix tool creates an unverified candidate |
| PASS | alexa: rerun returns the backend verdict |
| PASS | alexa: decision requires explicit yes and is recorded, not deployed |
| PASS | alexa: UI store reflects the Alexa-recorded decision |
| PASS | alexa: status tool answers honestly (READ_ONLY_STATUS, simulated) |
| PASS | a11y (axe incl. colour contrast, critical/serious): home |
| PASS | a11y (axe incl. colour contrast, critical/serious): why |
| PASS | a11y (axe incl. colour contrast, critical/serious): replay |
| PASS | a11y (axe incl. colour contrast, critical/serious): requirements |
| PASS | a11y (axe incl. colour contrast, critical/serious): reports |
| PASS | a11y (axe incl. colour contrast, critical/serious): devices |
| PASS | a11y (axe incl. colour contrast, critical/serious): settings |
| PASS | keyboard: first Tab on a fresh page reaches the skip link |
| PASS | keyboard: skip link moves focus to the main content |
| PASS | keyboard: focused control shows a visible focus outline |
| PASS | responsive phone 390px: no horizontal page overflow |
| PASS | responsive tablet 820px: no horizontal page overflow |
| PASS | offline mode is labelled as the local engine |
| PASS | no uncaught page errors / console errors |

Earlier run in the development tree (`docs/e2e-journey-results-devtree.json`): 45/46 — the only failure was console
output `THREE.GLTFLoader: Couldn't load texture blob:…` during the final viewport/offline navigations. It did not recur in
five targeted reproductions or in the clean-install run above; it is recorded as an intermittent loader warning under
headless software WebGL. Suite history during the work: 35/44 → 43/46 → 45/46 → **46/46 (clean install)**; the fixes in
between were real (ARIA, tab-list structure, colour contrast, phone-width overflow, skip-link behaviour) except one
invalid keyboard check in the test itself.

## 7. Not executed / known limitations

* **Original Person 1 browser suite `tools/e2e.mjs` was not re-run** (its authors document > 1 hour per run on software
  WebGL). Its 3D-specific checks cover code that was not changed except the off-screen render pause; the new
  `tools/e2e_journey.mjs` covers the workflow pages. `npm test` (incl. 19 GLB geometry/collision tests) passes.
* **PDF**: produced by the browser's print dialog (print stylesheet); the dialog itself was not automated.
* **Real-GPU rendering** was not tested; only SwiftShader in headless Chromium.
* **Windows scripts** (`start-switch.bat/.ps1`) were corrected by inspection but not executed (no Windows host);
  `start-switch.sh` was executed from the clean extraction on Linux (§8).
* **Demo auth**: static DEMO-ONLY bearer tokens; not production authentication.
* **Retention/deletion policy** for correction text is not defined beyond "reset demo / delete the database"; required
  before any live use.
* **Requirement targets** supported by the interpreter: lights, TV, security system, front-door lock; conditions: room
  occupancy and clock time. Fans/AC/doors are modeled in the house but not requirement targets.
* A modeled PASS does not cover unmodeled sensors, outages, latency, firmware or household circumstances.

## 8. Clean-install verification

Performed on Linux (same container, new directory, no shared caches except the npm/pip download caches):

1. `unzip SWITCH_FINAL_SUBMISSION_READY.zip` into `/home/claude/cleaninstall` — 268 files, 24 MB; contains source, the
   original 3D model (`public/models/switch_villa.glb`, SHA-256 identical to the handed-over file), Blender sources,
   backend, Person 3C package + ML artifacts, contracts, tests + fixtures, lockfile, docs, `.env.example`, `.gitignore`,
   start scripts. No `node_modules`, virtualenv, database, `dist/` or caches.
2. `./start-switch.sh` → created `switch_backend/.venv`, installed the pinned requirements (scikit-learn 1.9.1, NumPy
   2.5.3, pandas 3.0.5, FastAPI 0.161.1), ran `npm ci`, created and migrated `switch_backend/data/switch.db`, seeded the
   journey profile, served backend :8000 and frontend :5173.
3. In that directory: `npm test` 68/68 · `npm run test:integration` 8/8 · `pytest` 140/140 · `npm run build` OK ·
   browser E2E 46/46 (§6).

Not performed: a different physical machine, Windows, macOS, or a real GPU.

## 9. Run it

```bash
# macOS / Linux
./start-switch.sh
# Windows
start-switch.bat
# manual
cd switch_backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python -m app
npm ci && npm run dev -- --host 127.0.0.1 --port 5173      # open http://127.0.0.1:5173
```
See README.md for the demo script and docs/ for architecture, contracts, the Alexa+ route and verification details.
