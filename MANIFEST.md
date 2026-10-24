> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# Manifest

| Path | Purpose | Status in this delivery |
|---|---|---|
| `src/App.jsx` | Application shell: sidebar navigation (7 pages), top bar (household, SIMULATED DEMO badge, search, local time, alerts), hash routing, simulator clock, toasts | rewritten |
| `src/main.jsx` | Entry; creates the single app store; dev-only `window.__switch` debug hook | modified |
| `src/state/appStore.js` | Single source of truth: simulator instance, requirements, replay runs, candidate/decision, selection, view mode, settings persistence | new |
| `src/state/StoreContext.jsx` | React bindings, local-clock hook, day/night environment hook, reduced-motion hook | new |
| `src/sim/engine.js` | Deterministic simulator (unchanged behaviour). Adds `SIM_VERSION`, condition events in the trace, real previous occupancy value | modified (all 20 original tests still pass) |
| `src/sim/switch.js` | SWITCH workflow: parser (+2nd pattern, clarification), requirement store (drafts, stable IDs, versions, edit, disable/retire, last result), scenarios (+ empty house, sensor-offline edge case, generated per room), `runSuite`, routine diff, template repair, human decision, `stateAt`, Markdown report | extended (original API kept) |
| `src/sim/rooms.js` | Room IDs, numbers 1–8, order, levels, cut heights, orbit presets | new |
| `src/sim/daylight.js` | Local-time sun position and day/night lighting model (documented mapping) | new |
| `src/three/HouseViewer.jsx` | 3D viewer: exterior / cutaway / room tour / walk, markers, room bar, fullscreen, device tags, highlight, camera director | new (replaces `VillaModel.jsx`) |
| `src/three/sceneSetup.js` | Material patching (room-local light zones, cutaway clipping), runtime light groups, anchors | new |
| `src/three/houseRegistry.js` | GLB scene-graph registry: devices, rooms, cameras, doors, collision meshes, light zones | new |
| `src/three/walker.js` | Capsule + Octree first-person controller (bounded-depth octree) | new |
| `src/three/Environment.jsx` | Sky dome, stars, sun / moon / hemisphere lights | new |
| `src/three/glbNode.js` | Minimal GLB reader for Node tests | new |
| `src/pages/*.jsx` | Home, Why SWITCH, Replay Lab, Saved Requirements, Reports, Devices / Integrations, Settings | new |
| `src/ui/*` | Device controls / glyphs / panel, time control, event formatting | new |
| `src/styles.css` | New visual system (graphite/slate, cyan accents, spec type scale), responsive + container queries; top bar fits at tablet width | rewritten |
| `src/VillaModel.jsx`, `src/SwitchPanels.jsx`, `src/house.jsx`, `src/SketchfabViewer.jsx` | Previous checkpoint components | kept for reference, **not imported** by the app |
| `blender/build_villa.py`, `blender/villa_lib.py` | Procedural villa; repairs listed in `docs/VERIFICATION.md` §Blender; authored `CAM_*` room cameras | modified |
| `blender/out/switch_villa.blend`, `public/models/switch_villa.glb` | Regenerated source scene and runtime model | regenerated |
| `blender/make_textures.py`, `blender/textures/*` | Procedural textures (fixed seeds) | unchanged |
| `tests/sim.test.mjs` | Original 20 simulator / SWITCH tests | unchanged |
| `tests/app.test.mjs` | 20 tests: rooms, navigation, selection sync, devices↔trace, requirement lifecycle, demo path, INCONCLUSIVE, reports, daylight, settings, fullscreen state | new |
| `tests/geometry.test.mjs` | 19 tests on the real GLB: rooms, device mapping, camera presets, light zones, walk collision / doors / stairs | new |
| `tools/e2e.mjs` | Playwright end-to-end browser verification (optional). `E2E_FROM=<section>` resumes from a section; waits for software-WebGL to settle after leaving 3D pages | new |
| `docs/VERIFICATION.md`, `docs/screenshots/`, `docs/e2e-results.json` | What was run, results, screenshots | new |

Dependencies are unchanged: react, react-dom, three, @react-three/fiber, @react-three/drei, lucide-react, recharts (no longer used by the new UI but left in place), vite, @vitejs/plugin-react. Playwright is only needed for the optional e2e script and is not added to `package.json`.

Reference model: "Modern House. Prefab House. AirBnB. 3Bed" by MarMel-Bali on Sketchfab is a paid asset. None of its geometry is used. The villa is an original procedural reconstruction from screenshots.
