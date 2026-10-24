// Minimal GLB -> three.js scene reader that runs in Node (no DOM, no textures).
// Used by the automated tests to validate camera presets, device mappings and walk collision
// against the SAME triangles the browser renders. It reads node TRS/matrix, names, extras
// (-> userData) and indexed POSITION data; materials become plain placeholders.
import * as THREE from 'three';

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGLB(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12; let json = null; let bin = null;
  while (off < u8.byteLength) {
    const len = dv.getUint32(off, true); const type = dv.getUint32(off + 4, true);
    const chunk = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

function accessor(json, bin, i) {
  const a = json.accessors[i]; const bv = json.bufferViews[a.bufferView];
  const T = COMP[a.componentType]; const n = SIZE[a.type];
  const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || 0;
  if (stride && stride !== n * T.BYTES_PER_ELEMENT) {
    const out = new T(a.count * n); const dv = new DataView(bin.buffer);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const p = start + k * stride + c * T.BYTES_PER_ELEMENT;
      out[k * n + c] = T === Float32Array ? dv.getFloat32(p, true) : T === Uint16Array ? dv.getUint16(p, true) : dv.getUint32(p, true);
    }
    return out;
  }
  return new T(bin.buffer.slice(start, start + a.count * n * T.BYTES_PER_ELEMENT));
}

/** Returns a THREE.Group whose children mirror the glTF scene graph (names + userData = extras). */
export function glbToScene(buf) {
  const { json, bin } = parseGLB(buf);
  const geoms = new Map();
  const meshGroup = (mi) => {
    const g = new THREE.Group();
    json.meshes[mi].primitives.forEach((p, k) => {
      const key = `${mi}:${k}`;
      let geo = geoms.get(key);
      if (!geo) {
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(accessor(json, bin, p.attributes.POSITION), 3));
        if (p.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(accessor(json, bin, p.indices), 1));
        geoms.set(key, geo);
      }
      const matName = p.material !== undefined ? json.materials[p.material].name : 'NONE';
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ name: matName }));
      m.name = json.meshes[mi].name || '';
      g.add(m);
    });
    return g;
  };
  const build = (ni) => {
    const n = json.nodes[ni];
    const o = new THREE.Object3D();
    o.name = n.name || '';
    o.userData = { ...(n.extras || {}) };
    if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
    else {
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    if (n.mesh !== undefined) {
      const mg = meshGroup(n.mesh);
      if (mg.children.length === 1) { const m = mg.children[0]; m.name = o.name; m.userData = o.userData; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); (n.children || []).forEach((c) => m.add(build(c))); return m; }
      mg.children.slice().forEach((m) => o.add(m));
    }
    (n.children || []).forEach((c) => o.add(build(c)));
    return o;
  };
  const root = new THREE.Group();
  json.scenes[json.scene || 0].nodes.forEach((ni) => root.add(build(ni)));
  root.updateMatrixWorld(true);
  return root;
}
