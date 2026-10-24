// SWITCH assistant: a SIMULATED Alexa+ experience (Route C, see docs/ALEXA_PLUS_INTEGRATION.md).
// Simulated: the assistant itself (typed text stands in for voice; a deterministic router in src/assistant/assistant.js
// stands in for Alexa+ choosing a tool). Real: every result is a SWITCH backend tool call through /integrations/alexa/mcp,
// using the same requirements, simulator, evaluator and reviewer records as the rest of the app.
// People never see serialized tool output: results are normalised into typed cards (toCard) and rendered below.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MessageCircle, Send, X, Check, Bot, User, ChevronRight, RotateCcw, AlertTriangle, ShieldCheck, Wrench, ListChecks, GitCompare, FlaskConical, Info, Trash2 } from 'lucide-react';
import { useApp } from '../state/StoreContext.jsx';
import { backendApi } from '../api/switchBackend.js';
import { createAssistantSession } from '../assistant/session.js';
import { SUGGESTIONS } from '../assistant/assistant.js';
import { resultTone } from './format.js';
import { DiffView } from '../pages/ReplayLabPage.jsx';

export { routeIntent as routeUtterance } from '../assistant/assistant.js';

let session = null; let bound = null;
/** One conversation per page session, so closing and reopening the panel keeps the history. */
function useSession(store, onGo) {
  bound = { store, onGo };
  if (!session) {
    session = createAssistantSession({
      api: backendApi,
      getApp: () => ({ ...bound.store.getState(), selectCandidate: (id) => bound.store.actions.selectCandidate(id) }),
      onSynced: () => bound.store.actions.syncBackend(),
      navigate: (page) => bound.onGo?.({ page }),
      resetDemo: () => bound.store.actions.resetDemoData(),
      reconnect: () => bound.store.actions.connectBackend(),
    });
  }
  return useSyncExternalStore(session.subscribe, session.getState);
}
export const _assistantSessionForTests = () => session;
if (typeof window !== 'undefined') window.addEventListener('switch:clear-assistant', () => session?.clear());

function Tech({ rows }) {
  if (!rows?.length) return null;
  return <details className="tech"><summary>Technical details</summary><dl>{rows.map((r) => <React.Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></React.Fragment>)}</dl></details>;
}
const Verdict = ({ v }) => v ? <span className={`res res-${resultTone(v)}`}>{v}</span> : null;

