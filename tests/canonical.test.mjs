// Canonical contract + backend->view mapping tests (plain Node). Payloads come from the REAL backend
// (switch_backend/scripts/record_fixtures.py -> tests/fixtures/backend_journey.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANONICAL_HOME } from '../src/contracts/canonicalHome.js';
import { DEVICES, ROOMS } from '../src/sim/engine.js';
import { ROOM_ORDER } from '../src/sim/rooms.js';
import { stateAt } from '../src/sim/switch.js';
import { describeEvent } from '../src/ui/format.js';
import * as M from '../src/api/canonicalMap.js';

let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '\n  ', e.stack?.split('\n').slice(0, 4).join('\n   ')); process.exitCode = 1; } };
const fx = JSON.parse(readFileSync(new URL('./fixtures/backend_journey.json', import.meta.url), 'utf8'));
const json = JSON.parse(readFileSync(new URL('../contracts/canonical_home.json', import.meta.url), 'utf8'));
const ctx = (extraCands = []) => {
  const cands = [...fx.candidates_final, ...extraCands];
  return {
    scenarios: Object.fromEntries(fx.scenarios.map((s) => [s.scenario_id, s])),
    requirements: Object.fromEntries(fx.requirements_final.map((r) => [r.requirement_id, r])),
    routineRaw: (rid, v) => fx.routines.find((r) => r.routine_id === rid && r.version === v) || cands.find((c) => c.routine_id === rid && c.version === v)?.routine || null,
  };
};

