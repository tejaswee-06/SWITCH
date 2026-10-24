// SWITCH assistant tests (plain Node): intent routing, typed view models (no raw JSON for people), conversation
// safety (confirmations, approval gates, offline / network failures) with a scripted API double, and - when Python
// with the backend requirements is available - the full conversational journey against the REAL backend.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { routeIntent, resolveCandidate, toCard, safeText, looksLikeCorrection, SUGGESTIONS } from '../src/assistant/assistant.js';
import { createAssistantSession } from '../src/assistant/session.js';
import { createBackendApi } from '../src/api/switchBackend.js';

let pass = 0;
async function t(n, f) { try { await f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '\n  ', e.stack?.split('\n').slice(0, 4).join('\n   ')); process.exitCode = 1; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HALL = "Don't turn off the hallway light while someone is there.";
const JSONISH = /\{\s*"|"\w+"\s*:|structuredContent|"content"\s*:/;
const allText = (s) => s.getState().messages.map((m) => `${m.text || ''} ${m.card ? Object.values(m.card).filter((v) => typeof v === 'string').join(' ') : ''}`).join('\n');

// ------------------------------------------------------------------ routing
await t('routing: the required conversational journey maps to the right intents', () => {
  const pend = { pending: { kind: 'requirement' } };
  assert.equal(routeIntent(`Alexa, ${HALL}`).intent, 'draft');
  assert.equal(routeIntent('Yes, save it as a rule', pend).intent, 'confirm');
  assert.equal(routeIntent('What changed in Goodnight?').intent, 'diff');
  assert.equal(routeIntent('Check it').intent, 'replay');
  assert.equal(routeIntent('Why did it fail?').intent, 'explain');
  assert.equal(routeIntent('Fix it').intent, 'repair');
  assert.equal(routeIntent('Run the checks again').intent, 'replay');
  assert.equal(routeIntent('Approve it').intent, 'approve');
  assert.equal(routeIntent('Reject the change').intent, 'reject');
  assert.equal(routeIntent('Show my saved rules').intent, 'requirements');
  assert.equal(routeIntent('List the routines').intent, 'routines');
  assert.equal(routeIntent('Are you connected to my Alexa?').intent, 'status');
  assert.equal(routeIntent('Reset the demo').intent, 'reset');
  assert.equal(routeIntent('Open Replay Lab').intent, 'navigate');
  assert.equal(routeIntent('Show me the report').intent, 'report');
});
await t('routing: a bare "yes"/"no" never acts without a pending question; small talk never becomes a draft', () => {
  assert.equal(routeIntent('yes').intent, 'nothing_pending');
  assert.equal(routeIntent('no').intent, 'nothing_pending');
  assert.equal(routeIntent('hello').intent, 'help');
  assert.equal(routeIntent('what is the weather').intent, 'unknown');
  assert.equal(routeIntent("No, don't turn off the kitchen light", { pending: { kind: 'requirement' } }).intent, 'draft', 'a correction starting with "no" is a correction');
  assert.ok(looksLikeCorrection('never unlock the front door at night') && !looksLikeCorrection('check it'));
  assert.ok(SUGGESTIONS.every((s) => routeIntent(s, { pending: { kind: 'x' } }).intent !== 'unknown'), 'every suggestion triggers a real intent');
});
await t('routing: "it" resolves to the conversation focus, then the UI selection, then the newest pending candidate', () => {
  const c = [{ candidate_id: 'a', routine_id: 'goodnight', status: 'PENDING_REVIEW' }, { candidate_id: 'b', routine_id: 'living_welcome', status: 'PENDING_REVIEW' }, { candidate_id: 'c', routine_id: 'goodnight', status: 'APPROVED' }];
  assert.equal(resolveCandidate(c, { focus: 'c' }).candidate_id, 'c');
  assert.equal(resolveCandidate(c, { uiSelected: 'a' }).candidate_id, 'a');
  assert.equal(resolveCandidate(c, {}).candidate_id, 'b');
  assert.equal(resolveCandidate(c, { routineHint: 'goodnight' }).candidate_id, 'a');
  assert.equal(resolveCandidate([], {}), null);
});

// ------------------------------------------------------------------ view models
await t('view models: errors, malformed and unexpected results never surface serialized objects', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { content: [{ type: 'text', text: '{"a":1}' }] }]) {
    const c = toCard('switch_run_replay', bad);
    assert.equal(c.type, 'error'); assert.ok(!JSONISH.test(JSON.stringify(Object.values(c).filter((v) => typeof v === 'string'))));
  }
  const e = toCard('switch_record_review_decision', { isError: true, structuredContent: { error: { code: 'SUITE_NOT_PASSING', message: 'latest full replay is FAIL; approval refused' } } });
  assert.equal(e.type, 'error'); assert.match(e.message, /did not pass/);
  assert.equal(safeText('{"structuredContent": {"x": 1}}'), '');
  assert.equal(safeText('Saved.'), 'Saved.');
});

