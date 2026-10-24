# Verification — final integration (23 Oct 2026)

Everything listed as run was actually executed in this environment (Linux container, Node 22.22, Python 3.13.17,
Chromium via Playwright with SwiftShader software WebGL). Results are summarised in
[`../FINAL_SUBMISSION_STATUS.md`](../FINAL_SUBMISSION_STATUS.md) §5–§8; raw browser results are in
[`e2e-journey-results.json`](./e2e-journey-results.json) and screenshots `screenshots/journey-*.png`.

## Commands

| What | Command | Notes |
|---|---|---|
| Frontend unit tests | `npm test` | simulator (20), app store (20), GLB geometry/collision (19), canonical contract + backend→view mapping against recorded real payloads (9) |
| Store ↔ real backend | `npm run test:integration` | spawns `uvicorn` on a free port (journey profile, in-memory DB) and drives the browser store through the full journey, reset/repeat, structured edit, unsupported input and the offline fallback |
| Backend | `npm run backend:test` | 119 original Person 2 / Person 3C tests + 21 in `tests/test_final_integration.py` |
| Build | `npm run build` | |
| Browser E2E | `npm run dev` + `cd switch_backend && python -m app`, then `node tools/e2e_journey.mjs http://127.0.0.1:5173 http://127.0.0.1:8000` | needs `playwright` and `@axe-core/playwright` (`npm i --no-save …`); `PLAYWRIGHT_CHROMIUM` may point to an installed Chromium |
| Re-record backend fixtures | `python switch_backend/scripts/record_fixtures.py` | regenerates `tests/fixtures/backend_journey.json` |
| P3C interpretation benchmark | `cd switch_backend && python -c "from switch_p3c.nlu.evaluate import evaluate, load; print(evaluate(load('person3c_benchmarks/interpretation/test.jsonl')))"` | output compared before/after the catalog changes: identical |

## What the browser E2E checks

Home (badges, backend connection, WebGL canvas) → correction → saved DRAFT (not enforced) → explicit confirmation →
Replay FAIL with the exact evidence event, violating-event flag on the timeline, selected-requirement evidence, approve
disabled → 3D replay state at the offending event (hallway occupied, light OFF) and highlight agree with the store →
backend report agrees with the UI → repair diff NOT VERIFIED, candidate v3 → rerun PASS → approval recorded → Reports
(PASS + decision + provenance; JSON export equals the canonical backend record; Markdown export) → Why SWITCH recorded
journey → Devices/Integrations (Alexa+ SIMULATED DEMO, harmless connection test passes, status stays not_configured) →
Settings reset → repeat journey (same evidence event and trace hash) → Alexa+ drawer (propose fix, rerun, approve with
explicit yes; UI reflects it; status tool honest) → axe-core on all seven pages (critical/serious incl. colour contrast)
→ keyboard (skip link, focus moves to main, visible focus ring) → phone 390 px and tablet 820 px: no horizontal overflow
→ `?offline` labelled as the local engine → no uncaught page errors.

## Not executed

See FINAL_SUBMISSION_STATUS.md §7 (original `tools/e2e.mjs` not re-run, print dialog not automated, no real GPU, Windows
scripts not executed).

---

# HISTORICAL — Person 1 verification of 22 Oct 2026 (superseded, kept for the record)

> The section below describes the checkpoint before the backend/Person 3C/Alexa+ integration. Note that the ZIP handed
> over afterwards no longer built (see FINAL_SUBMISSION_STATUS.md §2); the build is fixed in this release.

## Verification — what was run, and what was not (22 Oct 2026)

Date: 22 Oct 2026. Environment: Linux container, Node.js 22, Chromium headless shell (Playwright) with **software WebGL (SwiftShader)**, and Blender 5.2.2 as the Python `bpy` module.

Everything below was actually executed. Anything that was not executed is listed in the section **Not verified**.

## 1. Node test suites — `npm test`

