// Movement for the traveller: walking/running on terrain and bridge decks, jumping and gliding,
// with collisions against castle walls (BVH raycasts), trees, rocks, cliffs and deep water.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { NEAR, CASTLE_MESA } from './world.js';
import { clamp, lerp, smoothstep } from './noise.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const UP = new THREE.Vector3(0, 1, 0);

export class Obstacles {
  constructor(cell = 8) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 92821 + j; }
  add(x, z, r) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    const k = this.key(i, j);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push([x, z, r]);
  }
  // push a point out of any circle it overlaps (radius of the traveller added)
  resolve(p, rad) {
    const i0 = Math.floor(p.x / this.cell), j0 = Math.floor(p.z / this.cell);
    let hit = false;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.map.get(this.key(i0 + i, j0 + j));
      if (!arr) continue;
      for (const [x, z, r] of arr) {
        const dx = p.x - x, dz = p.z - z;
        const d = Math.hypot(dx, dz), R = r + rad;
        if (d < R && d > 1e-4) { p.x = x + (dx / d) * R; p.z = z + (dz / d) * R; hit = true; }
      }
    }
    return hit;
  }
}

export class Controller {
  constructor({ hf, path, decks, walls, obstacles }) {
    this.hf = hf; this.path = path; this.decks = decks; this.obstacles = obstacles;
    this.walls = walls;
    for (const m of walls) if (m.geometry && !m.geometry.boundsTree) m.geometry.computeBoundsTree();
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = 0;
    this.grounded = true;
    this.gliding = false;
    this.airTime = 0;
    this.landT = 10;
    this.surface = 'grass';
    this.radius = 0.28;
    this.callT = 10;
    this._n = new THREE.Vector3();
    this._m3 = new THREE.Matrix3();
  }

  place(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.pos.y = this.ground(x, z, 1e4).y;
    this.vel.set(0, 0, 0); this.vy = 0;
    this.yaw = yaw;
    this.grounded = true; this.gliding = false; this.airTime = 0; this.landT = 10;
  }

  deckAt(x, z) {
    let best = null;
    for (const d of this.decks) {
      const dx = d.bx - d.ax, dz = d.bz - d.az;
      const L2 = dx * dx + dz * dz;
      const t = ((x - d.ax) * dx + (z - d.az) * dz) / L2;
      if (t < 0 || t > 1) continue;
      const lat = Math.abs((x - d.ax) * dz - (z - d.az) * dx) / Math.sqrt(L2);
      if (lat > d.width / 2 - 0.2) continue;
      const y = d.topAt(t);
      if (!best || y > best.y) best = { y, deck: d, lat };
    }
    return best;
  }

  // Walkable height under (x,z) for a body currently at height yRef
  ground(x, z, yRef) {
    const h = this.hf.height(x, z);
    let y = h, surface = 'grass';
    const road = this.hf.roadAt(x, z);
    if (road > 0.35) surface = 'path';
    const n = this.hf.normal(x, z, 1.5);
    if (n.y < 0.8) surface = 'stone';
    if (h < -0.08) { surface = 'water'; y = Math.max(h, -0.35); }
    const dk = this.deckAt(x, z);
    if (dk && dk.y <= yRef + 0.75 && dk.y > y) { y = dk.y; surface = 'stone'; }
    const dm = Math.hypot(x - CASTLE_MESA.x, z - CASTLE_MESA.z);
    if (dm < CASTLE_MESA.r && h > 85) surface = 'stone';
    return { y, surface, terrain: h, deck: dk && dk.y === y ? dk : null };
  }

  wallHit(from, dir, dist) {
    const ray = this.ray;
    let best = null;
    for (const h of [0.55, 1.05]) { // above a comfortable step height
      ray.set(new THREE.Vector3(from.x, from.y + h, from.z), dir);
      ray.far = dist;
      const hits = ray.intersectObjects(this.walls, false);
      if (hits.length && (!best || hits[0].distance < best.distance)) best = hits[0];
    }
    if (!best) return null;
    const n = this._n.copy(best.face.normal);
    this._m3.getNormalMatrix(best.object.matrixWorld);
    n.applyMatrix3(this._m3).setY(0);
    if (n.lengthSq() < 1e-6) n.copy(dir).multiplyScalar(-1);
    n.normalize();
    if (n.dot(dir) > 0) n.negate();
    return { distance: best.distance, normal: n.clone() };
  }

