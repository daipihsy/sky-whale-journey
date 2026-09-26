// World layout: height field, river, journey path, terrain meshes.
import * as THREE from 'three';
import { fbm, ridged, simplex2, smoothstep, clamp, lerp, smax, smin } from './noise.js';

// ---------------------------------------------------------------------------
// Key landmarks (metres; +x right, -z = "forward" toward the castle)
export const CASTLE = { x: 240, z: -835, top: 92, radius: 108 };
export const CASTLE_FACING = Math.atan2(-0.41, 0.91); // yaw so local +Z faces the approach
// the plateau sits a little behind the castle origin so the whole citadel fits on it
export const CASTLE_SCALE = 1.35;
export const CASTLE_MESA = { x: 256.4, z: -871.5, r: 155 };
export const SIDE_MESAS = [
  { x: 40, z: -985, r: 42, top: 80 },
  { x: 470, z: -760, r: 38, top: 86 },
  { x: 690, z: -690, r: 30, top: 84 },
];
export const START_HILL = { x: -175, z: 215, r: 270, top: 46 };
export const RIDGE = { ax: 60, az: -350, bx: 169.3, bz: -678.2, h0: 14, h1: 84, w: 70 };
export const GORGE_POOL = { x: 184.1, z: -711.0, r: 22 };
export const LAKE = { x: 330, z: -150, r: 125 };
// the lake below the start cliff (two lobes that join the river)
export const LAKES = [{ x: 330, z: -150, r: 125 }, { x: 150, z: -90, r: 125 }, { x: 70, z: 110, r: 95 }];
// x of the meadow's cliff edge, as a function of z
export const cliffEdge = (z) => -52 + 22 * Math.sin(z / 70) + 8 * simplex2(z / 25, 7.1);

export const RIVER = [
  [-1400, -1150], [-900, -860], [-560, -640], [-300, -470], [-110, -360], [20, -292],
  [120, -240], [230, -190], [330, -140], [430, -30], [520, 160], [640, 420], [900, 900],
];

// Journey control points (x, z). Bridges are declared as control-point index pairs.
const PATH_PTS = [
  [-92, 214], [-100, 160], [-110, 100], [-104, 40], [-84, -18], [-60, -80],
  [-36, -140], [-12, -200], [6, -246],
  [16, -262], // bridge 1 start
  [56, -328], // bridge 1 end
  [74, -366], [98, -428], [118, -494], [138, -560], [154, -618], [166, -662],
  [172, -680], // bridge 2 start (ridge end)
  [200, -742], // bridge 2 end (castle plateau)
  [209, -760], [214, -772], [219, -788], [223, -799],
];
const BRIDGE_IDX = [[9, 10], [17, 18]];

// ---------------------------------------------------------------------------
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return [Math.sqrt(x * x + z * z), t];
}

function riverDist(x, z) {
  let best = 1e9, bestS = 0, acc = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const [d, t] = distToSegment(x, z, ax, az, bx, bz);
    const len = Math.hypot(bx - ax, bz - az);
    if (d < best) { best = d; bestS = acc + t * len; }
    acc += len;
  }
  return [best, bestS];
}