// ------------------------------------------------------------------ conversation safety with an API double
function fakeApi(script) { const calls = []; return { calls, async alexaTool(name, args) { calls.push([name, args]); const f = script[name]; if (!f) throw Object.assign(new Error('unexpected tool ' + name), { status: 500 }); return f(args, calls); } }; }
const ok = (sc) => ({ content: [{ type: 'text', text: sc.say || 'Done.' }], structuredContent: { mode: 'SIMULATED DEMO', household_id: 'hh', ...sc }, isError: false });
const cands = (over = {}) => ({ switch_list_routines: () => ok({ routines: [], candidates: [{ candidate_id: 'cand-1', routine_id: 'goodnight', version: 2, base_version: 1, status: 'PENDING_REVIEW', parent_candidate_id: null, last_full_run: { run_id: 'run-1', overall: 'FAIL' }, ...over }] }) });

await t('session: offline backend gives an honest error with retry, and never calls a tool', async () => {
  const api = fakeApi({});
  const s = createAssistantSession({ api, getApp: () => ({ mode: 'local' }) });
  await s.send(HALL);
  const last = s.getState().messages.at(-1);
  assert.equal(last.card.type, 'error'); assert.equal(last.card.code, 'OFFLINE'); assert.equal(last.card.retry, HALL); assert.equal(api.calls.length, 0);
});
await t('session: a network failure mid-conversation becomes a retryable error, busy is always cleared', async () => {
  const api = { calls: 0, async alexaTool() { this.calls++; const e = new Error('SWITCH API unreachable'); e.status = 0; e.code = 'NETWORK_ERROR'; throw e; } };
  let reconnects = 0;
  const s = createAssistantSession({ api, getApp: () => ({ mode: 'backend' }), reconnect: async () => { reconnects++; } });
  await s.send('Check it');
  const c = s.getState().messages.at(-1).card;
  assert.equal(c.type, 'error'); assert.ok(c.retry); assert.equal(s.getState().busy, false);
  await s.retry(c.retry); assert.equal(reconnects, 1, 'retry re-checks the backend connection first');
});
await t('session: approval is never offered for a failing candidate and duplicate sends are ignored while busy', async () => {
  const api = fakeApi({ ...cands() });
  const s = createAssistantSession({ api, getApp: () => ({ mode: 'backend' }) });
  await s.send('Approve it');
  assert.equal(s.getState().pending, null); assert.match(s.getState().messages.at(-1).text, /latest check \(run-1\) is FAIL/);
  assert.ok(!api.calls.some(([n]) => n === 'switch_record_review_decision'));
  const slow = { calls: 0, async alexaTool() { this.calls++; await sleep(60); return ok({ candidates: [] }); } };
  const s2 = createAssistantSession({ api: slow, getApp: () => ({ mode: 'backend' }) });
  const p1 = s2.send('Check it'); const second = await s2.send('Check it'); await p1;
  assert.equal(second, false); assert.equal(slow.calls, 1);
});
await t('session: "yes" applies only to the displayed pending decision, with explicit_user_confirmation=true', async () => {
  const api = fakeApi({ ...cands({ last_full_run: { run_id: 'run-2', overall: 'PASS' } }),
    switch_record_review_decision: (a) => ok({ decision: { candidate_id: a.candidate_id, status: 'APPROVED', run_id: 'run-2', deployed: false } }) });
  const s = createAssistantSession({ api, getApp: () => ({ mode: 'backend' }) });
  await s.send('yes'); assert.ok(!api.calls.some(([n]) => n === 'switch_record_review_decision'), 'nothing pending -> nothing done');
  await s.send('Approve it'); assert.equal(s.getState().pending.kind, 'decision');
  await s.send('yes');
  const call = api.calls.find(([n]) => n === 'switch_record_review_decision');
  assert.deepEqual(call[1], { candidate_id: 'cand-1', decision: 'approve', explicit_user_confirmation: true });
  const card = s.getState().messages.at(-1).card; assert.equal(card.type, 'decision'); assert.equal(card.deployed, false);
});

