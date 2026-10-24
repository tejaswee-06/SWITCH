// First-person character controller with real collision against the villa's triangles.
// Uses three.js Octree + Capsule (three/examples) — not a bounding-box clamp.
//  * The body is a vertical capsule whose bottom sits STEP_HEIGHT above the feet, so stair
//    treads (0.22 m) never block horizontally; a downward ray then lifts the feet onto them.
//  * Walls, glass, furniture and ceilings push the capsule out along the contact normal.
//  * Closed doors are dynamic boxes (they move), tested separately against the capsule.
//  * Optional `bounds` (Box3) keeps the room-tour camera inside the chosen room.
// Pure three.js math: runs in the browser and in Node tests.
import * as THREE from 'three';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

export const WALK = {
  radius: 0.24,        // capsule radius (m)
  eye: 1.6,            // eye height above the feet (m)
  head: 1.78,          // top of the head above the feet (m)
  stepHeight: 0.30,    // max riser that can be climbed (stairs are 0.217 m)
  speed: 1.6,          // walking speed (m/s)
  runSpeed: 3.2,
  gravity: 18,
  maxFall: 8,
};

// three's Octree.split() hardcodes "> 8 triangles and depth < 16", which takes ~10 s on this
// 26.5k-triangle villa (small spheres/tori recurse to depth 16). Same algorithm, bounded depth.
export class VillaOctree extends Octree {
  constructor(box, perLeaf = 24, maxDepth = 7) { super(box); this.perLeaf = perLeaf; this.maxDepth = maxDepth; }
  split(level) {
    if (!this.box) return this;
    const subTrees = [];
    const half = new THREE.Vector3().copy(this.box.max).sub(this.box.min).multiplyScalar(0.5);
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      const box = new THREE.Box3();
      box.min.copy(this.box.min).add(new THREE.Vector3(x, y, z).multiply(half));
      box.max.copy(box.min).add(half);
      subTrees.push(new VillaOctree(box, this.perLeaf, this.maxDepth));
    }
    let tri;
    while ((tri = this.triangles.pop())) for (const st of subTrees) if (st.box.intersectsTriangle(tri)) st.triangles.push(tri);
    for (const st of subTrees) {
      const len = st.triangles.length;
      if (len > this.perLeaf && level < this.maxDepth) st.split(level + 1);
      if (len !== 0) this.subTrees.push(st);
    }
    return this;
  }
}

export function buildOctree(meshes) {
  const g = new THREE.Group();
  for (const m of meshes) {
    const c = new THREE.Mesh(m.geometry);
    m.updateWorldMatrix(true, false);
    c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.matrixWorld.copy(m.matrixWorld);
    g.add(c);
  }
  const oct = new VillaOctree();
  // fromGraphNode() calls updateWorldMatrix on children; matrices are already world, group is identity.
  g.children.forEach((c) => { c.updateMatrixWorld = () => {}; c.updateWorldMatrix = () => {}; });
  oct.fromGraphNode(g);
  return oct;
}

const _v = new THREE.Vector3();
const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);

export class Walker {
  constructor(octree, opts = {}) {
    this.o = { ...WALK, ...opts };
    this.octree = octree;
    this.feet = new THREE.Vector3();
    this.vy = 0;
    this.onFloor = false;
    this.capsule = new Capsule();
    this.bounds = null;            // optional THREE.Box3 (room-tour limit, feet position)
    this.doorBoxes = () => [];     // () => [THREE.Box3] for closed doors
    this.lastFloorY = 0;
  }
  _syncCapsule() {
    const { radius, stepHeight, head } = this.o;
    this.capsule.start.set(this.feet.x, this.feet.y + stepHeight + radius, this.feet.z);
    this.capsule.end.set(this.feet.x, this.feet.y + head - radius, this.feet.z);
    this.capsule.radius = radius;
  }
  /** Put the eye at `eye` (feet = eye - eyeHeight) and snap to the floor below. */
  teleportEye(eye) {
    this.feet.set(eye.x, eye.y - this.o.eye, eye.z);
    this.vy = 0;
    const f = this.floorBelow(this.feet, this.o.stepHeight + 0.4, 3);
    if (f !== null) { this.feet.y = f; this.onFloor = true; this.lastFloorY = f; }
    this._syncCapsule();
    return this;
  }
  eyePosition(out = new THREE.Vector3()) { return out.set(this.feet.x, this.feet.y + this.o.eye, this.feet.z); }

