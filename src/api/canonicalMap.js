// Canonical backend (Person 2) payloads -> view models rendered by the existing SWITCH pages.
// Pure functions: no fetch, no React, no import.meta, so they are unit-tested in Node against payloads recorded from
// the real backend (tests/fixtures/backend_journey.json). Nothing here computes PASS / FAIL / INCONCLUSIVE: statuses
// are copied from the backend evaluator; this module only renames fields and derives display text.
import { CANONICAL_HOME } from '../contracts/canonicalHome.js';
import { createInitialState, DEVICES, ROOMS } from '../sim/engine.js';
import { routineDiff } from '../sim/switch.js';

export const CANON = Object.fromEntries(CANONICAL_HOME.devices.map((d) => [d.device_id, d]));
export const CANON_ROOMS = Object.fromEntries(CANONICAL_HOME.rooms.map((r) => [r.room_id, r]));
export const FE_TO_CANON = Object.fromEntries(CANONICAL_HOME.devices.filter((d) => d.fe_id).map((d) => [d.fe_id, d.device_id]));
export const feId = (cid) => CANON[cid]?.fe_id ?? null;
export const canonId = (feOrCanon) => FE_TO_CANON[feOrCanon] || (CANON[feOrCanon] ? feOrCanon : null);
/** Id the UI selects / highlights: the browser-simulator id when the device has a 3D fixture, else the canonical id. */
export const viewDevice = (cid) => feId(cid) || cid;
export const occRoom = (cid) => (CANON[cid]?.type === 'occupancy_sensor' ? CANON[cid].room_id : null);
export const roomOfCanon = (cid) => CANON[cid]?.room_id ?? null;
export const canonLabel = (cid) => CANON[cid]?.label ?? DEVICES[cid]?.label ?? cid;
const roomName = (r) => ROOMS[r]?.name || CANON_ROOMS[r]?.name || r;
export const hhmm = (s) => { const [h, m] = String(s || '00:00').split(':').map(Number); return h * 60 + (m || 0); };

// ------------------------------------------------------------------ conditions, steps, routines
export function valueWord(cid, attr, v) {
  if (attr === 'armed') return v ? 'ARMED' : 'DISARMED';
  if (attr === 'locked') return v ? 'LOCKED' : 'UNLOCKED';
  if (attr === 'open') return v ? 'OPEN' : 'CLOSED';
  if (v === null || v === undefined) return 'UNKNOWN';
  return String(v).toUpperCase();
}
export function condText(c) {
  if (!c) return '';
  if (c.op === 'time_between') return `time between ${c.start} and ${c.end}`;
  const room = occRoom(c.device);
  if (room) { const occ = (c.value === true) === (c.op === 'eq'); return `${roomName(room)} is ${occ ? 'occupied' : 'empty'}`; }
  return `${canonLabel(c.device)} ${c.op === 'eq' ? 'is' : 'is not'} ${valueWord(c.device, c.attr, c.value)}`;
}
export function conditionToGuard(conds) {
  if (!conds || !conds.length) return null;
  if (conds.length === 1) {
    const c = conds[0]; const room = occRoom(c.device);
    if (room && typeof c.value === 'boolean') {
      const whenOccupied = (c.value === true) === (c.op === 'eq');
      return whenOccupied ? { type: 'ifOccupied', room } : { type: 'unlessOccupied', room };
    }
  }
  // not representable by the browser simulator's guard types: kept verbatim; the browser engine treats it as UNKNOWN
  return { type: 'conditions', text: conds.map(condText).join(' AND '), raw: conds };
}
export function actionToStep(a) {
  const device = viewDevice(a.device);
  let st;
  if (a.attr === 'power') st = { do: 'power', device, on: a.value === 'on' };
  else if (a.attr === 'armed') st = { do: 'power', device, on: a.value === true };
  else if (a.attr === 'speed') st = { do: 'fan', device, speed: a.value };
  else if (a.attr === 'mode') st = { do: 'ac', device, patch: { mode: a.value } };
  else if (a.attr === 'open') st = { do: 'door', device, open: a.value === true };
  else if (a.attr === 'locked') st = { do: 'lock', device, locked: a.value === true };
  else st = { do: a.attr, device, value: a.value };
  const guard = conditionToGuard(a.conditions);
  if (guard) st.guard = guard;
  st.actionId = a.action_id;
  return st;
}
export function routineToView(r) {
  if (!r) return null;
  return {
    id: r.routine_id, name: r.name, version: `v${r.version}`, versionNum: r.version, description: r.description || '',
    steps: (r.actions || []).map(actionToStep), conditions: r.conditions || [], triggers: r.triggers || [],
    priority: r.priority, enabled: r.enabled !== false, source: 'backend', raw: r,
  };
}
export function candidateToView(c) {
  if (!c) return null;
  const routine = routineToView(c.routine);
  return {
    candidateId: c.candidate_id, routineId: c.routine_id, version: `v${c.version}`, versionNum: c.version, baseVersion: c.base_version,
    parentId: c.parent_candidate_id, status: c.status, description: c.description || c.routine?.description || '',
    repairOps: c.repair_ops, repairSource: c.repair_source, repairProvenance: c.repair_provenance, verified: c.verified,
    createdAt: c.created_at, createdBy: c.created_by, routine: { ...routine, author: c.created_by, note: c.description, candidateId: c.candidate_id }, raw: c,
  };
}

