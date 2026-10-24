// SWITCH deterministic home simulator (pure JS, no React / Three.js).
// The simulator owns ALL state transitions and event ordering; the 3D layer only renders it.
// No Math.random(), no Date.now(): simulated time `t` advances only via step(dt).
// All environmental readings are SIMULATED — no real devices are connected.

export const ROOMS = {
  living:   { name: 'Living room', ac: 'ac',         fan: 'fanLiving',   light: 'livingLight' },
  kitchen:  { name: 'Kitchen',     ac: null,         fan: null,          light: 'kitchenLight' },
  bedroom:  { name: 'Bedroom',     ac: 'acBedroom1', fan: 'fanBedroom1', light: 'bedroomLight' },
  bedroom2: { name: 'Bedroom 2',   ac: 'acBedroom2', fan: 'fanBedroom2', light: 'bedroom2Light' },
  bedroom3: { name: 'Bedroom 3',   ac: 'acBedroom3', fan: 'fanBedroom3', light: 'bedroom3Light' },
  bathroom: { name: 'Bathroom',    ac: null,         fan: null,          light: 'bathroomLight' },
  hallway:  { name: 'Hallway',     ac: null,         fan: null,          light: 'hallwayLight' },
  patio:    { name: 'Patio',       ac: null,         fan: null,          light: 'patioLight' },
};

// kind: light | fan | ac | tv | purifier | coffee | security | door.  watts are SIMULATED nominal values.
export const DEVICES = {
  livingLight:   { kind: 'light', room: 'living',   watts: 12, label: 'Living room lights' },
  kitchenLight:  { kind: 'light', room: 'kitchen',  watts: 10, label: 'Kitchen lights' },
  bedroomLight:  { kind: 'light', room: 'bedroom',  watts: 8,  label: 'Bedroom lights' },
  bedroom2Light: { kind: 'light', room: 'bedroom2', watts: 8,  label: 'Bedroom 2 lights' },
  bedroom3Light: { kind: 'light', room: 'bedroom3', watts: 8,  label: 'Bedroom 3 lights' },
  bathroomLight: { kind: 'light', room: 'bathroom', watts: 8,  label: 'Bathroom lights' },
  hallwayLight:  { kind: 'light', room: 'hallway',  watts: 8,  label: 'Hallway lights' },
  patioLight:    { kind: 'light', room: 'patio',    watts: 15, label: 'Patio lights' },
  fanLiving:     { kind: 'fan', room: 'living',   label: 'Living room ceiling fan' },
  fanBedroom1:   { kind: 'fan', room: 'bedroom',  label: 'Bedroom ceiling fan' },
  fanBedroom2:   { kind: 'fan', room: 'bedroom2', label: 'Bedroom 2 ceiling fan' },
  fanBedroom3:   { kind: 'fan', room: 'bedroom3', label: 'Bedroom 3 ceiling fan' },
  ac:            { kind: 'ac', room: 'living',   label: 'Living room AC' },
  acBedroom1:    { kind: 'ac', room: 'bedroom',  label: 'Bedroom AC' },
  acBedroom2:    { kind: 'ac', room: 'bedroom2', label: 'Bedroom 2 AC' },
  acBedroom3:    { kind: 'ac', room: 'bedroom3', label: 'Bedroom 3 AC' },
  tv:        { kind: 'tv',       room: 'living',  watts: 110, standbyWatts: 1, label: 'Television' },
  purifier:  { kind: 'purifier', room: 'living',  watts: 38,  label: 'Air purifier' },
  coffee:    { kind: 'coffee',   room: 'kitchen', watts: 900, label: 'Espresso machine' },
  security:  { kind: 'security', room: 'hallway', watts: 7,   label: 'Security system' },
  doorLiving:   { kind: 'door', room: 'living',   label: 'Living glass door' },
  doorBedroom1: { kind: 'door', room: 'bedroom',  label: 'Bedroom glass door' },
  doorBedroom2: { kind: 'door', room: 'bedroom2', label: 'Bedroom 2 glass door' },
  doorBedroom3: { kind: 'door', room: 'bedroom3', label: 'Bedroom 3 glass door' },
  doorRear:     { kind: 'door', room: 'hallway',  label: 'Rear glass door' },
  doorBathroom: { kind: 'door', room: 'bathroom', label: 'Bathroom door' },
};
// GLB bulbs that follow another device (livingPendant fixture is part of the living-room lighting group).
export const LIGHT_ALIAS = { livingPendant: 'livingLight' };

