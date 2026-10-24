// End-to-end browser verification for SWITCH (real Chromium + WebGL via Playwright).
// Usage:  npm run dev   (or npm run preview -- --port 5173)   then
//         node tools/e2e.mjs [baseUrl]            (needs: npm i --no-save playwright && npx playwright install chromium)
// Writes screenshots to docs/screenshots/ and a JSON log to docs/e2e-results.json.
// It drives the UI like a user (clicks, keys, mouse drag/wheel) and checks the live 3D scene through the
// dev-only debug hook (window.__switchViewers / window.__switch).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5173/';
// Resume support: E2E_FROM=<section> skips sections already verified in an earlier run (page-load checks always run).
const FROM = Number(process.env.E2E_FROM || 1);
const OUT = path.resolve('docs/screenshots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const consoleErrors = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
// Software WebGL starves the main thread; Playwright's 30 s default is too short for some clicks.
ctx.setDefaultTimeout(180000);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/GPU stall|ReadPixels/.test(t)) consoleErrors.push(t.slice(0, 300)); } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
// Software rendering is slow: low quality + reduced motion keeps checks deterministic. Manual noon to start.
await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e')) { sessionStorage.setItem('e2e', '1'); localStorage.setItem('switch.settings.v1', JSON.stringify({ quality: 'low', reducedMotion: 'on', timeMode: 'manual', manualTime: '12:00' })); } } catch { /* ignore */ } });

const frames = (n = 2) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const viewer = () => page.locator('.viewer').first();
const snap = async (name, loc = viewer()) => { await frames(2); await loc.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 240000 }); };
const act = (fn, ...args) => page.evaluate(([f, a]) => { const s = window.__switch; return new Function('s', 'a', `return (${f})(s, a)`)(s, a); }, [fn.toString(), args]);
// average luminance of the WebGL canvas right after a render
const luminance = () => page.evaluate(async () => {
  const V = window.__switchViewers.main; V.gl.render(V.scene, V.camera);
  const url = V.gl.domElement.toDataURL('image/png');
  const img = new Image(); await new Promise((r) => { img.onload = r; img.src = url; });
  const c = document.createElement('canvas'); c.width = 160; c.height = 100; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 100);
  const d = g.getImageData(0, 0, 160, 100).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 4);
});
const camPos = () => page.evaluate(() => window.__switchViewers.main.camera.position.toArray().map((v) => +v.toFixed(3)));
const roomOfCam = () => page.evaluate(() => { const V = window.__switchViewers.main; return V.bridge.reg.roomOfPoint(V.camera.position); });
// After a 3D view unmounts, SwiftShader's GPU process can take a minute or more to drain, during which the page
// renders no frames and Playwright's "stable" check cannot pass. Wait until the page renders frames normally again.
const settle = async (pg = page, maxMs = 600000) => { const end = Date.now() + maxMs; while (Date.now() < end) { const ms = await pg.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n >= 10 ? r(performance.now() - t0) : requestAnimationFrame(f)); requestAnimationFrame(f); })); if (ms < 1500) return; } };

const t0 = Date.now();
// ---------------- 1. initial home overview ----------------
await page.goto(`${BASE}#/home`);
await page.waitForSelector('[data-testid=viewer-ready]', { state: 'attached', timeout: 240000 });
await frames(3);
ok('1 home: headline', (await page.textContent('h1')).includes('Your home, with changes you can verify.'));
ok('1 home: SIMULATED DEMO badge visible', await page.locator('.topbar .badge-sim').isVisible());
const markersShown = await page.$$eval('.room-marker', (els) => els.filter((e) => e.style.display !== 'none').length);
ok('1 home: 8 numbered room markers attached to the house', markersShown === 8, `${markersShown} visible`);
ok('1 home: local GLB loaded (no external viewer)', await page.evaluate(() => !!window.__switchViewers.main.scene.getObjectByName('ROOF__roof_dark') && !document.querySelector('iframe')));
if (FROM <= 1) await snap('01-home-exterior-day');
if (FROM <= 1) await page.screenshot({ path: path.join(OUT, '00-home-page.png'), timeout: 240000 });