// ------------------------------------------------------------------ requirements
export function behaviorText(b, scope, routineNames = {}) {
  if (!b) return '';
  const lab = canonLabel(b.device); const w = valueWord(b.device, b.attr, b.value);
  if (b.kind === 'must_not_set') return `No routine or automation sets ${lab} to ${w} while the preconditions hold.`;
  if (b.kind === 'final_state_equals') {
    const rids = scope?.routine_ids || [];
    return rids.length ? `After ${rids.map((r) => routineNames[r] || r).join(', ')} runs, ${lab} is ${w}.` : `At the end of the scenario, ${lab} is ${w}.`;
  }
  return `${b.kind} ${lab} ${w}`;
}
export function requirementToView(raw, { routineNames = {}, runs = {} } = {}) {
  const b = raw.expected_behavior || {}; const scope = raw.scope || {};
  const device = viewDevice(b.device); const room = roomOfCanon(b.device);
  const lr = raw.last_result;
  let lastResult = null;
  if (lr) {
    const run = runs[lr.run_id];
    const c = run?.cases?.find((x) => x.requirement === raw.requirement_id && x.result === lr.status) || run?.cases?.find((x) => x.requirement === raw.requirement_id);
    lastResult = { result: lr.status, runId: lr.run_id, candidateId: lr.candidate_id, reason: c?.reason || `see ${lr.run_id}`, scenario: c?.scenario };
  }
  return {
    id: raw.requirement_id, version: raw.version, status: raw.status, title: raw.title, sourceText: raw.source_correction,
    kind: b.kind, room, device, canonDevice: b.device,
    scope: { type: (scope.routine_ids || []).length ? 'routine' : (scope.devices || []).length ? 'device' : 'household', routine: (scope.routine_ids || [])[0] || null,
      room, device, routine_ids: scope.routine_ids || [], devices: scope.devices || [], scenario_ids: scope.scenario_ids || [] },
    preconditions: (raw.preconditions || []).map(condText), preconditionsRaw: raw.preconditions || [],
    expectedBehavior: behaviorText(b, scope, routineNames), expected: b,
    assertion: { type: b.kind, device, canon: b.device, attr: b.attr, value: b.value, room, routine: (scope.routine_ids || [])[0] || null },
    scenarios: scope.scenario_ids || [], ambiguities: raw.ambiguities || [], confidence: raw.confidence, interpreter: raw.interpreter,
    severity: 'must',
    confirmation: raw.confirmation ? { by: raw.confirmation.by, at: raw.confirmation.at, version: raw.confirmation.version, seeded: raw.interpreter === 'seed_fixture' } : null,
    confirmedBy: raw.confirmation?.by || null, confirmedAt: raw.confirmation?.at || null,
    lastResult, createdAt: raw.created_at, createdBy: raw.created_by, updatedAt: raw.updated_at, source: 'backend', raw,
  };
}
/** A stored DRAFT requirement shown in the draft review list. */
export function storedDraftToView(raw, ctx) {
  const v = requirementToView(raw, ctx);
  return { ...v, draftId: raw.requirement_id, stored: true, needsClarification: (raw.ambiguities || []).length > 0,
    reason: (raw.ambiguities || []).join(' '), clarify: (raw.ambiguities || []).length ? 'Edit the draft to resolve these questions, then confirm.' : '' };
}
/** An interpretation that could not become a draft yet (nothing stored): it lives only in this browser session. */
export function proposalToClarification(p, n) {
  const qs = p.questions || [];
  return { draftId: `CLARIFY-${String(n).padStart(3, '0')}`, stored: false, status: 'DRAFT', needsClarification: true, sourceText: p.source_correction,
    title: 'Needs clarification', reason: qs.map((q) => q.question).join(' ') || (p.issues || []).map((i) => i.message).join(' '),
    clarify: 'Answer the question below or rephrase the correction. Nothing has been saved yet.', questions: qs, issues: p.issues || [], proposal: p,
    interpreter: p.interpreter?.mode };
}
export function historyToView(vers) {
  return (vers?.versions || []).map((v) => ({ version: v.version, title: v.content?.title, change: v.note || 'version saved', by: v.changed_by, at: v.changed_at, content: v.content }));
}

