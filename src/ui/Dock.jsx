// Floating macOS-style dock: frosted glass, hover magnification, activation bounce, tooltips, active indicators and
// real badges. Every item navigates or triggers a real action. Keyboard: Tab into the dock, ←/→ to move, Enter to activate.
import React, { useRef, useState } from 'react';
import { House, Search, MessageCircle, FlaskConical, Box, ListChecks, FileText, Bell, Settings, Sun, Moon } from 'lucide-react';
import { useApp, useReducedMotion } from '../state/StoreContext.jsx';

export default function Dock({ page, onGo, onOpenAssistant, assistantOpen, onSearch, onNotifications, theme, onToggleTheme, hidden }) {
  const { state, q } = useApp();
  const reduced = useReducedMotion(state.settings);
  const ref = useRef(null); const [mx, setMx] = useState(null); const [bounce, setBounce] = useState(null);
  const risk = q.requirementsAtRisk(); const run = q.latestRun();
  const alerts = risk.length + (run && run.verdict !== 'PASS' && !run.decision ? 1 : 0);
  const drafts = q.drafts?.().length || 0;
  const items = [
    { id: 'home', label: 'Home Overview', icon: House, active: page === 'home' && !assistantOpen, run: () => onGo({ page: 'home' }) },
    { id: 'search', label: 'Search', icon: Search, run: onSearch },
    { id: 'assistant', label: 'SWITCH Assistant (simulated Alexa+)', icon: MessageCircle, active: assistantOpen, run: onOpenAssistant },
    { id: 'routines', label: 'Routines · Replay Lab', icon: FlaskConical, active: page === 'replay', run: () => onGo({ page: 'replay' }) },
    { id: 'house', label: 'House visualization', icon: Box, run: () => { onGo({ page: 'home' }); setTimeout(() => document.querySelector('.viewer')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }), 120); } },
    { id: 'requirements', label: 'Saved Requirements', icon: ListChecks, active: page === 'requirements', badge: drafts || null, badgeLabel: `${drafts} draft${drafts === 1 ? '' : 's'} awaiting confirmation`, run: () => onGo({ page: 'requirements' }) },
    { id: 'reports', label: 'Reports', icon: FileText, active: page === 'reports', run: () => onGo({ page: 'reports' }) },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: alerts || null, badgeLabel: `${alerts} verification alert${alerts === 1 ? '' : 's'}`, run: onNotifications },
    { id: 'theme', label: theme === 'dark' ? 'Light mode' : 'Dark mode', icon: theme === 'dark' ? Sun : Moon, run: onToggleTheme },
    { id: 'settings', label: 'Settings', icon: Settings, active: page === 'settings', run: () => onGo({ page: 'settings' }) },
  ];
  const scaleFor = (i) => {
    if (reduced || mx == null || !ref.current) return 1;
    const el = ref.current.children[i]; if (!el) return 1;
    const r = el.getBoundingClientRect(); const d = Math.abs(mx - (r.left + r.width / 2));
    return 1 + 0.55 * Math.max(0, 1 - d / 150);
  };
  const activate = (it) => { setBounce(it.id); setTimeout(() => setBounce(null), 620); it.run?.(); };
  const onKey = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const btns = [...ref.current.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    btns[n]?.focus(); e.preventDefault();
  };
  return <nav className={`dock-wrap ${hidden ? "is-hidden" : ""} ${assistantOpen ? "with-drawer" : ""}`} aria-label="Quick dock">
    <div className="dock" ref={ref} role="toolbar" aria-label="SWITCH dock" onKeyDown={onKey}
      onPointerMove={(e) => { if (e.pointerType === 'mouse') setMx(e.clientX); }} onPointerLeave={() => setMx(null)} data-testid="dock">
      {items.map((it, i) => { const I = it.icon; const s = scaleFor(i);
        return <div key={it.id} className="dock-li" style={{ '--s': s }}>
          <button type="button" className={`dock-item ${it.active ? 'is-active' : ''} ${bounce === it.id && !reduced ? 'is-bounce' : ''}`} onClick={() => activate(it)}
            aria-label={it.badge ? `${it.label}, ${it.badgeLabel}` : it.label} aria-current={it.active ? 'page' : undefined} data-testid={`dock-${it.id}`}>
            <I size={22} strokeWidth={1.8} aria-hidden />
            {it.badge ? <i className="dock-badge" aria-hidden>{it.badge > 9 ? '9+' : it.badge}</i> : null}
            <span className="dock-tip" aria-hidden>{it.label}</span>
          </button>
          {it.active && <span className="dock-dot" aria-hidden />}
        </div>; })}
    </div>
  </nav>;
}
