// Integration test: the browser store driven through the REAL backend (spawned locally) for the whole canonical
// journey, reset and repeat; plus the offline fallback. Needs Python with switch_backend/requirements.txt installed.
// Python is taken from $SWITCH_PYTHON, else switch_backend/.venv, else python3. If the backend cannot start, the test
// reports SKIPPED with the reason and exits non-zero only when SWITCH_REQUIRE_BACKEND=1.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createAppStore } from '../src/state/appStore.js';
import { createBackendApi } from '../src/api/switchBackend.js';
import { stateAt } from '../src/sim/switch.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const py = process.env.SWITCH_PYTHON || [`${root}switch_backend/.venv/bin/python`, `${root}switch_backend/.venv/Scripts/python.exe`].find(existsSync) || 'python3';

let pass = 0; const results = [];
async function t(name, fn) { try { await fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '\n  ', e.stack?.split('\n').slice(0, 4).join('\n   ')); process.exitCode = 1; } results.push(name); }
async function waitFor(pred, ms = 8000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition'); await sleep(25); } }

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const proc = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'switch_backend', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'],
  { cwd: root, env: { ...process.env, SWITCH_DB: ':memory:', SWITCH_ENV: 'demo', SWITCH_DEMO_PROFILE: 'journey' }, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; proc.stderr.on('data', (d) => { stderr += d; });
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`${base}/health`)).ok; } catch { await sleep(100); } }
if (!up) {
  console.log(`SKIPPED backend_store tests: backend did not start with "${py}". ${stderr.split('\n').slice(-3).join(' ')}`);
  proc.kill(); process.exit(process.env.SWITCH_REQUIRE_BACKEND === '1' ? 1 : 0);
}

const api = createBackendApi({ base });
const store = createAppStore({ storage: memStorage(), backend: api });
const S = () => store.getState(); const A = store.actions; const Q = store.queries;
const HALL = "Don't turn off the hallway light while someone is there.";
let firstFail;

async function journeyToFail() {
  const { draft, parsed } = await A.draftFromText("Don't turn off the light while someone is there");
  assert.equal(parsed.supported, false, 'ambiguous correction is not saved');
  assert.equal(draft.stored, false); assert.equal(draft.questions[0].answer_key, 'device_id');
  assert.equal(Q.drafts().filter((d) => d.stored).length, 0);
  const stored = await A.clarifyDraft(draft.draftId, { device_id: 'hallway_light' });
  assert.equal(stored.status, 'DRAFT'); assert.ok(Q.drafts().some((d) => d.draftId === stored.draftId && d.stored));
  assert.ok(!Q.activeRequirements().some((r) => r.id === stored.draftId), 'drafts are never enforced');
  const conf = await A.confirmDraft(stored.draftId);
  assert.equal(conf.status, 'CONFIRMED'); assert.equal(conf.version, 1);
  const run = await A.runReplay();
  return { conf, run };
}

