// Local 3D digital twin: loads public/models/switch_villa.glb and binds it to the SWITCH simulator.
// The simulator (src/sim/engine.js) owns state; this file only RENDERS it:
//   - one runtime THREE.PointLight per light device (+ emissive bulb materials)
//   - ceiling-fan blades (pivot nodes) rotate at a speed from the sim state
//   - AC louvers / LEDs, TV screen, purifier vanes, coffee + security LEDs, motion LEDs, doors
// Bindings use GLB node names / userData (device_id, kind) written by blender/build_villa.py — not mesh indices.
import React, { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FAN_RPM, LIGHT_ALIAS, DEVICES } from './sim/engine.js';

export const MODEL_URL = `${import.meta.env.BASE_URL}models/switch_villa.glb`;

// Tunables (documented in README). LIGHT_GAIN scales every room light; AMBIENT presets keep ON/OFF clearly visible.
export const LIGHT_GAIN = 26;
const AMBIENT = { evening: { hemi: 0.22, sun: 0.35, sky: '#0d1822' }, day: { hemi: 0.9, sun: 2.0, sky: '#8fb4d2' } };

const HIDE_UPPER = /^(ROOF|UPPER|TERRACE|GROUNDCEIL__oak|GROUNDCEIL__plaster_ceil|FURN_BED3|DOOR_bed3|FAN_BEDROOM3|AC_BEDROOM3|LIGHT_BED3|LIGHT_PATIO|SENSOR_BED3|SENSOR_PATIO)/;
const HIDE_ROOF_ONLY = /^ROOF/;
const UPPER_ROOMS = new Set(['bedroom3', 'patio']);

// Camera presets in glTF (Y-up) metres; ground-floor rooms are viewed from above the opened roof.
export const CAMERA = {
  exterior: { pos: [13, 8.5, 17], target: [0, 2.3, 0.3] },
  rooms: {
    living:   { pos: [-1.5, 7.2, 7.4], target: [-1.5, 1.0, 0.9] },
    kitchen:  { pos: [2.0, 7.2, 7.4], target: [2.0, 1.0, 0.9] },
    bedroom:  { pos: [-5.4, 7.2, 7.0], target: [-5.4, 1.0, 0.9] },
    bedroom2: { pos: [5.4, 7.2, 7.0], target: [5.4, 1.0, 0.9] },
    bathroom: { pos: [-5.4, 7.2, 2.4], target: [-5.4, 1.0, -2.6] },
    hallway:  { pos: [0.0, 7.2, 2.0], target: [0.0, 1.0, -2.7] },
    bedroom3: { pos: [3.2, 9.5, 6.5], target: [3.2, 4.4, -0.9] },
    patio:    { pos: [-4.2, 9.5, 7.5], target: [-4.2, 4.5, 0.4] },
  },
};

function findDevice(obj) { let o = obj; while (o) { if (o.userData && o.userData.device_id && o.userData.kind) return o.userData; o = o.parent; } return null; }

function buildRegistry(root) {
  root.updateWorldMatrix(true, true);
  const reg = { anchors: {}, fans: [], louvers: [], doors: [], purifier: [], mats: {}, rooms: {}, hideNodes: [], tvPos: null, glass: [] };
  const seen = new Set();
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (m && !seen.has(m.uuid)) {
        seen.add(m.uuid);
        reg.mats[m.name] = m;
        if (m.name === 'MAT_GLASS') { m.transparent = true; m.opacity = Math.min(m.opacity ?? 0.2, 0.25); m.depthWrite = false; o.castShadow = false; }
      }
      if (m && m.name === 'MAT_GLASS') o.castShadow = false;
    }
    const u = o.userData || {};
    if (u.kind === 'light' && u.device_id) {
      const dev = LIGHT_ALIAS[u.device_id] || u.device_id;
      const p = new THREE.Vector3(); o.getWorldPosition(p);
      (reg.anchors[dev] ||= []).push({ pos: p, power: u.power ?? 1, range: u.range ?? 4, color: u.color || '#ffe2b0', room: u.room });
    } else if (u.kind === 'fan_blades') reg.fans.push({ node: o, id: u.device_id });
    else if (u.kind === 'ac_louver') reg.louvers.push({ node: o, id: u.device_id, base: o.rotation.x });
    else if (u.kind === 'purifier_fan') reg.purifier.push({ node: o });
    else if (u.kind === 'slider_panel') { const parent = o.parent?.userData; reg.doors.push({ node: o, id: u.device_id, type: 'slider', base: o.position.clone(), vec: new THREE.Vector3(...(parent?.slide_vec || [0.9, 0, 0])), amt: 0 }); }
    else if (u.kind === 'hinge') reg.doors.push({ node: o, id: u.device_id, type: 'hinge', base: o.rotation.y, open: (u.open_deg || -90) * Math.PI / 180, amt: 0 });
    else if (u.kind === 'room') { const p = new THREE.Vector3(); o.getWorldPosition(p); if (!reg.rooms[u.room_id] || u.level === 0) reg.rooms[u.room_id] = reg.rooms[u.room_id] || p; }
    else if (u.kind === 'tv') { reg.tvPos = new THREE.Vector3(); o.getWorldPosition(reg.tvPos); }
  });
  // one runtime light per device group (keeps GPU cost bounded: <= 9 point lights, no point-light shadows)
  reg.groups = Object.entries(reg.anchors).map(([dev, a]) => {
    const c = new THREE.Vector3(); a.forEach((x) => c.add(x.pos)); c.divideScalar(a.length);
    const maxY = Math.max(...a.map((x) => x.pos.y)); c.y = Math.min(c.y, maxY - 0.3);
    const lit = a.filter((x) => x.power > 0);
    const total = lit.reduce((s, x) => s + x.power, 0);
    return { dev, position: c, color: a[0].color, intensity: LIGHT_GAIN * Math.min(2.4, 0.9 + total * 0.35), distance: Math.max(...a.map((x) => x.range)) + 0.5 };
  });
  return reg;
}

