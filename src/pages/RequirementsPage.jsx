import React, { useMemo, useState } from 'react';
import { Plus, Check, X, History, Pencil, Ban, Archive, RotateCcw, MessageSquareQuote, Search, Trash2 } from 'lucide-react';
import { useApp } from '../state/StoreContext.jsx';
import { DEVICES, ROOMS } from '../sim/engine.js';
import { resultTone } from '../ui/format.js';
import { CANON, canonLabel } from '../api/canonicalMap.js';
import { Provenance } from './ReplayLabPage.jsx';

const STATUS_TONE = { CONFIRMED: 'pass', DRAFT: 'review', DISABLED: 'neutral', RETIRED: 'neutral' };
const ROOM_IDS = Object.keys(ROOMS);
const devLabel = (id) => DEVICES[id]?.label || canonLabel(id);
const TARGET_TYPES = ['light', 'tv', 'security', 'lock'];
const TARGETS = Object.values(CANON).filter((d) => TARGET_TYPES.includes(d.type) && !d.read_only);
const enc = (v) => JSON.stringify(v); const dec = (s) => JSON.parse(s);
const run = async (fn, notify) => { try { return await fn(); } catch (e) { notify?.(e.message, 'warn'); return null; } };

// ------------------------------------------------------------------ local (browser engine) clarification form
function Clarify({ draft, onSave }) {
  const [kind, setKind] = useState('never_off_while_occupied');
  const [room, setRoom] = useState('hallway');
  const [device, setDevice] = useState('security');
  const [expectOn, setExpectOn] = useState(true);
  return <form className="clarify" onSubmit={(e) => { e.preventDefault(); onSave(kind === 'never_off_while_occupied' ? { kind, room } : { kind, device, routine: 'goodnight', expectOn }); }}>
    <p className="callout warn"><b>SWITCH needs clarification.</b> {draft.reason} {draft.clarify}</p>
    <div className="grid-2">
      <label className="field"><span>What should stay true?</span><select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="never_off_while_occupied">A room's light is not turned off while someone is there</option>
        <option value="state_after_routine">A device ends in a given state after Goodnight</option></select></label>
      {kind === 'never_off_while_occupied'
        ? <label className="field"><span>Room</span><select value={room} onChange={(e) => setRoom(e.target.value)}>{ROOM_IDS.map((r) => <option key={r} value={r}>{ROOMS[r].name}</option>)}</select></label>
        : <div className="grid-2"><label className="field"><span>Device</span><select value={device} onChange={(e) => setDevice(e.target.value)}>{Object.keys(DEVICES).filter((d) => DEVICES[d].kind !== 'door').map((d) => <option key={d} value={d}>{DEVICES[d].label}</option>)}</select></label>
          <label className="field"><span>Expected state</span><select value={String(expectOn)} onChange={(e) => setExpectOn(e.target.value === 'true')}><option value="true">ON / armed</option><option value="false">OFF / disarmed</option></select></label></div>}
    </div>
    <button type="submit" className="btn btn-sm">Update structured draft</button>
  </form>;
}

// ------------------------------------------------------------------ canonical (backend) clarification questions
function Questions({ d, actions }) {
  const [ans, setAns] = useState({});
  const answerable = (d.questions || []).filter((q) => q.answer_key && q.options?.length);
  return <div className="clarify" data-testid={`clarify-${d.draftId}`}>
    <p className="callout warn"><b>{d.unsupported ? 'SWITCH cannot model this as written.' : 'SWITCH needs clarification before anything is saved.'}</b> {d.reason}</p>
    {answerable.map((q) => <fieldset key={q.question} className="q-set"><legend>{q.question}</legend>
      <div className="q-opts">{q.options.slice(0, 12).map((o) => <label key={String(o.value)} className="check q-opt"><input type="radio" name={`${d.draftId}-${q.answer_key}`} checked={ans[q.answer_key] === o.value} onChange={() => setAns({ ...ans, [q.answer_key]: o.value })} /> {o.label}</label>)}</div>
    </fieldset>)}
    {(d.questions || []).filter((q) => !q.answer_key || !q.options?.length).map((q) => <p key={q.question} className="ctl-note">• {q.question}</p>)}
    <div className="btn-row">
      {answerable.length > 0 && <button type="button" className="btn btn-sm btn-primary" disabled={!Object.keys(ans).length} onClick={() => run(() => actions.clarifyDraft(d.draftId, ans), actions.notify)} data-testid={`answer-${d.draftId}`}><Check size={14} /> Use these answers</button>}
      {!answerable.length && <span className="ctl-note">Rephrase the correction above with a supported device and condition.</span>}
    </div>
  </div>;
}

