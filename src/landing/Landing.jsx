// Cinematic landing: giant SWITCH typewriter wordmark, the React Bits Orb around the SWITCH logo, the real 3D villa,
// the verification workflow and two working calls to action. Nothing here implies physical-device control.
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Sun, Moon, ShieldCheck, ListChecks, GitCompare, FlaskConical, FileSearch, Wrench, RotateCcw, UserCheck, Mic } from 'lucide-react';
import { useApp, useEnvironment, useReducedMotion } from '../state/StoreContext.jsx';
import TypewriterWordmark from './TypewriterWordmark.jsx';

const Orb = lazy(() => import('../components/reactbits/Orb/Orb.jsx'));
const HouseViewer = lazy(() => import('../three/HouseViewer.jsx'));

const FLOW = [
  [Mic, 'Correction', '“Don’t turn off the hallway light while someone is there.”'],
  [ListChecks, 'Confirmation', 'You review the structured rule before it counts.'],
  [ShieldCheck, 'Requirement', 'Saved with an ID and a version.'],
  [GitCompare, 'Routine change', 'Goodnight is edited; SWITCH sees what changed.'],
  [FlaskConical, 'Replay', 'Deterministic, ordered, repeatable simulation.'],
  [FileSearch, 'Evidence', 'The exact event that broke the rule.'],
  [Wrench, 'Repair', 'A constrained fix, marked not verified.'],
  [RotateCcw, 'Rerun', 'The whole suite is checked again.'],
  [UserCheck, 'Human review', 'You decide. Nothing is deployed.'],
];

/** Keeps the landing usable if the WebGL Orb throws: the CSS fallback is shown instead of a blank page. */
class OrbBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function OrbStage({ theme, reduced }) {
  const [status, setStatus] = useState('loading');
  const dark = theme !== 'light';
  return <div className="orb-stage" data-orb-status={status} data-testid="orb-stage">
    {status !== 'unavailable' && <OrbBoundary onFail={() => setStatus('unavailable')}><Suspense fallback={null}>
      <Orb colors={dark ? ['#9c43fe', '#4cc2e9', '#101499'] : ['#7a3df0', '#2aa8d8', '#5a1d0c']} backgroundColor={dark ? '#05080f' : '#c4704c'}
        hoverIntensity={1} trail={1} rotateOnHover followCursor glow={dark ? 1.15 : 1} speed={0.7} paused={reduced} onStatus={setStatus} />
    </Suspense></OrbBoundary>}
    {status === 'unavailable' && <div className="orb-fallback" aria-hidden />}
    <img className="orb-logo" src="/brand/switch-logo.png" alt="SWITCH logo" width="384" height="384" draggable="false" />
    {status === 'unavailable' && <p className="orb-note">WebGL2 isn’t available here, so a static orb is shown.</p>}
  </div>;
}