function setEmissive(mat, on, color = '#ffd9a0', strength = 3) {
  if (!mat) return;
  mat.emissive.set(on ? color : '#000000');
  mat.emissiveIntensity = on ? strength : 0;
}

function Villa({ sim, selectedRoom, cutaway, daylight, highlight, onDeviceClick, onReady }) {
  const gltf = useGLTF(MODEL_URL);
  const reg = useMemo(() => buildRegistry(gltf.scene), [gltf.scene]);
  const lightRefs = useRef({});
  const tvLight = useRef();
  const hemi = useRef(); const sun = useRef();
  const scene = useThree((s) => s.scene);
  const bg = useMemo(() => new THREE.Color(), []);

  useEffect(() => { onReady?.(reg); }, [reg, onReady]);

  // cutaway: hide roof (+ upper floor / terrace / ceilings for ground-floor rooms)
  useEffect(() => {
    const upper = UPPER_ROOMS.has(selectedRoom);
    gltf.scene.children.forEach((o) => { o.visible = !(cutaway && (upper ? HIDE_ROOF_ONLY : HIDE_UPPER).test(o.name)); });
  }, [gltf.scene, cutaway, selectedRoom]);

  useFrame((_, dt) => {
    const st = sim.state; const t = st.t; const d = Math.min(dt, 0.1); const wall = performance.now() / 1000;
    const amb = AMBIENT[daylight ? 'day' : 'evening'];
    bg.set(amb.sky); scene.background = bg;
    if (hemi.current) hemi.current.intensity = THREE.MathUtils.lerp(hemi.current.intensity, amb.hemi, 0.1);
    if (sun.current) sun.current.intensity = THREE.MathUtils.lerp(sun.current.intensity, amb.sun, 0.1);

    // lights: runtime PointLight intensity + emissive bulb materials follow sim state (fade ~0.15 s)
    for (const g of reg.groups) {
      const on = !!st.devices[g.dev]?.on; const L = lightRefs.current[g.dev];
      if (L) L.intensity = THREE.MathUtils.lerp(L.intensity, on ? g.intensity : 0, Math.min(1, d * 12));
      const hl = highlight && highlight.device === g.dev;
      const pulse = 0.5 + 0.5 * Math.sin(wall * 6);
      const alias = g.dev === 'livingLight' ? ['MAT_EMIT_livingLight', 'MAT_EMIT_livingPendant'] : [`MAT_EMIT_${g.dev}`];
      alias.forEach((n) => { if (hl) setEmissive(reg.mats[n], true, '#ff3b30', 1 + 2.5 * pulse); else setEmissive(reg.mats[n], on, '#ffd9a0', 3); });
    }
    // fans: rotate only the blade pivot nodes
    for (const f of reg.fans) { const s = st.devices[f.id]; const rpm = FAN_RPM[s?.speed || 'off'] || 0; f.node.rotation.y -= (rpm * 2 * Math.PI / 60) * d * 0.5; }
    // AC: louver swing + status LED (blue = cooling, amber = heating/other, off = dark)
    for (const l of reg.louvers) {
      const s = st.devices[l.id]; const target = s?.on ? 0.55 + (s.duty > 0.05 ? 0.12 * Math.sin(wall * 1.4) : 0) : 0;
      l.node.rotation.x = THREE.MathUtils.lerp(l.node.rotation.x, l.base + target, Math.min(1, d * 4));
    }
    for (const id of ['ac', 'acBedroom1', 'acBedroom2', 'acBedroom3']) {
      const s = st.devices[id]; const m = reg.mats[`MAT_LED_${id}`];
      setEmissive(m, !!s?.on, s?.mode === 'heat' ? '#ffa040' : '#40b8ff', 2.5);
    }
    // TV, purifier, coffee, security, motion LEDs
    const tv = st.devices.tv.on;
    setEmissive(reg.mats.MAT_TV_SCREEN, tv, '#5aa8ff', 1.8);
    setEmissive(reg.mats.MAT_LED_tv, true, tv ? '#40ff80' : '#ff3030', tv ? 2 : 1);
    if (tvLight.current) tvLight.current.intensity = THREE.MathUtils.lerp(tvLight.current.intensity, tv ? 5 : 0, Math.min(1, d * 10));
    const pur = st.devices.purifier.on;
    setEmissive(reg.mats.MAT_LED_purifier, pur, '#60ffd0', 2.5);
    reg.purifier.forEach((p) => { if (pur) p.node.rotation.y += d * 6; });
    setEmissive(reg.mats.MAT_LED_coffee, st.devices.coffee.on, '#ff8a30', 3);
    setEmissive(reg.mats.MAT_LED_security, true, st.devices.security.on ? '#40ff70' : '#ff3030', 3);
    for (const r of Object.keys(st.rooms)) setEmissive(reg.mats[`MAT_LED_motion_${r}`], st.rooms[r].motion, '#ffd24a', 3);
    // doors
    for (const dr of reg.doors) {
      const open = st.devices[dr.id]?.open ? 1 : 0; dr.amt = THREE.MathUtils.lerp(dr.amt, open, Math.min(1, d * 3));
      if (dr.type === 'slider') dr.node.position.copy(dr.base).addScaledVector(dr.vec, dr.amt);
      else dr.node.rotation.y = dr.base + dr.open * dr.amt;
    }
    void t;
  });

  const hlPos = highlight && reg.rooms[highlight.room];
  const ringRef = useRef();
  useFrame(() => { if (ringRef.current) ringRef.current.material.opacity = 0.35 + 0.35 * Math.sin(performance.now() / 160); });

  return <>
    <hemisphereLight ref={hemi} args={['#cfe0ff', '#4a5a48', 0.22]} />
    <directionalLight ref={sun} position={[14, 22, 16]} intensity={0.35} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={16} shadow-camera-bottom={-16} shadow-camera-far={70} shadow-bias={-0.0006} shadow-normalBias={0.03} />
    <primitive object={gltf.scene} onClick={(e) => { const u = findDevice(e.object); if (u && DEVICES[u.device_id] !== undefined) { e.stopPropagation(); onDeviceClick?.(u.device_id); } else if (u && (LIGHT_ALIAS[u.device_id])) { e.stopPropagation(); onDeviceClick?.(LIGHT_ALIAS[u.device_id]); } }} />
    {reg.groups.map((g) => <pointLight key={g.dev} ref={(r) => { lightRefs.current[g.dev] = r; }} position={g.position.toArray()} color={g.color} intensity={0} distance={g.distance} decay={2} />)}
    {reg.tvPos && <pointLight ref={tvLight} position={[reg.tvPos.x + 0.9, reg.tvPos.y, reg.tvPos.z]} color="#6aa8ff" intensity={0} distance={4} decay={2} />}
    {hlPos && <group position={[hlPos.x, 0.08 + (UPPER_ROOMS.has(highlight.room) ? 3.4 : 0), hlPos.z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.0, 1.25, 48]} /><meshBasicMaterial color="#ff3b30" transparent opacity={0.6} depthTest={false} /></mesh>
      <Html center position={[0, 1.4, 0]} style={{ pointerEvents: 'none' }}><span className="world-label fail-label">SWITCH · assertion FAILED · {highlight.device}</span></Html>
    </group>}
  </>;
}

