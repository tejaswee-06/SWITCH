// Front-end logic tests (plain Node): room navigation, selection sync, device state <-> trace,
// requirement lifecycle, regression suite semantics, day/night model, settings persistence.
import assert from 'node:assert/strict';
import { ROOM_ORDER, ROOM_INFO, stepRoom, roomNumber, roomByNumber, roomPositionLabel } from '../src/sim/rooms.js';
import { ROOMS, DEVICES, FAN_RPM, SIM_VERSION } from '../src/sim/engine.js';
import * as SW from '../src/sim/switch.js';
import { createAppStore, DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/state/appStore.js';
import { environmentFor, environmentDate, solarPosition, lightingForElevation } from '../src/sim/daylight.js';

let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '\n  ', e.stack?.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; } };
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ---------------- rooms & navigation ----------------
t('room IDs: 8 stable rooms, all known to the simulator, numbered 1..8 in order', () => {
  assert.deepEqual(ROOM_ORDER, ['living', 'kitchen', 'bedroom', 'bathroom', 'hallway', 'bedroom2', 'bedroom3', 'patio']);
  ROOM_ORDER.forEach((id, i) => { assert.ok(ROOMS[id], id); assert.ok(ROOM_INFO[id]); assert.equal(roomNumber(id), i + 1); assert.equal(roomByNumber(i + 1), id); });
  assert.equal(new Set(ROOM_ORDER).size, ROOM_ORDER.length);
});
t('previous/next wraps at both ends; position label', () => {
  assert.equal(stepRoom('living', +1), 'kitchen'); assert.equal(stepRoom('patio', +1), 'living'); assert.equal(stepRoom('living', -1), 'patio');
  let id = 'living'; for (let i = 0; i < 8; i++) id = stepRoom(id, +1); assert.equal(id, 'living');
  assert.equal(roomPositionLabel('bathroom'), '04 / 08'); assert.equal(roomPositionLabel('patio'), '08 / 08');
});
t('store: numbered marker opens that room tour; arrows step + wrap and keep room/mode in sync', () => {
  const s = createAppStore({ storage: memStorage() });
  assert.equal(s.getState().viewMode, 'exterior');
  s.actions.openRoomTour('bathroom');
  assert.equal(s.getState().roomId, 'bathroom'); assert.equal(s.getState().viewMode, 'room');
  s.actions.stepRoom(+1); assert.equal(s.getState().roomId, 'hallway');
  s.actions.stepRoom(-1); s.actions.stepRoom(-1); assert.equal(s.getState().roomId, 'bedroom');
  s.actions.setViewMode('exterior'); s.actions.selectRoom('patio'); s.actions.stepRoom(+1);
  assert.equal(s.getState().roomId, 'living'); assert.equal(s.getState().viewMode, 'room', 'arrows from the exterior open the tour');
  s.actions.setViewMode('cutaway'); s.actions.selectRoom('bedroom3'); assert.equal(s.getState().cutLevel, 1); s.actions.stepRoom(+1);
  assert.equal(s.getState().viewMode, 'cutaway'); assert.equal(s.getState().roomId, 'patio');
});
t('store: selecting a device selects its room (panel, markers and camera share one selection)', () => {
  const s = createAppStore({ storage: memStorage() });
  s.actions.selectDevice('fanBedroom3'); assert.equal(s.getState().roomId, 'bedroom3'); assert.equal(s.getState().deviceId, 'fanBedroom3');
  s.actions.selectRoom('kitchen'); assert.equal(s.getState().deviceId, null, 'device in another room is deselected');
  s.actions.selectDevice('ghost'); assert.equal(s.getState().deviceId, null);
});