if (FROM <= 13) {
// ---------------- 2. exterior orbit & zoom ----------------
const box = await viewer().boundingBox();
const p0 = await camPos();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.5 + 220, box.y + box.height * 0.55, { steps: 6 }); await page.mouse.up();
await frames(2); const p1 = await camPos();
ok('2 exterior: drag orbits the camera', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 1, `${p0} -> ${p1}`);
const d1 = await page.evaluate(() => { const V = window.__switchViewers.main; return V.controls.distance; });
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.wheel(0, -600); await frames(3);
const d2 = await page.evaluate(() => window.__switchViewers.main.controls.distance);
ok('2 exterior: wheel zooms', d2 < d1 - 0.5, `distance ${d1.toFixed(2)} -> ${d2.toFixed(2)}`);

// ---------------- 3 + 6. enter via numbered marker ----------------
await page.click('[data-testid=marker-living]'); await frames(3);
let st = await act((s) => ({ room: s.getState().roomId, mode: s.getState().viewMode }));
ok('3/6 marker 1 opens the Living room tour', st.room === 'living' && st.mode === 'room', JSON.stringify(st));
ok('3 camera is inside the living room', (await roomOfCam()) === 'living' || (await roomOfCam()) === 'kitchen', `${await camPos()}`);
await snap('03-living-tour-day');

// ---------------- 4/5. every room destination ----------------
const rooms = ['living', 'kitchen', 'bedroom', 'bathroom', 'hallway', 'bedroom2', 'bedroom3', 'patio'];
for (const r of rooms) {
  await page.selectOption('[data-testid=room-select]', r); await frames(3);
  const pos = await camPos(); const inRoom = await roomOfCam();
  const preset = await page.evaluate((r) => window.__switchViewers.main.bridge.reg.cameras[r].pos, r);
  const err = Math.hypot(pos[0] - preset[0], pos[1] - preset[1], pos[2] - preset[2]);
  ok(`4 room tour ${r}: camera at its validated preset and inside the room`, err < 0.08 && inRoom === r, `err ${err.toFixed(3)} m, room ${inRoom}, label ${await page.textContent('[data-testid=room-pos]')}`);
  await snap(`04-room-${String(rooms.indexOf(r) + 1).padStart(2, '0')}-${r}`);
}

// ---------------- 7. previous / next arrows (wrap) ----------------
await page.click('[data-testid=room-next]'); await frames(2);
ok('7 next from 08 wraps to 01 Living room', (await act((s) => s.getState().roomId)) === 'living' && (await page.textContent('[data-testid=room-pos]')) === '01 / 08');
await page.click('[data-testid=room-prev]'); await frames(2);
ok('7 previous from 01 wraps to 08 terrace', (await act((s) => s.getState().roomId)) === 'patio' && (await page.textContent('[data-testid=room-pos]')) === '08 / 08');
await page.click('[data-testid=room-prev]'); await frames(3);
ok('7 previous moves camera to Bedroom 3', (await roomOfCam()) === 'bedroom3');

