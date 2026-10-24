import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, X, MessageSquareQuote, FlaskConical } from 'lucide-react';
import { useApp, useReducedMotion } from '../state/StoreContext.jsx';
import * as SW from '../sim/switch.js';
import { describeEvent, resultTone } from '../ui/format.js';
import { DiffView, Provenance } from './ReplayLabPage.jsx';

/** The same 10-step story, but read from the canonical records the household actually created (SWITCH backend). */
function RecordedJourney({ onGo }) {
  const { state, q } = useApp();
  if (q.mode() !== 'backend') return null;
  const runs = [...state.runs].reverse();                          // oldest first
  const fail = runs.find((r) => r.kind !== 'exploratory' && r.cases.some((c) => c.result === 'FAIL'));
  if (!fail) return <section className="card journey" aria-labelledby="journey-title"><h2 id="journey-title">Your recorded journey</h2>
    <p className="muted">Once you confirm a correction and run a replay that fails, this section shows the same story from the real records: correction, confirmed version, diff, trace, failed assertion, repair, rerun and your decision.</p>
    <button type="button" className="btn btn-sm" onClick={() => onGo({ page: 'requirements' })}>Start in Saved Requirements</button></section>;
  const fc = fail.cases.find((c) => c.result === 'FAIL');
  const req = q.requirements().find((r) => r.id === fc.requirement);
  const repairCand = q.candidates().find((c) => c.parentId === fail.candidateId);
  const rerun = repairCand ? runs.filter((r) => r.candidateId === repairCand.candidateId && r.kind === 'full').pop() : null;
  const rp = fail.replays[fc.scenario];
  const rows = [
    ['Household correction', <>“{req?.sourceText}”</>],
    ['Confirmed requirement & version', <><code>{fc.requirement}</code> v{fc.version} · {req?.status}{req?.confirmation ? ` · confirmed by ${req.confirmation.by} at ${req.confirmation.at}` : ''}</>],
    ['Routine change', <>{fail.changes.filter((c) => c.path !== 'version').map((c) => c.summary).join('; ') || '—'} <small>({fail.base.id}@{fail.base.version} → {fail.routine.version}, candidate {fail.candidateId})</small></>],
    ['Replay trace', <>{rp?.trace.map((e) => `${e.event_id} ${describeEvent(e)}`).slice(0, 6).join(' → ')}</>],
    ['Failed assertion', <><span className="res res-fail">FAIL</span> {fc.reason}</>],
    ['Proposed repair', repairCand ? <>{repairCand.candidateId} ({repairCand.version}) · {repairCand.repairProvenance?.proposer_label} · validator {repairCand.repairProvenance?.validator?.status}</> : <span className="muted">not proposed yet</span>],
    ['Regression rerun', rerun ? <><span className={`res res-${resultTone(rerun.verdict)}`}>{rerun.verdict}</span> {rerun.runId} · PASS {rerun.counts.PASS} · FAIL {rerun.counts.FAIL} · INCONCLUSIVE {rerun.counts.INCONCLUSIVE}</> : <span className="muted">not rerun yet</span>],
    ['Human decision', rerun?.decision ? <>{rerun.decision.decision.toUpperCase()} by {rerun.decision.by} · recorded with {rerun.decision.runId} · nothing deployed</> : <span className="muted">no decision recorded</span>],
  ];
  return <section className="card journey" aria-labelledby="journey-title" data-testid="recorded-journey">
    <h2 id="journey-title">Your recorded journey</h2>
    <p className="small"><Provenance run={fail} /> · source runs {fail.runId}{rerun ? ` and ${rerun.runId}` : ''}</p>
    <ol className="journey-list">{rows.map(([k, v]) => <li key={k}><b>{k}</b><div>{v}</div></li>)}</ol>
    <button type="button" className="btn btn-sm" onClick={() => onGo({ page: 'reports' })}>Open the reports</button>
  </section>;
}