await t('connects to the canonical backend; seeded journey state is visible', async () => {
  await waitFor(() => S().mode === 'backend');
  assert.equal(Q.mode(), 'backend'); assert.equal(S().backend.status, 'online');
  assert.deepEqual(Q.requirements().map((r) => [r.id, r.status]).sort(), [['req-bathroom-light-on', 'DISABLED'], ['req-living-light-off', 'CONFIRMED'], ['req-security-armed', 'CONFIRMED']]);
  assert.equal(S().lab.candidateId, 'cand-demo-faulty'); assert.equal(S().lab.candidate.version, 'v2');
  assert.equal(S().live.goodnight.steps[2].guard.type, 'unlessOccupied', 'live (baseline) Goodnight keeps the guard');
  assert.equal(store.sim.routines.get('goodnight').version, 'v1', 'house simulator runs the canonical baseline routine');
});
await t('correction -> clarification -> draft -> explicit confirmation -> FAIL with exact evidence', async () => {
  const { conf, run } = await journeyToFail();
  assert.equal(run.verdict, 'FAIL'); assert.equal(run.counts.FAIL, 1);
  const f = run.cases.find((c) => c.result === 'FAIL');
  assert.equal(f.requirement, conf.id); assert.equal(f.device, 'hallwayLight');
  assert.equal(S().highlight.device, 'hallwayLight'); assert.equal(S().roomId, 'hallway');
  const rp = run.replays[f.scenario];
  const at = stateAt(rp.initial, rp.trace, f.offending.seq);
  assert.equal(at.devices.hallwayLight.on, false); assert.equal(at.rooms.hallway.occupied, true);
  assert.equal(Q.requirements().find((r) => r.id === conf.id).lastResult.result, 'FAIL');
  assert.ok(Q.requirementsAtRisk().some((r) => r.req.id === conf.id && r.tone === 'fail'));
  firstFail = { evidence: f.offending.event_id, hash: f.traceHash };
});
await t('suggested fix is a reviewable diff, unverified until rerun; approval is gated', async () => {
  const proposal = await A.applySuggestedFix();
  assert.equal(S().lab.candidate.version, 'v3'); assert.equal(S().lab.fixApplied, true);
  assert.ok(proposal.structured.rows.some((r) => r.type === 'changed' && /unless Hallway/.test(r.after)));
  assert.match(proposal.explanation, /NOT verified/); assert.equal(proposal.provenance.validator.status, 'passed');
  await assert.rejects(() => A.decide('approved'), /Replay the current candidate/);
  const rerun = await A.rerunSuite();
  assert.equal(rerun.verdict, 'PASS'); assert.deepEqual(rerun.counts, { PASS: 5, FAIL: 0, INCONCLUSIVE: 0 });
  assert.equal(rerun.routine.version, 'v3');
  const d = await A.decide('approved', { note: 'guard restored' });
  assert.equal(d.decision, 'approved'); assert.equal(Q.latestRun().decision.decision, 'approved');
  assert.equal(S().runs.length, 2);
});
await t('exploratory edge case: unknown sensor -> INCONCLUSIVE, never PASS', async () => {
  A.setExtraScenarios(['sc-hallway-sensor-offline']);
  const ex = await A.runReplay();
  assert.equal(ex.kind, 'exploratory'); assert.equal(ex.verdict, 'INCONCLUSIVE');
  assert.ok(ex.cases.some((c) => c.scenario === 'sc-hallway-sensor-offline' && c.result === 'INCONCLUSIVE'));
  A.setExtraScenarios([]);
});
await t('reset demo -> identical journey reproduces the same evidence and trace hash', async () => {
  await A.resetDemoData();
  assert.equal(S().runs.length, 0); assert.equal(Q.requirements().length, 3); assert.equal(S().lab.candidateId, 'cand-demo-faulty');
  const { run } = await journeyToFail();
  const f = run.cases.find((c) => c.result === 'FAIL');
  assert.equal(f.offending.event_id, firstFail.evidence); assert.equal(f.traceHash, firstFail.hash);
});
await t('structured edit creates a new confirmed version; disable/re-enable keep history', async () => {
  const r = Q.requirements().find((x) => x.id === 'req-living-light-off');
  const e = await A.editRequirement(r.id, { title: 'Living room lights are off after Goodnight (edited)' }, true);
  assert.equal(e.version, 2); assert.equal(e.status, 'CONFIRMED');
  const hist = await A.loadHistory(r.id);
  assert.deepEqual(hist.map((h) => h.version), [1, 2]);
  assert.equal((await A.setRequirementStatus(r.id, 'DISABLED')).status, 'DISABLED');
  assert.equal((await A.setRequirementStatus(r.id, 'CONFIRMED')).status, 'CONFIRMED');
});
await t('unsupported correction is reported, never fabricated into a requirement', async () => {
  const n = Q.requirements().length;
  const { parsed, draft } = await A.draftFromText("Don't let the fan turn off");
  assert.equal(parsed.supported, false); assert.equal(draft.unsupported, true); assert.match(draft.reason, /fan/);
  assert.equal(Q.requirements().length, n);
});
proc.kill();

await t('offline fallback: unreachable backend -> labelled local mode, local engine still works', async () => {
  const dead = createAppStore({ storage: memStorage(), backend: createBackendApi({ base: `http://127.0.0.1:${await freePort()}` }) });
  await waitFor(() => dead.getState().backend.status === 'offline');
  assert.equal(dead.queries.mode(), 'local'); assert.match(dead.getState().backend.error, /unreachable/);
  dead.actions.draftFromText(HALL); const d = dead.queries.drafts().find((x) => !x.needsClarification);
  dead.actions.confirmDraft(d.draftId);
  const run = dead.actions.runReplay();
  assert.equal(run.verdict, 'FAIL'); assert.equal(run.simulator.startsWith('switch-sim/'), true, 'local runs are labelled with the browser simulator version');
});
console.log(`\n${pass} passed`);
process.exit(process.exitCode || 0);
