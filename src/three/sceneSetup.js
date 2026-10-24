// Prepares the loaded GLB scene for the interactive viewer (browser only, pure three.js):
//  * registry of devices / rooms / cameras / doors (houseRegistry.js)
//  * room-local lighting: every lit material gets a tiny shader patch so a point light only lights
//    fragments inside the zone (room box) that contains the light -> no light leaking through walls
//  * dollhouse cutaway: one shared clipping plane on architectural materials; devices, terrace furniture
//    and the site are exempt (their materials are cloned where shared) so state indicators stay visible
//  * runtime point lights: one per (light device, zone) cluster of fixtures
import * as THREE from 'three';
import { mapDevices, readCameras, readRoomBoxes, buildLightZones, doorNodes, collisionMeshes, roomOfPoint } from './houseRegistry.js';
import { ROOM_INFO, LEVELS } from '../sim/rooms.js';

export const MAX_ZONES = 12;
// Point-light gain (candela per fixture "power" unit). Tuned by screenshots at night and day.
export const LIGHT_GAIN = 20;

const PATCH_FRAG_HEAD = /* glsl */`
varying vec3 vSwWorld;
uniform vec3 uZoneMin[${MAX_ZONES}];
uniform vec3 uZoneMax[${MAX_ZONES}];
uniform int uZoneCount;
uniform mat4 uCamWorld;
float swZoneMask(vec3 lp, vec3 fp) {
  bool found = false;
  for (int k = 0; k < ${MAX_ZONES}; k++) {
    if (k >= uZoneCount) break;
    vec3 mn = uZoneMin[k]; vec3 mx = uZoneMax[k];
    if (all(greaterThanEqual(lp, mn)) && all(lessThanEqual(lp, mx))) {
      found = true;
      if (all(greaterThanEqual(fp, mn - vec3(0.07))) && all(lessThanEqual(fp, mx + vec3(0.07)))) return 1.0;
    }
  }
  return found ? 0.0 : 1.0;
}
`;

function topLevel(o, root) { let p = o; while (p.parent && p.parent !== root) p = p.parent; return p; }
function deviceLevel(o) { let p = o; while (p) { if (p.userData && p.userData.level !== undefined && p.userData.device_id) return p.userData.level; p = p.parent; } return null; }

