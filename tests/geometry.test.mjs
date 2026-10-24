// Geometry tests against the REAL exported model (public/models/switch_villa.glb), in plain Node.
// Validates: rooms exist in the GLB, device-id -> node mapping, Blender-authored camera presets
// (clearance, eye height, ceiling, line of sight, inside their room), and first-person collision
// (walls, glass, closed/open doors, furniture, stairs to the upper floor) using the runtime walker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { glbToScene } from '../src/three/glbNode.js';
import { readCameras, readRoomBoxes, mapDevices, collisionMeshes, doorNodes, buildLightZones, roomOfPoint } from '../src/three/houseRegistry.js';
import { buildOctree, Walker } from '../src/three/walker.js';
import { ROOM_ORDER, ROOM_INFO, LEVELS } from '../src/sim/rooms.js';
import { DEVICES } from '../src/sim/engine.js';

let pass = 0; const t = (n, f) => { try { f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '\n  ', e.message); process.exitCode = 1; } };
const root = glbToScene(fs.readFileSync(new URL('../public/models/switch_villa.glb', import.meta.url)));
const cams = readCameras(root); const boxes = readRoomBoxes(root); const devs = mapDevices(root);
const meshes = collisionMeshes(root); const rc = new THREE.Raycaster();
const glass = (o) => /glass/i.test(o.name) || o.material?.name === 'MAT_GLASS';
const cast = (p, d, far = 100, skipGlass = false) => { rc.set(p, d.clone().normalize()); rc.far = far; return rc.intersectObjects(meshes, false).filter((h) => !skipGlass || !glass(h.object)); };
const B = (x, y) => new THREE.Vector3(x, 0, -y); // Blender (x,y) -> glTF (x,_,z)

t('every room in the catalogue exists in the GLB (ROOM_* box + CAM_* preset)', () => {
  for (const id of ROOM_ORDER) { assert.ok(boxes[id]?.length, `ROOM box for ${id}`); assert.ok(cams[id], `CAM for ${id}`); }
  assert.deepEqual(Object.keys(cams).sort(), [...ROOM_ORDER].sort(), 'no cameras for rooms that do not exist');
});
t('every simulator device maps to at least one GLB node; no unknown device ids in the GLB', () => {
  for (const id of Object.keys(DEVICES)) assert.ok(devs[id]?.length, `GLB node for ${id}`);
  for (const id of Object.keys(devs)) assert.ok(DEVICES[id], `GLB device ${id} known to the simulator`);
  const lightNodes = Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'light');
  for (const id of lightNodes) for (const n of devs[id]) {
    let emissive = false; n.traverse((o) => { if (o.isMesh && /MAT_EMIT_/.test(o.material?.name)) emissive = true; });
    assert.ok(emissive, `${n.name} has a bulb mesh with an emissive material`);
  }
  for (const id of ['fanLiving', 'fanBedroom1', 'fanBedroom2', 'fanBedroom3']) {
    let blades = null; devs[id][0].traverse((o) => { if (o.userData.kind === 'fan_blades') blades = o; });
    assert.ok(blades, `${id} blade pivot`); assert.ok(blades.children.length >= 5, 'blades are children of the pivot (housing does not spin)');
  }
});
t('each device node sits inside its simulator room', () => {
  const p = new THREE.Vector3();
  const bad = [];
  for (const [id, nodes] of Object.entries(devs)) for (const n of nodes) {
    n.getWorldPosition(p); const room = DEVICES[id].room;
    const inside = (boxes[room] || []).some((b) => b.box.clone().expandByScalar(id.startsWith('door') ? 0.4 : 0.35).containsPoint(p));
    const exterior = room === 'patio'; // patio fixtures include facade lights outside the terrace box
    if (!inside && !exterior) bad.push(`${id}:${n.name}`);
  }
  assert.deepEqual(bad, []);
});
for (const id of ROOM_ORDER) {
  t(`camera preset ${id}: eye height, clearance, ceiling, inside room, line of sight`, () => {
    const c = cams[id]; const p = new THREE.Vector3(...c.pos); const target = new THREE.Vector3(...c.target);
    const floor = cast(p, new THREE.Vector3(0, -1, 0))[0];
    assert.ok(floor, 'floor below'); assert.ok(Math.abs(floor.distance - 1.6) < 0.08, `eye ${floor.distance.toFixed(2)} m above ${floor.object.name}`);
    const levelFloor = LEVELS[ROOM_INFO[id].level].floorY; assert.ok(Math.abs(p.y - 1.6 - levelFloor) < 0.1, 'on the right storey');
    const ceil = cast(p, new THREE.Vector3(0, 1, 0))[0];
    if (!ROOM_INFO[id].outdoor) assert.ok(ceil && ceil.distance > 0.35, 'below the ceiling'); else assert.ok(!ceil || ceil.distance > 2, 'open sky over the terrace');
    let min = Infinity; let what = '';
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      if (!i && !j && !k) continue; const h = cast(p, new THREE.Vector3(i, j, k), 2)[0]; if (h && h.distance < min) { min = h.distance; what = h.object.name; }
    }
    assert.ok(min > 0.3, `clearance ${min.toFixed(2)} m (${what})`);
    assert.equal(roomOfPoint(boxes, p), id, 'camera is inside its own room box');
    const d = target.clone().sub(p); const hit = cast(p, d, d.length(), true)[0];
    assert.ok(!hit || hit.distance > d.length() * 0.6, `line of sight to target blocked at ${hit?.distance.toFixed(2)} by ${hit?.object.name}`);
  });
}
t('light zones: every light fixture lies in exactly one zone (room-local lighting)', () => {
  const zones = buildLightZones(boxes); const p = new THREE.Vector3();
  for (const id of Object.keys(DEVICES).filter((k) => DEVICES[k].kind === 'light')) for (const n of devs[id]) {
    n.getWorldPosition(p); const z = zones.filter((zz) => zz.box.containsPoint(p));
    assert.equal(z.length, 1, `${n.name} in ${z.map((x) => x.id)}`);
  }
});

