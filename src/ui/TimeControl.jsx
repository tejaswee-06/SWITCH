import React, { useEffect, useRef, useState } from 'react';
import { Moon, Sun, Sunrise, Sunset, Clock3 } from 'lucide-react';
import { useLocalClock } from '../state/StoreContext.jsx';
import { fmtClock } from '../sim/daylight.js';
import { todayISO } from '../state/appStore.js';

const PRESETS = [['Dawn', '06:15', Sunrise], ['Noon', '12:00', Sun], ['Sunset', '17:35', Sunset], ['Night', '22:30', Moon]];
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Day/night control: automatic local time (default) or a manual preview time/date. */
export default function TimeControl({ settings, env, envDate, onChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const now = useLocalClock();
  const auto = settings.timeMode !== 'manual';
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const Icon = env.isDark ? Moon : Sun;
  const setManual = (patch) => onChange({ timeMode: 'manual', manualDate: settings.manualDate || todayISO(), ...patch });

  return <div className="time-ctl" ref={ref}>
    <button type="button" className="chip time-chip" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)} data-testid="time-btn"
      aria-label={`Day and night: ${auto ? 'automatic local time' : 'manual'} ${fmtClock(envDate)}, ${env.phase}. Change.`}>
      <Icon size={15} aria-hidden /> <b>{fmtClock(envDate)}</b>{!compact && <span>{env.phase}</span>}<em className={auto ? 'tag-auto' : 'tag-manual'}>{auto ? 'AUTO' : 'MANUAL'}</em>
    </button>
    {open && <div className="popover time-pop" role="dialog" aria-label="Day and night time">
      <div className="pop-head"><Clock3 size={15} /> Day / night in the 3D house</div>
      <div className="seg" role="radiogroup" aria-label="Time source">
        <button type="button" role="radio" aria-checked={auto} className={auto ? 'on' : ''} onClick={() => onChange({ timeMode: 'auto' })} data-testid="time-auto">Automatic (local time)</button>
        <button type="button" role="radio" aria-checked={!auto} className={!auto ? 'on' : ''} onClick={() => setManual({})} data-testid="time-manual">Manual</button>
      </div>
      <p className="pop-note">Your browser's local time is <b>{fmtClock(now)}</b>{auto ? ' — the scene follows it.' : '. The scene is showing a manual preview.'} This only changes lighting; replay results use their own simulated clock.</p>
      <label className="field"><span>Preview time <b>{settings.manualTime}</b></span>
        <input type="range" min={0} max={1439} step={5} value={toMin(settings.manualTime)} onChange={(e) => setManual({ manualTime: fromMin(+e.target.value) })} aria-label="Manual time of day" data-testid="time-slider" />
      </label>
      <div className="row gap-s">
        <label className="field grow"><span>Time</span><input type="time" value={settings.manualTime} onChange={(e) => e.target.value && setManual({ manualTime: e.target.value })} data-testid="time-input" /></label>
        <label className="field grow"><span>Date (season)</span><input type="date" value={settings.manualDate || todayISO()} onChange={(e) => setManual({ manualDate: e.target.value || null })} /></label>
      </div>
      <div className="preset-row">{PRESETS.map(([n, t, I]) => <button key={n} type="button" className="chip" onClick={() => setManual({ manualTime: t })} data-testid={`time-preset-${n.toLowerCase()}`}><I size={14} /> {n}</button>)}</div>
      {!auto && <button type="button" className="btn btn-ghost w-full" onClick={() => onChange({ timeMode: 'auto' })}>Return to automatic local time</button>}
      <p className="pop-note subtle">Sun elevation {env.elevation.toFixed(0)}° · azimuth {env.azimuth.toFixed(0)}° · latitude {settings.latitude}° (Settings)</p>
    </div>}
  </div>;
}
