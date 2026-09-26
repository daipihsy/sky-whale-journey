// The little traveller: a sculpted procedural character with smooth limbs, hair clumps, a dress,
// boots, a simulated cape and scarf, and a locomotion system that plants feet in the world
// (idle / walk / run / jump / glide / call).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, mulberry32 } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const tmpA = V(), tmpB = V(), tmpC = V();

// ---------------------------------------------------------------------------
// Materials
// a fine woven-fabric normal map shared by all cloth
let WEAVE = null;
function weaveNormal() {
  if (WEAVE) return WEAVE;
  const N = 128;
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const h = (x, y) => {
    // over-under threads: warp and weft bumps with a little irregularity
    const wx = Math.sin((x / N) * Math.PI * 2 * 24), wy = Math.sin((y / N) * Math.PI * 2 * 24);
    const over = Math.sign(Math.sin((x / N) * Math.PI * 24) * Math.sin((y / N) * Math.PI * 24));
    return (over > 0 ? Math.abs(wx) : Math.abs(wy)) * 0.8 + Math.sin(x * 0.7 + y * 1.3) * 0.05;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (h((x + 1) % N, y) - h((x + N - 1) % N, y)) * 1.2, dy = (h(x, (y + 1) % N) - h(x, (y + N - 1) % N)) * 1.2;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  WEAVE = new THREE.CanvasTexture(cv);
  WEAVE.wrapS = WEAVE.wrapT = THREE.RepeatWrapping;
  WEAVE.repeat.set(6, 6);
  return WEAVE;
}

function clothMat(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.88, metalness: 0, sheen: 0.7, sheenRoughness: 0.7,
    sheenColor: new THREE.Color(opts.sheen ?? '#fff4e0'), side: opts.side ?? THREE.FrontSide, map: opts.map ?? null,
    normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.35, 0.35),
  });
}