// ------------------------------------------------------------------ traces and runs
function deviceChange(cid, attr, prev, res) {
  const device = viewDevice(cid); const room = roomOfCanon(cid);
  if (attr === 'power') return { kind: 'device', device, room, from: prev === 'on', to: res === 'on' };
  if (attr === 'armed') return { kind: 'device', device, room, from: prev === true, to: res === true };
  if (attr === 'speed') return { kind: 'fan_speed', device, room, from: prev, to: res };
  if (attr === 'mode') return { kind: 'ac', device, room, changes: { mode: { from: prev, to: res } } };
  if (attr === 'open') return { kind: 'door', device, room, from: prev === true, to: res === true };
  if (attr === 'locked') return { kind: 'lock', device, room, from: prev, to: res };
  return { kind: 'state', device, room, attr, from: prev, to: res };
}
export function traceEventToView(e, { startMin = 0, stepOf = () => null } = {}) {
  const routine = e.routine_id ? `${e.routine_id}@v${e.routine_version}` : null;
  const base = { seq: e.seq, event_id: e.event_id, t: Math.max(0, (hhmm(e.sim_time) - startMin) * 60), simTime: e.sim_time,
    source: e.type === 'external_event' ? `scenario:${e.source}` : e.type === 'clock_tick' ? 'clock' : routine ? `routine:${routine}` : 'simulator',
    routine, step: e.action_id ? stepOf(e.routine_id, e.routine_version, e.action_id) : null, actionId: e.action_id || null,
    checks: (e.conditions || []).map((c) => ({ scope: c.scope, expr: c.expr, actual: c.actual, result: c.result })), raw: e };
  if (e.type === 'external_event') {
    if (e.kind === 'fire') return { ...base, kind: 'scenario_event', name: e.name };
    const room = occRoom(e.device);
    if (room) return { ...base, kind: 'occupancy', room, from: e.previous, to: e.resulting, via: 'scenario' };
    return { ...base, ...deviceChange(e.device, e.attr, e.previous, e.resulting) };
  }
  if (e.type === 'clock_tick') return { ...base, kind: 'clock' };
  if (e.type === 'routine_fired') return { ...base, kind: 'routine_start', routine };
  if (e.type === 'action') {
    if (e.outcome === 'executed') return e.changed ? { ...base, ...deviceChange(e.device, e.attr, e.previous, e.resulting) }
      : { ...base, kind: 'action_noop', device: viewDevice(e.device), room: roomOfCanon(e.device), attr: e.attr, value: e.resulting };
    return { ...base, kind: 'step_skipped', device: viewDevice(e.device), room: roomOfCanon(e.device), unknown: e.outcome === 'indeterminate', target: e.target_value };
  }
  return { ...base, kind: e.type || 'event' };
}
/** Browser-simulator state for a backend scenario state. Devices the scenario does not model are shown OFF/closed;
 * occupancy the scenario does not state, or states as null, is UNKNOWN (never assumed). */
