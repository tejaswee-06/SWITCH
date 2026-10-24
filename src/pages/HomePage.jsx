import React from 'react';
import { ArrowRight, FlaskConical, GitCompare, ListTree, Wrench, Play, Footprints, ThermometerSun, Droplets, Users, Activity } from 'lucide-react';
import { useApp, useEnvironment, useReducedMotion } from '../state/StoreContext.jsx';
import HouseViewer from '../three/HouseViewer.jsx';
import TimeControl from '../ui/TimeControl.jsx';
import DevicePanel from '../ui/DevicePanel.jsx';
import { DEVICES, ROOMS } from '../sim/engine.js';
import { ROOM_INFO, roomNumber } from '../sim/rooms.js';
import { DeviceGlyph, deviceStateText, isActive, roomDevices } from '../ui/deviceUi.jsx';
import { describeEvent, fmtSimT, resultTone, fmtOcc } from '../ui/format.js';
import { routineDiff } from '../sim/switch.js';
import { Provenance } from './ReplayLabPage.jsx';

function RoomPanel({ roomId }) {
  const { actions, sim } = useApp();
  const r = sim.state.rooms[roomId]; const ids = roomDevices(roomId);
  return <section className="card" aria-labelledby="rp-title" data-testid="room-panel">
    <header className="card-head"><span className="num-badge">{roomNumber(roomId)}</span><div className="grow"><h3 id="rp-title">{ROOM_INFO[roomId].name}</h3><p className="muted">{ROOM_INFO[roomId].floorLabel} · {ROOM_INFO[roomId].blurb}</p></div></header>
    <div className="kv-row kv-4">
      <div><span><ThermometerSun size={13} /> Temp (sim)</span><b>{r.temp.toFixed(1)} °C</b></div>
      <div><span><Droplets size={13} /> Humidity (sim)</span><b>{Math.round(r.humidity)}%</b></div>
      <div><span><Users size={13} /> Occupancy</span><b data-testid="room-occupancy">{fmtOcc(r.occupied)}</b></div>
      <div><span><Activity size={13} /> Motion</span><b>{r.motion ? 'detected' : 'clear'}</b></div>
    </div>
    <div className="btn-row">
      <button type="button" className="btn btn-sm" onClick={() => actions.motion(roomId, true)} data-testid="sim-motion">Simulate motion</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => actions.motion(roomId, false)}>Clear motion</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => actions.vacate(roomId)}>Mark vacant</button>
    </div>
    <ul className="dev-list" aria-label={`Devices in ${ROOM_INFO[roomId].name}`}>
      {ids.map((id) => <li key={id}><button type="button" className={`dev-row ${isActive(id, sim.state) ? 'is-on' : ''}`} onClick={() => actions.selectDevice(id)} data-testid={`dev-row-${id}`}>
        <span className="glyph-box sm"><DeviceGlyph id={id} size={15} /></span><span className="grow"><b>{DEVICES[id].label}</b><small>{deviceStateText(id, sim.state)}</small></span></button>
        {DEVICES[id].kind === 'light' && <button type="button" role="switch" aria-checked={sim.state.devices[id].on} aria-label={`${DEVICES[id].label} power`} className={`toggle ${sim.state.devices[id].on ? 'on' : ''}`} onClick={() => actions.setPower(id, !sim.state.devices[id].on)} data-testid={`quick-${id}`}><span className="toggle-knob" /><span className="toggle-text">{sim.state.devices[id].on ? 'ON' : 'OFF'}</span></button>}
      </li>)}
    </ul>
  </section>;
}