function capeTexture() {
  const W = 512, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#e8702f'); grd.addColorStop(0.5, '#dc5e24'); grd.addColorStop(1, '#c74f1d');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const r = mulberry32(4);
  // woven texture
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(255,220,180,${0.025 + r() * 0.02})`; g.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(120,40,10,${0.02 + r() * 0.02})`; g.fillRect(x, 0, 1, H); }
  // soft fold shading streaks
  for (let i = 0; i < 18; i++) {
    const x = r() * W;
    const lg = g.createLinearGradient(x - 20, 0, x + 20, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, `rgba(120,40,10,${0.05 + r() * 0.05})`); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(x - 20, H * 0.3, 40, H * 0.7);
  }
  // golden trim bands and motifs near the hem
  g.fillStyle = '#f3cf86'; g.fillRect(0, H * 0.88, W, H * 0.022); g.fillRect(0, H * 0.925, W, H * 0.008);
  g.fillStyle = '#b8482a'; g.fillRect(0, H * 0.965, W, H * 0.035);
  g.fillStyle = 'rgba(246,212,140,0.95)';
  for (let i = 0; i < 12; i++) {
    const x = (i + 0.5) * (W / 12), y = H * 0.83;
    g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 7, y); g.lineTo(x, y + 10); g.lineTo(x - 7, y); g.closePath(); g.fill();
    g.beginPath(); g.arc(x + W / 24, y, 2.5, 0, Math.PI * 2); g.fill();
  }
  // emblem between the shoulders
  g.strokeStyle = 'rgba(248,222,160,0.9)'; g.lineWidth = 4;
  g.beginPath(); g.arc(W / 2, H * 0.2, 22, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(W / 2, H * 0.2 - 34); g.lineTo(W / 2, H * 0.2 + 34); g.moveTo(W / 2 - 34, H * 0.2); g.lineTo(W / 2 + 34, H * 0.2); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// A smooth, tapered tube through three joints (hip-knee-ankle / shoulder-elbow-wrist)
class Limb {
  constructor(mat, radiusFn, n = 18, radial = 12) {
    this.n = n; this.radial = radial; this.radiusFn = radiusFn;
    const count = (n + 1) * (radial + 1);
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3); this.nor = new Float32Array(count * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    const uv = new Float32Array(count * 2); // for the fabric normal map
    for (let i = 0; i <= n; i++) for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; uv[k * 2] = j / radial; uv[k * 2 + 1] = (i / n) * 2.5; }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
  }
  update(a, b, c, hint) {
    const d1 = tmpA.subVectors(b, a); const L1 = d1.length(); d1.divideScalar(L1 || 1);
    const d2 = tmpB.subVectors(c, b); const L2 = d2.length(); d2.divideScalar(L2 || 1);
    const L = L1 + L2, rj = Math.min(L1, L2) * 0.35;
    const P = V(), T = V(), N = V(), B = V(), pm = V(), pp = V();
    pm.copy(b).addScaledVector(d1, -rj); pp.copy(b).addScaledVector(d2, rj);
    let k = 0;
    for (let i = 0; i <= this.n; i++) {
      const t = i / this.n, u = t * L;
      if (u < L1 - rj) { P.copy(a).addScaledVector(d1, u); T.copy(d1); }
      else if (u > L1 + rj) { P.copy(b).addScaledVector(d2, u - L1); T.copy(d2); }
      else {
        const s = (u - (L1 - rj)) / (2 * rj);
        P.copy(pm).multiplyScalar((1 - s) * (1 - s)).addScaledVector(b, 2 * (1 - s) * s).addScaledVector(pp, s * s);
        T.subVectors(b, pm).multiplyScalar(2 * (1 - s)).addScaledVector(tmpC.subVectors(pp, b), 2 * s).normalize();
      }
      N.copy(hint).addScaledVector(T, -hint.dot(T)).normalize();
      B.crossVectors(T, N);
      const r = this.radiusFn(t);
      for (let j = 0; j <= this.radial; j++) {
        const ang = (j / this.radial) * Math.PI * 2;
        const cx = Math.cos(ang), sx = Math.sin(ang);
        const nx = N.x * cx + B.x * sx, ny = N.y * cx + B.y * sx, nz = N.z * cx + B.z * sx;
        this.pos[k] = P.x + nx * r; this.pos[k + 1] = P.y + ny * r; this.pos[k + 2] = P.z + nz * r;
        this.nor[k] = nx; this.nor[k + 1] = ny; this.nor[k + 2] = nz;
        k += 3;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Verlet cloth (cape and scarf tails)
class Cloth {
  constructor(cols, rows, layoutFn, material) {
    this.cols = cols; this.rows = rows; this.layout = layoutFn;
    const n = cols * rows;
    this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      uv[(j * cols + i) * 2] = i / (cols - 1); uv[(j * cols + i) * 2 + 1] = 1 - j / (rows - 1);
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    this.cons = [];
    const add = (a, b, st) => {
      const la = layoutFn(a % cols, Math.floor(a / cols)), lb = layoutFn(b % cols, Math.floor(b / cols));
      this.cons.push([a, b, Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]), st]);
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      if (i < cols - 1) add(a, a + 1, 1);
      if (j < rows - 1) add(a, a + cols, 1);
      if (i < cols - 1 && j < rows - 1) { add(a, a + cols + 1, 0.55); add(a + 1, a + cols, 0.55); }
      if (j < rows - 2) add(a, a + cols * 2, 0.3);
      if (i < cols - 2) add(a, a + 2, 0.25);
    }
    this.ready = false;
    this.t = 0;
  }
  world(frame, i, j, out) {
    const [x, y, z] = this.layout(i, j);
    return out.copy(frame.o).addScaledVector(frame.r, x).addScaledVector(frame.u, y).addScaledVector(frame.f, z);
  }
  reset(frame) {
    const w = V();
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      this.world(frame, i, j, w);
      const k = (j * this.cols + i) * 3;
      this.p[k] = this.q[k] = w.x; this.p[k + 1] = this.q[k + 1] = w.y; this.p[k + 2] = this.q[k + 2] = w.z;
    }
    this.ready = true;
  }
  step(dt, frame, colliders, wind, groundY, drag = 1.6) {
    const { cols, rows, p, q } = this;
    const w = V();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      if (j === 0) {
        this.world(frame, i, 0, w);
        q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
        p[k] = w.x; p[k + 1] = w.y; p[k + 2] = w.z;
        continue;
      }
      const vx = (p[k] - q[k]) / dt, vy = (p[k + 1] - q[k + 1]) / dt, vz = (p[k + 2] - q[k + 2]) / dt;
      const fl = 0.75 + 0.5 * (j / rows);
      const n1 = Math.sin(this.t * 7.3 + i * 0.7 + j * 0.45) + Math.sin(this.t * 4.1 - j * 0.8 + i * 0.3);
      const kd = drag * fl;
      const ax = kd * (wind.x * (1 + 0.15 * n1) - vx);
      const ay = -9.8 + kd * 0.55 * (wind.y + 0.25 * n1 * fl - vy);
      const az = kd * (wind.z * (1 + 0.15 * n1) - vz);
      const nx = p[k] + (p[k] - q[k]) * 0.998 + ax * dt * dt;
      const ny = p[k + 1] + (p[k + 1] - q[k + 1]) * 0.998 + ay * dt * dt;
      const nz = p[k + 2] + (p[k + 2] - q[k + 2]) * 0.998 + az * dt * dt;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      p[k] = nx; p[k + 1] = ny; p[k + 2] = nz;
    }
    for (let it = 0; it < 6; it++) {
      for (const [a, b, rest, st] of this.cons) {
        const ka = a * 3, kb = b * 3;
        const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        let diff = (d - rest) / d;
        if (diff < 0) diff *= 0.3;
        diff *= 0.5 * st;
        const pa = a < cols, pb = b < cols;
        if (pa && pb) continue;
        if (pa) { p[kb] -= dx * diff * 2; p[kb + 1] -= dy * diff * 2; p[kb + 2] -= dz * diff * 2; }
        else if (pb) { p[ka] += dx * diff * 2; p[ka + 1] += dy * diff * 2; p[ka + 2] += dz * diff * 2; }
        else {
          p[ka] += dx * diff; p[ka + 1] += dy * diff; p[ka + 2] += dz * diff;
          p[kb] -= dx * diff; p[kb + 1] -= dy * diff; p[kb + 2] -= dz * diff;
        }
      }
      for (let k = cols * 3; k < p.length; k += 3) {
        for (const c of colliders) {
          let cx, cy, cz;
          if (c.b) {
            const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
            const t = clamp(((p[k] - c.a.x) * abx + (p[k + 1] - c.a.y) * aby + (p[k + 2] - c.a.z) * abz) / (abx * abx + aby * aby + abz * abz + 1e-9), 0, 1);
            cx = c.a.x + abx * t; cy = c.a.y + aby * t; cz = c.a.z + abz * t;
          } else { cx = c.a.x; cy = c.a.y; cz = c.a.z; }
          const dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < c.r * c.r) {
            const d = Math.sqrt(d2) || 1e-6, push = (c.r - d) / d;
            p[k] += dx * push; p[k + 1] += dy * push; p[k + 2] += dz * push;
          }
        }
        if (p[k + 1] < groundY + 0.02) p[k + 1] = groundY + 0.02;
      }
    }
  }
  commit() {
    this.geo.attributes.position.array.set(this.p);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ---------------------------------------------------------------------------
function buildHair(mat) {
  // clumps that lie on the scalp and fall into a soft bob, with bangs over the forehead
  const parts = [];
  const rnd = mulberry32(17);
  const R = 0.152;
  const shellPt = (theta, phi, r) => new THREE.Vector3(r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi) * 1.03, r * Math.sin(phi) * Math.cos(theta));
  const addClump = (theta, phi0, phi1, drop, width, lift = 0.012) => {
    const pts = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const phi = lerp(phi0, phi1, t);
      const th = theta + Math.sin(t * Math.PI) * 0.04 * (rnd() - 0.5);
      pts.push(shellPt(th, phi, R + lift + 0.012 * t));
    }
    // below the shell the hair falls straight down and flares out a little
    if (drop > 0) {
      const endP = pts[pts.length - 1];
      const out = new THREE.Vector3(endP.x, 0, endP.z).normalize();
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        pts.push(endP.clone().addScaledVector(out, 0.01 * t).add(new THREE.Vector3(0, -drop * t, 0)));
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = 14, radial = 6;
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = g.attributes.position;
    const w = new Float32Array(pos.count);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / (radial + 1)), t = ring / segs;
      const c = curve.getPointAt(Math.min(t, 1));
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(c).normalize();
      // flat ribbon-like clump: wide along the scalp, thin away from it, tapering to a soft point
      const radial2 = c.clone().normalize();
      const along = tmp.dot(radial2);
      const taper = width * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9))) * (1 - 0.8 * smoothstep(0.75, 1, t));
      tmp.addScaledVector(radial2, -along * 0.7).multiplyScalar(taper);
      pos.setXYZ(i, c.x + tmp.x, c.y + tmp.y, c.z + tmp.z);
      w[i] = t;
    }
    g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    parts.push(g);
  };
  // bangs: from the crown forward, ending above the eyes
  for (let i = 0; i < 11; i++) {
    const th = -0.85 + (i / 10) * 1.7 + (rnd() - 0.5) * 0.06;
    addClump(th, 0.18 + rnd() * 0.1, 1.28 + 0.12 * Math.abs(th) + rnd() * 0.08, 0, 0.034 + rnd() * 0.008);
  }
  // sides: long locks framing the face down to the jaw
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    addClump(s * (1.0 + i * 0.22), 0.25 + rnd() * 0.1, 1.95 + rnd() * 0.12, 0.03 + rnd() * 0.02, 0.04);
  }
  // back: a rounded bob ending at the nape
  for (let i = 0; i < 16; i++) {
    const th = 1.85 + (i / 15) * (Math.PI * 2 - 3.7) + (rnd() - 0.5) * 0.08;
    addClump(th, 0.12 + rnd() * 0.12, 1.9 + rnd() * 0.15, 0.02 + rnd() * 0.03, 0.045);
  }
  // crown swirl and a small cowlick
  for (let i = 0; i < 8; i++) addClump((i / 8) * Math.PI * 2 + 0.2, 0.02, 0.75 + rnd() * 0.2, 0, 0.05, 0.016);
  addClump(2.6, 0.05, 0.5, 0, 0.018, 0.04);
  const merged = mergeGeometries(parts);
  // base scalp under the clumps
  const scalp = new THREE.SphereGeometry(R + 0.006, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const sp = scalp.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) * 1.03);
  scalp.rotateX(-0.42);
  scalp.deleteAttribute('uv');
  scalp.setAttribute('aW', new THREE.BufferAttribute(new Float32Array(sp.count).fill(0.05), 1));
  const all = mergeGeometries([merged, scalp]);
  const n = all.attributes.position.count, wa = all.attributes.aW.array;
  const col = new Float32Array(n * 3);
  const root = new THREE.Color('#c99a4e'), tip = new THREE.Color('#f5dd98'), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(root).lerp(tip, Math.min(1, wa[i] * 1.1 + 0.25));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  all.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(all, mat);
  mesh.castShadow = true;
  return mesh;
}