// ------------------------------------------------------------------ the real backend
const root = fileURLToPath(new URL('..', import.meta.url));
const py = process.env.SWITCH_PYTHON || [`${root}switch_backend/.venv/bin/python`, `${root}switch_backend/.venv/Scripts/python.exe`].find(existsSync) || 'python3';
const port = await new Promise((res) => { const sv = createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => res(p)); }); });
const base = `http://127.0.0.1:${port}`;
const proc = spawn(py, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'switch_backend', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'],
  { cwd: root, env: { ...process.env, SWITCH_DB: ':memory:', SWITCH_ENV: 'demo', SWITCH_DEMO_PROFILE: 'journey' }, stdio: ['ignore', 'ignore', 'pipe'] });
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`${base}/health`)).ok; } catch { await sleep(100); } }
if (!up) { console.log(`SKIPPED real-backend assistant journey: backend did not start with "${py}"`); if (process.env.SWITCH_REQUIRE_BACKEND === '1') process.exitCode = 1; }
else {
  await t('real backend: the full spoken journey works end to end and every reply is a typed card, never JSON', async () => {
    const api = createBackendApi({ base });
    let synced = 0;
    const s = createAssistantSession({ api, getApp: () => ({ mode: 'backend' }), onSynced: async () => { synced++; } });
    const card = () => s.getState().messages.at(-1).card;
    await s.send(`Alexa, ${HALL}`); assert.equal(card().type, 'draft'); assert.equal(card().status, 'DRAFT'); assert.equal(s.getState().pending.kind, 'requirement');
    const rid = card().requirementId;
    await s.send('Yes, save it as a rule'); assert.equal(card().type, 'saved'); assert.equal(card().requirementId, rid); assert.equal(card().version, 1);
    const stored = await api.alexaTool('switch_get_requirement', { requirement_id: rid });
    assert.equal(stored.structuredContent.requirement.status, 'CONFIRMED', 'persisted in the backend');
    await s.send('What changed in Goodnight?'); assert.equal(card().type, 'diff'); assert.ok(card().diff.changed >= 1);
    await s.send('Check it'); assert.equal(card().type, 'replay'); assert.equal(card().overall, 'FAIL');
    const failRun = card().runId;
    await s.send('Approve it'); assert.equal(s.getState().pending, null, 'no approval offered on a FAIL');
    await s.send('Why did it fail?'); assert.equal(card().type, 'failure'); assert.equal(card().runId, failRun); assert.equal(card().requirementId, rid); assert.ok(card().events.length >= 1);
    await s.send('Fix it'); assert.equal(card().type, 'repair'); assert.equal(card().verified, false); assert.ok(card().diff.changed >= 1);
    const repaired = card().candidateId;
    await s.send('Run the checks again'); assert.equal(card().type, 'replay'); assert.equal(card().candidateId, repaired); assert.equal(card().overall, 'PASS');
    await s.send('Approve it'); assert.equal(s.getState().pending.candidate_id, repaired);
    await s.send('yes'); assert.equal(card().type, 'decision'); assert.equal(card().status, 'APPROVED'); assert.equal(card().deployed, false);
    await s.send('Are you connected to my Alexa?'); assert.equal(card().type, 'status'); assert.ok(card().rows.some((r) => /not connected to Amazon/.test(r.value)));
    await s.send('Show my saved rules'); assert.ok(card().items.some((r) => r.id === rid && r.status === 'CONFIRMED'));
    assert.ok(synced >= 5, 'UI state is re-synced after every mutating step');
    assert.ok(!JSONISH.test(allText(s)), 'no serialized JSON in any assistant message');
  });
}
proc.kill();
console.log(`\n${pass} passed`);