export const FAN_SPEEDS = ['off', 'low', 'medium', 'high'];
export const FAN_RPM = { off: 0, low: 60, medium: 120, high: 210 };        // visual blade speed
export const FAN_WATTS = { off: 0, low: 15, medium: 30, high: 55 };         // SIMULATED
export const AC_MODES = ['cool', 'heat', 'fan', 'dry', 'auto'];
export const AC_FAN = { low: 0.6, medium: 0.8, high: 1.0 };

// Explicit, documented thermal model parameters (SIMULATED).
export const THERMAL = {
  ambientC: 31,          // outdoor temperature the room leaks toward
  tauEnvS: 1800,         // envelope time constant (s): dT/dt = (ambient - T) / tau
  acMaxRateCPerS: 0.012, // max AC cooling/heating rate at fan "high" (C/s)  (~0.7 C/min)
  acGainPerC: 0.02,      // proportional gain: rate = min(max, gain * |T - target|) (1/s)
  deadbandC: 0.2,        // AC idles once |T - target| < deadband
  acBaseW: 40, acMaxW: 920, // electrical power: base + duty * (max-base)
  humAmbient: 62, humTauS: 2400, dryRatePerS: 0.01,
  stepS: 1,              // fixed integration step (s) => deterministic
  hourlyCap: 4000,
};

// Recorded in every replay report so a result can be reproduced against the same model behaviour.
export const SIM_VERSION = 'switch-sim/2.1.0';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

export function initialRoomTemps() {
  return { living: 23.8, kitchen: 24.6, bedroom: 22.4, bedroom2: 24.0, bedroom3: 24.2, bathroom: 23.1, hallway: 24.5, patio: 29.0 };
}

export function createInitialState(overrides = {}) {
  const devices = {};
  for (const [id, d] of Object.entries(DEVICES)) {
    if (d.kind === 'fan') devices[id] = { on: false, speed: 'off' };
    else if (d.kind === 'ac') devices[id] = { on: false, mode: 'cool', target: 24, fan: 'medium', duty: 0 };
    else if (d.kind === 'door') devices[id] = { open: false };
    else devices[id] = { on: false };
  }
  Object.assign(devices.livingLight, { on: true });
  Object.assign(devices.kitchenLight, { on: true });
  Object.assign(devices.purifier, { on: true });
  Object.assign(devices.security, { on: true });
  Object.assign(devices.ac, { on: true, target: 22 });
  const temps = initialRoomTemps();
  const hum = { living: 46, kitchen: 51, bedroom: 43, bedroom2: 45, bedroom3: 45, bathroom: 57, hallway: 48, patio: 60 };
  const rooms = {};
  for (const id of Object.keys(ROOMS)) {
    rooms[id] = { temp: temps[id], humidity: hum[id], motion: false, occupied: false, co2: 600 };
  }
  return { t: 0, seq: 0, energyWh: 0, mode: 'Home', devices, rooms, ...overrides };
}