t('generated src/contracts/canonicalHome.js equals contracts/canonical_home.json (run tools/sync_contract.mjs after edits)', () => {
  assert.deepEqual(CANONICAL_HOME, json);
});
t('contract maps every browser-simulator device and room exactly once', () => {
  const fe = CANONICAL_HOME.devices.map((d) => d.fe_id).filter(Boolean);
  assert.deepEqual([...fe].sort(), Object.keys(DEVICES).sort());
  assert.deepEqual(CANONICAL_HOME.rooms.slice().sort((a, b) => a.number - b.number).map((r) => r.room_id), ROOM_ORDER);
  for (const r of ROOM_ORDER) { assert.ok(ROOMS[r]); assert.equal(M.occRoom(`${r}_occupancy`), r); assert.equal(M.feId(`${r}_light`), `${r}Light`); }
  assert.equal(M.feId('front_door'), null, 'modeled lock has no 3D fixture and is not silently mapped to a glass door');
  assert.equal(M.canonId('hallwayLight'), 'hallway_light'); assert.equal(M.canonId('security'), 'security');
});
t('backend routines map to browser steps with occupancy guards (executable by the house simulator)', () => {
  const v = M.routineToView(fx.routines.find((r) => r.routine_id === 'goodnight'));
  assert.equal(v.version, 'v1');
  assert.deepEqual(v.steps.map((s) => [s.do, s.device, s.on]), [['power', 'livingLight', false], ['power', 'kitchenLight', false], ['power', 'hallwayLight', false], ['power', 'tv', false], ['power', 'security', true]]);
  assert.deepEqual(v.steps[2].guard, { type: 'unlessOccupied', room: 'hallway' });
  const cand = M.candidateToView(fx.candidates_initial[0]);
  assert.equal(cand.routine.steps[2].guard, undefined, 'the faulty candidate lost the guard');
  assert.equal(cand.status, 'PENDING_REVIEW');
});
t('requirements map without inventing fields; drafts and clarifications are distinct', () => {
  const hall = M.requirementToView(fx.confirmed);
  assert.equal(hall.status, 'CONFIRMED'); assert.equal(hall.device, 'hallwayLight'); assert.equal(hall.room, 'hallway');
  assert.deepEqual(hall.preconditions, ['Hallway is occupied']);
  assert.match(hall.expectedBehavior, /Hallway lights to OFF/);
  assert.equal(hall.lastResult, null);
  const d = M.storedDraftToView(fx.draft);
  assert.equal(d.stored, true); assert.equal(d.draftId, fx.draft.requirement_id); assert.equal(d.needsClarification, false);
  const c = M.proposalToClarification(fx.interpret_ambiguous, 1);
  assert.equal(c.stored, false); assert.equal(c.needsClarification, true); assert.equal(c.questions[0].answer_key, 'device_id');
  assert.ok(c.questions[0].options.some((o) => o.value === 'hallway_light'));
  const dis = M.requirementToView(fx.requirements_final.find((r) => r.requirement_id === 'req-bathroom-light-on'));
  assert.equal(dis.status, 'DISABLED');
});
t('FAIL report -> run view: verdict/counts copied from the evaluator, offending event is the hallway light-off', () => {
  const r = M.runToView(fx.report_fail, ctx());
  assert.equal(r.verdict, fx.report_fail.suite.overall); assert.equal(r.verdict, 'FAIL');
  assert.deepEqual(r.counts, { PASS: fx.report_fail.suite.totals.PASS, FAIL: fx.report_fail.suite.totals.FAIL, INCONCLUSIVE: fx.report_fail.suite.totals.INCONCLUSIVE });
  const f = r.cases.find((c) => c.result === 'FAIL');
  assert.equal(f.requirement, fx.confirmed.requirement_id); assert.equal(f.device, 'hallwayLight'); assert.equal(f.room, 'hallway');
  assert.equal(f.offending.event_id, fx.report_fail.failure_evidence[0].events[0].event_id);
  assert.equal(f.offending.kind, 'device'); assert.equal(f.offending.from, true); assert.equal(f.offending.to, false);
  assert.equal(f.offending.step, 2, 'action a3 is step 2 of the routine');
  assert.match(describeEvent(f.offending), /Hallway lights ON → OFF/);
  const rp = r.replays[f.scenario];
  assert.deepEqual(rp.trace.slice(0, 3).map((e) => e.kind), ['occupancy', 'scenario_event', 'routine_start']);
  assert.equal(rp.trace[0].to, true, 'occupancy=true precedes the routine');
  const before = stateAt(rp.initial, rp.trace, f.offending.seq - 1); const after = stateAt(rp.initial, rp.trace, f.offending.seq);
  assert.equal(before.devices.hallwayLight.on, true); assert.equal(after.devices.hallwayLight.on, false); assert.equal(after.rooms.hallway.occupied, true);
  assert.ok(r.diff && r.diff.changed === 1 && /unless Hallway/.test(r.diff.rows.find((x) => x.type === 'changed').before));
  assert.equal(r.skipped.some((s) => s.id === 'req-bathroom-light-on'), true, 'disabled requirement is listed, not silently dropped');
  assert.equal(r.decision, null);
});
t('PASS report after repair: decision, provenance and integration metadata carried through', () => {
  const r = M.runToView(fx.report_pass, ctx());
  assert.equal(r.verdict, 'PASS'); assert.equal(r.counts.FAIL, 0); assert.equal(r.fixApplied, true);
  assert.equal(r.decision.decision, 'approved'); assert.equal(r.decision.runId, fx.report_pass.run_id);
  assert.equal(r.repairProvenance.validator.status, 'passed'); assert.equal(r.repairProvenance.ai_model_used, false);
  assert.equal(r.integration.integration_mode, 'simulated_demo');
  assert.equal(r.comparison.fixed[0].requirement_id, fx.confirmed.requirement_id);
});
t('exploratory edge-case report keeps INCONCLUSIVE and unknown occupancy stays unknown in the house state', () => {
  const r = M.runToView(fx.report_exploratory, ctx());
  assert.equal(r.verdict, 'INCONCLUSIVE'); assert.equal(r.kind, 'exploratory');
  const unk = r.cases.find((c) => c.scenario === 'sc-hallway-sensor-offline' && c.result === 'INCONCLUSIVE');
  assert.ok(unk, 'edge case is INCONCLUSIVE');
  assert.equal(r.replays['sc-hallway-sensor-offline'].initial.rooms.hallway.occupied, null);
  assert.ok(r.scenarios.find((s) => s.id === 'sc-hallway-sensor-offline').edgeCase);
});
t('every recorded report verdict is copied verbatim (mapping never re-evaluates)', () => {
  for (const k of ['report_fail', 'report_pass', 'report_exploratory']) {
    const r = M.runToView(fx[k], ctx());
    assert.equal(r.verdict, fx[k].suite.overall);
    fx[k].suite.tests.forEach((tt, i) => assert.equal(r.cases[i].result, tt.status));
  }
});
t('state mapping: devices absent from a scenario render OFF; unknown sensor values stay null', () => {
  const s = M.stateToView({ hallway_light: { power: 'on' }, hallway_occupancy: { occupied: null }, security: { armed: true } });
  assert.equal(s.devices.hallwayLight.on, true); assert.equal(s.devices.security.on, true); assert.equal(s.devices.purifier.on, false);
  assert.equal(s.rooms.hallway.occupied, null); assert.equal(s.rooms.kitchen.occupied, null);
});
console.log(`\n${pass} passed`);
