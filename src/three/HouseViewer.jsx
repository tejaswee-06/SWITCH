// Interactive 3D villa viewer for SWITCH.
// Modes: exterior orbit, dollhouse cutaway, eye-level room tour, first-person walkthrough.
// The viewer only RENDERS modeled state: `source.state` is either the live simulator or a replay
// snapshot (Replay Lab). Every control calls back into the app store, which dispatches to the simulator.
import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {
  ChevronLeft, ChevronRight, Footprints, Home, Layers, Maximize2, Minimize2, MousePointer2, RotateCcw, Tag, DoorOpen,
} from 'lucide-react';
import { DEVICES, FAN_RPM, ROOMS } from '../sim/engine.js';
import { ROOM_ORDER, ROOM_INFO, roomNumber, roomPositionLabel, ORBIT_PRESETS, LEVELS } from '../sim/rooms.js';
import { prepareVilla } from './sceneSetup.js';
import { findDeviceData, resolveDeviceId } from './houseRegistry.js';
import { buildOctree, Walker } from './walker.js';
import Environment from './Environment.jsx';
import { DeviceGlyph, deviceStateText } from '../ui/deviceUi.jsx';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/switch_villa.glb`;
const FP_MODES = new Set(['room', 'walk']);
const MODE_META = {
  exterior: { label: 'Exterior', icon: Home, hint: 'Drag to orbit · scroll to zoom · click a numbered marker to enter that room' },
  cutaway: { label: 'Cutaway', icon: Layers, hint: 'Dollhouse view: roof and ceilings cut away · drag to orbit · click a number or a device' },
  room: { label: 'Room tour', icon: DoorOpen, hint: 'Drag to look around · W A S D / arrow keys move within the room · click a device to select it' },
  walk: { label: 'Walk', icon: Footprints, hint: 'W A S D to walk · Shift to run · drag (or lock the mouse) to look · walls, glass, doors and furniture block you' },
};

// --------------------------------------------------------------------------------------------------
// Villa: loads the GLB once, prepares registry, animates every device from the modeled state
// --------------------------------------------------------------------------------------------------
function Villa({ source, bridge, reducedMotion, deviceId, highlight, onSelectDevice, onReady, mode, cutLevel }) {
  const gltf = useGLTF(MODEL_URL);
  const { camera } = useThree();
  const reg = useMemo(() => {
    const cached = gltf.scene.userData.__swReg;
    if (cached) { cached.zoneUniforms.uCamWorld.value = camera.matrixWorld; return cached; }
    const r = prepareVilla(gltf.scene, camera); gltf.scene.userData.__swReg = r; return r;
  }, [gltf.scene, camera]);
  const lightRefs = useRef({}); const tvLight = useRef(); const airRefs = useRef({});

  useEffect(() => { bridge.current.reg = reg; onReady?.(reg); }, [reg]); // eslint-disable-line react-hooks/exhaustive-deps

  // collision octree: built once, after first paint (≈1 s of CPU), cached on the scene
  useEffect(() => {
    let cancelled = false;
    const finish = (oct) => {
      if (cancelled) return;
      const w = new Walker(oct);
      w.doorBoxes = () => reg.doorAnim.filter((d) => d.amt < 0.85).map((d) => new THREE.Box3().setFromObject(d.node));
      bridge.current.walker = w; bridge.current.walkerReady = true; bridge.current.onWalkerReady?.();
    };
    if (gltf.scene.userData.__swOctree) { finish(gltf.scene.userData.__swOctree); return undefined; }
    const h = setTimeout(() => { const oct = buildOctree(reg.collisionMeshes()); gltf.scene.userData.__swOctree = oct; finish(oct); }, 400);
    return () => { cancelled = true; clearTimeout(h); };
  }, [reg, gltf.scene, bridge]);

  useEffect(() => { reg.setCutaway(mode === 'cutaway', cutLevel); }, [reg, mode, cutLevel]);
  useEffect(() => () => reg.setCutaway(false, 0), [reg]);

  const selBox = useMemo(() => (deviceId ? reg.deviceBox(deviceId) : null), [reg, deviceId]);
  const hlBox = useMemo(() => (highlight?.device ? reg.deviceBox(highlight.device) : null), [reg, highlight]);

  useFrame((_, rawDt) => {
    const st = source.state; if (!st) return;
    const dt = Math.min(rawDt, 0.1); const wall = performance.now() / 1000;
    const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(wall * 5);
    // lights: point light per (device, zone) + emissive bulbs. Independent per device id.
    for (const g of reg.lightGroups) {
      const on = !!st.devices[g.dev]?.on; const L = lightRefs.current[`${g.dev}:${g.zone}`];
      if (L) L.intensity = THREE.MathUtils.lerp(L.intensity, on ? g.intensity : 0, reducedMotion ? 1 : Math.min(1, dt * 10));
    }
    for (const dev of Object.keys(DEVICES)) {
      if (DEVICES[dev].kind !== 'light') continue;
      const on = !!st.devices[dev]?.on; const hl = highlight?.device === dev;
      for (const name of dev === 'livingLight' ? ['MAT_EMIT_livingLight', 'MAT_EMIT_livingPendant'] : [`MAT_EMIT_${dev}`]) {
        const m = reg.mats[name]; if (!m) continue;
        if (hl) { m.emissive.set('#ff4a3d'); m.emissiveIntensity = 0.8 + 2.4 * pulse; }
        else { m.emissive.set(on ? '#ffd9a0' : '#000000'); m.emissiveIntensity = on ? 3.2 : 0; m.color.set(on ? '#fff3df' : '#8a8a86'); }
      }
    }
    // fans: rotate only the blade pivot, angular velocity from the modeled speed
    for (const f of reg.fans) { const rpm = FAN_RPM[st.devices[f.id]?.speed || 'off'] || 0; f.node.rotation.y -= (rpm * 2 * Math.PI / 60) * dt * (reducedMotion ? 0.3 : 0.6); }
    // AC: louver opens when on, gentle swing while cooling/heating; LED colour by mode; airflow particles
    for (const l of reg.louvers) {
      const s = st.devices[l.id]; const active = s?.on && (s.duty ?? 0) > 0.05;
      const target = s?.on ? 0.55 + (active && !reducedMotion ? 0.12 * Math.sin(wall * 1.4) : 0) : 0;
      l.node.rotation.x = THREE.MathUtils.lerp(l.node.rotation.x, l.base + target, Math.min(1, dt * 4));
      const air = airRefs.current[l.id];
      if (air) { air.visible = !!active; if (active) { air.userData.t = (air.userData.t || 0) + dt * (reducedMotion ? 0.2 : 0.6); air.material.opacity = 0.18 + 0.12 * Math.sin(air.userData.t * 6); air.material.color.set(s.mode === 'heat' ? '#ffb070' : '#8fd8ff'); } }
    }
    for (const id of ['ac', 'acBedroom1', 'acBedroom2', 'acBedroom3']) {
      const s = st.devices[id]; const m = reg.mats[`MAT_LED_${id}`]; if (!m) continue;
      m.emissive.set(!s?.on ? '#000' : s.mode === 'heat' ? '#ffa040' : '#40b8ff'); m.emissiveIntensity = s?.on ? 2.5 : 0;
    }
    // TV: animated screen glow while on (simulated content) + a soft light on the room
    const tv = !!st.devices.tv?.on; const scr = reg.mats.MAT_TV_SCREEN;
    if (scr) { if (tv) { const h = (wall * 0.03) % 1; scr.emissive.setHSL(0.55 + 0.08 * Math.sin(h * Math.PI * 2), 0.6, 0.45); scr.emissiveIntensity = 1.6; } else { scr.emissive.set('#000'); scr.emissiveIntensity = 0; } }
    if (reg.mats.MAT_LED_tv) { reg.mats.MAT_LED_tv.emissive.set(tv ? '#40ff80' : '#ff3030'); reg.mats.MAT_LED_tv.emissiveIntensity = tv ? 2 : 1; }
    if (tvLight.current) tvLight.current.intensity = THREE.MathUtils.lerp(tvLight.current.intensity, tv ? 2.2 : 0, Math.min(1, dt * 8));
    const pur = !!st.devices.purifier?.on;
    if (reg.mats.MAT_LED_purifier) { reg.mats.MAT_LED_purifier.emissive.set(pur ? '#60ffd0' : '#000'); reg.mats.MAT_LED_purifier.emissiveIntensity = pur ? 2.5 : 0; }
    reg.purifier.forEach((p) => { if (pur) p.node.rotation.y += dt * (reducedMotion ? 1.5 : 6); });
    if (reg.mats.MAT_LED_coffee) { reg.mats.MAT_LED_coffee.emissive.set(st.devices.coffee?.on ? '#ff8a30' : '#000'); reg.mats.MAT_LED_coffee.emissiveIntensity = st.devices.coffee?.on ? 3 : 0; }
    if (reg.mats.MAT_LED_security) { reg.mats.MAT_LED_security.emissive.set(st.devices.security?.on ? '#40ff70' : '#ff3030'); reg.mats.MAT_LED_security.emissiveIntensity = 3; }
    for (const r of Object.keys(st.rooms)) { const m = reg.mats[`MAT_LED_motion_${r}`]; if (m) { m.emissive.set(st.rooms[r].motion ? '#ffd24a' : '#000'); m.emissiveIntensity = st.rooms[r].motion ? 3 : 0; } }
    // doors: slide / swing toward the modeled state
    for (const d of reg.doorAnim) {
      const open = st.devices[d.id]?.open ? 1 : 0; d.amt = reducedMotion ? open : THREE.MathUtils.lerp(d.amt, open, Math.min(1, dt * 3));
      if (d.type === 'slider') d.node.position.copy(d.base).addScaledVector(d.vec, d.amt); else d.node.rotation.y = d.base + d.open * d.amt;
    }
  });

  const onPointerMove = (e) => {
    const b = bridge.current; if (b.pointerLocked) return;
    const u = findDeviceData(e.object); const id = u ? resolveDeviceId(u.device_id) : null;
    const hv = b.hoverEl;
    if (hv) {
      if (id && DEVICES[id]) { hv.style.display = 'block'; hv.style.transform = `translate(${e.nativeEvent.offsetX + 14}px, ${e.nativeEvent.offsetY + 14}px)`; hv.textContent = `${DEVICES[id].label} · ${deviceStateText(id, source.state)} — click to select`; b.container && (b.container.style.cursor = 'pointer'); }
      else { hv.style.display = 'none'; b.container && (b.container.style.cursor = ''); }
    }
  };
  const onClick = (e) => {
    if (e.delta > 6 || bridge.current.pointerLocked) return;
    const u = findDeviceData(e.object); if (!u) return;
    const id = resolveDeviceId(u.device_id); if (!DEVICES[id]) return;
    e.stopPropagation(); onSelectDevice?.(id);
  };

  return <>
    <primitive object={gltf.scene} onClick={onClick} onPointerMove={onPointerMove} onPointerOut={() => { const hv = bridge.current.hoverEl; if (hv) hv.style.display = 'none'; }} />
    {reg.lightGroups.map((g) => <pointLight key={`${g.dev}:${g.zone}`} ref={(r) => { lightRefs.current[`${g.dev}:${g.zone}`] = r; }} position={g.position.toArray()} color={g.color} intensity={0} distance={g.distance} decay={2} />)}
    {reg.tvPos && <pointLight ref={tvLight} position={[reg.tvPos.x + 1.0, reg.tvPos.y, reg.tvPos.z]} color="#7fb2ff" intensity={0} distance={4.5} decay={2} />}
    {reg.louvers.map((l) => <AirFlow key={l.id} louver={l} refCb={(m) => { airRefs.current[l.id] = m; }} />)}
    {selBox && <DeviceBox box={selBox} color="#3fd2ff" />}
    {hlBox && <DeviceBox box={hlBox} color="#ff4a3d" pulse={!reducedMotion} />}
    {hlBox && highlight && <FailMarker box={hlBox} highlight={highlight} level={ROOM_INFO[highlight.room]?.level ?? 0} />}
  </>;
}

function AirFlow({ louver, refCb }) {
  // a translucent cone of "air" under the louver, oriented along the unit's facing direction
  const { pos, quat } = useMemo(() => {
    louver.node.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(); const q = new THREE.Quaternion(); louver.node.getWorldPosition(p); louver.node.getWorldQuaternion(q);
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(q); // local +Z(glTF) = out of the wall (Blender -Y)
    const dir = new THREE.Vector3(out.x, -0.9, out.z).normalize();
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    return { pos: p.clone().addScaledVector(dir, 0.55), quat: qq };
  }, [louver]);
  return <mesh ref={refCb} position={pos} quaternion={quat} visible={false} renderOrder={5}>
    <coneGeometry args={[0.42, 1.0, 20, 1, true]} />
    <meshBasicMaterial color="#8fd8ff" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} fog={false} />
  </mesh>;
}

function DeviceBox({ box, color, pulse }) {
  const ref = useRef();
  const { center, size } = useMemo(() => ({ center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).addScalar(0.12) }), [box]);
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useFrame(() => { if (pulse && ref.current) ref.current.material.opacity = 0.45 + 0.5 * Math.abs(Math.sin(performance.now() / 260)); });
  return <lineSegments ref={ref} geometry={geo} position={center} scale={size} renderOrder={10}>
    <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} fog={false} />
  </lineSegments>;
}

function FailMarker({ box, highlight, level }) {
  const c = box.getCenter(new THREE.Vector3());
  const fy = LEVELS[level].floorY + 0.02;
  return <group position={[c.x, fy, c.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}><ringGeometry args={[0.7, 0.86, 48]} /><meshBasicMaterial color="#ff4a3d" transparent opacity={0.7} depthTest={false} fog={false} /></mesh>
    <Html center position={[0, Math.max(0.6, box.max.y - fy + 0.35), 0]} zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
      <span className="world-fail"><b>{highlight.result || 'FAIL'}</b> {highlight.requirement} · {DEVICES[highlight.device]?.label}{highlight.seq != null ? ` · event #${highlight.seq}` : ''}</span>
    </Html>
  </group>;
}

