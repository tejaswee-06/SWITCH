// SWITCH assistant: deterministic intent routing + typed view models for tool results.
//
// Layering (kept deliberately separate):
//   routeIntent(text, ctx)  -> what the person asked for (no I/O)
//   session.js              -> executes the intent against the SWITCH backend tools (I/O, context, confirmations)
//   toCard(tool, result)    -> converts a real backend tool result into a typed view model for the UI (no I/O)
// No verdict is computed here: PASS / FAIL / INCONCLUSIVE are copied from the backend evaluator.
import { routineToView, traceEventToView, canonLabel } from '../api/canonicalMap.js';
import { routineDiff, describeStep } from '../sim/switch.js';
import { describeEvent } from '../ui/format.js';

export const SUGGESTIONS = [
  "Don't turn off the hallway light while someone is there",
  'Yes, save it as a rule',
  'What changed in Goodnight?',
  'Check it',
  'Why did it fail?',
  'Fix it',
  'Run the checks again',
  'Approve it',
  'Show my saved rules',
  'Are you connected to my Alexa?',
];

const strip = (t) => String(t || '').replace(/^\s*(hey\s+|ok\s+)?(alexa|switch)[,!.]?\s*/i, '').trim();
const has = (re, t) => re.test(t);

/** Does this look like a household correction rather than a command or small talk? */
export function looksLikeCorrection(t) {
  return /\b(don'?t|do not|never|always|keep|stop|leave|make sure|shouldn'?t|should not|must)\b/.test(t)
    && /\b(light|lights|lamp|tv|television|lock|door|security|alarm|fan|ac|air|thermostat|coffee|purifier|turn|switch|arm|unlock)\b/.test(t);
}

const PAGES = [
  [/replay ?lab|timeline/, 'replay'], [/reports?\b|history/, 'reports'], [/requirements?|rules?/, 'requirements'],
  [/devices?|integrations?/, 'devices'], [/settings?/, 'settings'], [/why switch|how (it|switch) works/, 'why'], [/home|house|villa|overview/, 'home'],
];

/**
 * Map an utterance to an intent. Pure and deterministic. ctx: { pending, hasDraft }.
 * Returns { intent, ... } where intent is one of:
 * help | confirm | cancel | nothing_pending | status | reset | requirements | routines | diff | replay | explain | repair |
 * report | approve | reject | navigate | draft
 */