const CORRECTION = "Don't turn off the hallway light while someone is there.";
const STEPS = [
  ['Household correction', 'The exact statement and its context.'],
  ['Proposed structured requirement', 'SWITCH turns the sentence into a testable rule.'],
  ['Explicit confirmation', 'Nothing becomes household policy without a person confirming it.'],
  ['Saved requirement & version', 'A stable ID, version and confirmation record.'],
  ['Routine change', 'A later edit removes the occupancy condition.'],
  ['Replay', 'Deterministic modeled scenario with occupancy = true.'],
  ['Failed assertion & evidence', 'Which requirement failed and the exact event.'],
  ['Proposed repair', 'A constrained suggestion, kept separate from verification.'],
  ['Regression rerun', 'The whole relevant suite, not just one assertion.'],
  ['Human decision', 'A person approves or rejects. No silent deployment.'],
];

/** Everything shown in the walkthrough is computed by the real engine in an isolated sandbox. */
function useSandbox() {
  return useMemo(() => {
    const store = SW.seedDemoRequirements(new SW.RequirementStore());
    const parsed = SW.parseCorrection(CORRECTION);
    const draft = store.createDraft(parsed, { by: 'Asha (household)', at: 0 });
    const req = store.confirmDraft(draft.draftId, { confirmed: true, by: 'Asha (household)', at: 0 });
    const diff = SW.routineDiff(SW.GOODNIGHT_LIVE, SW.GOODNIGHT_CANDIDATE);
    const replay = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, SW.GOODNIGHT_CANDIDATE, [req]);
    const fail = replay.results[0];
    const repair = SW.suggestRepair(SW.GOODNIGHT_CANDIDATE, fail);
    const rerun = SW.runSuite({ routine: repair.routine, requirements: store.active(), runId: 'SANDBOX-RERUN', base: SW.GOODNIGHT_CANDIDATE });
    return { parsed, draft, req, diff, replay, fail, repair, rerun };
  }, []);
}