/** Deterministic simulator. Construct, dispatch actions, step time, read state/trace. */
export class Sim {
  constructor({ state, routines = [] } = {}) {
    this.state = state || createInitialState();
    this.trace = [];
    this.routines = new Map();
    this.listeners = new Set();
    this.log = [];                // human-readable messages for UI
    routines.forEach((r) => this.routines.set(r.id, r));
    this.automations = [];        // {id, name, trigger:{type:'motion', room}, routineId|steps}
    this._ctx = null;             // current causal context {source, routine, stepIndex}
    this._acc = 0;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify() { this.listeners.forEach((fn) => fn(this)); }

  _emit(kind, data) {
    const ev = { seq: ++this.state.seq, t: round3(this.state.t), kind, ...data, ...(this._ctx ? { source: this._ctx.source, routine: this._ctx.routine ?? null, step: this._ctx.step ?? null } : { source: 'user', routine: null, step: null }) };
    this.trace.push(ev);
    return ev;
  }

  _withCtx(ctx, fn) { const prev = this._ctx; this._ctx = ctx; try { return fn(); } finally { this._ctx = prev; } }

  // ---- primitive transitions -------------------------------------------------------------
  setPower(id, on) {
    const d = DEVICES[id]; const s = this.state.devices[id];
    if (!d || !s) { this._emit('error', { message: `unknown device ${id}` }); return false; }
    if (d.kind === 'door') return this.setDoor(id, on);
    const from = this.isOn(id);
    if (d.kind === 'fan') {
      const speed = on ? (s.speed === 'off' ? 'low' : s.speed) : 'off';
      s.on = on; const fromSpeed = s.speed; s.speed = speed;
      if (from === on && fromSpeed === speed) return false;
      this._emit('device', { device: id, room: d.room, from, to: on, speed });
      return true;
    }
    if (from === on) return false;
    s.on = on;
    this._emit('device', { device: id, room: d.room, from, to: on });
    return true;
  }
  setFanSpeed(id, speed) {
    const d = DEVICES[id]; const s = this.state.devices[id];
    if (!d || d.kind !== 'fan' || !FAN_SPEEDS.includes(speed)) { this._emit('error', { message: `bad fan command ${id}/${speed}` }); return false; }
    const from = s.speed; if (from === speed) return false;
    s.speed = speed; s.on = speed !== 'off';
    this._emit('fan_speed', { device: id, room: d.room, from, to: speed });
    return true;
  }
  setAC(id, patch) {
    const d = DEVICES[id]; const s = this.state.devices[id];
    if (!d || d.kind !== 'ac') { this._emit('error', { message: `bad ac ${id}` }); return false; }
    const changes = {};
    if (patch.on !== undefined && patch.on !== s.on) changes.on = [s.on, patch.on];
    if (patch.mode !== undefined && AC_MODES.includes(patch.mode) && patch.mode !== s.mode) changes.mode = [s.mode, patch.mode];
    if (patch.target !== undefined) { const t = clamp(Math.round(patch.target), 16, 30); if (t !== s.target) changes.target = [s.target, t]; }
    if (patch.fan !== undefined && AC_FAN[patch.fan] && patch.fan !== s.fan) changes.fan = [s.fan, patch.fan];
    const keys = Object.keys(changes); if (!keys.length) return false;
    for (const k of keys) s[k] = changes[k][1];
    if (!s.on) s.duty = 0;
    this._emit('ac', { device: id, room: d.room, changes: Object.fromEntries(keys.map((k) => [k, { from: changes[k][0], to: changes[k][1] }])) });
    return true;
  }
  setDoor(id, open) {
    const d = DEVICES[id]; const s = this.state.devices[id];
    if (!d || d.kind !== 'door') return false;
    if (s.open === open) return false;
    s.open = open; this._emit('door', { device: id, room: d.room, from: !open, to: open });
    return true;
  }
  isOn(id) { const s = this.state.devices[id]; return !!(s && (s.on || s.open)); }

  // ---- sensors -----------------------------------------------------------------------------
  setMotion(room, active) {
    const r = this.state.rooms[room]; if (!r) { this._emit('error', { message: `unknown room ${room}` }); return false; }
    if (r.motion === active) return false;
    r.motion = active; this._emit('motion', { room, from: !active, to: active });
    if (active) this.setOccupancy(room, true, 'motion');
    this._runAutomations('motion', room, active);
    return true;
  }
  setOccupancy(room, occupied, via = 'manual') {
    const r = this.state.rooms[room]; if (!r) return false;
    if (r.occupied === occupied) return false;
    const from = r.occupied ?? null;
    r.occupied = occupied; this._emit('occupancy', { room, from, to: occupied, via });
    return true;
  }
  setSensorValue(room, field, value) {
    const r = this.state.rooms[room]; if (!r || !['temp', 'humidity', 'co2'].includes(field)) return false;
    const from = r[field]; r[field] = value; this._emit('sensor', { room, field, from: round3(from), to: value });
    this._runAutomations('threshold', room, field);
    return true;
  }

  // ---- routines / automations -------------------------------------------------------------------
  registerRoutine(r) { this.routines.set(r.id, r); }
  addAutomation(a) { this.automations.push(a); }
  _runAutomations(type, room, active) {
    for (const a of this.automations) {
      if (a.trigger.type === type && a.trigger.room === room && (a.trigger.active === undefined || a.trigger.active === active)) {
        this.runRoutine(a.routineId, { source: `automation:${a.id}` });
      }
    }
  }
  _guardOk(g) {
    if (!g) return { ok: true };
    const r = this.state.rooms[g.room];
    const v = r ? r.occupied : null;   // null => unknown
    if (v === null || v === undefined) return { ok: false, unknown: true };
    if (g.type === 'unlessOccupied') return { ok: !v };
    if (g.type === 'ifOccupied') return { ok: !!v };
    if (g.type === 'ifOff') return { ok: !this.isOn(g.device) };
    return { ok: false, unknown: true };
  }
  _guardValue(g) {
    if (g.type === 'unlessOccupied' || g.type === 'ifOccupied') { const r = this.state.rooms[g.room]; return r ? (r.occupied ?? null) : null; }
    if (g.type === 'ifOff') return this.isOn(g.device);
    return null;
  }
  runRoutine(id, { source = 'user' } = {}) {
    const r = this.routines.get(id); if (!r) { this._emit('error', { message: `unknown routine ${id}` }); return false; }
    this._withCtx({ source, routine: `${r.id}@${r.version}` }, () => {
      this._emit('routine_start', { routine: `${r.id}@${r.version}` });
      r.steps.forEach((st, i) => {
        this._ctx = { source, routine: `${r.id}@${r.version}`, step: i };
        const g = this._guardOk(st.guard);
        if (st.guard) this._emit('condition', { step: i, guard: st.guard, device: st.device ?? null, value: this._guardValue(st.guard), ok: g.ok, unknown: !!g.unknown });
        if (!g.ok) { this._emit('step_skipped', { step: i, action: st.do, device: st.device ?? null, guard: st.guard, unknown: !!g.unknown }); return; }
        this._applyStep(st);
      });
      this._ctx = { source, routine: `${r.id}@${r.version}` };
      this._emit('routine_end', { routine: `${r.id}@${r.version}` });
    });
    return true;
  }
  _applyStep(st) {
    switch (st.do) {
      case 'power': this.setPower(st.device, st.on); break;
      case 'fan': this.setFanSpeed(st.device, st.speed); break;
      case 'ac': this.setAC(st.device, st.patch); break;
      case 'door': this.setDoor(st.device, st.open); break;
      default: this._emit('error', { message: `unsupported step ${st.do}` });
    }
  }
  /** User/dashboard action dispatcher. Every UI command goes through here so trace == truth. */
  dispatch(action, source = 'user') {
    const out = this._withCtx({ source }, () => {
      switch (action.type) {
        case 'power': return this.setPower(action.id, action.on);
        case 'toggle': return this.setPower(action.id, !this.isOn(action.id));
        case 'fanSpeed': return this.setFanSpeed(action.id, action.speed);
        case 'ac': return this.setAC(action.id, action.patch);
        case 'door': return this.setDoor(action.id, action.open);
        case 'motion': return this.setMotion(action.room, action.active);
        case 'occupancy': return this.setOccupancy(action.room, action.occupied);
        case 'sensor': return this.setSensorValue(action.room, action.field, action.value);
        case 'routine': return this.runRoutine(action.id, { source });
        case 'scene': return this.applyScene(action.name);
        case 'step': this.step(action.dt); return true;
        default: this._emit('error', { message: `unknown action ${action.type}` }); return false;
      }
    });
    this._notify();
    return out;
  }
  applyScene(name) {
    const lights = Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'light');
    this.state.mode = name; this._emit('scene', { name });
    if (name === 'Away') { lights.forEach((l) => this.setPower(l, false)); this.setPower('tv', false); this.setAC('ac', { on: false }); this.setPower('security', true); }
    if (name === 'Relax') { this.setPower('livingLight', true); ['kitchenLight', 'bedroomLight', 'bathroomLight'].forEach((l) => this.setPower(l, false)); this.setPower('tv', true); this.setAC('ac', { on: true }); }
    if (name === 'Home') { this.setPower('livingLight', true); this.setPower('kitchenLight', true); this.setPower('security', true); }
    return true;
  }

