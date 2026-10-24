> Copy of README.md as handed over (before the final integration), kept for reference. The current README is ../README.md.

# SWITCH — Smart-Home Routine Verification, Replay and Regression Requirements

**SIMULATED DEMO.** Nothing here controls real devices. There is no Amazon / Alexa connection, no backend, and no live AI. Every device, sensor, temperature, routine and test result is produced by a local deterministic simulator in your browser.

SWITCH keeps a household's explicitly confirmed corrections ("Don't turn off the hallway light while someone is there") as versioned regression requirements. It then replays them against later routine edits in deterministic, modeled scenarios, and shows the evidence before a person approves or rejects the change.

## Run it (Windows, macOS or Linux)

Requires Node.js 20 or newer and a desktop browser with WebGL.

```
npm install
npm test          # 59 Node tests: simulator, SWITCH workflow, app store, GLB geometry + collision
npm run build     # production build
npm run dev       # open the printed URL (normally http://localhost:5173)
```

`npm run preview` serves the production build.

### Optional: browser end-to-end check
```
npm i --no-save playwright && npx playwright install chromium
npm run dev                      # in one terminal
node tools/e2e.mjs http://localhost:5173/
```
This writes screenshots to `docs/screenshots/` and a pass/fail log to `docs/e2e-results.json`. With software WebGL a full run takes over an hour; `E2E_FROM=16 node tools/e2e.mjs …` resumes from a section (sections 1, 2–13, 14/15, 16/17, 18, 19).

### Optional: regenerate the 3D model (Blender 5.2 via the `bpy` module, Python 3.13)
```
py -3.13 -m venv venv                         (macOS/Linux: python3.13 -m venv venv)
venv\Scripts\pip install bpy==5.2.2 pillow numpy
venv\Scripts\python blender\build_villa.py    -> blender/out/switch_villa.blend + public/models/switch_villa.glb
npm run test:geometry                         -> re-validates cameras, rooms, devices and collision on the new GLB
```

## What's in the app

| Page | What it does |
|---|---|
| **Home Overview** | The immersive 3D villa is the anchor. Four view modes: **Exterior** orbit, **Cutaway** (dollhouse, per floor), **Room tour** (eye level) and **Walk** (first person with collision). Also: numbered room markers 1–8, a bottom room bar (‹ name 03/08 ›), fullscreen, and day/night time control. The right rail holds the selected room/device panel, latest replay, requirements at risk, active routines and recent activity. The action strip has Run Replay, Compare Changes, View Trace and Review Proposed Fix. |
| **Why SWITCH** | "A fix today should not become a failure tomorrow." A 10-step interactive walkthrough of the hallway-light example. Each step is computed live by the real engine in a sandbox. Also covers differentiation without overclaiming and what we do not claim. |
| **Replay Lab** | Three columns: routine change (before/after diff, scenarios, selected requirements), event timeline (deterministic scenario clock, playback, condition evaluations, state transitions), and assertions (PASS/FAIL/INCONCLUSIVE with reasons, failed requirement, human decision). Actions: Run Replay, Apply Suggested Fix, Re-run Regression Suite, Reset Scenario, View Trace. Below them, the 3D house replays the scenario state at the selected event, with the implicated device outlined. |
| **Saved Requirements** | Capture a correction → structured DRAFT → clarify if needed → explicit confirm → `REQ-00n v1`. Supports search and filters (room, device, routine, status, last result), editing (each edit creates a new version and keeps the history), disable, re-enable and retire. |
| **Reports** | Each run shows its ID, household, routine/base/scenario/requirement/simulator versions, assertions, diff, timeline per scenario with trace hash, and the reviewer decision. **Export JSON / Markdown** both work and are labelled simulated. |
| **Devices / Integrations** | All 26 modeled devices with room, type, state (icon + text), inline controls, controlling routine and last event. Integration status is shown honestly: simulator active, Alexa / Home Assistant / physical devices not connected. |
| **Settings** | Default view, device labels, render quality, auto/manual time, manual time and date, latitude, reduced motion, simulator speed, resets, and data status. Settings persist in localStorage; requirements, runs and decisions are session-only (labelled). |

