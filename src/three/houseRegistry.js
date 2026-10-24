// Scene-graph registry for the SWITCH villa GLB. Pure three.js (runs in the browser and in Node tests).
// Everything is found by node name / glTF extras written by blender/build_villa.py — never by mesh index.
import * as THREE from 'three';
import { DEVICES, LIGHT_ALIAS } from '../sim/engine.js';

/** Walks up the parents to find the device extras ({device_id, kind}). */
export function findDeviceData(obj) {
  let o = obj;
  while (o) {
    const u = o.userData;
    if (u && u.device_id && u.kind && !['fan_blades', 'ac_louver', 'purifier_fan', 'slider_panel'].includes(u.kind)) return u;
    o = o.parent;
  }
  return null;
}
export function resolveDeviceId(id) { return LIGHT_ALIAS[id] || id; }

/** deviceId -> array of root nodes that represent it (lights may have several fixtures). */
export function mapDevices(root) {
  const map = {};
  root.traverse((o) => {
    const u = o.userData || {};
    if (!u.device_id || !u.kind) return;
    if (['fan_blades', 'ac_louver', 'purifier_fan', 'slider_panel'].includes(u.kind)) return; // sub-parts
    if (String(u.device_id).includes(':')) return; // sensors (motion:room / env:room)
    const id = resolveDeviceId(u.device_id);
    (map[id] ||= []).push(o);
  });
  return map;
}

/** Eye-level room cameras authored in Blender (CAM_<ROOM> empties). */
export function readCameras(root) {
  const cams = {};
  root.traverse((o) => {
    const u = o.userData || {};
    if (u.kind !== 'camera' || !u.room_id) return;
    const p = new THREE.Vector3(); o.getWorldPosition(p);
    cams[u.room_id] = { pos: p.toArray(), target: u.target, fov: u.fov || 62, floorY: u.floor_y ?? 0, eye: u.eye_height ?? 1.6, node: o.name };
  });
  return cams;
}

/** Room bounding boxes from ROOM_* empties (centre +/- |scale| in world space). A room may have several boxes. */
export function readRoomBoxes(root) {
  const boxes = {};
  root.traverse((o) => {
    const u = o.userData || {};
    if (u.kind !== 'room' || !u.room_id) return;
    const c = new THREE.Vector3(); const s = new THREE.Vector3(); const q = new THREE.Quaternion();
    o.matrixWorld.decompose(c, q, s);
    const h = new THREE.Vector3(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    (boxes[u.room_id] ||= []).push({ name: o.name, level: u.level ?? 0, box: new THREE.Box3(c.clone().sub(h), c.clone().add(h)) });
  });
  return boxes;
}

export function roomOfPoint(boxes, p, margin = 0.02) {
  for (const [rid, list] of Object.entries(boxes)) for (const b of list) if (b.box.clone().expandByScalar(margin).containsPoint(p)) return rid;
  return null;
}

/**
 * Lighting zones: a point light only lights fragments inside the zone that contains it.
 * Stops room lights leaking through walls (no point-light shadows are used for performance).
 * Living + kitchen are one open-plan zone. Upper-floor zones extend to the roof soffit.
 * An extra exterior zone covers the front canopy so the facade lights do not light interiors.
 */
export function buildLightZones(boxes) {
  const zones = [];
  const get = (rid, name) => (boxes[rid] || []).find((b) => !name || b.name === name)?.box?.clone();
  const lk = get('living'); const k = get('kitchen');
  if (lk && k) zones.push({ id: 'living+kitchen', box: lk.union(k) });
  for (const [rid, list] of Object.entries(boxes)) {
    if (rid === 'living' || rid === 'kitchen') continue;
    for (const b of list) {
      const box = b.box.clone();
      if (b.level === 1) box.max.y = Math.max(box.max.y, 7.5);
      if (rid === 'patio') { box.min.x -= 0.15; box.max.x += 0.15; box.max.z += 0.2; }
      zones.push({ id: `${rid}:${b.name}`, box });
    }
  }
  // front canopy / facade exterior (Blender y < -3.75  ->  glTF z > 3.75), below the terrace
  zones.push({ id: 'exterior:front', box: new THREE.Box3(new THREE.Vector3(-8.2, -0.6, 3.76), new THREE.Vector3(8.2, 3.24, 7.5)) });
  return zones;
}

const DYNAMIC_KINDS = new Set(['slider', 'hinge', 'fan', 'fan_blades', 'ac_louver', 'purifier_fan', 'slider_panel']);
/** Meshes that act as static collision geometry (doors, fans and louvers move -> handled separately). */
export function collisionMeshes(root) {
  const out = [];
  const visit = (o, dynamic) => {
    const k = o.userData?.kind;
    const dyn = dynamic || DYNAMIC_KINDS.has(k);
    if (o.isMesh && !dyn) out.push(o);
    o.children.forEach((c) => visit(c, dyn));
  };
  visit(root, false);
  return out;
}

/** Door nodes that block movement while closed: [{id, node}] (slider panel / hinge leaf). */
export function doorNodes(root) {
  const out = [];
  root.traverse((o) => {
    const u = o.userData || {};
    if (u.kind === 'slider_panel' || u.kind === 'hinge') out.push({ id: u.device_id, node: o });
  });
  return out;
}

export function deviceIdsInScene(root) { return Object.keys(mapDevices(root)).filter((id) => DEVICES[id]); }