// ---------------- first-person collision (same Walker the browser uses) ----------------
const oct = buildOctree(meshes);
const doors = doorNodes(root);
const doorState = Object.fromEntries(doors.map((d) => [d.id, false]));
const doorBoxes = () => doors.filter((d) => !doorState[d.id]).map((d) => new THREE.Box3().setFromObject(d.node));
const walker = (room) => { const w = new Walker(oct); w.doorBoxes = doorBoxes; w.teleportEye(new THREE.Vector3(...cams[room].pos)); return w; };
function walkTo(w, bx, by, maxT = 25) {
  const tgt = B(bx, by); let tt = 0;
  while (tt < maxT) { const d = new THREE.Vector3(tgt.x - w.feet.x, 0, tgt.z - w.feet.z); if (d.length() < 0.12) return true; d.normalize().multiplyScalar(1.6); w.update(1 / 30, d); tt += 1 / 30; }
  return false;
}
t('walk: living -> hallway -> stair door -> up the interior stair -> bedroom 3 (room connectivity)', () => {
  const w = walker('living');
  for (const [x, y] of [[-0.5, 1.3], [-0.5, 2.6], [3.0, 2.7], [3.7, 2.7], [5.5, 2.7], [7.0, 2.7], [7.0, 1.4], [5.5, 1.3]]) assert.ok(walkTo(w, x, y), `reached ${x},${y} (stuck at ${w.feet.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(Math.abs(w.feet.y - 3.27) < 0.05, `on the upper floor (feet ${w.feet.y.toFixed(2)})`);
});
t('walk: solid wall blocks (hallway -> rear wall) and the camera stays inside', () => {
  const w = walker('hallway'); assert.equal(walkTo(w, -3.0, 6.0, 4), false);
  assert.ok(-w.feet.z < 3.5 - 0.2, `stopped inside (y=${(-w.feet.z).toFixed(2)})`);
});
t('walk: closed sliding glass door blocks; opening it lets you out onto the front paving', () => {
  // route around the sofa group to the strip along the glass, then try to go out
  const route = [[-2.65, 0.55], [-2.65, -3.1], [-1.85, -3.1]];
  const w = walker('living');
  for (const [x, y] of route) assert.ok(walkTo(w, x, y), `reach ${x},${y} (stuck at ${w.feet.toArray().map((v) => v.toFixed(2))})`);
  assert.equal(walkTo(w, -1.85, -5.5, 6), false, 'closed glass blocks');
  assert.ok(-w.feet.z > -3.55, 'still inside');
  doorState.doorLiving = true;   // the runtime animates the panel; here the open panel simply stops blocking
  const w2 = walker('living');
  for (const [x, y] of route) walkTo(w2, x, y);
  assert.ok(walkTo(w2, -1.85, -5.5), `through the open slider (stuck at ${w2.feet.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(-w2.feet.z < -4.5 && w2.feet.y < 0.05, 'outside on the paving');
  doorState.doorLiving = false;
});
t('walk: furniture blocks (cannot walk through the bed in bedroom 1)', () => {
  const w = walker('bedroom'); assert.equal(walkTo(w, -6.0, -1.9, 6), false);
});
t('walk: doorways between rooms are traversable (living -> bedroom 1, kitchen -> bedroom 2, hallway -> bathroom)', () => {
  const w = walker('living'); assert.ok(walkTo(w, -3.0, 0.55) && walkTo(w, -4.4, 0.55) && walkTo(w, -4.6, -0.6), `bed1: stuck at ${w.feet.toArray().map((v) => v.toFixed(2))}`);
  const k = walker('kitchen'); assert.ok(walkTo(k, 3.0, 0.55) && walkTo(k, 4.2, 0.55) && walkTo(k, 4.9, 0.2), `bed2: stuck at ${k.feet.toArray().map((v) => v.toFixed(2))}`);
  doorState.doorBathroom = true;
  const h = walker('hallway'); assert.ok(walkTo(h, -3.2, 2.75) && walkTo(h, -4.2, 2.75) && walkTo(h, -5.2, 2.4), `bath: stuck at ${h.feet.toArray().map((v) => v.toFixed(2))}`);
  doorState.doorBathroom = false;
  const h2 = walker('hallway'); assert.equal(walkTo(h2, -4.2, 2.75, 5), false, 'closed bathroom door blocks');
});
t('walk: camera never ends above the ceiling or below the floor on a long walk', () => {
  const w = walker('kitchen'); const path = [[1.0, 0.5], [-0.5, 1.4], [-0.5, 2.6], [-3.0, 2.6], [-3.0, 2.6]];
  for (const [x, y] of path) { walkTo(w, x, y, 8); const eye = w.eyePosition(); assert.ok(eye.y > 1.5 && eye.y < 2.95, `eye ${eye.y.toFixed(2)}`); }
});
t('room-tour bounds keep the walker inside the selected room', () => {
  const w = walker('kitchen'); const k = boxes.kitchen[0].box.clone(); k.min.y = -1; k.max.y = 10; w.bounds = k;
  walkTo(w, -2.5, -1.0, 6); assert.ok(w.feet.x > k.min.x - 1e-6, `x ${w.feet.x.toFixed(2)} >= ${k.min.x.toFixed(2)}`);
});

console.log(`\n${pass} passed`);