### The 90-second demo
1. **Home** — note the SIMULATED DEMO badge. Click marker **5** to tour the hallway.
2. **Saved Requirements** — "Don't turn off the hallway light while someone is there." → **Draft requirement** → review the structured rule → **Confirm & save** (`REQ-003 v1`).
3. **Replay Lab** — the diff shows the pending Goodnight edit (`v3-candidate`) removed "unless Hallway is occupied".
4. **Run Replay** → **FAIL**: *Hallway lights turned OFF (event #9, step 2) while Hallway was occupied*. The timeline marks the event, and the house below outlines the hallway light in red.
5. **Apply Suggested Fix** → the template repair restores the guard (marked *NOT VERIFIED*). **Re-run Regression Suite** → **PASS** on all relevant requirements and scenarios.
6. **Approve candidate** → the decision is recorded with the run. **Reports** → **Export JSON**.
7. Optional: tick the *sensor offline* edge case and replay. The hallway requirement becomes **INCONCLUSIVE**, never a false PASS.

## How the 3D house works

* **Blender authors, three.js runs.** `blender/build_villa.py` builds the villa procedurally (original reconstruction from screenshots, no third-party geometry). It names every interactive object and writes metadata as glTF extras (`device_id`, `kind`, `room`, `level`). It also exports eye-level room cameras (`CAM_<ROOM>` empties with a look-at target). The app loads only the local `public/models/switch_villa.glb`.
* **Single source of truth.** `src/sim/engine.js` (deterministic simulator) owns device and sensor state and the ordered trace. `src/state/appStore.js` wires the simulator, requirements, runs, selection and settings. The 3D house, panels, device table and timelines all read the same objects, so they cannot disagree.
* **Device mapping.** `src/three/houseRegistry.js` maps simulator device IDs to GLB nodes by name and extras, never by mesh index. A test proves all 26 devices map, and that every GLB device is known to the simulator.
* **Lights.** One runtime point light per (light device × room zone) and emissive bulb materials, each independent per device ID. A small shader patch (`src/three/sceneSetup.js`) makes a point light affect only fragments inside the room zone that contains it, so lights don't leak through walls without costly point-light shadows.
* **Fans, AC, TV and more.** Fan blades rotate about their own pivot at the modeled rpm, and stop when off. AC shows louver swing, a mode-coloured LED and an airflow cone while the modeled duty is above 5%. Temperature changes gradually (first-order thermal model). The TV screen glows and lights the room. Also modeled: purifier vanes, coffee/security/motion LEDs, and sliding or hinged doors that animate.
* **Room tour and walk mode.** `src/three/walker.js` is a capsule character controller against a three.js `Octree` of the real triangles. Walls, glass, furniture and ceilings block it. Closed doors block as dynamic boxes and open doors let you through. Stairs are climbed with a 0.30 m step height, so you can walk from the living room up to Bedroom 3. Room tour limits movement to the selected room's box. The same walker is used by the Node tests.
* **Cutaway.** One shared clipping plane cuts architecture at 2.72 m (ground) or 5.35 m (upper). Roof and upper storey are hidden for the ground cut. Devices, terrace furniture and the site stay visible, and everything is restored on exit.
* **Day/night** (`src/sim/daylight.js`). The browser's local time and date give a sun position (documented formula, latitude setting only for season length, location never requested). Elevation is blended through a key table into sky colours, sun/moon/hemisphere intensity, exposure and stars, and transitions ease smoothly. Manual mode previews any time and date. It never changes device state, and replays use their own deterministic clock.

## Trust boundary (from the product spec)
AI may interpret corrections or propose repairs. Only the deterministic verifier (`evaluate()` in `src/sim/switch.js`) returns PASS / FAIL / INCONCLUSIVE, and only a person can approve a candidate. Here the "AI" slots are a rule-based parser and a template repair, both labelled as such. Unknown device, room, occupancy or assertion types return INCONCLUSIVE. A PASS is evidence about the modeled scenario and versions, not a guarantee about the physical home.

## Status — verified vs. not verified
See **`docs/VERIFICATION.md`** for the exact list, with screenshots, of what was run and what was not.

## Project map
```
blender/build_villa.py, villa_lib.py, make_textures.py   procedural villa (+ out/switch_villa.blend)
public/models/switch_villa.glb                            runtime model (1.85 MB)
src/sim/engine.js        deterministic simulator (devices, sensors, routines, thermal, trace)
src/sim/switch.js        parser, requirement store (drafts/versions/status), scenarios, replay,
                         assertions, suite runner, template repair, decisions, reports
src/sim/rooms.js         room IDs / numbers / order / levels / orbit presets
src/sim/daylight.js      sun position and day/night lighting model
src/state/appStore.js    single app store; StoreContext.jsx = React bindings + clocks
src/three/               HouseViewer.jsx, Environment.jsx, sceneSetup.js, houseRegistry.js, walker.js, glbNode.js
src/pages/               Home, Why, Replay Lab, Requirements, Reports, Devices, Settings
src/ui/                  device controls/panel, time control, formatting
tests/                   sim.test.mjs (original 20), app.test.mjs (20), geometry.test.mjs (19)
tools/e2e.mjs            Playwright end-to-end check (optional)
```


## Integrated team package

For Person 1 + Person 2 setup, API connection testing, and Person C boundaries, see [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md). The merged master specification is in `docs/SWITCH_Complete_Merged_Master_Specification_AlexaPlus.pdf`.


## Run the integrated app (Windows)

The original Person A browser simulator and the Person B deterministic backend run side by side. The local house remains interactive; the backend panel supplies separately verified requirements, replay results, traces, repairs and reports. All device behavior remains simulated; no Alexa or physical devices are connected.

**Fastest start:** double-click `start-switch.bat` from the extracted project root. It creates the backend virtual environment if needed, installs dependencies, launches the API in a separate terminal, then starts Vite. Keep both terminal windows open.

Manual start:

1. Backend terminal:
   ```powershell
   cd switch_backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   $env:SWITCH_ENV = "demo"
   $env:SWITCH_DB = "data\switch.db"
   python -m app
   ```
2. Frontend terminal from the project root:
   ```powershell
   npm ci
   npm run dev
   ```
3. Open the Vite URL (normally `http://localhost:5173`). Backend docs are at `http://127.0.0.1:8000/docs`.

Replay Lab keeps **Run Replay** for the original browser simulator and adds **Run on backend** for Person B's deterministic evaluator. After a backend run, use the Backend event trace scrubber to reflect that backend event's modeled state in the existing 3D house; switch back to the local simulator at any time. Reports has separate local and SQLite-backed backend report sections. Saved Requirements has separate local and backend-backed panels.

The backend uses the demo-only `demo-owner-token` from `.env.example`. This is for a local hackathon demo only, not production. The backend database is created under `switch_backend/data/switch.db`; do not commit it. To reset demo data, use the documented backend reset flow.

## Integration verification

See `INTEGRATION_FINAL_STATUS.md` for changes, test evidence and limitations. The frontend source syntax, simulator tests, app logic tests and backend pytest suite were checked in the integration workspace. A fresh frontend production build could not be run here because npm registry DNS/network access failed; run `npm ci` then `npm run build` on a connected machine before presenting a production build.
