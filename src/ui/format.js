import { DEVICES, ROOMS } from '../sim/engine.js';
import { describeStep } from '../sim/switch.js';
import { canonLabel } from '../api/canonicalMap.js';

const label = (id) => DEVICES[id]?.label || canonLabel(id);
const room = (id) => ROOMS[id]?.name || id;

/** Human-readable description of one trace event (shared by every timeline in the app). */
export function describeEvent(e) {
  switch (e.kind) {
    case 'device': return e.device === 'security' ? `${label(e.device)} ${e.to ? 'ARMED' : 'DISARMED'}` : `${label(e.device)} ${e.from ? 'ON' : 'OFF'} → ${e.to ? 'ON' : 'OFF'}${e.speed ? ` (${e.speed})` : ''}`;
    case 'fan_speed': return `${label(e.device)} speed ${e.from} → ${e.to}`;
    case 'ac': return `${label(e.device)} ${Object.entries(e.changes).map(([k, v]) => `${k} ${v.from} → ${v.to}`).join(', ')}`;
    case 'door': return `${label(e.device)} ${e.to ? 'OPENED' : 'CLOSED'}`;
    case 'motion': return `Motion ${e.to ? 'detected' : 'cleared'} · ${room(e.room)}`;
    case 'occupancy': return `Occupancy ${room(e.room)}: ${fmtOcc(e.from)} → ${fmtOcc(e.to)} (${e.via})`;
    case 'sensor': return `Sensor ${room(e.room)} ${e.field} ${e.from} → ${e.to}`;
    case 'routine_start': return `Routine started ${e.routine}`;
    case 'routine_end': return `Routine finished ${e.routine}`;
    case 'condition': return `Condition step ${e.step}: ${e.guard.type === 'unlessOccupied' ? `unless ${room(e.guard.room)} occupied` : e.guard.type} → occupancy ${fmtOcc(e.value)} → ${e.unknown ? 'UNKNOWN' : e.ok ? 'run step' : 'skip step'}`;
    case 'step_skipped': return `Step ${e.step} skipped (${label(e.device)}) — ${e.unknown ? 'condition unknown' : 'condition blocked it'}${e.checks?.length ? `: ${e.checks.map((c) => `${c.expr} (actual ${fmtVal(c.actual)})`).join(', ')}` : ''}`;
    case 'scene': return `Scene ${e.name}`;
    case 'error': return `ERROR ${e.message}`;
    // canonical backend trace kinds (src/api/canonicalMap.js)
    case 'scenario_event': return `Scenario event: “${e.name}” fired`;
    case 'clock': return 'Clock tick (time trigger check)';
    case 'lock': return `${label(e.device)} ${e.from ? 'LOCKED' : e.from === false ? 'UNLOCKED' : 'UNKNOWN'} → ${e.to ? 'LOCKED' : 'UNLOCKED'}`;
    case 'action_noop': return `${label(e.device)} already ${String(e.value).toUpperCase()} (no change)`;
    case 'state': return `${label(e.device)} ${e.attr} ${e.from} → ${e.to}`;
    default: return e.kind;
  }
}
const fmtVal = (v) => (v === null || v === undefined ? 'unknown' : String(v));
export const fmtOcc = (v) => (v === true ? 'occupied' : v === false ? 'vacant' : 'unknown');
export const fmtSimT = (t) => { const s = Math.floor(t); return `T+${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const eventTone = (e) => (e.kind === 'error' ? 'fail' : e.kind === 'step_skipped' || e.kind === 'condition' ? 'cond' : e.kind.startsWith('routine') || e.kind === 'scenario_event' || e.kind === 'clock' ? 'routine' : e.kind === 'occupancy' || e.kind === 'motion' ? 'sensor' : 'device');
export { describeStep };
export const resultTone = (r) => ({ PASS: 'pass', FAIL: 'fail', INCONCLUSIVE: 'inconclusive' }[r] || 'neutral');
