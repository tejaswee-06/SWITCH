// SWITCH regression workflow: correction -> structured draft -> explicit confirmation -> versioned requirement
// -> routine candidate -> deterministic replay -> assertions (PASS/FAIL/INCONCLUSIVE) -> suggested repair
// -> rerun of the regression suite -> human approval.  Deterministic and rule-based: no AI, no randomness,
// no wall clock. The rule-based parser and template repair stand in for the optional AI layer described in
// the product spec; neither of them ever decides a test result.
import { Sim, createInitialState, ROOMS, DEVICES, traceHash, SIM_VERSION } from './engine.js';

export const RESULTS = ['PASS', 'FAIL', 'INCONCLUSIVE'];
export const REQ_STATUS = ['DRAFT', 'CONFIRMED', 'DISABLED', 'RETIRED'];
export const HOUSEHOLD_ID = 'casa-verde-demo';

// ---------- 1. Correction capture -> structured requirement draft ---------------------------------
const ROOM_WORDS = {
  living: 'living', 'living room': 'living', lounge: 'living', kitchen: 'kitchen',
  bedroom: 'bedroom', 'bedroom 1': 'bedroom', 'bedroom one': 'bedroom', 'main bedroom': 'bedroom',
  'bedroom 2': 'bedroom2', 'bedroom two': 'bedroom2', 'bedroom 3': 'bedroom3', 'bedroom three': 'bedroom3', 'upstairs bedroom': 'bedroom3',
  bathroom: 'bathroom', bath: 'bathroom', hallway: 'hallway', hall: 'hallway', corridor: 'hallway',
  patio: 'patio', terrace: 'patio', 'rooftop terrace': 'patio',
};
const DEVICE_WORDS = {
  'security system': 'security', security: 'security', alarm: 'security', tv: 'tv', television: 'tv',
  'air purifier': 'purifier', purifier: 'purifier', 'coffee machine': 'coffee', 'espresso machine': 'coffee',
};
const ROUTINE_WORDS = { goodnight: 'goodnight', 'good night': 'goodnight', 'living room welcome': 'livingWelcome', welcome: 'livingWelcome' };

function deviceFromWords(w) {
  const t = w.trim().replace(/^the\s+/, '');
  if (DEVICE_WORDS[t]) return DEVICE_WORDS[t];
  const m = t.match(/^([a-z0-9 ]+?)\s+lights?$/);
  if (m && ROOM_WORDS[m[1].trim()]) return ROOMS[ROOM_WORDS[m[1].trim()]].light;
  return null;
}

/** Build a structured draft from explicit fields (used by the parser and by the clarification form). */
export function buildDraft({ kind, room, device, routine = 'goodnight', expectOn, sourceText = '' }) {
  if (kind === 'never_off_while_occupied') {
    if (!ROOMS[room]) throw new Error(`Unknown room ${room}`);
    const dev = device || ROOMS[room].light;
    return {
      title: `Keep ${ROOMS[room].name} light on while occupied`,
      sourceText, kind, room, device: dev,
      scope: { type: 'room', room, device: dev, routine: null },
      preconditions: [`${ROOMS[room].name} occupancy is true`],
      expectedBehavior: `No routine or automation sets ${DEVICES[dev]?.label || dev} to OFF while ${ROOMS[room].name} is occupied.`,
      assertion: { type: 'never_off_while_occupied', room, device: dev },
      scenarios: [scenarioIdForOccupied(room)],
      severity: 'must',
    };
  }
  if (kind === 'state_after_routine') {
    if (!DEVICES[device]) throw new Error(`Unknown device ${device}`);
    const r = DEVICES[device].room; const word = device === 'security' ? (expectOn ? 'armed' : 'disarmed') : (expectOn ? 'on' : 'off');
    return {
      title: `${DEVICES[device].label} ${word} after ${routineTitle(routine)}`,
      sourceText, kind, room: r, device,
      scope: { type: 'routine', room: r, device, routine },
      preconditions: [`${routineTitle(routine)} routine runs to completion`],
      expectedBehavior: `After ${routineTitle(routine)} finishes, ${DEVICES[device].label} is ${word.toUpperCase()}.`,
      assertion: { type: 'state_after_routine', routine, device, expect: { on: !!expectOn } },
      scenarios: ['goodnight-hallway-occupied', 'goodnight-house-empty'],
      severity: 'must',
    };
  }
  throw new Error(`Unsupported requirement kind ${kind}`);
}
const routineTitle = (id) => ({ goodnight: 'Goodnight', livingWelcome: 'Living room welcome' }[id] || id);