function DraftCard({ d, actions, mode, busy }) {
  const [editing, setEditing] = useState(false);
  return <article className="card draft" data-testid={`draft-${d.draftId}`}>
    <header className="card-head"><span className="res res-review">DRAFT</span><h3 className="grow">{d.needsClarification && !d.stored ? d.title : d.title}</h3>
      <code>{d.draftId}</code>{mode === 'backend' && <span className="tag">{d.stored ? 'saved draft · not enforced' : 'not saved yet'}</span>}</header>
    <p className="quote"><MessageSquareQuote size={15} /> “{d.sourceText}”</p>
    {mode !== 'backend' && d.needsClarification ? <Clarify draft={d} onSave={(f) => actions.clarifyDraft(d.draftId, f)} />
      : !d.stored && mode === 'backend' ? <Questions d={d} actions={actions} />
        : editing ? <StructuredEdit r={d} actions={actions} onDone={() => setEditing(false)} draft /> : <>
          <p className="muted">{mode === 'backend' ? `Structured interpretation (${d.interpreter}${d.confidence != null ? ` · heuristic completeness ${d.confidence}` : ''}; not yet a requirement):` : "SWITCH's structured interpretation (rule-based parser; not yet a requirement):"}</p>
          <dl className="req-dl"><dt>Scope</dt><dd>{d.scope?.type} · {ROOMS[d.room]?.name || d.room}{d.device ? ` · ${devLabel(d.device)}` : ''}{d.scope?.routine ? ` · routine ${d.scope.routine}` : ''}</dd>
            <dt>Preconditions</dt><dd>{(d.preconditions || []).join('; ') || 'none'}</dd><dt>Expected behaviour</dt><dd>{d.expectedBehavior}</dd>
            <dt>Assertion</dt><dd><code>{mode === 'backend' ? `${d.expected?.kind} ${d.expected?.device}.${d.expected?.attr} = ${JSON.stringify(d.expected?.value)}` : JSON.stringify(d.assertion)}</code></dd><dt>Tested in</dt><dd>{(d.scenarios || []).join(', ') || 'no scenario bound (replay will be INCONCLUSIVE)'}</dd></dl>
          {d.ambiguities?.length > 0 && <div className="callout warn"><b>Open questions block confirmation:</b><ul>{d.ambiguities.map((a) => <li key={a}>{a}</li>)}</ul></div>}
          <p className="ctl-note">Unconfirmed drafts are never enforced. Confirm only if this is a durable household rule, not a one-off.</p>
        </>}
    {(d.stored || mode !== 'backend') && !editing && <div className="btn-row">
      <button type="button" className="btn btn-ok" disabled={d.needsClarification || !!busy} onClick={() => run(() => actions.confirmDraft(d.draftId), actions.notify)} data-testid={`confirm-${d.draftId}`}><Check size={16} /> Confirm & save</button>
      {mode === 'backend' && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)} disabled={!!busy}><Pencil size={14} /> {d.needsClarification ? 'Resolve questions' : 'Edit draft'}</button>}
      <button type="button" className="btn btn-ghost" onClick={() => run(() => actions.discardDraft(d.draftId), actions.notify)} disabled={!!busy}><X size={16} /> Discard</button>
    </div>}
    {!d.stored && mode === 'backend' && <div className="btn-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.discardDraft(d.draftId)}><Trash2 size={14} /> Dismiss</button></div>}
  </article>;
}