  // ---- time / physics -------------------------------------------------------------------------------
  /** Advance simulated time by dt seconds using fixed 1 s sub-steps. */
  step(dt) {
    const h = THERMAL.stepS;
    this._acc += dt;
    while (this._acc >= h - 1e-9) { this._acc -= h; this._substep(h); }
  }
  _substep(h) {
    const st = this.state; st.t += h;
    let watts = this.power().total;
    for (const [rid, room] of Object.entries(ROOMS)) {
      const r = st.rooms[rid];
      let dT = (THERMAL.ambientC - r.temp) / THERMAL.tauEnvS;
      let dH = (THERMAL.humAmbient - r.humidity) / THERMAL.humTauS;
      if (room.ac) {
        const a = st.devices[room.ac];
        if (a.on) {
          const fanF = AC_FAN[a.fan] || 0.8;
          let mode = a.mode;
          if (mode === 'auto') mode = r.temp > a.target ? 'cool' : 'heat';
          const err = r.temp - a.target;
          let duty = 0;
          if (mode === 'cool' && err > THERMAL.deadbandC) { const rate = Math.min(THERMAL.acMaxRateCPerS * fanF, THERMAL.acGainPerC * err); dT -= rate; duty = rate / (THERMAL.acMaxRateCPerS); }
          else if (mode === 'heat' && -err > THERMAL.deadbandC) { const rate = Math.min(THERMAL.acMaxRateCPerS * fanF, THERMAL.acGainPerC * -err); dT += rate; duty = rate / THERMAL.acMaxRateCPerS; }
          else if (mode === 'dry') { dH -= THERMAL.dryRatePerS * fanF; duty = 0.4 * fanF; }
          else if (mode === 'fan') { duty = 0.05; }
          a.duty = round3(clamp(duty, 0, 1));
        } else a.duty = 0;
      }
      r.temp = r.temp + dT * h;
      r.humidity = clamp(r.humidity + dH * h, 20, 90);
    }
    st.energyWh += watts * h / 3600;
  }

  power() {
    const st = this.state; const by = {}; let total = 0;
    for (const [id, d] of Object.entries(DEVICES)) {
      const s = st.devices[id]; let w = 0;
      if (d.kind === 'light' || d.kind === 'purifier' || d.kind === 'coffee' || d.kind === 'security') w = s.on ? d.watts : 0;
      else if (d.kind === 'tv') w = s.on ? d.watts : d.standbyWatts;
      else if (d.kind === 'fan') w = FAN_WATTS[s.speed] || 0;
      else if (d.kind === 'ac') w = s.on ? THERMAL.acBaseW + s.duty * (THERMAL.acMaxW - THERMAL.acBaseW) : 0;
      by[id] = Math.round(w * 10) / 10; total += w;
    }
    return { total: Math.round(total * 10) / 10, by };
  }
  snapshot() { return JSON.parse(JSON.stringify({ state: this.state, power: this.power() })); }
}

/** Stable FNV-1a hash of a trace for replay-determinism checks. */
export function traceHash(trace) {
  const s = JSON.stringify(trace);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