| Suite | Tests | Result | What it covers |
|---|---|---|---|
| `tests/sim.test.mjs` | 20 | all pass | The original simulator and SWITCH workflow: parser, requirements, scenarios, replay, assertions, repair and decisions. Unchanged from the previous checkpoint. |
| `tests/app.test.mjs` | 20 | all pass | Rooms and numbering, navigation, selection sync between the 3D view, panels and table, devices ↔ trace, requirement lifecycle (draft → confirm → edit/version → disable → retire), the full demo path, INCONCLUSIVE on sensor offline, reports, the daylight model, settings persistence and fullscreen state. |
| `tests/geometry.test.mjs` | 19 | all pass | Loads the **exported GLB** in Node. Checks that 8 rooms exist, all 26 devices map both ways, every `CAM_*` preset is at eye height with clearance, below the ceiling, inside its room and has line of sight, every light fixture is in exactly one light zone, and walk collision works (walls, glass door, furniture, doorways, stairs to the upper floor, no escaping floor/ceiling, room-tour bounds). |

Total: **59 / 59 pass**.

## 2. Production build — `npm run build`

Succeeds with Vite 6. Output: `dist/` (pages are code-split; `dist/models/switch_villa.glb` is byte-identical to `public/models/switch_villa.glb`). Vite prints a chunk-size warning for the main bundle (three.js + React Three Fiber). This is expected and not an error.

## 3. Browser end-to-end — `node tools/e2e.mjs`

The script drives the real app in Chromium the way a user would: clicks, keyboard, mouse drag and wheel. It then reads the live three.js scene through the dev-only debug hook (`window.__switchViewers`, `window.__switch`, which only exist in `npm run dev`). Screenshots are in `docs/screenshots/` and the machine-readable log is `docs/e2e-results.json`.

**How the final results were assembled (honest note).** Software WebGL is very slow, about 2 minutes per screenshot, so a full run takes over an hour.
* **Run 1** found two failures: wheel zoom, and the fullscreen exit state. Both were fixed in `HouseViewer.jsx`. It then stopped at the JSON download because of a 30 s harness timeout.
* **Run 2** (after the fixes) passed sections 1–15. It then stopped at section 16 when a click hit Playwright's 30 s default timeout.
* A resume switch was added (`E2E_FROM=<section>`). The page-load checks of section 1 run again on every resume. **Run 3** (sections 16–19) passed all of 16/17 except the JSON download, which never fired.
* **Diagnosis.** In isolation the download works. After leaving a page with a 3D view, though, the page rendered **1 frame in 67 s**, with no canvas left in the DOM. It then recovered to a steady 60 fps (heap flat at 72 MB). This is SwiftShader's GPU process draining its queue after the WebGL context is torn down, not an app leak. Until frames resume, Playwright's "element is stable" check cannot pass. The harness now waits for frames to resume (`settle()`) after leaving a 3D page.
* **Run 4** (sections 16–19) passed 16–18 and the four mobile layouts. It found one **real bug**: on the tablet home page (1024×768) the top bar overflowed by 36 px. Fixed in `styles.css`: the search box can now shrink, and the household/time sub-labels are hidden below 1180 px. No overflow was measured at 960, 1024, 1100, 1180 or 1280 px. Run 4 then timed out on the last step, which reopened Home while the mobile and tablet tabs were still rendering. The harness now closes those tabs first.
* **Run 5** reran section 19 only, after the CSS fix.

`docs/e2e-results.json` stitches these runs: each check comes from the last run that executed it, and each entry records its run.

**Result: 64 passed, 0 failed** (64 checks).

