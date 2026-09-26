// The little traveller: procedural run cycle with planted feet (IK) and a simulated cape.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function capeTexture() {
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#f08a4a');
  grd.addColorStop(0.55, '#e57034');
  grd.addColorStop(1, '#d9612c');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // soft woven texture
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(255,${190 + Math.random() * 40},140,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 6);
  }
  // trim band near the hem
  g.fillStyle = '#f6d58c';
  g.fillRect(0, H * 0.86, W, H * 0.025);
  g.fillRect(0, H * 0.905, W, H * 0.01);
  // small diamond motifs
  g.fillStyle = 'rgba(248,214,140,0.9)';
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (W / 8), y = H * 0.8;
    g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 5, y); g.lineTo(x, y + 7); g.lineTo(x - 5, y); g.closePath(); g.fill();
  }
  // emblem between the shoulders
  g.strokeStyle = 'rgba(250,220,150,0.85)'; g.lineWidth = 3;
  g.beginPath(); g.arc(W / 2, H * 0.22, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(W / 2, H * 0.22 - 22); g.lineTo(W / 2, H * 0.22 + 22); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class Cape {
  constructor(material) {
    this.cols = 11; this.rows = 15;
    const n = this.cols * this.rows;
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3); // previous
    this.rest = [];
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      uv[(j * this.cols + i) * 2] = i / (this.cols - 1);
      uv[(j * this.cols + i) * 2 + 1] = 1 - j / (this.rows - 1);
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let j = 0; j < this.rows - 1; j++) for (let i = 0; i < this.cols - 1; i++) {
      const a = j * this.cols + i, b = a + 1, c = a + this.cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.constraints = [];
    this.initialized = false;
  }

  // local layout of the cape in the body frame (right, up, forward)
  layout(i, j) {
    const u = i / (this.cols - 1) - 0.5; // -0.5..0.5
    const v = j / (this.rows - 1);
    const x = u * lerp(0.3, 0.66, Math.pow(v, 0.8));
    const bow = 1 - 4 * u * u; // centre bulges backwards, edges wrap toward the arms
    const z = -0.075 - 0.06 * bow * (1 - v * 0.4) - v * 0.06;
    const y = 0.01 - v * 0.74;
    return [x, y, z];
  }

  anchors(frame, out) {
    // pinned top row positions in world space
    for (let i = 0; i < this.cols; i++) {
      const [x, y, z] = this.layout(i, 0);
      out[i] = frame.origin.clone()
        .addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.fwd, z);
    }
    return out;
  }

  reset(frame) {
    const { cols, rows } = this;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const [x, y, z] = this.layout(i, j);
      // let it start trailing slightly backwards
      const back = -(j / (rows - 1)) * 0.25;
      const w = frame.origin.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, y * 0.9).addScaledVector(frame.fwd, z + back);
      const k = (j * cols + i) * 3;
      this.p[k] = w.x; this.p[k + 1] = w.y; this.p[k + 2] = w.z;
      this.q[k] = w.x; this.q[k + 1] = w.y; this.q[k + 2] = w.z;
    }
    if (!this.constraints.length) {
      const add = (a, b, stiff) => {
        const la = this.layout(a % cols, Math.floor(a / cols)), lb = this.layout(b % cols, Math.floor(b / cols));
        const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
        this.constraints.push([a, b, d, stiff]);
      };
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * cols + i;
        if (i < cols - 1) add(a, a + 1, 1);
        if (j < rows - 1) add(a, a + cols, 1);
        if (i < cols - 1 && j < rows - 1) { add(a, a + cols + 1, 0.6); add(a + 1, a + cols, 0.6); }
        if (j < rows - 2) add(a, a + cols * 2, 0.35);
        if (i < cols - 2) add(a, a + 2, 0.3);
      }
    }
    this.initialized = true;
  }

  step(dt, frame, colliders, wind) {
    const { cols, rows, p, q } = this;
    const anchors = this.anchors(frame, this._anch || (this._anch = []));
    const damping = 0.9985;
    const g = -9.8;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      if (j === 0) {
        const a = anchors[i];
        q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
        p[k] = a.x; p[k + 1] = a.y; p[k + 2] = a.z;
        continue;
      }
      const vx = (p[k] - q[k]) / dt, vy = (p[k + 1] - q[k + 1]) / dt, vz = (p[k + 2] - q[k + 2]) / dt;
      // aerodynamic drag toward the wind velocity; lower rows flutter more
      const flutter = 0.75 + 0.5 * (j / rows);
      const n1 = Math.sin(this.t * 7.1 + i * 0.7 + j * 0.45) + Math.sin(this.t * 4.3 - j * 0.8 + i * 0.3);
      const wx = wind.x * (1 + 0.15 * n1), wy = wind.y + 0.25 * n1 * flutter, wz = wind.z * (1 + 0.15 * n1);
      const kd = 1.6 * flutter;
      const ax = kd * (wx - vx), ay = g + kd * 0.55 * (wy - vy), az = kd * (wz - vz);
      const nx = p[k] + (p[k] - q[k]) * damping + ax * dt * dt;
      const ny = p[k + 1] + (p[k + 1] - q[k + 1]) * damping + ay * dt * dt;
      const nz = p[k + 2] + (p[k + 2] - q[k + 2]) * damping + az * dt * dt;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      p[k] = nx; p[k + 1] = ny; p[k + 2] = nz;
    }
    for (let it = 0; it < 7; it++) {
      for (const [a, b, rest, st] of this.constraints) {
        const ka = a * 3, kb = b * 3;
        const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // allow slight compression (cloth buckles) but resist stretching firmly
        let diff = (d - rest) / d;
        if (diff < 0) diff *= 0.35;
        diff *= 0.5 * st;
        const pinA = a < cols, pinB = b < cols;
        if (pinA && pinB) continue;
        if (pinA) { p[kb] -= dx * diff * 2; p[kb + 1] -= dy * diff * 2; p[kb + 2] -= dz * diff * 2; }
        else if (pinB) { p[ka] += dx * diff * 2; p[ka + 1] += dy * diff * 2; p[ka + 2] += dz * diff * 2; }
        else {
          p[ka] += dx * diff; p[ka + 1] += dy * diff; p[ka + 2] += dz * diff;
          p[kb] -= dx * diff; p[kb + 1] -= dy * diff; p[kb + 2] -= dz * diff;
        }
      }
      // collisions
      for (let k = cols * 3; k < p.length; k += 3) {
        for (const c of colliders) {
          let cx, cy, cz;
          if (c.b) { // capsule
            const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
            const t = clamp(((p[k] - c.a.x) * abx + (p[k + 1] - c.a.y) * aby + (p[k + 2] - c.a.z) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
            cx = c.a.x + abx * t; cy = c.a.y + aby * t; cz = c.a.z + abz * t;
          } else { cx = c.a.x; cy = c.a.y; cz = c.a.z; }
          const dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < c.r * c.r) {
            const d = Math.sqrt(d2) || 1e-6;
            const push = (c.r - d) / d;
            p[k] += dx * push; p[k + 1] += dy * push; p[k + 2] += dz * push;
          }
        }
        // never below the ground
        if (p[k + 1] < this.groundY + 0.03) p[k + 1] = this.groundY + 0.03;
      }
    }
  }

  updateGeometry() {
    const pos = this.geo.attributes.position;
    pos.array.set(this.p);
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}

