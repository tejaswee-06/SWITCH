import React from 'react';
import { AirVent, Coffee, DoorOpen, Fan, Lightbulb, ShieldCheck, Tv, Wind, Minus, Plus, Power } from 'lucide-react';
import { DEVICES, ROOMS, FAN_SPEEDS, FAN_RPM, AC_MODES } from '../sim/engine.js';

const ICON = { light: Lightbulb, fan: Fan, ac: AirVent, tv: Tv, purifier: Wind, coffee: Coffee, security: ShieldCheck, door: DoorOpen };
export function DeviceGlyph({ id, size = 16 }) { const I = ICON[DEVICES[id]?.kind] || Power; return <I size={size} aria-hidden />; }
export const kindLabel = (k) => ({ light: 'Light', fan: 'Ceiling fan', ac: 'Air conditioner', tv: 'Television', purifier: 'Air purifier', coffee: 'Espresso machine', security: 'Security system', door: 'Door' }[k] || k);

/** Icon + text state (never colour alone). */
export function deviceStateText(id, state, short = false) {
  const d = DEVICES[id]; const s = state?.devices?.[id]; if (!d || !s) return 'unknown';
  switch (d.kind) {
    case 'light': return s.on ? 'ON' : 'OFF';
    case 'fan': return s.speed === 'off' ? 'OFF' : short ? s.speed.toUpperCase() : `ON · ${s.speed} (${FAN_RPM[s.speed]} rpm modeled)`;
    case 'ac': { const r = state.rooms[d.room]; if (!s.on) return short ? 'OFF' : `OFF · room ${r.temp.toFixed(1)} °C`; return short ? `${s.mode.toUpperCase()} ${s.target}°` : `${s.mode.toUpperCase()} → ${s.target} °C · room ${r.temp.toFixed(1)} °C · duty ${Math.round((s.duty || 0) * 100)}%`; }
    case 'security': return s.on ? 'ARMED' : 'DISARMED';
    case 'door': return s.open ? 'OPEN' : 'CLOSED';
    default: return s.on ? 'ON' : 'OFF';
  }
}
export const isActive = (id, state) => { const s = state?.devices?.[id]; return !!(s && (s.on || s.open)); };

function Toggle({ on, onChange, label, testId }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} data-testid={testId}>
    <span className="toggle-knob" /><span className="toggle-text">{on ? 'ON' : 'OFF'}</span>
  </button>;
}

/** Controls for one modeled device. All changes go through the app store -> simulator. */
export function DeviceControls({ id, state, actions, compact = false }) {
  const d = DEVICES[id]; const s = state.devices[id]; if (!d || !s) return null;
  const room = state.rooms[d.room];
  if (d.kind === 'fan') return <div className="ctl">
    <div className="seg" role="radiogroup" aria-label={`${d.label} speed`}>
      {FAN_SPEEDS.map((sp) => <button key={sp} type="button" role="radio" aria-checked={s.speed === sp} className={s.speed === sp ? 'on' : ''} onClick={() => actions.setFanSpeed(id, sp)} data-testid={`fan-${id}-${sp}`}>{sp[0].toUpperCase() + sp.slice(1)}</button>)}
    </div>
    {!compact && <p className="ctl-note">Blade speed in the house follows the modeled speed ({FAN_RPM[s.speed]} rpm). {FAN_RPM[s.speed] ? '' : 'Off: blades stopped.'}</p>}
  </div>;
  if (d.kind === 'ac') return <div className="ctl">
    <div className="ctl-row"><Toggle on={s.on} onChange={(v) => actions.setAC(id, { on: v })} label={`${d.label} power`} testId={`ac-${id}-power`} />
      <div className="stepper" aria-label="Target temperature">
        <button type="button" onClick={() => actions.setAC(id, { target: s.target - 1 })} aria-label="Lower target temperature"><Minus size={14} /></button>
        <b data-testid={`ac-${id}-target`}>{s.target} °C</b>
        <button type="button" onClick={() => actions.setAC(id, { target: s.target + 1 })} aria-label="Raise target temperature"><Plus size={14} /></button>
      </div></div>
    {!compact && <>
      <div className="seg" role="radiogroup" aria-label="AC mode">{AC_MODES.map((m) => <button key={m} type="button" role="radio" aria-checked={s.mode === m} className={s.mode === m ? 'on' : ''} onClick={() => actions.setAC(id, { mode: m })}>{m}</button>)}</div>
      <div className="seg" role="radiogroup" aria-label="AC fan">{['low', 'medium', 'high'].map((f) => <button key={f} type="button" role="radio" aria-checked={s.fan === f} className={s.fan === f ? 'on' : ''} onClick={() => actions.setAC(id, { fan: f })}>fan {f}</button>)}</div>
    </>}
    <div className="kv-row">
      <div><span>Modeled room</span><b data-testid={`room-temp-${d.room}`}>{room.temp.toFixed(1)} °C</b></div>
      <div><span>Target</span><b>{s.target} °C</b></div>
      <div><span>Duty</span><b>{Math.round((s.duty || 0) * 100)}%</b></div>
    </div>
    {!compact && <p className="ctl-note">Simulated first-order thermal model — temperatures change gradually. Not a real measurement and no real cooling.</p>}
  </div>;
  if (d.kind === 'door') return <div className="ctl"><div className="seg">
    <button type="button" className={!s.open ? 'on' : ''} aria-pressed={!s.open} onClick={() => actions.setDoor(id, false)}>Closed</button>
    <button type="button" className={s.open ? 'on' : ''} aria-pressed={s.open} onClick={() => actions.setDoor(id, true)}>Open</button></div></div>;
  if (d.kind === 'security') return <div className="ctl"><div className="seg">
    <button type="button" className={s.on ? 'on' : ''} aria-pressed={s.on} onClick={() => actions.setPower(id, true)}>Armed</button>
    <button type="button" className={!s.on ? 'on' : ''} aria-pressed={!s.on} onClick={() => actions.setPower(id, false)}>Disarmed</button></div></div>;
  return <div className="ctl"><Toggle on={s.on} onChange={(v) => actions.setPower(id, v)} label={`${d.label} power`} testId={`toggle-${id}`} /></div>;
}

export function roomDevices(roomId) { return Object.keys(DEVICES).filter((k) => DEVICES[k].room === roomId); }
export const roomName = (id) => ROOMS[id]?.name || id;