  /** Highest walkable surface under (x, z) between feet+up and feet-down. */
  floorBelow(p, up, down) {
    const r = this.o.radius * 0.55;
    let best = null;
    // centre + 4 probes so thin gaps between treads do not drop the walker
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      _ray.origin.set(p.x + dx, p.y + up, p.z + dz); _ray.direction.copy(_down);
      const hit = this.octree.rayIntersect(_ray);
      if (hit && hit.distance <= up + down) {
        const y = p.y + up - hit.distance;
        if (best === null || y > best) best = y;
      }
    }
    return best;
  }

  _resolveStatic() {
    for (let i = 0; i < 4; i++) {
      const r = this.octree.capsuleIntersect(this.capsule);
      if (!r) return;
      const n = r.normal;
      // push out horizontally for walls/furniture; vertical component handles ceilings
      if (n.y < -0.5) { this.capsule.translate(_v.copy(n).multiplyScalar(r.depth)); if (this.vy > 0) this.vy = 0; }
      else {
        // horizontal-only push: moving |h| sideways separates the surface by depth when |h| = depth / |n_xz|
        _v.set(n.x, 0, n.z); const l = _v.length(); if (l < 1e-6) return;
        this.capsule.translate(_v.normalize().multiplyScalar(r.depth / Math.max(l, 0.25)));
      }
    }
  }
  _resolveDoors() {
    const boxes = this.doorBoxes();
    const rad = this.o.radius;
    for (const b of boxes) {
      const yLo = this.capsule.start.y - rad, yHi = this.capsule.end.y + rad;
      if (b.max.y < yLo || b.min.y > yHi) continue;
      const c = this.capsule.start;
      const cx = THREE.MathUtils.clamp(c.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(c.z, b.min.z, b.max.z);
      const dx = c.x - cx, dz = c.z - cz; const d = Math.hypot(dx, dz);
      if (d >= rad) continue;
      let nx, nz, push;
      if (d > 1e-6) { nx = dx / d; nz = dz / d; push = rad - d; }
      else { // centre inside the box: leave by the nearest face
        const opts = [[c.x - b.min.x, -1, 0], [b.max.x - c.x, 1, 0], [c.z - b.min.z, 0, -1], [b.max.z - c.z, 0, 1]].sort((a, z) => a[0] - z[0]);
        nx = opts[0][1]; nz = opts[0][2]; push = opts[0][0] + rad;
      }
      this.capsule.translate(_v.set(nx * push, 0, nz * push));
    }
  }

  /**
   * Advance by dt with a desired horizontal velocity (world m/s).
   * Returns {moved, blocked, floorY}.
   */
  update(dt, vel) {
    dt = Math.min(dt, 0.05);
    const before = this.feet.clone();
    const want = _v.set(vel.x * dt, 0, vel.z * dt);
    const wantLen = want.length();
    // sub-step so fast moves cannot tunnel through thin glass (glass is 12 mm)
    const n = Math.max(1, Math.ceil(wantLen / (this.o.radius * 0.5)));
    const sx = want.x / n, sz = want.z / n;
    for (let i = 0; i < n; i++) {
      this._syncCapsule();
      this.capsule.translate(_v.set(sx, 0, sz));
      this._resolveStatic();
      this._resolveDoors();
      const nx = this.capsule.start.x, nz = this.capsule.start.z;
      // floor under the new position: may step up at most stepHeight
      const probe = new THREE.Vector3(nx, this.feet.y, nz);
      const f = this.floorBelow(probe, this.o.stepHeight, this.o.maxFall);
      if (f === null || f > this.feet.y + this.o.stepHeight + 1e-3) continue; // no floor / too high: reject sub-step
      if (this.bounds && !this.bounds.containsPoint(_v.set(nx, f, nz))) continue;
      this.feet.x = nx; this.feet.z = nz;
      if (f >= this.feet.y - 0.05) { this.feet.y = f; this.onFloor = true; this.vy = 0; }
      else this.onFloor = false;
      this.lastFloorY = f;
    }
    // gravity when unsupported (walked off a ledge)
    const f = this.floorBelow(this.feet, 0.05, this.o.maxFall);
    if (f !== null && f < this.feet.y - 0.05) {
      this.vy -= this.o.gravity * dt;
      this.feet.y = Math.max(f, this.feet.y + this.vy * dt);
      this.onFloor = this.feet.y <= f + 1e-3; if (this.onFloor) this.vy = 0;
    } else if (f !== null) { this.feet.y = f; this.onFloor = true; this.vy = 0; }
    this._syncCapsule();
    const moved = Math.hypot(this.feet.x - before.x, this.feet.z - before.z);
    return { moved, blocked: wantLen > 1e-6 && moved < wantLen * 0.25, floorY: this.feet.y };
  }
}