// ---------------- devices through the simulator ----------------
t('independent light controls; UI action -> sim state -> trace event (single source of truth)', () => {
  const s = createAppStore({ storage: memStorage() });
  const lights = Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'light');
  assert.equal(lights.length, 8);
  s.actions.setPower('hallwayLight', true); s.actions.setPower('bedroom2Light', true);
  s.actions.setPower('hallwayLight', false);
  const st = s.sim.state.devices; assert.equal(st.hallwayLight.on, false); assert.equal(st.bedroom2Light.on, true); assert.equal(st.bathroomLight.on, false);
  const ev = s.queries.eventsFor({ device: 'hallwayLight' }); assert.equal(ev[0].to, false); assert.equal(ev[1].to, true); assert.equal(ev[0].source, 'user');
  assert.ok(ev[0].seq > ev[1].seq);
});
t('fan speed: speed changes the modeled rpm; off stops it', () => {
  const s = createAppStore({ storage: memStorage() });
  s.actions.setFanSpeed('fanLiving', 'medium'); assert.equal(FAN_RPM[s.sim.state.devices.fanLiving.speed], 120);
  s.actions.setFanSpeed('fanLiving', 'high'); assert.ok(FAN_RPM[s.sim.state.devices.fanLiving.speed] > 120);
  s.actions.setFanSpeed('fanLiving', 'off'); assert.equal(FAN_RPM[s.sim.state.devices.fanLiving.speed], 0); assert.equal(s.sim.state.devices.fanLiving.on, false);
  assert.equal(s.sim.state.devices.fanBedroom1.speed, 'off', 'other fans unaffected');
});
t('AC: target setting + gradual modeled temperature via the store clock', () => {
  const s = createAppStore({ storage: memStorage() });
  s.actions.setAC('acBedroom2', { on: true, target: 19 });
  const t0 = s.sim.state.rooms.bedroom2.temp; s.actions.tick(30); const t1 = s.sim.state.rooms.bedroom2.temp; s.actions.tick(1200); const t2 = s.sim.state.rooms.bedroom2.temp;
  assert.ok(t1 < t0 && t0 - t1 < 0.5, 'not instant'); assert.ok(t2 < t1 && t2 > 19);
  assert.equal(s.sim.state.devices.acBedroom2.target, 19);
});
t('trace records only real transitions; house routine uses the LIVE (guarded) Goodnight', () => {
  const s = createAppStore({ storage: memStorage() });
  s.actions.setPower('hallwayLight', true); s.actions.motion('hallway', true); s.actions.runLiveRoutine('goodnight');
  assert.equal(s.sim.state.devices.hallwayLight.on, true, 'guard kept the hallway light on');
  assert.ok(s.sim.trace.some((e) => e.kind === 'condition' && e.device === 'hallwayLight' && e.ok === false));
});

// ---------------- requirement lifecycle ----------------
t('drafts are not active; unsupported text stays a draft needing clarification', () => {
  const s = createAppStore({ storage: memStorage() });
  const before = s.queries.activeRequirements().length;
  const { draft } = s.actions.draftFromText('Make the lights cosy');
  assert.equal(draft.status, 'DRAFT'); assert.equal(draft.needsClarification, true);
  assert.throws(() => s.actions.confirmDraft(draft.draftId), /clarification/);
  assert.equal(s.queries.activeRequirements().length, before);
  s.actions.clarifyDraft(draft.draftId, { kind: 'never_off_while_occupied', room: 'kitchen' });
  const v = s.actions.confirmDraft(draft.draftId); assert.equal(v.status, 'CONFIRMED'); assert.equal(v.version, 1);
  assert.equal(s.queries.activeRequirements().length, before + 1);
});
t('stable IDs, edit -> new version with history, disable/retire not enforced', () => {
  const st = new SW.RequirementStore();
  const d = st.createDraft(SW.parseCorrection("Don't turn off the hallway light while someone is there."));
  const v1 = st.confirmDraft(d.draftId, { confirmed: true }); assert.match(v1.id, /^REQ-\d{3}$/);
  assert.throws(() => st.edit(v1.id, { title: 'x' }, {}), /confirmation/);
  const v2 = st.edit(v1.id, { title: 'Hallway light stays on when someone is there' }, { confirmed: true });
  assert.equal(v2.id, v1.id); assert.equal(v2.version, 2); assert.equal(st.history(v1.id).length, 2); assert.equal(st.history(v1.id)[0].title, v1.title);
  st.setStatus(v1.id, 'DISABLED'); assert.equal(st.active().length, 0); assert.equal(st.latest(v1.id).version, 3);
  st.setStatus(v1.id, 'CONFIRMED'); assert.equal(st.active().length, 1);
  st.setStatus(v1.id, 'RETIRED'); assert.equal(st.active().length, 0); assert.throws(() => st.setStatus(v1.id, 'CONFIRMED'));
  const sel = SW.selectRequirements(st.all(), SW.GOODNIGHT_CANDIDATE); assert.equal(sel.selected.length, 0); assert.match(sel.skipped[0].reason, /RETIRED/);
});