function CameraRig({ selectedRoom, cutaway }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current) return;
    const c = cutaway && CAMERA.rooms[selectedRoom] ? CAMERA.rooms[selectedRoom] : CAMERA.exterior;
    ref.current.setLookAt(...c.pos, ...c.target, true);
  }, [selectedRoom, cutaway]);
  return <CameraControls ref={ref} makeDefault smoothTime={0.8} minDistance={2} maxDistance={45} maxPolarAngle={Math.PI * 0.49} />;
}

class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? this.props.fallback(this.state.err) : this.props.children; }
}

function Loading() { return <Html center><span className="world-label">Loading local villa model…</span></Html>; }

export default function VillaCanvas({ sim, version, selectedRoom, cutaway, daylight, highlight, onDeviceClick }) {
  void version;
  return <Boundary fallback={(e) => <div className="model-error"><b>The local 3D model could not be loaded.</b><span>{String(e?.message || e)}</span><span>Expected file: {MODEL_URL}. Use “Original villa” for the Sketchfab reference.</span></div>}>
    <Canvas shadows camera={{ position: CAMERA.exterior.pos, fov: 40, near: 0.1, far: 250 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <Suspense fallback={<Loading />}>
        <Villa sim={sim} selectedRoom={selectedRoom} cutaway={cutaway} daylight={daylight} highlight={highlight} onDeviceClick={onDeviceClick} />
      </Suspense>
      <CameraRig selectedRoom={selectedRoom} cutaway={cutaway} />
    </Canvas>
  </Boundary>;
}
