import React from 'react';
import { X, Route, ListChecks, History, FlaskConical } from 'lucide-react';
import { DEVICES, ROOMS } from '../sim/engine.js';
import { useApp } from '../state/StoreContext.jsx';
import { DeviceControls, DeviceGlyph, deviceStateText, kindLabel, isActive } from './deviceUi.jsx';
import { describeEvent, fmtSimT, describeStep, resultTone } from './format.js';

/** Selected device: state, controls, controlling routine, requirements, recent events, replay failures. */
export default function DevicePanel({ id, onClose, onGo }) {
  const { state, actions, q, sim } = useApp();
  const d = DEVICES[id]; if (!d) return null;
  const st = sim.state;
  const routines = q.routinesFor(id);
  const reqs = q.requirementsFor(id);
  const events = q.eventsFor({ device: id, limit: 6 });
  const failures = state.runs.flatMap((r) => r.cases.filter((c) => c.device === id && c.result !== 'PASS').map((c) => ({ run: r, c }))).slice(0, 3);
  return <section className="card device-panel" aria-labelledby="dp-title" data-testid="device-panel">
    <header className="card-head">
      <div className={`glyph-box ${isActive(id, st) ? 'is-on' : ''}`}><DeviceGlyph id={id} size={20} /></div>
      <div className="grow"><h3 id="dp-title">{d.label}</h3><p className="muted">{kindLabel(d.kind)} · {ROOMS[d.room].name} · <span className="tag">modeled</span></p></div>
      {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close device panel"><X size={16} /></button>}
    </header>
    <div className="state-line" data-testid="device-state"><span className={`state-dot ${isActive(id, st) ? 'on' : 'off'}`} aria-hidden /> <b>{deviceStateText(id, st)}</b></div>
    <DeviceControls id={id} state={st} actions={actions} />
    <div className="sub-block">
      <h4><Route size={15} /> Controlling routines</h4>
      {routines.length ? routines.map((r) => <div key={r.id} className="mini-row"><b>{r.name}</b> <code>{r.version}</code>{r.steps.map((s) => <div key={s.i} className="mini-sub">step {s.i}: {describeStep(s)}</div>)}</div>)
        : <p className="muted">No live routine controls this device.</p>}
    </div>
    <div className="sub-block">
      <h4><ListChecks size={15} /> Saved requirements</h4>
      {reqs.length ? reqs.map((r) => <button type="button" key={r.id} className="mini-row link-row" onClick={() => onGo?.({ page: 'requirements', req: r.id })}>
        <b>{r.id}</b> {r.title} <span className={`res res-${resultTone(r.lastResult?.result)}`}>{r.lastResult?.result || 'NOT RUN'}</span> <small>{r.status} · v{r.version}</small></button>)
        : <p className="muted">No requirement references this device yet.</p>}
    </div>
    {failures.length > 0 && <div className="sub-block">
      <h4><FlaskConical size={15} /> Replay findings</h4>
      {failures.map(({ run, c }) => <button type="button" key={run.runId + c.scenario} className="mini-row link-row" onClick={() => onGo?.({ page: 'replay' })}>
        <span className={`res res-${resultTone(c.result)}`}>{c.result}</span> {run.runId} · {c.requirement} · {c.reason}</button>)}
    </div>}
    <div className="sub-block">
      <h4><History size={15} /> Recent events (house simulator)</h4>
      {events.length ? <ol className="ev-list">{events.map((e) => <li key={e.seq}><span className="ev-seq">#{e.seq}</span><span className="ev-t">{fmtSimT(e.t)}</span><span>{describeEvent(e)}</span><em>{e.source}</em></li>)}</ol>
        : <p className="muted">No events yet for this device.</p>}
    </div>
  </section>;
}