// ---------------- 8. first-person walk + collision (runtime walker on the loaded scene) ----------------
await page.click('[data-testid=mode-walk]'); await frames(2);
await page.waitForSelector('[data-testid=walker-ready]', { state: 'attached', timeout: 120000 });
const walk = await page.evaluate(() => {
  const V = window.__switchViewers.main; const b = V.bridge; const T = V.THREE; const W = b.walker.constructor;
  const mk = (room) => { const w = new W(b.walker.octree); w.doorBoxes = b.walker.doorBoxes; w.teleportEye(new T.Vector3(...b.reg.cameras[room].pos)); return w; };
  const to = (w, bx, by, maxT = 25) => { const g = new T.Vector3(bx, 0, -by); let t = 0; while (t < maxT) { const d = new T.Vector3(g.x - w.feet.x, 0, g.z - w.feet.z); if (d.length() < 0.12) return true; d.normalize().multiplyScalar(1.6); w.update(1 / 30, d); t += 1 / 30; } return false; };
  const a = mk('living'); const route = [[-0.5, 1.3], [-0.5, 2.6], [3.0, 2.7], [3.7, 2.7], [5.5, 2.7], [7.0, 2.7], [7.0, 1.4], [5.5, 1.3]].every(([x, y]) => to(a, x, y));
  const wall = mk('hallway'); const through = to(wall, -3.0, 6.0, 4);
  const bed = mk('bedroom'); const intoBed = to(bed, -6.0, -1.9, 6);
  const gl = mk('living'); [[-2.65, 0.55], [-2.65, -3.1], [-1.85, -3.1]].forEach(([x, y]) => to(gl, x, y)); const outClosed = to(gl, -1.85, -5.5, 5);
  // drive the real camera: start in the hallway preset and walk forward into the rear wall for 3 simulated seconds
  b.walker.teleportEye(new T.Vector3(...b.reg.cameras.hallway.pos));
  for (let i = 0; i < 90; i++) b.walker.update(1 / 30, new T.Vector3(0, 0, -1.6));
  b.walker.eyePosition(V.camera.position);
  return { route, upperFloor: +a.feet.y.toFixed(2), through, intoBed, outClosed, cam: V.camera.position.toArray(), camRoom: b.reg.roomOfPoint(V.camera.position) };
});
ok('8 walk: living -> hallway -> stairs -> upper floor (bedroom 3)', walk.route && Math.abs(walk.upperFloor - 3.27) < 0.05, `feet y ${walk.upperFloor}`);
ok('8 walk: rear wall blocks, camera stays in the hallway', !walk.through && walk.camRoom === 'hallway', JSON.stringify(walk.cam.map((v) => +v.toFixed(2))));
ok('8 walk: furniture (bed) blocks', !walk.intoBed);
ok('8 walk: closed sliding glass door blocks', !walk.outClosed);
await snap('08-walk-hallway');
// keyboard drives the walker in the page too
const k0 = await camPos(); await page.focus('.viewer'); await page.keyboard.down('KeyS'); await frames(3); await page.keyboard.up('KeyS'); const k1 = await camPos();
ok('8 walk: keyboard (S) moves the camera', Math.hypot(k1[0] - k0[0], k1[2] - k0[2]) > 0.02, `${k0} -> ${k1}`);

// ---------------- 9. cutaway ----------------
await act((s) => { s.actions.selectRoom('living'); s.actions.setViewMode('cutaway'); }); await frames(3);
const cut = await page.evaluate(() => { const V = window.__switchViewers.main; const roof = V.scene.getObjectByName('ROOF__roof_dark'); const wall = V.scene.getObjectByName('SHELL__wall_white'); return { roofVisible: roof.visible, clip: V.bridge.reg.clipPlane.constant, wallClipped: (wall.material.clippingPlanes || []).length, fanVisible: V.scene.getObjectByName('FAN_LIVING').visible }; });
ok('9 cutaway ground floor: roof hidden, walls clipped at 2.72 m, devices kept', !cut.roofVisible && Math.abs(cut.clip - 2.72) < 1e-6 && cut.wallClipped === 1 && cut.fanVisible, JSON.stringify(cut));
await snap('09-cutaway-ground');
await page.click('.viewer-top .seg[aria-label="Cutaway storey"] button:nth-child(2)'); await frames(3);
ok('9 cutaway upper floor: cut at 5.35 m', await page.evaluate(() => Math.abs(window.__switchViewers.main.bridge.reg.clipPlane.constant - 5.35) < 1e-6));
await snap('09-cutaway-upper');
await page.click('[data-testid=mode-exterior]'); await frames(2);
const restored = await page.evaluate(() => { const V = window.__switchViewers.main; let hidden = 0; V.scene.children.forEach((o) => { if (o.isObject3D && o.name && !o.visible) hidden++; }); return { clip: V.bridge.reg.clipPlane.constant, hidden }; });
ok('9 leaving cutaway restores all geometry', restored.clip > 1000 && restored.hidden === 0, JSON.stringify(restored));