// ------------------------------------------------------------------ structured editor for canonical requirements
function StructuredEdit({ r, actions, onDone, draft = false }) {
  const { q, state } = useApp();
  const raw = r.raw;
  const [title, setTitle] = useState(raw.title);
  const [kind, setKind] = useState(raw.expected_behavior.kind);
  const [device, setDevice] = useState(raw.expected_behavior.device);
  const attr = Object.keys(CANON[device]?.attrs || { power: [] })[0];
  const values = CANON[device]?.attrs?.[attr] || [];
  const [value, setValue] = useState(enc(raw.expected_behavior.value));
  const occ0 = raw.preconditions.filter((c) => c.op !== 'time_between' && String(c.device).endsWith('_occupancy')).map((c) => ({ room: CANON[c.device]?.room_id, occupied: (c.value === true) === (c.op === 'eq') }));
  const tw0 = raw.preconditions.find((c) => c.op === 'time_between');
  const other = raw.preconditions.filter((c) => c.op !== 'time_between' && !String(c.device).endsWith('_occupancy'));
  const [occ, setOcc] = useState(occ0);
  const [tw, setTw] = useState(tw0 ? { on: true, start: tw0.start, end: tw0.end } : { on: false, start: '22:00', end: '06:00' });
  const [routine, setRoutine] = useState(raw.scope.routine_ids[0] || '');
  const [scen, setScen] = useState(raw.scope.scenario_ids);
  const [amb, setAmb] = useState(raw.ambiguities || []);
  const [ok, setOk] = useState(false);
  const scenarios = q.scenarios().filter((s) => !s.edgeCase);
  const routines = state.canon.routines || [];
  const content = () => ({
    title, ambiguities: amb,
    expected_behavior: { kind, device, attr, value: values.some((v) => enc(v) === value) ? dec(value) : values[0] },
    preconditions: [...occ.map((o) => ({ op: 'eq', device: `${o.room}_occupancy`, attr: 'occupied', value: o.occupied })), ...other,
      ...(tw.on ? [{ op: 'time_between', start: tw.start, end: tw.end }] : [])],
    scope: { routine_ids: routine ? [routine] : [], devices: [device], scenario_ids: scen },
  });
  return <form className="edit-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await actions.editRequirement(r.id, content(), ok); onDone(); }, actions.notify); }} data-testid={`edit-${r.id}`}>
    <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
    <fieldset className="q-set"><legend>Expected behaviour</legend><div className="grid-3">
      <label className="field"><span>Rule</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="must_not_set">must never set the device to…</option><option value="final_state_equals">device must end in state…</option></select></label>
      <label className="field"><span>Device</span><select value={device} onChange={(e) => { setDevice(e.target.value); const a = Object.keys(CANON[e.target.value].attrs)[0]; setValue(enc(CANON[e.target.value].attrs[a][0])); }}>{TARGETS.map((d) => <option key={d.device_id} value={d.device_id}>{d.label}</option>)}</select></label>
      <label className="field"><span>Value ({attr})</span><select value={value} onChange={(e) => setValue(e.target.value)}>{values.map((v) => <option key={enc(v)} value={enc(v)}>{String(v)}</option>)}</select></label>
    </div></fieldset>
    <fieldset className="q-set"><legend>Preconditions</legend>
      {occ.map((o, i) => <div key={i} className="row gap-s wrap"><label className="field"><span>Room</span><select value={o.room} onChange={(e) => setOcc(occ.map((x, j) => (j === i ? { ...x, room: e.target.value } : x)))}>{ROOM_IDS.map((rid) => <option key={rid} value={rid}>{ROOMS[rid].name}</option>)}</select></label>
        <label className="field"><span>is</span><select value={String(o.occupied)} onChange={(e) => setOcc(occ.map((x, j) => (j === i ? { ...x, occupied: e.target.value === 'true' } : x)))}><option value="true">occupied</option><option value="false">empty</option></select></label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOcc(occ.filter((_, j) => j !== i))} aria-label="Remove occupancy condition"><X size={14} /></button></div>)}
      <button type="button" className="btn btn-sm" onClick={() => setOcc([...occ, { room: 'hallway', occupied: true }])}><Plus size={14} /> Occupancy condition</button>
      <label className="check"><input type="checkbox" checked={tw.on} onChange={(e) => setTw({ ...tw, on: e.target.checked })} /> Only between</label>
      {tw.on && <div className="row gap-s"><input className="input" type="time" aria-label="Window start" value={tw.start} onChange={(e) => setTw({ ...tw, start: e.target.value })} /><input className="input" type="time" aria-label="Window end" value={tw.end} onChange={(e) => setTw({ ...tw, end: e.target.value })} /></div>}
      {other.length > 0 && <p className="ctl-note">Kept unchanged: {other.map((c) => `${c.device}.${c.attr} ${c.op} ${c.value}`).join('; ')}</p>}
    </fieldset>
    <fieldset className="q-set"><legend>Scope & scenarios</legend>
      <label className="field"><span>Routine</span><select value={routine} onChange={(e) => setRoutine(e.target.value)}><option value="">Any routine that writes the device</option>{routines.map((x) => <option key={x.routine_id} value={x.routine_id}>{x.name}</option>)}</select></label>
      <div className="q-opts">{scenarios.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={scen.includes(s.id)} onChange={(e) => setScen(e.target.checked ? [...scen, s.id] : scen.filter((x) => x !== s.id))} /> {s.name}</label>)}</div>
      {!scen.length && <p className="ctl-note">No scenario selected: the requirement is bound to every household scenario automatically (scenarios that never exercise it are listed, never counted as PASS).</p>}
    </fieldset>
    {amb.length > 0 && <fieldset className="q-set"><legend>Open questions (must be resolved before confirming)</legend>
      {amb.map((a) => <div key={a} className="row gap-s"><span className="grow">{a}</span><button type="button" className="btn btn-sm" onClick={() => setAmb(amb.filter((x) => x !== a))}>Mark resolved</button></div>)}</fieldset>}
    <p className="ctl-note">Saving creates version {r.version + 1} and keeps every earlier version. {draft ? 'The draft stays unconfirmed until you confirm it.' : 'The edited meaning is confirmed in the same step if you tick the box.'}</p>
    <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm the edited requirement</label>
    <div className="btn-row"><button type="submit" className="btn btn-ok" disabled={!ok}>Save as v{r.version + 1}</button><button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button></div>
  </form>;
}

