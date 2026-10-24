// Assistant session: executes routed intents against the real SWITCH backend tools and keeps conversation context.
// The session lives at module scope so the conversation survives closing/reopening the assistant panel.
// Nothing here invents a result: every card is built from a backend tool result; failures become error cards.
import { routeIntent, resolveCandidate, routineHintOf, toCard, safeText, friendlyError } from './assistant.js';

const WELCOME = {
  role: 'assistant',
  text: 'Hi, I’m the SWITCH assistant: a simulated Alexa+ experience. Tell me a household correction and I’ll turn it into a rule you can confirm. I can also check a routine change, explain a failure, propose a fix and record your decision. I’m not connected to Amazon and I can’t control real devices.',
};

const HELP = 'Try: “Don’t turn off the hallway light while someone is there”, “What changed in Goodnight?”, “Check it”, “Why did it fail?”, “Fix it”, “Run the checks again”, “Approve it”, “Show my saved rules”, “Open Replay Lab” or “Are you connected to my Alexa?”.';

export function createAssistantSession({ api, getApp = () => ({}), onSynced = async () => {}, navigate = () => {}, resetDemo = async () => {}, reconnect = async () => {} } = {}) {
  let state = { messages: [WELCOME], busy: false, pending: null, ctx: { candidateId: null, runId: null, lastFailRunId: null, draft: null, requirement: null }, lastFailed: null };
  const subs = new Set();
  let seq = 1;
  const emit = () => subs.forEach((f) => f());
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  const setCtx = (patch) => set({ ctx: { ...state.ctx, ...patch } });
  const push = (m) => set({ messages: [...state.messages, { id: seq++, at: Date.now(), ...m }] });
  const say = (text, card) => push({ role: 'assistant', text: safeText(text), card });

  async function tool(name, args) {
    let res;
    try { res = await api.alexaTool(name, args); }
    catch (e) {
      const code = e?.status === 0 || /fetch|network|timeout|abort/i.test(e?.message || '') ? 'NETWORK' : e?.code || 'HTTP';
      const err = new Error(friendlyError(code, e?.message)); err.code = code; err.network = code === 'NETWORK'; throw err;
    }
    if (!res || typeof res !== 'object') { const err = new Error('The backend returned an empty response.'); err.code = 'EMPTY'; throw err; }
    return res;
  }
  async function fresh() {
    const r = await tool('switch_list_routines', {});
    if (r.isError) throw Object.assign(new Error(friendlyError(r.structuredContent?.error?.code, r.structuredContent?.error?.message)), { code: r.structuredContent?.error?.code });
    return r.structuredContent.candidates || [];
  }
  const sync = async () => { try { await onSynced(); } catch { /* the UI will show its own sync state */ } };

  async function currentCandidate(text) {
    const cands = await fresh();
    const c = resolveCandidate(cands, { focus: state.ctx.candidateId, uiSelected: getApp().lab?.candidateId, routineHint: routineHintOf(text || '') });
    return { cand: c, cands };
  }

  // ---------------------------------------------------------------- intent handlers
  const H = {
    help: async () => say(HELP),
    unknown: async () => say(`I’m not sure what you’d like me to do. ${HELP}`),
    nothing_pending: async () => say('There is nothing waiting for your confirmation right now, so I didn’t change anything.'),
    navigate: async ({ page }) => { navigate(page); say(`Opened ${{ replay: 'Replay Lab', reports: 'Reports', requirements: 'Saved Requirements', devices: 'Devices / Integrations', settings: 'Settings', why: 'Why SWITCH', home: 'Home Overview' }[page]}.`); },
    async status() {
      const r = await tool('switch_integration_status', {});
      const card = toCard('switch_integration_status', r);
      if (card.type === 'status') {
        const ai = getApp().backend?.health?.interpreter;
        card.rows.splice(2, 0, { label: 'AI language model', value: ai?.llm_configured ? 'Optional provider configured (schema-checked)' : 'Not configured — deterministic rules interpret corrections', tone: 'neutral' });
      }
      say(r.isError ? '' : 'Here is my honest connection status.', card);
    },
    async draft({ text, context }) {
      const r = await tool('switch_create_correction_draft', context ? { text, context } : { text });
      const card = toCard('switch_create_correction_draft', r, { text });
      if (card.type === 'draft') {
        setCtx({ draft: { requirement_id: card.requirementId, version: card.version, title: card.title } });
        set({ pending: { kind: 'requirement', requirement_id: card.requirementId, version: card.version, label: `Save “${card.title}” as a household rule` } });
        say('Here’s how I understood your correction. It is a draft and is not enforced until you confirm it. Shall I save it as a rule?', card);
        await sync();
      } else if (card.type === 'clarify') say('I didn’t save anything yet; I need one more detail.', card);
      else say('', card);
    },
    async confirm() {
      const p = state.pending; set({ pending: null });
      if (p.kind === 'requirement') {
        const r = await tool('switch_confirm_requirement', { requirement_id: p.requirement_id, version: p.version, explicit_user_confirmation: true });
        const card = toCard('switch_confirm_requirement', r);
        if (card.type === 'saved') { setCtx({ requirement: { id: card.requirementId, version: card.version }, draft: null }); say(`Saved. ${card.requirementId} is now version ${card.version} and confirmed.`, card); await sync(); }
        else say('', card);
      } else if (p.kind === 'decision') {
        const r = await tool('switch_record_review_decision', { candidate_id: p.candidate_id, decision: p.decision, explicit_user_confirmation: true });
        const card = toCard('switch_record_review_decision', r);
        say(card.type === 'decision' ? `Recorded: ${card.status.toLowerCase()}.` : '', card);
        if (card.type === 'decision') await sync();
      } else if (p.kind === 'reset') {
        await resetDemo();
        set({ ctx: { candidateId: null, runId: null, lastFailRunId: null, draft: null, requirement: null } });
        say('The demo household was reset to its seeded starting point by the backend.');
        await sync();
      }
    },
    async cancel() { const p = state.pending; set({ pending: null }); say(p.kind === 'requirement' ? 'OK, I didn’t save it. The draft stays unconfirmed and is not enforced.' : 'OK, nothing was recorded.'); },
    async requirements() {
      const r = await tool('switch_list_requirements', {});
      say(r.isError ? '' : safeText(r.content?.[0]?.text), toCard('switch_list_requirements', r));
    },
    async routines() {
      const r = await tool('switch_list_routines', {});
      say(r.isError ? '' : safeText(r.content?.[0]?.text), toCard('switch_list_routines', r));
    },
    async diff({ text }) {
      const { cand } = await currentCandidate(text);
      if (!cand) return say('There is no routine change waiting for review in this household.');
      setCtx({ candidateId: cand.candidate_id });
      const r = await tool('switch_preview_routine_change', { candidate_id: cand.candidate_id });
      say(r.isError ? '' : `Here is what changes in ${cand.routine_id} v${cand.base_version} → v${cand.version}.`, toCard('switch_preview_routine_change', r));
    },
    async replay({ text }) {
      const { cand } = await currentCandidate(text);
      if (!cand) return say('There is no candidate routine to check.');
      if (cand.status !== 'PENDING_REVIEW') return say(`Candidate ${cand.candidate_id} is already ${cand.status.toLowerCase().replace('_', ' ')}; there is nothing left to check for it.`);
      setCtx({ candidateId: cand.candidate_id });
      const r = await tool('switch_run_replay', { candidate_id: cand.candidate_id });
      const card = toCard('switch_run_replay', r);
      if (card.type === 'replay') {
        setCtx({ runId: card.runId, ...(card.overall === 'FAIL' ? { lastFailRunId: card.runId } : {}) });
        say(`The deterministic replay finished: ${card.overall}.`, card);
        await sync();
      } else say('', card);
    },
    async explain() {
      let runId = state.ctx.lastFailRunId;
      if (!runId) {
        const { cand, cands } = await currentCandidate('');
        const chain = cand ? [cand, ...cands.filter((c) => c.candidate_id === cand.parent_candidate_id)] : [];
        runId = chain.map((c) => c.last_full_run).find((x) => x && x.overall !== 'PASS')?.run_id || null;
      }
      if (!runId) return say('I don’t have a failed check to explain yet. Say “Check it” to replay the routine change first.');
      const r = await tool('switch_get_replay_report', { run_id: runId });
      const card = toCard('switch_get_replay_report', r);
      say(card.type === 'failure' ? 'This is the failed assertion, taken from the recorded event trace.' : card.type === 'error' ? '' : 'That run had no failed assertions.', card);
    },
    async repair({ text }) {
      const { cand } = await currentCandidate(text);
      if (!cand) return say('There is no candidate change to repair.');
      if (cand.last_full_run?.overall === 'PASS') return say(`The latest check for ${cand.candidate_id} passed, so there is nothing to fix.`);
      if (!cand.last_full_run) return say(`I need to check ${cand.candidate_id} before I can propose a fix. Say “Check it”.`);
      const r = await tool('switch_propose_repair', { candidate_id: cand.candidate_id });
      const card = toCard('switch_propose_repair', r);
      if (card.type === 'repair') { setCtx({ candidateId: card.candidateId }); say('I proposed a constrained fix as a new candidate. It is NOT VERIFIED until the checks run again.', card); await sync(); getApp().selectCandidate?.(card.candidateId); }
      else say('', card);
    },
    async report() {
      const runId = state.ctx.runId || state.ctx.lastFailRunId || getApp().runs?.[0]?.runId;
      if (!runId) return say('No replay has been recorded yet. Say “Check it” to run one.');
      const r = await tool('switch_get_replay_report', { run_id: runId });
      say(r.isError ? '' : safeText(r.content?.[0]?.text), toCard('switch_get_replay_report', r));
    },
    async approve() { return decide('approve'); },
    async reject() { return decide('reject'); },
    async reset() {
      set({ pending: { kind: 'reset', label: 'Reset the demo household to its seeded starting point' } });
      say('This resets the demo household on the backend: drafts, confirmations, runs and decisions from this session are replaced by the seeded data. Should I reset it?');
    },
  };

  async function decide(decision) {
    const { cand } = await currentCandidate('');
    if (!cand) return say('There is no candidate change waiting for a decision.');
    setCtx({ candidateId: cand.candidate_id });
    if (cand.status !== 'PENDING_REVIEW') return say(`A decision is already recorded for ${cand.candidate_id} (${cand.status.toLowerCase()}).`);
    if (decision === 'approve') {
      if (!cand.last_full_run) return say(`I can’t ask you to approve ${cand.candidate_id} yet: it hasn’t been checked. Say “Run the checks”.`);
      if (cand.last_full_run.overall !== 'PASS') return say(`I can’t ask you to approve ${cand.candidate_id}: its latest check (${cand.last_full_run.run_id}) is ${cand.last_full_run.overall}. Ask me to fix it, then run the checks again.`);
    }
    set({ pending: { kind: 'decision', decision, candidate_id: cand.candidate_id, label: `${decision === 'approve' ? 'Approve' : 'Reject'} ${cand.candidate_id} (${cand.routine_id} v${cand.version})` } });
    say(`Do you want to ${decision} ${cand.candidate_id}${cand.last_full_run ? `, checked in ${cand.last_full_run.run_id} (${cand.last_full_run.overall})` : ''}? This only records your decision; nothing is deployed. Say “yes” to confirm.`);
  }

  async function send(raw, opts = {}) {
    const text = String(raw ?? '').trim();
    if (!text || state.busy) return false;
    push({ role: 'user', text });
    const online = getApp().mode === 'backend';
    if (!online && !opts.force) {
      say('', { type: 'error', code: 'OFFLINE', title: 'SWITCH backend is offline', message: 'The assistant runs every action on the SWITCH backend, which isn’t reachable right now. I won’t make up an answer. Start the backend, then press Retry.', retry: text });
      return false;
    }
    const intent = opts.intent || routeIntent(text, { pending: state.pending });
    set({ busy: true });
    try { await (H[intent.intent] || H.unknown)({ ...intent, text: intent.text || text }); }
    catch (e) {
      say('', { type: 'error', code: e.code, title: e.network ? 'Couldn’t reach the SWITCH backend' : 'That did not go through', message: e.message || 'Request failed.', retry: e.network ? text : undefined });
    } finally { set({ busy: false }); }
    return true;
  }

  /** Answer a clarification option: re-interpret the same correction with the chosen value as context. */
  function answer(sourceText, key, value, label) {
    const context = key === 'device_id' ? { selected_device_id: value } : { [key]: value };
    return send(label ? `${label}` : String(value), { intent: { intent: 'draft', text: sourceText, context } });
  }

  return {
    getState: () => state,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    send, answer,
    retry: async (text) => { try { await reconnect(); } catch { /* send() reports the outcome */ } return send(text); },
    clear: () => set({ messages: [WELCOME], pending: null, ctx: { candidateId: null, runId: null, lastFailRunId: null, draft: null, requirement: null } }),
  };
}