// ---------------- 10. fullscreen ----------------
const before = await page.evaluate(() => { const c = window.__switchViewers.main.gl.domElement; return [c.clientWidth, c.clientHeight]; });
await page.click('[data-testid=fullscreen-btn]'); await page.waitForTimeout(800); await frames(3);
const fs1 = await page.evaluate(() => ({ el: document.fullscreenElement?.className || null, store: window.__switch.getState().fullscreen, canvas: [window.__switchViewers.main.gl.domElement.clientWidth, window.__switchViewers.main.gl.domElement.clientHeight], aspect: window.__switchViewers.main.camera.aspect, controls: !!document.querySelector('.viewer:fullscreen .room-nav') }));
ok('10 fullscreen: viewer container is fullscreen, controls still inside, canvas resized', fs1.el?.includes('viewer') && fs1.store && fs1.controls && fs1.canvas[0] >= before[0], JSON.stringify(fs1));
ok('10 fullscreen: camera aspect matches canvas', Math.abs(fs1.aspect - fs1.canvas[0] / fs1.canvas[1]) < 0.02);
await page.screenshot({ path: path.join(OUT, '10-fullscreen.png'), timeout: 240000 });
// Synthetic Escape from Playwright does not trigger the browser's own fullscreen exit, so exit like the
// browser does (document.exitFullscreen) and wait for the app to react to the external 'fullscreenchange'.
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
const fs2 = await page.evaluate(() => ({ el: !!document.fullscreenElement, store: window.__switch.getState().fullscreen }));
if (fs2.el) await page.evaluate(() => document.exitFullscreen());
await page.waitForFunction(() => !document.fullscreenElement && window.__switch.getState().fullscreen === false, null, { timeout: 60000 }).catch(() => {});
await frames(2);
const fs3 = await page.evaluate(() => ({ el: !!document.fullscreenElement, store: window.__switch.getState().fullscreen, canvas: [window.__switchViewers.main.gl.domElement.clientWidth, window.__switchViewers.main.gl.domElement.clientHeight] }));
ok('10 fullscreen: exit restores layout and store state', !fs3.el && !fs3.store && Math.abs(fs3.canvas[0] - before[0]) < 4, `${JSON.stringify(fs2)} -> ${JSON.stringify(fs3)}`);

// ---------------- 11. lights on/off (visible + state + trace) ----------------
await act((s) => { s.actions.updateSettings({ timeMode: 'manual', manualTime: '22:30' }); s.actions.openRoomTour('living'); s.actions.selectDevice(null); }); await frames(4);
await page.waitForSelector('[data-testid=quick-livingLight]');
const onState = await act((s) => s.sim.state.devices.livingLight.on);
if (!onState) { await page.click('[data-testid=quick-livingLight]'); await frames(3); }
const lumOn = await luminance(); await snap('11-living-night-light-on');
await page.click('[data-testid=quick-livingLight]'); await frames(4);
const lumOff = await luminance(); await snap('11-living-night-light-off');
const lt = await page.evaluate(() => { const V = window.__switchViewers.main; const m = V.bridge.reg.mats.MAT_EMIT_livingLight; return { emissive: m.emissiveIntensity, sim: window.__switch.sim.state.devices.livingLight.on, last: window.__switch.queries.eventsFor({ device: 'livingLight', limit: 1 })[0] }; });
ok('11 living light OFF: scene darker, bulb emissive off, sim OFF, trace event recorded', lumOn > lumOff * 1.25 && lt.emissive === 0 && lt.sim === false && lt.last?.to === false, `luminance on ${lumOn.toFixed(1)} vs off ${lumOff.toFixed(1)}; event #${lt.last?.seq}`);
const other = await act((s) => s.sim.state.devices.kitchenLight.on);
ok('11 lights are independent (kitchen unaffected)', other === true);
await page.click('[data-testid=quick-livingLight]'); await frames(2);

