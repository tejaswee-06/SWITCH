import React, { useState } from 'react';
import { Download, FileJson, FileText, ChevronRight, Printer } from 'lucide-react';
import { useApp } from '../state/StoreContext.jsx';
import { reportToMarkdown, getScenario } from '../sim/switch.js';
import { describeEvent, resultTone } from '../ui/format.js';
import { DiffView, Provenance } from './ReplayLabPage.jsx';

function download(name, text, type) {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const DISCLAIMER = 'SIMULATED DEMO — modeled scenarios only; not a certification of the physical home.';

/** Markdown export: the shared report format plus the canonical backend's provenance fields. */
export function runMarkdown(run) {
  const md = [reportToMarkdown(run, describeEvent)];
  if (run.source === 'backend') {
    md.push('', '## Provenance (canonical SWITCH backend)', `- Engine: Person 2 deterministic evaluator, simulator ${run.simulatorVersion}`, `- Run kind: ${run.kind}`,
      `- Candidate: ${run.candidateId}${run.parentCandidateId ? ` (repair of ${run.parentCandidateId})` : ''} · status ${run.candidateStatus}`,
      `- Integration: ${run.integration?.integration_mode} · invoked via ${run.integration?.invoked_via}${run.integration?.correlation_id ? ` · correlation ${run.integration.correlation_id}` : ''}${run.integration?.adapter_version ? ` · adapter ${run.integration.adapter_version}` : ''}`,
      `- Input fingerprint: ${run.fingerprint}`, `- Created: ${run.createdAt} by ${run.createdBy}`);
    if (run.repairProvenance) md.push(`- Repair proposer: ${run.repairProvenance.proposer_label}; validator: ${run.repairProvenance.validator?.name} (${run.repairProvenance.validator?.status}); AI model used: ${run.repairProvenance.ai_model_used ? 'yes' : 'no'}`, `- Repair explanation: ${run.repairProvenance.explanation}`);
    if (run.comparison) md.push(`- Compared with ${run.comparison.previous_run_id}: fixed ${run.comparison.fixed.map((x) => x.requirement_id).join(', ') || 'none'}; newly failing ${run.comparison.newly_failing.map((x) => x.requirement_id).join(', ') || 'none'}`);
    md.push('', `> ${run.safety}`);
  } else md.push('', '> Produced by the in-browser simulator (offline fallback), not by the canonical SWITCH backend.');
  return md.join('\n');
}

export default function ReportsPage({ onGo }) {
  const { state, q } = useApp();
  const mode = q.mode();
  const [sel, setSel] = useState(null);
  const runs = state.runs; const run = runs.find((r) => r.runId === sel) || runs[0];
  const head = <section className="page-head"><div><p className="eyebrow">Reproducible evidence</p><h1>Reports</h1>
    <p>Run IDs, scenario / requirement / routine / simulator versions, the ordered trace, assertion results, the proposed change and the human decision — enough to reproduce a result.</p>
    <p className="prov-line"><Provenance run={run} mode={mode} /></p></div><span className="badge badge-sim">SIMULATED DEMO</span></section>;
  if (!runs.length) return <div>{head}
    <div className="empty"><p>No replay has been recorded yet{mode === 'backend' ? ' for this household' : ' in this session'}.</p><button type="button" className="btn btn-primary" onClick={() => onGo({ page: 'replay' })}>Open Replay Lab</button></div></div>;
  const json = () => JSON.stringify(run.source === 'backend'
    ? { disclaimer: DISCLAIMER, exported_from: 'SWITCH backend GET /replays/{run_id}/report (canonical record)', report: run.raw }
    : { disclaimer: DISCLAIMER, exported_from: 'in-browser simulator (offline fallback)', ...run }, null, 2);
  const integ = run.integration;
  return <div className="reports">
    {head}
    <div className="table-wrap no-print"><table className="tbl" aria-label="Replay runs"><thead><tr><th>Run</th><th>Type</th><th>Routine</th><th>Verdict</th><th>PASS / FAIL / INC.</th><th>Decision</th><th>Engine</th><th><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{runs.map((r) => <tr key={r.runId} className={r.runId === run.runId ? 'sel' : ''}>
        <td><code>{r.runId}</code></td><td>{r.label}</td><td>{r.routine.id}@{r.routine.version}</td><td><span className={`res res-${resultTone(r.verdict)}`}>{r.verdict}</span></td>
        <td className="mono">{r.counts.PASS} / {r.counts.FAIL} / {r.counts.INCONCLUSIVE}</td><td>{r.decision ? r.decision.decision : '—'}</td><td>{r.source === 'backend' ? 'backend' : 'local'}</td>
        <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(r.runId)} aria-label={`Open report ${r.runId}`} data-testid={`open-${r.runId}`}>Open <ChevronRight size={14} /></button></td></tr>)}</tbody></table></div>

    <article className="card report" data-testid="report-detail">
      <header className="card-head"><h2 className="grow">Report {run.runId}</h2><span className="badge badge-sim">SIMULATED DEMO REPORT</span>
        <span className="no-print row gap-s wrap">
          <button type="button" className="btn btn-sm" onClick={() => download(`${run.runId}.json`, json(), 'application/json')} data-testid="export-json"><FileJson size={15} /> Export JSON</button>
          <button type="button" className="btn btn-sm" onClick={() => download(`${run.runId}.md`, runMarkdown(run), 'text/markdown')} data-testid="export-md"><FileText size={15} /> Export Markdown</button>
          <button type="button" className="btn btn-sm" onClick={() => window.print()} data-testid="export-pdf" title="Opens the browser print dialog; choose “Save as PDF”"><Printer size={15} /> Print / Save as PDF</button></span></header>
      <div className="meta-grid">
        <div><span>Run ID</span><b>{run.runId}</b></div><div><span>Household</span><b>{run.householdId}</b></div>
        <div><span>Routine version</span><b>{run.routine.id}@{run.routine.version}</b></div><div><span>Compared with</span><b>{run.base ? `${run.base.id}@${run.base.version}` : '—'}</b></div>
        <div><span>Simulator version</span><b>{run.simulator}</b></div><div><span>Verdict</span><b><span className={`res res-${resultTone(run.verdict)}`}>{run.verdict}</span></b></div>
        <div><span>Scenario versions</span><b>{run.scenarios.map((s) => `${s.id} ${s.version}`).join(', ')}</b></div>
        <div><span>Requirement versions</span><b>{run.requirements.map((r) => `${r.id} v${r.version}`).join(', ') || '—'}</b></div>
        <div><span>Counts</span><b>PASS {run.counts.PASS} · FAIL {run.counts.FAIL} · INCONCLUSIVE {run.counts.INCONCLUSIVE}</b></div>
        <div><span>Reviewer decision</span><b>{run.decision ? `${run.decision.decision.toUpperCase()} by ${run.decision.by}${run.decision.note ? ` — ${run.decision.note}` : ''}` : 'No decision recorded'}</b></div>
        {run.source === 'backend' && <>
          <div><span>Run kind</span><b>{run.kind}{run.kind === 'exploratory' ? ' (not used for approval)' : ''}</b></div>
          <div><span>Candidate</span><b>{run.candidateId}{run.parentCandidateId ? ` · repair of ${run.parentCandidateId}` : ''} · {run.candidateStatus}</b></div>
          <div><span>Integration mode</span><b>{integ?.integration_mode} · via {integ?.invoked_via}</b></div>
          <div><span>Adapter / correlation</span><b>{integ?.adapter_version || '—'} · {integ?.correlation_id || '—'}</b></div>
          <div><span>Input fingerprint</span><b className="mono small">{run.fingerprint?.slice(0, 24)}…</b></div>
          <div><span>Created</span><b>{run.createdAt} · {run.createdBy}</b></div>
        </>}
      </div>
      <p className="callout">{run.safety || 'A PASS means the selected modeled requirements passed for these recorded scenarios and versions. It does not certify the real home or cover unmodeled sensors, outages, latency, firmware or household circumstances.'}</p>
      {run.diff && <><h3 className="mt">Proposed change</h3><DiffView diff={run.diff} />
        {run.changes?.length > 0 && <ul className="plain small">{run.changes.filter((c) => c.path !== 'version').map((c, i) => <li key={i}><code>{c.path}</code> {c.summary}</li>)}</ul>}</>}
      {run.repairProvenance && <><h3 className="mt">Repair provenance</h3>
        <dl className="req-dl"><dt>Proposer</dt><dd>{run.repairProvenance.proposer_label}</dd><dt>Validator</dt><dd>{run.repairProvenance.validator?.name} · {run.repairProvenance.validator?.status}</dd>
          <dt>Evidence</dt><dd>{run.repairProvenance.evidence?.run_id} · {(run.repairProvenance.evidence?.evidence_event_ids || []).join(', ')}</dd><dt>Explanation</dt><dd>{run.repairProvenance.explanation}</dd></dl></>}
      {run.comparison && <p className="ctl-note">Compared with {run.comparison.previous_run_id}: fixed {run.comparison.fixed.map((x) => x.requirement_id).join(', ') || 'none'} · newly failing {run.comparison.newly_failing.map((x) => x.requirement_id).join(', ') || 'none'} · {run.comparison.inputs_note}</p>}
      <h3 className="mt">Assertions</h3>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Scenario</th><th>Result</th><th>Reason</th><th>Event</th></tr></thead>
        <tbody>{run.cases.map((c) => <tr key={c.requirement + c.scenario}><td><b>{c.requirement}</b> v{c.version}<br /><small className="muted">{c.title}</small></td><td>{run.scenarios.find((s) => s.id === c.scenario)?.name || getScenario(c.scenario)?.name || c.scenario}<br /><code>{c.scenario} {c.scenarioVersion}</code></td>
          <td><span className={`res res-${resultTone(c.result)}`}>{c.result}</span></td><td>{c.reason}</td><td className="mono">{(c.offending || c.evidence) ? `#${(c.offending || c.evidence).seq}${(c.offending || c.evidence).event_id ? ` ${(c.offending || c.evidence).event_id}` : ''}` : (c.evidenceIds || []).join(', ') || '—'}</td></tr>)}</tbody></table></div>
      {run.skipped.length > 0 && <><h3 className="mt">Listed, not run</h3><ul>{run.skipped.map((s, i) => <li key={`${s.id}-${i}`}><b>{s.id}</b> v{s.version} — {s.reason}</li>)}</ul></>}
      <h3 className="mt">Timeline</h3>
      {run.scenarios.map((s) => { const rp = run.replays[s.id]; if (!rp) return null; const bad = new Set(run.cases.filter((c) => c.scenario === s.id && c.offending && c.result !== 'PASS').map((c) => c.offending.seq));
        return <details key={s.id} className="tl-details" open={run.cases.some((c) => c.scenario === s.id && c.result !== 'PASS')}><summary><b>{s.name}</b> · {rp.trace.length} events · hash <code>{rp.hash}</code></summary>
          <ol className="timeline compact">{rp.trace.map((e) => <li key={e.seq} className={`tl ${bad.has(e.seq) ? 'tl-bad' : ''}`}><div><span className="tl-seq">#{e.seq}</span><span className="tl-t">{e.simTime || `t=${e.t}s`}</span><span className="tl-msg">{describeEvent(e)}</span><span className="tl-src">{e.source}{e.step != null ? ` · step ${e.step}` : ''}</span></div></li>)}</ol>
        </details>; })}
    </article>
    <p className="fineprint no-print"><Download size={13} /> {mode === 'backend' ? 'JSON export is the canonical backend record; Markdown adds the provenance fields; Print / Save as PDF uses the browser print dialog.' : 'Offline fallback: exports contain session-only browser runs.'}</p>
  </div>;
}
