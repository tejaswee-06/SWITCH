import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, PlugZap, Server, Link2Off, ChevronDown, ChevronRight, MessageCircle, RefreshCw, ShieldCheck, Brain } from 'lucide-react';
import { useApp } from '../state/StoreContext.jsx';
import { DEVICES, ROOMS } from '../sim/engine.js';
import { DeviceControls, DeviceGlyph, deviceStateText, kindLabel, isActive } from '../ui/deviceUi.jsx';
import DevicePanel from '../ui/DevicePanel.jsx';
import AlexaPanel from '../ui/AlexaPanel.jsx';
import { describeEvent } from '../ui/format.js';
import { backendApi, SWITCH_API_BASE } from '../api/switchBackend.js';
import { CANON, FE_TO_CANON } from '../api/canonicalMap.js';

const NOT_IMPLEMENTED = [
  { name: 'Home Assistant · SmartThings · openHAB', status: 'NOT IMPLEMENTED', icon: Link2Off, text: 'Possible future importers for routines and device state. No connector exists in this prototype.' },
  { name: 'Physical devices (Matter / Zigbee / Wi-Fi)', status: 'NOT IMPLEMENTED · 0 discovered', icon: PlugZap, text: 'The prototype does not scan the network and cannot control real hardware.' },
];

function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: false, data: null, error: '' });
  const go = async () => { setSt((x) => ({ ...x, loading: true, error: '' })); try { setSt({ loading: false, data: await fn(), error: '' }); } catch (e) { setSt({ loading: false, data: null, error: e.message || String(e) }); } };
  useEffect(() => { go(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [st, go];
}

export default function DevicesPage({ onGo }) {
  const { state, actions, q, sim } = useApp();
  const online = state.mode === 'backend'; const b = state.backend;
  const [alexa, reloadAlexa] = useAsync(() => (online ? backendApi.getAlexaStatus() : Promise.resolve(null)), [online]);
  const [p3c] = useAsync(() => (online ? backendApi.getPerson3CStatus() : Promise.resolve(null)), [online]);
  const [test, setTest] = useState({ loading: false, data: null, error: '' });
  const runTest = async () => { setTest({ loading: true, data: null, error: '' }); try { setTest({ loading: false, data: await backendApi.testAlexaIntegration(), error: '' }); reloadAlexa(); } catch (e) { setTest({ loading: false, data: null, error: e.message }); } };
  const [room, setRoom] = useState(''); const [kind, setKind] = useState(''); const [text, setText] = useState(''); const [open, setOpen] = useState(state.deviceId);
  const ids = useMemo(() => Object.keys(DEVICES).filter((id) => (!room || DEVICES[id].room === room) && (!kind || DEVICES[id].kind === kind) && (!text || DEVICES[id].label.toLowerCase().includes(text.toLowerCase()))), [room, kind, text]);
  const kinds = [...new Set(Object.values(DEVICES).map((d) => d.kind))];
  const backendOnly = Object.values(CANON).filter((d) => !d.fe_id);
  const a = alexa.data;
  void state.rev;
  return <div className="devices">
    <section className="page-head"><div><p className="eyebrow">Inventory & connections</p><h1>Devices / Integrations</h1>
      <p>{Object.keys(DEVICES).length} modeled devices across {Object.keys(ROOMS).length} rooms · <b>0 physically connected</b>. States below are simulated and shared with the 3D house and every timeline.</p></div>
      <span className="badge badge-sim">SIMULATED DEMO</span></section>

    <h2 className="sec-title-sr">Integration status</h2>
    <section className="grid-2 integrations" aria-label="Integration status">
      <article className="card integ" data-testid="integ-backend"><header className="card-head"><span className="glyph-box"><Server size={18} /></span><h3 className="grow">SWITCH backend (deterministic core)</h3>
        <span className={`res res-${online ? 'pass' : b.status === 'connecting' ? 'neutral' : 'fail'}`}>{online ? 'CONNECTED · LOCAL API' : b.status === 'connecting' ? 'CONNECTING' : b.status === 'disabled' ? 'NOT USED (offline mode)' : 'OFFLINE'}</span></header>
        <p className="muted">Requirements, candidates, replays, assertions, repairs, reviewer decisions and reports. API: <code>{SWITCH_API_BASE}</code>. This is the SWITCH verification service on your machine — not Alexa and not a device hub.</p>
        {online && b.health && <ul className="plain small"><li>Environment: <b>{b.health.environment}</b> · device control: {b.health.device_control}</li><li>Simulator {b.health.simulator_version} · seed profile {b.health.seed_profile} · persistence {b.health.persistence}</li>
          <li>Interpreter: {b.health.interpreter?.label}</li><li>{state.canon.requirements.length} requirements · {state.canon.drafts.length} saved drafts · {state.canon.candidates.length} candidates · {state.runs.length} runs</li></ul>}
        {!online && b.error && <p role="alert" className="callout warn">{b.error}. The app is using the in-browser simulator (offline fallback). Start the backend (see README), then retry.</p>}
        <div className="btn-row"><button type="button" className="btn btn-sm" onClick={() => (online ? actions.syncBackend() : actions.connectBackend())} data-testid="backend-retry"><RefreshCw size={14} /> {online ? 'Re-sync' : 'Retry connection'}</button></div>
      </article>

      <article className="card integ" data-testid="integ-alexa"><header className="card-head"><span className="glyph-box"><MessageCircle size={18} /></span><h3 className="grow">Amazon Alexa+</h3>
        <span className="res res-inconclusive" data-testid="alexa-label">SIMULATED DEMO</span></header>
        <p className="muted"><b>Route C — integrated simulated Alexa+ experience.</b> Live routes (MCP server for Alexa+ or an Agent Skill) are <b>BLOCKED</b>: no Alexa+ developer access, OAuth client or public endpoint was available, so nothing here talks to Amazon.</p>
        <dl className="req-dl small">
          <dt>Connection status</dt><dd>{a ? a.connection_status : online ? '…' : 'unavailable (backend offline)'}</dd>
          <dt>Adapter</dt><dd>{a ? `${a.adapter_version} · ${a.protocol_model}` : '—'}</dd>
          <dt>Transport</dt><dd>{a?.transport || '—'}</dd>
          <dt>Last health check</dt><dd>{a?.last_health_check ? `${a.last_health_check.at} · ${a.last_health_check.ok ? 'passed' : 'failed'} (${a.last_health_check.scope})` : 'not run yet'}</dd>
          <dt>Data sent externally</dt><dd>{a?.data_sent_externally || 'none'}</dd>
          <dt>Consent model</dt><dd>{a?.user_consent?.model || 'explicit confirmation of every durable requirement'}</dd>
        </dl>
        {a && <details><summary>Supported tools ({a.capabilities.length}) and limitations</summary><ul className="plain small">{a.capabilities.map((c) => <li key={c}><code>{c}</code>{a.capabilities_verified_by_last_check?.includes(c) ? ' · listed by last check' : ''}</li>)}</ul>
          <ul className="small">{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul><p className="small"><b>Live blockers:</b> {a.live.blockers.join('; ')}.</p></details>}
        <div className="btn-row"><button type="button" className="btn btn-sm" onClick={runTest} disabled={!online || test.loading} data-testid="alexa-test"><ShieldCheck size={14} /> {test.loading ? 'Testing…' : 'Test connection (harmless)'}</button></div>
        {test.data && <p className="ctl-note" role="status" data-testid="alexa-test-result">{test.data.ok ? 'Passed' : 'Failed'}: {test.data.checks.map((c) => `${c.check} ${c.ok ? '✓' : '✕'}`).join(' · ')} — {test.data.scope}. Status remains <b>{test.data.connection_status}</b>.</p>}
        {test.error && <p role="alert" className="callout warn">{test.error}</p>}
      </article>

      <article className="card integ" data-testid="integ-p3c"><header className="card-head"><span className="glyph-box"><Brain size={18} /></span><h3 className="grow">Interpretation & repair proposals (Person 3C)</h3>
        <span className="res res-neutral">RULE-BASED · PROPOSAL ONLY</span></header>
        <p className="muted">Corrections are interpreted by Person 3C's deterministic rules on the canonical catalog; repair proposals are checked by its constrained-repair validator. No live LLM is configured or called; it never confirms a requirement or assigns PASS/FAIL.</p>
        {p3c.data && <ul className="plain small"><li>Status: {p3c.data.status} · interpreter: {p3c.data.interpreter}</li><li>Activity-context ML model ready: {String(p3c.data.ml_ready)} (optional; not used for verdicts)</li><li>Evaluator authority: {p3c.data.evaluator_authority}</li></ul>}
        {!online && <p className="muted small">Available when the backend is connected.</p>}
      </article>

      {NOT_IMPLEMENTED.map((it) => { const I = it.icon; return <article key={it.name} className="card integ"><header className="card-head"><span className="glyph-box"><I size={18} /></span><h3 className="grow">{it.name}</h3><span className="res res-neutral">{it.status}</span></header><p className="muted">{it.text}</p></article>; })}
    </section>

    <section className="card" aria-label="Simulated Alexa+ assistant"><AlexaPanel embedded onGo={onGo} /></section>

    <section className="section" aria-labelledby="inv-title">
      <h2 id="inv-title"><Cpu size={20} /> Device inventory <span className="count">{ids.length}</span></h2>
      <div className="filters">
        <label className="field grow"><span>Search</span><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Device name…" /></label>
        <label className="field"><span>Room</span><select value={room} onChange={(e) => setRoom(e.target.value)} data-testid="dev-filter-room"><option value="">All rooms</option>{Object.keys(ROOMS).map((r) => <option key={r} value={r}>{ROOMS[r].name}</option>)}</select></label>
        <label className="field"><span>Type</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option>{kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>
      </div>
      <div className="table-wrap"><table className="tbl dev-tbl"><thead><tr><th>Device</th><th>Room</th><th>Type</th><th>Modeled state</th><th>Controls</th><th>Controlling routine</th><th>Last event</th><th>Canonical ID</th></tr></thead>
        <tbody>{ids.map((id) => { const d = DEVICES[id]; const r = q.routinesFor(id); const ev = q.eventsFor({ device: id, limit: 1 })[0]; const isOpen = open === id;
          return <React.Fragment key={id}><tr className={isOpen ? 'sel' : ''}>
            <td><button type="button" className="linkish dev-name" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className={`glyph-box sm ${isActive(id, sim.state) ? 'is-on' : ''}`}><DeviceGlyph id={id} size={14} /></span>{d.label}</button></td>
            <td>{ROOMS[d.room].name}</td><td>{kindLabel(d.kind)}</td>
            <td data-testid={`dev-state-${id}`}><span className={`state-dot ${isActive(id, sim.state) ? 'on' : 'off'}`} aria-hidden /> {deviceStateText(id, sim.state, true)}</td>
            <td className="ctl-cell"><DeviceControls id={id} state={sim.state} actions={actions} compact /></td>
            <td>{r.length ? r.map((x) => <div key={x.id}>{x.name} <code>{x.version}</code></div>) : <span className="muted">—</span>}</td>
            <td className="small">{ev ? `#${ev.seq} ${describeEvent(ev)}` : <span className="muted">—</span>}</td>
            <td><code className="small">{FE_TO_CANON[id]}</code> <span className="tag">simulated</span></td></tr>
            {isOpen && <tr className="detail-row"><td colSpan={8}><div className="detail-wrap"><DevicePanel id={id} onGo={onGo} /><div className="detail-side"><button type="button" className="btn" onClick={() => { actions.selectDevice(id); onGo({ page: 'home' }); }}>Show in the 3D house</button></div></div></td></tr>}
          </React.Fragment>; })}</tbody></table></div>
      <h3 className="mt">Modeled by the backend only (no 3D fixture)</h3>
      <p className="muted small">These canonical devices exist in the shared contract and can appear in requirements and traces, but the villa model has no fixture for them, so they are shown as text, never as a 3D object.</p>
      <ul className="plain small">{backendOnly.map((d) => <li key={d.device_id}><code>{d.device_id}</code> · {d.label} · {ROOMS[d.room_id]?.name} · {d.read_only ? 'sensor (read-only)' : Object.keys(d.attrs).join(', ')}</li>)}</ul>
    </section>
  </div>;
}