// ---------------- end-to-end demo path through the store ----------------
t('demo: correction -> confirm -> candidate FAIL (right reason) -> fix -> rerun PASS -> approve', () => {
  const s = createAppStore({ storage: memStorage() });
  const { draft } = s.actions.draftFromText("Don't turn off the hallway light while someone is there.");
  assert.equal(draft.needsClarification, false); assert.equal(draft.assertion.device, 'hallwayLight');
  const req = s.actions.confirmDraft(draft.draftId);
  assert.ok(s.queries.requirementsAtRisk().some((r) => r.req.id === req.id && r.tone === 'review'), 'pending edit flags the requirement');
  const diff = SW.routineDiff(s.getState().live.goodnight, s.getState().lab.candidate);
  assert.equal(diff.changed, 1); assert.equal(diff.rows[2].type, 'changed'); assert.match(diff.rows[2].before, /unless Hallway/); assert.doesNotMatch(diff.rows[2].after, /unless/);
  const r1 = s.actions.runReplay();
  assert.equal(r1.verdict, 'FAIL'); const f = r1.cases.find((c) => c.result === 'FAIL');
  assert.equal(f.requirement, req.id); assert.equal(f.offending.device, 'hallwayLight'); assert.equal(f.offending.step, 2); assert.equal(f.scenario, 'goodnight-hallway-occupied');
  assert.equal(r1.cases.filter((c) => c.result === 'FAIL').length, 1, 'only the hallway requirement fails');
  assert.deepEqual(s.getState().highlight && [s.getState().highlight.device, s.getState().highlight.seq], ['hallwayLight', f.offending.seq]);
  assert.equal(s.queries.requirements().find((r) => r.id === req.id).lastResult.result, 'FAIL');
  assert.throws(() => s.actions.decide('approved'), /FAIL/);
  s.actions.applySuggestedFix();
  assert.throws(() => s.actions.decide('approved'), /Replay the current candidate/, 'fix is not verified until rerun');
  const r2 = s.actions.rerunSuite();
  assert.equal(r2.verdict, 'PASS'); assert.equal(r2.counts.FAIL, 0); assert.ok(r2.cases.length >= 3, 'whole relevant suite, not one assertion');
  assert.ok(r2.replays['goodnight-hallway-occupied'].trace.some((e) => e.kind === 'step_skipped' && e.device === 'hallwayLight'));
  const dec = s.actions.decide('approved', { note: 'guard restored' });
  assert.equal(dec.decision, 'approved'); assert.equal(s.queries.run(r2.runId).decision.decision, 'approved');
  assert.equal(s.getState().live.goodnight.version, r2.routine.version);
});
t('INCONCLUSIVE when occupancy is unknown — never a false PASS', () => {
  const s = createAppStore({ storage: memStorage() });
  const { draft } = s.actions.draftFromText("Don't turn off the hallway light while someone is there."); s.actions.confirmDraft(draft.draftId);
  s.actions.setExtraScenarios(['goodnight-hallway-sensor-offline']);
  s.actions.applySuggestedFix(); // nothing to fix yet -> warns, candidate unchanged
  assert.equal(s.getState().lab.candidate.version, 'v3-candidate');
  const run = s.actions.runReplay();
  const off = run.cases.filter((c) => c.scenario === 'goodnight-hallway-sensor-offline' && c.device === 'hallwayLight');
  assert.equal(off.length, 1); assert.equal(off[0].result, 'INCONCLUSIVE');
  const fixed = SW.runSuite({ routine: SW.GOODNIGHT_FIXED, requirements: s.queries.activeRequirements(), extraScenarioIds: ['goodnight-hallway-sensor-offline'] });
  assert.equal(fixed.cases.find((c) => c.scenario === 'goodnight-hallway-sensor-offline' && c.device === 'hallwayLight').result, 'INCONCLUSIVE');
  assert.equal(fixed.verdict, 'INCONCLUSIVE');
});
t('state_after_routine assertions: PASS when met, FAIL with evidence when violated', () => {
  // living lights start ON in the scenario; Goodnight must leave them OFF
  const req = new SW.RequirementStore().confirm(SW.buildDraft({ kind: 'state_after_routine', device: 'livingLight', routine: 'goodnight', expectOn: false }), { confirmed: true });
  const ok = SW.replay(SW.SCENARIO_GOODNIGHT_EMPTY, SW.GOODNIGHT_FIXED, [req]); assert.equal(ok.results[0].result, 'PASS');
  const broken = { ...SW.GOODNIGHT_FIXED, version: 'vX', steps: SW.GOODNIGHT_FIXED.steps.filter((x) => x.device !== 'livingLight') };
  const bad = SW.replay(SW.SCENARIO_GOODNIGHT_EMPTY, broken, [req]); assert.equal(bad.results[0].result, 'FAIL'); assert.ok(bad.results[0].offending);
});
t('report: reproducible metadata + markdown export', () => {
  const a = SW.runSuite({ routine: SW.GOODNIGHT_CANDIDATE, requirements: SW.seedDemoRequirements(new SW.RequirementStore()).active(), runId: 'RUN-X', base: SW.GOODNIGHT_LIVE });
  const b = SW.runSuite({ routine: SW.GOODNIGHT_CANDIDATE, requirements: SW.seedDemoRequirements(new SW.RequirementStore()).active(), runId: 'RUN-X', base: SW.GOODNIGHT_LIVE });
  assert.deepEqual(Object.values(a.replays).map((r) => r.hash), Object.values(b.replays).map((r) => r.hash));
  assert.equal(a.simulator, SIM_VERSION); assert.ok(a.scenarios.every((s) => s.version)); assert.ok(a.requirements.every((r) => r.version));
  const md = SW.reportToMarkdown(a); assert.match(md, /SIMULATED DEMO/); assert.match(md, /RUN-X/); assert.match(md, /goodnight@v3-candidate/);
});
t('stateAt reconstructs the modeled state after any trace event (used to scrub a replay in 3D)', () => {
  const rp = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_FAULTY, []);
  const last = SW.stateAt(rp.initial, rp.trace);
  for (const id of Object.keys(DEVICES)) assert.equal(!!(last.devices[id].on || last.devices[id].open), !!(rp.final.devices[id].on || rp.final.devices[id].open), id);
  const off = rp.trace.find((e) => e.kind === 'device' && e.device === 'hallwayLight');
  assert.equal(SW.stateAt(rp.initial, rp.trace, off.seq - 1).devices.hallwayLight.on, true);
  assert.equal(SW.stateAt(rp.initial, rp.trace, off.seq).devices.hallwayLight.on, false);
  assert.equal(SW.scenarioClock('23:00:00', 65), '23:01:05');
});