// ---------------- 12. fan ----------------
await page.click('[data-testid=dev-row-fanLiving]'); await page.click('[data-testid=fan-fanLiving-high]'); await frames(2);
const r1 = await page.evaluate(() => window.__switchViewers.main.scene.getObjectByName('FAN_LIVING_BLADES').rotation.y); await frames(3);
const r2 = await page.evaluate(() => window.__switchViewers.main.scene.getObjectByName('FAN_LIVING_BLADES').rotation.y);
const housing = await page.evaluate(() => window.__switchViewers.main.scene.getObjectByName('FAN_LIVING').rotation.y);
ok('12 fan high: blades rotate, housing does not', Math.abs(r2 - r1) > 0.01 && housing === 0, `Δ ${(r2 - r1).toFixed(3)} rad`);
await snap('12-fan-high-selected');
await page.click('[data-testid=fan-fanLiving-off]'); await frames(2);
const r3 = await page.evaluate(() => window.__switchViewers.main.scene.getObjectByName('FAN_LIVING_BLADES').rotation.y); await frames(3);
const r4 = await page.evaluate(() => window.__switchViewers.main.scene.getObjectByName('FAN_LIVING_BLADES').rotation.y);
ok('12 fan off: blades stop', Math.abs(r4 - r3) < 1e-9);

// ---------------- 13. AC ----------------
await act((s) => s.actions.selectDevice('ac'));
await page.waitForSelector('[data-testid=ac-ac-target]');
const tgt0 = await page.textContent('[data-testid=ac-ac-target]');
await page.click('button[aria-label="Lower target temperature"]'); await page.click('button[aria-label="Lower target temperature"]'); await page.click('button[aria-label="Lower target temperature"]');
const tgt1 = await page.textContent('[data-testid=ac-ac-target]');
const temps = await act((s) => { const a = s.sim.state.rooms.living.temp; s.actions.tick(60); const b = s.sim.state.rooms.living.temp; s.actions.tick(900); const c = s.sim.state.rooms.living.temp; return [a, b, c, s.sim.state.devices.ac.target]; });
ok('13 AC: target lowered via UI and modeled temperature falls gradually', tgt0 !== tgt1 && temps[1] < temps[0] && temps[0] - temps[1] < 1 && temps[2] < temps[1] && temps[2] > temps[3], `${tgt0} -> ${tgt1}; ${temps.map((x) => x.toFixed(2)).join(' -> ')}`);
await frames(2);
ok('13 AC: room temperature shown in the panel', /°C/.test(await page.textContent('[data-testid=room-temp-living]')));
await snap('13-ac-selected');
} // end 2-13

