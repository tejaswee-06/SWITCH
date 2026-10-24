// Single source of truth for the SWITCH front end (framework-free; React binds via useSyncExternalStore).
//  * Device/sensor state + the event trace live in ONE Sim instance (src/sim/engine.js). The 3D house,
//    device cards, room panels and timeline all read it, so they cannot disagree.
//  * Requirements, routine candidates, replay runs and reviewer decisions live here.
//  * Three clocks are kept apart: the browser's local time (day/night only), the house simulator clock
//    (sim.state.t) and each replay's deterministic scenario clock (inside a run record).
import { Sim, DEVICES, ROOMS, createInitialState } from '../sim/engine.js';
import * as SW from '../sim/switch.js';
import { ROOM_ORDER, ROOM_INFO, stepRoom as nextRoomId } from '../sim/rooms.js';
import { createCanonicalWorkflow } from './canonicalWorkflow.js';

export const PAGES = [
  { id: 'home', label: 'Home Overview' },
  { id: 'why', label: 'Why SWITCH' },
  { id: 'replay', label: 'Replay Lab' },
  { id: 'requirements', label: 'Saved Requirements' },
  { id: 'reports', label: 'Reports' },
  { id: 'devices', label: 'Devices / Integrations' },
  { id: 'settings', label: 'Settings' },
];
export const VIEW_MODES = ['exterior', 'cutaway', 'room', 'walk'];
const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const DEFAULT_SETTINGS = {
  household: SW.HOUSEHOLD_ID,
  defaultView: 'exterior',     // exterior | cutaway | room
  timeMode: 'auto',            // auto = browser local time (default on first launch) | manual
  manualTime: '21:30',
  manualDate: null,            // null => today
  latitude: 20,                // seasonal day length only; location is never requested
  reducedMotion: 'system',     // system | on | off
  quality: 'balanced',         // high | balanced | low
  showLabels: true,
  simSpeed: 30,                // house simulator speed (x real time)
};
export const SETTINGS_KEY = 'switch.settings.v1';

export function safeStorage() {
  try { const s = globalThis.localStorage; const k = '__switch_probe'; s.setItem(k, '1'); s.removeItem(k); return s; } catch { return null; }
}

/**
 * @param backend  optional API object (src/api/switchBackend.js createBackendApi()). When given, the store connects to the
 *                 canonical SWITCH backend and uses it for every workflow action; if it is unreachable the store stays on
 *                 the browser simulator, labelled as the offline fallback. Without it (Node tests) the store is local-only.
 */
