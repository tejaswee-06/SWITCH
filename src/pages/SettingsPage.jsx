import React, { useEffect, useState } from 'react';
import { RotateCcw, Trash2, Database, HardDrive, Server, ShieldCheck } from 'lucide-react';
import { useApp, useLocalClock } from '../state/StoreContext.jsx';
import { safeStorage, todayISO } from '../state/appStore.js';
import { fmtClock } from '../sim/daylight.js';
import { SIM_VERSION } from '../sim/engine.js';
import { SWITCH_API_BASE } from '../api/switchBackend.js';

function Row({ label, help, children, id }) { return <div className="set-row"><div className="set-label"><label htmlFor={id}><b>{label}</b></label>{help && <p className="muted">{help}</p>}</div><div className="set-ctl">{children}</div></div>; }

function ThemeChoice() {
  const read = () => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [theme, setTheme] = useState(read);
  useEffect(() => { const o = new MutationObserver(() => setTheme(read())); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); }, []);
  const pick = (t) => window.dispatchEvent(new CustomEvent('switch:set-theme', { detail: t }));
  return <div className="seg" role="radiogroup" aria-label="Theme">
    <button type="button" role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'on' : ''} onClick={() => pick('dark')} data-testid="set-theme-dark">Dark</button>
    <button type="button" role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'on' : ''} onClick={() => pick('light')} data-testid="set-theme-light">Light</button></div>;
}