// Mountains + background (used everywhere, dominant far away)
// Big massifs: [x, z, height, radius]
const PEAKS = [
  [-520, -3300, 1500, 1250], [380, -3950, 1350, 1150], [1350, -3450, 1050, 900], [-1550, -3050, 1150, 1000],
  [-2500, -2350, 900, 900], [2350, -2800, 950, 1000], [-900, -5000, 1800, 1700], [1900, -5300, 1600, 1500],
  [-2800, -700, 650, 800], [-3200, 400, 560, 900], [2700, -1100, 700, 850], [3100, 200, 520, 900],
  [-60, -2500, 650, 600], [900, -2350, 560, 520], [-1300, -1900, 520, 560],
];
export function mountainHeight(x, z) {
  const back = smoothstep(-1150, -2300, z);
  const left = smoothstep(-900, -2300, x) * smoothstep(700, -500, z);
  const right = smoothstep(1000, 2400, x) * smoothstep(500, -700, z);
  const m = Math.max(back, left, right);
  if (m <= 0) return 0;
  let h = 0;
  for (const [px, pz, ph, pr] of PEAKS) {
    const dx = (x - px) / pr, dz = (z - pz) / pr;
    const d = Math.sqrt(dx * dx + dz * dz);
    // sharp-ish summit, broad shoulders
    const v = ph * Math.exp(-Math.pow(d, 1.35) * 1.5);
    h = smax(h, v, 120);
  }
  // ridges and gullies carved into the massifs
  const r = ridged(x / 700 + 3.1, z / 700 - 1.7, 5);
  const r2 = ridged(x / 260 - 7.3, z / 260 + 2.2, 3);
  h = h * (0.62 + 0.5 * r + 0.12 * r2) + 180 * (0.5 + 0.5 * fbm(x / 900, z / 900, 3));
  // crisp arêtes and gullies at a finer scale
  const r3 = ridged(x / 170 + 11.3, z / 170 - 4.1, 3);
  h += (r3 - 0.35) * 110 * smoothstep(300, 900, h);
  return h * m;
}

function mesa(x, z, cx, cz, r, top, sharp = 16, n = 0.12) {
  const dx = x - cx, dz = z - cz;
  const ang = Math.atan2(dz, dx);
  const rr = r * (1 + n * simplex2(Math.cos(ang) * 1.3 + cx * 0.01, Math.sin(ang) * 1.3 + cz * 0.01));
  const d = Math.sqrt(dx * dx + dz * dz);
  const k = smoothstep(rr + sharp, rr - sharp * 0.3, d);
  // stratified ledges on the cliff face only (top stays flat)
  const ledge = 1 + 0.2 * Math.sin(d * 0.35) * k * (1 - k);
  return top * Math.pow(k, 0.7) * ledge;
}

