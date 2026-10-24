import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Wrench, RefreshCw, RotateCcw, ListTree, Check, X, ShieldAlert, GitCompare, Clock3, Beaker, Server, Cpu } from 'lucide-react';
import { useApp, useEnvironment, useReducedMotion } from '../state/StoreContext.jsx';
import HouseViewer from '../three/HouseViewer.jsx';
import { DEVICES, ROOMS } from '../sim/engine.js';
import { routineDiff, getScenario, stateAt, scenarioClock, describeStep } from '../sim/switch.js';
import { describeEvent, eventTone, resultTone } from '../ui/format.js';
import { canonLabel } from '../api/canonicalMap.js';

export function DiffView({ diff, testId }) {
  if (!diff) return null;
  return <div className="diff" data-testid={testId}>
    {diff.rows.map((r) => <div key={r.step} className={`diff-row diff-${r.type}`}>
      <span>step {r.step}</span>
      <div>{r.type === 'same' ? <span className="diff-same">{r.after}</span> : <>{r.before && <span className="diff-del"><span className="sr-only">removed: </span>{r.before}</span>}{r.after && <span className="diff-add"><span className="sr-only">added: </span>{r.after}</span>}</>}</div>
    </div>)}
  </div>;
}

/** Engine provenance shown next to every result, so a local fallback is never mistaken for the canonical evaluator. */
export function Provenance({ run, mode }) {
  if (run?.source === 'backend' || (!run && mode === 'backend')) return <span className="prov prov-backend"><Server size={13} aria-hidden /> Evaluated by the SWITCH backend (Person 2 deterministic evaluator{run ? `, simulator ${run.simulatorVersion}` : ''})</span>;
  return <span className="prov prov-local"><Cpu size={13} aria-hidden /> Evaluated by the in-browser simulator{run ? ` (${run.simulator})` : ''} — local / offline fallback</span>;
}

const devLabel = (id) => DEVICES[id]?.label || canonLabel(id);
const scenName = (run, id) => run?.scenarios.find((s) => s.id === id)?.name || getScenario(id)?.name || id;

function stateTitle(lab, run) {
  if (lab.decision) return { tone: lab.decision.decision === 'approved' ? 'pass' : 'neutral', text: `Candidate ${lab.decision.decision} by ${lab.decision.by} (recorded with ${lab.decision.runId})` };
  if (!lab.candidate) return { tone: 'neutral', text: 'No candidate routine loaded' };
  if (!run) return { tone: 'review', text: `Candidate ${lab.candidate.version} has not been replayed yet` };
  if (run.routine.version !== lab.candidate.version) return { tone: 'review', text: 'Suggested fix applied — not verified until the regression suite is re-run' };
  if (run.verdict === 'PASS') return { tone: 'pass', text: `PASS in ${run.runId} — awaiting your decision` };
  return { tone: resultTone(run.verdict), text: `${run.verdict} in ${run.runId}` };
}