function buildHead(skin, dark, white, blush) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.15, 40, 28);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) { const k = 1 - 0.18 * (-y / 0.15); x *= k; z *= 1 - 0.08 * (-y / 0.15); } // softer jaw
    if (z > 0.08 && y > -0.07 && y < 0.03) z -= 0.006; // gentle eye sockets
    y *= 1.03;
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const head = new THREE.Mesh(geo, skin);
  head.castShadow = true;
  g.add(head);
  // face: simple, gentle features
  const eyeG = new THREE.SphereGeometry(1, 16, 12);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeG, dark);
    eye.scale.set(0.017, 0.024, 0.008);
    eye.position.set(s * 0.05, -0.012, 0.139);
    eye.rotation.set(-0.1, s * 0.34, 0);
    g.add(eye);
    const hl = new THREE.Mesh(eyeG, white);
    hl.scale.setScalar(0.0045);
    hl.position.set(s * 0.05 + 0.006, -0.004, 0.147);
    g.add(hl);
    const bl = new THREE.Mesh(eyeG, blush);
    bl.scale.set(0.022, 0.012, 0.006);
    bl.position.set(s * 0.078, -0.052, 0.124);
    bl.rotation.y = s * 0.55;
    g.add(bl);
  }
  const nose = new THREE.Mesh(eyeG, skin);
  nose.scale.set(0.011, 0.01, 0.01);
  nose.position.set(0, -0.042, 0.148);
  g.add(nose);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 12, Math.PI), dark);
  mouth.position.set(0, -0.07, 0.137);
  mouth.rotation.set(0.25, 0, Math.PI);
  g.add(mouth);
  return g;
}

