import assert from 'node:assert/strict';
import { Sim, createInitialState, traceHash, THERMAL, FAN_RPM } from '../src/sim/engine.js';
import * as SW from '../src/sim/switch.js';
let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '\n  ', e.message); process.exitCode = 1; } };

t('lights toggle independently + trace', () => {
  const s = new Sim(); s.dispatch({ type: 'power', id: 'bedroomLight', on: true });
  assert.equal(s.state.devices.bedroomLight.on, true); assert.equal(s.state.devices.bathroomLight.on, false);
  s.dispatch({ type: 'power', id: 'bedroomLight', on: false });
  const ev = s.trace.filter((e) => e.kind === 'device'); assert.deepEqual(ev.map((e) => e.to), [true, false]); assert.ok(ev[0].seq < ev[1].seq);
});
t('light power accounting', () => { const s = new Sim(); const p0 = s.power().total; s.dispatch({ type: 'power', id: 'patioLight', on: true }); assert.equal(Math.round((s.power().total - p0) * 10) / 10, 15); });
t('fan speeds/off', () => { const s = new Sim(); s.dispatch({ type: 'power', id: 'fanLiving', on: true }); assert.equal(s.state.devices.fanLiving.speed, 'low'); s.dispatch({ type: 'fanSpeed', id: 'fanLiving', speed: 'high' }); assert.equal(s.state.devices.fanLiving.speed, 'high'); assert.ok(FAN_RPM.high > FAN_RPM.low); s.dispatch({ type: 'power', id: 'fanLiving', on: false }); assert.equal(s.state.devices.fanLiving.speed, 'off'); });
t('AC gradual cooling, not instant', () => {
  const s = new Sim(); s.dispatch({ type: 'ac', id: 'ac', patch: { target: 20 } }); const t0 = s.state.rooms.living.temp;
  s.step(60); const t1 = s.state.rooms.living.temp; s.step(600); const t2 = s.state.rooms.living.temp; s.step(3000); const t3 = s.state.rooms.living.temp;
  assert.ok(t1 < t0 && t1 > 20 + 1, `t1=${t1}`); assert.ok(t2 < t1 && t3 < t2); assert.ok(t0 - t1 < 1, 'not instant');
});
t('AC off => room drifts toward ambient', () => { const s = new Sim(); s.dispatch({ type: 'ac', id: 'ac', patch: { on: false } }); const a = s.state.rooms.living.temp; s.step(1800); assert.ok(s.state.rooms.living.temp > a); });
t('AC power: duty-based, zero when off', () => { const s = new Sim(); s.step(30); assert.ok(s.power().by.ac > THERMAL.acBaseW); s.dispatch({ type: 'ac', id: 'ac', patch: { on: false } }); assert.equal(s.power().by.ac, 0); });
t('energy integrates deterministically', () => { const a = new Sim(), b = new Sim(); a.step(3600); b.step(3600); assert.equal(a.state.energyWh, b.state.energyWh); assert.ok(a.state.energyWh > 0); });
t('motion -> occupancy -> routine -> light ON -> ordered trace', () => {
  const s = new Sim({ routines: [SW.LIVING_WELCOME] }); s.dispatch({ type: 'power', id: 'livingLight', on: false });
  s.addAutomation({ id: 'welcome', trigger: { type: 'motion', room: 'living', active: true }, routineId: 'livingWelcome' });
  s.dispatch({ type: 'motion', room: 'living', active: true });
  assert.equal(s.state.rooms.living.occupied, true); assert.equal(s.state.devices.livingLight.on, true);
  const kinds = s.trace.map((e) => e.kind); assert.deepEqual(kinds.slice(-5), ['motion', 'occupancy', 'routine_start', 'device', 'routine_end']);
  assert.deepEqual(s.trace.map((e) => e.seq), s.trace.map((_, i) => i + 1));
});
t('doors', () => { const s = new Sim(); s.dispatch({ type: 'door', id: 'doorLiving', open: true }); assert.equal(s.isOn('doorLiving'), true); });
t('unknown device is an error event, not a silent success', () => { const s = new Sim(); assert.equal(s.dispatch({ type: 'power', id: 'nope', on: true }), false); assert.equal(s.trace.at(-1).kind, 'error'); });

const store = new SW.RequirementStore();
t('correction parsed to structured draft', () => { const r = SW.parseCorrection("Don't turn off the hallway light while someone is there."); assert.equal(r.supported, true); assert.equal(r.draft.device, 'hallwayLight'); assert.equal(r.draft.room, 'hallway'); });
t('unsupported correction is rejected (no silent pass)', () => { assert.equal(SW.parseCorrection('make it cozier').supported, false); });
t('confirmation is mandatory', () => { const d = SW.parseCorrection("Don't turn off the hallway light while someone is there.").draft; assert.throws(() => store.confirm(d, {})); assert.equal(store.all().length, 0); });
let req;
t('confirmed -> versioned', () => { const d = SW.parseCorrection("Don't turn off the hallway light while someone is there.").draft; req = store.confirm(d, { confirmed: true, at: 1 }); assert.equal(req.version, 1); const v2 = store.confirm(d, { confirmed: true, at: 2 }); assert.equal(v2.version, 2); assert.equal(store.history(req.id).length, 2); req = v2; });
let faulty;
t('faulty Goodnight FAILS, offending transition identified', () => {
  faulty = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_FAULTY, [req]);
  const r = faulty.results[0]; assert.equal(r.result, 'FAIL'); assert.equal(r.offending.device, 'hallwayLight'); assert.equal(r.offending.step, 2); assert.equal(r.offending.routine, 'goodnight@v1-faulty');
});
t('replay determinism: identical inputs => identical trace hash', () => { const b = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_FAULTY, [req]); assert.equal(b.hash, faulty.hash); assert.deepEqual(b.trace, faulty.trace); });
t('repair proposal + approval gate', () => {
  const p = SW.suggestRepair(SW.GOODNIGHT_FAULTY, faulty.results[0]); assert.ok(p.diff.includes('unlessOccupied')); assert.throws(() => SW.approveRepair(p, {}));
  const ap = SW.approveRepair(p, { approved: true }); const rr = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, ap.routine, [req]); assert.equal(rr.results[0].result, 'PASS');
});
t('corrected routine PASSES only because guard blocks the off', () => { const r = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_FIXED, [req]); assert.equal(r.results[0].result, 'PASS'); assert.ok(r.trace.some((e) => e.kind === 'step_skipped' && e.device === 'hallwayLight')); assert.equal(r.trace.some((e) => e.kind === 'device' && e.device === 'hallwayLight' && e.to === false), false); });
t('vacuous scenario (nobody present) is INCONCLUSIVE, not PASS', () => { const sc = { ...SW.SCENARIO_GOODNIGHT_HALLWAY, setup: [] }; const r = SW.replay(sc, SW.GOODNIGHT_FIXED, [req]); assert.equal(r.results[0].result, 'INCONCLUSIVE'); });
t('unsupported assertion/device is INCONCLUSIVE', () => { const bad = { ...req, assertion: { type: 'never_off_while_occupied', room: 'hallway', device: 'ghost' } }; assert.equal(SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_FIXED, [bad]).results[0].result, 'INCONCLUSIVE'); assert.equal(SW.evaluate({ ...req, assertion: { type: 'other' } }, [], {}).result, 'INCONCLUSIVE'); });
console.log(`\n${pass} passed`);