export function prepareVilla(scene, camera) {
  scene.updateMatrixWorld(true);
  const devices = mapDevices(scene);
  const cameras = readCameras(scene);
  const roomBoxes = readRoomBoxes(scene);
  const zones = buildLightZones(roomBoxes).slice(0, MAX_ZONES);
  const doors = doorNodes(scene);

  // ---- shared uniforms for the zone mask ------------------------------------------------------
  const zoneUniforms = {
    uZoneMin: { value: Array.from({ length: MAX_ZONES }, (_, i) => (zones[i] ? zones[i].box.min.clone() : new THREE.Vector3(1e5, 1e5, 1e5))) },
    uZoneMax: { value: Array.from({ length: MAX_ZONES }, (_, i) => (zones[i] ? zones[i].box.max.clone() : new THREE.Vector3(1e5, 1e5, 1e5))) },
    uZoneCount: { value: zones.length },
    uCamWorld: { value: camera.matrixWorld },
  };
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4); // keeps y <= constant
  const patch = (m) => {
    if (m.userData.swPatched) return;
    m.userData.swPatched = true;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, zoneUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSwWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vSwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PATCH_FRAG_HEAD}`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
          'getPointLightInfo( pointLight, geometryPosition, directLight );',
          'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color *= swZoneMask( (uCamWorld * vec4( pointLight.position, 1.0 )).xyz, vSwWorld );'));
    };
    m.customProgramCacheKey = () => 'sw-zone-v1';
    m.needsUpdate = true;
  };

  // ---- classify meshes: clipped architecture vs exempt (devices, site, terrace) ------------------
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const info = new Map();
  for (const m of meshes) {
    const top = topLevel(m, scene); const n = top.name;
    const isDevice = !!(top.userData && top.userData.device_id) || /^(LIGHT|FAN|AC|DEVICE|DOOR|SENSOR)_/.test(n);
    const group = n.split('__')[0];
    info.set(m, { top, group, isDevice, level: isDevice ? deviceLevel(m) : null, exempt: isDevice || group === 'SITE' || group === 'SITE_STAIRS' || group === 'TERRACE' });
  }
  const usage = new Map();
  for (const m of meshes) { const u = usage.get(m.material) || { ex: 0, cl: 0 }; info.get(m).exempt ? u.ex++ : u.cl++; usage.set(m.material, u); }
  const clones = new Map();
  for (const m of meshes) {
    const mi = info.get(m); const u = usage.get(m.material);
    if (mi.exempt && u.cl > 0) { if (!clones.has(m.material)) { const c = m.material.clone(); c.name = m.material.name; clones.set(m.material, c); } m.material = clones.get(m.material); }
  }
  const clipped = new Set(); const allMats = new Set(); const mats = {};
  for (const m of meshes) {
    const mi = info.get(m); const mat = m.material; allMats.add(mat);
    if (!mi.exempt) clipped.add(mat);
    if (mi.isDevice || !mats[mat.name]) mats[mat.name] = mat;
    m.castShadow = true; m.receiveShadow = true;
    if (mat.name === 'MAT_GLASS') { mat.transparent = true; mat.opacity = Math.min(mat.opacity ?? 0.2, 0.22); mat.depthWrite = false; m.castShadow = false; }
    if (/^MAT_(EMIT|LED)_/.test(mat.name)) { m.castShadow = false; mat.emissive = mat.emissive || new THREE.Color(0); }
  }
  allMats.forEach(patch);
  clipped.forEach((m) => { m.clippingPlanes = [clipPlane]; });

  // ---- runtime point lights: cluster each light device's fixtures by zone --------------------------
  const zoneOf = (p) => zones.findIndex((z) => z.box.containsPoint(p));
  const lightGroups = [];
  for (const [dev, nodes] of Object.entries(devices)) {
    const lightNodes = nodes.filter((n) => n.userData.kind === 'light');
    if (!lightNodes.length) continue;
    const byZone = {};
    for (const n of lightNodes) { const p = new THREE.Vector3(); n.getWorldPosition(p); (byZone[zoneOf(p)] ||= []).push({ p, power: n.userData.power ?? 1, range: n.userData.range ?? 4, color: n.userData.color || '#ffe2b0', name: n.name }); }
    for (const [z, list] of Object.entries(byZone)) {
      const c = new THREE.Vector3(); list.forEach((x) => c.add(x.p)); c.divideScalar(list.length);
      const maxY = Math.max(...list.map((x) => x.p.y)); c.y = Math.min(c.y, maxY - 0.25);
      const total = list.reduce((s, x) => s + x.power, 0);
      if (total <= 0) continue;
      lightGroups.push({ dev, zone: +z, position: c, color: list[0].color, intensity: LIGHT_GAIN * (1.2 + total * 0.9), distance: Math.max(...list.map((x) => x.range)) + 1.5, fixtures: list.map((x) => x.name) });
    }
  }

  // ---- dynamic parts ------------------------------------------------------------------------------------
  const fans = []; const louvers = []; const purifier = []; const doorAnim = []; let tvPos = null; let tvNode = null;
  scene.traverse((o) => {
    const u = o.userData || {};
    if (u.kind === 'fan_blades') fans.push({ node: o, id: u.device_id });
    else if (u.kind === 'ac_louver') louvers.push({ node: o, id: u.device_id, base: o.rotation.x });
    else if (u.kind === 'purifier_fan') purifier.push({ node: o });
    else if (u.kind === 'slider_panel') { const pu = o.parent?.userData; const v = pu?.slide_vec || [0.9, 0, 0]; doorAnim.push({ node: o, id: u.device_id, type: 'slider', base: o.position.clone(), vec: new THREE.Vector3(v[0], v[2] ?? 0, -(v[1] ?? 0)), amt: 0 }); }
    else if (u.kind === 'hinge') doorAnim.push({ node: o, id: u.device_id, type: 'hinge', base: o.rotation.y, open: (u.open_deg || -90) * Math.PI / 180, amt: 0 });
    else if (u.kind === 'tv') { tvNode = o; tvPos = new THREE.Vector3(); o.getWorldPosition(tvPos); }
  });

  // ---- anchors for overlays ------------------------------------------------------------------------------
  const roomCenters = {};
  for (const [rid, list] of Object.entries(roomBoxes)) {
    const main = list[0].box; const c = main.getCenter(new THREE.Vector3());
    roomCenters[rid] = { center: c, box: main, level: ROOM_INFO[rid]?.level ?? list[0].level ?? 0, union: list.reduce((b, x) => b.union(x.box), main.clone()) };
  }
  const markerAnchor = (rid, mode) => {
    const r = roomCenters[rid]; if (!r) return null;
    const lvl = LEVELS[r.level];
    const y = mode === 'cutaway' ? lvl.floorY + 1.1 : r.level === 0 ? 2.25 : rid === 'patio' ? lvl.floorY + 1.3 : lvl.floorY + 1.9;
    return new THREE.Vector3(r.center.x, y, r.center.z);
  };
  const deviceBox = (id) => { const nodes = devices[id]; if (!nodes) return null; const b = new THREE.Box3(); nodes.forEach((n) => b.expandByObject(n)); return b.isEmpty() ? null : b; };
  const deviceAnchor = (id) => { const b = deviceBox(id); return b ? b.getCenter(new THREE.Vector3()) : null; };

  // ---- cutaway ----------------------------------------------------------------------------------------------
  const tops = scene.children;
  const setCutaway = (on, level) => {
    clipPlane.constant = on ? LEVELS[level].cutY : 1e4;
    clipped.forEach((m) => { const side = on ? THREE.DoubleSide : THREE.FrontSide; if (m.side !== side && m.name !== 'MAT_GLASS') { m.side = side; m.needsUpdate = true; } });
    for (const o of tops) {
      let visible = true;
      if (on && level === 0) {
        const n = o.name; const lvl = o.userData?.level;
        if (/^(ROOF|UPPER|TERRACE|FURN_BED3)__/.test(n)) visible = false;
        if (o.userData?.device_id && lvl === 1) visible = false;
        if (/^SENSOR_(BED3|PATIO)/.test(n)) visible = false;
      }
      o.visible = visible;
    }
  };

  return {
    devices, cameras, roomBoxes, zones, doors, mats, fans, louvers, purifier, doorAnim, tvPos, tvNode, lightGroups,
    zoneUniforms, clipPlane, setCutaway, roomCenters, markerAnchor, deviceAnchor, deviceBox,
    collisionMeshes: () => collisionMeshes(scene),
    roomOfPoint: (p) => roomOfPoint(roomBoxes, p),
  };
}
