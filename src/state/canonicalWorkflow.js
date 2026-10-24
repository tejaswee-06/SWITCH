// Canonical workflow provider: the SWITCH backend (Person 2 deterministic core + integrated Person 3C) is the single
// source of truth for requirements, candidates, replays, assertions, repairs and reviewer decisions while it is
// reachable. This module only calls the API and maps responses with ./canonicalMap-style pure functions; it never
// computes a verdict. When the backend is unreachable the store falls back to the browser simulator (labelled
// "offline fallback" in the UI) instead of fabricating backend results.
import { routineDiff } from '../sim/switch.js';
import {
  routineToView, candidateToView, requirementToView, storedDraftToView, proposalToClarification, historyToView, runToView,
} from '../api/canonicalMap.js';

const ROOT_CANDIDATE = 'cand-demo-faulty';
const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.candidate_id || a.run_id).localeCompare(String(b.candidate_id || b.run_id));

export function createCanonicalWorkflow({ api, getState, set, notify, sim }) {
  let clarifySeq = 0;
  const raw = { routines: [], candidates: [], scenarios: [], requirements: [], reports: {}, runOrder: [], history: {} };

  // ------------------------------------------------------------------ derived views (recomputed after every sync)
  const routineRaw = (rid, version) => {
    const b = raw.routines.find((r) => r.routine_id === rid && r.version === version);
    if (b) return b;
    const c = raw.candidates.find((x) => x.routine_id === rid && x.version === version);
    return c ? c.routine : null;
  };
  const ctx = () => ({
    scenarios: Object.fromEntries(raw.scenarios.map((s) => [s.scenario_id, s])),
    requirements: Object.fromEntries(raw.requirements.map((r) => [r.requirement_id, r])),
    routineRaw,
  });
  function views() {
    const c = ctx();
    const runs = raw.runOrder.map((id, i) => runToView(raw.reports[id], { ...c, sequence: i + 1 })).reverse();
    const runsById = Object.fromEntries(runs.map((r) => [r.runId, r]));
    const routineNames = Object.fromEntries(raw.routines.map((r) => [r.routine_id, r.name]));
    const rctx = { routineNames, runs: runsById };
    const reqs = raw.requirements.filter((r) => r.status !== 'DRAFT').map((r) => requirementToView(r, rctx));
    const drafts = raw.requirements.filter((r) => r.status === 'DRAFT').map((r) => storedDraftToView(r, rctx));
    const candidates = raw.candidates.slice().sort(byCreated).map(candidateToView);
    const live = Object.fromEntries(raw.routines.map((r) => [r.routine_id, routineToView(r)]));
    return { runs, reqs, drafts, candidates, live };
  }

  function labFor(candidateId, runs, prev = {}) {
    const cands = raw.candidates.slice().sort(byCreated);
    const cand = cands.find((x) => x.candidate_id === candidateId) || cands.find((x) => x.candidate_id === ROOT_CANDIDATE) || cands.find((x) => x.status === 'PENDING_REVIEW') || cands[0];
    if (!cand) return { candidate: null, candidateId: null, origin: 'edit', proposal: null, fixApplied: false, runIds: [], decision: null, extraScenarios: [], selectedCase: null, source: 'backend' };
    const cv = candidateToView(cand);
    const parent = cand.parent_candidate_id ? cands.find((x) => x.candidate_id === cand.parent_candidate_id) : null;
    // this candidate's runs first, then its ancestors' (so the evidence that motivated a repair stays visible,
    // clearly marked "fix applied — not verified" until the new candidate itself is replayed)
    const chain = [cand.candidate_id];
    for (let p = parent; p; p = cands.find((x) => x.candidate_id === p.parent_candidate_id)) chain.push(p.candidate_id);
    const runIds = chain.flatMap((cid) => runs.filter((r) => r.candidateId === cid).map((r) => r.runId));
    const decided = runs.find((r) => r.candidateId === cand.candidate_id && r.decision)?.decision || null;
    const proposal = parent && cand.repair_ops ? {
      structured: routineDiff(routineToView(parent.routine), cv.routine), explanation: cand.repair_provenance?.explanation || '',
      provenance: cand.repair_provenance, repairOps: cand.repair_ops, from: { ...routineToView(parent.routine), candidateId: parent.candidate_id },
      candidateId: cand.candidate_id, basedOn: cand.repair_provenance?.evidence?.run_id || null,
      note: 'Deterministic template repair (not AI). Requires human approval.',
    } : null;
    return { candidate: cv.routine, candidateId: cand.candidate_id, candidateStatus: cand.status, origin: parent ? 'repair' : 'edit', proposal, fixApplied: !!parent,
      runIds, decision: decided, extraScenarios: prev.extraScenarios || [], selectedCase: prev.selectedCase || null, source: 'backend' };
  }

  function publish(extra = {}) {
    const v = views();
    const st = getState();
    const lab = labFor(extra.candidateId ?? st.lab?.candidateId, v.runs, st.lab || {});
    if (v.live.goodnight) sim.registerRoutine(v.live.goodnight);       // the house simulator runs the canonical routine
    set({
      runs: v.runs, live: Object.keys(v.live).length ? v.live : st.live, lab, ...extra.patch,
      canon: { requirements: v.reqs, drafts: v.drafts, candidates: v.candidates, scenarios: raw.scenarios, routines: raw.routines, history: { ...raw.history } },
    });
  }

  const busy = (b) => set({ backend: { ...getState().backend, busy: b } });
  async function guarded(label, fn) {
    busy(label);
    try { return await fn(); }
    catch (e) {
      if (e?.code === 'NETWORK_ERROR' || e?.code === 'TIMEOUT') {
        set({ backend: { ...getState().backend, status: 'offline', error: e.message } });
        notify(`${e.message}. Use Retry, or switch to the local offline fallback in Settings.`, 'warn');
      } else notify(e?.message || String(e), 'warn');
      throw e;
    } finally { busy(null); }
  }

  async function loadRequirements() { raw.requirements = await api.listRequirements(); }
  async function loadCandidates() { raw.candidates = await api.listCandidates(); }
  async function loadReport(runId) { raw.reports[runId] = await api.getReplayReport(runId); if (!raw.runOrder.includes(runId)) raw.runOrder.push(runId); }

  const wf = {
    raw,
    async sync() {
      const [routines, scenarios, requirements, candidates, replays] = await Promise.all([
        api.listRoutines(), api.listScenarios(), api.listRequirements(), api.listCandidates(), api.listReplays()]);
      Object.assign(raw, { routines, scenarios, requirements, candidates });
      const ids = replays.map((r) => r.run_id);
      raw.runOrder = ids;
      for (const k of Object.keys(raw.reports)) if (!ids.includes(k)) delete raw.reports[k];
      await Promise.all(ids.filter((id) => !raw.reports[id]).map(loadReport));
      // refresh the newest few so reviewer decisions recorded elsewhere (e.g. the Alexa+ panel) are visible
      await Promise.all(ids.slice(-3).map(loadReport));
      publish();
    },
    // ---------------- requirements ----------------
    async draftFromText(text) {
      return guarded('draft', async () => {
        let p;
        try { p = await api.interpretCorrection(text); }
        catch (e) {
          if (e.status === 422) {                // unsupported / invalid: visible error, kept as an unsaved clarification card
            const c = proposalToClarification({ source_correction: text, questions: [], issues: [{ code: e.code, message: e.message }] }, ++clarifySeq);
            c.title = 'Not supported as written'; c.unsupported = true;
            set({ clarifications: [...getState().clarifications, c] });
            return { draft: c, parsed: { supported: false, reason: e.message } };
          }
          throw e;
        }
        if (!p.can_create_draft) {
          const c = proposalToClarification(p, ++clarifySeq);
          set({ clarifications: [...getState().clarifications, c] });
          return { draft: c, parsed: { supported: false, reason: c.reason } };
        }
        const d = await api.createDraft({ source_correction: text, structured: p.structured });
        await loadRequirements(); publish();
        return { draft: storedDraftToView(d), parsed: { supported: true, proposal: p } };
      });
    },
    async clarifyDraft(draftId, answers) {
      const c = getState().clarifications.find((x) => x.draftId === draftId);
      if (!c) throw new Error('Only unsaved clarifications can be answered here; edit stored drafts instead.');
      return guarded('clarify', async () => {
        const p = await api.interpretCorrection(c.sourceText, { answers });
        if (!p.can_create_draft) {
          const next = { ...proposalToClarification(p, Number(draftId.split('-')[1])), draftId };
          set({ clarifications: getState().clarifications.map((x) => (x.draftId === draftId ? next : x)) });
          return next;
        }
        const d = await api.createDraft({ source_correction: c.sourceText, structured: p.structured });
        set({ clarifications: getState().clarifications.filter((x) => x.draftId !== draftId) });
        await loadRequirements(); publish();
        notify(`Draft ${d.requirement_id} saved — review it, then confirm`, 'info');
        return storedDraftToView(d);
      });
    },
    async confirmDraft(draftId) {
      const d = raw.requirements.find((r) => r.requirement_id === draftId);
      if (!d) throw new Error('Draft still needs clarification: answer the question first. Nothing is saved until then.');
      return guarded('confirm', async () => {
        const r = await api.confirmRequirement(draftId, d.version);
        await loadRequirements(); publish();
        notify(`${r.requirement_id} saved as version ${r.version} (confirmed)`);
        return requirementToView(r);
      });
    },
    async discardDraft(draftId) {
      if (getState().clarifications.some((x) => x.draftId === draftId)) { set({ clarifications: getState().clarifications.filter((x) => x.draftId !== draftId) }); return null; }
      const d = raw.requirements.find((r) => r.requirement_id === draftId);
      if (!d) return null;
      return guarded('discard', async () => {
        await api.patchRequirement(draftId, { expected_version: d.version, status: 'RETIRED', note: 'Draft discarded by the household (never confirmed)' });
        await loadRequirements(); publish(); notify(`${draftId} discarded (kept in history as RETIRED)`);
      });
    },
    async editRequirement(id, patch, confirmed) {
      if (confirmed !== true) throw new Error('Explicit confirmation required to save an edited requirement.');
      const cur = raw.requirements.find((r) => r.requirement_id === id);
      if (!cur) throw new Error(`Unknown requirement ${id}`);
      return guarded('edit', async () => {
        const e = await api.patchRequirement(id, { expected_version: cur.version, content: patch, note: `edited: ${Object.keys(patch).join(', ')}` });
        let out = e;
        if (!(e.ambiguities || []).length) out = await api.confirmRequirement(id, e.version);   // the edit was explicitly confirmed
        await loadRequirements(); publish();
        notify(out.status === 'CONFIRMED' ? `${id} edited — now version ${out.version} (confirmed)` : `${id} edited — version ${out.version} stays a DRAFT until its open questions are resolved`, out.status === 'CONFIRMED' ? 'info' : 'warn');
        return requirementToView(out);
      });
    },
    async setRequirementStatus(id, status) {
      const cur = raw.requirements.find((r) => r.requirement_id === id);
      if (!cur) throw new Error(`Unknown requirement ${id}`);
      return guarded('status', async () => {
        const r = status === 'CONFIRMED' ? await api.confirmRequirement(id, cur.version)
          : await api.patchRequirement(id, { expected_version: cur.version, status, note: `set ${status} in the SWITCH UI` });
        await loadRequirements(); publish();
        notify(`${id} is now ${r.status} (v${r.version})`);
        return requirementToView(r);
      });
    },
    async loadHistory(id) {
      raw.history[id] = historyToView(await api.getRequirementVersions(id));
      publish();
      return raw.history[id];
    },
    // ---------------- Replay Lab ----------------
    async runReplay() {
      const lab = getState().lab;
      if (!lab.candidateId) throw new Error('No candidate routine to replay.');
      return guarded('replay', async () => {
        const run = await api.runReplay({ candidate_id: lab.candidateId, extra_scenario_ids: lab.extraScenarios });
        await Promise.all([loadReport(run.run_id), loadRequirements(), loadCandidates()]);
        publish();
        const view = getState().runs.find((r) => r.runId === run.run_id);
        const fail = view.cases.find((c) => c.result === 'FAIL') || view.cases.find((c) => c.result === 'INCONCLUSIVE' && c.offending);
        const highlight = fail ? { device: fail.device, room: fail.room, requirement: fail.requirement, seq: fail.offending?.seq ?? null, runId: view.runId, scenario: fail.scenario, result: fail.result } : null;
        set({ lab: { ...getState().lab, selectedCase: fail ? `${fail.requirement}|${fail.scenario}` : null }, highlight,
          roomId: fail?.room || getState().roomId, deviceId: fail?.device || getState().deviceId });
        notify(`${view.runId}: ${view.verdict} — evaluated by the SWITCH backend`, view.verdict === 'PASS' ? 'info' : 'warn');
        return view;
      });
    },
    async applySuggestedFix() {
      const st = getState(); const run = st.runs.find((r) => r.runId === st.lab.runIds[0]);
      if (!run || !run.cases.some((c) => c.result === 'FAIL')) { notify('No failing assertion to repair — run a replay first', 'warn'); return null; }
      return guarded('repair', async () => {
        const fix = await api.suggestFix(st.lab.candidateId);
        await loadCandidates();
        publish({ candidateId: fix.candidate_id, patch: { highlight: st.highlight } });
        notify(`Suggested fix created as ${fix.candidate_id} (v${fix.version}) — NOT verified until the regression suite is re-run`, 'warn');
        return getState().lab.proposal;
      });
    },
    rerunSuite() { return wf.runReplay(); },
    resetScenario() {
      publish({ candidateId: ROOT_CANDIDATE, patch: { highlight: null } });
      set({ lab: { ...getState().lab, extraScenarios: [], selectedCase: null } });
      notify('Replay Lab view reset to the original candidate. Recorded runs and decisions are kept (append-only); Settings → Reset demo starts over.');
    },
    selectCandidate(candidateId) { publish({ candidateId }); },
    async decide(decision, { note = '' } = {}) {
      const st = getState(); const run = st.runs.find((r) => r.runId === st.lab.runIds[0]);
      if (!run || run.candidateId !== st.lab.candidateId) throw new Error('Replay the current candidate before deciding.');
      return guarded('decide', async () => {
        const res = await api.reviewCandidate(st.lab.candidateId, decision === 'approved' ? 'approve' : 'reject', note || undefined);
        await Promise.all([loadReport(run.runId), loadCandidates()]);
        publish({ patch: { highlight: null } });
        notify(decision === 'approved' ? `Approved ${st.lab.candidate.id}@${st.lab.candidate.version} (recorded with ${res.run_id}). Nothing was deployed to any device.` : `Rejected ${st.lab.candidate.id}@${st.lab.candidate.version}. Recorded with ${res.run_id || 'no run'}.`);
        return getState().lab.decision;
      });
    },
    async resetDemo() {
      return guarded('reset', async () => {
        await api.resetDemo('journey');
        raw.reports = {}; raw.runOrder = []; raw.history = {};
        set({ clarifications: [], highlight: null });
        await wf.sync();
        publish({ candidateId: ROOT_CANDIDATE });
        notify('Demo reset: backend household re-seeded (journey profile); recorded runs cleared');
      });
    },
  };
  return wf;
}