function EditForm({ r, onSave, onCancel }) {
  const [title, setTitle] = useState(r.title); const [pre, setPre] = useState((r.preconditions || []).join('\n')); const [exp, setExp] = useState(r.expectedBehavior || ''); const [sev, setSev] = useState(r.severity || 'must'); const [ok, setOk] = useState(false);
  return <form className="edit-form" onSubmit={(e) => { e.preventDefault(); onSave({ title, preconditions: pre.split('\n').map((x) => x.trim()).filter(Boolean), expectedBehavior: exp, severity: sev }, ok); }}>
    <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
    <label className="field"><span>Preconditions (one per line)</span><textarea value={pre} onChange={(e) => setPre(e.target.value)} /></label>
    <label className="field"><span>Expected behaviour</span><textarea value={exp} onChange={(e) => setExp(e.target.value)} /></label>
    <label className="field"><span>Severity</span><select value={sev} onChange={(e) => setSev(e.target.value)}><option value="must">must</option><option value="should">should</option></select></label>
    <p className="ctl-note">The tested assertion ({r.assertion.type}) is unchanged; saving creates version {r.version + 1} and keeps the history.</p>
    <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm the edited requirement</label>
    <div className="btn-row"><button type="submit" className="btn btn-ok" disabled={!ok}>Save as v{r.version + 1}</button><button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
  </form>;
}