| Result | Check | Measured | Run |
|---|---|---|---|
| PASS | 1 home: headline |  | run 5 |
| PASS | 1 home: SIMULATED DEMO badge visible |  | run 5 |
| PASS | 1 home: 8 numbered room markers attached to the house | 8 visible | run 5 |
| PASS | 1 home: local GLB loaded (no external viewer) |  | run 5 |
| PASS | 2 exterior: drag orbits the camera | 18.5,10.5,23.5 -> -29.02,10.5,8.075 | run 2 |
| PASS | 2 exterior: wheel zooms | distance 31.06 -> 16.78 | run 2 |
| PASS | 3/6 marker 1 opens the Living room tour | {"room":"living","mode":"room"} | run 2 |
| PASS | 3 camera is inside the living room | -0.25,1.63,-1.25 | run 2 |
| PASS | 4 room tour living: camera at its validated preset and inside the room | err 0.000 m, room living, label 01 / 08 | run 2 |
| PASS | 4 room tour kitchen: camera at its validated preset and inside the room | err 0.000 m, room kitchen, label 02 / 08 | run 2 |
| PASS | 4 room tour bedroom: camera at its validated preset and inside the room | err 0.000 m, room bedroom, label 03 / 08 | run 2 |
| PASS | 4 room tour bathroom: camera at its validated preset and inside the room | err 0.000 m, room bathroom, label 04 / 08 | run 2 |
| PASS | 4 room tour hallway: camera at its validated preset and inside the room | err 0.000 m, room hallway, label 05 / 08 | run 2 |
| PASS | 4 room tour bedroom2: camera at its validated preset and inside the room | err 0.000 m, room bedroom2, label 06 / 08 | run 2 |
| PASS | 4 room tour bedroom3: camera at its validated preset and inside the room | err 0.000 m, room bedroom3, label 07 / 08 | run 2 |
| PASS | 4 room tour patio: camera at its validated preset and inside the room | err 0.000 m, room patio, label 08 / 08 | run 2 |
| PASS | 7 next from 08 wraps to 01 Living room |  | run 2 |
| PASS | 7 previous from 01 wraps to 08 terrace |  | run 2 |
| PASS | 7 previous moves camera to Bedroom 3 |  | run 2 |
| PASS | 8 walk: living -> hallway -> stairs -> upper floor (bedroom 3) | feet y 3.27 | run 2 |
| PASS | 8 walk: rear wall blocks, camera stays in the hallway | [-2.62,1.63,-3.26] | run 2 |
| PASS | 8 walk: furniture (bed) blocks |  | run 2 |
| PASS | 8 walk: closed sliding glass door blocks |  | run 2 |
| PASS | 8 walk: keyboard (S) moves the camera | -2.617,1.63,-3.26 -> -2.665,1.63,-3.26 | run 2 |
| PASS | 9 cutaway ground floor: roof hidden, walls clipped at 2.72 m, devices kept | {"roofVisible":false,"clip":2.72,"wallClipped":1,"fanVisible":true} | run 2 |
| PASS | 9 cutaway upper floor: cut at 5.35 m |  | run 2 |
| PASS | 9 leaving cutaway restores all geometry | {"clip":10000,"hidden":0} | run 2 |
| PASS | 10 fullscreen: viewer container is fullscreen, controls still inside, canvas resized | {"el":"viewer ","store":true,"canvas":[1440,1000],"aspect":1.44,"controls":true} | run 2 |
| PASS | 10 fullscreen: camera aspect matches canvas |  | run 2 |
| PASS | 10 fullscreen: exit restores layout and store state | {"el":true,"store":true} -> {"el":false,"store":false,"canvas":[698,698]} | run 2 |
| PASS | 11 living light OFF: scene darker, bulb emissive off, sim OFF, trace event recorded | luminance on 119.7 vs off 49.3; event #1 | run 2 |
| PASS | 11 lights are independent (kitchen unaffected) |  | run 2 |
| PASS | 12 fan high: blades rotate, housing does not | Δ -1.900 rad | run 2 |
| PASS | 12 fan off: blades stop |  | run 2 |
| PASS | 13 AC: target lowered via UI and modeled temperature falls gradually | 22 °C -> 19 °C; 20.30 -> 20.08 -> 19.32 -> 19.00 | run 2 |
| PASS | 13 AC: room temperature shown in the panel |  | run 2 |
| PASS | 14 manual time changes the scene (noon brightest, night darkest) | {"dawn":87.2,"noon":154.9,"sunset":103.7,"night":46.5} | run 2 |
| PASS | 14 night does not change device states |  | run 2 |
| PASS | 15 automatic mode follows browser local time | {"chip":" 20:28NightAUTO","local":"20:28","mode":"auto"} | run 2 |
| PASS | 16 correction -> structured DRAFT (not active yet) |  | run 4 |
| PASS | 16 confirmed requirement gets a stable ID and version | REQ-003 v1 | run 4 |
| PASS | 16 Replay Lab shows the before/after diff removing the guard |  | run 4 |
| PASS | 16 replay of the candidate FAILS for the right reason (hallway light OFF while occupied, step 2) | Suite: FAIL | run 4 |
| PASS | 17 failed assertion highlights the hallway light in the 3D house | {"label":"FAIL REQ-003 · Hallway lights · event #6","state":"hallway"} | run 4 |
| PASS | 16 apply fix: proposal shown, marked NOT VERIFIED |  | run 4 |
| PASS | 16 approval blocked until rerun |  | run 4 |
| PASS | 16 regression rerun PASSES on the whole relevant suite | Suite: PASS | run 4 |
| PASS | 16 human approval recorded with the run |  | run 4 |
| PASS | 16 report lists versions, simulator, trace and decision |  | run 4 |
| PASS | 16 JSON export downloads a real report |  | run 4 |
| PASS | 18 page home: navigates, title and active nav |  | run 4 |
| PASS | 18 page why: navigates, title and active nav |  | run 4 |
| PASS | 18 page replay: navigates, title and active nav |  | run 4 |
| PASS | 18 page requirements: navigates, title and active nav |  | run 4 |
| PASS | 18 page reports: navigates, title and active nav |  | run 4 |
| PASS | 18 page devices: navigates, title and active nav |  | run 4 |
| PASS | 18 page settings: navigates, title and active nav |  | run 4 |
| PASS | 19 mobile home: no horizontal page scroll | overflow 0px | run 5 |
| PASS | 19 mobile replay: no horizontal page scroll | overflow 0px | run 5 |
| PASS | 19 mobile requirements: no horizontal page scroll | overflow 0px | run 5 |
| PASS | 19 mobile devices: no horizontal page scroll | overflow 0px | run 5 |
| PASS | 19 tablet home: no horizontal page scroll |  | run 5 |
| PASS | 19 markers are buttons with accessible names |  | run 5 |
| PASS | 19 no console errors |  | run 5 |