// Terrain without the road carve
export function baseHeight(x, z) {
  let h = 10 + fbm(x / 360, z / 360, 4) * 13 + fbm(x / 70, z / 70, 3) * 2.2;

  // start meadow hill
  {
    const dx = x - START_HILL.x, dz = z - START_HILL.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const k = smoothstep(START_HILL.r, 40, d);
    h = smax(h, START_HILL.top * k + fbm(x / 110, z / 110, 3) * 3 * k, 12);
  }
  // the meadow ends in a cliff on its east side, dropping to the lake shore
  {
    const zin = smoothstep(-60, -10, z) * smoothstep(340, 270, z);
    if (zin > 0) {
      const e = x - cliffEdge(z);
      const drop = smoothstep(-3, 14, e + simplex2(z / 9, x / 9) * 2) * zin;
      const low = 3.5 + fbm(x / 60, z / 60, 2) * 2;
      // stratified rock face
      const ledge = Math.sin(h * 0.7) * 0.6 * drop * (1 - drop) * 4;
      h = lerp(h, Math.min(h, low), drop) + ledge;
    }
  }
  // approach ridge from the river to the castle gorge
  {
    const [d, t] = distToSegment(x, z, RIDGE.ax, RIDGE.az, RIDGE.bx, RIDGE.bz);
    const along = ((x - RIDGE.ax) * (RIDGE.bx - RIDGE.ax) + (z - RIDGE.az) * (RIDGE.bz - RIDGE.az)) /
      ((RIDGE.bx - RIDGE.ax) ** 2 + (RIDGE.bz - RIDGE.az) ** 2);
    const endDrop = smoothstep(1.06, 0.99, along);
    const width = RIDGE.w * (1 - 0.35 * t);
    const k = smoothstep(width, width * 0.25, d) * endDrop;
    const hh = lerp(RIDGE.h0, RIDGE.h1, smoothstep(0, 1, t)) * k + fbm(x / 60, z / 60, 3) * 3 * k;
    h = smax(h, hh, 10);
  }
  // castle rear highland and flanks
  {
    const dx = x - CASTLE.x, dz = z - CASTLE.z;
    const rear = smoothstep(-860, -1300, z) * smoothstep(900, 200, Math.abs(x - 150));
    h = smax(h, rear * (70 + 140 * smoothstep(-900, -1400, z)) + fbm(x / 120, z / 120, 3) * 8, 30);
    const flank = Math.exp(-(dx * dx) / (260 * 260) - ((dz + 90) ** 2) / (200 * 200));
    h = smax(h, flank * 55, 20);
  }
  // gorge in front of the castle (a pool between ridge end and plateau)
  {
    const dx = x - GORGE_POOL.x, dz = z - GORGE_POOL.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    h = lerp(-7, h, smoothstep(GORGE_POOL.r * 0.55, GORGE_POOL.r * 1.25, d));
  }
  // castle plateau and side mesas (cliffs)
  h = smax(h, mesa(x, z, CASTLE_MESA.x, CASTLE_MESA.z, CASTLE_MESA.r, CASTLE.top, 14, 0.06), 4);
  for (const m of SIDE_MESAS) h = smax(h, mesa(x, z, m.x, m.z, m.r, m.top, 10, 0.18), 3);

  // a few rock pillars rising from the valley / lake
  for (const p of PILLARS) {
    const dx = x - p[0], dz = z - p[1];
    const d = Math.sqrt(dx * dx + dz * dz);
    const k = smoothstep(p[2] * 1.25, p[2] * 0.7, d);
    if (k > 0) h = smax(h, p[3] * k + simplex2(x / 9, z / 9) * 2 * k, 2);
  }

  // mountains
  h = Math.max(h, mountainHeight(x, z) - 20 + h * 0.2);

  // river + lake carve
  {
    const [d, s] = riverDist(x, z);
    // the valley opens into a broad silver river where the stone bridge crosses
    const cx = x - 36, cz = z + 295;
    const open = Math.exp(-(cx * cx + cz * cz) / (130 * 130));
    const w = 15 + 7 * simplex2(s / 300, 3.3) + 11 * open;
    const bank = smoothstep(w, w + 26 + 34 * open, d);
    const bed = -4.5 + 2 * smoothstep(0, w, d);
    h = lerp(bed, h, bank);
    for (const L of LAKES) {
      const lx = x - L.x, lz = z - L.z;
      const ld = Math.sqrt(lx * lx + lz * lz) * (1 + 0.12 * simplex2(Math.atan2(lz, lx) + L.x * 0.01, 1));
      h = lerp(-6, h, smoothstep(L.r * 0.75, L.r * 1.15, ld));
    }
  }
  return h;
}

export const PILLARS = [
  // x, z, radius, height
  [300, -95, 16, 26], [372, -210, 12, 20], [255, -250, 10, 14], [410, -120, 9, 12],
  [-330, -520, 20, 40], [-250, -610, 14, 30], [520, -480, 24, 55], [600, -620, 26, 70],
  [-60, -720, 22, 48], [-190, -880, 30, 70], [470, 60, 16, 22],
];

