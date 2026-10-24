import React, { useRef, useState } from 'react';
import { Check, CircleHelp, Play, ShieldCheck, Wrench, X } from 'lucide-react';
import { DEVICES, ROOMS, FAN_SPEEDS, AC_MODES } from './sim/engine.js';
import * as SW from './sim/switch.js';

const label = (id) => DEVICES[id]?.label || id;
export function describe(e) {
  switch (e.kind) {
    case 'device': return `${label(e.device)} ${e.to ? 'ON' : 'OFF'}`;
    case 'fan_speed': return `${label(e.device)} speed ${e.from} → ${e.to}`;
    case 'ac': return `${label(e.device)} ${Object.entries(e.changes).map(([k, v]) => `${k}: ${v.from} → ${v.to}`).join(', ')}`;
    case 'door': return `${label(e.device)} ${e.to ? 'OPEN' : 'CLOSED'}`;
    case 'motion': return `Motion ${e.to ? 'detected' : 'cleared'} · ${ROOMS[e.room]?.name}`;
    case 'occupancy': return `Occupancy ${e.to} · ${ROOMS[e.room]?.name} (${e.via})`;
    case 'sensor': return `Sensor ${e.room}.${e.field} ${e.from} → ${e.to}`;
    case 'routine_start': return `Routine start ${e.routine}`;
    case 'routine_end': return `Routine end ${e.routine}`;
    case 'step_skipped': return `Step ${e.step} skipped (${e.device}) — guard ${e.unknown ? 'UNKNOWN' : 'blocked'}`;
    case 'scene': return `Scene ${e.name}`;
    case 'error': return `ERROR ${e.message}`;
    default: return e.kind;
  }
}
const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function TracePanel({ sim, version }) {
  void version;
  const rows = sim.trace.slice(-14).reverse();
  return <div className="panel trace-panel">
    <div className="panel-heading"><div><div className="panel-title">Event trace</div><div className="panel-subtitle">ORDERED · DETERMINISTIC · SIM CLOCK T+{fmtT(sim.state.t)}</div></div><span className="ai-badge">{sim.trace.length}</span></div>
    <div className="trace-list">{rows.length === 0 && <div className="trace-empty">No events yet — toggle a device or simulate motion.</div>}
      {rows.map((e) => <div key={e.seq} className="trace-row"><span className="trace-seq">#{e.seq}</span><span className="trace-t">{fmtT(e.t)}</span><span className="trace-msg">{describe(e)}</span><span className="trace-src">{e.source}</span></div>)}</div>
  </div>;
}

export function ControlPanel({ sim, version, selectedRoom, dispatch }) {
  void version;
  const room = ROOMS[selectedRoom]; const st = sim.state;
  const fan = room.fan && st.devices[room.fan]; const ac = room.ac && st.devices[room.ac];
  const lights = Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'light');
  return <div className="panel control-panel">
    <div className="panel-heading"><div><div className="panel-title">Lights, fans & AC</div><div className="panel-subtitle">{room.name.toUpperCase()} · SIMULATED DEVICES</div></div></div>
    <div className="chip-grid">{lights.map((id) => <button key={id} className={`light-chip ${st.devices[id].on ? 'on' : ''}`} onClick={() => dispatch({ type: 'toggle', id })} title={label(id)}>{DEVICES[id].room === selectedRoom ? '● ' : ''}{ROOMS[DEVICES[id].room].name}</button>)}</div>
    <div className="ctl-block">
      <div className="ctl-title">Ceiling fan {fan ? '' : <small>— none in this room</small>}</div>
      {fan && <div className="seg">{FAN_SPEEDS.map((s) => <button key={s} className={fan.speed === s ? 'seg-on' : ''} onClick={() => dispatch({ type: 'fanSpeed', id: room.fan, speed: s })}>{s === 'medium' ? 'Med' : s[0].toUpperCase() + s.slice(1)}</button>)}</div>}
    </div>
    <div className="ctl-block">
      <div className="ctl-title">Air conditioner {ac ? '' : <small>— none in this room</small>}</div>
      {ac && <>
        <div className="seg"><button className={ac.on ? 'seg-on' : ''} onClick={() => dispatch({ type: 'ac', id: room.ac, patch: { on: !ac.on } })}>{ac.on ? 'ON' : 'OFF'}</button>
          {AC_MODES.map((m) => <button key={m} className={ac.mode === m ? 'seg-on' : ''} onClick={() => dispatch({ type: 'ac', id: room.ac, patch: { mode: m } })}>{m}</button>)}</div>
        <div className="seg">{['low', 'medium', 'high'].map((f) => <button key={f} className={ac.fan === f ? 'seg-on' : ''} onClick={() => dispatch({ type: 'ac', id: room.ac, patch: { fan: f } })}>fan {f}</button>)}</div>
        <div className="ctl-row"><span>Target</span><button onClick={() => dispatch({ type: 'ac', id: room.ac, patch: { target: ac.target - 1 } })}>−</button><b>{ac.target}°C</b><button onClick={() => dispatch({ type: 'ac', id: room.ac, patch: { target: ac.target + 1 } })}>+</button><span className="ctl-note">now {st.rooms[selectedRoom].temp.toFixed(1)}°C · duty {Math.round(ac.duty * 100)}% · SIMULATED</span></div>
      </>}
    </div>
  </div>;
}

export function SensorPanel({ sim, version, selectedRoom, dispatch, automation, setAutomation }) {
  void version;
  const r = sim.state.rooms[selectedRoom]; const doors = Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'door' && DEVICES[k].room === selectedRoom);
  return <div className="panel sensor-panel">
    <div className="panel-heading"><div><div className="panel-title">Virtual sensors</div><div className="panel-subtitle">{ROOMS[selectedRoom].name.toUpperCase()} · DETERMINISTIC TEST CONTROLS</div></div></div>
    <div className="sensor-grid">
      <div><span>MOTION</span><b className={r.motion ? 'ok' : ''}>{r.motion ? 'DETECTED' : 'clear'}</b></div>
      <div><span>OCCUPANCY</span><b className={r.occupied ? 'ok' : ''}>{r.occupied === null ? 'unknown' : r.occupied ? 'occupied' : 'vacant'}</b></div>
      <div><span>TEMP (SIM)</span><b>{r.temp.toFixed(1)}°C</b></div>
      <div><span>HUMIDITY (SIM)</span><b>{Math.round(r.humidity)}%</b></div>
    </div>
    <div className="btn-row">
      <button className="mini-btn" onClick={() => dispatch({ type: 'motion', room: selectedRoom, active: true })}>Simulate motion</button>
      <button className="mini-btn" onClick={() => dispatch({ type: 'motion', room: selectedRoom, active: false })}>Clear motion</button>
      <button className="mini-btn" onClick={() => dispatch({ type: 'occupancy', room: selectedRoom, occupied: false })}>Vacate</button>
      {doors.map((d) => <button key={d} className="mini-btn" onClick={() => dispatch({ type: 'door', id: d, open: !sim.state.devices[d].open })}>{label(d)}: {sim.state.devices[d].open ? 'open' : 'closed'}</button>)}
    </div>
    <label className="auto-row"><input type="checkbox" checked={automation} onChange={(e) => setAutomation(e.target.checked)} /> Automation: motion in living room → occupancy → living lights ON</label>
  </div>;
}