function buildBoot(mat, sole) {
  // one rounded leather shape (toe box to heel) sitting on a thin darker sole
  const g = new THREE.Group();
  const shape = (sx, sy, sz, lift) => {
    const geo = new THREE.CapsuleGeometry(1, 1.6, 8, 18);
    geo.rotateX(Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const front = smoothstep(-0.2, 1.6, z);          // toe is lower and rounder
      y = y < -0.2 ? -0.2 - (y + 0.2) * 0.12 : y * (1 - 0.35 * front);
      x *= 1 - 0.1 * smoothstep(0.5, 1.8, Math.abs(z));
      p.setXYZ(i, x * sx, y * sy + lift, z * sz);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const upper = new THREE.Mesh(shape(0.043, 0.052, 0.058, 0.04), mat);
  upper.position.z = 0.035;
  upper.castShadow = true;
  const s = new THREE.Mesh(shape(0.046, 0.03, 0.061, 0.012), sole);
  s.scale.y = 0.45;
  s.position.set(0, -0.003, 0.035);
  g.add(upper, s);
  return g;
}

// ---------------------------------------------------------------------------
export class Character {
  constructor() {
    this.group = new THREE.Group();
    const capeTex = capeTexture();
    const M = this.mats = {
      tunic: clothMat('#efe4cf'),
      legs: clothMat('#e4d8c2'),
      skin: new THREE.MeshPhysicalMaterial({ color: '#f0c4aa', roughness: 0.62, sheen: 0.35, sheenColor: new THREE.Color('#ffcfb8') }),
      hair: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 0.8, sheenRoughness: 0.4, sheenColor: new THREE.Color('#ffe6a8') }),
      leather: new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.62 }),
      sole: new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.9 }),
      gold: new THREE.MeshStandardMaterial({ color: '#e5bf72', roughness: 0.35, metalness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2d2320', roughness: 0.4 }),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      blush: new THREE.MeshBasicMaterial({ color: '#f5a898', transparent: true, opacity: 0.35, depthWrite: false }),
      cape: clothMat('#ffffff', { map: capeTex, side: THREE.DoubleSide, sheen: '#ffb27a' }),
      scarf: clothMat('#f5e3b0', { side: THREE.DoubleSide, sheen: '#fff8e0' }),
    };
    // lining colour on the inside of the cape
    M.cape.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (gl_FrontFacing) diffuseColor.rgb = diffuseColor.rgb * vec3(0.78, 0.66, 0.6);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * 0.06;`);
    };
    // hair sways with the head (secondary motion)
    M.hair.onBeforeCompile = (sh) => {
      sh.uniforms.uSwing = this.hairSwing = { value: new THREE.Vector3() };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aW;\nuniform vec3 uSwing;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += uSwing * aW * aW;');
    };
    this.hairSwing = { value: new THREE.Vector3() };

    // dimensions
    this.l1 = 0.285; this.l2 = 0.275; this.hipH = 0.53;
    this.ua = 0.185; this.fa = 0.175;

    // legs (leggings) and boots
    const legR = (t) => t < 0.5 ? lerp(0.056, 0.046, t * 2) + 0.004 * Math.sin(t * 6.28) : lerp(0.046, 0.034, (t - 0.5) * 2) + 0.006 * Math.sin((t - 0.5) * 6.28);
    this.legs = [new Limb(M.legs, legR), new Limb(M.legs, legR)];
    this.boots = [buildBoot(M.leather, M.sole), buildBoot(M.leather, M.sole)];
    const shaftG = new THREE.CylinderGeometry(0.047, 0.041, 0.13, 16, 1, true);
    shaftG.translate(0, 0.065, 0);
    const cuffG = new THREE.TorusGeometry(0.047, 0.01, 8, 18);
    cuffG.rotateX(Math.PI / 2); cuffG.translate(0, 0.13, 0);
    this.shafts = [0, 1].map(() => {
      const g = new THREE.Group();
      const s = new THREE.Mesh(shaftG, M.leather); s.castShadow = true;
      const c = new THREE.Mesh(cuffG, M.leather);
      g.add(s, c);
      return g;
    });
    // arms (sleeves) and hands
    const armR = (t) => t < 0.5 ? lerp(0.042, 0.035, t * 2) : t < 0.88 ? lerp(0.035, 0.03, (t - 0.5) / 0.38) : lerp(0.036, 0.028, (t - 0.88) / 0.12);
    this.arms = [new Limb(M.tunic, armR, 16, 10), new Limb(M.tunic, armR, 16, 10)];
    const handG = new THREE.SphereGeometry(1, 14, 10);
    this.hands = [0, 1].map(() => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(handG, M.skin); palm.scale.set(0.026, 0.034, 0.018); palm.position.y = -0.03;
      const thumb = new THREE.Mesh(handG, M.skin); thumb.scale.set(0.009, 0.016, 0.009); thumb.position.set(0.018, -0.018, 0.01); thumb.rotation.z = -0.5;
      palm.castShadow = true;
      g.add(palm, thumb);
      return g;
    });
    for (const l of [...this.legs, ...this.arms]) this.group.add(l.mesh);
    for (const o of [...this.boots, ...this.shafts, ...this.hands]) this.group.add(o);

    // torso
    this.torso = new THREE.Group();
    const tunicPts = [[0.001, -0.02], [0.118, -0.02], [0.126, 0.04], [0.122, 0.1], [0.128, 0.17], [0.13, 0.23], [0.118, 0.285], [0.085, 0.325], [0.05, 0.345], [0.001, 0.35]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const tunicG = new THREE.LatheGeometry(tunicPts, 28);
    const tunic = new THREE.Mesh(tunicG, M.tunic);
    tunic.scale.set(1.08, 1, 0.8); tunic.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.08, 14), M.skin);
    neck.position.y = 0.36;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.014, 8, 24), M.tunic);
    collar.rotation.x = Math.PI / 2; collar.position.y = 0.33; collar.scale.set(1.1, 0.9, 1);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.127, 0.014, 8, 32), M.leather);
    belt.rotation.x = Math.PI / 2; belt.scale.set(1.08, 0.8, 1); belt.position.y = 0.045;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.01), M.gold);
    buckle.position.set(0, 0.045, 0.104);
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), M.leather);
    pouch.geometry.translate(0, -0.03, 0);
    pouch.position.set(0.13, 0.04, 0.02); pouch.rotation.y = 0.5;
    this.torso.add(tunic, neck, collar, belt, buckle, pouch);
    // scarf wrap around the neck
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.028, 10, 28), M.scarf);
    wrap.rotation.x = Math.PI / 2; wrap.position.y = 0.345; wrap.scale.set(1.12, 1, 0.75);
    wrap.castShadow = true;
    this.torso.add(wrap);
    // cape cowl + clasp
    const cowlPts = [[0.1, -0.03], [0.16, -0.005], [0.172, 0.03], [0.145, 0.07], [0.1, 0.085]].map(([r, y]) => new THREE.Vector2(r, y));
    const cowl = new THREE.Mesh(new THREE.LatheGeometry(cowlPts, 28), M.cape);
    cowl.position.y = 0.28; cowl.scale.set(1.12, 1, 0.92); cowl.castShadow = true;
    const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), M.gold);
    clasp.position.set(0.05, 0.3, 0.13);
    const clasp2 = clasp.clone(); clasp2.position.set(0.075, 0.25, 0.12);
    this.torso.add(cowl, clasp, clasp2);
    this.group.add(this.torso);

    // skirt: deformable lathe, pushed by the thighs
    const skirtPts = [];
    const SR = 10;
    for (let i = 0; i <= SR; i++) {
      const t = i / SR;
      skirtPts.push(new THREE.Vector2(lerp(0.124, 0.215, Math.pow(t, 0.9)), lerp(0.03, -0.25, t)));
    }
    this.skirtGeo = new THREE.LatheGeometry(skirtPts, 36);
    this.skirtRest = this.skirtGeo.attributes.position.array.slice();
    this.skirt = new THREE.Mesh(this.skirtGeo, clothMat('#f5eee0', { side: THREE.DoubleSide }));
    this.skirt.castShadow = true;
    this.group.add(this.skirt);

    // head + hair
    this.head = buildHead(M.skin, M.dark, M.white, M.blush);
    this.hair = buildHair(M.hair);
    this.head.add(this.hair);
    this.group.add(this.head);

    // cape and scarf tails (cloth)
    this.cape = new Cloth(13, 17, (i, j) => {
      const u = i / 12 - 0.5, v = j / 16;
      const x = u * lerp(0.34, 0.7, Math.pow(v, 0.8));
      const bow = 1 - 4 * u * u;
      return [x, 0.01 - v * 0.72, -0.08 - 0.065 * bow * (1 - v * 0.4) - v * 0.05];
    }, M.cape);
    this.scarfTails = [-1, 1].map((s) => new Cloth(3, 12, (i, j) => {
      const u = i / 2 - 0.5, v = j / 11;
      return [s * 0.07 + u * 0.07, -v * 0.5, -0.07 - v * 0.02];
    }, M.scarf));
    this.group.add(this.cape.mesh, ...this.scarfTails.map((c) => c.mesh));

    // locomotion state
    this.phase = 0;
    this.feet = [0, 1].map(() => ({ plant: V(), lift: V(), pos: V(), stance: true, pitch: 0 }));
    this.feetReady = false;
    this.pelvis = V();
    this.moveW = 0; this.airW = 0; this.glideW = 0; this.callW = 0;
    this.yawRate = 0; this.prevYaw = 0;
    this.prevVel = V();
    this.lean = 0;
    this.headVel = V(); this.headPrev = V(); this.swing = V();
    this.lookAround = 0;
    this.onStep = null;
    this.colliders = [
      { a: V(), b: V(), r: 0.15 }, { a: V(), r: 0.17 },
      { a: V(), b: V(), r: 0.06 }, { a: V(), b: V(), r: 0.06 },
      { a: V(), b: V(), r: 0.08 }, { a: V(), b: V(), r: 0.08 },
      { a: V(), b: V(), r: 0.16 },
    ];
    this.worldPos = V();
    this.forward = V(0, 0, 1);
  }

  resetCloth() { this.cape.ready = false; this.scarfTails.forEach((c) => (c.ready = false)); this.feetReady = false; }

  // st: controller state; ground(x,z,yRef) -> {y, surface}
  update(dt, t, st, ground) {
    dt = Math.min(Math.max(dt, 1e-4), 1 / 20);
    const pos = st.pos, vel = st.vel;
    const speed = Math.hypot(vel.x, vel.z);
    const fwd = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.worldPos.copy(pos); this.forward.copy(fwd);
    const dir = speed > 0.05 ? new THREE.Vector3(vel.x / speed, 0, vel.z / speed) : fwd.clone();

    const k = (rate) => 1 - Math.exp(-dt * rate);
    this.moveW = lerp(this.moveW, st.grounded ? smoothstep(0.1, 0.9, speed) : this.moveW, k(8));
    this.airW = lerp(this.airW, st.grounded ? 0 : 1, k(st.grounded ? 14 : 8));
    this.glideW = lerp(this.glideW, st.gliding ? 1 : 0, k(4));
    const callEnv = st.callT < 1.6 ? smoothstep(0, 0.25, st.callT) * smoothstep(1.6, 1.0, st.callT) : 0;
    this.callW = callEnv;
    const runW = smoothstep(1.9, 3.1, speed);
    const D = lerp(lerp(0.85, 1.25, smoothstep(0.6, 1.8, speed)), 2.15, runW);
    const sig = lerp(0.62, 0.3, runW);
    const stepH = lerp(0.06, 0.19, runW);
    const accel = this.prevVel.clone().sub(vel).multiplyScalar(-1 / dt);
    this.prevVel.copy(vel);
    const yawD = Math.atan2(Math.sin(st.yaw - this.prevYaw), Math.cos(st.yaw - this.prevYaw));
    this.prevYaw = st.yaw;
    this.yawRate = lerp(this.yawRate, yawD / dt, k(6));

    // --- gait phase
    const p0 = (this.phase % 1 + 1) % 1, p1 = ((this.phase + 0.5) % 1 + 1) % 1;
    const bothDown = p0 < sig && p1 < sig;
    let settling = false;
    if (st.grounded) {
      if (speed > 0.12) this.phase += (speed * dt) / D;
      else if (!bothDown) { this.phase += dt * 1.8; settling = true; }
      else settling = true;
    }

    // --- feet
    if (!this.feetReady || (st.grounded && this._wasAir)) {
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        const lat = i === 0 ? -0.085 : 0.085;
        f.plant.copy(pos).addScaledVector(right, lat);
        f.plant.y = ground(f.plant.x, f.plant.z, pos.y + 0.5).y;
        f.pos.copy(f.plant); f.stance = true;
      }
      if (this._wasAir) { this.phase = Math.floor(this.phase) + 0.05; if (this.onStep) this.onStep(st.surface, 0.6 + (st.landImpact || 0), pos); }
      this.feetReady = true;
    }
    this._wasAir = !st.grounded;
    const T = D / Math.max(speed, 0.12);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const lat = i === 0 ? -0.085 : 0.085;
      const p = ((this.phase + (i === 0 ? 0 : 0.5)) % 1 + 1) % 1;
      if (!st.grounded) {
        // airborne: tucked for a jump, trailing for a glide
        const hip = this.pelvis.clone().addScaledVector(right, lat);
        const tuck = hip.clone().addScaledVector(UP, -0.36).addScaledVector(fwd, i === 0 ? 0.08 : -0.1);
        const trail = hip.clone().addScaledVector(UP, -0.5).addScaledVector(fwd, -0.14).addScaledVector(right, -lat * 0.3);
        const target = tuck.lerp(trail, this.glideW);
        f.pos.lerp(target, k(14));
        f.stance = false;
        f.pitch = lerp(f.pitch, -0.5, k(8));
        continue;
      }
      const inStance = p < sig;
      if (inStance && !f.stance) {
        // touchdown: plant ahead of the body so it passes over the foot
        f.plant.copy(pos).addScaledVector(right, lat);
        if (!settling) f.plant.addScaledVector(dir, (sig * D) / 2 * this.moveW);
        f.plant.y = ground(f.plant.x, f.plant.z, pos.y + 0.5).y;
        f.stance = true;
        if (this.onStep) this.onStep(st.surface, 0.35 + 0.65 * runW, f.plant);
      } else if (!inStance && f.stance) {
        f.lift.copy(f.plant); f.stance = false;
      }
      if (f.stance) { f.pos.copy(f.plant); f.pitch = lerp(f.pitch, 0, k(20)); }
      else {
        const q = (p - sig) / (1 - sig);
        const target = pos.clone().addScaledVector(right, lat);
        if (!settling) target.addScaledVector(dir, D * ((1 - q) * (1 - sig) + sig / 2) * this.moveW);
        target.y = ground(target.x, target.z, pos.y + 0.5).y;
        const e = q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q);
        f.pos.lerpVectors(f.lift, target, e);
        f.pos.y += (settling ? 0.05 : stepH) * Math.pow(Math.sin(Math.PI * Math.pow(q, 0.8)), 1.1);
        f.pitch = -0.9 * Math.sin(Math.PI * Math.min(q * 1.6, 1)) * (1 - q) * (0.4 + runW) + 0.25 * smoothstep(0.7, 1, q);
      }
    }

    // --- pelvis
    const bob = st.grounded ? -lerp(0.012, 0.032, runW) * this.moveW * Math.cos(2 * Math.PI * (2 * this.phase - sig)) : 0;
    const breathe = 0.004 * Math.sin(t * 2.1) * (1 - this.moveW);
    const land = st.landT < 0.35 ? Math.sin((st.landT / 0.35) * Math.PI) * 0.07 * (0.4 + (st.landImpact || 0)) : 0;
    const pel = pos.clone().addScaledVector(UP, this.hipH + bob + breathe - land - this.callW * 0.01);
    pel.addScaledVector(right, 0.012 * Math.sin(2 * Math.PI * this.phase + Math.PI / 2) * this.moveW);
    if (st.grounded) {
      // keep both stance feet reachable (slopes, steps)
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        const hip = pel.clone().addScaledVector(right, i === 0 ? -0.075 : 0.075);
        const horiz = Math.hypot(f.pos.x - hip.x, f.pos.z - hip.z);
        const reach = (this.l1 + this.l2) * 0.985;
        const maxY = f.pos.y + 0.055 + Math.sqrt(Math.max(0, reach * reach - horiz * horiz));
        if (pel.y > maxY) pel.y = lerp(pel.y, maxY, 0.9);
      }
    }
    this.pelvis.lerp(pel, this.pelvis.lengthSq() === 0 ? 1 : k(30));
    if (this.pelvis.distanceTo(pel) > 1) this.pelvis.copy(pel);

    // --- torso orientation
    const fwdAccel = accel.dot(fwd);
    const targetLean = lerp(0.04, 0.2, runW) * this.moveW + clamp(fwdAccel * 0.03, -0.1, 0.12) + this.glideW * 0.45 - this.callW * 0.22 + this.airW * 0.05;
    this.lean = lerp(this.lean, targetLean, k(6));
    const twist = 0.11 * Math.sin(2 * Math.PI * this.phase) * this.moveW;
    const roll = clamp(-this.yawRate * speed * 0.03, -0.25, 0.25) + 0.03 * Math.sin(2 * Math.PI * this.phase) * this.moveW;
    const torsoQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lean, st.yaw + twist, roll, 'YXZ'));
    const pelvisQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, st.yaw - twist * 0.6, roll * 0.5, 'YXZ'));
    this.torso.position.copy(this.pelvis);
    this.torso.quaternion.copy(torsoQ);
    const tUp = UP.clone().applyQuaternion(torsoQ);
    const tRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(torsoQ); // character's right
    const tFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(torsoQ);
    const neck = this.pelvis.clone().addScaledVector(tUp, 0.36);

    // --- head (stabilised, looks around when idle, up when calling)
    this.lookAround += dt;
    const idleLook = (1 - this.moveW) * (0.35 * Math.sin(this.lookAround * 0.23) * smoothstep(0.3, 0.8, Math.sin(this.lookAround * 0.11)));
    const headPos = neck.clone().addScaledVector(tUp, 0.05).addScaledVector(UP, 0.135);
    this.head.position.copy(headPos);
    this.head.quaternion.setFromEuler(new THREE.Euler(0.05 - this.lean * 0.6 - bob * 0.8 - this.callW * 0.5, st.yaw + twist * 0.3 + idleLook, 0, 'YXZ'));
    // hair secondary motion from head acceleration
    this.headVel.subVectors(headPos, this.headPrev).divideScalar(dt);
    if (this.headPrev.lengthSq() === 0 || this.headVel.length() > 20) this.headVel.set(0, 0, 0);
    this.headPrev.copy(headPos);
    const inv = this.head.quaternion.clone().invert();
    const wantSwing = this.headVel.clone().multiplyScalar(-0.012).applyQuaternion(inv);
    wantSwing.y = Math.min(wantSwing.y, 0.01);
    wantSwing.clampLength(0, 0.04);
    this.swing.lerp(wantSwing, k(9));
    this.hairSwing.value.copy(this.swing);

    // --- skirt follows the pelvis, pushed by the thighs
    this.skirt.position.copy(this.pelvis);
    this.skirt.quaternion.copy(pelvisQ);

    // --- legs (two-bone IK)
    const knees = [], ankles = [];
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const hip = this.pelvis.clone().addScaledVector(right, i === 0 ? -0.075 : 0.075);
      const ankle = f.pos.clone().addScaledVector(UP, 0.055);
      const bend = fwd.clone().addScaledVector(UP, 0.15).normalize();
      const knee = this.solveKnee(hip, ankle, this.l1, this.l2, bend);
      this.legs[i].update(hip, knee, ankle, bend);
      const footYaw = st.yaw + (i === 0 ? 0.08 : -0.08);
      this.boots[i].position.copy(ankle).addScaledVector(UP, -0.055);
      this.boots[i].quaternion.setFromEuler(new THREE.Euler(-f.pitch, footYaw, 0, 'YXZ'));
      // boot shaft along the lower shin
      const shin = V().subVectors(knee, ankle).normalize();
      this.shafts[i].position.copy(ankle).addScaledVector(shin, -0.02);
      this.shafts[i].quaternion.setFromUnitVectors(UP, shin);
      knees.push(knee); ankles.push(ankle);
    }
    this._deformSkirt(knees, pelvisQ);

    // --- arms
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // left, right
      const sh = neck.clone().addScaledVector(tRight, side * 0.128).addScaledVector(tUp, -0.05);
      const swing = side * lerp(0.15, 0.8, runW) * Math.cos(2 * Math.PI * this.phase) * this.moveW;
      // pose parameters, blended
      let fwdAng = swing + 0.08, abd = lerp(0.36, 0.26, this.moveW) + 0.03 * Math.sin(t * 2.1) * (1 - this.moveW), elbow = lerp(0.3, 1.35, runW) * this.moveW + 0.3 * (1 - this.moveW);
      fwdAng = lerp(fwdAng, 0.35, this.airW * (1 - this.glideW));
      abd = lerp(abd, 0.75, this.airW * (1 - this.glideW));
      elbow = lerp(elbow, 0.6, this.airW * (1 - this.glideW));
      fwdAng = lerp(fwdAng, -0.15, this.glideW); abd = lerp(abd, 1.45, this.glideW); elbow = lerp(elbow, 0.12, this.glideW);
      fwdAng = lerp(fwdAng, 0.5, this.callW); abd = lerp(abd, 2.15, this.callW); elbow = lerp(elbow, 0.25, this.callW);
      const upper = new THREE.Vector3(0, -1, 0)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), -side * abd)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -fwdAng)
        .applyQuaternion(torsoQ);
      // local frame of this character: +x is its left, so abduction sign flips per side
      const elbowP = sh.clone().addScaledVector(upper, this.ua);
      const fore = new THREE.Vector3(0, -1, 0)
        .applyAxisAngle(new THREE.Vector3(0, 0, 1), -side * (abd * 0.9))
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -(fwdAng + elbow))
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.3 * this.moveW)
        .applyQuaternion(torsoQ);
      const wrist = elbowP.clone().addScaledVector(fore, this.fa);
      const hint = tFwd.clone().multiplyScalar(-1).addScaledVector(UP, 0.2).normalize();
      this.arms[i].update(sh, elbowP, wrist, hint);
      this.hands[i].position.copy(wrist);
      this.hands[i].quaternion.setFromUnitVectors(UP, fore.clone().negate());
      this.colliders[2 + i].a.copy(sh); this.colliders[2 + i].b.copy(elbowP);
    }

    // --- cloth
    const frame = { o: neck.clone().addScaledVector(tUp, -0.015), r: tRight.clone().negate(), u: tUp, f: tFwd };
    // cloth layouts use +x = character's left (matching the local frame)
    const c = this.colliders;
    c[0].a.copy(this.pelvis); c[0].b.copy(neck).addScaledVector(tUp, -0.1).addScaledVector(tFwd, 0.02);
    c[1].a.copy(headPos);
    c[4].a.copy(this.pelvis).addScaledVector(right, -0.075); c[4].b.copy(knees[0]);
    c[5].a.copy(this.pelvis).addScaledVector(right, 0.075); c[5].b.copy(knees[1]);
    c[6].a.copy(this.pelvis).addScaledVector(right, -0.09).addScaledVector(UP, -0.1);
    c[6].b.copy(this.pelvis).addScaledVector(right, 0.09).addScaledVector(UP, -0.1);
    const gY = pos.y;
    if (!this.cape.ready) this.cape.reset(frame);
    const breeze = new THREE.Vector3(0.7 + 0.4 * Math.sin(t * 0.37), 0.4 + this.glideW * 3.5 + (st.vy < -2 ? 2 : 0), 0.5 + 0.3 * Math.sin(t * 0.23 + 1));
    const sub = 3, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.cape.t = t + s * h;
      this.cape.step(h, frame, c, breeze, gY, 1.6 + this.glideW * 1.5);
    }
    this.cape.commit();
    const sframe = { o: neck.clone().addScaledVector(tUp, -0.005), r: tRight.clone().negate(), u: tUp, f: tFwd };
    for (const tail of this.scarfTails) {
      if (!tail.ready) tail.reset(sframe);
      for (let s = 0; s < sub; s++) { tail.t = t + s * h + 3; tail.step(h, sframe, c, breeze, gY, 2.4); }
      tail.commit();
    }
  }

  _deformSkirt(knees, pelvisQ) {
    const inv = pelvisQ.clone().invert();
    const kl = knees.map((k) => k.clone().sub(this.pelvis).applyQuaternion(inv));
    const pos = this.skirtGeo.attributes.position.array, rest = this.skirtRest;
    for (let i = 0; i < pos.length; i += 3) {
      let x = rest[i], y = rest[i + 1], z = rest[i + 2];
      const h = smoothstep(0.03, -0.25, y);
      const r = Math.hypot(x, z) || 1e-4;
      const ox = x / r, oz = z / r;
      let push = 0;
      for (const k of kl) {
        // how far the knee reaches toward this side of the skirt at this height
        const reach = (k.x * ox + k.z * oz) * smoothstep(0.35, 0.05, Math.abs(y - k.y) * 0.8) + 0.07;
        push = Math.max(push, reach * h * 1.15 - r);
      }
      push = Math.max(0, push);
      const flare = 1 + 0.12 * h * this.moveW;
      pos[i] = (x + ox * push) * flare; pos[i + 1] = y + 0.03 * h * this.moveW; pos[i + 2] = (z + oz * push) * flare;
    }
    this.skirtGeo.attributes.position.needsUpdate = true;
    this.skirtGeo.computeVertexNormals();
  }

  solveKnee(H, A, l1, l2, bendDir) {
    const dvec = V().subVectors(A, H);
    let d = dvec.length();
    const maxD = l1 + l2 - 1e-3;
    if (d > maxD) { dvec.multiplyScalar(maxD / d); A.copy(H).add(dvec); d = maxD; }
    const dir = dvec.clone().normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const perp = bendDir.clone().addScaledVector(dir, -bendDir.dot(dir)).normalize();
    return H.clone().addScaledVector(dir, a).addScaledVector(perp, hh);
  }
}