  // input: { move: Vector3 (world xz, length 0..1), walk, jump (pressed), jumpHeld, call }
  update(dt, input) {
    const onGround = this.grounded;
    const maxSpeed = this.gliding ? 5.2 : input.walk ? 1.7 : 3.55;
    const want = input.move.clone().multiplyScalar(maxSpeed);
    const accel = onGround ? (want.lengthSq() > this.vel.lengthSq() ? 9 : 11) : 2.5;
    const dv = want.clone().sub(this.vel);
    const maxDv = accel * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
    this.vel.y = 0;

    // facing follows motion
    const sp = this.vel.length();
    if (sp > 0.15 || input.move.lengthSq() > 0.01) {
      const dir = sp > 0.15 ? this.vel : input.move;
      const target = Math.atan2(dir.x, dir.z);
      const d = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
      this.yaw += d * (1 - Math.exp(-dt * (onGround ? 10 : 4)));
    }

    // jump / glide
    this.callT += dt;
    if (input.call && this.callT > 1.2) this.callT = 0;
    if (input.jump && onGround) {
      this.vy = 5.9; this.grounded = false; this.airTime = 0; this.jumped = true;
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.gliding = input.jumpHeld && this.vy < 0 && this.airTime > 0.25;
      this.vy -= (this.gliding ? 6 : 15) * dt;
      if (this.gliding) this.vy = Math.max(this.vy, -1.5);
    } else this.gliding = false;

    // horizontal move with collisions (substeps keep thin walls solid)
    const move = this.vel.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(move.length() / 0.2));
    move.divideScalar(steps);
    for (let k = 0; k < steps; k++) this._step(move);

    // vertical
    const g = this.ground(this.pos.x, this.pos.z, this.pos.y);
    this.surface = g.surface;
    if (this.grounded) {
      if (g.y < this.pos.y - 0.45) { this.grounded = false; this.airTime = 0; this.vy = 0; } // walked off an edge
      else this.pos.y = lerp(this.pos.y, g.y, 1 - Math.exp(-dt * 25));
    }
    if (!this.grounded) {
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g.y && this.vy <= 0) {
        this.pos.y = g.y; this.grounded = true; this.gliding = false;
        this.landImpact = clamp(-this.vy / 8, 0, 1); this.landT = 0; this.vy = 0;
      }
    }
    this.landT += dt;
    // deep water: gently wash back to the bank
    if (this.grounded && g.terrain < -0.9 && !g.deck) this.inDeepWater = true; else this.inDeepWater = false;
  }

  _step(move) {
    const len = move.length();
    if (len < 1e-6) return;
    const dir = move.clone().normalize();
    // castle / bridges / ruins
    let hit = this.wallHit(this.pos, dir, len + this.radius);
    if (hit) {
      const m = move.clone().addScaledVector(hit.normal, -move.dot(hit.normal));
      move.copy(m);
      if (move.length() < 1e-5) return;
      const d2 = move.clone().normalize();
      hit = this.wallHit(this.pos, d2, move.length() + this.radius);
      if (hit) return;
    }
    const next = this.pos.clone().add(move);
    // terrain: steep rises and deep water block walking
    if (this.grounded) {
      const g0 = this.ground(this.pos.x, this.pos.z, this.pos.y);
      const g1 = this.ground(next.x, next.z, this.pos.y);
      const rise = g1.y - g0.y;
      const onto = g1.deck || g0.deck; // stepping on/off a bridge deck: allow a small step
      if (onto ? rise > 0.45 : rise > 0.12 && rise / move.length() > 1.25) return this._slide(move, next);
      if (g1.terrain < -0.7 && !g1.deck) return;
      // bridge parapets: stay on the deck unless leaving from its ends
      if (g0.deck && !g1.deck && Math.abs(g1.y - g0.y) > 1.2) return;
    }
    // trees, rocks, columns
    this.obstacles.resolve(next, this.radius);
    next.x = clamp(next.x, NEAR.x0 + 40, NEAR.x1 - 40);
    next.z = clamp(next.z, NEAR.z0 + 40, NEAR.z1 - 40);
    this.pos.x = next.x; this.pos.z = next.z;
  }

  _slide(move, next) {
    // move along the contour of a slope that is too steep
    const n = this.hf.normal(next.x, next.z, 1.5).setY(0);
    if (n.lengthSq() < 1e-6) return;
    n.normalize();
    const m = move.clone().addScaledVector(n, -move.dot(n)).multiplyScalar(0.8);
    const p = this.pos.clone().add(m);
    const g0 = this.ground(this.pos.x, this.pos.z, this.pos.y), g1 = this.ground(p.x, p.z, this.pos.y);
    if (g1.y - g0.y > 0.12 && (g1.y - g0.y) / Math.max(m.length(), 1e-4) > 1.25) return;
    this.pos.x = p.x; this.pos.z = p.z;
  }
}