function Card({ c, onGo, actions, onAnswer, onRetry, busy }) {
  const evidence = (cid) => <button type="button" className="linkish" onClick={() => { if (cid) actions.selectCandidate(cid); onGo?.({ page: 'replay' }); }}>Open the evidence timeline <ChevronRight size={13} /></button>;
  switch (c.type) {
    case 'draft': return <div className="acard" data-card="draft"><div className="acard-head"><ListChecks size={15} aria-hidden /> <b>Draft rule</b><span className="tag tag-draft">DRAFT · not enforced</span></div>
      <p className="acard-title">{c.title}</p>
      <dl className="acard-dl">{c.when && <><dt>When</dt><dd>{c.when}</dd></>}<dt>Expected</dt><dd>{c.expected}</dd><dt>From</dt><dd>“{c.source}”</dd><dt>ID</dt><dd><code>{c.requirementId}</code> · v{c.version}</dd></dl><Tech rows={c.tech} /></div>;
    case 'clarify': return <div className="acard" data-card="clarify"><div className="acard-head"><Info size={15} aria-hidden /> <b>{c.title}</b><span className="tag">nothing saved</span></div>
      {c.questions.map((q) => <div key={q.question} className="acard-q"><p>{q.question}</p>
        {q.options.length > 0 && q.key && <div className="chips">{q.options.map((o) => <button type="button" key={o.value} className="chip" disabled={busy} onClick={() => onAnswer(c.sourceText, q.key, o.value, o.label)}>{o.label}</button>)}</div>}</div>)}</div>;
    case 'saved': return <div className="acard ok" data-card="saved"><div className="acard-head"><ShieldCheck size={15} aria-hidden /> <b>Requirement saved</b><span className="res res-pass">CONFIRMED</span></div>
      <p className="acard-title">{c.title}</p>
      <dl className="acard-dl"><dt>ID</dt><dd><code>{c.requirementId}</code></dd><dt>Version</dt><dd>v{c.version}</dd><dt>Expected</dt><dd>{c.expected}</dd>{c.routines.length > 0 && <><dt>Routines</dt><dd>{c.routines.join(', ')}</dd></>}</dl>
      <p className="acard-next">{c.next}</p><button type="button" className="linkish" onClick={() => onGo?.({ page: 'requirements' })}>View in Saved Requirements <ChevronRight size={13} /></button></div>;
    case 'requirements': return <div className="acard" data-card="requirements"><div className="acard-head"><ListChecks size={15} aria-hidden /> <b>Saved requirements</b></div>
      <ul className="acard-list">{c.items.map((r) => <li key={r.id}><span className={`tag tag-${r.status.toLowerCase()}`}>{r.status}</span> <span className="grow">{r.title}</span> <small className="muted">{r.id} · v{r.version}</small>{r.last && <Verdict v={r.last} />}</li>)}</ul>
      <button type="button" className="linkish" onClick={() => onGo?.({ page: 'requirements' })}>Open Saved Requirements <ChevronRight size={13} /></button></div>;
    case 'routines': return <div className="acard" data-card="routines"><div className="acard-head"><GitCompare size={15} aria-hidden /> <b>Routines and candidate changes</b></div>
      <ul className="acard-list">{c.routines.map((r) => <li key={r.id}><b className="grow">{r.name}</b><small className="muted">{r.id} · v{r.version} · {r.steps} steps</small></li>)}</ul>
      {c.candidates.length > 0 && <ul className="acard-list">{c.candidates.map((x) => <li key={x.id}><span className="grow"><code>{x.id}</code> {x.routineId} v{x.version}</span><span className="tag">{x.status.replace('_', ' ').toLowerCase()}</span>{x.last && <Verdict v={x.last} />}</li>)}</ul>}</div>;
    case 'diff': return <div className="acard" data-card="diff"><div className="acard-head"><GitCompare size={15} aria-hidden /> <b>{c.routineId} · v{c.from} → v{c.to}</b><span className="tag">preview · no live change</span></div>
      {c.description && <p className="muted small">{c.description}</p>}
      <ul className="acard-bullets">{c.changes.map((x) => <li key={x}>{x}</li>)}</ul>
      {c.diff && <DiffView diff={c.diff} />}
      {c.affected.length > 0 && <p className="small"><b>Rules this can affect:</b> {c.affected.join('; ')}</p>}
      <p className="acard-next">{c.next}</p><Tech rows={c.tech} /></div>;
    case 'replay': return <div className={`acard ${c.overall === 'PASS' ? 'ok' : c.overall === 'FAIL' ? 'bad' : ''}`} data-card="replay"><div className="acard-head"><FlaskConical size={15} aria-hidden /> <b>Deterministic replay {c.runId}</b><Verdict v={c.overall} /></div>
      <p className="small">{c.routineId ? `${c.routineId} v${c.version} · ` : ''}candidate <code>{c.candidateId}</code> · PASS {c.totals.PASS ?? 0} · FAIL {c.totals.FAIL ?? 0} · INCONCLUSIVE {c.totals.INCONCLUSIVE ?? 0}</p>
      {c.findings.length > 0 && <ul className="acard-bullets">{c.findings.map((f, i) => <li key={i}><Verdict v={f.status} /> <b>{f.requirementId}</b> in {f.scenarioId}: {f.reason}{f.events.length ? ` (event ${f.events.join(', ')})` : ''}</li>)}</ul>}
      <p className="acard-next">{c.next}</p>{evidence(c.candidateId)}<Tech rows={c.tech} /></div>;
    case 'failure': return <div className="acard bad" data-card="failure"><div className="acard-head"><AlertTriangle size={15} aria-hidden /> <b>Why it failed</b><Verdict v="FAIL" /></div>
      <p className="acard-title">{c.title}</p>
      <dl className="acard-dl"><dt>Rule</dt><dd><code>{c.requirementId}</code> v{c.requirementVersion}</dd><dt>Expected</dt><dd>{c.expected}</dd><dt>Observed</dt><dd>{c.reason}</dd><dt>Scenario</dt><dd>{c.scenarioId}</dd><dt>Routine</dt><dd>{c.routineId} v{c.version} (candidate <code>{c.candidateId}</code>)</dd></dl>
      {c.events.length > 0 && <ol className="acard-events">{c.events.map((e) => <li key={e.id}><code>{e.id}</code> <span className="muted">{e.time}</span> {e.text}</li>)}</ol>}
      {c.more > 0 && <p className="small muted">{c.more} more failed assertion{c.more > 1 ? 's' : ''} in this run.</p>}
      <p className="acard-next">{c.next}</p>{evidence(c.candidateId)}<Tech rows={c.tech} /></div>;
    case 'repair': return <div className="acard review" data-card="repair"><div className="acard-head"><Wrench size={15} aria-hidden /> <b>Proposed repair {c.candidateId}</b><span className="res res-review">NOT VERIFIED</span></div>
      {c.explanation && <p className="small">{c.explanation}</p>}
      {c.diff && <DiffView diff={c.diff} />}
      <p className="small muted">Proposed by {c.proposer || 'SWITCH rule-based repair'} · validator {c.validator || '—'} · based on <code>{c.parentId}</code></p>
      <p className="acard-next">{c.next}</p>{evidence(c.candidateId)}<Tech rows={c.tech} /></div>;
    case 'decision': return <div className="acard ok" data-card="decision"><div className="acard-head"><Check size={15} aria-hidden /> <b>Decision recorded</b><span className={`res res-${c.status === 'APPROVED' ? 'pass' : 'neutral'}`}>{c.status}</span></div>
      <dl className="acard-dl"><dt>Candidate</dt><dd><code>{c.candidateId}</code></dd><dt>Checked in</dt><dd>{c.runId || '—'}</dd><dt>Deployed</dt><dd>No</dd></dl><p className="acard-next">{c.note}</p>
      <button type="button" className="linkish" onClick={() => onGo?.({ page: 'reports' })}>Open the report <ChevronRight size={13} /></button></div>;
    case 'status': return <div className="acard" data-card="status"><div className="acard-head"><ShieldCheck size={15} aria-hidden /> <b>Integration status</b><span className="badge badge-sim">SIMULATED DEMO</span></div>
      <ul className="acard-list">{c.rows.map((r) => <li key={r.label}><span className="grow">{r.label}</span><span className={`stat-${r.tone}`}>{r.value}</span></li>)}</ul>
      {c.blockers.length > 0 && <details className="tech"><summary>What a live Alexa+ connection would need</summary><ul>{c.blockers.map((b) => <li key={b}>{b}</li>)}</ul></details>}<Tech rows={c.tech} /></div>;
    case 'error': return <div className="acard bad" data-card="error" role="alert"><div className="acard-head"><AlertTriangle size={15} aria-hidden /> <b>{c.title}</b></div>
      <p className="small">{c.message}</p>{c.detail && <p className="small muted">{c.detail}</p>}
      {c.retry && <button type="button" className="btn btn-sm" onClick={() => onRetry(typeof c.retry === 'string' ? c.retry : null)} disabled={busy} data-testid="alexa-retry"><RotateCcw size={14} /> Retry</button>}<Tech rows={c.tech} /></div>;
    default: return c.text ? <p>{c.text}</p> : null;
  }
}