export function stateToView(canonState = {}) {
  const s = createInitialState();
  for (const [id, d] of Object.entries(s.devices)) {
    const k = DEVICES[id].kind;
    if (k === 'door') d.open = false; else if (k === 'fan') { d.on = false; d.speed = 'off'; } else if (k === 'ac') { d.on = false; d.duty = 0; } else d.on = false;
  }
  for (const r of Object.values(s.rooms)) { r.occupied = null; r.motion = false; }
  for (const [cid, attrs] of Object.entries(canonState || {})) {
    const room = occRoom(cid);
    if (room && s.rooms[room]) { const v = attrs?.occupied; s.rooms[room].occupied = v === undefined ? null : v; s.rooms[room].motion = v === true; continue; }
    const fe = feId(cid); const d = fe && s.devices[fe]; if (!d || !attrs) continue;
    if (attrs.power != null) d.on = attrs.power === 'on';
    if (attrs.armed != null) d.on = attrs.armed === true;
    if (attrs.speed != null) { d.speed = attrs.speed; d.on = attrs.speed !== 'off'; }
    if (attrs.mode != null) d.mode = attrs.mode;
    if (attrs.open != null) d.open = attrs.open === true;
  }
  return s;
}
const decisionToView = (d, routine) => (!d ? null : { decision: d.decision === 'approve' ? 'approved' : 'rejected', by: d.decided_by, at: d.decided_at, runId: d.run_id, note: d.note || '', routine, approvalId: d.approval_id });

/**
 * Report (GET /replays/{id}/report) -> run view model.
 * ctx: { scenarios: {id: raw}, requirements: {id: raw}, routineRaw(routine_id, version) -> raw routine|null, sequence }
 */