// ---------------------------------------------------------------------------
// Journey path (arc-length sampled)
export class JourneyPath {
  constructor() {
    const pts3 = PATH_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal');
    // dense sampling
    const N = 6000;
    const raw = curve.getSpacedPoints(N);
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += raw[i].distanceTo(raw[i - 1]);
    this.step = 0.5;
    const count = Math.floor(len / this.step) + 1;
    this.length = (count - 1) * this.step;
    this.x = new Float32Array(count); this.z = new Float32Array(count); this.y = new Float32Array(count);
    this.bridge = new Uint8Array(count);
    // resample uniformly
    let seg = 0, acc = 0;
    const cum = [0];
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + raw[i].distanceTo(raw[i - 1]));
    for (let k = 0; k < count; k++) {
      const s = k * this.step;
      while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
      const t = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      this.x[k] = lerp(raw[seg].x, raw[seg + 1].x, clamp(t, 0, 1));
      this.z[k] = lerp(raw[seg].z, raw[seg + 1].z, clamp(t, 0, 1));
    }
    // arc-length of control points -> bridge ranges
    const cpS = PATH_PTS.map(([px, pz]) => {
      let best = 1e9, bi = 0;
      for (let k = 0; k < count; k++) {
        const d = (this.x[k] - px) ** 2 + (this.z[k] - pz) ** 2;
        if (d < best) { best = d; bi = k; }
      }
      return bi * this.step;
    });
    this.bridges = BRIDGE_IDX.map(([a, b]) => ({ s0: cpS[a], s1: cpS[b] }));
    for (let k = 0; k < count; k++) {
      const s = k * this.step;
      for (const br of this.bridges) if (s >= br.s0 && s <= br.s1) this.bridge[k] = 1;
    }
    // heights: follow terrain, smoothed; bridges interpolated
    const hs = new Float32Array(count);
    for (let k = 0; k < count; k++) hs[k] = baseHeight(this.x[k], this.z[k]);
    const win = 36; // samples (18 m)
    const sm = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      let sum = 0, n = 0;
      for (let j = -win; j <= win; j++) {
        const q = clamp(k + j, 0, count - 1);
        const w = 1 - Math.abs(j) / (win + 1);
        sum += hs[q] * w; n += w;
      }
      sm[k] = sum / n;
    }
    // path should never dive under the water
    for (let k = 0; k < count; k++) sm[k] = Math.max(sm[k], 3.5);
    for (const br of this.bridges) {
      const k0 = Math.round(br.s0 / this.step), k1 = Math.round(br.s1 / this.step);
      br.y0 = sm[k0]; br.y1 = sm[k1];
    }
    // bridge 1 deck height (over the river)
    const b1 = this.bridges[0];
    b1.y0 = b1.y1 = Math.max(b1.y0, b1.y1, 11);
    // bridge 2 lands on the castle plateau
    const b2 = this.bridges[1];
    b2.y1 = CASTLE.top + 0.4;
    b2.y0 = Math.max(b2.y0, b2.y1 - 7);
    for (const br of this.bridges) {
      const k0 = Math.round(br.s0 / this.step), k1 = Math.round(br.s1 / this.step);
      for (let k = k0; k <= k1; k++) {
        const t = (k - k0) / (k1 - k0);
        sm[k] = lerp(br.y0, br.y1, t) + Math.sin(t * Math.PI) * 0.8;
      }
      // blend approach ramps
      const ramp = 60;
      for (let j = 1; j <= ramp; j++) {
        const w = smoothstep(ramp, 0, j);
        if (k0 - j >= 0) sm[k0 - j] = lerp(sm[k0 - j], br.y0, w);
        if (k1 + j < count) sm[k1 + j] = lerp(sm[k1 + j], br.y1, w);
      }
    }
    // plateau end is flat
    const plateauK = Math.round(this.bridges[1].s1 / this.step);
    for (let k = plateauK; k < count; k++) sm[k] = CASTLE.top + 0.4;
    this.y.set(sm);

    // spatial hash for nearest-point queries
    this.cell = 16;
    this.hash = new Map();
    for (let k = 0; k < count; k++) {
      const key = this._key(Math.floor(this.x[k] / this.cell), Math.floor(this.z[k] / this.cell));
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, arr = []);
      arr.push(k);
    }
  }
  _key(i, j) { return i * 73856093 ^ j * 19349663; }

  nearest(x, z, maxR = 40) {
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    const rr = Math.ceil(maxR / this.cell);
    let best = 1e18, bk = -1;
    for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
      const arr = this.hash.get(this._key(ci + i, cj + j));
      if (!arr) continue;
      for (const k of arr) {
        const d = (this.x[k] - x) ** 2 + (this.z[k] - z) ** 2;
        if (d < best) { best = d; bk = k; }
      }
    }
    if (bk < 0) return null;
    return { d: Math.sqrt(best), k: bk, s: bk * this.step };
  }

  sample(s, out = {}) {
    const f = clamp(s / this.step, 0, this.x.length - 1.001);
    const k = Math.floor(f), t = f - k;
    out.x = lerp(this.x[k], this.x[k + 1], t);
    out.y = lerp(this.y[k], this.y[k + 1], t);
    out.z = lerp(this.z[k], this.z[k + 1], t);
    // tangent from a wider window for smoothness
    const a = clamp(k - 2, 0, this.x.length - 1), b = clamp(k + 3, 0, this.x.length - 1);
    let tx = this.x[b] - this.x[a], tz = this.z[b] - this.z[a];
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l; out.tz = tz / l;
    return out;
  }

  // Smoothed heading looking ahead `ahead` metres
  heading(s, ahead = 30) {
    let tx = 0, tz = 0;
    const p0 = this.sample(s);
    for (let i = 1; i <= 6; i++) {
      const p = this.sample(s + (ahead * i) / 6);
      tx += p.x - p0.x; tz += p.z - p0.z;
    }
    return Math.atan2(tx, -tz); // yaw: 0 = -Z, positive = toward +x
  }

  isBridge(s) {
    for (const br of this.bridges) if (s >= br.s0 && s <= br.s1) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Final height = base + road carve (cached on a grid for the near region)
export const NEAR = { x0: -820, x1: 820, z0: -1320, z1: 420, step: 4 };

export class HeightField {
  constructor(path) {
    this.path = path;
    const nx = Math.round((NEAR.x1 - NEAR.x0) / NEAR.step) + 1;
    const nz = Math.round((NEAR.z1 - NEAR.z0) / NEAR.step) + 1;
    this.nx = nx; this.nz = nz;
    this.h = new Float32Array(nx * nz);
    this.road = new Float32Array(nx * nz);
    this.pathDist = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = NEAR.z0 + j * NEAR.step;
      for (let i = 0; i < nx; i++) {
        const x = NEAR.x0 + i * NEAR.step;
        const idx = j * nx + i;
        let h = baseHeight(x, z);
        const n = path.nearest(x, z, 48);
        let road = 0, pd = 999;
        if (n) {
          pd = n.d;
          const onBridge = path.isBridge(n.s - 3) && path.isBridge(n.s + 3);
          if (!onBridge) {
            const py = path.y[n.k] - 0.05;
            const w = smoothstep(26, 7, n.d);
            h = lerp(h, py, w);
            road = smoothstep(2.9, 1.4, n.d + simplex2(x * 0.35, z * 0.35) * 0.45);
          }
        }
        this.h[idx] = h;
        this.road[idx] = road;
        this.pathDist[idx] = pd;
      }
    }
  }

  // Height matching the rendered triangle mesh exactly (inside the near region)
  height(x, z) {
    const fx = (x - NEAR.x0) / NEAR.step, fz = (z - NEAR.z0) / NEAR.step;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return baseHeight(x, z);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const nx = this.nx;
    const h00 = this.h[j * nx + i], h10 = this.h[j * nx + i + 1];
    const h01 = this.h[(j + 1) * nx + i], h11 = this.h[(j + 1) * nx + i + 1];
    // triangulation: (00,01,10) and (01,11,10)
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normal(x, z, e = 1.5) {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }

  roadAt(x, z) {
    const fx = clamp(Math.round((x - NEAR.x0) / NEAR.step), 0, this.nx - 1);
    const fz = clamp(Math.round((z - NEAR.z0) / NEAR.step), 0, this.nz - 1);
    return this.road[fz * this.nx + fx];
  }
  pathDistAt(x, z) {
    const fx = clamp(Math.round((x - NEAR.x0) / NEAR.step), 0, this.nx - 1);
    const fz = clamp(Math.round((z - NEAR.z0) / NEAR.step), 0, this.nz - 1);
    return this.pathDist[fz * this.nx + fx];
  }

  // Float texture of heights for GPU (grass/water)
  makeTexture() {
    const tex = new THREE.DataTexture(this.h, this.nx, this.nz, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}

// ---------------------------------------------------------------------------
// Terrain colouring
const C = (hex) => new THREE.Color(hex);
const PAL = {
  grassSun: C('#9fc257'), grassMid: C('#6d9b43'), grassDeep: C('#3f7542'), grassBlue: C('#3f6f5c'),
  forest: C('#3f6450'), rock: C('#a7a397'), rockDark: C('#737985'), rockWarm: C('#b9ab93'),
  strata: C('#c8bca5'), road: C('#d9caa2'), roadEdge: C('#bca97e'), sand: C('#a89c7c'),
  snow: C('#f3f6fb'), snowShade: C('#c7d2e8'), mtnRock: C('#8c90a0'), mtnRock2: C('#a7a3a6'),
  riverbed: C('#6d8a86'),
};

function terrainColor(out, x, y, z, nY, road, pathDist, far) {
  const slope = 1 - nY; // 0 flat .. 1 vertical
  const n1 = fbm(x / 55, z / 55, 3), n2 = simplex2(x / 13, z / 13);
  const c = out;
  // grass base
  c.copy(PAL.grassMid).lerp(PAL.grassSun, clamp(0.5 + n1 * 0.8 + (y - 20) / 120, 0, 1));
  c.lerp(PAL.grassDeep, clamp(0.35 - n1 * 0.9 + n2 * 0.1, 0, 0.8));
  // bluish tint in low valleys
  c.lerp(PAL.grassBlue, clamp((12 - y) / 30, 0, 0.5));
  // sand near water
  c.lerp(PAL.sand, smoothstep(1.4, 0.2, y) * 0.75);
  if (y < -0.5) c.lerp(PAL.riverbed, 0.8);
  // cliffs
  const rockW = smoothstep(0.28, 0.5, slope + n2 * 0.06);
  if (rockW > 0) {
    const band = 0.5 + 0.5 * Math.sin(y * 0.55 + n1 * 3);
    const rc = PAL.rock.clone().lerp(PAL.strata, band * 0.6).lerp(PAL.rockDark, clamp(0.35 - n1, 0, 0.6));
    c.lerp(rc, rockW);
  }
  // road
  if (road > 0) {
    const rc = PAL.roadEdge.clone().lerp(PAL.road, clamp(road * 1.3 - 0.2 + n2 * 0.15, 0, 1));
    c.lerp(rc, road * 0.95);
  }
  // mountain snow/rock
  if (far || y > 180) {
    const mt = smoothstep(150, 320, y);
    const rock = PAL.mtnRock.clone().lerp(PAL.mtnRock2, clamp(0.5 + n1, 0, 1));
    c.lerp(rock, mt * smoothstep(0.08, 0.3, slope) * 0.9 + mt * 0.25);
    const snowLine = 330 + n1 * 110;
    const snow = smoothstep(snowLine, snowLine + 140, y) * smoothstep(0.72, 0.4, slope + n2 * 0.08);
    const snowHigh = smoothstep(750, 1050, y) * 0.75;
    c.lerp(PAL.snow, clamp(snow + snowHigh * smoothstep(0.8, 0.5, slope), 0, 1));
  }
  return c;
}

function buildGridGeometry(nx, nz, x0, z0, step, heightFn, extra) {
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const idx = j * nx + i;
    const x = x0 + i * step, z = z0 + j * step;
    pos[idx * 3] = x; pos[idx * 3 + 1] = heightFn(i, j, x, z); pos[idx * 3 + 2] = z;
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = j * nx + i + 1, c = (j + 1) * nx + i, d = (j + 1) * nx + i + 1;
    // (00,01,10) and (01,11,10) -> counter-clockwise seen from +Y
    index[p++] = a; index[p++] = c; index[p++] = b;
    index[p++] = c; index[p++] = d; index[p++] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

// Tileable detail texture: R grass clumps, G rock strata/cracks, B dirt & pebbles, A soft noise
function makeDetailTexture() {
  const N = 512;
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  const seam = (fn, x, y) => {
    // seamless tiling by blending four offset copies
    const u = x / N, v = y / N;
    return fn(x, y) * (1 - u) * (1 - v) + fn(x + N, y) * u * (1 - v) + fn(x, y + N) * (1 - u) * v + fn(x + N, y + N) * u * v;
  };
  const grass = (x, y) => 0.5 + 0.35 * fbm(x / 40, y / 40, 4) + 0.25 * simplex2(x / 3.2, y / 9);
  const rock = (x, y) => {
    const strata = Math.sin(y / 9 + fbm(x / 60, y / 60, 3) * 5) * 0.5 + 0.5;
    const crack = 1 - Math.pow(Math.abs(simplex2(x / 34, y / 22)), 0.25);
    return 0.35 + 0.35 * strata * 0.6 + 0.3 * fbm(x / 18, y / 18, 3) - crack * 0.35;
  };
  const dirt = (x, y) => {
    const peb = Math.pow(Math.max(0, simplex2(x / 5, y / 5)), 2) * 0.9;
    return 0.45 + 0.25 * fbm(x / 25, y / 25, 3) + peb * 0.5;
  };
  const soft = (x, y) => 0.5 + 0.5 * fbm(x / 70, y / 70, 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    img.data[i] = clamp(seam(grass, x, y), 0, 1) * 255;
    img.data[i + 1] = clamp(seam(rock, x, y), 0, 1) * 255;
    img.data[i + 2] = clamp(seam(dirt, x, y), 0, 1) * 255;
    img.data[i + 3] = clamp(seam(soft, x, y), 0, 1) * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export const MTN = { x0: -5600, x1: 5600, z0: -6800, z1: -1100, step: 18 };

function terrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const detail = makeDetailTexture();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nvarying vec3 vTerrWorld; varying vec3 vMat; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vTerrWorld = (modelMatrix * vec4(transformed,1.0)).xyz; vMat = aMat; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
varying vec3 vTerrWorld; varying vec3 vMat; varying vec3 vWN;
float terrH;
vec3 perturbNormalTerr(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos)), vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
float triRock(vec3 p, vec3 bw, float sc) {
  return texture2D(uDetail, p.zy * sc).g * bw.x + texture2D(uDetail, p.xz * sc).g * bw.y + texture2D(uDetail, p.xy * sc).g * bw.z;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wp = vTerrWorld;
  float d = length(wp - cameraPosition);
  vec3 bw = pow(abs(normalize(vWN)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  vec4 g1 = texture2D(uDetail, wp.xz * 0.23);
  vec4 g2 = texture2D(uDetail, wp.xz * 0.037);
  float grass = mix(g1.r, g2.r, 0.45);
  float dirt = g1.b * 0.7 + g2.b * 0.3;
  float nearW = 1.0 - smoothstep(60.0, 420.0, d);
  float rock = 0.5;
  if (vMat.y > 0.02) { // only rocky surfaces pay for the triplanar samples
    float rockF = triRock(wp, bw, 0.011) * 0.6 + triRock(wp, bw, 0.0024) * 0.4;
    rock = nearW > 0.01 ? mix(rockF, triRock(wp, bw, 0.09) * 0.55 + rockF * 0.45, nearW) : rockF;
  }
  float det = mix(grass, dirt, vMat.x);
  det = mix(det, rock, vMat.y);
  det = mix(det, 0.55 + (g2.a - 0.5) * 0.35, vMat.z);
  // detail fades to a softer macro variation in the distance, except for rock which stays crisp
  float strength = mix(0.18 + 0.42 * vMat.y, 0.7, nearW);
  diffuseColor.rgb *= 1.0 + (det - 0.55) * strength * 1.3;
  // macro tone patches that break up large meadows
  diffuseColor.rgb *= 0.9 + 0.2 * texture2D(uDetail, wp.xz * 0.0031).a;
  terrH = det * (nearW * 0.9 + vMat.y * 0.6);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(terrH), dFdy(terrH)) * 1.6;
  normal = perturbNormalTerr(-vViewPosition, normal, dH, faceDirection);
}`);
  };
  return mat;
}

function addMaterialWeights(geo, getRoad) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const m = new Float32Array(pos.length);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ny = nor[v * 3 + 1];
    const slope = 1 - ny;
    const n2 = simplex2(x / 13, z / 13);
    const rock = Math.max(smoothstep(0.26, 0.48, slope + n2 * 0.06), smoothstep(150, 320, y) * smoothstep(0.05, 0.25, slope));
    const snowLine = 330 + fbm(x / 55, z / 55, 3) * 110;
    const snow = Math.max(smoothstep(snowLine, snowLine + 140, y) * smoothstep(0.72, 0.4, slope + n2 * 0.08), smoothstep(750, 1050, y) * 0.75 * smoothstep(0.8, 0.5, slope));
    m[v * 3] = getRoad(v); m[v * 3 + 1] = rock * (1 - snow); m[v * 3 + 2] = snow;
  }
  geo.setAttribute('aMat', new THREE.BufferAttribute(m, 3));
}

export function buildTerrain(hf) {
  const group = new THREE.Group();
  const tmp = new THREE.Color();
  const insideNear = (x, z) => Math.min(x - NEAR.x0, NEAR.x1 - x, z - NEAR.z0, NEAR.z1 - z);

  // near terrain
  const near = buildGridGeometry(hf.nx, hf.nz, NEAR.x0, NEAR.z0, NEAR.step, (i, j) => hf.h[j * hf.nx + i]);
  {
    const pos = near.attributes.position.array, nor = near.attributes.normal.array;
    const col = new Float32Array(pos.length);
    for (let v = 0; v < pos.length / 3; v++) {
      terrainColor(tmp, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], nor[v * 3 + 1], hf.road[v], hf.pathDist[v], false);
      col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b;
    }
    near.setAttribute('color', new THREE.BufferAttribute(col, 3));
    addMaterialWeights(near, (v) => hf.road[v]);
  }

  const colourFar = (geo) => {
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
    const col = new Float32Array(pos.length);
    for (let v = 0; v < pos.length / 3; v++) {
      terrainColor(tmp, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], nor[v * 3 + 1], 0, 999, true);
      const y = pos[v * 3 + 1];
      const fo = smoothstep(420, 200, y) * smoothstep(0.55, 0.2, 1 - nor[v * 3 + 1]) * clamp(0.5 + fbm(pos[v * 3] / 400, pos[v * 3 + 2] / 400, 2), 0, 1);
      tmp.lerp(PAL.forest, fo * 0.75);
      col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    addMaterialWeights(geo, () => 0);
  };

  // the snow mountains: a finer mesh for the ranges behind the castle
  const mnx = Math.round((MTN.x1 - MTN.x0) / MTN.step) + 1, mnz = Math.round((MTN.z1 - MTN.z0) / MTN.step) + 1;
  const mtn = buildGridGeometry(mnx, mnz, MTN.x0, MTN.z0, MTN.step, (i, j, x, z) => {
    const inside = insideNear(x, z);
    const h = baseHeight(x, z);
    if (inside > MTN.step * 1.2) return h - 80;
    if (inside > -MTN.step * 0.2) return h - 3;
    return h;
  });
  colourFar(mtn);

  // far terrain (horizon) — hidden under the finer meshes inside their bounds
  const FAR = { x0: -9000, z0: -12000, size: 18000, n: 300 };
  const step = FAR.size / (FAR.n - 1);
  const far = buildGridGeometry(FAR.n, FAR.n, FAR.x0, FAR.z0, step, (i, j, x, z) => {
    const inside = Math.max(insideNear(x, z), Math.min(x - MTN.x0, MTN.x1 - x, z - MTN.z0, MTN.z1 - z));
    const h = baseHeight(x, z);
    if (inside > step * 1.2) return h - 120;
    if (inside > -step * 0.2) return h - 6;
    return h;
  });
  colourFar(far);

  const mat = terrainMaterial();
  const nearMesh = new THREE.Mesh(near, mat);
  nearMesh.receiveShadow = true;
  const mtnMesh = new THREE.Mesh(mtn, mat);
  const farMesh = new THREE.Mesh(far, mat);
  group.add(nearMesh, mtnMesh, farMesh);
  group.userData.nearMesh = nearMesh;
  return group;
}
