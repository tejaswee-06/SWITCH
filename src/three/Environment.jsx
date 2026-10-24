// Sky dome, stars, sun / moon / hemisphere lights driven by src/sim/daylight.js.
// Values ease toward their targets every frame so manual time changes animate instead of jumping
// (instant when reduced motion is on). Device states are never touched here.
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const skyVert = /* glsl */`varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const skyFrag = /* glsl */`uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h*6.0,0.0,1.0));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18) * uSunVis;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function Stars({ opacityRef }) {
  const geo = useMemo(() => {
    // deterministic star field (no Math.random): golden-angle spiral on the upper hemisphere
    const n = 700; const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 0.08 + 0.92 * ((i * 0.618034) % 1); const r = Math.sqrt(1 - y * y); const a = i * 2.399963;
      pos.set([Math.cos(a) * r * 150, y * 150, Math.sin(a) * r * 150], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return g;
  }, []);
  const mat = useRef();
  useFrame(() => { if (mat.current) { mat.current.opacity = opacityRef.current; mat.current.visible = opacityRef.current > 0.01; } });
  return <points geometry={geo} frustumCulled={false} renderOrder={-1}><pointsMaterial ref={mat} color="#dfe8ff" size={1.1} sizeAttenuation={false} transparent depthWrite={false} fog={false} /></points>;
}

export default function Environment({ env, quality, reducedMotion }) {
  const { gl, scene } = useThree();
  const hemi = useRef(); const sun = useRef(); const moon = useRef(); const sky = useRef();
  const starOpacity = useRef(env.stars);
  const cur = useRef(null);
  const uniforms = useMemo(() => ({
    uTop: { value: new THREE.Color(env.skyTop) }, uHorizon: { value: new THREE.Color(env.skyHorizon) }, uGround: { value: new THREE.Color('#0b120e') },
    uSunDir: { value: new THREE.Vector3(...env.sun) }, uSunColor: { value: new THREE.Color(env.sunColor) }, uSunVis: { value: 1 },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const fog = useMemo(() => new THREE.Fog(env.skyHorizon, 70, 190), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scene.fog = fog; return () => { scene.fog = null; }; }, [scene, fog]);
  // neutral image-based lighting so metals/glass read correctly; its strength follows the daylight model
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl); const room = new RoomEnvironment();
    const tex = pm.fromScene(room, 0.04).texture; scene.environment = tex; room.dispose?.(); pm.dispose();
    return () => { scene.environment = null; tex.dispose(); };
  }, [gl, scene]);
  const shadowSize = quality === 'high' ? 2048 : quality === 'balanced' ? 1024 : 512;

  useFrame((_, dt) => {
    const target = {
      top: new THREE.Color(env.skyTop), hor: new THREE.Color(env.skyHorizon), sunC: new THREE.Color(env.sunColor),
      sun: env.sunIntensity, hemi: env.hemiIntensity, moon: env.moonIntensity, exp: env.exposure, stars: env.stars,
      dir: new THREE.Vector3(...env.sun),
    };
    if (!cur.current) cur.current = { top: target.top.clone(), hor: target.hor.clone(), sunC: target.sunC.clone(), sun: target.sun, hemi: target.hemi, moon: target.moon, exp: target.exp, stars: target.stars, dir: target.dir.clone() };
    const c = cur.current; const k = reducedMotion ? 1 : Math.min(1, dt * 1.8);
    c.top.lerp(target.top, k); c.hor.lerp(target.hor, k); c.sunC.lerp(target.sunC, k); c.dir.lerp(target.dir, k).normalize();
    c.sun += (target.sun - c.sun) * k; c.hemi += (target.hemi - c.hemi) * k; c.moon += (target.moon - c.moon) * k; c.exp += (target.exp - c.exp) * k; c.stars += (target.stars - c.stars) * k;
    uniforms.uTop.value.copy(c.top); uniforms.uHorizon.value.copy(c.hor); uniforms.uSunColor.value.copy(c.sunC); uniforms.uSunDir.value.copy(c.dir);
    uniforms.uSunVis.value = Math.min(1, c.sun / 0.6);
    uniforms.uGround.value.copy(c.hor).multiplyScalar(0.25);
    fog.color.copy(c.hor);
    starOpacity.current = c.stars;
    gl.toneMappingExposure = c.exp;
    scene.environmentIntensity = 0.04 + c.hemi * 0.38;
    if (hemi.current) { hemi.current.intensity = c.hemi; hemi.current.color.copy(c.top).lerp(new THREE.Color('#ffffff'), 0.55); hemi.current.groundColor.set('#8c8677').multiplyScalar(0.55 + c.hemi * 0.35); }
    if (sun.current) { sun.current.intensity = c.sun; sun.current.color.copy(c.sunC); sun.current.position.copy(c.dir).multiplyScalar(40); sun.current.castShadow = quality !== 'low' && c.sun > 0.05; }
    if (moon.current) moon.current.intensity = c.moon;
  });

  return <>
    <mesh ref={sky} scale={180} frustumCulled={false} renderOrder={-2}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial vertexShader={skyVert} fragmentShader={skyFrag} uniforms={uniforms} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped />
    </mesh>
    <Stars opacityRef={starOpacity} />
    <hemisphereLight ref={hemi} args={['#cfe0ff', '#3b4636', env.hemiIntensity]} />
    <directionalLight ref={sun} position={[14, 22, 16]} intensity={env.sunIntensity} castShadow={quality !== 'low'}
      shadow-mapSize-width={shadowSize} shadow-mapSize-height={shadowSize} shadow-camera-left={-17} shadow-camera-right={17} shadow-camera-top={17} shadow-camera-bottom={-17}
      shadow-camera-near={1} shadow-camera-far={90} shadow-bias={-0.0005} shadow-normalBias={0.035} />
    <directionalLight ref={moon} position={[-18, 26, -12]} color="#9fb6ff" intensity={env.moonIntensity} />
  </>;
}