export function createAppStore({ storage = safeStorage(), initialPage = 'home', backend = null } = {}) {
  let persisted = {};
  try { persisted = storage ? JSON.parse(storage.getItem(SETTINGS_KEY) || '{}') : {}; } catch { persisted = {}; }
  const settings = { ...DEFAULT_SETTINGS, ...persisted };
  const sim = new Sim({ routines: [SW.GOODNIGHT_LIVE, SW.LIVING_WELCOME] });
  let reqs = SW.seedDemoRequirements(new SW.RequirementStore());
  let runSeq = 0;
  let localRuns = [];          // runs produced by the browser engine (kept separate from canonical backend runs)
  const freshLab = () => ({ candidate: SW.GOODNIGHT_CANDIDATE, origin: 'edit', proposal: null, fixApplied: false, runIds: [], decision: null, extraScenarios: [], selectedCase: null });

  let state = {
    rev: 0, page: initialPage,
    roomId: 'living', deviceId: null,
    viewMode: settings.defaultView === 'room' ? 'room' : settings.defaultView,
    cutLevel: 0,
    highlight: null,                    // {device, room, requirement, seq, runId, scenario}
    live: { goodnight: SW.GOODNIGHT_LIVE, livingWelcome: SW.LIVING_WELCOME },
    liveHistory: [{ routine: `goodnight@${SW.GOODNIGHT_LIVE.version}`, decision: 'approved', by: 'demo-seed', note: 'Earlier household correction (seeded): hallway occupancy guard added.' }],
    lab: freshLab(),
    runs: [],
    automation: false,
    settings,
    toast: null,
    fullscreen: false,
    // workflow provider: 'local' = browser simulator (also the offline fallback), 'backend' = canonical SWITCH API
    mode: 'local',
    backend: { status: backend ? 'connecting' : 'disabled', error: null, health: null, base: backend?.base || null, busy: null, lastSync: null, preferLocal: false },
    canon: { requirements: [], drafts: [], candidates: [], scenarios: [], routines: [], history: {} },
    clarifications: [],
  };
  const listeners = new Set();
  const emit = () => { state = { ...state, rev: state.rev + 1 }; listeners.forEach((l) => l()); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  sim.subscribe(() => emit());

  let wf = null;
  const isBackend = () => state.mode === 'backend' && wf;
  const persist = (s) => { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable: session only */ } };
  const notify = (message, tone = 'info') => set({ toast: { message, tone, id: state.rev + 1 } });

  // ---------- selection / navigation -------------------------------------------------------------
  const levelOf = (rid) => ROOM_INFO[rid]?.level ?? 0;
  const actions = {
    navigate(page) { if (state.page !== page) set({ page }); },
    selectRoom(roomId, { tour = false } = {}) {
      if (!ROOMS[roomId]) return;
      const keepDevice = state.deviceId && DEVICES[state.deviceId]?.room === roomId;
      set({ roomId, deviceId: keepDevice ? state.deviceId : null, viewMode: tour ? 'room' : state.viewMode, cutLevel: levelOf(roomId) });
    },
    openRoomTour(roomId) { actions.selectRoom(roomId, { tour: true }); },
    /** Previous/next arrows: wrap around; from the exterior they open the room tour. */
    stepRoom(dir) {
      const roomId = nextRoomId(state.roomId, dir);
      const viewMode = state.viewMode === 'exterior' ? 'room' : state.viewMode;
      const keepDevice = state.deviceId && DEVICES[state.deviceId]?.room === roomId;
      set({ roomId, viewMode, deviceId: keepDevice ? state.deviceId : null, cutLevel: levelOf(roomId) });
    },
    setViewMode(mode) { if (!VIEW_MODES.includes(mode)) return; set({ viewMode: mode, cutLevel: mode === 'cutaway' ? levelOf(state.roomId) : state.cutLevel }); },
    setCutLevel(l) { set({ cutLevel: l === 1 ? 1 : 0 }); },
    selectDevice(id) {
      if (id && !DEVICES[id]) return;
      set({ deviceId: id || null, roomId: id ? DEVICES[id].room : state.roomId });
    },
    setFullscreen(v) { if (state.fullscreen !== !!v) set({ fullscreen: !!v }); },
    clearToast() { set({ toast: null }); },
    notify,

    // ---------- devices (always through the simulator => trace == truth) --------------------------
    toggle(id) { const was = sim.isOn(id); sim.dispatch({ type: 'toggle', id }, 'user'); notify(`${DEVICES[id]?.label}: ${was ? 'OFF' : 'ON'}`); },
    setPower(id, on) { sim.dispatch({ type: 'power', id, on }, 'user'); },
    setFanSpeed(id, speed) { sim.dispatch({ type: 'fanSpeed', id, speed }, 'user'); },
    setAC(id, patch) { sim.dispatch({ type: 'ac', id, patch }, 'user'); },
    setDoor(id, open) { sim.dispatch({ type: 'door', id, open }, 'user'); },
    motion(room, active) { sim.dispatch({ type: 'motion', room, active }, 'user'); },
    vacate(room) { sim.dispatch({ type: 'occupancy', room, occupied: false }, 'user'); },
    scene(name) { sim.dispatch({ type: 'scene', name }, 'user'); notify(`${name} scene applied (simulated)`); },
    runLiveRoutine(id) { const r = state.live[id]; if (!r) return; sim.registerRoutine(r); sim.dispatch({ type: 'routine', id }, 'user'); notify(`${r.name} ${r.version} ran in the simulated house`); },
    setAutomation(on) {
      sim.automations = on ? [{ id: 'living-welcome', trigger: { type: 'motion', room: 'living', active: true }, routineId: 'livingWelcome' }] : [];
      set({ automation: !!on });
    },
    tick(dtSimSeconds) { if (dtSimSeconds > 0) sim.dispatch({ type: 'step', dt: dtSimSeconds }, 'clock'); },
    resetSimulation() {
      sim.state = createInitialState(); sim.trace = []; sim._acc = 0; sim.automations = [];
      Object.values(state.live).forEach((r) => sim.registerRoutine(r));
      set({ automation: false, highlight: null, deviceId: null });
      sim._notify(); notify('Simulated house reset to its initial state');
    },
    async connectBackend() {
      if (!backend) return false;
      set({ backend: { ...state.backend, status: 'connecting', error: null } });
      try {
        const health = await backend.getHealth();
        wf = wf || createCanonicalWorkflow({ api: backend, getState: () => state, set, notify, sim });
        set({ backend: { ...state.backend, status: 'online', health, error: null } });
        if (state.backend.preferLocal) return true;
        await wf.sync();
        set({ mode: 'backend', backend: { ...state.backend, lastSync: Date.now() } });
        return true;
      } catch (e) {
        set({ mode: 'local', backend: { ...state.backend, status: 'offline', error: e?.message || String(e) } });
        notify('SWITCH backend unreachable — using the local browser simulator (offline fallback). Results are labelled LOCAL.', 'warn');
        return false;
      }
    },
    async syncBackend() { if (isBackend()) { await wf.sync(); set({ backend: { ...state.backend, lastSync: Date.now() } }); } },
    /** Explicit provider choice (Settings). 'local' keeps the backend data untouched and switches the UI to the browser engine. */
    async setWorkflowMode(mode) {
      if (mode === 'local') { set({ mode: 'local', backend: { ...state.backend, preferLocal: true }, live: { goodnight: SW.GOODNIGHT_LIVE, livingWelcome: SW.LIVING_WELCOME }, runs: localRuns, lab: freshLab(), highlight: null }); sim.registerRoutine(SW.GOODNIGHT_LIVE); return; }
      set({ backend: { ...state.backend, preferLocal: false } });
      await actions.connectBackend();
    },
    resetDemoData() {
      if (isBackend()) return wf.resetDemo();
      reqs = SW.seedDemoRequirements(new SW.RequirementStore()); runSeq = 0; localRuns = [];
      set({ runs: [], lab: freshLab(), highlight: null, live: { goodnight: SW.GOODNIGHT_LIVE, livingWelcome: SW.LIVING_WELCOME }, liveHistory: state.liveHistory.slice(0, 1) });
      sim.registerRoutine(SW.GOODNIGHT_LIVE); notify('Demo requirements, runs and routine versions reset');
    },

    // ---------- requirements ------------------------------------------------------------------------
    draftFromText(text) {
      if (isBackend()) return wf.draftFromText(text);
      const parsed = SW.parseCorrection(text);
      const d = reqs.createDraft(parsed, { by: 'household member', at: Math.round(sim.state.t) });
      emit(); return { draft: d, parsed };
    },
    clarifyDraft(draftId, fields) {
      if (isBackend()) return wf.clarifyDraft(draftId, fields);
      const d = reqs.drafts().find((x) => x.draftId === draftId);
      const built = SW.buildDraft({ ...fields, sourceText: d?.sourceText || '' });
      const next = reqs.updateDraft(draftId, built); emit(); return next;
    },
    confirmDraft(draftId) {
      if (isBackend()) return wf.confirmDraft(draftId);
      const v = reqs.confirmDraft(draftId, { confirmed: true, by: 'household member', at: Math.round(sim.state.t) });
      notify(`${v.id} saved as version ${v.version} (confirmed)`); emit(); return v;
    },
    discardDraft(draftId) { if (isBackend()) return wf.discardDraft(draftId); reqs.discardDraft(draftId); emit(); return null; },
    loadHistory(id) { return isBackend() ? wf.loadHistory(id) : Promise.resolve(reqs.history(id)); },
    editRequirement(id, patch, confirmed) {
      if (isBackend()) return wf.editRequirement(id, patch, confirmed); const v = reqs.edit(id, patch, { confirmed, by: 'household member', at: Math.round(sim.state.t) }); notify(`${id} edited — now version ${v.version}`); emit(); return v; },
    setRequirementStatus(id, status, reason = '') {
      if (isBackend()) return wf.setRequirementStatus(id, status); const v = reqs.setStatus(id, status, { by: 'household member', at: Math.round(sim.state.t), reason }); notify(`${id} is now ${status} (v${v.version})`); emit(); return v; },

    // ---------- Replay Lab -------------------------------------------------------------------------------
    setExtraScenarios(ids) { set({ lab: { ...state.lab, extraScenarios: ids } }); },
    runReplay(label = 'Replay') {
      if (isBackend()) return wf.runReplay();
      const lab = state.lab;
      const runId = `RUN-${String(++runSeq).padStart(4, '0')}`;
      const run = SW.runSuite({ routine: lab.candidate, requirements: reqs.active(), extraScenarioIds: lab.extraScenarios, runId, base: state.live.goodnight, label });
      run.candidateOrigin = lab.origin; run.fixApplied = lab.fixApplied; run.decision = null; run.sequence = runSeq;
      // last result per requirement version = worst case across its scenarios
      const worst = {};
      const rank = { PASS: 0, INCONCLUSIVE: 1, FAIL: 2 };
      run.cases.forEach((c) => { const k = `${c.requirement}@${c.version}`; if (!worst[k] || rank[c.result] > rank[worst[k].result]) worst[k] = c; });
      Object.values(worst).forEach((c) => reqs.recordResult(c.requirement, c.version, { result: c.result, runId, reason: c.reason, scenario: c.scenario }));
      const fail = run.cases.find((c) => c.result === 'FAIL') || run.cases.find((c) => c.result === 'INCONCLUSIVE' && c.offending);
      const highlight = fail ? { device: fail.device, room: fail.room, requirement: fail.requirement, seq: fail.offending?.seq ?? null, runId, scenario: fail.scenario, result: fail.result } : null;
      localRuns = [run, ...localRuns];
      set({ runs: [run, ...state.runs], lab: { ...lab, runIds: [runId, ...lab.runIds], selectedCase: fail ? `${fail.requirement}|${fail.scenario}` : null, decision: null }, highlight, roomId: fail ? fail.room : state.roomId, deviceId: fail ? fail.device : state.deviceId });
      return run;
    },
    applySuggestedFix() {
      if (isBackend()) return wf.applySuggestedFix();
      const run = actions.currentRun();
      const f = run?.cases.find((c) => c.result === 'FAIL');
      if (!f) { notify('No failing assertion to repair — run a replay first', 'warn'); return null; }
      const proposal = SW.suggestRepair(state.lab.candidate, f);
      if (!proposal) { notify('No template repair applies to this failure', 'warn'); return null; }
      set({ lab: { ...state.lab, proposal: { ...proposal, basedOn: run.runId, from: state.lab.candidate }, candidate: proposal.routine, fixApplied: true, decision: null } });
      notify('Suggested fix applied to the candidate — not verified until the regression suite is re-run', 'warn');
      return proposal;
    },
    rerunSuite() { return actions.runReplay('Regression rerun'); },
    selectCandidate(cid) { if (isBackend()) wf.selectCandidate(cid); },
    resetScenario() { if (isBackend()) return wf.resetScenario(); set({ lab: freshLab(), highlight: null }); notify('Replay Lab reset to the original candidate'); },
    selectCase(key) { set({ lab: { ...state.lab, selectedCase: key } }); },
    highlightCase(run, c) {
      if (!c) { set({ highlight: null }); return; }
      set({ highlight: { device: c.device, room: c.room, requirement: c.requirement, seq: (c.offending || c.evidence)?.seq ?? null, runId: run.runId, scenario: c.scenario, result: c.result }, roomId: c.room || state.roomId, deviceId: c.device || state.deviceId });
    },
    currentRun() { const id = state.lab.runIds[0]; return state.runs.find((r) => r.runId === id) || null; },
    /** Human decision. Approval of a candidate that did not PASS requires an explicit override. */
    decide(decision, { note = '', override = false } = {}) {
      if (isBackend()) return wf.decide(decision, { note });
      const run = actions.currentRun();
      if (!run || run.routine.version !== state.lab.candidate.version) throw new Error('Replay the current candidate before deciding.');
      if (decision === 'approved' && run.verdict !== 'PASS' && !override) throw new Error(`The latest run is ${run.verdict}. Approving requires an explicit override.`);
      const rec = SW.decideCandidate(state.lab.candidate, { decision, by: 'household member', at: Math.round(sim.state.t), runId: run.runId, note });
      run.decision = rec;
      let live = state.live; let liveHistory = state.liveHistory;
      if (decision === 'approved') {
        const promoted = { ...state.lab.candidate };
        live = { ...state.live, [promoted.id]: promoted }; sim.registerRoutine(promoted);
        liveHistory = [...liveHistory, { routine: `${promoted.id}@${promoted.version}`, decision, by: rec.by, runId: run.runId, note }];
      }
      set({ runs: [...state.runs], lab: { ...state.lab, decision: rec }, live, liveHistory, highlight: null });
      notify(decision === 'approved' ? `Approved ${rec.routine}. Recorded with ${run.runId}. (Simulated: nothing was deployed to real devices.)` : `Rejected ${rec.routine}. Recorded with ${run.runId}.`);
      return rec;
    },

    // ---------- settings ------------------------------------------------------------------------------
    updateSettings(patch) { const s = { ...state.settings, ...patch }; persist(s); set({ settings: s }); },
    resetSettings() { try { storage?.removeItem(SETTINGS_KEY); } catch { /* ignore */ } set({ settings: { ...DEFAULT_SETTINGS } }); },
  };

  // ---------- derived reads -----------------------------------------------------------------------------
  const queries = {
    mode: () => (isBackend() ? 'backend' : 'local'),
    requirements: () => (isBackend() ? state.canon.requirements : reqs.all()),
    activeRequirements: () => (isBackend() ? state.canon.requirements.filter((r) => r.status === 'CONFIRMED') : reqs.active()),
    drafts: () => (isBackend() ? [...state.canon.drafts, ...state.clarifications] : reqs.drafts()),
    history: (id) => (isBackend() ? (state.canon.history[id] || []) : reqs.history(id)),
    candidates: () => (isBackend() ? state.canon.candidates : []),
    scenarios: () => (isBackend() ? state.canon.scenarios.map((s) => ({ id: s.scenario_id, version: `v${s.version}`, name: s.description.replace(/^SYNTHETIC( EDGE CASE)?:\s*/, ''), startClock: `${s.start}:00`, edgeCase: !!s.edge_case, raw: s }))
      : Object.values(SW.SCENARIOS)),
    /** What the next replay will evaluate. Backend mode lists what the backend reported last (it owns relevance). */
    plannedSuite() {
      if (!isBackend()) { const sel = SW.selectRequirements(reqs.active(), state.lab.candidate); return { ...sel, authoritative: true }; }
      const run = actions.currentRun();
      const active = state.canon.requirements.filter((r) => r.status === 'CONFIRMED');
      if (run) return { selected: active.filter((r) => run.requirements.some((x) => x.id === r.id)), skipped: run.skipped.map((s) => ({ requirement: { id: s.id, title: s.title, version: s.version }, reason: s.reason })), authoritative: true };
      return { selected: active, skipped: state.canon.requirements.filter((r) => r.status !== 'CONFIRMED').map((r) => ({ requirement: r, reason: `Status ${r.status} — not enforced` })), authoritative: false };
    },
    requirementStore: () => reqs,
    latestRun: () => state.runs[0] || null,
    run: (id) => state.runs.find((r) => r.runId === id) || null,
    routinesFor(deviceId) {
      return Object.values(state.live).filter((r) => r.steps.some((s) => s.device === deviceId)).map((r) => ({ id: r.id, name: r.name, version: r.version, steps: r.steps.map((s, i) => ({ ...s, i })).filter((s) => s.device === deviceId) }));
    },
    requirementsFor(deviceId) { return reqs.all().filter((r) => r.device === deviceId || r.assertion?.device === deviceId); },
    eventsFor({ device, room, limit = 12 } = {}) {
      const out = [];
      for (let i = sim.trace.length - 1; i >= 0 && out.length < limit; i--) {
        const e = sim.trace[i];
        if (e.kind === 'error') continue;
        if (device && e.device !== device) continue;
        if (room && !(e.room === room || (e.device && DEVICES[e.device]?.room === room))) continue;
        out.push(e);
      }
      return out;
    },
    /** Requirements whose last result is FAIL/INCONCLUSIVE, or that a pending candidate edit touches and that were not yet replayed against it. */
    requirementsAtRisk() {
      if (isBackend()) {
        const run = queries.latestRun(); const cand = state.lab.candidate; const tested = run && cand && run.candidateId === state.lab.candidateId;
        return state.canon.requirements.filter((r) => r.status === 'CONFIRMED').map((r) => {
          if (r.lastResult && r.lastResult.result !== 'PASS') return { req: r, why: `${r.lastResult.result} in ${r.lastResult.runId}`, tone: r.lastResult.result === 'FAIL' ? 'fail' : 'inconclusive' };
          const touches = cand && (r.scope.routine_ids.includes(cand.id) || cand.steps.some((s) => s.device === r.device));
          if (cand && !state.lab.decision && touches && !tested) return { req: r, why: `Pending edit ${cand.id}@${cand.version} not yet replayed`, tone: 'review' };
          return null;
        }).filter(Boolean);
      }
      const cand = state.lab.candidate;
      const { selected } = SW.selectRequirements(reqs.active(), cand);
      const run = queries.latestRun();
      const testedAgainstCandidate = run && run.routine.version === cand.version;
      return reqs.active().map((r) => {
        if (r.lastResult && r.lastResult.result !== 'PASS') return { req: r, why: `${r.lastResult.result} in ${r.lastResult.runId}`, tone: r.lastResult.result === 'FAIL' ? 'fail' : 'inconclusive' };
        if (!state.lab.decision && selected.includes(r) && !testedAgainstCandidate) return { req: r, why: `Pending edit ${cand.id}@${cand.version} not yet replayed`, tone: 'review' };
        return null;
      }).filter(Boolean);
    },
    roomOrder: () => ROOM_ORDER,
  };

  if (backend) setTimeout(() => { actions.connectBackend(); }, 0);
  return {
    sim,
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    actions, queries,
  };
}

export { todayISO };