export default function ReplayLabPage({ onGo }) {
  const { state, actions, q } = useApp();
  const { env } = useEnvironment(state.settings);
  const reduced = useReducedMotion(state.settings);
  const mode = q.mode();
  const lab = state.lab; const run = actions.currentRun();
  const busy = state.backend.busy;
  const [scen, setScen] = useState(null);
  const [play, setPlay] = useState({ idx: null, playing: false });
  const [traceOpen, setTraceOpen] = useState(false);
  const [note, setNote] = useState(''); const [override, setOverride] = useState(false);
  const [viewMode, setViewMode] = useState('room'); const [vRoom, setVRoom] = useState(state.highlight?.room || 'hallway'); const [vDev, setVDev] = useState(null);
  const timelineRef = useRef(null);

  const sel = q.plannedSuite();
  const active = q.activeRequirements();
  const allScen = q.scenarios();
  const baseRoutine = state.live.goodnight;
  const diffLive = lab.candidate && baseRoutine ? routineDiff(baseRoutine, lab.proposal ? lab.proposal.from : lab.candidate) : null;
  const plannedScenarios = useMemo(() => {
    if (mode === 'backend') return allScen.filter((s) => !s.edgeCase || lab.extraScenarios.includes(s.id));
    const ids = new Set(lab.extraScenarios); sel.selected.forEach((r) => (r.scenarios || []).forEach((id) => ids.add(id)));
    return [...ids].map(getScenario).filter(Boolean);
  }, [mode, allScen, lab.extraScenarios, sel.selected]);
  const runScenarios = run ? run.scenarios.map((s) => s.id) : [];
  const curScen = run ? (runScenarios.includes(scen) ? scen : (run.cases.find((c) => c.result === 'FAIL')?.scenario || runScenarios[0])) : null;
  const rp = run && curScen ? run.replays[curScen] : null;
  const trace = rp ? rp.trace : [];
  const failCase = run?.cases.find((c) => c.result === 'FAIL');
  const selectedCase = run?.cases.find((c) => `${c.requirement}|${c.scenario}` === lab.selectedCase) || failCase || run?.cases[0];
  const offendingSeqs = new Set((run?.cases || []).filter((c) => c.scenario === curScen && c.offending && c.result !== 'PASS').map((c) => c.offending.seq));
  const idx = play.idx == null ? trace.length - 1 : Math.min(play.idx, trace.length - 1);
  const ev = trace[idx];
  const snapshot = useMemo(() => (rp ? stateAt(rp.initial, rp.trace, ev ? ev.seq : 0) : null), [rp, ev]);
  const houseSource = useMemo(() => ({ state: snapshot ? { ...snapshot, t: ev?.t ?? 0 } : null }), [snapshot, ev]);
  const hl = selectedCase && selectedCase.result !== 'PASS' ? { device: selectedCase.device, room: selectedCase.room, requirement: selectedCase.requirement, seq: (selectedCase.offending || selectedCase.evidence)?.seq, result: selectedCase.result } : null;
  const st = stateTitle(lab, run);
  const current = !!(run && lab.candidate && run.routine.version === lab.candidate.version && (mode !== 'backend' || run.candidateId === lab.candidateId));
  const canApply = !!(current && failCase && !lab.decision);
  const canRerun = !!lab.candidate && ((lab.fixApplied && !current) || (current && !lab.decision));
  const canDecide = !!(current && !lab.decision);
  const candidates = q.candidates();

  // new run -> start playback (or jump to the offending event when motion is reduced)
  useEffect(() => {
    if (!run) return;
    const sc = run.cases.find((c) => c.result === 'FAIL')?.scenario || run.scenarios[0]?.id; setScen(sc);
    if (reduced) setPlay({ idx: null, playing: false }); else setPlay({ idx: 0, playing: true });
    const h = state.highlight; if (h?.room) setVRoom(h.room); setVDev(h?.device || null);
  }, [run?.runId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!play.playing) return undefined;
    if (play.idx >= trace.length - 1) { setPlay((p) => ({ ...p, playing: false })); return undefined; }
    const h = setTimeout(() => setPlay((p) => ({ ...p, idx: (p.idx ?? 0) + 1 })), 650);
    return () => clearTimeout(h);
  }, [play, trace.length]);
  useEffect(() => { timelineRef.current?.querySelector('.tl-cur')?.scrollIntoView({ block: 'nearest' }); }, [idx]);

  const act = async (fn) => { try { await fn(); } catch (e) { if (mode !== 'backend') actions.notify(e.message, 'warn'); } };
  const decide = (d) => act(async () => { await actions.decide(d, { note, override }); setNote(''); setOverride(false); });
  const pickCase = (c) => {
    actions.selectCase(`${c.requirement}|${c.scenario}`); actions.highlightCase(run, c); setScen(c.scenario);
    const e = c.offending || c.evidence; if (e) { const i = run.replays[c.scenario].trace.findIndex((x) => x.seq === e.seq); setPlay({ idx: i, playing: false }); }
    if (c.room) setVRoom(c.room); setVDev(c.device || null);
  };
  const req = selectedCase ? q.requirements().find((r) => r.id === selectedCase.requirement) : null;
  const prov = lab.proposal?.provenance;

  return <div className="lab">
    <section className="page-head">
      <div><p className="eyebrow">Verification workspace</p><h1>Replay Lab</h1>
        <p>Replay a routine change against the household's saved requirements in deterministic, simulated scenarios. The simulator orders events and the assertion evaluator decides PASS / FAIL / INCONCLUSIVE — the suggested fix never decides a result.</p>
        <p className="prov-line"><Provenance run={run} mode={mode} /></p></div>
      <span className="badge badge-sim">SIMULATED DEMO</span>
    </section>

    <div className="lab-strip" role="toolbar" aria-label="Replay actions">
      <button type="button" className="btn btn-primary" onClick={() => act(() => actions.runReplay('Replay'))} disabled={!lab.candidate || !!busy} data-testid="lab-run"><Play size={16} /> Run Replay</button>
      <button type="button" className="btn" onClick={() => act(() => actions.applySuggestedFix())} disabled={!canApply || !!busy} data-testid="lab-fix" title={canApply ? 'Create the constrained repair candidate (not yet verified)' : 'Needs a FAIL on the current candidate'}><Wrench size={16} /> Apply Suggested Fix</button>
      <button type="button" className="btn" onClick={() => act(() => actions.rerunSuite())} disabled={!canRerun || !!busy} data-testid="lab-rerun"><RefreshCw size={16} /> Re-run Regression Suite</button>
      <button type="button" className="btn btn-ghost" onClick={() => { actions.resetScenario(); setPlay({ idx: null, playing: false }); }} disabled={!!busy} data-testid="lab-reset"><RotateCcw size={16} /> Reset Scenario</button>
      <button type="button" className="btn btn-ghost" onClick={() => setTraceOpen(true)} disabled={!run} data-testid="lab-trace"><ListTree size={16} /> View Trace</button>
      <span className={`lab-status res res-${st.tone}`} data-testid="lab-status" aria-live="polite">{busy ? `Working: ${busy}…` : st.text}</span>
    </div>

    <div className="lab-cols">
      {/* ---------------- column 1: routine change & scenario ---------------- */}
      <section className="card lab-col" aria-labelledby="lc1">
        <h2 id="lc1" className="col-title"><GitCompare size={18} /> Routine change</h2>
        {lab.candidate ? <>
          <div className="cand-head"><b>{lab.candidate.name}</b> <code data-testid="lab-candidate">{lab.candidate.version}</code>
            {mode === 'backend' && <span className="tag">{lab.candidateId} · {lab.candidateStatus}</span>}
            <p className="muted">{String(lab.candidate.note || lab.candidate.author || (lab.fixApplied ? 'Candidate with suggested fix applied' : 'Candidate')).replace(/\.$/, '')}. Compared with the live routine <code>{baseRoutine?.version}</code>.</p></div>
          {mode === 'backend' && candidates.length > 1 && <label className="field"><span>Candidate version</span>
            <select value={lab.candidateId || ''} onChange={(e) => actions.selectCandidate(e.target.value)} data-testid="lab-candidate-select" disabled={!!busy}>
              {candidates.map((c) => <option key={c.candidateId} value={c.candidateId}>{c.routineId} {c.version} · {c.status}{c.parentId ? ` · repair of ${c.parentId}` : ''}</option>)}
            </select></label>}
          <h3>Before → after (live vs. candidate edit)</h3>
          <DiffView diff={diffLive} testId="lab-diff" />
          {diffLive && diffLive.changed > 0 && <p className="ctl-note">The edit {diffLive.rows.filter((r) => r.type !== 'same').map((r) => `changes step ${r.step}`).join(', ')}{diffLive.rows.some((r) => /unless/.test(r.before || '') && !/unless/.test(r.after || '')) ? ' and removes the occupancy condition.' : '.'}</p>}
          {lab.proposal && <div className="proposal" data-testid="lab-proposal">
            <h3><Wrench size={15} /> Proposed repair ({mode === 'backend' ? 'deterministic rule, validated by the Person 3C constrained-repair checker' : 'deterministic template'} — not AI)</h3>
            <DiffView diff={lab.proposal.structured} />
            <p className="explain"><b>Why this addresses the failure:</b> {lab.proposal.explanation}</p>
            {prov && <dl className="req-dl small"><dt>Proposer</dt><dd>{prov.proposer_label}</dd><dt>Validator</dt><dd>{prov.validator?.name} · {prov.validator?.status}</dd>
              <dt>Evidence</dt><dd>{prov.evidence?.run_id} · events {(prov.evidence?.evidence_event_ids || []).join(', ') || '—'}</dd><dt>AI model used</dt><dd>{prov.ai_model_used ? 'yes' : 'no'}</dd></dl>}
            <p className={`res res-${current ? resultTone(run.verdict) : 'review'}`}>{current ? `Verified by rerun ${run.runId}: ${run.verdict}` : 'NOT VERIFIED — re-run the regression suite'}</p>
          </div>}
        </> : <div className="empty">No candidate routine is available{mode === 'backend' ? ' from the backend' : ''}.</div>}

        <h3 className="mt"><Beaker size={15} /> Scenarios in this suite</h3>
        <ul className="scen-list">
          {plannedScenarios.map((s) => <li key={s.id}><b>{s.name}</b><small>{s.id} {s.version} · starts {s.startClock} (simulated){s.edgeCase ? ' · edge case (exploratory run)' : ''}
            {s.initial && <> · lights on: {(s.initial.lightsOn || []).map((d) => DEVICES[d].label).join(', ')}{s.initial.unknownOccupancy ? ` · occupancy UNKNOWN: ${s.initial.unknownOccupancy.join(', ')}` : ''}{s.setup?.length ? ` · then ${s.setup.map((a) => a.type === 'motion' ? `motion in ${ROOMS[a.room].name}` : a.type).join(', ')}` : ' · nobody moves'}</>}</small></li>)}
        </ul>
        <fieldset className="edge">
          <legend>Optional edge cases</legend>
          {allScen.filter((s) => s.edgeCase).map((s) => <label key={s.id} className="check"><input type="checkbox" checked={lab.extraScenarios.includes(s.id)} onChange={(e) => actions.setExtraScenarios(e.target.checked ? [...lab.extraScenarios, s.id] : lab.extraScenarios.filter((x) => x !== s.id))} data-testid={`edge-${s.id}`} /> {s.name}</label>)}
          {mode === 'backend' && <p className="ctl-note">Runs that include an edge case are recorded as <b>exploratory</b>; they never count towards approval.</p>}
        </fieldset>
        <h3 className="mt">Requirements {sel.authoritative ? 'selected' : 'that may be selected'}</h3>
        {!sel.authoritative && <p className="ctl-note">The backend decides relevance when the replay runs; the last run's selection is shown afterwards.</p>}
        <ul className="plain">{sel.selected.map((r) => <li key={r.id} className="mini-row"><b>{r.id}</b> v{r.version} · {r.title}</li>)}</ul>
        {sel.skipped.length > 0 && <><h3 className="mt">Listed, not run</h3><ul className="plain">{sel.skipped.map((s, i) => <li key={`${s.requirement.id}-${i}`} className="mini-row"><b>{s.requirement.id}</b> {s.requirement.title}<small>{s.reason}</small></li>)}</ul></>}
        {active.length === 0 && <p className="callout warn">No confirmed requirements yet — confirm one in Saved Requirements, or the replay has nothing to check.</p>}
        {!active.some((r) => r.device === 'hallwayLight') && <p className="callout">Demo step: add “Don’t turn off the hallway light while someone is there.” in <button type="button" className="linkish" onClick={() => onGo({ page: 'requirements' })}>Saved Requirements</button> and confirm it, then run the replay.</p>}
      </section>

      {/* ---------------- column 2: timeline ---------------- */}
      <section className="card lab-col" aria-labelledby="lc2">
        <h2 id="lc2" className="col-title"><Clock3 size={18} /> Event timeline</h2>
        {!run ? <div className="empty">No replay yet. <b>Run Replay</b> executes the candidate in each scenario with a deterministic simulated clock.</div> : <>
          <div className="seg scen-tabs" role="tablist" aria-label="Scenario">{run.scenarios.map((s) => { const cs = run.cases.filter((c) => c.scenario === s.id); const worst = cs.some((c) => c.result === 'FAIL') ? 'FAIL' : cs.some((c) => c.result === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
            return <button key={s.id} type="button" role="tab" aria-selected={curScen === s.id} className={curScen === s.id ? 'on' : ''} onClick={() => { setScen(s.id); setPlay({ idx: null, playing: false }); }}><span className={`dotr dot-${resultTone(worst)}`} aria-hidden />{s.name.replace('Goodnight ', '').replace(/^with /, '')}<span className="sr-only"> {worst}</span></button>; })}</div>
          {rp ? <>
            <div className="clock-row">
              <div className="sim-clock" data-testid="sim-clock"><small>Scenario clock (simulated)</small><b>{ev?.simTime ? `${ev.simTime}:00` : scenarioClock(run.scenarios.find((s) => s.id === curScen)?.startClock, ev?.t ?? 0)}</b><small>T+{(ev?.t ?? 0).toFixed(0)} s · event {ev ? ev.seq : '-'} / {trace.length}</small></div>
              <div className="play-ctl">
                <button type="button" className="icon-btn" onClick={() => setPlay({ idx: Math.max(0, idx - 1), playing: false })} aria-label="Previous event"><SkipBack size={16} /></button>
                <button type="button" className="icon-btn" onClick={() => setPlay((p) => ({ idx: p.playing ? p.idx : (idx >= trace.length - 1 ? 0 : idx), playing: !p.playing }))} aria-label={play.playing ? 'Pause playback' : 'Play events'} data-testid="lab-play">{play.playing ? <Pause size={16} /> : <Play size={16} />}</button>
                <button type="button" className="icon-btn" onClick={() => setPlay({ idx: Math.min(trace.length - 1, idx + 1), playing: false })} aria-label="Next event"><SkipForward size={16} /></button>
              </div>
            </div>
            <input type="range" min={0} max={Math.max(0, trace.length - 1)} value={Math.max(0, idx)} onChange={(e) => setPlay({ idx: +e.target.value, playing: false })} aria-label="Scrub through events" />
            <p className="ctl-note">Trace hash <code>{rp.hash}</code> · identical inputs always produce this hash.</p>
            <ol className="timeline" ref={timelineRef} data-testid="lab-timeline">
              {trace.map((e, i) => { const bad = offendingSeqs.has(e.seq); const future = i > idx;
                return <li key={e.seq} className={`tl tl-${eventTone(e)} ${bad ? 'tl-bad' : ''} ${i === idx ? 'tl-cur' : ''} ${future ? 'tl-future' : ''}`}>
                  <button type="button" onClick={() => setPlay({ idx: i, playing: false })}>
                    <span className="tl-seq">#{e.seq}{e.event_id ? <small> {e.event_id}</small> : null}</span><span className="tl-t">{e.simTime || scenarioClock(run.scenarios.find((s) => s.id === curScen)?.startClock, e.t)}</span>
                    <span className="tl-msg">{describeEvent(e)}{bad && <em className="tl-flag">violates {run.cases.find((c) => c.offending?.seq === e.seq && c.scenario === curScen)?.requirement}</em>}
                      {e.checks?.length > 0 && e.kind !== 'step_skipped' && <small className="tl-checks">{e.checks.map((c) => `${c.expr} → ${c.result === null ? 'UNKNOWN' : c.result ? 'true' : 'false'}`).join(' · ')}</small>}</span>
                    <span className="tl-src">{e.source}{e.step != null ? ` · step ${e.step}` : ''}</span>
                  </button></li>; })}
            </ol>
          </> : <div className="empty">This scenario has no recorded trace (see the assertion reason).</div>}
        </>}
      </section>

      {/* ---------------- column 3: assertions & decision ---------------- */}
      <section className="card lab-col" aria-labelledby="lc3">
        <h2 id="lc3" className="col-title"><ShieldAlert size={18} /> Assertions</h2>
        {!run ? <div className="empty">Assertions appear here with PASS, FAIL or INCONCLUSIVE and the reason.</div> : <>
          <div className="counts" data-testid="lab-counts">
            <span className="res res-pass">PASS {run.counts.PASS}</span><span className="res res-fail">FAIL {run.counts.FAIL}</span><span className="res res-inconclusive">INCONCLUSIVE {run.counts.INCONCLUSIVE}</span>
            <span className={`verdict res res-${resultTone(run.verdict)}`} data-testid="lab-verdict">Suite: {run.verdict}</span>
          </div>
          {run.kind === 'exploratory' && <p className="callout warn">Exploratory run (edge cases included). It is recorded but never used for approval.</p>}
          <ul className="cases">{run.cases.map((c) => { const key = `${c.requirement}|${c.scenario}`; const on = selectedCase && `${selectedCase.requirement}|${selectedCase.scenario}` === key;
            return <li key={key}><button type="button" className={`case ${on ? 'on' : ''}`} onClick={() => pickCase(c)} data-testid={`case-${c.requirement}-${c.scenario}`}>
              <span className={`res res-${resultTone(c.result)}`}>{c.result}</span><span className="grow"><b>{c.requirement} v{c.version}</b> {c.title}<small>{scenName(run, c.scenario)} — {c.reason}</small></span></button></li>; })}</ul>
          {selectedCase && req && <div className={`sel-req ${selectedCase.result === 'FAIL' ? 'is-fail' : ''}`} data-testid="lab-selected">
            <h3>{selectedCase.result === 'FAIL' ? 'Failed requirement' : 'Selected requirement'}: {req.id} v{selectedCase.version}</h3>
            <p className="quote">“{req.sourceText}”</p>
            <dl><dt>Expected</dt><dd>{req.expectedBehavior}</dd><dt>Preconditions</dt><dd>{(req.preconditions || []).join('; ') || '—'}</dd>
              <dt>Evidence</dt><dd>{(selectedCase.offending || selectedCase.evidence) ? <>event #{(selectedCase.offending || selectedCase.evidence).seq}{(selectedCase.offending || selectedCase.evidence).event_id ? ` (${(selectedCase.offending || selectedCase.evidence).event_id})` : ''}: {describeEvent(selectedCase.offending || selectedCase.evidence)}</> : '—'}</dd>
              <dt>In the house</dt><dd>{devLabel(selectedCase.device)} · {ROOMS[selectedCase.room]?.name || selectedCase.room} (highlighted below)</dd></dl>
          </div>}
          <div className="decision" data-testid="lab-decision">
            <h3>Human decision</h3>
            {lab.decision ? <p className={`res res-${lab.decision.decision === 'approved' ? 'pass' : 'neutral'}`}>{lab.decision.decision.toUpperCase()} · {lab.decision.routine} · {lab.decision.runId}</p> : <>
              <p className="ctl-note">Only you can accept or reject the candidate. Approving records the decision against the run; nothing is deployed to real devices.{mode === 'backend' ? ' The backend refuses approval unless the latest full regression run of this exact candidate is PASS and not stale.' : ''}</p>
              <label className="field"><span>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. guard restored, verified in the rerun" /></label>
              {mode !== 'backend' && run.verdict !== 'PASS' && <label className="check"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Approve despite {run.verdict} (explicit override, local mode only)</label>}
              <div className="btn-row"><button type="button" className="btn btn-ok" onClick={() => decide('approved')} disabled={!canDecide || !!busy || (run.verdict !== 'PASS' && !(override && mode !== 'backend'))} data-testid="lab-approve"><Check size={16} /> Approve candidate</button>
                <button type="button" className="btn btn-danger" onClick={() => decide('rejected')} disabled={!canDecide || !!busy} data-testid="lab-reject"><X size={16} /> Reject</button></div>
              {!canDecide && <p className="ctl-note">{lab.fixApplied ? 'Re-run the regression suite on the repaired candidate first.' : 'Replay the current candidate first.'}</p>}
            </>}
          </div>
        </>}
        <p className="trust">AI may interpret corrections or propose repairs. Only the deterministic verifier returns the result. Only an authorised human approves. A PASS is evidence about the model, not a guarantee about the physical home.</p>
      </section>
    </div>

    <section className="section">
      <h2>Related device in the house</h2>
      <p className="muted">The 3D house shows the modeled state at the selected timeline event of this replay (same trace as the timeline and report); the implicated device is outlined in red.</p>
      {run && rp && houseSource.state ? <HouseViewer source={houseSource} rev={`${run.runId}:${curScen}:${idx}`} mode={viewMode} roomId={vRoom} deviceId={vDev} cutLevel={ROOMS[vRoom] && (vRoom === 'bedroom3' || vRoom === 'patio') ? 1 : 0} highlight={hl}
        env={env} settings={state.settings} reducedMotion={reduced} compact showLabels={state.settings.showLabels} badge={run.source === 'backend' ? 'SIMULATED REPLAY · BACKEND TRACE' : 'SIMULATED REPLAY · LOCAL'}
        onSetMode={setViewMode} onSelectRoom={(r) => setVRoom(r)} onStepRoom={(d) => { const order = ['living', 'kitchen', 'bedroom', 'bathroom', 'hallway', 'bedroom2', 'bedroom3', 'patio']; const i = order.indexOf(vRoom); setVRoom(order[(i + d + order.length) % order.length]); }}
        onSelectDevice={setVDev} onSetCutLevel={() => {}} title="Replay state" />
        : <div className="empty">Run a replay to see the scenario in the house.</div>}
    </section>

    {traceOpen && run && <div className="modal" role="dialog" aria-modal="true" aria-labelledby="trace-title" onKeyDown={(e) => e.key === 'Escape' && setTraceOpen(false)}>
      <div className="modal-card">
        <header className="card-head"><h2 id="trace-title" className="grow">Full trace — {run.runId}</h2><button type="button" className="icon-btn" onClick={() => setTraceOpen(false)} aria-label="Close trace" autoFocus><X size={18} /></button></header>
        <p className="muted">Routine {run.routine.id}@{run.routine.version} · simulator {run.simulator} · {run.scenarios.length} scenarios. Every field below is the simulator's output.</p>
        {run.scenarios.map((s) => { const r2 = run.replays[s.id]; return <details key={s.id} open={s.id === curScen}><summary><b>{s.name}</b> <code>{s.id} {s.version}</code> hash <code>{r2?.hash}</code></summary>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>#</th><th>sim t</th><th>event</th><th>routine / step</th><th>source</th></tr></thead>
            <tbody>{(r2?.trace || []).map((e) => <tr key={e.seq} className={offendingSeqs.has(e.seq) && s.id === curScen ? 'sel' : ''}><td>{e.seq}{e.event_id ? ` (${e.event_id})` : ''}</td><td>{e.simTime || e.t}</td><td>{describeEvent(e)}</td><td>{e.routine || '—'}{e.step != null ? ` / ${e.step}` : ''}</td><td>{e.source}</td></tr>)}</tbody></table></div>
          <details><summary>Raw JSON</summary><pre className="code">{JSON.stringify((r2?.trace || []).map((e) => e.raw || e), null, 1)}</pre></details>
        </details>; })}
      </div>
    </div>}
    {baseRoutine && <p className="fineprint">Steps of the live routine: {baseRoutine.steps.map((s, i) => `${i}. ${describeStep(s)}`).join(' · ')}</p>}
  </div>;
}
