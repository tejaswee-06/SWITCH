> **HISTORICAL DOCUMENT — superseded.** Kept unchanged below for the record of earlier checkpoints. Its status claims, test counts and "not done yet" items are out of date. The authoritative status is **[FINAL_SUBMISSION_STATUS.md](./FINAL_SUBMISSION_STATUS.md)** (with docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/ALEXA_PLUS_INTEGRATION.md and docs/VERIFICATION.md).

# SWITCH — delivery status (22 Oct 2026)

This replaces the earlier "incomplete checkpoint" note. Person 1's workstream is implemented and was exercised in a real Chromium browser. It covers UX / frontend, the seven product pages, the immersive house, room navigation, device interactions, day/night, and end-to-end UI integration. `docs/VERIFICATION.md` lists exactly what was run, with screenshots, and what was not verified.

Short version:
* `npm test`: 59 tests pass (20 original simulator/SWITCH, 20 app logic, and 19 geometry/collision against the exported GLB).
* `npm run build`: succeeds.
* `node tools/e2e.mjs`: a Playwright run of the browser checks in the brief. Results are in `docs/e2e-results.json` and the table in `docs/VERIFICATION.md` §3. Software WebGL makes a full run take over an hour, so the final evidence is stitched from resumed runs (`E2E_FROM=<section>`), and each check records which run it came from.
* Blender 5.2.2 (`bpy`) was run to repair and re-export the villa. The `.blend` and `.glb` in this package are those outputs.

Fixed during final verification: top-bar horizontal overflow at tablet width (1024 px), in `src/styles.css`.

Still simulated by design: every device, sensor, temperature and result. The correction parser and repair are deterministic rule-based stand-ins for the optional AI layer. There is no Alexa or physical-device integration, and requirements and runs are session-only (no backend).
