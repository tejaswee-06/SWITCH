// Room catalogue: stable IDs, numbers, navigation order and display names.
// IDs match the simulator (ROOMS in engine.js) and the ROOM_* / CAM_* nodes in the GLB.
// Every room here was verified to exist in the model (see tests/geometry.test.mjs).

export const ROOM_ORDER = ['living', 'kitchen', 'bedroom', 'bathroom', 'hallway', 'bedroom2', 'bedroom3', 'patio'];

export const ROOM_INFO = {
  living:   { name: 'Living room',     short: 'Living',   level: 0, floorLabel: 'Ground floor', blurb: 'Navy modular sofa, TV wall with fireplace, ring pendant.' },
  kitchen:  { name: 'Kitchen',         short: 'Kitchen',  level: 0, floorLabel: 'Ground floor', blurb: 'Black-marble island with hood light, open to the living room.' },
  bedroom:  { name: 'Bedroom 1',       short: 'Bed 1',    level: 0, floorLabel: 'Ground floor', blurb: 'Wave feature wall, globe pendants either side of the bed.' },
  bathroom: { name: 'Bathroom',        short: 'Bath',     level: 0, floorLabel: 'Ground floor', blurb: 'Marble-clad shower room off the hallway.' },
  hallway:  { name: 'Hallway & stair', short: 'Hallway',  level: 0, floorLabel: 'Ground floor', blurb: 'Rear corridor, security keypad and the stair to the upper floor.' },
  bedroom2: { name: 'Bedroom 2',       short: 'Bed 2',    level: 0, floorLabel: 'Ground floor', blurb: 'Green curtain wall, lounge sofa, globe pendants.' },
  bedroom3: { name: 'Bedroom 3',       short: 'Bed 3',    level: 1, floorLabel: 'Upper floor',  blurb: 'Main suite under the sloped roof, with ensuite.' },
  patio:    { name: 'Rooftop terrace', short: 'Terrace',  level: 1, floorLabel: 'Upper floor',  blurb: 'Glass-railed terrace with umbrella and loungers (outdoor).', outdoor: true },
};

export const ROOM_COUNT = ROOM_ORDER.length;

export function roomNumber(id) { const i = ROOM_ORDER.indexOf(id); return i < 0 ? null : i + 1; }
export function roomByNumber(n) { return ROOM_ORDER[n - 1] ?? null; }
/** Previous/next room with wrap-around at both ends. */
export function stepRoom(id, dir) {
  const i = ROOM_ORDER.indexOf(id);
  if (i < 0) return ROOM_ORDER[0];
  return ROOM_ORDER[(i + (dir < 0 ? -1 : 1) + ROOM_COUNT) % ROOM_COUNT];
}
export function roomPositionLabel(id) {
  const n = roomNumber(id);
  return n ? `${String(n).padStart(2, '0')} / ${String(ROOM_COUNT).padStart(2, '0')}` : `-- / ${String(ROOM_COUNT).padStart(2, '0')}`;
}
export const roomName = (id) => ROOM_INFO[id]?.name ?? id;

// Floor levels (glTF Y-up metres) and the dollhouse cut heights used by the cutaway view.
export const LEVELS = {
  0: { name: 'Ground floor', floorY: 0.03, cutY: 2.72 },
  1: { name: 'Upper floor',  floorY: 3.27, cutY: 5.35 },
};

// Exterior / cutaway orbit presets (glTF metres). Validated in the browser by screenshots.
export const ORBIT_PRESETS = {
  exterior: { pos: [18.5, 10.5, 23.5], target: [-0.2, 2.0, 0.2] },
  cutaway0: { pos: [3.0, 19.0, 15.0], target: [0, 0.6, 0.4] },
  cutaway1: { pos: [-1.0, 19.0, 14.0], target: [0.4, 3.6, 0.6] },
};