## 4. Blender — the 3D model

`blender/build_villa.py` was run with Blender **5.2.2** (`bpy`). The `.blend` and `.glb` in this package are the outputs of that run. Repairs made in this delivery:
* **Object join shifted groups.** Joining kept the first object's local frame, so groups whose first object was an off-origin cylinder or sphere moved, for example the TV console and fireplace about 1.8 m into the living room. Transforms are now baked before joining (`villa_lib.py`).
* **Stair void had no headroom.** The stair-room ceiling covered the whole stair void, so you could not walk up. It now covers only the strips outside the void (`build_villa.py`).
* **Authored room cameras.** Each room now has a `CAM_<ROOM>` empty with a look-at target, which the app uses for room tours. The geometry tests validate each one.
* **Metadata.** Every interactive object carries glTF extras (`device_id`, `kind`, `room`, `level`), and the app maps devices by name and extras, never by mesh index.

After export, `npm run test:geometry` re-validated the new GLB (19/19).

## 5. Not verified

* **Console errors across every run.** The "no console errors" check (19) covers run 5's browser session: section 1 page load, then mobile, tablet and Home again. Runs 2 and 4 stopped before their end-of-run console summary, so console errors during sections 2–18 were not collected.
* **Real GPU hardware.** All browser checks used software WebGL. Frame rate, shadows and visual quality on real GPUs were not measured. Luminance comparisons are relative (on vs off, noon vs night), not absolute.
* **Other browsers.** Firefox, Safari and mobile browsers were not tested. Mobile and tablet layouts were checked only as Chromium viewports (390×844, 1024×768).
* **Touch gestures.** Touch orbit, pinch and walk were not exercised. Mouse and keyboard were.
* **Native fullscreen exit via Esc.** Playwright cannot press the browser's own Esc. The test exits like the browser does (`document.exitFullscreen()`) and checks that the app reacts to `fullscreenchange`.
* **Screen readers.** Markers are buttons with accessible names (checked), but no assistive-technology session was run.
* **Windows / macOS.** Commands are cross-platform and were run on Linux only.
* **By design, still simulated.** Every device, sensor, temperature and result is simulated. The correction parser and repair are deterministic rule-based stand-ins for the optional AI layer. There is no Alexa or physical-device integration, and requirements and runs are session-only (no backend).