export function runToView(report, ctx = {}) {
  const suite = report.suite || { tests: [], totals: {}, excluded: [], not_applicable: [], not_exercised: [] };
  const tests = suite.tests || [];
  const scen = ctx.scenarios || {}; const reqs = ctx.requirements || {};
  const cand = report.candidate || {};
  const routineRaw = ctx.routineRaw || (() => null);
  const stepOf = (rid, ver, aid) => { const r = routineRaw(rid, ver); const i = r ? r.actions.findIndex((a) => a.action_id === aid) : -1; return i < 0 ? aid : i; };
  const scenIds = [...new Set(tests.map((t) => t.scenario_id).filter(Boolean))];
  const replays = {};
  for (const sid of scenIds) {
    const t = tests.find((x) => x.scenario_id === sid && x.trace);
    const sc = scen[sid];
    const startMin = hhmm(sc?.start || '00:00');
    const trace = (t?.trace || []).map((e) => traceEventToView(e, { startMin, stepOf }));
    replays[sid] = { scenarioId: sid, trace, initial: stateToView(t?.initial_state || t?.trace?.[0]?.state_before || {}), final: stateToView(t?.final_state || {}),
      hash: t?.sim_result_hash || '—', setupEvents: 0 };
  }
  const cases = tests.map((t) => {
    const r = reqs[t.requirement_id]; const b = r?.expected_behavior || t.details?.behavior || {};
    const rp = replays[t.scenario_id];
    const evs = (t.evidence_event_ids || []).map((id) => rp?.trace.find((e) => e.event_id === id)).filter(Boolean);
    const offending = t.status === 'PASS' ? null : (b.kind === 'final_state_equals' ? evs[evs.length - 1] : evs[0]) || null;
    return { requirement: t.requirement_id, version: t.requirement_version, title: r?.title || t.requirement_id,
      room: roomOfCanon(b.device), device: viewDevice(b.device), canonDevice: b.device,
      scenario: t.scenario_id || '(no scenario)', scenarioVersion: t.scenario_version != null ? `v${t.scenario_version}` : '—', result: t.status, reason: t.reason,
      offending, evidence: t.status === 'PASS' ? evs[evs.length - 1] || null : null, evidenceIds: t.evidence_event_ids || [],
      traceHash: t.sim_result_hash || '—', binding: t.binding, relevance: t.relevance, baselineStatus: t.baseline_status };
  });
  const base = routineRaw(cand.routine_id, cand.baseline_version); const candR = routineRaw(cand.routine_id, cand.routine_version);
  const baseV = routineToView(base); const candV = routineToView(candR);
  const reqVersions = report.requirement_versions || {}; const reqStatus = report.requirement_statuses || {};
  const tested = new Set(tests.map((t) => t.requirement_id));
  const title = (id) => reqs[id]?.title || id;
  const decisions = (report.reviewer_decisions || []).filter((d) => d.run_id === report.run_id);
  const routineTag = `${cand.routine_id}@v${cand.routine_version}`;
  return {
    runId: report.run_id, kind: report.kind, label: report.kind === 'exploratory' ? 'Exploratory (edge cases)' : cand.parent_candidate_id ? 'Regression rerun' : 'Replay',
    simulator: `switch-backend-sim/${report.simulator_version}`, simulatorVersion: report.simulator_version, householdId: report.household_id, environment: report.environment,
    routine: { id: cand.routine_id, version: `v${cand.routine_version}`, name: candV?.name || cand.routine_id },
    base: { id: cand.routine_id, version: `v${cand.baseline_version}` }, candidateId: cand.candidate_id, parentCandidateId: cand.parent_candidate_id,
    diff: baseV && candV ? routineDiff(baseV, candV) : null, changes: report.routine_diff || [],
    requirements: Object.keys(reqVersions).filter((id) => reqStatus[id] === 'CONFIRMED' && tested.has(id)).map((id) => ({ id, version: reqVersions[id], title: title(id) })),
    skipped: [
      ...(suite.excluded || []).map((x) => ({ id: x.requirement_id, version: x.requirement_version, title: title(x.requirement_id), reason: x.reason })),
      ...(suite.not_applicable || []).map((x) => ({ id: x.requirement_id, version: x.requirement_version, title: title(x.requirement_id), reason: `${x.relevance}: ${x.reason}` })),
      ...(suite.not_exercised || []).map((x) => ({ id: `${x.requirement_id}`, version: x.requirement_version, title: `${title(x.requirement_id)} · ${x.scenario_id}`, reason: `not exercised: ${x.reason}` })),
    ],
    scenarios: scenIds.map((id) => ({ id, version: `v${report.scenario_versions?.[id] ?? scen[id]?.version ?? 1}`, name: (scen[id]?.description || id).replace(/^SYNTHETIC( EDGE CASE)?:\s*/, ''),
      startClock: `${scen[id]?.start || '00:00'}:00`, edgeCase: !!scen[id]?.edge_case })),
    replays, cases,
    counts: { PASS: suite.totals?.PASS || 0, FAIL: suite.totals?.FAIL || 0, INCONCLUSIVE: suite.totals?.INCONCLUSIVE || 0 }, totals: suite.totals,
    verdict: suite.overall, decision: decisionToView(decisions[decisions.length - 1], routineTag),
    candidateStatus: report.candidate_status, repairOps: report.repair_ops, repairProvenance: report.repair_provenance,
    comparison: report.comparison_to_previous_run, baselineComparison: report.baseline_comparison, integration: report.integration,
    safety: report.safety_statement, fingerprint: suite.input_fingerprint, createdAt: report.created_at, createdBy: report.created_by,
    exploratory: report.exploratory_scenario_ids || [], summary: report.summary || [], failureEvidence: report.failure_evidence || [],
    sequence: ctx.sequence ?? 0, fixApplied: !!cand.parent_candidate_id, source: 'backend', raw: report,
  };
}