export default function AlexaPanel({ onClose, onGo, embedded = false }) {
  const { store, state, actions } = useApp();
  const conv = useSession(store, onGo);
  const [text, setText] = useState('');
  const listRef = useRef(null); const inputRef = useRef(null);
  const online = state.mode === 'backend';
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [conv.messages.length, conv.busy]);
  useEffect(() => { if (!embedded) inputRef.current?.focus(); }, [embedded]);
  useEffect(() => { if (embedded) return undefined; const k = (e) => { if (e.key === 'Escape') onClose?.(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [embedded, onClose]);

  const send = (t) => { const v = (t ?? text).trim(); if (!v || conv.busy) return; if (t === undefined) setText(''); session.send(v); };
  const lastUserText = [...conv.messages].reverse().find((m) => m.role === 'user')?.text;

  return <section className={`alexa ${embedded ? 'embedded' : ''}`} aria-labelledby="alexa-title">
    <header className="alexa-head">
      <span className="glyph-box alexa-orb" aria-hidden><MessageCircle size={18} /></span>
      <div className="grow"><h2 id="alexa-title">SWITCH Assistant <span className="badge badge-sim" data-testid="assistant-mode">SIMULATED DEMO</span></h2>
        <p className="muted small">Alexa+-style experience, simulated in the app. Not connected to Amazon or any device. {online ? 'Every answer comes from the SWITCH backend.' : 'Backend offline: actions are unavailable.'}</p></div>
      <button type="button" className="icon-btn" onClick={() => session.clear()} aria-label="Clear conversation" title="Clear conversation" disabled={conv.busy}><Trash2 size={16} /></button>
      {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close assistant"><X size={18} /></button>}
    </header>
    <ol className="alexa-msgs" ref={listRef} aria-live="polite" aria-busy={conv.busy} data-testid="alexa-msgs">
      {conv.messages.map((m) => <li key={m.id || 'welcome'} className={`msg msg-${m.role}`}>
        <span className="msg-ico" aria-hidden>{m.role === 'user' ? <User size={14} /> : <Bot size={14} />}</span>
        <div className="msg-body"><span className="sr-only">{m.role === 'user' ? 'You said: ' : 'Assistant: '}</span>{m.text && <p className="msg-text">{m.text}</p>}
          {m.card && <Card c={m.card} onGo={(r) => { onGo?.(r); if (!embedded && window.matchMedia?.('(max-width: 760px)').matches) onClose?.(); }} actions={actions} busy={conv.busy}
            onAnswer={(src, key, value, label) => session.answer(src, key, value, label)} onRetry={(t) => session.retry(t || lastUserText)} />}</div></li>)}
      {conv.busy && <li className="msg msg-assistant msg-busy"><span className="msg-ico" aria-hidden><Bot size={14} /></span><div className="msg-body"><span className="typing" role="status" aria-label="Working on it"><i /><i /><i /></span></div></li>}
    </ol>
    {conv.pending && <div className="alexa-pending" role="group" aria-label="Waiting for your confirmation" data-testid="alexa-pending">
      <span className="grow"><b>Confirm:</b> {conv.pending.label}?</span>
      <button type="button" className="btn btn-sm btn-ok" onClick={() => send('yes')} disabled={conv.busy} data-testid="alexa-yes"><Check size={14} /> Yes</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => send('no')} disabled={conv.busy} data-testid="alexa-no">No</button></div>}
    <div className="alexa-sugg" aria-label="Suggested requests">{SUGGESTIONS.map((s) => <button type="button" key={s} className="chip" onClick={() => send(s)} disabled={conv.busy}>{s}</button>)}</div>
    <form className="alexa-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <label className="sr-only" htmlFor="alexa-text">Message to the SWITCH assistant</label>
      <input id="alexa-text" ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={online ? 'Tell SWITCH a correction, or ask it to check, fix or approve…' : 'Backend offline: start it, then retry'} maxLength={600} autoComplete="off" data-testid="alexa-input" />
      <button type="submit" className="btn btn-primary" disabled={conv.busy || !text.trim()} aria-label="Send" data-testid="alexa-send"><Send size={16} /></button>
    </form>
    {onGo && <button type="button" className="linkish small alexa-foot" onClick={() => { onGo({ page: 'devices' }); onClose?.(); }}>Integration status and route details <ChevronRight size={13} /></button>}
  </section>;
}