export default function HomePage({ onGo }) {
  const { state, actions, q, sim } = useApp();
  const { env, date } = useEnvironment(state.settings);
  const reduced = useReducedMotion(state.settings);
  const run = q.latestRun(); const risk = q.requirementsAtRisk();
  const cand = state.lab.candidate; const diff = cand && state.live.goodnight ? routineDiff(state.live.goodnight, cand) : { changed: 0, rows: [] };
  const recent = q.eventsFor({ limit: 8 });
  const runCheck = () => { onGo({ page: 'replay' }); Promise.resolve().then(() => actions.runReplay('Regression check')).catch(() => {}); };

  return <div className="home">
    <section className="hero-row">
      <div>
        <p className="eyebrow">Casa Verde · simulated demo household</p>
        <h1>Your home, with changes you can verify.</h1>
        <p className="lede">Explore the modeled villa, operate its virtual devices, and check that routine edits still respect the corrections your household confirmed.</p>
      </div>
      <div className="hero-cta">
        <button type="button" className="btn btn-primary" onClick={() => onGo({ page: 'replay' })} data-testid="cta-replay"><FlaskConical size={18} /> Open Replay Lab</button>
        <button type="button" className="btn" onClick={runCheck} data-testid="cta-check"><Play size={16} /> Run regression check</button>
      </div>
    </section>

    <div className="home-grid">
      <div className="home-main">
        <HouseViewer source={sim} rev={state.rev} mode={state.viewMode} roomId={state.roomId} deviceId={state.deviceId} cutLevel={state.cutLevel}
          highlight={state.highlight} env={env} settings={state.settings} reducedMotion={reduced} showLabels={state.settings.showLabels}
          onSetMode={actions.setViewMode} onSelectRoom={(r, o = {}) => (o.fromWalk ? actions.selectRoom(r) : o.tour ? actions.openRoomTour(r) : actions.selectRoom(r))}
          onStepRoom={actions.stepRoom} onSelectDevice={actions.selectDevice} onSetCutLevel={actions.setCutLevel} onFullscreenChange={actions.setFullscreen}
          timeSlot={<TimeControl settings={state.settings} env={env} envDate={date} onChange={actions.updateSettings} />} title="Casa Verde villa" />
        <div className="action-strip" role="toolbar" aria-label="Verification actions">
          <button type="button" className="btn" onClick={runCheck}><Play size={16} /> Run Replay</button>
          <button type="button" className="btn" onClick={() => onGo({ page: 'replay' })} disabled={!diff.changed} title={diff.changed ? '' : 'No pending routine change'}><GitCompare size={16} /> Compare Changes <small>{diff.changed} step{diff.changed === 1 ? '' : 's'}</small></button>
          <button type="button" className="btn" onClick={() => onGo({ page: run ? 'reports' : 'replay' })} disabled={!run} title={run ? '' : 'Run a replay first'}><ListTree size={16} /> View Trace</button>
          <button type="button" className="btn" onClick={() => onGo({ page: 'replay' })} disabled={!state.lab.proposal} title={state.lab.proposal ? '' : 'No proposed fix yet'}><Wrench size={16} /> Review Proposed Fix</button>
          <button type="button" className="btn btn-ghost" onClick={() => actions.setViewMode('walk')}><Footprints size={16} /> Walk through</button>
        </div>
      </div>

      <aside className="rail" aria-label="Selected room, routines and verification status">
        <h2 className="rail-title">Selected room, routines and verification status</h2>
        {state.deviceId ? <DevicePanel id={state.deviceId} onClose={() => actions.selectDevice(null)} onGo={onGo} /> : <RoomPanel roomId={state.roomId} />}

        <section className="card" aria-labelledby="lr-title" data-testid="latest-replay">
          <header className="card-head"><h3 id="lr-title" className="grow">Latest replay</h3>{run && <span className={`res res-${resultTone(run.verdict)}`}>{run.verdict}</span>}</header>
          {run ? <>
            <p><b>{run.runId}</b> · {run.routine.id}@{run.routine.version}</p>
            <p className="small"><Provenance run={run} /></p>
            <p className="muted">PASS {run.counts.PASS} · FAIL {run.counts.FAIL} · INCONCLUSIVE {run.counts.INCONCLUSIVE} · {run.decision ? `reviewer ${run.decision.decision}` : 'awaiting human review'}</p>
            {run.cases.filter((c) => c.result !== 'PASS').slice(0, 2).map((c) => <p key={c.requirement + c.scenario} className="finding"><span className={`res res-${resultTone(c.result)}`}>{c.result}</span> {c.reason}</p>)}
          </> : <p className="muted">No replay yet.{cand ? <> A pending edit to <b>Goodnight</b> ({cand.version}) changes {diff.changed} step — run a regression check before approving it.</> : ''}</p>}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onGo({ page: 'replay' })}>Open Replay Lab <ArrowRight size={14} /></button>
        </section>

        <section className="card" aria-labelledby="risk-title" data-testid="at-risk">
          <header className="card-head"><h3 id="risk-title" className="grow">Saved requirements at risk</h3><span className="count">{risk.length}</span></header>
          {risk.length ? <ul className="plain">{risk.map((r) => <li key={r.req.id}><button type="button" className="mini-row link-row" onClick={() => onGo({ page: 'requirements', req: r.req.id })}><span className={`res res-${r.tone}`}>{r.tone === 'review' ? 'NEEDS REVIEW' : r.tone.toUpperCase()}</span> <b>{r.req.id}</b> {r.req.title}<small>{r.why}</small></button></li>)}</ul>
            : <p className="muted">Nothing at risk: no confirmed requirement has a failing or unknown last result{state.lab.decision ? '' : ', and no pending edit is untested'}.</p>}
        </section>

        <section className="card" aria-labelledby="ar-title">
          <header className="card-head"><h3 id="ar-title" className="grow">Active routines</h3><span className="tag">live versions</span></header>
          {Object.values(state.live).map((r) => <div key={r.id} className="routine-row"><div className="grow"><b>{r.name}</b> <code>{r.version}</code><small>{r.steps.length} steps · {r.steps.filter((s) => s.guard).length} guarded</small></div>
            <button type="button" className="btn btn-sm" onClick={() => actions.runLiveRoutine(r.id)}>Run in sim</button></div>)}
          {cand && <div className="routine-row pending"><div className="grow"><b>Goodnight</b> <code>{cand.version}</code><small>{state.lab.decision ? `Candidate ${state.lab.decision.decision}` : 'Candidate edit — pending verification'}</small></div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onGo({ page: 'replay' })}>Review</button></div>}
          <p className="ctl-note">“Run in sim” executes the {state.mode === 'backend' ? 'canonical (backend) live version' : 'live version'} in the 3D house simulator. Candidate edits are never run on the house until approved — and approval is recorded only, never deployed.</p>
          <label className="check"><input type="checkbox" checked={state.automation} onChange={(e) => actions.setAutomation(e.target.checked)} /> Automation: living-room motion → Living room welcome</label>
        </section>

        <section className="card" aria-labelledby="ra-title">
          <header className="card-head"><h3 id="ra-title" className="grow">Recent activity</h3><span className="tag">house sim {fmtSimT(sim.state.t)}</span></header>
          {recent.length ? <ol className="ev-list" data-testid="recent-activity">{recent.map((e) => <li key={e.seq}><span className="ev-seq">#{e.seq}</span><span>{describeEvent(e)}</span><em>{e.source}</em></li>)}</ol>
            : <p className="muted">No events yet. Toggle a light or simulate motion — every change appears here and in the device's history.</p>}
        </section>
      </aside>
    </div>
    <p className="fineprint">Room temperatures, humidity, power and occupancy are simulated. {ROOMS[state.roomId].name} is room {roomNumber(state.roomId)} of 8.</p>
  </div>;
}