/** Rule-based parser. Unsupported text => {supported:false}; it never silently produces a passing rule. */
export function parseCorrection(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase().replace(/[’']/g, "'");
  let m = lower.match(/^(?:please\s+)?(?:don'?t|do not|never)\s+turn\s+off\s+(?:the\s+)?([a-z0-9 ]+?)\s+light(?:s)?\s+(?:while|when|if)\s+(?:someone|somebody|anyone|people|a person)\s+(?:is|are)\s+(?:there|in(?:\s+there|\s+it)?|home|present)\.?$/);
  if (m) {
    const room = ROOM_WORDS[m[1].trim()];
    if (!room) return { supported: false, text: t, reason: `Unknown room "${m[1]}"`, clarify: 'Which room do you mean?' };
    const draft = buildDraft({ kind: 'never_off_while_occupied', room, sourceText: t });
    return { supported: true, status: 'draft', confidence: 'rule-match', draft };
  }
  m = lower.match(/^(?:make sure|ensure|always make sure)\s+(?:the\s+)?([a-z0-9 ]+?)\s+(?:is|are|stays?|gets?)\s+(on|off|armed|disarmed)\s+after\s+(?:the\s+)?([a-z ]+?)(?:\s+routine)?\.?$/);
  if (m) {
    const device = deviceFromWords(m[1]); const routine = ROUTINE_WORDS[m[3].trim()];
    if (!device) return { supported: false, text: t, reason: `Unknown device "${m[1]}"`, clarify: 'Which device should be checked?' };
    if (!routine) return { supported: false, text: t, reason: `Unknown routine "${m[3]}"`, clarify: 'Which routine does this apply to?' };
    const draft = buildDraft({ kind: 'state_after_routine', device, routine, expectOn: m[2] === 'on' || m[2] === 'armed', sourceText: t });
    return { supported: true, status: 'draft', confidence: 'rule-match', draft };
  }
  return {
    supported: false, text: t,
    reason: 'SWITCH could not map this sentence to a testable rule. Supported: "Don\'t turn off the <room> light while someone is there." or "Make sure the <device> is on/off/armed after Goodnight."',
    clarify: 'Pick the room/device and condition that should stay true, then review the structured rule.',
  };
}

// ---------- 2. Versioned requirement store (explicit confirmation required) ---------------------------
const keyOf = (d) => { const a = d.assertion || {}; return [a.type, d.room ?? a.room ?? '', d.device ?? a.device ?? '', a.routine ?? '', a.expect ? JSON.stringify(a.expect) : ''].join(':'); };

export class RequirementStore {
  constructor({ householdId = HOUSEHOLD_ID } = {}) {
    this.householdId = householdId;
    this.items = new Map();      // id -> versions[]
    this.keys = new Map();       // semantic key -> id (same rule re-confirmed => new version of the same id)
    this.draftMap = new Map();   // draftId -> draft (never counted as active)
    this.audit = [];
    this.seq = 0; this.draftSeq = 0;
  }
  // -- drafts --
  createDraft(input, { by = 'user', at = 0 } = {}) {
    const draftId = `DRAFT-${String(++this.draftSeq).padStart(3, '0')}`;
    const base = input?.draft ? input.draft : input && input.assertion ? input : null;
    const d = base
      ? { ...base, draftId, status: 'DRAFT', needsClarification: false, createdBy: by, createdAt: at }
      : { draftId, status: 'DRAFT', needsClarification: true, sourceText: input?.text ?? String(input ?? ''), reason: input?.reason, clarify: input?.clarify, title: 'Needs clarification', createdBy: by, createdAt: at };
    this.draftMap.set(draftId, d);
    this.audit.push({ action: 'draft_created', draftId, by, at });
    return d;
  }
  updateDraft(draftId, fields) {
    const d = this.draftMap.get(draftId); if (!d) throw new Error(`Unknown draft ${draftId}`);
    const next = { ...d, ...fields, draftId, status: 'DRAFT', needsClarification: !(fields.assertion || d.assertion) };
    this.draftMap.set(draftId, next); return next;
  }
  discardDraft(draftId, { by = 'user', at = 0 } = {}) { const ok = this.draftMap.delete(draftId); if (ok) this.audit.push({ action: 'draft_discarded', draftId, by, at }); return ok; }
  drafts() { return [...this.draftMap.values()]; }
  confirmDraft(draftId, opts = {}) {
    const d = this.draftMap.get(draftId); if (!d) throw new Error(`Unknown draft ${draftId}`);
    if (d.needsClarification || !d.assertion) throw new Error('Draft still needs clarification: choose the room/device and condition first.');
    const v = this.confirm(d, opts);
    this.draftMap.delete(draftId);
    return v;
  }
  /** Saving without confirmed === true is rejected. */
  confirm(draft, { confirmed, by = 'user', at = 0, seeded = false } = {}) {
    if (confirmed !== true) throw new Error('Explicit user confirmation required before saving a requirement.');
    if (!draft || !draft.assertion) throw new Error('Not a valid draft.');
    const key = keyOf(draft);
    let id = this.keys.get(key);
    if (!id) { id = `REQ-${String(++this.seq).padStart(3, '0')}`; this.keys.set(key, id); }
    const versions = this.items.get(id) || [];
    const { draftId, needsClarification, createdBy, createdAt, status, lastResult, ...fields } = draft;
    void draftId; void needsClarification; void createdBy; void createdAt; void status; void lastResult;
    const v = {
      ...fields, id, householdId: this.householdId, version: versions.length + 1, status: 'CONFIRMED',
      confirmedBy: by, confirmedAt: at, confirmation: { by, at, seeded }, lastResult: null, change: versions.length ? 'reconfirmed' : 'created',
    };
    versions.push(v); this.items.set(id, versions);
    this.audit.push({ action: 'confirmed', id, version: v.version, by, at });
    return v;
  }
  /** Edits create a new version (history preserved) and require explicit confirmation of the edited meaning. */
  edit(id, patch, { confirmed, by = 'user', at = 0 } = {}) {
    if (confirmed !== true) throw new Error('Explicit confirmation required to save an edited requirement.');
    const cur = this.latest(id); if (!cur) throw new Error(`Unknown requirement ${id}`);
    if (cur.status === 'RETIRED') throw new Error('Retired requirements cannot be edited.');
    const allowed = ['title', 'preconditions', 'expectedBehavior', 'severity', 'scenarios', 'scope'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    const v = { ...cur, ...clean, version: cur.version + 1, status: 'CONFIRMED', confirmedBy: by, confirmedAt: at, confirmation: { by, at, seeded: false }, lastResult: null, change: `edited: ${Object.keys(clean).join(', ') || 'no fields'}` };
    this.items.get(id).push(v);
    this.audit.push({ action: 'edited', id, version: v.version, by, at, fields: Object.keys(clean) });
    return v;
  }
  /** DISABLED / RETIRED / CONFIRMED (re-enable). Recorded as a new version so the history is complete. */
  setStatus(id, status, { by = 'user', at = 0, reason = '' } = {}) {
    if (!['CONFIRMED', 'DISABLED', 'RETIRED'].includes(status)) throw new Error(`Bad status ${status}`);
    const cur = this.latest(id); if (!cur) throw new Error(`Unknown requirement ${id}`);
    if (cur.status === 'RETIRED') throw new Error('Retired requirements are final.');
    if (cur.status === status) return cur;
    const v = { ...cur, version: cur.version + 1, status, statusBy: by, statusAt: at, statusReason: reason, change: `status: ${cur.status} -> ${status}` };
    this.items.get(id).push(v);
    this.audit.push({ action: 'status', id, version: v.version, from: cur.status, to: status, by, at });
    return v;
  }
  recordResult(id, version, result) {
    const list = this.items.get(id); if (!list) return;
    const v = list.find((x) => x.version === version); if (v) v.lastResult = result;
  }
  latest(id) { const v = this.items.get(id); return v ? v[v.length - 1] : null; }
  /** Latest version of every saved requirement (any status). */
  all() { return [...this.items.values()].map((v) => v[v.length - 1]); }
  /** Only CONFIRMED requirements are enforced in replays. Drafts, disabled and retired ones are not. */
  active() { return this.all().filter((r) => r.status === 'CONFIRMED'); }
  history(id) { return this.items.get(id) || []; }
}

/** Seeded demo requirements (clearly labelled as seeded demo data in the UI). */
export function seedDemoRequirements(store) {
  store.confirm(buildDraft({ kind: 'state_after_routine', device: 'security', routine: 'goodnight', expectOn: true, sourceText: 'Make sure the security system is armed after Goodnight.' }), { confirmed: true, by: 'demo-seed', at: 0, seeded: true });
  store.confirm(buildDraft({ kind: 'state_after_routine', device: 'livingLight', routine: 'goodnight', expectOn: false, sourceText: 'Make sure the living room lights are off after Goodnight.' }), { confirmed: true, by: 'demo-seed', at: 0, seeded: true });
  store.createDraft(parseCorrection('Keep the bathroom a bit dim at night.'), { by: 'demo-seed', at: 0 });
  return store;
}

// ---------- 3. Routines (data, versioned, diffable) ------------------------------------------------------------
export const GOODNIGHT_FAULTY = {
  id: 'goodnight', name: 'Goodnight', version: 'v1-faulty',
  steps: [
    { do: 'power', device: 'livingLight', on: false },
    { do: 'power', device: 'kitchenLight', on: false },
    { do: 'power', device: 'hallwayLight', on: false },       // BUG: ignores hallway occupancy
    { do: 'power', device: 'tv', on: false },
    { do: 'power', device: 'security', on: true },
  ],
};
export const GOODNIGHT_FIXED = {
  ...GOODNIGHT_FAULTY, version: 'v2-guarded',
  steps: GOODNIGHT_FAULTY.steps.map((s) => s.device === 'hallwayLight' ? { ...s, guard: { type: 'unlessOccupied', room: 'hallway' } } : s),
};
export const LIVING_WELCOME = { id: 'livingWelcome', name: 'Living room welcome', version: 'v1', steps: [{ do: 'power', device: 'livingLight', on: true }] };
/** The household's live Goodnight (already corrected once) and a later edit that drops the guard again. */
export const GOODNIGHT_LIVE = GOODNIGHT_FIXED;
export const GOODNIGHT_CANDIDATE = {
  ...GOODNIGHT_FAULTY, version: 'v3-candidate',
  author: 'Household edit (simplified Goodnight)',
  note: 'Edit simplified the routine; the hallway occupancy condition was removed.',
};

export function describeStep(st) {
  if (!st) return '—';
  const dev = DEVICES[st.device]?.label || st.device;
  let s;
  switch (st.do) {
    case 'power': s = `${dev} → ${st.device === 'security' ? (st.on ? 'ARMED' : 'DISARMED') : (st.on ? 'ON' : 'OFF')}`; break;
    case 'fan': s = `${dev} → ${st.speed}`; break;
    case 'ac': s = `${dev} → ${Object.entries(st.patch || {}).map(([k, v]) => `${k} ${v}`).join(', ')}`; break;
    case 'door': s = `${dev} → ${st.open ? 'OPEN' : 'CLOSED'}`; break;
    case 'lock': s = `${st.device === 'front_door' ? 'Front door lock' : dev} → ${st.locked ? 'LOCKED' : 'UNLOCKED'}`; break;
    default: s = `${st.do} ${dev}`;
  }
  if (st.guard) s += st.guard.type === 'unlessOccupied' ? `  unless ${ROOMS[st.guard.room]?.name || st.guard.room} is occupied` : st.guard.type === 'ifOccupied' ? `  only if ${ROOMS[st.guard.room]?.name} is occupied` : st.guard.type === 'conditions' ? `  only if ${st.guard.text}` : `  if ${st.guard.device} is off`;
  return s;
}

/** Structured step-by-step diff between two routine versions. */
export function routineDiff(before, after) {
  const n = Math.max(before?.steps.length || 0, after?.steps.length || 0);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = before?.steps[i]; const b = after?.steps[i];
    const ja = a ? JSON.stringify(a) : null; const jb = b ? JSON.stringify(b) : null;
    const type = ja === jb ? 'same' : !a ? 'added' : !b ? 'removed' : 'changed';
    rows.push({ step: i, type, before: a ? describeStep(a) : null, after: b ? describeStep(b) : null, beforeRaw: a || null, afterRaw: b || null });
  }
  const text = [`--- ${before?.id}@${before?.version}`, `+++ ${after?.id}@${after?.version}`,
    ...rows.flatMap((r) => r.type === 'same' ? [`  ${r.step}: ${r.after}`] : [...(r.before ? [`- ${r.step}: ${r.before}`] : []), ...(r.after ? [`+ ${r.step}: ${r.after}`] : [])])].join('\n');
  return { rows, text, changed: rows.filter((r) => r.type !== 'same').length };
}

// ---------- 4. Scenarios + deterministic replay ----------------------------------------------------------------------------
/** Scenario = explicit initial state + ordered setup actions applied before running the routine. */
export const SCENARIO_GOODNIGHT_HALLWAY = {
  id: 'goodnight-hallway-occupied', version: 'v1', name: 'Goodnight with someone in the hallway', startClock: '23:00:00',
  initial: { lightsOn: ['livingLight', 'kitchenLight', 'hallwayLight'] },
  setup: [{ type: 'motion', room: 'hallway', active: true }],
  run: 'goodnight',
};
export const SCENARIO_GOODNIGHT_EMPTY = {
  id: 'goodnight-house-empty', version: 'v1', name: 'Goodnight with nobody home', startClock: '23:00:00',
  initial: { lightsOn: ['livingLight', 'kitchenLight', 'hallwayLight'] },
  setup: [],
  run: 'goodnight',
};
export const SCENARIO_GOODNIGHT_SENSOR_OFFLINE = {
  id: 'goodnight-hallway-sensor-offline', version: 'v1', name: 'Goodnight, hallway occupancy sensor offline (unknown)', startClock: '23:00:00',
  initial: { lightsOn: ['livingLight', 'kitchenLight', 'hallwayLight'], unknownOccupancy: ['hallway'] },
  setup: [],
  run: 'goodnight', edgeCase: true,
};
export function scenarioIdForOccupied(room) { return room === 'hallway' ? SCENARIO_GOODNIGHT_HALLWAY.id : `goodnight-${room}-occupied`; }
/** Generic "someone is in <room> when Goodnight runs" scenario for requirements about other rooms. */
export function makeOccupiedScenario(room) {
  if (room === 'hallway') return SCENARIO_GOODNIGHT_HALLWAY;
  const light = ROOMS[room]?.light;
  return { id: `goodnight-${room}-occupied`, version: 'v1', name: `Goodnight with someone in the ${ROOMS[room]?.name || room}`, startClock: '23:00:00', initial: { lightsOn: ['livingLight', 'kitchenLight', ...(light && !['livingLight', 'kitchenLight'].includes(light) ? [light] : [])] }, setup: [{ type: 'motion', room, active: true }], run: 'goodnight', generated: true };
}
export const SCENARIOS = Object.fromEntries([SCENARIO_GOODNIGHT_HALLWAY, SCENARIO_GOODNIGHT_EMPTY, SCENARIO_GOODNIGHT_SENSOR_OFFLINE].map((s) => [s.id, s]));
export function getScenario(id) {
  if (SCENARIOS[id]) return SCENARIOS[id];
  const m = String(id).match(/^goodnight-([a-z0-9]+)-occupied$/);
  return m && ROOMS[m[1]] ? makeOccupiedScenario(m[1]) : null;
}

const snap = (st) => JSON.parse(JSON.stringify({ devices: st.devices, rooms: st.rooms, t: st.t }));

export function replay(scenario, routine, requirements) {
  const state = createInitialState();
  for (const id of Object.keys(DEVICES)) if (DEVICES[id].kind === 'light') state.devices[id].on = (scenario.initial?.lightsOn || []).includes(id);
  for (const r of scenario.initial?.unknownOccupancy || []) if (state.rooms[r]) state.rooms[r].occupied = null;
  const sim = new Sim({ state, routines: [routine] });
  sim.dispatch({ type: 'step', dt: 5 }, 'scenario');
  const initial = snap(sim.state);
  const baselineLen = sim.trace.length;
  for (const a of scenario.setup) sim.dispatch(a, 'scenario');
  sim.dispatch({ type: 'routine', id: scenario.run }, 'scenario');
  const trace = sim.trace;
  const final = snap(sim.state);
  const results = requirements.map((r) => evaluate(r, trace, scenario, { initial, final }));
  const hash = traceHash(trace);
  return { scenarioId: scenario.id, scenarioVersion: scenario.version || 'v1', routine: `${routine.id}@${routine.version}`, trace, results, hash, setupEvents: baselineLen, initial, final, simulator: SIM_VERSION };
}

// ---------- 5. Assertion evaluation ----------------------------------------------------------------------------------------------
/**
 * never_off_while_occupied(room, device):
 *   FAIL         a device-off transition occurred while occupancy[room] === true (offending event reported)
 *   INCONCLUSIVE device/room unsupported, occupancy unknown at the transition, a guard read unknown state,
 *                occupancy never became true (vacuous), or the routine never ran
 *   PASS         routine ran, occupancy was true at least once, and no violating transition occurred
 * state_after_routine(routine, device, expect):
 *   FAIL         after the routine finished, the device is not in the expected state
 *   INCONCLUSIVE routine never ran / unknown device / final state not available
 *   PASS         the device ended in the expected state
 * Any other assertion type => INCONCLUSIVE (never a silent PASS).
 */
export function evaluate(req, trace, scenario, ctx = {}) {
  const a = req.assertion;
  const base = { requirement: req.id, version: req.version, title: req.title, room: a?.room ?? req.room, device: a?.device, scenario: scenario?.id };
  if (!a || !['never_off_while_occupied', 'state_after_routine'].includes(a.type)) return { ...base, result: 'INCONCLUSIVE', reason: 'Unsupported assertion type' };
  if (!DEVICES[a.device] || (a.type === 'never_off_while_occupied' && !ROOMS[a.room])) return { ...base, result: 'INCONCLUSIVE', reason: 'Unknown device or room' };
  const routineRan = trace.some((e) => e.kind === 'routine_start');
  if (!routineRan) return { ...base, result: 'INCONCLUSIVE', reason: 'Routine never executed in this scenario' };

  if (a.type === 'state_after_routine') {
    const end = [...trace].reverse().find((e) => e.kind === 'routine_end' && String(e.routine).startsWith(`${a.routine}@`));
    if (!end) return { ...base, result: 'INCONCLUSIVE', reason: `Routine ${a.routine} did not run in this scenario` };
    if (!ctx.final) return { ...base, result: 'INCONCLUSIVE', reason: 'Final modeled state not available' };
    const s = ctx.final.devices[a.device]; if (!s) return { ...base, result: 'INCONCLUSIVE', reason: 'Device state unknown' };
    const actual = !!(s.on || s.open);
    const evidence = [...trace].reverse().find((e) => e.device === a.device && (e.kind === 'device' || e.kind === 'door')) || end;
    const word = (on) => a.device === 'security' ? (on ? 'ARMED' : 'DISARMED') : (on ? 'ON' : 'OFF');
    if (actual === !!a.expect.on) return { ...base, result: 'PASS', reason: `${DEVICES[a.device].label}: ${word(actual)} after ${routineTitle(a.routine)} (as required)`, evidence };
    return { ...base, result: 'FAIL', reason: `${DEVICES[a.device].label}: ${word(actual)} after ${routineTitle(a.routine)}; required ${word(!!a.expect.on)}`, offending: evidence };
  }

  let occ = ctx.initial ? (ctx.initial.rooms[a.room]?.occupied ?? null) : null; let sawOccupied = occ === true;
  for (const e of trace) {
    if (e.kind === 'occupancy' && e.room === a.room) { occ = e.to; if (e.to) sawOccupied = true; }
    if (e.kind === 'device' && e.device === a.device && e.to === false) {
      if (occ === true) return { ...base, result: 'FAIL', reason: `${DEVICES[a.device].label} turned OFF (event #${e.seq}, step ${e.step ?? '—'}) while ${ROOMS[a.room].name} was occupied`, offending: e };
      if (occ === null) return { ...base, result: 'INCONCLUSIVE', reason: `${ROOMS[a.room].name} occupancy was unknown when ${DEVICES[a.device].label} turned OFF (event #${e.seq})`, offending: e };
    }
  }
  const skippedUnknown = trace.find((e) => e.kind === 'step_skipped' && e.unknown);
  if (skippedUnknown) return { ...base, result: 'INCONCLUSIVE', reason: `A routine condition read unknown occupancy (event #${skippedUnknown.seq}); cannot confirm the requirement`, offending: skippedUnknown };
  if (!sawOccupied) return { ...base, result: 'INCONCLUSIVE', reason: 'Precondition never exercised (room never occupied)' };
  return { ...base, result: 'PASS', reason: `${ROOMS[a.room].name} was occupied and ${DEVICES[a.device].label} was never turned OFF` };
}

// ---------- 6. Regression suite -----------------------------------------------------------------------------------------------
/** Which active requirements a routine change can affect; the rest are listed as skipped (never silently). */
export function selectRequirements(requirements, routine) {
  const touched = new Set(routine.steps.map((s) => s.device));
  const selected = []; const skipped = [];
  for (const r of requirements) {
    if (r.status && r.status !== 'CONFIRMED') { skipped.push({ requirement: r, reason: `Status ${r.status} — not enforced` }); continue; }
    const a = r.assertion || {};
    const related = (a.routine && a.routine === routine.id) || touched.has(a.device) || r.scope?.type === 'household';
    if (related) selected.push(r); else skipped.push({ requirement: r, reason: `Not affected by ${routine.name || routine.id} (no shared device/routine)` });
  }
  return { selected, skipped };
}

export function verdictOf(counts) { return counts.FAIL ? 'FAIL' : counts.INCONCLUSIVE ? 'INCONCLUSIVE' : counts.PASS ? 'PASS' : 'INCONCLUSIVE'; }

/**
 * Run every selected requirement against each scenario it lists (plus any extra scenarios requested).
 * Returns a reproducible run record: versions, scenarios, cases, traces and counts.
 */
export function runSuite({ routine, requirements, extraScenarioIds = [], runId = 'RUN-LOCAL', base = null, label = '' }) {
  const { selected, skipped } = selectRequirements(requirements, routine);
  const scenarioIds = new Set(extraScenarioIds);
  selected.forEach((r) => (r.scenarios || [SCENARIO_GOODNIGHT_HALLWAY.id]).forEach((id) => scenarioIds.add(id)));
  const scenarios = [...scenarioIds].map(getScenario).filter(Boolean);
  const replays = {}; const cases = [];
  for (const sc of scenarios) {
    const reqsHere = selected.filter((r) => (r.scenarios || [SCENARIO_GOODNIGHT_HALLWAY.id]).includes(sc.id) || extraScenarioIds.includes(sc.id));
    const rp = replay(sc, routine, reqsHere);
    replays[sc.id] = rp;
    rp.results.forEach((res) => cases.push({ ...res, scenario: sc.id, scenarioVersion: sc.version || 'v1', traceHash: rp.hash }));
  }
  const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  cases.forEach((c) => { counts[c.result]++; });
  return {
    runId, label, simulator: SIM_VERSION, householdId: HOUSEHOLD_ID,
    routine: { id: routine.id, version: routine.version, name: routine.name },
    base: base ? { id: base.id, version: base.version } : null,
    diff: base ? routineDiff(base, routine) : null,
    requirements: selected.map((r) => ({ id: r.id, version: r.version, title: r.title })),
    skipped: skipped.map((s) => ({ id: s.requirement.id, version: s.requirement.version, title: s.requirement.title, reason: s.reason })),
    scenarios: scenarios.map((s) => ({ id: s.id, version: s.version || 'v1', name: s.name, startClock: s.startClock || '00:00:00', edgeCase: !!s.edgeCase })),
    replays, cases, counts, verdict: verdictOf(counts),
  };
}

// ---------- 7. Suggested repair (deterministic template; NOT AI) -----------------------------------------------------------------
export function suggestRepair(routine, failure) {
  const off = failure?.offending; if (!off || off.step == null) return null;
  const idx = off.step; const step = routine.steps[idx]; if (!step) return null;
  const guard = { type: 'unlessOccupied', room: failure.room };
  const patched = { ...routine, version: `${routine.version}+guard`, steps: routine.steps.map((s, i) => i === idx ? { ...s, guard } : s) };
  const fmt = (s) => JSON.stringify(s);
  const diff = [`--- ${routine.id}@${routine.version}`, `+++ ${patched.id}@${patched.version}`, `@@ step ${idx} @@`, `- ${fmt(step)}`, `+ ${fmt(patched.steps[idx])}`].join('\n');
  return {
    routine: patched, diff, step: idx, structured: routineDiff(routine, patched),
    note: 'Template repair: adds an occupancy guard to the offending step. Requires human approval.',
    explanation: `Step ${idx} (${describeStep(step)}) ran while ${ROOMS[failure.room]?.name || failure.room} was occupied. Restoring the "unless ${ROOMS[failure.room]?.name || failure.room} is occupied" condition makes the routine skip that step when someone is there. This is a proposal — it is only verified once the regression suite is re-run.`,
    status: 'proposed',
  };
}
export function approveRepair(proposal, { approved, by = 'user' } = {}) {
  if (approved !== true) throw new Error('Human approval required.');
  return { ...proposal, status: 'approved', approvedBy: by };
}
/** Human decision on a candidate routine. Recorded with the run that informed it. */
export function decideCandidate(candidate, { decision, by = 'user', at = 0, runId = null, note = '' } = {}) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('An explicit human decision (approved/rejected) is required.');
  return { routine: `${candidate.id}@${candidate.version}`, decision, by, at, runId, note };
}

// ---------- 8. Trace -> state reconstruction (for scrubbing a replay in the 3D house) -----------------------------
export function stateAt(initial, trace, uptoSeq = Infinity) {
  const s = JSON.parse(JSON.stringify({ devices: initial.devices, rooms: initial.rooms }));
  for (const e of trace) {
    if (e.seq > uptoSeq) break;
    const d = e.device && s.devices[e.device];
    if (e.kind === 'device' && d) { d.on = e.to; if (e.speed) d.speed = e.speed; }
    else if (e.kind === 'fan_speed' && d) { d.speed = e.to; d.on = e.to !== 'off'; }
    else if (e.kind === 'ac' && d) for (const [k, v] of Object.entries(e.changes)) d[k] = v.to;
    else if (e.kind === 'door' && d) d.open = e.to;
    else if (e.kind === 'motion' && s.rooms[e.room]) s.rooms[e.room].motion = e.to;
    else if (e.kind === 'occupancy' && s.rooms[e.room]) s.rooms[e.room].occupied = e.to;
  }
  return s;
}

/** Simulated clock label for a scenario (deterministic; never the wall clock). */
export function scenarioClock(startClock, t) {
  const [h, m, sec] = String(startClock || '00:00:00').split(':').map(Number);
  const total = Math.round(h * 3600 + m * 60 + sec + t);
  const hh = Math.floor(total / 3600) % 24; const mm = Math.floor(total / 60) % 60; const ss = total % 60;
  return [hh, mm, ss].map((x) => String(x).padStart(2, '0')).join(':');
}

export function reportToMarkdown(run, describeEvent = (e) => e.kind) {
  const L = [];
  L.push(`# SWITCH replay report ${run.runId}`, '', '> SIMULATED DEMO — results are about the modeled scenarios and versions below, not the physical home.', '');
  L.push(`- Verdict: **${run.verdict}** (PASS ${run.counts.PASS} · FAIL ${run.counts.FAIL} · INCONCLUSIVE ${run.counts.INCONCLUSIVE})`);
  L.push(`- Routine: ${run.routine.id}@${run.routine.version}${run.base ? ` (compared with ${run.base.id}@${run.base.version})` : ''}`);
  L.push(`- Simulator: ${run.simulator}`, `- Household: ${run.householdId}`);
  L.push(`- Requirements: ${run.requirements.map((r) => `${r.id} v${r.version}`).join(', ') || 'none'}`);
  L.push(`- Scenarios: ${run.scenarios.map((s) => `${s.id} ${s.version}`).join(', ')}`);
  if (run.decision) L.push(`- Reviewer decision: ${run.decision.decision.toUpperCase()} by ${run.decision.by}${run.decision.note ? ` — ${run.decision.note}` : ''}`);
  else L.push('- Reviewer decision: none recorded');
  if (run.diff) L.push('', '## Proposed change', '```diff', run.diff.text, '```');
  L.push('', '## Assertions', '| Requirement | Scenario | Result | Reason | Event |', '|---|---|---|---|---|');
  run.cases.forEach((c) => L.push(`| ${c.requirement} v${c.version} | ${c.scenario} | ${c.result} | ${c.reason} | ${c.offending ? `#${c.offending.seq}` : c.evidence ? `#${c.evidence.seq}` : ''} |`));
  if (run.skipped.length) { L.push('', '## Not run (listed, not silently skipped)'); run.skipped.forEach((s) => L.push(`- ${s.id} v${s.version}: ${s.reason}`)); }
  for (const [sid, rp] of Object.entries(run.replays)) {
    L.push('', `## Trace — ${sid} (hash ${rp.hash})`, '| # | sim t (s) | event | source |', '|---|---|---|---|');
    rp.trace.forEach((e) => L.push(`| ${e.seq} | ${e.t} | ${describeEvent(e)} | ${e.source}${e.routine ? ` ${e.routine}` : ''} |`));
  }
  return L.join('\n');
}
