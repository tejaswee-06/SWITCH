// Dev-only: quick GLB inspector. /tools/model-preview.html?cam=x,y,z&look=x,y,z&hide=ROOF,UPPER&night=1
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const q = new URLSearchParams(location.search);
const v = (k, d) => (q.get(k) || d).split(',').map(Number);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('night') ? '#0a1018' : '#9cc4e4');
const cam = new THREE.PerspectiveCamera(+(q.get('fov') || 45), innerWidth / innerHeight, 0.05, 200);
cam.position.set(...v('cam', '16,9,22')); cam.lookAt(...v('look', '0,2,0'));
scene.add(new THREE.HemisphereLight('#ffffff', '#556655', q.get('night') ? 0.25 : 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', q.get('night') ? 0.2 : 2.2); sun.position.set(10, 20, 14); scene.add(sun);
const hide = (q.get('hide') || '').split(',').filter(Boolean);
new GLTFLoader().load('/models/switch_villa.glb', (g) => {
  g.scene.traverse((o) => {
    if (o.isMesh) {
      const m = o.material;
      if (m && /GLASS/.test(m.name)) { m.transparent = true; m.opacity = 0.2; m.depthWrite = false; }
    }
    if (hide.some((h) => o.name.startsWith(h))) o.visible = false;
  });
  scene.add(g.scene);
  window.__done = true; window.__scene = g.scene;
  renderer.render(scene, cam);
}, undefined, (e) => { console.error('LOAD ERR', e); window.__done = 'err'; });