export default function SettingsPage() {
  const { state, actions } = useApp();
  const s = state.settings; const up = actions.updateSettings; const now = useLocalClock();
  const persistent = !!safeStorage();
  const online = state.mode === 'backend'; const b = state.backend;
  return <div className="settings">
    <section className="page-head"><div><p className="eyebrow">Preferences</p><h1>Settings</h1><p>Settings for the features implemented in this prototype. {persistent ? 'Saved in this browser (localStorage) and restored on your next visit.' : 'This browser blocks storage, so settings last for this session only.'}</p></div>
      <span className="badge badge-sim">SIMULATED DEMO</span></section>

    <section className="card set-card"><h2>Household</h2>
      <Row id="set-hh" label="Household" help={online ? 'The backend scopes every requirement, routine, run and report to the authenticated household (demo token for hh_demo). Other households cannot see this data (tested).' : 'Only the simulated demo household exists in offline mode.'}><select id="set-hh" value={s.household} disabled><option value="casa-verde-demo">Casa Verde ({online ? 'hh_demo' : 'casa-verde-demo'} · simulated)</option></select></Row>
    </section>

    <section className="card set-card"><h2>Verification engine</h2>
      <Row id="set-engine" label="Workflow engine" help={`Canonical: the SWITCH backend at ${SWITCH_API_BASE} (Person 2 deterministic evaluator + Person 3C interpretation). Offline fallback: the in-browser simulator — its results are labelled LOCAL and are never mixed into backend reports.`}>
        <div className="seg" role="radiogroup" aria-label="Workflow engine">
          <button type="button" role="radio" aria-checked={online} className={online ? 'on' : ''} onClick={() => actions.setWorkflowMode('backend')} disabled={b.status === 'disabled'} data-testid="set-engine-backend"><Server size={14} /> SWITCH backend</button>
          <button type="button" role="radio" aria-checked={!online} className={!online ? 'on' : ''} onClick={() => actions.setWorkflowMode('local')} data-testid="set-engine-local">In-browser (offline)</button></div>
        <p className="ctl-note">Status: {online ? 'connected' : b.status === 'disabled' ? 'backend disabled for this page (?offline)' : b.status}{b.error ? ` — ${b.error}` : ''}</p></Row>
    </section>

    <section className="card set-card"><h2>Appearance</h2>
      <Row id="set-theme" label="Theme" help="Dark: graphite and cyan. Light: warm terracotta and gold. Saved in this browser.">
        <ThemeChoice /></Row>
    </section>

    <section className="card set-card"><h2>Assistant</h2>
      <Row id="set-assistant" label="SWITCH Assistant (simulated Alexa+)" help="Typed requests are routed by deterministic rules to SWITCH backend tools (Route C). No voice is captured, no Amazon service is contacted and no language model is called unless one is configured on the backend.">
        <div className="btn-row"><span className="badge badge-sim">SIMULATED DEMO</span>
          <span className="ctl-note">AI language model: {state.backend.health?.interpreter?.llm_configured ? 'optional provider configured (schema-checked)' : 'not configured (deterministic rules)'}</span>
          <button type="button" className="btn btn-sm" onClick={() => window.dispatchEvent(new Event('switch:clear-assistant'))} data-testid="set-clear-assistant"><Trash2 size={14} /> Clear conversation</button></div></Row>
    </section>

    <section className="card set-card"><h2>3D house</h2>
      <Row id="set-view" label="Default house view" help="Used when the app opens."><select id="set-view" value={s.defaultView} onChange={(e) => up({ defaultView: e.target.value })} data-testid="set-default-view"><option value="exterior">Exterior overview</option><option value="cutaway">Cutaway (dollhouse)</option><option value="room">Room tour</option></select></Row>
      <Row id="set-labels" label="Device labels in the scene" help="Floating state tags for the selected room in cutaway, room tour and walk modes."><label className="check"><input id="set-labels" type="checkbox" checked={s.showLabels} onChange={(e) => up({ showLabels: e.target.checked })} /> Show device labels</label></Row>
      <Row id="set-q" label="Render quality" help="High: 2048 px shadows, up to 2× pixel ratio. Balanced: 1024 px shadows. Low: no sun shadows, lower resolution (for older laptops)."><select id="set-q" value={s.quality} onChange={(e) => up({ quality: e.target.value })}><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option></select></Row>
    </section>

    <section className="card set-card"><h2>Day / night</h2>
      <Row id="set-tm" label="Time source" help={`Automatic follows your browser's local time (now ${fmtClock(now)}). Manual previews a chosen time. Replays always use their own simulated clock.`}>
        <div className="seg" role="radiogroup" aria-label="Time source"><button type="button" role="radio" aria-checked={s.timeMode !== 'manual'} className={s.timeMode !== 'manual' ? 'on' : ''} onClick={() => up({ timeMode: 'auto' })} data-testid="set-time-auto">Automatic (local time)</button>
          <button type="button" role="radio" aria-checked={s.timeMode === 'manual'} className={s.timeMode === 'manual' ? 'on' : ''} onClick={() => up({ timeMode: 'manual', manualDate: s.manualDate || todayISO() })} data-testid="set-time-manual">Manual</button></div></Row>
      <Row id="set-mt" label="Manual time and date"><div className="row gap-s"><input id="set-mt" className="input" type="time" value={s.manualTime} onChange={(e) => e.target.value && up({ manualTime: e.target.value })} /><input className="input" type="date" aria-label="Manual date" value={s.manualDate || todayISO()} onChange={(e) => up({ manualDate: e.target.value || null })} /></div></Row>
      <Row id="set-lat" label="Latitude for seasonal day length" help="Used only to estimate sunrise/sunset length through the year. Your location is never requested."><input id="set-lat" className="input narrow" type="number" min={-66} max={66} step={1} value={s.latitude} onChange={(e) => up({ latitude: Math.max(-66, Math.min(66, +e.target.value || 0)) })} /></Row>
    </section>

    <section className="card set-card"><h2>Motion & accessibility</h2>
      <Row id="set-rm" label="Reduced motion" help="Reduce makes camera moves instant, slows fan blades, stops pulsing highlights and replay auto-play.">
        <select id="set-rm" value={s.reducedMotion} onChange={(e) => up({ reducedMotion: e.target.value })} data-testid="set-reduced-motion"><option value="system">Follow system setting</option><option value="on">Reduce motion</option><option value="off">Full motion</option></select></Row>
    </section>

    <section className="card set-card"><h2>Simulation</h2>
      <Row id="set-speed" label="House simulator speed" help="How fast simulated time runs in the house (affects modeled temperatures). Replays are unaffected."><select id="set-speed" value={s.simSpeed} onChange={(e) => up({ simSpeed: +e.target.value })}><option value={1}>1× real time</option><option value={30}>30×</option><option value={120}>120×</option></select></Row>
      <Row label="Reset" help={online ? 'Reset demo re-seeds the backend demo household (journey profile): requirements, candidates, runs and decisions return to the start of the story. Only the demo households are touched. No real device exists.' : 'Resets restore the seeded demo — they do not touch any real device (there are none).'}>
        <div className="btn-row"><button type="button" className="btn" onClick={actions.resetSimulation} data-testid="reset-sim"><RotateCcw size={15} /> Reset simulated house</button>
          <button type="button" className="btn" onClick={() => { if (!online || window.confirm('Reset the demo household on the backend? Recorded runs and decisions for hh_demo are deleted and the journey starts again.')) actions.resetDemoData(); }} data-testid="reset-demo"><RotateCcw size={15} /> {online ? 'Reset demo (backend household)' : 'Reset requirements & runs'}</button>
          <button type="button" className="btn btn-ghost" onClick={actions.resetSettings}><Trash2 size={15} /> Clear saved settings</button></div></Row>
    </section>

    <section className="card set-card"><h2>Data status</h2>
      <ul className="status-list">
        <li><HardDrive size={16} /> <b>Settings</b> — {persistent ? 'saved in this browser (localStorage).' : 'session only (storage unavailable).'}</li>
        <li><Database size={16} /> <b>Requirements, drafts, runs, decisions</b> — {online ? <>stored by the SWITCH backend in SQLite (<code>switch_backend/data/switch.db</code>); requirement versions, runs, approvals and audit rows are append-only. Unsaved clarifications live only in this page.</> : 'session-only demo data in memory (offline fallback); reloading the page resets them.'}</li>
        <li><Database size={16} /> <b>Device and sensor states</b> — produced by the local simulator ({SIM_VERSION}).</li>
      </ul>
    </section>

    <section className="card set-card"><h2>Integrations</h2>
      <p>No external integration is connected: no Amazon / Alexa account, no Home Assistant or SmartThings, no physical devices and no live language model. Alexa+ is available only as a <b>simulated</b> in-app experience (Route C). See <b>Devices / Integrations</b> for details.</p>
      <p className="muted"><ShieldCheck size={14} /> Secrets: the backend uses DEMO-ONLY tokens seeded in demo mode; optional LLM credentials are read from environment variables only and are never stored by the UI.</p>
    </section>

    <section className="card set-card"><h2>Privacy & retention</h2>
      <ul className="status-list">
        <li>Correction text you type is stored as the requirement's <i>source correction</i> so its origin is reviewable; it never leaves this machine (no third-party model is called).</li>
        <li>Replay traces contain only modeled device states for synthetic scenarios — no recordings, no real sensor data.</li>
        <li>Retention: demo data is kept until you reset the demo or delete <code>switch_backend/data/switch.db</code>. A retention / deletion policy must be defined before any live use (see FINAL_SUBMISSION_STATUS.md).</li>
      </ul>
    </section>
  </div>;
}