export function SwitchPanel({ sim, notify, setHighlight, goRoom }) {
  const store = useRef(new SW.RequirementStore()).current;
  const [text, setText] = useState("Don't turn off the hallway light while someone is there.");
  const [parsed, setParsed] = useState(null);
  const [, bump] = useState(0);
  const [candidate, setCandidate] = useState('faulty');
  const [run, setRun] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [repaired, setRepaired] = useState(null);
  const reqs = store.all();
  const routineFor = (c) => c === 'faulty' ? SW.GOODNIGHT_FAULTY : c === 'fixed' ? SW.GOODNIGHT_FIXED : repaired;

  const parse = () => { setParsed(SW.parseCorrection(text)); };
  const confirm = () => { try { const v = store.confirm(parsed.draft, { confirmed: true, at: Math.round(sim.state.t) }); notify(`Requirement ${v.id} saved as v${v.version}`); setParsed(null); bump((x) => x + 1); } catch (e) { notify(e.message); } };
  const doReplay = (c = candidate) => {
    if (!reqs.length) { notify('Confirm a requirement first'); return null; }
    const r = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, routineFor(c), reqs); setRun(r);
    const f = r.results.find((x) => x.result === 'FAIL'); setHighlight(f ? { room: f.room, device: f.device } : null); return r;
  };
  const toTwin = () => {
    const routine = routineFor(candidate); const r = run || doReplay(); if (!r) return;
    ['livingLight', 'kitchenLight', 'hallwayLight'].forEach((id) => sim.dispatch({ type: 'power', id, on: true }, 'switch:setup'));
    sim.dispatch({ type: 'motion', room: 'hallway', active: true }, 'switch:setup');
    sim.registerRoutine(routine); sim.dispatch({ type: 'routine', id: routine.id }, 'switch:replay'); goRoom('hallway');
  };
  const suggest = () => { const f = run?.results.find((x) => x.result === 'FAIL'); if (!f) { notify('No failing assertion to repair'); return; } setProposal(SW.suggestRepair(routineFor(candidate), f)); };
  const approve = () => { try { const ap = SW.approveRepair(proposal, { approved: true }); setRepaired(ap.routine); setCandidate('repaired'); setProposal(null); const r = SW.replay(SW.SCENARIO_GOODNIGHT_HALLWAY, ap.routine, reqs); setRun(r); setHighlight(null); notify('Repair approved and re-run'); } catch (e) { notify(e.message); } };

  const badge = (res) => <span className={`res res-${res.toLowerCase()}`}>{res}</span>;
  return <div className="panel switch-panel">
    <div className="panel-heading"><div><div className="panel-title"><ShieldCheck size={16} className="sparkle-icon" /> SWITCH regression testing</div><div className="panel-subtitle">CORRECTION → REQUIREMENT → REPLAY → ASSERT → REPAIR · DETERMINISTIC, NO AI IN THE VERDICT</div></div><span className="ai-badge">SIMULATED DEMO</span></div>
    <div className="sw-body">
      <div className="sw-step"><b>1 · Correction</b>
        <div className="sw-input"><input value={text} onChange={(e) => setText(e.target.value)} aria-label="Correction text" /><button className="mini-btn" onClick={parse}>Draft requirement</button></div>
        {parsed && !parsed.supported && <div className="sw-warn"><CircleHelp size={13} /> {parsed.reason}</div>}
        {parsed?.supported && <div className="sw-draft"><div><b>{parsed.draft.title}</b><code>{JSON.stringify(parsed.draft.assertion)}</code></div><div className="btn-row"><button className="mini-btn mini-ok" onClick={confirm}><Check size={12} /> Confirm & save</button><button className="mini-btn" onClick={() => setParsed(null)}><X size={12} /> Discard</button></div></div>}
        {reqs.map((r) => <div key={r.id} className="sw-req"><span>{r.id}</span><em>v{r.version} · confirmed</em></div>)}
      </div>
      <div className="sw-step"><b>2 · Routine candidate</b>
        <div className="seg">{[['faulty', 'Goodnight v1 (faulty)'], ['fixed', 'v2 (hand-corrected)'], ...(repaired ? [['repaired', 'Approved repair']] : [])].map(([k, n]) => <button key={k} className={candidate === k ? 'seg-on' : ''} onClick={() => { setCandidate(k); setRun(null); }}>{n}</button>)}</div>
        <div className="btn-row"><button className="mini-btn mini-ok" onClick={() => doReplay()}><Play size={12} /> Run replay</button><button className="mini-btn" onClick={toTwin}>Replay in 3D twin</button><button className="mini-btn" onClick={suggest}><Wrench size={12} /> Suggest repair</button></div>
      </div>
      <div className="sw-step"><b>3 · Result</b>
        {!run && <div className="trace-empty">Not run yet.</div>}
        {run && <>{run.results.map((r) => <div key={r.requirement + r.version} className="sw-result">{badge(r.result)}<span>{r.reason}</span></div>)}
          <div className="sw-hash">trace {run.trace.length} events · hash {run.hash} · {run.routine}</div>
          <div className="trace-list sw-trace">{run.trace.map((e) => <div key={e.seq} className={`trace-row ${run.results.some((r) => r.offending?.seq === e.seq) ? 'trace-bad' : ''}`}><span className="trace-seq">#{e.seq}</span><span className="trace-msg">{describe(e)}</span><span className="trace-src">{e.source}</span></div>)}</div></>}
        {proposal && <div className="sw-diff"><pre>{proposal.diff}</pre><small>{proposal.note}</small><div className="btn-row"><button className="mini-btn mini-ok" onClick={approve}>Approve & re-run</button><button className="mini-btn" onClick={() => setProposal(null)}>Reject</button></div></div>}
      </div>
    </div>
  </div>;
}