// --------------------------------------------------------------------------------------------------
// Director: orbit modes use CameraControls; room/walk modes use the collision walker
// --------------------------------------------------------------------------------------------------
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function cutawayPreset(reg, roomId, level) {
  const rc = reg?.roomCenters[roomId];
  if (!rc || rc.level !== level) return level === 1 ? ORBIT_PRESETS.cutaway1 : ORBIT_PRESETS.cutaway0;
  const t = rc.center.clone(); t.y = LEVELS[level].floorY + 0.4;
  return { pos: [t.x + 2.6, t.y + 13.5, t.z + 10.5], target: t.toArray() };
}

function Director({ mode, roomId, cutLevel, bridge, reducedMotion, onWalkRoom, reg, resetKey }) {
  const { camera, gl } = useThree();
  const controls = useRef();
  const fp = useRef({ yaw: 0, pitch: 0, anim: null, lastMode: null, lastRoom: null });
  const orbit = !FP_MODES.has(mode);

  // ----- orbit presets -----
  useEffect(() => {
    if (!orbit || !controls.current) return;
    const c = controls.current; const f = fp.current;
    if (f.lastMode && FP_MODES.has(f.lastMode)) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      c.setLookAt(camera.position.x, camera.position.y, camera.position.z, camera.position.x + fwd.x * 4, camera.position.y + fwd.y * 4, camera.position.z + fwd.z * 4, false);
    }
    const p = mode === 'exterior' ? ORBIT_PRESETS.exterior : cutawayPreset(reg, roomId, cutLevel);
    c.setLookAt(...p.pos, ...p.target, !reducedMotion);
    f.lastMode = mode; f.lastRoom = roomId;
  }, [orbit, mode, roomId, cutLevel, reg, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- first-person: start a transition to the room preset -----
  useEffect(() => {
    if (orbit || !reg) return;
    const f = fp.current; const b = bridge.current;
    const prevMode = f.lastMode; f.lastMode = mode;
    if (!b.forceTeleport && b.walkRoomEcho === roomId && mode === 'walk' && prevMode === 'walk') { f.lastRoom = roomId; return; } // walked into it
    if (mode === 'walk' && prevMode === 'room' && f.lastRoom === roomId && !b.forceTeleport) { // stay, just unlock bounds
      if (b.walker) b.walker.bounds = null; return;
    }
    b.forceTeleport = false;
    const preset = reg.cameras[roomId]; if (!preset) return;
    const to = new THREE.Vector3(...preset.pos); const look = new THREE.Vector3(...preset.target);
    const dir = look.clone().sub(to).normalize();
    const yaw = Math.atan2(-dir.x, -dir.z); const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const dist = camera.position.distanceTo(to);
    f.anim = { from: camera.position.clone(), fromQ: camera.quaternion.clone(), to, toQ, fromFov: camera.fov, toFov: preset.fov, t: 0, start: performance.now(), dur: reducedMotion ? 0 : Math.min(1.6, 0.6 + dist * 0.05), far: dist > 2.5 };
    f.yaw = yaw; f.pitch = pitch; f.lastRoom = roomId;
    b.walkRoomEcho = roomId;
  }, [orbit, mode, roomId, reg, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- look input (drag or pointer lock) -----
  useEffect(() => {
    const el = gl.domElement; const b = bridge.current; let down = null;
    b.canvasEl = el;
    const onDown = (e) => { if (!FP_MODES.has(b.mode)) return; down = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); };
    const onMove = (e) => {
      if (!FP_MODES.has(b.mode)) return;
      const f = fp.current; let dx = 0, dy = 0;
      if (document.pointerLockElement === el) { dx = e.movementX; dy = e.movementY; }
      else if (down) { dx = e.clientX - down.x; dy = e.clientY - down.y; down = { x: e.clientX, y: e.clientY }; }
      else return;
      if (f.anim) return;
      f.yaw -= dx * 0.0042; f.pitch = THREE.MathUtils.clamp(f.pitch - dy * 0.0042, -1.25, 1.25);
    };
    const onUp = () => { down = null; };
    const onLock = () => { b.pointerLocked = document.pointerLockElement === el; b.onLockChange?.(b.pointerLocked); };
    el.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
    document.addEventListener('pointerlockchange', onLock);
    b.requestLock = () => el.requestPointerLock?.();
    return () => { el.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); document.removeEventListener('pointerlockchange', onLock); };
  }, [gl, bridge]);

  useFrame((_, rawDt) => {
    const b = bridge.current; b.mode = mode; const f = fp.current;
    const dt = Math.min(rawDt, 0.05);
    if (orbit) {
      const fov = mode === 'exterior' ? 40 : 45;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
      if (b.fadeEl) b.fadeEl.style.opacity = '0';
      return;
    }
    if (f.anim) {
      const a = f.anim; a.t = a.dur ? Math.min(1, (performance.now() - a.start) / 1000 / a.dur) : 1; const k = ease(a.t);
      camera.position.lerpVectors(a.from, a.to, k); camera.quaternion.slerpQuaternions(a.fromQ, a.toQ, k);
      camera.fov = a.fromFov + (a.toFov - a.fromFov) * k; camera.updateProjectionMatrix();
      if (b.fadeEl) b.fadeEl.style.opacity = a.far ? String(Math.sin(Math.PI * a.t) * 0.6) : '0';
      if (a.t >= 1) {
        f.anim = null;
        if (b.walker) {
          b.walker.teleportEye(a.to);
          b.walker.bounds = mode === 'room' && reg?.roomCenters[b.roomId] ? (() => { const u = reg.roomCenters[b.roomId].union.clone(); u.min.y = -50; u.max.y = 50; return u; })() : null;
        }
      }
      return;
    }
    // movement
    const inp = b.input; const w = b.walker;
    const fwd = (inp.f ? 1 : 0) - (inp.b ? 1 : 0); const strafe = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    const turn = (inp.tl ? 1 : 0) - (inp.tr ? 1 : 0);
    if (turn) f.yaw += turn * dt * 1.6;
    if (w && b.walkerReady) {
      if (mode === 'room' && !w.bounds && reg?.roomCenters[b.roomId]) { const u = reg.roomCenters[b.roomId].union.clone(); u.min.y = -50; u.max.y = 50; w.bounds = u; }
      if (mode === 'walk') w.bounds = null;
      const sp = inp.run ? w.o.runSpeed : w.o.speed;
      const v = new THREE.Vector3(-Math.sin(f.yaw) * fwd + Math.cos(f.yaw) * strafe, 0, -Math.cos(f.yaw) * fwd - Math.sin(f.yaw) * strafe);
      if (v.lengthSq() > 0) v.normalize().multiplyScalar(sp);
      if (fwd || strafe || !w.onFloor) w.update(dt, v);
      w.eyePosition(camera.position);
      if (mode === 'walk') {
        const r = reg?.roomOfPoint(camera.position);
        if (r && r !== b.roomId) { b.walkRoomEcho = r; onWalkRoom?.(r); }
      }
    }
    camera.quaternion.setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
    if (b.fadeEl) b.fadeEl.style.opacity = '0';
  });

  return orbit ? <CameraControls ref={controls} makeDefault smoothTime={reducedMotion ? 0 : 0.7} minDistance={2.5} maxDistance={60}
    maxPolarAngle={mode === 'cutaway' ? Math.PI * 0.42 : Math.PI * 0.485} dollySpeed={0.6} /> : null;
}

// --------------------------------------------------------------------------------------------------
// Projector: places DOM markers/tags over the canvas every frame (keeps them attached while orbiting)
// --------------------------------------------------------------------------------------------------
function Projector({ bridge, mode, cutLevel, roomId, tagIds }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const b = bridge.current; const reg = b.reg; if (!reg) return;
    const placed = [];
    const showMarkers = !FP_MODES.has(mode);
    // markers sorted near-to-far so nearer ones keep their spot; overlapping ones are nudged apart
    const items = ROOM_ORDER.map((rid) => {
      const el = b.markers[rid]; if (!el) return null;
      const a = reg.markerAnchor(rid, mode); if (!a || !showMarkers) { el.style.display = 'none'; return null; }
      v.copy(a).project(camera);
      if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return null; }
      return { rid, el, x: (v.x + 1) / 2 * size.width, y: (1 - v.y) / 2 * size.height, z: v.z };
    }).filter(Boolean).sort((a, z) => a.z - z.z);
    for (const it of items) {
      let { x, y } = it; let guard = 0;
      while (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 40) && guard++ < 12) { const ang = guard * 2.4; x = it.x + Math.cos(ang) * 22 * Math.ceil(guard / 3); y = it.y + Math.sin(ang) * 22 * Math.ceil(guard / 3); }
      placed.push({ x, y });
      x = Math.max(18, Math.min(size.width - 18, x)); y = Math.max(18, Math.min(size.height - 60, y));
      it.el.style.display = '';
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      const lvl = ROOM_INFO[it.rid].level;
      it.el.style.opacity = mode === 'cutaway' && lvl !== cutLevel ? '0.4' : '1';
    }
    // device tags for the current room (stacked when they would overlap)
    const tagPlaced = [];
    for (const id of Object.keys(b.tags)) {
      const el = b.tags[id]; if (!el) continue;
      if (!tagIds.includes(id)) { el.style.display = 'none'; continue; }
      const a = reg.deviceAnchor(id); if (!a) { el.style.display = 'none'; continue; }
      v.copy(a).project(camera);
      const inView = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!inView) { el.style.display = 'none'; continue; }
      if (FP_MODES.has(mode) && camera.position.distanceTo(a) > 9) { el.style.display = 'none'; continue; }
      let x = Math.max(70, Math.min(size.width - 70, (v.x + 1) / 2 * size.width)); let y = Math.max(96, Math.min(size.height - 90, (1 - v.y) / 2 * size.height)); let guard = 0;
      while (tagPlaced.some((p) => Math.abs(p.x - x) < 120 && Math.abs(p.y - y) < 30) && guard++ < 8) y += 32;
      tagPlaced.push({ x, y });
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -120%)`;
    }
    void roomId;
  });
  return null;
}

// Test/debug hook (dev server or ?debug): exposes the live camera, scene and walker for automated checks.
function DebugHook({ bridge, id }) {
  const three = useThree();
  useEffect(() => {
    const on = import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
    if (!on) return undefined;
    const api = { get camera() { return three.camera; }, get scene() { return three.scene; }, get gl() { return three.gl; }, get controls() { return three.get().controls; }, bridge: bridge.current, THREE };
    window.__switchViewers = { ...(window.__switchViewers || {}), [id]: api };
    return () => { if (window.__switchViewers) delete window.__switchViewers[id]; };
  }, [three, bridge, id]);
  return null;
}

class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? this.props.fallback(this.state.err) : this.props.children; }
}

function Loading() { return <Html center><div className="viewer-loading" role="status"><span className="spinner" aria-hidden />Loading the local villa model…</div></Html>; }

// --------------------------------------------------------------------------------------------------
// Public component
// --------------------------------------------------------------------------------------------------
export default function HouseViewer({
  source, rev, mode, roomId, deviceId, cutLevel, highlight, env, settings, reducedMotion,
  onSetMode, onSelectRoom, onStepRoom, onSelectDevice, onSetCutLevel, onFullscreenChange,
  timeSlot, compact = false, title, badge = 'SIMULATED DEMO', showLabels = true, className = '',
}) {
  const container = useRef(null);
  const bridge = useRef({ markers: {}, tags: {}, input: {}, reg: null, walker: null, walkerReady: false, roomId, mode });
  bridge.current.roomId = roomId; bridge.current.mode = mode;
  const [ready, setReady] = useState(false);
  const [walkerReady, setWalkerReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  bridge.current.onWalkerReady = () => setWalkerReady(true);
  bridge.current.onLockChange = (v) => setLocked(v);

  // ----- fullscreen (Fullscreen API on the viewer container) -----
  useEffect(() => {
    const onChange = () => { const fs = document.fullscreenElement === container.current; setIsFs(fs); onFullscreenChange?.(fs); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onFullscreenChange]);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current?.requestFullscreen?.();
    } catch { /* fullscreen not allowed (iframe/permissions) */ }
  }, []);

  // ----- keyboard -----
  useEffect(() => {
    const el = container.current; if (!el) return undefined;
    const map = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', ShiftLeft: 'run', ShiftRight: 'run', KeyQ: 'tl', KeyE: 'tr' };
    const down = (e) => {
      if (e.target.closest('input,select,textarea')) return;
      const k = map[e.code];
      if (k && FP_MODES.has(bridge.current.mode)) { bridge.current.input[k] = true; e.preventDefault(); return; }
      if (e.code === 'BracketRight' || e.code === 'PageDown') { onStepRoom?.(+1); e.preventDefault(); }
      if (e.code === 'BracketLeft' || e.code === 'PageUp') { onStepRoom?.(-1); e.preventDefault(); }
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) { toggleFullscreen(); e.preventDefault(); }
    };
    const up = (e) => { const k = map[e.code]; if (k) bridge.current.input[k] = false; };
    const blur = () => { bridge.current.input = {}; };
    el.addEventListener('keydown', down); el.addEventListener('keyup', up); el.addEventListener('focusout', blur);
    return () => { el.removeEventListener('keydown', down); el.removeEventListener('keyup', up); el.removeEventListener('focusout', blur); };
  }, [onStepRoom, toggleFullscreen]);

  // Render continuously only while the viewer is on screen and the tab is visible; otherwise keep the last frame
  // (frameloop "demand"). Saves CPU/GPU on long pages such as Replay Lab, where the house sits below the fold.
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const el = container.current;
    const vis = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', vis);
    let io = null;
    if (el && typeof IntersectionObserver !== 'undefined') { io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)), { threshold: 0 }); io.observe(el); }
    return () => { document.removeEventListener('visibilitychange', vis); io?.disconnect(); };
  }, []);
  const frameloop = onScreen && tabVisible ? 'always' : 'demand';

  const roomDevices = useMemo(() => Object.keys(DEVICES).filter((id) => DEVICES[id].room === roomId), [roomId]);
  const tagIds = useMemo(() => (showLabels && (FP_MODES.has(mode) || mode === 'cutaway') ? roomDevices : []), [showLabels, mode, roomDevices]);
  const st = source.state;
  const dpr = settings?.quality === 'high' ? [1, 2] : settings?.quality === 'low' ? [0.75, 1] : [1, 1.5];
  const hold = (k, v) => () => { bridge.current.input[k] = v; };
  // overlays (markers, tags) sit above the canvas: pass wheel-zoom through so zooming never stalls on a marker
  const forwardWheel = (e) => { const c = bridge.current.canvasEl; if (!c) return; c.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true })); };
  const Meta = MODE_META[mode];
  void rev;

  return <div ref={container} className={`viewer ${compact ? 'viewer-compact' : ''} ${className}`} tabIndex={0}
    aria-label={`${title || '3D house'} — ${Meta.label} view, ${ROOMS[roomId]?.name}. Use [ and ] to change room, F for fullscreen.`} data-mode={mode} data-room={roomId}>
    <Boundary fallback={(e) => <div className="model-error" role="alert"><b>The local 3D model could not be loaded.</b><span>{String(e?.message || e)}</span><span>Expected file: {MODEL_URL}</span></div>}>
      <Canvas shadows dpr={dpr} frameloop={frameloop} camera={{ position: ORBIT_PRESETS.exterior.pos, fov: 40, near: 0.05, far: 420 }}
        gl={{ antialias: settings?.quality !== 'low', localClippingEnabled: true, preserveDrawingBuffer: false }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
        <Environment env={env} quality={settings?.quality} reducedMotion={reducedMotion} />
        <Suspense fallback={<Loading />}>
          <Villa source={source} bridge={bridge} reducedMotion={reducedMotion} deviceId={deviceId} highlight={highlight} mode={mode} cutLevel={cutLevel}
            onSelectDevice={onSelectDevice} onReady={() => setReady(true)} />
        </Suspense>
        <Director mode={mode} roomId={roomId} cutLevel={cutLevel} bridge={bridge} reducedMotion={reducedMotion} reg={ready ? bridge.current.reg : null} resetKey={resetKey}
          onWalkRoom={(r) => onSelectRoom?.(r, { fromWalk: true })} />
        <Projector bridge={bridge} mode={mode} cutLevel={cutLevel} roomId={roomId} tagIds={tagIds} />
        <DebugHook bridge={bridge} id={compact ? 'compact' : 'main'} />
      </Canvas>
    </Boundary>

    <div className="viewer-fade" ref={(el) => { bridge.current.fadeEl = el; }} aria-hidden />
    <div className="viewer-hover" ref={(el) => { bridge.current.hoverEl = el; }} aria-hidden />
    {ready && <div className="viewer-ready" data-testid="viewer-ready" hidden />}
    {walkerReady && <div data-testid="walker-ready" hidden />}

    {/* numbered room markers */}
    <div className="marker-layer" onWheel={forwardWheel}>
      {ROOM_ORDER.map((rid) => {
        const n = roomNumber(rid); const on = Object.keys(DEVICES).filter((d) => DEVICES[d].room === rid && DEVICES[d].kind === 'light' && st.devices[d]?.on).length;
        const fail = highlight?.room === rid;
        return <button key={rid} ref={(el) => { bridge.current.markers[rid] = el; }} type="button"
          className={`room-marker ${roomId === rid ? 'is-current' : ''} ${fail ? 'is-fail' : ''}`} style={{ display: 'none' }}
          onClick={() => onSelectRoom?.(rid, { tour: mode !== 'cutaway' })} aria-label={`Room ${n}: ${ROOM_INFO[rid].name}${on ? ', light on' : ''}${fail ? ', failed assertion here' : ''}. Open ${mode === 'cutaway' ? 'from above' : 'room tour'}.`}
          data-testid={`marker-${rid}`}>
          <span className="room-marker-num">{n}</span>
          <span className="room-marker-name">{ROOM_INFO[rid].name}{on ? ' · light on' : ''}</span>
        </button>;
      })}
    </div>
    {/* device tags for the selected room */}
    <div className="tag-layer" onWheel={forwardWheel}>
      {roomDevices.map((id) => <button key={id} ref={(el) => { bridge.current.tags[id] = el; }} type="button" style={{ display: 'none' }}
        className={`device-tag ${deviceId === id ? 'is-selected' : ''} ${highlight?.device === id ? 'is-fail' : ''} ${isOnLike(id, st) ? 'is-on' : ''}`}
        onClick={() => onSelectDevice?.(id)} aria-label={`${DEVICES[id].label}: ${deviceStateText(id, st)}. Select.`}>
        <DeviceGlyph id={id} size={13} /> <span>{shortLabel(id)}</span> <em>{deviceStateText(id, st, true)}</em>
      </button>)}
    </div>

    {/* top toolbar */}
    <div className="viewer-top">
      <div className="seg seg-modes" role="radiogroup" aria-label="House view mode">
        {Object.entries(MODE_META).map(([m, meta]) => { const I = meta.icon; return <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => { if (m === 'walk' || m === 'room') bridge.current.forceTeleport = mode !== 'room' && mode !== 'walk'; onSetMode?.(m); }} data-testid={`mode-${m}`}><I size={15} aria-hidden /><span>{meta.label}</span></button>; })}
      </div>
      {mode === 'cutaway' && <div className="seg" role="radiogroup" aria-label="Cutaway storey">
        {[0, 1].map((l) => <button key={l} type="button" role="radio" aria-checked={cutLevel === l} className={cutLevel === l ? 'on' : ''} onClick={() => onSetCutLevel?.(l)}>{LEVELS[l].name}</button>)}
      </div>}
      <div className="viewer-top-right">
        {timeSlot}
        <button type="button" className="icon-btn" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset camera to this view's preset" title="Reset view"><RotateCcw size={16} /></button>
        <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label={isFs ? 'Exit fullscreen' : 'Enter fullscreen'} title={isFs ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'} data-testid="fullscreen-btn">{isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </div>

    {/* walk-mode helpers */}
    {FP_MODES.has(mode) && <>
      {mode === 'walk' && <div className="crosshair" aria-hidden />}
      <div className="fp-pad" aria-label="Movement controls">
        <button type="button" aria-label="Turn left" onPointerDown={hold('tl', true)} onPointerUp={hold('tl', false)} onPointerLeave={hold('tl', false)}>⟲</button>
        <button type="button" aria-label="Move forward" onPointerDown={hold('f', true)} onPointerUp={hold('f', false)} onPointerLeave={hold('f', false)}>▲</button>
        <button type="button" aria-label="Turn right" onPointerDown={hold('tr', true)} onPointerUp={hold('tr', false)} onPointerLeave={hold('tr', false)}>⟳</button>
        <button type="button" aria-label="Step left" onPointerDown={hold('l', true)} onPointerUp={hold('l', false)} onPointerLeave={hold('l', false)}>◀</button>
        <button type="button" aria-label="Move back" onPointerDown={hold('b', true)} onPointerUp={hold('b', false)} onPointerLeave={hold('b', false)}>▼</button>
        <button type="button" aria-label="Step right" onPointerDown={hold('r', true)} onPointerUp={hold('r', false)} onPointerLeave={hold('r', false)}>▶</button>
      </div>
      <div className="fp-actions">
        {mode === 'walk' && <button type="button" className="chip" onClick={() => bridge.current.requestLock?.()} disabled={locked}><MousePointer2 size={14} /> {locked ? 'Mouse locked — Esc to release' : 'Lock mouse to look'}</button>}
        <button type="button" className="chip" onClick={() => { bridge.current.forceTeleport = true; setResetKey((k) => k + 1); }}>Back to safe room view</button>
        <button type="button" className="chip" onClick={() => onSetMode?.('exterior')}><Home size={14} /> Exterior</button>
        {!walkerReady && <span className="chip chip-muted" role="status">Preparing collision…</span>}
      </div>
    </>}

    {/* bottom room navigation */}
    <nav className="room-nav" aria-label="Room navigation">
      <button type="button" className="icon-btn" onClick={() => onStepRoom?.(-1)} aria-label="Previous room" data-testid="room-prev"><ChevronLeft size={20} /></button>
      <div className="room-nav-mid">
        <label className="sr-only" htmlFor={`room-select-${compact ? 'c' : 'm'}`}>Choose room</label>
        <select id={`room-select-${compact ? 'c' : 'm'}`} value={roomId} onChange={(e) => onSelectRoom?.(e.target.value, { tour: mode === 'exterior' })} data-testid="room-select">
          {ROOM_ORDER.map((rid) => <option key={rid} value={rid}>{roomNumber(rid)}. {ROOM_INFO[rid].name}</option>)}
        </select>
        <span className="room-nav-pos" data-testid="room-pos">{roomPositionLabel(roomId)}</span>
      </div>
      <button type="button" className="icon-btn" onClick={() => onStepRoom?.(+1)} aria-label="Next room" data-testid="room-next"><ChevronRight size={20} /></button>
    </nav>

    <div className="viewer-foot">
      <span className="badge badge-sim">{badge}</span>
      <span className="viewer-hint">{Meta.hint}</span>
      {showLabels !== undefined && null}
    </div>
    <div className="viewer-legend" aria-label="Legend"><span><i className="lg-on" /> on</span><span><i className="lg-off" /> off</span><span><i className="lg-sel" /> selected</span><span><i className="lg-fail" /> failed assertion</span><span><Tag size={11} /> modeled, not live</span></div>
  </div>;
}

function isOnLike(id, st) { const s = st.devices[id]; return !!(s && (s.on || s.open)); }
function shortLabel(id) { return DEVICES[id].label.replace(/^(Living room|Bedroom \d|Bedroom|Bathroom|Hallway|Kitchen|Patio)\s*/i, '').replace(/^./, (c) => c.toUpperCase()) || DEVICES[id].label; }

useGLTF.preload(MODEL_URL);