if (FROM <= 15) {
// ---------------- 14/15. day / night ----------------
await act((s) => { s.actions.selectDevice(null); s.actions.setViewMode('exterior'); s.actions.setPower('bedroom2Light', true); s.actions.setPower('hallwayLight', true); s.actions.setPower('patioLight', true); }); await frames(2);
const lum = {};
for (const [n, t] of [['dawn', '06:15'], ['noon', '12:00'], ['sunset', '18:10'], ['night', '22:30']]) {
  await page.click('[data-testid=time-btn]'); await page.click(`[data-testid=time-preset-${n}]`); await page.keyboard.press('Escape'); await frames(3);
  lum[n] = await luminance(); await snap(`14-exterior-${n}`);
}
ok('14 manual time changes the scene (noon brightest, night darkest)', lum.noon > lum.dawn && lum.noon > lum.night * 2 && lum.sunset > lum.night, JSON.stringify(Object.fromEntries(Object.entries(lum).map(([k, v]) => [k, +v.toFixed(1)]))));
ok('14 night does not change device states', await act((s) => s.sim.state.devices.kitchenLight.on === true && s.sim.state.devices.bedroom2Light.on === true));
await page.click('[data-testid=time-btn]'); await page.click('[data-testid=time-auto]'); await page.keyboard.press('Escape'); await frames(2);
const auto = await page.evaluate(() => ({ chip: document.querySelector('[data-testid=time-btn]').textContent, local: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`, mode: window.__switch.getState().settings.timeMode }));
ok('15 automatic mode follows browser local time', auto.mode === 'auto' && auto.chip.includes('AUTO') && auto.chip.includes(auto.local), JSON.stringify(auto));
await snap('15-exterior-auto-local-time');
} // end 14/15

if (FROM <= 17) {
// ---------------- 16/17. requirement -> Replay Lab failure & repair ----------------
await page.click('[data-testid=nav-requirements]'); await page.waitForSelector('[data-testid=correction-input]'); await settle();
await page.fill('[data-testid=correction-input]', "Don't turn off the hallway light while someone is there.");
await page.click('[data-testid=draft-btn]');
const draftId = await page.evaluate(() => window.__switch.queries.drafts().find((d) => !d.needsClarification)?.draftId);
ok('16 correction -> structured DRAFT (not active yet)', !!draftId && !(await act((s) => s.queries.activeRequirements().some((r) => r.device === 'hallwayLight'))));
await page.screenshot({ path: path.join(OUT, '16-requirements-draft.png'), timeout: 240000 });
await page.click(`[data-testid=confirm-${draftId}]`);
const req = await act((s) => s.queries.activeRequirements().find((r) => r.device === 'hallwayLight'));
ok('16 confirmed requirement gets a stable ID and version', /^REQ-\d{3}$/.test(req.id) && req.version === 1, `${req.id} v${req.version}`);
await page.click('[data-testid=nav-replay]'); await page.waitForSelector('[data-testid=lab-run]');
ok('16 Replay Lab shows the before/after diff removing the guard', /unless Hallway is occupied/.test(await page.textContent('[data-testid=lab-diff]')));
await page.click('[data-testid=lab-run]'); await page.waitForSelector('[data-testid=lab-verdict]');
await page.waitForSelector('[data-testid=viewer-ready]', { state: 'attached', timeout: 240000 }); await frames(3);
const v1 = await page.textContent('[data-testid=lab-verdict]'); const sel1 = await page.textContent('[data-testid=lab-selected]');
ok('16 replay of the candidate FAILS for the right reason (hallway light OFF while occupied, step 2)', v1.includes('FAIL') && sel1.includes(req.id) && /Hallway lights/.test(sel1), v1);
const hl = await page.evaluate(() => ({ label: document.querySelector('.world-fail')?.textContent || '', state: window.__switchViewers.compact?.bridge?.roomId }));
ok('17 failed assertion highlights the hallway light in the 3D house', hl.label.includes('FAIL') && hl.label.includes(req.id), JSON.stringify(hl));
await snap('17-replay-highlight', page.locator('.viewer').first());
await page.screenshot({ path: path.join(OUT, '16-replay-fail.png'), fullPage: false, timeout: 240000 });
await page.click('[data-testid=lab-fix]');
ok('16 apply fix: proposal shown, marked NOT VERIFIED', /NOT VERIFIED/.test(await page.textContent('[data-testid=lab-proposal]')));
ok('16 approval blocked until rerun', await page.isDisabled('[data-testid=lab-approve]'));
await page.click('[data-testid=lab-rerun]'); await frames(2);
const v2 = await page.textContent('[data-testid=lab-verdict]');
ok('16 regression rerun PASSES on the whole relevant suite', v2.includes('PASS') && (await act((s) => s.actions.currentRun().cases.length)) >= 3, v2);
await page.screenshot({ path: path.join(OUT, '16-replay-pass.png'), timeout: 240000 });
await page.click('[data-testid=lab-approve]');
ok('16 human approval recorded with the run', /APPROVED/.test(await page.textContent('[data-testid=lab-decision]')));
await page.click('[data-testid=nav-reports]'); await page.waitForSelector('[data-testid=report-detail]'); await settle();
ok('16 report lists versions, simulator, trace and decision', await page.evaluate(() => { const t = document.querySelector('[data-testid=report-detail]').textContent; return /switch-sim\//.test(t) && /goodnight@v3-candidate\+guard/.test(t) && /APPROVED/.test(t); }));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click('[data-testid=export-json]', { timeout: 180000 })]);
const dlPath = path.join(OUT, '..', 'sample-report.json'); await dl.saveAs(dlPath);
ok('16 JSON export downloads a real report', JSON.parse(fs.readFileSync(dlPath, 'utf8')).verdict === 'PASS');
await page.screenshot({ path: path.join(OUT, '16-report.png'), timeout: 240000 });

} // end 16/17
if (FROM <= 18) {
// ---------------- 18. all pages ----------------
const pages = { home: 'Your home, with changes you can verify.', why: 'A fix today should not become a failure tomorrow.', replay: 'Replay Lab', requirements: 'Saved Requirements', reports: 'Reports', devices: 'Devices / Integrations', settings: 'Settings' };
for (const [id, h] of Object.entries(pages)) {
  await settle(); await page.click(`[data-testid=nav-${id}]`); await page.waitForFunction((h) => document.querySelector('h1')?.textContent.includes(h), h, { timeout: 600000, polling: 1000 });
  const cur = await page.getAttribute(`[data-testid=nav-${id}]`, 'aria-current');
  ok(`18 page ${id}: navigates, title and active nav`, cur === 'page');
  if (id !== 'home' && id !== 'replay') await page.screenshot({ path: path.join(OUT, `18-page-${id}.png`) });
}
await settle(); await page.click('[data-testid=nav-why]'); for (let i = 0; i < 6; i++) await page.click('[data-testid=why-next]');
await page.screenshot({ path: path.join(OUT, '18-why-step7.png'), timeout: 240000 });

} // end 18

// ---------------- 19. responsive ----------------
// park the main tab on a page without a 3D view so only one software-WebGL scene renders at a time
await settle(); await page.click('[data-testid=nav-settings]'); await settle();
const mob = await ctx.newPage(); await mob.setViewportSize({ width: 390, height: 844 });
mob.on('pageerror', (e) => consoleErrors.push(`mobile pageerror: ${e.message}`));
for (const id of ['home', 'replay', 'requirements', 'devices']) {
  await mob.goto(`${BASE}#/${id}`); if (id === 'home') await mob.waitForSelector('[data-testid=viewer-ready]', { state: 'attached', timeout: 240000 });
  await mob.waitForTimeout(1500);
  const over = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`19 mobile ${id}: no horizontal page scroll`, over <= 1, `overflow ${over}px`);
  await mob.screenshot({ path: path.join(OUT, `19-mobile-${id}.png`) });
}
const tab = await ctx.newPage(); await tab.setViewportSize({ width: 1024, height: 768 }); await tab.goto(`${BASE}#/home`); await tab.waitForSelector('[data-testid=viewer-ready]', { state: 'attached', timeout: 240000 }); await tab.waitForTimeout(2000);
ok('19 tablet home: no horizontal page scroll', (await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
await tab.screenshot({ path: path.join(OUT, '19-tablet-home.png'), timeout: 240000 });
// keyboard accessibility of markers
await mob.close(); await tab.close(); // three software-WebGL scenes at once starve the renderer
await settle(); await page.click('[data-testid=nav-home]'); await page.waitForSelector('[data-testid=viewer-ready]', { state: 'attached', timeout: 600000 });
const labels = await page.$$eval('.room-marker', (els) => els.map((e) => e.getAttribute('aria-label')));
ok('19 markers are buttons with accessible names', labels.length === 8 && labels.every((l) => /^Room \d: /.test(l)));

ok('19 no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
const summary = { base: BASE, resumedFromSection: FROM, when: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results, consoleErrors };
fs.writeFileSync(path.resolve('docs/e2e-results.json'), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed} passed, ${summary.failed} failed in ${summary.seconds}s`);
await browser.close();
process.exit(summary.failed ? 1 : 0);