export default function RequirementsPage({ onGo }) {
  const { state, actions, q } = useApp();
  const mode = q.mode(); const busy = state.backend.busy;
  const [text, setText] = useState("Don't turn off the hallway light while someone is there.");
  const [f, setF] = useState({ search: '', room: '', device: '', routine: '', status: '', result: '' });
  const [editing, setEditing] = useState(null); const [hist, setHist] = useState(null);
  const all = q.requirements(); const drafts = q.drafts();
  const shown = useMemo(() => all.filter((r) => {
    const s = f.search.toLowerCase();
    if (s && !`${r.id} ${r.title} ${r.sourceText} ${r.expectedBehavior}`.toLowerCase().includes(s)) return false;
    if (f.room && r.room !== f.room) return false;
    if (f.device && r.device !== f.device) return false;
    if (f.routine && (r.scope?.routine || r.assertion?.routine || '') !== f.routine) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.result && (r.lastResult?.result || 'NOT RUN') !== f.result) return false;
    return true;
  }), [all, f, state.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const routineOpts = mode === 'backend' ? (state.canon.routines || []).map((r) => [r.routine_id, r.name]) : [['goodnight', 'Goodnight']];
  const submit = async (e) => {
    e.preventDefault(); if (!text.trim()) return;
    const res = await run(() => actions.draftFromText(text), actions.notify);
    if (res) actions.notify(res.parsed.supported ? 'Draft created — review the structured rule, then confirm' : 'Not saved: SWITCH needs clarification first', res.parsed.supported ? 'info' : 'warn');
  };
  const openHistory = (id) => { if (hist === id) { setHist(null); return; } setHist(id); actions.loadHistory(id); };

  return <div className="reqs">
    <section className="page-head"><div><p className="eyebrow">Household expectations</p><h1>Saved Requirements</h1>
      <p>Every confirmed correction becomes a versioned requirement that future routine edits are replayed against. Drafts stay drafts until someone confirms them.</p>
      <p className="prov-line"><Provenance mode={mode} /></p></div>
      <span className="badge badge-sim">SIMULATED DEMO</span></section>

    <section className="card composer" aria-labelledby="new-title">
      <h2 id="new-title"><Plus size={20} /> Capture a household correction</h2>
      <form className="row gap-s wrap" onSubmit={submit}>
        <label className="field grow"><span>What should not happen again? (plain language)</span><input value={text} onChange={(e) => setText(e.target.value)} data-testid="correction-input" maxLength={600} /></label>
        <button type="submit" className="btn btn-primary" data-testid="draft-btn" disabled={!!busy}>Draft requirement</button>
      </form>
      {mode === 'backend'
        ? <p className="ctl-note">Interpretation: Person 3C's rule-based interpreter on the canonical device catalog (no live LLM is configured or called). It proposes; it never confirms. Supported targets: lights, TV, security system and front-door lock, with room-occupancy or clock-time conditions. Anything ambiguous asks a question and nothing is saved until it is answered.</p>
        : <p className="ctl-note">Interpretation is a small rule-based parser in the browser (offline fallback). Supported now: “Don’t turn off the &lt;room&gt; light while someone is there.” and “Make sure the &lt;device&gt; is on/off/armed after Goodnight.” Anything else becomes a draft that asks you to clarify.</p>}
    </section>

    {drafts.length > 0 && <section className="section"><h2>Drafts awaiting review <span className="count">{drafts.length}</span></h2>{drafts.map((d) => <DraftCard key={d.draftId} d={d} actions={actions} mode={mode} busy={busy} />)}</section>}

    <section className="section" aria-labelledby="lib-title">
      <h2 id="lib-title">Requirement library <span className="count">{shown.length} / {all.length}</span></h2>
      <div className="filters" role="search">
        <label className="field grow"><span><Search size={13} /> Search</span><input value={f.search} onChange={set('search')} placeholder="ID, title, correction…" /></label>
        <label className="field"><span>Room</span><select value={f.room} onChange={set('room')}><option value="">All</option>{ROOM_IDS.map((r) => <option key={r} value={r}>{ROOMS[r].name}</option>)}</select></label>
        <label className="field"><span>Device</span><select value={f.device} onChange={set('device')}><option value="">All</option>{[...new Set(all.map((r) => r.device))].map((d) => <option key={d} value={d}>{devLabel(d)}</option>)}</select></label>
        <label className="field"><span>Routine</span><select value={f.routine} onChange={set('routine')}><option value="">All</option>{routineOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={f.status} onChange={set('status')} data-testid="filter-status"><option value="">All</option>{['CONFIRMED', 'DISABLED', 'RETIRED'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="field"><span>Last result</span><select value={f.result} onChange={set('result')}><option value="">All</option>{['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT RUN'].map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      {shown.length === 0 && <div className="empty">No requirements match these filters.</div>}
      <div className="req-grid">
        {shown.map((r) => <article key={r.id} id={`req-${r.id}`} className={`card req ${r.status !== 'CONFIRMED' ? 'is-muted' : ''}`} data-testid={`req-${r.id}`}>
          <header className="card-head"><code className="req-id">{r.id}</code><span className={`res res-${STATUS_TONE[r.status]}`}>{r.status}</span><span className="tag">v{r.version}</span>{r.confirmation?.seeded && <span className="tag">seeded demo data</span>}</header>
          <h3>{r.title}</h3>
          <p className="quote"><MessageSquareQuote size={15} /> “{r.sourceText}”</p>
          <dl className="req-dl">
            <dt>Scope</dt><dd><span className="tag">{r.scope?.type}</span> {ROOMS[r.room]?.name || r.room}{r.device ? ` · ${devLabel(r.device)}` : ''}{r.scope?.routine ? ` · ${r.scope.routine}` : ''}</dd>
            <dt>Preconditions</dt><dd>{(r.preconditions || []).join('; ') || '—'}</dd>
            <dt>Expected</dt><dd>{r.expectedBehavior}</dd>
            {mode === 'backend' && <><dt>Scenarios</dt><dd>{(r.scenarios || []).join(', ') || 'auto-bound to all'}</dd><dt>Interpreter</dt><dd>{r.interpreter}</dd></>}
            <dt>Confirmed</dt><dd>{r.confirmation ? <>{r.confirmation.by} · {mode === 'backend' ? r.confirmation.at : `house-sim t=${r.confirmation.at}s`}{r.statusBy ? ` · status by ${r.statusBy}` : ''}</> : <span className="muted">not confirmed ({r.status})</span>}</dd>
            <dt>Last replay</dt><dd>{r.lastResult ? <><span className={`res res-${resultTone(r.lastResult.result)}`}>{r.lastResult.result}</span> {r.lastResult.runId} · {r.lastResult.reason}</> : <span className="res res-neutral">NOT RUN</span>}</dd>
          </dl>
          {r.lastResult?.result === 'INCONCLUSIVE' && <p className="callout warn">Untestable in its last run: {r.lastResult.reason}. This is shown, not silently skipped.</p>}
          {editing === r.id ? (mode === 'backend' ? <StructuredEdit r={r} actions={actions} onDone={() => setEditing(null)} />
            : <EditForm r={r} onCancel={() => setEditing(null)} onSave={(patch, ok) => { try { actions.editRequirement(r.id, patch, ok); setEditing(null); } catch (e) { actions.notify(e.message, 'warn'); } }} />) :
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => setEditing(r.id)} disabled={r.status === 'RETIRED' || !!busy}><Pencil size={14} /> Edit</button>
              {r.status === 'CONFIRMED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => run(() => actions.setRequirementStatus(r.id, 'DISABLED'), actions.notify)} disabled={!!busy} data-testid={`disable-${r.id}`}><Ban size={14} /> Disable</button>}
              {r.status === 'DISABLED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => run(() => actions.setRequirementStatus(r.id, 'CONFIRMED'), actions.notify)} disabled={!!busy}><RotateCcw size={14} /> Re-enable</button>}
              {r.status !== 'RETIRED' && <button type="button" className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => { if (window.confirm(`Retire ${r.id}? Retired requirements are kept in history but can no longer be enforced.`)) run(() => actions.setRequirementStatus(r.id, 'RETIRED'), actions.notify); }}><Archive size={14} /> Retire</button>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => openHistory(r.id)} aria-expanded={hist === r.id}><History size={14} /> History{mode === 'backend' ? '' : ` (${q.history(r.id).length})`}</button>
              {r.lastResult && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onGo({ page: 'reports' })}>Report</button>}
            </div>}
          {hist === r.id && <ol className="versions">{q.history(r.id).length ? q.history(r.id).map((v) => <li key={v.version}><b>v{v.version}</b> {v.status && <span className={`res res-${STATUS_TONE[v.status]}`}>{v.status}</span>} {v.change} <small>· “{v.title}” · by {v.statusBy || v.confirmedBy || v.by}{v.at ? ` · ${v.at}` : ''}</small></li>) : <li className="muted">Loading history…</li>}</ol>}
        </article>)}
      </div>
    </section>
    <p className="fineprint">{mode === 'backend' ? 'Requirements, versions and audit records are stored by the SWITCH backend (SQLite) for the simulated demo household. Version history is append-only.' : 'Offline fallback: requirements live in this browser session only and reset on reload.'}</p>
  </div>;
}