function StepBody({ i, sb, reduced, decision, setDecision }) {
  const [shown, setShown] = useState(reduced ? 99 : 0);
  useEffect(() => { if (i !== 5 || reduced) return undefined; setShown(0); const h = setInterval(() => setShown((n) => n + 1), 550); return () => clearInterval(h); }, [i, reduced]);
  const t = sb.replay.trace;
  switch (i) {
    case 0: return <>
      <p className="quote big"><MessageSquareQuote size={20} /> “{CORRECTION}”</p>
      <dl className="req-dl"><dt>When</dt><dd>23:10 — the Goodnight routine ran while someone was still walking down the hallway.</dd><dt>What happened</dt><dd>The hallway light turned off on them. They turned it back on by hand.</dd><dt>Why capture it</dt><dd>A single manual override is not always a rule (a guest, a sensor glitch). SWITCH asks before treating it as one.</dd></dl></>;
    case 1: return <>
      <p className="muted">Output of SWITCH's rule-based interpreter (the optional AI layer would only propose this; it never decides results):</p>
      <dl className="req-dl"><dt>Title</dt><dd>{sb.parsed.draft.title}</dd><dt>Scope</dt><dd>room · Hallway · Hallway lights</dd><dt>Precondition</dt><dd>{sb.parsed.draft.preconditions[0]}</dd><dt>Expected</dt><dd>{sb.parsed.draft.expectedBehavior}</dd></dl>
      <pre className="code">{JSON.stringify(sb.parsed.draft.assertion, null, 2)}</pre></>;
    case 2: return <>
      <div className="confirm-box"><p><b>SWITCH asks:</b> “Should ‘{sb.parsed.draft.title}’ become a saved household requirement that future routine changes are checked against?”</p>
        <div className="btn-row"><span className="btn btn-ok" aria-hidden><Check size={16} /> Yes, save it</span><span className="btn btn-ghost" aria-hidden>Not a rule — just this once</span></div></div>
      <p className="muted">Until a person answers yes, it stays a <span className="res res-review">DRAFT</span> and is never enforced. Saving without confirmation is rejected by the requirement store.</p></>;
    case 3: return <dl className="req-dl"><dt>ID</dt><dd><code>{sb.req.id}</code> (stable)</dd><dt>Version</dt><dd>v{sb.req.version}</dd><dt>Status</dt><dd><span className="res res-pass">{sb.req.status}</span></dd><dt>Confirmed by</dt><dd>{sb.req.confirmation.by}</dd><dt>Source correction</dt><dd>“{sb.req.sourceText}”</dd><dt>Household</dt><dd>{sb.req.householdId}</dd></dl>;
    case 4: return <><p className="muted">Weeks later someone simplifies Goodnight. The live version <code>{SW.GOODNIGHT_LIVE.version}</code> vs the edit <code>{SW.GOODNIGHT_CANDIDATE.version}</code>:</p><DiffView diff={sb.diff} /><p className="ctl-note">Step 2 lost its “unless Hallway is occupied” condition.</p></>;
    case 5: return <><p className="muted">Scenario <code>{SW.SCENARIO_GOODNIGHT_HALLWAY.id}</code>: hallway light on, motion in the hallway, then Goodnight runs. Simulated clock, fixed event order:</p>
      <ol className="timeline compact" aria-live="polite">{t.slice(0, Math.max(1, shown)).map((e) => <li key={e.seq} className={`tl ${e.seq === sb.fail.offending.seq ? 'tl-bad' : ''}`}><div><span className="tl-seq">#{e.seq}</span><span className="tl-t">{SW.scenarioClock('23:00:00', e.t)}</span><span className="tl-msg">{describeEvent(e)}</span></div></li>)}</ol>
      {shown < t.length && !reduced && <p className="ctl-note">Replaying… {Math.min(shown, t.length)} / {t.length} events</p>}</>;
    case 6: return <><div className="callout fail"><span className={`res res-${resultTone(sb.fail.result)}`}>{sb.fail.result}</span> <b>{sb.fail.requirement} v{sb.fail.version}</b> — {sb.fail.reason}</div>
      <dl className="req-dl"><dt>Offending event</dt><dd>#{sb.fail.offending.seq}: {describeEvent(sb.fail.offending)}</dd><dt>Caused by</dt><dd>{sb.fail.offending.routine}, step {sb.fail.offending.step}</dd><dt>State at that moment</dt><dd>Hallway occupancy = true</dd></dl>
      <p className="ctl-note">Not just a red badge: the assertion, the event and the routine step are all identified.</p></>;
    case 7: return <><DiffView diff={sb.repair.structured} /><p className="explain"><b>Why:</b> {sb.repair.explanation}</p><p className="res res-review">Proposed — not verified</p></>;
    case 8: return <><p className="muted">The repaired candidate is replayed against every relevant saved requirement:</p>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Scenario</th><th>Result</th></tr></thead><tbody>
        {sb.rerun.cases.map((c) => <tr key={c.requirement + c.scenario}><td><b>{c.requirement}</b> {c.title}</td><td>{SW.getScenario(c.scenario)?.name}</td><td><span className={`res res-${resultTone(c.result)}`}>{c.result}</span></td></tr>)}</tbody></table></div>
      <p>Suite verdict: <span className={`res res-${resultTone(sb.rerun.verdict)}`}>{sb.rerun.verdict}</span> — for these modeled scenarios and versions only.</p></>;
    case 9: return <><p>The evidence is in front of the person who owns the home. They decide.</p>
      <div className="btn-row"><button type="button" className="btn btn-ok" onClick={() => setDecision('approved')}><Check size={16} /> Approve</button><button type="button" className="btn btn-danger" onClick={() => setDecision('rejected')}><X size={16} /> Reject</button></div>
      {decision && <p className={`res res-${decision === 'approved' ? 'pass' : 'neutral'}`} role="status">Sandbox decision: {decision.toUpperCase()} — recorded with the rerun; nothing is deployed anywhere.</p>}
      <p className="callout">A PASS means the selected modeled requirements passed for the recorded scenario and versions. It does not certify the real home.</p></>;
    default: return null;
  }
}

export default function WhyPage({ onGo }) {
  const { state } = useApp(); const reduced = useReducedMotion(state.settings);
  const sb = useSandbox();
  const [i, setI] = useState(0); const [decision, setDecision] = useState(null);
  return <div className="why">
    <section className="why-hero">
      <p className="eyebrow">Why SWITCH</p>
      <h1>A fix today should not become a failure tomorrow.</h1>
      <p className="lede">SWITCH is designed to remember the corrections your household explicitly confirms. When a related routine changes, it replays those requirements against the new behaviour and shows the evidence. That is the product hypothesis — not a claim that conflict detection or regression testing itself is new.</p>
      <span className="badge badge-sim">Walkthrough: illustration computed by the in-browser engine in a sandbox</span>
    </section>

    <RecordedJourney onGo={onGo} />

    <section className="walk" aria-label="Correction to regression test walkthrough">
      <ol className="walk-steps" role="tablist" aria-orientation="vertical">
        {STEPS.map(([title, sub], k) => <li key={title} role="presentation"><button type="button" role="tab" aria-selected={i === k} className={`${i === k ? 'on' : ''} ${k < i ? 'done' : ''}`} onClick={() => setI(k)} data-testid={`why-step-${k + 1}`}>
          <span className="walk-n">{k < i ? <Check size={14} /> : k + 1}</span><span><b>{title}</b><small>{sub}</small></span></button></li>)}
      </ol>
      <div className="card walk-body" role="tabpanel" aria-live="polite">
        <p className="eyebrow">Step {i + 1} of {STEPS.length}</p>
        <h2>{STEPS[i][0]}</h2>
        <div className="walk-content"><StepBody i={i} sb={sb} reduced={reduced} decision={decision} setDecision={setDecision} /></div>
        <div className="walk-nav"><button type="button" className="btn btn-ghost" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0}><ChevronLeft size={16} /> Back</button>
          <div className="walk-progress" aria-hidden><i style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
          {i < STEPS.length - 1 ? <button type="button" className="btn btn-primary" onClick={() => setI((k) => k + 1)} data-testid="why-next">Next <ChevronRight size={16} /></button>
            : <button type="button" className="btn btn-primary" onClick={() => onGo({ page: 'replay' })}><FlaskConical size={16} /> Try it in Replay Lab</button>}</div>
      </div>
    </section>

    <section className="section grid-2">
      <div className="card"><h2>How it differs — without overclaiming</h2>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Generic capability</th><th>SWITCH's proposed focus</th></tr></thead><tbody>
          <tr><td>Detect a conflict once</td><td>Preserve a confirmed correction as a reusable requirement</td></tr>
          <tr><td>Show a suggested fix</td><td>Show which saved expectation failed, the event trace, the proposed change and the rerun result</td></tr>
          <tr><td>Use AI to explain or generate a change</td><td>AI only interprets or suggests; deterministic checks own pass/fail</td></tr>
          <tr><td>Test the current scenario</td><td>Replay relevant saved requirements after a related routine edit</td></tr>
          <tr><td>Promise that a home is safe</td><td>Report exactly which modeled requirements passed, failed or could not be evaluated</td></tr>
        </tbody></table></div></div>
      <div className="card"><h2>What we do not claim</h2>
        <ul className="claims">
          <li>Not “world’s first”, “guaranteed safe” or “prevents all conflicts”.</li>
          <li>Not that no existing product does this — the prior-art review is preliminary.</li>
          <li>No live Alexa / Alexa+ integration: this prototype is not connected to Amazon.</li>
          <li>An AI-suggested fix is not “verified” until the deterministic suite is re-run.</li>
          <li>Natural-language testing, conflict detection and regression testing are not new on their own; the hypothesis is the consumer correction → confirmed requirement → future replay loop.</li>
        </ul>
        <p className="muted">We are testing the hypothesis that turning confirmed household corrections into reusable regression requirements makes routine changes easier to verify over time.</p>
      </div>
    </section>
  </div>;
}