export class Traveler {
  constructor() {
    this.group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: '#f6efe2', roughness: 0.85 });
    const cloth2 = new THREE.MeshStandardMaterial({ color: '#efe5d2', roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: '#f7d9c6', roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: '#efcf7e', roughness: 0.55 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#a86d45', roughness: 0.8 });
    const capeMat = new THREE.MeshStandardMaterial({ map: capeTexture(), side: THREE.DoubleSide, roughness: 0.82 });
    capeMat.onBeforeCompile = (sh) => {
      // soft sheen/translucency so the cape glows warmly when back-lit
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 Vv = normalize(vViewPosition);
  float fr = pow(1.0 - abs(dot(normalize(normal), Vv)), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * (0.12 + fr * 0.25);
}`);
    };
    this.mats = { cloth, skin, hair, shoe, capeMat };

    // dimensions
    this.l1 = 0.29; this.l2 = 0.28; this.hipH = 0.54;
    this.ua = 0.19; this.fa = 0.18;

    const cap = (r, l, m) => {
      const g = new THREE.CapsuleGeometry(r, l, 4, 10);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    this.thigh = [cap(0.052, this.l1 - 0.03, cloth2), cap(0.052, this.l1 - 0.03, cloth2)];
    this.shin = [cap(0.042, this.l2 - 0.02, cloth2), cap(0.042, this.l2 - 0.02, cloth2)];
    this.uarm = [cap(0.038, this.ua - 0.02, cloth), cap(0.038, this.ua - 0.02, cloth)];
    this.farm = [cap(0.032, this.fa - 0.03, cloth), cap(0.032, this.fa - 0.03, cloth)];
    const handG = new THREE.SphereGeometry(0.036, 10, 8);
    this.hand = [new THREE.Mesh(handG, skin), new THREE.Mesh(handG, skin)];
    this.hand.forEach((h) => { h.castShadow = true; this.group.add(h); });
    const footG = new THREE.CapsuleGeometry(0.042, 0.1, 4, 8);
    footG.rotateX(Math.PI / 2);
    footG.translate(0, 0.0, 0.035);
    footG.scale(1.05, 0.8, 1);
    this.foot = [new THREE.Mesh(footG, shoe), new THREE.Mesh(footG, shoe)];
    this.foot.forEach((f) => { f.castShadow = true; this.group.add(f); });

    // torso: tunic (lathe) from the pelvis up to the shoulders
    this.torso = new THREE.Group();
    this.group.add(this.torso);
    const tunicPts = [
      [0.001, -0.06], [0.12, -0.06], [0.135, 0.0], [0.13, 0.08], [0.125, 0.16], [0.13, 0.24], [0.12, 0.3], [0.08, 0.35], [0.04, 0.37], [0.001, 0.37],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tunic = new THREE.Mesh(new THREE.LatheGeometry(tunicPts, 20), cloth);
    tunic.scale.set(1.08, 1, 0.8);
    tunic.castShadow = true;
    this.torso.add(tunic);
    // belt
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.012, 6, 24), new THREE.MeshStandardMaterial({ color: '#c99a5b', roughness: 0.7 }));
    belt.rotation.x = Math.PI / 2; belt.scale.set(1.08, 0.8, 1); belt.position.y = 0.06;
    this.torso.add(belt);
    // skirt (flared, attached to the pelvis)
    const skirtPts = [[0.13, 0.02], [0.15, -0.04], [0.19, -0.14], [0.22, -0.22], [0.225, -0.24]].map(([r, y]) => new THREE.Vector2(r, y));
    const skirtG = new THREE.LatheGeometry(skirtPts, 24);
    this.skirt = new THREE.Mesh(skirtG, new THREE.MeshStandardMaterial({ color: '#f6efe2', roughness: 0.85, side: THREE.DoubleSide }));
    this.skirt.scale.set(1.0, 1, 0.82);
    this.skirt.castShadow = true;
    this.group.add(this.skirt);
    // collar / cowl of the cape
    const cowlPts = [[0.1, -0.02], [0.155, 0.0], [0.17, 0.04], [0.13, 0.09], [0.09, 0.1]].map(([r, y]) => new THREE.Vector2(r, y));
    const cowl = new THREE.Mesh(new THREE.LatheGeometry(cowlPts, 20), capeMat);
    cowl.position.y = 0.3; cowl.scale.set(1.12, 1, 0.95);
    cowl.castShadow = true;
    this.torso.add(cowl);

    // head
    this.head = new THREE.Group();
    this.group.add(this.head);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 18), skin);
    headM.scale.set(1, 1.02, 0.98);
    headM.castShadow = true;
    this.head.add(headM);
    // hair: a cap covering top/back, plus soft tufts
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairCap.rotation.x = -0.35;
    hairCap.position.set(0, 0.012, -0.012);
    hairCap.scale.set(1.04, 1.03, 1.06);
    hairCap.castShadow = true;
    this.head.add(hairCap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.165, 20, 14), hair);
    back.scale.set(1.08, 1.0, 0.92);
    back.position.set(0, -0.015, -0.035);
    back.castShadow = true;
    this.head.add(back);
    const tuftG = new THREE.ConeGeometry(0.045, 0.14, 8);
    const tufts = [
      [0.1, -0.1, -0.06, 0.4, 0, 0.5], [-0.1, -0.1, -0.06, 0.4, 0, -0.5], [0.0, -0.12, -0.12, 0.9, 0, 0],
      [0.06, -0.11, -0.11, 0.8, 0, 0.3], [-0.06, -0.11, -0.11, 0.8, 0, -0.3], [0.13, -0.06, 0.03, 0.1, 0, 0.35],
      [-0.13, -0.06, 0.03, 0.1, 0, -0.35], [0.02, 0.17, -0.02, -0.6, 0, 0.3],
    ];
    for (const [x, y, z, rx, ry, rz] of tufts) {
      const t = new THREE.Mesh(tuftG, hair);
      t.position.set(x, y, z);
      t.rotation.set(Math.PI + rx, ry, rz);
      if (y > 0.1) { t.rotation.set(rx, 0, rz); t.scale.set(0.6, 0.7, 0.6); }
      this.head.add(t);
    }
    this.hairTufts = this.head.children.slice(-tufts.length);

    this.cape = new Cape(capeMat);
    this.group.add(this.cape.mesh);
    this.cape.mesh.matrixAutoUpdate = false; // positions are already in world space

    this.speed = 3.45;
    this.cycleDist = 2.15; // two steps
    this.stance = 0.29;
    this.t = 0;
    this.s = 0;
    this._frame = { origin: V(), right: V(), up: V(), fwd: V() };
    this.colliders = [
      { a: V(), b: V(), r: 0.15 }, // torso
      { a: V(), r: 0.16 },         // head
      { a: V(), r: 0.09 }, { a: V(), r: 0.09 }, // knees
      { a: V(), r: 0.08 }, { a: V(), r: 0.08 }, // ankles
      { a: V(), b: V(), r: 0.17 }, // hips / skirt
    ];
    this.worldPos = V();
    this.forward = V(0, 0, -1);
  }

  placeCapsule(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const d = V().subVectors(b, a).normalize();
    mesh.quaternion.setFromUnitVectors(UP, d);
  }

  // Two-bone IK in the plane that contains the hip, the ankle and the knee direction.
  solveKnee(H, A, l1, l2, bendDir) {
    const dvec = V().subVectors(A, H);
    let d = dvec.length();
    const maxD = l1 + l2 - 1e-3;
    if (d > maxD) { dvec.multiplyScalar(maxD / d); A.copy(H).add(dvec); d = maxD; }
    const dir = dvec.clone().normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const perp = bendDir.clone().addScaledVector(dir, -bendDir.dot(dir)).normalize();
    return H.clone().addScaledVector(dir, a).addScaledVector(perp, h);
  }

  update(s, dt, t, path) {
    this.t = t; this.s = s;
    const P = path.sample(s);
    const fwd = new THREE.Vector3(P.tx, 0, P.tz);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const phi = s / this.cycleDist;
    const sig = this.stance;
    // body bob: lowest at mid-stance, highest in flight
    const bob = -0.032 * Math.cos(2 * Math.PI * (2 * phi - sig));
    const root = new THREE.Vector3(P.x, P.y, P.z);
    this.worldPos.copy(root);
    this.forward.copy(fwd);

    // --- pelvis & spine
    const lean = 0.2; // forward lean (rad)
    const twist = 0.11 * Math.sin(2 * Math.PI * phi);
    const pelvis = root.clone().addScaledVector(UP, this.hipH + bob);
    // lateral sway toward the stance foot
    pelvis.addScaledVector(right, 0.012 * Math.sin(2 * Math.PI * phi + Math.PI / 2));
    const yaw = Math.atan2(fwd.x, fwd.z);
    const pelvisQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw - twist * 0.6, 0, 'YXZ'));
    const torsoQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw + twist, 0.03 * Math.sin(2 * Math.PI * phi), 'YXZ'));
    this.torso.position.copy(pelvis);
    this.torso.quaternion.copy(torsoQ);
    this.skirt.position.copy(pelvis).addScaledVector(UP, 0.0);
    this.skirt.quaternion.copy(pelvisQ);
    this.skirt.rotateX(0.12 + 0.03 * Math.sin(4 * Math.PI * phi));

    const tUp = new THREE.Vector3(0, 1, 0).applyQuaternion(torsoQ);
    const tRight = new THREE.Vector3(1, 0, 0).applyQuaternion(torsoQ);
    const tFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);
    const neck = pelvis.clone().addScaledVector(tUp, 0.36);

    // head: stabilised, looks ahead toward the horizon
    const headPos = neck.clone().addScaledVector(tUp, 0.06).addScaledVector(UP, 0.14).addScaledVector(fwd, 0.02);
    this.head.position.copy(headPos);
    this.head.quaternion.setFromEuler(new THREE.Euler(0.05 - bob * 0.8, yaw + twist * 0.3, 0, 'YXZ'));
    // tiny hair bounce
    for (let i = 0; i < this.hairTufts.length; i++) this.hairTufts[i].rotation.y = 0.08 * Math.sin(t * 9 + i);

    // --- legs
    const hipsW = [pelvis.clone().addScaledVector(right, -0.075), pelvis.clone().addScaledVector(right, 0.075)];
    const knees = [], ankles = [];
    for (let i = 0; i < 2; i++) {
      const off = i === 0 ? 0 : 0.5;
      const pp = phi + off;
      const k = Math.floor(pp);
      const p = pp - k;
      const s0 = (k - off) * this.cycleDist;
      const sLand = s0 + (sig * this.cycleDist) / 2;
      let sf, lift = 0, pitch = 0;
      if (p < sig) {
        sf = sLand;
      } else {
        const q = (p - sig) / (1 - sig);
        const e = q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q);
        sf = sLand + this.cycleDist * e;
        lift = 0.2 * Math.pow(Math.sin(Math.PI * Math.pow(q, 0.75)), 1.1);
        pitch = -0.9 * Math.sin(Math.PI * Math.min(q * 1.6, 1)) * (1 - q) + 0.25 * smoothstep(0.7, 1, q);
      }
      const F = path.sample(sf);
      const fr = new THREE.Vector3(-F.tz, 0, F.tx);
      const lat = i === 0 ? -0.085 : 0.085;
      const footPos = new THREE.Vector3(F.x, F.y, F.z).addScaledVector(fr, lat).addScaledVector(UP, lift);
      const ankle = footPos.clone().addScaledVector(UP, 0.055);
      const knee = this.solveKnee(hipsW[i], ankle, this.l1, this.l2, fwd.clone().addScaledVector(UP, 0.1));
      this.placeCapsule(this.thigh[i], hipsW[i], knee);
      this.placeCapsule(this.shin[i], knee, ankle);
      this.foot[i].position.copy(ankle).addScaledVector(UP, -0.028);
      this.foot[i].quaternion.setFromEuler(new THREE.Euler(-pitch, Math.atan2(F.tx, F.tz), 0, 'YXZ'));
      knees.push(knee); ankles.push(ankle);
    }

    // --- arms (opposite to legs)
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const sh = neck.clone().addScaledVector(tRight, side * 0.135).addScaledVector(tUp, -0.045);
      const swing = (i === 0 ? -1 : 1) * 0.8 * Math.cos(2 * Math.PI * phi);
      const upper = new THREE.Vector3(0, -1, 0)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), swing) // forward/back swing (local)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), side * 0.18);
      upper.applyQuaternion(torsoQ);
      const elbow = sh.clone().addScaledVector(upper, this.ua);
      const bend = 1.35 + 0.25 * Math.sin(2 * Math.PI * phi + (i === 0 ? 0 : Math.PI));
      const fore = new THREE.Vector3(0, -1, 0)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), swing - bend)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), side * 0.05)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -side * 0.35);
      fore.applyQuaternion(torsoQ);
      const hand = elbow.clone().addScaledVector(fore, this.fa);
      this.placeCapsule(this.uarm[i], sh, elbow);
      this.placeCapsule(this.farm[i], elbow, hand);
      this.hand[i].position.copy(hand);
    }

    // --- cape
    const fr = this._frame;
    fr.origin.copy(neck).addScaledVector(tUp, -0.01);
    fr.right.copy(tRight); fr.up.copy(tUp); fr.fwd.copy(tFwd);
    const c = this.colliders;
    c[0].a.copy(pelvis).addScaledVector(tFwd, 0.0); c[0].b.copy(neck).addScaledVector(tUp, -0.1).addScaledVector(tFwd, 0.02);
    c[1].a.copy(headPos);
    c[2].a.copy(knees[0]); c[3].a.copy(knees[1]);
    c[4].a.copy(ankles[0]); c[5].a.copy(ankles[1]);
    c[6].a.copy(pelvis).addScaledVector(right, -0.08).addScaledVector(UP, -0.12);
    c[6].b.copy(pelvis).addScaledVector(right, 0.08).addScaledVector(UP, -0.12);
    this.cape.groundY = P.y;
    if (!this.cape.initialized) this.cape.reset(fr);
    // air velocity relative to the runner + a gentle breeze across the valley
    const breeze = new THREE.Vector3(0.7 + 0.4 * Math.sin(t * 0.37), 0.5, 0.5 + 0.3 * Math.sin(t * 0.23 + 1));
    const wind = fwd.clone().multiplyScalar(0).add(breeze);
    const sub = 3;
    const h = Math.min(dt, 1 / 30) / sub;
    for (let k = 0; k < sub; k++) {
      this.cape.t = t + k * h;
      this.cape.step(h, fr, c, wind);
    }
    this.cape.updateGeometry();
  }

  resetCloth() { this.cape.initialized = false; }
}