export function routeIntent(text, ctx = {}) {
  const raw = strip(text);
  const t = raw.toLowerCase().replace(/[’`]/g, "'");
  if (!t) return { intent: 'help' };
  const yes = /^(yes|yeah|yep|yup|sure|confirm|confirmed|do it|go ahead|please do|ok(ay)?|save it|that'?s right|correct)\b/.test(t);
  const no = /^(no|nope|cancel|stop|never ?mind|don'?t save|not now|discard)\b/.test(t) && !looksLikeCorrection(t);
  if (yes) return ctx.pending ? { intent: 'confirm' } : { intent: 'nothing_pending' };
  if (no) return ctx.pending ? { intent: 'cancel' } : { intent: 'nothing_pending' };
  if (/^(hi|hello|hey|help|what can you do|thanks|thank you)\b/.test(t) && !looksLikeCorrection(t)) return { intent: 'help' };
  if (has(/\b(connected|integration|status|health|amazon|real alexa|are you (real|live|alexa)|simulat|online|offline|backend)\b/, t)) return { intent: 'status' };
  if (has(/\breset\b/, t)) return { intent: 'reset' };
  const nav = t.match(/^(open|go to|take me to|navigate to|show me the|show the)\s+(.+)$/);
  if (nav && (/^(open|go|take|navigate)/.test(nav[1]) || /\bpage\b/.test(nav[2]))) {
    const hit = PAGES.find(([re]) => re.test(nav[2])); if (hit) return { intent: 'navigate', page: hit[1] };
  }
  if (has(/\bwhy\b|\bexplain\b|what (went wrong|failed|broke)|\bfailure\b|\bevidence\b|\btrace\b/, t)) return { intent: 'explain' };
  if (has(/\b(approve|accept|sign off)\b/, t)) return { intent: 'approve' };
  if (has(/\breject\b|\bdecline\b/, t)) return { intent: 'reject' };
  if (has(/\b(fix|repair|propose|suggest)\b/, t) && !looksLikeCorrection(t)) return { intent: 'repair' };
  if (has(/what changed|\bdiff\b|\bcompare\b|\bversions?\b|\bpreview\b|\bdifference\b|\bchanges?\b/, t) && !looksLikeCorrection(t)) return { intent: 'diff' };
  if (has(/re-?run|\bcheck\b|\bchecks\b|\breplay\b|\bverify\b|\btest\b|\bregression\b|\bagain\b/, t) && !looksLikeCorrection(t)) return { intent: 'replay' };
  if (has(/\breport\b|\bruns?\b|\bresults?\b|\bhistory\b/, t)) return { intent: 'report' };
  if (has(/\b(rules?|requirements?)\b/, t) && !looksLikeCorrection(t)) return { intent: 'requirements' };
  if (has(/\broutines?\b|\bcandidates?\b/, t) && !looksLikeCorrection(t)) return { intent: 'routines' };
  if (looksLikeCorrection(t)) return { intent: 'draft', text: raw };
  return { intent: 'unknown' };
}

/** Which candidate does "it" refer to? Conversation focus first, then the UI selection, then the newest pending one. */
export function resolveCandidate(candidates = [], { focus, uiSelected, routineHint } = {}) {
  const pending = candidates.filter((c) => c.status === 'PENDING_REVIEW');
  const byId = (id) => candidates.find((c) => c.candidate_id === id);
  if (routineHint) {
    const forRoutine = pending.filter((c) => c.routine_id.toLowerCase().includes(routineHint));
    const f = byId(focus); if (f && f.routine_id.toLowerCase().includes(routineHint)) return f;
    if (forRoutine.length) return forRoutine[forRoutine.length - 1];
  }
  return byId(focus) || byId(uiSelected) || pending[pending.length - 1] || candidates[candidates.length - 1] || null;
}

export const routineHintOf = (text) => (String(text).toLowerCase().match(/\b(goodnight|good night|welcome|morning|away)\b/)?.[1] || '').replace(' ', '');

// ---------------------------------------------------------------------------------------------- view models
const actionText = (a) => { try { return describeStep(routineToView({ routine_id: 'x', name: 'x', version: 1, actions: [a] }).steps[0]); } catch { return `${canonLabel(a.device)} ${a.attr} → ${a.value}`; } };
export function readableDiff(before, after) {
  if (!before || !after) return null;
  try { return routineDiff(routineToView(before), routineToView(after)); } catch { return null; }
}
const condText = (c) => c ? `${canonLabel(c.device)} ${c.attr} ${c.op === 'eq' ? 'is' : c.op} ${String(c.value)}` : '';
export function behaviorText(eb) {
  if (!eb) return '';
  const dev = canonLabel(eb.device); const val = typeof eb.value === 'boolean' ? (eb.value ? 'on' : 'off') : String(eb.value);
  if (eb.kind === 'must_not_set') return `${dev} must not be set to ${val}`;
  if (eb.kind === 'final_state_equals') return `${dev} must end ${val}`;
  return `${dev}: ${eb.kind.replaceAll('_', ' ')} ${val}`;
}
const eventText = (e) => { try { return describeEvent(traceEventToView(e)); } catch { return e.type || 'event'; } };

/** Human-readable technical details (never a serialized object). */
function details(rows) { return rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, v]) => ({ label, value: Array.isArray(v) ? v.join(', ') : String(v) })); }

const ERR_HELP = {
  VERIFICATION_REQUIRED: 'This change has not been checked yet. Say “run the checks” first.',
  SUITE_NOT_PASSING: 'The latest check did not pass, so it cannot be approved. Ask me to fix it, then run the checks again.',
  STALE_REPLAY: 'Something changed since the last check. Run the checks again before approving.',
  INVALID_TRANSITION: 'A decision has already been recorded for this candidate.',
  NEEDS_CLARIFICATION: 'I need more detail before this can be saved.',
  FORBIDDEN: 'Your role is not allowed to do that in this household.',
  NOT_FOUND: 'I could not find that item in this household.',
  INVALID_ARGUMENTS: 'That request was not valid for this tool.',
  NETWORK: 'The SWITCH backend did not answer.',
};
export const friendlyError = (code, message) => ERR_HELP[code] || message || 'Something went wrong.';

/** Convert a backend tool result into a typed card. `result` is the MCP tools/call result {content, structuredContent, isError}. */
export function toCard(tool, result, extra = {}) {
  const sc = (result && typeof result === 'object' && result.structuredContent && typeof result.structuredContent === 'object') ? result.structuredContent : null;
  if (!sc) return { type: 'error', title: 'Unexpected response', message: 'The backend answered in a format I do not understand, so I am not showing it as a result.', retry: true };
  if (result.isError) {
    const e = sc.error || {};
    return { type: 'error', code: e.code, title: 'That did not go through', message: friendlyError(e.code, e.message),
      detail: e.message && ERR_HELP[e.code] ? e.message : undefined, tech: details([['Tool', tool], ['Code', e.code]]) };
  }
  const base = { tool, tech: details([['Tool', tool], ['Mode', sc.mode], ['Household', sc.household_id], ['Action', sc.action_kind]]) };
  switch (tool) {
    case 'switch_integration_status': {
      const s = sc.status || {};
      return { ...base, type: 'status', rows: [
        { label: 'SWITCH backend', value: 'Connected (this computer)', tone: 'pass' },
        { label: 'Deterministic replay engine', value: 'Available', tone: 'pass' },
        { label: 'Alexa+', value: `${s.label || 'SIMULATED DEMO'} — not connected to Amazon`, tone: 'review' },
        { label: 'Amazon account / voice', value: 'Not connected', tone: 'neutral' },
        { label: 'Physical devices', value: 'Not connected — all devices are modeled', tone: 'neutral' },
      ], blockers: s.live?.blockers || [], tech: [...base.tech, ...details([['Route', s.route], ['Adapter', s.adapter_version], ['Protocol model', s.protocol_model], ['Data sent externally', s.data_sent_externally]])] };
    }
    case 'switch_create_correction_draft': {
      if (sc.action_kind === 'CLARIFICATION_NEEDED_NOTHING_SAVED') {
        const qs = (sc.proposal?.questions || []).map((q) => ({ question: q.question, key: q.answer_key, options: (q.options || []).slice(0, 8).map((o) => ({ label: o.label, value: o.value })) }));
        return { ...base, type: 'clarify', title: 'I need a little more detail', questions: qs, sourceText: extra.text };
      }
      const d = sc.draft || {};
      return { ...base, type: 'draft', title: d.title, requirementId: d.requirement_id, version: d.version, status: d.status,
        expected: behaviorText(d.expected_behavior), when: (d.preconditions || []).map(condText).join(' and '), source: d.source_correction,
        tech: [...base.tech, ...details([['Requirement', d.requirement_id], ['Interpreter', d.interpreter], ['Scenarios', d.scope?.scenario_ids]])] };
    }
    case 'switch_confirm_requirement': {
      const r = sc.requirement || {};
      return { ...base, type: 'saved', title: r.title, requirementId: r.requirement_id, version: r.version, status: r.status,
        expected: behaviorText(r.expected_behavior), routines: r.scope?.routine_ids || [], confirmedBy: r.confirmation?.confirmed_by,
        next: 'Ask “What changed in Goodnight?” or “Check it” to test a routine change against it.' };
    }
    case 'switch_list_requirements':
      return { ...base, type: 'requirements', items: (sc.requirements || []).map((r) => ({ id: r.requirement_id, version: r.version, status: r.status, title: r.title, last: r.last_result?.status || null })) };
    case 'switch_get_requirement': {
      const r = sc.requirement || {};
      return { ...base, type: 'requirements', items: [{ id: r.requirement_id, version: r.version, status: r.status, title: r.title, last: r.last_result?.status || null }] };
    }
    case 'switch_list_routines':
      return { ...base, type: 'routines', routines: (sc.routines || []).map((r) => ({ id: r.routine_id, name: r.name, version: r.version, steps: (r.actions || []).length })),
        candidates: (sc.candidates || []).map((c) => ({ id: c.candidate_id, routineId: c.routine_id, version: c.version, status: c.status, last: c.last_full_run?.overall || null, description: c.description })) };
    case 'switch_preview_routine_change': {
      const c = sc.candidate || {};
      return { ...base, type: 'diff', candidateId: c.candidate_id, routineId: c.routine_id, from: c.base_version, to: c.version, description: c.description,
        changes: (sc.diff || []).filter((x) => x.path !== 'version').map((x) => x.summary), diff: readableDiff(sc.before, sc.after),
        affected: (sc.affected_requirements || []).map((r) => `${r.title} (v${r.version})`), next: 'Say “Check it” to replay this change against your confirmed rules.' };
    }
    case 'switch_run_replay': {
      const cand = sc.candidate || {};
      return { ...base, type: 'replay', runId: sc.run_id, overall: sc.overall, totals: sc.totals || {}, candidateId: cand.candidate_id, routineId: cand.routine_id, version: cand.routine_version ?? cand.version,
        findings: (sc.findings || []).map((f) => ({ status: f.status, requirementId: f.requirement_id, scenarioId: f.scenario_id, reason: f.reason, events: f.evidence_event_ids || [] })),
        next: sc.overall === 'FAIL' ? 'Ask “Why did it fail?” or “Fix it”.' : sc.overall === 'PASS' ? 'All selected rules passed in the modeled scenarios. You can approve or reject the change.' : 'Some checks could not be decided; nothing is assumed to pass.',
        tech: [...base.tech, ...details([['Run', sc.run_id], ['Simulator', sc.simulator_version], ['Correlation', sc.correlation_id], ['Run kind', sc.kind]])] };
    }
    case 'switch_get_replay_report': {
      const f = (sc.failure_details || [])[0];
      if (!f) return { ...base, type: 'replay', runId: sc.run_id, overall: sc.overall, totals: sc.totals || {}, candidateId: sc.candidate?.candidate_id, findings: [], next: 'No failed assertions in this run.' };
      return { ...base, type: 'failure', runId: sc.run_id, overall: sc.overall, candidateId: sc.candidate?.candidate_id, routineId: sc.candidate?.routine_id, version: sc.candidate?.routine_version ?? sc.candidate?.version,
        requirementId: f.requirement_id, requirementVersion: f.requirement_version, title: f.requirement_title, expected: behaviorText(f.expected_behavior),
        scenarioId: f.scenario_id, reason: f.reason, events: (f.events || []).map((e) => ({ id: e.event_id, time: e.sim_time, text: eventText(e) })),
        more: Math.max(0, (sc.failure_details || []).length - 1), next: 'Say “Fix it” to propose a constrained repair.',
        tech: [...base.tech, ...details([['Run', sc.run_id], ['Requirement', `${f.requirement_id} v${f.requirement_version}`], ['Scenario', f.scenario_id]])] };
    }
    case 'switch_propose_repair': {
      const pv = sc.provenance || {};
      return { ...base, type: 'repair', candidateId: sc.candidate_id, parentId: sc.parent_candidate_id, version: sc.version, verified: sc.verified === true,
        explanation: pv.explanation, proposer: pv.proposer_label, validator: pv.validator?.status, diff: readableDiff(sc.before, sc.after),
        ops: (sc.repair_ops || []).map((o) => o.op?.replaceAll('_', ' ')).filter(Boolean), next: 'Say “Run the checks again” to verify it.',
        tech: [...base.tech, ...details([['New candidate', sc.candidate_id], ['Parent', sc.parent_candidate_id], ['AI model used', pv.ai_model_used ? 'yes' : 'no'], ['Evidence run', pv.evidence?.run_id]])] };
    }
    case 'switch_record_review_decision': {
      const d = sc.decision || {};
      return { ...base, type: 'decision', status: d.status, candidateId: d.candidate_id, runId: d.run_id, deployed: d.deployed === true,
        note: 'Your decision is recorded. Nothing was deployed to any device.' };
    }
    default:
      return { ...base, type: 'note', text: typeof sc.say === 'string' ? sc.say : 'Done.' };
  }
}

/** Never let serialized objects through as prose. */
export function safeText(s) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  if ((t.startsWith('{') || t.startsWith('[')) && /"\s*:/.test(t)) return '';
  return t.length > 900 ? `${t.slice(0, 900)}…` : t;
}

export { actionText };
