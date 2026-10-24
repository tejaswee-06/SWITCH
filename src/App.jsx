// SWITCH application shell: navigation, top bar, routing, simulator clock and toasts.
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, ChevronDown, Cpu, FileText, FlaskConical, House, ListChecks, Search, Settings, Sparkles, X, Menu, CircleUserRound, Check, AlertTriangle,
  Server, ServerOff, RefreshCw, MessageCircle, Sun, Moon,
} from 'lucide-react';
import { useApp, useLocalClock } from './state/StoreContext.jsx';
import { PAGES } from './state/appStore.js';
import { DEVICES } from './sim/engine.js';
import { ROOM_ORDER, ROOM_INFO } from './sim/rooms.js';
import { fmtClock } from './sim/daylight.js';
import HomePage from './pages/HomePage.jsx';
import AlexaPanel from './ui/AlexaPanel.jsx';
import Dock from './ui/Dock.jsx';
import Landing from './landing/Landing.jsx';

const WhyPage = lazy(() => import('./pages/WhyPage.jsx'));
const ReplayLabPage = lazy(() => import('./pages/ReplayLabPage.jsx'));
const RequirementsPage = lazy(() => import('./pages/RequirementsPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const DevicesPage = lazy(() => import('./pages/DevicesPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

const ICONS = { home: House, why: Sparkles, replay: FlaskConical, requirements: ListChecks, reports: FileText, devices: Cpu, settings: Settings };
const COMPONENTS = { home: HomePage, why: WhyPage, replay: ReplayLabPage, requirements: RequirementsPage, reports: ReportsPage, devices: DevicesPage, settings: SettingsPage };

function useHashRouting(page, navigate) {
  useEffect(() => {
    // initial page comes from the URL when the store is created (main.jsx); afterwards follow back/forward
    const read = () => { const p = (window.location.hash.match(/^#\/([a-z]+)/) || [])[1]; if (p && COMPONENTS[p]) navigate(p); };
    window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const want = `#/${page}`; if (window.location.hash.split('?')[0] !== want) window.history.pushState(null, '', want); document.title = `${PAGES.find((p) => p.id === page)?.label} · SWITCH`; }, [page]);
}

function CommandSearch({ onGo }) {
  const { q } = useApp();
  const [text, setText] = useState(''); const [open, setOpen] = useState(false); const [idx, setIdx] = useState(0);
  const ref = useRef(null);
  const items = useMemo(() => {
    const all = [
      ...PAGES.map((p) => ({ kind: 'Page', label: p.label, go: { page: p.id } })),
      ...ROOM_ORDER.map((r) => ({ kind: 'Room', label: ROOM_INFO[r].name, go: { page: 'home', room: r } })),
      ...Object.keys(DEVICES).map((d) => ({ kind: 'Device', label: DEVICES[d].label, go: { page: 'home', device: d } })),
      ...q.requirements().map((r) => ({ kind: 'Requirement', label: `${r.id} ${r.title}`, go: { page: 'requirements', req: r.id } })),
    ];
    const t = text.trim().toLowerCase(); if (!t) return [];
    return all.filter((i) => i.label.toLowerCase().includes(t)).slice(0, 8);
  }, [text, q]);
  useEffect(() => { const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, []);
  const go = (it) => { onGo(it.go); setText(''); setOpen(false); };
  return <div className="cmd" ref={ref}>
    <Search size={16} aria-hidden />
    <input value={text} placeholder="Search rooms, devices, requirements, pages…" aria-label="Search rooms, devices, requirements and pages" role="combobox" aria-expanded={open && items.length > 0} aria-controls="cmd-list"
      onChange={(e) => { setText(e.target.value); setOpen(true); setIdx(0); }} onFocus={() => setOpen(true)}
      onKeyDown={(e) => { if (e.key === 'ArrowDown') { setIdx((i) => Math.min(items.length - 1, i + 1)); e.preventDefault(); } if (e.key === 'ArrowUp') { setIdx((i) => Math.max(0, i - 1)); e.preventDefault(); } if (e.key === 'Enter' && items[idx]) go(items[idx]); if (e.key === 'Escape') setOpen(false); }} />
    {open && items.length > 0 && <ul className="cmd-list" id="cmd-list" role="listbox">
      {items.map((it, i) => <li key={it.kind + it.label} role="option" aria-selected={i === idx}><button type="button" className={i === idx ? 'active' : ''} onClick={() => go(it)}><em>{it.kind}</em>{it.label}</button></li>)}
    </ul>}
  </div>;
}

/** Which engine produced the workflow data on screen. Never claims more than was verified. */
export function EngineChip({ compact = false }) {
  const { state, actions } = useApp();
  const b = state.backend;
  if (state.mode === 'backend') return <span className="engine-chip on" title={`Requirements, replays, assertions and reports come from the SWITCH backend at ${b.base}. Everything it models is simulated.`} data-testid="engine-chip">
    <Server size={14} aria-hidden /> {compact ? 'Backend' : 'Backend connected'}{b.busy ? <span className="spinner sm" role="status" aria-label="Working" /> : null}</span>;
  if (b.status === 'connecting') return <span className="engine-chip" data-testid="engine-chip"><span className="spinner sm" aria-hidden /> Connecting…</span>;
  if (b.status === 'disabled' || b.preferLocal) return <span className="engine-chip local" title="Workflow results come from the in-browser simulator." data-testid="engine-chip"><ServerOff size={14} aria-hidden /> Local engine</span>;
  return <span className="engine-chip off" data-testid="engine-chip" title={b.error || ''}><ServerOff size={14} aria-hidden /> {compact ? 'Offline' : 'Backend offline · local fallback'}
    <button type="button" className="chip-btn" onClick={() => actions.connectBackend()} aria-label="Retry backend connection"><RefreshCw size={13} /></button></span>;
}

function Notifications({ onGo }) {
  const { q, state } = useApp();
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close); }, []);
  useEffect(() => { const t = () => setOpen((v) => !v); window.addEventListener('switch:toggle-notifications', t); return () => window.removeEventListener('switch:toggle-notifications', t); }, []);
  const risk = q.requirementsAtRisk(); const run = q.latestRun();
  const n = risk.length + (run && run.verdict !== 'PASS' && !run.decision ? 1 : 0);
  void state.rev;
  return <div className="notif" ref={ref}>
    <button type="button" className="icon-btn" aria-label={`Notifications (${n})`} aria-expanded={open} onClick={() => setOpen((v) => !v)}><Bell size={18} />{n > 0 && <i className="dot-count">{n}</i>}</button>
    {open && <div className="popover notif-pop" role="dialog" aria-label="Notifications">
      <div className="pop-head">Verification alerts</div>
      {run ? <button type="button" className="notif-item" onClick={() => { onGo({ page: 'replay' }); setOpen(false); }}><span className={`res res-${run.verdict.toLowerCase()}`}>{run.verdict}</span><span><b>{run.runId}</b> · {run.routine.id}@{run.routine.version}<small>{run.decision ? `Reviewer: ${run.decision.decision}` : 'Awaiting human review'}</small></span></button>
        : <p className="pop-note">No replay has been run in this session yet.</p>}
      {risk.map((r) => <button type="button" key={r.req.id} className="notif-item" onClick={() => { onGo({ page: 'requirements', req: r.req.id }); setOpen(false); }}><AlertTriangle size={15} className={`tone-${r.tone}`} /><span><b>{r.req.id}</b> {r.req.title}<small>{r.why}</small></span></button>)}
      <p className="pop-note subtle">Alerts come from the simulated demo household only.</p>
    </div>}
  </div>;
}

export default function App() {
  const { state, actions } = useApp();
  const now = useLocalClock();
  const [navOpen, setNavOpen] = useState(false);
  const [hhOpen, setHhOpen] = useState(false);
  const [alexaOpen, setAlexaOpen] = useState(false);
  const [landing, setLanding] = useState(() => { const h = window.location.hash; return !/^#\/[a-z]/.test(h) || h.startsWith('#/welcome'); });
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('switch-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('switch-theme', theme); } catch { /* storage is optional */ }
  }, [theme]);
  useEffect(() => {
    // Delegate pointer tracking so cards added by lazy-loaded pages get the same edge glow.
    const move = (event) => {
      const card = event.target.closest?.('.card, .side-status, .device-panel, .report, .stat-card, .viewer');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
      card.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);
  useEffect(() => { const f = (e) => setTheme(e.detail === 'light' ? 'light' : 'dark'); window.addEventListener('switch:set-theme', f); return () => window.removeEventListener('switch:set-theme', f); }, []);
  useHashRouting(state.page, actions.navigate);

  // house simulator clock (simulated seconds per real second = settings.simSpeed)
  useEffect(() => {
    const h = setInterval(() => { if (!document.hidden) actions.tick(0.5 * state.settings.simSpeed); }, 500);
    return () => clearInterval(h);
  }, [state.settings.simSpeed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!state.toast) return undefined; const h = setTimeout(() => actions.clearToast(), 3600); return () => clearTimeout(h); }, [state.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = ({ page, room, device, req }) => {
    if (device) actions.selectDevice(device); else if (room) actions.selectRoom(room);
    actions.navigate(page);
    if (req) setTimeout(() => document.getElementById(`req-${req}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    setNavOpen(false);
  };
  const Page = COMPONENTS[state.page] || HomePage;
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');
  const enterApp = (opts = {}) => { setLanding(false); actions.navigate('home'); window.history.replaceState(null, '', '#/home'); window.scrollTo(0, 0); if (opts.assistant) setTimeout(() => setAlexaOpen(true), 60); else setTimeout(() => document.getElementById('main')?.focus({ preventScroll: true }), 60); };
  if (landing) return <Landing theme={theme} onToggleTheme={toggleTheme} onEnter={() => enterApp()} onTalk={() => enterApp({ assistant: true })} />;

  return <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
    <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <aside className="sidebar" aria-label="Primary">
      <div className="brand"><button type="button" className="brand-mark brand-logo" onClick={() => setLanding(true)} aria-label="Show the SWITCH welcome screen" title="Welcome screen"><img src="/brand/switch-logo-96.png" alt="" width="40" height="40" /></button><div><div className="brand-name">SWITCH</div><div className="brand-sub">Routine verification</div></div>
        <button type="button" className="icon-btn nav-close" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <nav className="nav">
        {PAGES.map((p) => { const I = ICONS[p.id]; const active = state.page === p.id; return <a key={p.id} href={`#/${p.id}`} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); go({ page: p.id }); }} data-testid={`nav-${p.id}`}><I size={18} aria-hidden /><span>{p.label}</span></a>; })}
      </nav>
      <div className="side-status">
        <span className="badge badge-sim">SIMULATED DEMO</span>
        <p>No physical devices, no Amazon / Alexa connection, no live AI. Every device, sensor and result here is modeled.</p>
        <p className="side-engine"><EngineChip compact /> {state.mode === 'backend' ? 'Results: SWITCH deterministic backend.' : 'Results: in-browser simulator.'}</p>
      </div>
    </aside>
    <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />

    <div className="main">
      <header className="topbar">
        <button type="button" className="icon-btn nav-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="household">
          <button type="button" className="household-btn" aria-haspopup="listbox" aria-expanded={hhOpen} onClick={() => setHhOpen((v) => !v)}>
            <House size={16} aria-hidden /><span><b>Casa Verde</b><small>{state.mode === 'backend' ? 'hh_demo · simulated' : 'Demo household'}</small></span><ChevronDown size={15} aria-hidden /></button>
          {hhOpen && <div className="popover hh-pop" role="listbox" aria-label="Household">
            <div role="option" aria-selected className="hh-opt"><Check size={14} /> Casa Verde <small>{state.mode === 'backend' ? 'hh_demo' : 'casa-verde-demo'} · simulated</small></div>
            <div className="hh-opt disabled" aria-disabled>Other households are not available in this demo</div>
          </div>}
        </div>
        <span className="badge badge-sim" title="Nothing on this site controls real devices">SIMULATED DEMO</span>
        <EngineChip />
        <CommandSearch onGo={go} />
        <div className="topbar-right">
          <span className="local-time" title="Your browser's local time">{fmtClock(now)} <small>local</small></span>
          <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} data-testid="theme-toggle">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button type="button" className="btn btn-sm alexa-btn" onClick={() => setAlexaOpen(true)} aria-haspopup="dialog" data-testid="open-alexa" title="Simulated Alexa+ assistant — not connected to Amazon">
            <MessageCircle size={16} aria-hidden /> Assistant <small>simulated</small></button>
          <Notifications onGo={go} />
          <span className="avatar" role="img" aria-label="Signed in as household member (demo)" title="Household member (demo profile)"><CircleUserRound size={22} /></span>
        </div>
      </header>
      <main id="main" className={`page page-${state.page}`} tabIndex={-1}>
        <Suspense fallback={<div className="page-loading" role="status">Loading…</div>}><Page onGo={go} /></Suspense>
      </main>
      <footer className="footer"><span>SWITCH · smart-home routine verification prototype</span><span>A PASS means the selected modeled requirements passed for the recorded scenario and versions. It does not certify the real home.</span></footer>
    </div>
    {alexaOpen && <div className="drawer-wrap" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setAlexaOpen(false); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="alexa-title" onKeyDown={(e) => e.key === 'Escape' && setAlexaOpen(false)}>
        <AlexaPanel onClose={() => setAlexaOpen(false)} onGo={go} />
      </aside></div>}
    <Dock page={state.page} onGo={go} assistantOpen={alexaOpen} onOpenAssistant={() => setAlexaOpen((v) => !v)} theme={theme} onToggleTheme={toggleTheme}
      onSearch={() => { setAlexaOpen(false); const el = document.querySelector('.cmd input'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }}
      onNotifications={() => window.dispatchEvent(new Event('switch:toggle-notifications'))} hidden={state.fullscreen} />
    {state.toast && <div className={`toast toast-${state.toast.tone}`} role="status" aria-live="polite" key={state.toast.id}>{state.toast.message}<button type="button" onClick={actions.clearToast} aria-label="Dismiss"><X size={14} /></button></div>}
  </div>;
}