export default function Landing({ theme, onToggleTheme, onEnter, onTalk }) {
  const { store, state, actions } = useApp();
  const reduced = useReducedMotion(state.settings);
  const { env } = useEnvironment(state.settings);
  const [typed, setTyped] = useState(false);
  const [showVilla, setShowVilla] = useState(false);
  useEffect(() => { document.title = 'SWITCH · Your home, with changes you can verify'; }, []);
  const villaRef = useRef(null);
  // The 3D villa (a second WebGL scene) only loads when its section approaches the viewport.
  useEffect(() => {
    const el = villaRef.current; if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setShowVilla(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShowVilla(true); io.disconnect(); } }, { rootMargin: '150px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  // The copy and CTAs never wait on the animation for long: they appear when typing ends or after 1.6 s at most.
  useEffect(() => { const h = setTimeout(() => setTyped(true), 1600); return () => clearTimeout(h); }, []);
  const online = state.mode === 'backend';
  return <div className="landing" data-testid="landing">
    <a className="skip" href="#landing-main" onClick={(e) => { e.preventDefault(); document.getElementById('landing-main')?.focus(); }}>Skip to content</a>
    <div className="landing-sky" aria-hidden />
    <header className="landing-nav">
      <span className="landing-brand"><img src="/brand/switch-logo-96.png" alt="" width="34" height="34" /> <b>SWITCH</b></span>
      <span className="badge badge-sim" title="Everything here is a modeled household; nothing controls real devices">SIMULATED DEMO</span>
      <span className="grow" />
      <span className={`engine-chip ${online ? 'on' : 'off'}`} data-testid="landing-engine">{online ? 'Backend connected' : state.backend.status === 'connecting' ? 'Connecting…' : 'Backend offline · local fallback'}</span>
      <button type="button" className="icon-btn theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} data-testid="landing-theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      <button type="button" className="btn btn-sm" onClick={onEnter} data-testid="landing-enter">Open the app <ArrowRight size={15} /></button>
    </header>

    <main id="landing-main" tabIndex={-1} className="landing-main">
      <section className="hero-x" aria-labelledby="hero-tag">
        <div className="hero-copy">
          <p className="eyebrow">Smart-home routine verification</p>
          <TypewriterWordmark reducedMotion={reduced} onDone={() => setTyped(true)} />
          <p id="hero-tag" className={`hero-tag ${typed ? 'in' : ''}`}>Your home, with changes you can verify.</p>
          <p className={`hero-sub ${typed ? 'in' : ''}`}>Turn household corrections into lasting requirements. When routines change, SWITCH checks them again and shows you the evidence.</p>
          <div className={`hero-cta-x ${typed ? 'in' : ''}`}>
            <button type="button" className="btn btn-primary btn-lg" onClick={onEnter} data-testid="cta-explore">Explore Your Home <ArrowRight size={18} /></button>
            <button type="button" className="btn btn-lg btn-glass" onClick={onTalk} data-testid="cta-talk"><MessageCircle size={18} /> Talk to SWITCH</button>
          </div>
          <p className="hero-fine">Simulated Alexa+-style assistant · modeled villa · deterministic replay. Not connected to Amazon or physical devices.</p>
        </div>
        <OrbStage theme={theme} reduced={reduced} />
      </section>

      <section className="villa-x" aria-labelledby="villa-h">
        <div className="villa-head"><h2 id="villa-h">The modeled villa</h2><p>The same 3D house and simulator state you’ll use inside the app: eight rooms, modeled lights, sensors and doors.</p></div>
        <div className="villa-frame" ref={villaRef}>
          {showVilla ? <Suspense fallback={<div className="villa-loading" role="status">Loading the villa…</div>}>
            <HouseViewer source={store.sim} rev={state.rev} mode="exterior" roomId={state.roomId} deviceId={state.deviceId} cutLevel={state.cutLevel}
              highlight={state.highlight} env={env} settings={state.settings} reducedMotion={reduced} showLabels={false}
              onSetMode={() => onEnter()} onSelectRoom={(r) => { actions.selectRoom(r); onEnter(); }} onStepRoom={() => {}} onSelectDevice={(d) => { actions.selectDevice(d); onEnter(); }}
              onSetCutLevel={() => {}} onFullscreenChange={() => {}} compact title="Casa Verde villa (preview)" />
          </Suspense> : <div className="villa-loading" role="status">Loading the villa…</div>}
        </div>
      </section>

      <section className="flow-x" aria-labelledby="flow-h">
        <h2 id="flow-h">A fix today shouldn’t become a failure tomorrow</h2>
        <p className="flow-lede">SWITCH remembers the corrections you confirm, and checks them again whenever a routine changes.</p>
        <ol className="flow-steps">{FLOW.map(([I, t, d], i) => <li key={t} style={{ '--i': i }}><span className="flow-ico"><I size={18} aria-hidden /></span><b>{t}</b><span>{d}</span></li>)}</ol>
      </section>

      <section className="final-x">
        <h2>See it on the seeded demo household</h2>
        <div className="hero-cta-x in">
          <button type="button" className="btn btn-primary btn-lg" onClick={onEnter}>Explore Your Home <ArrowRight size={18} /></button>
          <button type="button" className="btn btn-lg btn-glass" onClick={onTalk}><MessageCircle size={18} /> Talk to SWITCH</button>
        </div>
        <p className="hero-fine">A PASS means the selected modeled requirements passed for the recorded scenarios and versions. It does not certify a real home.</p>
      </section>
    </main>
  </div>;
}