// ---------------- day / night ----------------
t('daylight: noon is day, midnight is night, sunrise brightens monotonically', () => {
  const at = (h, m = 0) => new Date(2026, 9, 22, h, m);
  assert.ok(solarPosition(at(12), 20).elevation > 40); assert.ok(solarPosition(at(0), 20).elevation < -40);
  assert.equal(environmentFor(at(12)).isNight, false); assert.equal(environmentFor(at(0)).isNight, true);
  let prev = -1; for (let m = 4 * 60; m <= 9 * 60; m += 15) { const e = environmentFor(at(Math.floor(m / 60), m % 60)); assert.ok(e.sunIntensity >= prev - 1e-9); prev = e.sunIntensity; }
  assert.ok(environmentFor(at(12)).hemiIntensity > environmentFor(at(22)).hemiIntensity * 3);
  const L = lightingForElevation(-3); assert.ok(L.stars > 0 && L.stars < 1, 'twilight blends');
});
t('auto vs manual time are separate; auto follows the given clock, manual ignores it', () => {
  const now = new Date(2026, 9, 22, 14, 5);
  assert.equal(environmentDate({ mode: 'auto' }, now), now);
  const m = environmentDate({ mode: 'manual', time: '21:30', date: '2026-01-15' }, now);
  assert.equal(m.getHours(), 21); assert.equal(m.getMinutes(), 30); assert.equal(m.getMonth(), 0);
  assert.equal(environmentDate({ mode: 'manual', time: '21:30' }, new Date(2026, 9, 23, 3, 0)).getHours(), 21);
});
t('settings: auto time is the first-launch default and settings persist; device state is untouched by time changes', () => {
  const storage = memStorage();
  const s = createAppStore({ storage });
  assert.equal(s.getState().settings.timeMode, 'auto'); assert.equal(DEFAULT_SETTINGS.timeMode, 'auto');
  s.actions.setPower('kitchenLight', false);
  s.actions.updateSettings({ timeMode: 'manual', manualTime: '22:00', reducedMotion: 'on' });
  assert.equal(s.sim.state.devices.kitchenLight.on, false, 'night does not switch lights on');
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).timeMode, 'manual');
  const s2 = createAppStore({ storage }); assert.equal(s2.getState().settings.manualTime, '22:00'); assert.equal(s2.getState().settings.reducedMotion, 'on');
  s2.actions.resetSettings(); assert.equal(s2.getState().settings.timeMode, 'auto');
});
t('store works without storage (private mode): settings are session-only', () => {
  const s = createAppStore({ storage: null }); s.actions.updateSettings({ quality: 'low' }); assert.equal(s.getState().settings.quality, 'low');
});
t('fullscreen state handling is explicit and idempotent', () => {
  const s = createAppStore({ storage: memStorage() }); let n = 0; s.subscribe(() => n++);
  s.actions.setFullscreen(true); s.actions.setFullscreen(true); assert.equal(s.getState().fullscreen, true); assert.equal(n, 1);
  s.actions.setFullscreen(false); assert.equal(s.getState().fullscreen, false);
});

console.log(`\n${pass} passed`);
