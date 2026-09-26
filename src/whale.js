// The sky whale, after the "Sky Whale" model sheet: a humpback whose slate-blue back carries
// drifting cloud patterns, a white pleated belly, rows of tubercles on the rostrum and jaw,
// long scalloped flippers, serrated flukes and a thin gold rim of light.
// It swims a smooth loop behind the castle; its spine follows the path so it bends, banks and
// steers with its flippers through the turns. At night it glows with bioluminescence.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32, simplex2, fbm } from './noise.js';
import { SKY } from './atmosphere.js';

// Body shape, measured off the model sheet. Per station u (0 = rostrum tip, 1 = fluke notch), as
// fractions of the length: the back line, the belly line, the half-width, the height of the widest
// point and (on the head) the height of the mouth line. The back runs almost straight from the flat
// rostrum to the dorsal hump; under the thin upper jaw hangs the deep lower jaw and pleated throat,
// deepest a little before mid-body; the tail stock is long and flattened side to side.
//      u      yTop    yBot    hw      yW      yM
const SHAPE = [
  [0.000, 0.050, 0.048, 0.000, 0.049, 0.049],
  [0.003, 0.056, 0.042, 0.010, 0.048, 0.048],
  [0.010, 0.064, 0.033, 0.019, 0.046, 0.047],
  [0.022, 0.073, 0.022, 0.030, 0.044, 0.046],
  [0.040, 0.081, 0.008, 0.042, 0.040, 0.045],
  [0.080, 0.089, -0.013, 0.064, 0.033, 0.042],
  [0.140, 0.093, -0.039, 0.092, 0.024, 0.038],
  [0.230, 0.095, -0.067, 0.110, 0.013, 0.034],
  [0.320, 0.095, -0.089, 0.121, 0.003, 0.020],
  [0.410, 0.091, -0.099, 0.124, -0.005, 0.0],
  [0.500, 0.086, -0.097, 0.117, -0.006, 0.0],
  [0.590, 0.078, -0.087, 0.100, -0.004, 0.0],
  [0.660, 0.071, -0.073, 0.082, -0.002, 0.0],
  [0.730, 0.061, -0.057, 0.061, 0.000, 0.0],
  [0.810, 0.048, -0.043, 0.041, 0.001, 0.0],
  [0.860, 0.038, -0.033, 0.031, 0.002, 0.0],
  [0.930, 0.024, -0.021, 0.020, 0.001, 0.0],
  [0.970, 0.015, -0.013, 0.014, 0.000, 0.0],
  [1.000, 0.007, -0.006, 0.007, 0.000, 0.0],
];
function section(u) {
  u = clamp(u, 0, 1);
  let i = 0;
  while (i < SHAPE.length - 2 && SHAPE[i + 1][0] < u) i++;
  const a = SHAPE[i], b = SHAPE[i + 1], p0 = SHAPE[Math.max(0, i - 1)], p3 = SHAPE[Math.min(SHAPE.length - 1, i + 2)];
  const t = (u - a[0]) / (b[0] - a[0]), t2 = t * t, t3 = t2 * t;
  // monotone-ish Catmull-Rom through the measured stations
  const v = (k) => 0.5 * (2 * a[k] + (-p0[k] + b[k]) * t + (2 * p0[k] - 5 * a[k] + 4 * b[k] - p3[k]) * t2 + (-p0[k] + 3 * a[k] - 3 * b[k] + p3[k]) * t3);
  const yTop = v(1), yBot = Math.min(v(2), yTop), hw = Math.max(0, v(3));
  const yW = clamp(v(4), yBot, yTop), yM = v(5);
  // flat, broad rostrum and a U-shaped jaw on the head; a rounder body; keeled tail stock
  const eTop = lerp(lerp(lerp(2.3, 3.2, smoothstep(0.0, 0.07, u)), 2.3, smoothstep(0.2, 0.45, u)), 1.75, smoothstep(0.78, 0.95, u));
  const eBot = lerp(lerp(2.25, 2.0, smoothstep(0.3, 0.5, u)), 1.75, smoothstep(0.78, 0.95, u));
  const head = smoothstep(0.35, 0.29, u);
  return { yTop, yBot, hw, yW, yM, eTop, eBot, head };
}
// a point on the skin at angle a (0 = along the back, pi = belly), in fractions of the length (x forward)
function surfacePoint(u, a, sec = section(u)) {
  const s = Math.sin(a), c = Math.cos(a);
  const e = c >= 0 ? sec.eTop : sec.eBot;
  const py = Math.pow(Math.abs(c), 2 / e), pz = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
  const y = c >= 0 ? sec.yW + (sec.yTop - sec.yW) * py : sec.yW - (sec.yW - sec.yBot) * py;
  let z = sec.hw * pz;
  // the upper jaw sits inside the wider lower jaw: the lips flare out along the mouth line
  if (sec.head > 0) z *= 1 - 0.11 * sec.head * smoothstep(sec.yM - 0.002, sec.yM + 0.014, y);
  return [0.5 - u, y, z];
}
// angle (from the top) of the mouth line along the head
function mouthAngle(u) {
  const sec = section(Math.min(u, 0.33));
  const f = clamp((sec.yM - sec.yW) / Math.max(1e-4, sec.yTop - sec.yW), 0, 1);
  return Math.acos(Math.pow(f, sec.eTop / 2));
}
// where the white belly meets the blue back (angle from the top): the whole lower jaw is white
function bellyLine(u) {
  if (u < 0.3) return mouthAngle(u) + 0.03;
  if (u < 0.38) return lerp(mouthAngle(0.3) + 0.03, 1.95, smoothstep(0.3, 0.38, u));
  if (u < 0.5) return lerp(1.95, 2.02, (u - 0.38) / 0.12);
  if (u < 0.62) return lerp(2.02, 2.25, (u - 0.5) / 0.12);
  if (u < 0.75) return lerp(2.25, 2.55, (u - 0.62) / 0.13);
  return lerp(2.55, 2.85, smoothstep(0.75, 0.95, u));
}
const EYE = [0.285, mouthAngle(0.285) - 0.17]; // u, angle from top: just above the end of the mouth
const PLEAT_F = 40; // throat pleats per radian

// Tubercles: rows along the rostrum and the upper jaw, a row under the mouth line, a cluster on the chin.
// [u, signed angle from the top, height (fraction of length)]
function makeKnobs() {
  const r = mulberry32(21), k = [];
  const row = (u0, u1, step, angle, h) => {
    for (let u = u0 + r() * step * 0.5; u < u1; u += step * (0.8 + r() * 0.4)) k.push([u, angle(u) + (r() - 0.5) * 0.05, h * (0.75 + r() * 0.5)]);
  };
  row(0.012, 0.2, 0.012, () => 0, 0.0036);
  for (const s of [-1, 1]) {
    row(0.018, 0.2, 0.012, () => s * 0.22, 0.0033);
    row(0.022, 0.19, 0.013, () => s * 0.46, 0.003);
    row(0.012, 0.24, 0.012, (u) => s * (mouthAngle(u) - 0.14), 0.0028);
    row(0.008, 0.2, 0.011, (u) => s * (mouthAngle(u) + 0.12), 0.0026);
  }
  for (let i = 0; i < 24; i++) k.push([0.004 + r() * 0.06, Math.PI + (r() - 0.5) * 1.2, 0.0024 + r() * 0.0014]);
  return k;
}
const KNOBS = makeKnobs();

// ----------------------------------------------------------------------------- skin textures
function makeSkin(L) {
  const W = 2048, H = 1024;
  const col = document.createElement('canvas'); col.width = W; col.height = H;
  const g = col.getContext('2d');
  const hgt = new Float32Array(W * H); // height field for the normal map

  // A painterly, natural humpback skin: deep slate blue along the spine easing to soft blue-grey
  // flanks, a misty band that melts into the white pleated belly, and gentle value variation.
  const img = g.createImageData(W, H);
  const C = (h) => new THREE.Color(h);
  const spine = C('#3a4a72'), back = C('#566b99'), flank = C('#7a8fbb'), mist = C('#a9b9d8');
  const belly = C('#eef1f6'), warmBelly = C('#f6f1e7'), pleatC = C('#b3bdd2');
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let y = 0; y < H; y++) {
    const v = y / H, ang = v * Math.PI * 2;
    const aa = ang > Math.PI ? Math.PI * 2 - ang : ang;
    const rel = ang - Math.PI;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const n = fbm(u * 14, aa * 2.4, 3), n2 = fbm(u * 60 + 7, aa * 10, 2);
      const bl = bellyLine(u) + n * 0.1 + 0.03 * Math.sin(u * 40 + aa * 2);
      c.copy(spine).lerp(back, smoothstep(0.0, 0.9, aa)).lerp(flank, smoothstep(0.8, bl - 0.1, aa));
      c.lerp(mist, smoothstep(bl - 0.45, bl - 0.02, aa) * 0.55);
      c.multiplyScalar((1 + n * 0.1 + n2 * 0.04) * (1 - 0.08 * smoothstep(0.7, 0.95, u)));
      let groove = 0;
      const wBelly = smoothstep(bl - 0.015, bl + 0.035, aa);
      if (wBelly > 0) {
        tmp.copy(belly).lerp(warmBelly, smoothstep(0.12, 0.0, u) * 0.6 + n * 0.2);
        const pz = smoothstep(0.012, 0.05, u) * smoothstep(0.52, 0.4, u) * smoothstep(bl + 0.02, bl + 0.18, aa);
        groove = pz * (1 - smoothstep(0.0, 0.3, Math.abs(Math.sin(rel * PLEAT_F + u * 5))));
        tmp.lerp(pleatC, groove * 0.75);
        c.lerp(tmp, wBelly);
      }
      const i = (y * W + x) * 4;
      img.data[i] = c.r * 255; img.data[i + 1] = c.g * 255; img.data[i + 2] = c.b * 255; img.data[i + 3] = 255;
      hgt[y * W + x] = fbm(u * 120, v * 60, 2) * 0.12 - groove * 1.1;
    }
  }
  g.putImageData(img, 0, 0);
  const rnd = mulberry32(7);
  const vOf = (aa, side) => (side > 0 ? aa / (Math.PI * 2) : 1 - aa / (Math.PI * 2));
  // soft pale dapples: densest just above the belly line, sparse and fine along the back
  for (let i = 0; i < 6500; i++) {
    const u = 0.03 + rnd() * 0.92, side = rnd() < 0.5 ? 1 : -1;
    const bl = bellyLine(u), g1 = rnd() + rnd() + rnd() - 1.5; // ~gaussian
    const aa = clamp(bl - Math.abs(g1) * 0.55 - 0.02, 0.02, Math.PI);
    const near = smoothstep(bl - 0.7, bl, aa);
    const r = (0.8 + rnd() * rnd() * 3.2) * (0.6 + 0.6 * near), a = (0.12 + rnd() * 0.4) * (0.35 + 0.65 * near);
    const x = u * W, y = vOf(aa, side) * H;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(238,242,250,${a})`); gr.addColorStop(1, 'rgba(238,242,250,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // a hint of sky: faint, blurred streaks flowing back along the flanks
  g.save();
  g.filter = 'blur(6px)';
  g.lineCap = 'round';
  for (let i = 0; i < 44; i++) {
    const side = rnd() < 0.5 ? 1 : -1, u0 = 0.18 + rnd() * 0.6, len = 0.06 + rnd() * 0.16;
    const aa0 = 0.55 + rnd() * (bellyLine(u0) - 0.8), bend = (rnd() - 0.5) * 0.25;
    g.strokeStyle = `rgba(232,239,252,${0.08 + rnd() * 0.12})`;
    g.lineWidth = 4 + rnd() * 12;
    g.beginPath();
    g.moveTo(u0 * W, vOf(aa0, side) * H);
    g.quadraticCurveTo((u0 + len * 0.5) * W, vOf(aa0 + bend, side) * H, (u0 + len) * W, vOf(aa0 + bend * 0.4 + 0.05, side) * H);
    g.stroke();
  }
  g.restore();
  // a few faint, curved rake scars
  for (let i = 0; i < 12; i++) {
    const side = rnd() < 0.5 ? 1 : -1, u0 = 0.25 + rnd() * 0.5, aa0 = 0.7 + rnd() * 0.9;
    const x = u0 * W, y = vOf(aa0, side) * H, len = 25 + rnd() * 50, ang = (rnd() - 0.5) * 0.6, bow = (rnd() - 0.5) * 10;
    g.strokeStyle = `rgba(222,229,242,${0.08 + rnd() * 0.12})`; g.lineWidth = 0.8 + rnd() * 0.8;
    for (let k = 0; k < 1 + Math.floor(rnd() * 2); k++) {
      const oy = k * (3 + rnd() * 3);
      g.beginPath(); g.moveTo(x, y + oy);
      g.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, y + oy + Math.sin(ang) * len * 0.5 + bow, x + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
      g.stroke();
    }
  }
  const at = (u, a) => [u * W, (((a / (Math.PI * 2)) % 1) + 1) % 1 * H];
  // mouth line
  g.strokeStyle = 'rgba(40,50,78,0.85)'; g.lineWidth = 2.2;
  for (const s of [1, -1]) {
    g.beginPath();
    for (let u = 0.002; u < 0.335; u += 0.002) { const [x, y] = at(u, s * mouthAngle(u)); u < 0.004 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  }
  // tubercles: dark knobs with a light top
  for (const [ku, ka, kh] of KNOBS) {
    const [x, y] = at(ku, ka), r = 3 + (kh / 0.0036) * 3.5;
    for (const oy of [-H, 0, H]) {
      const gr = g.createRadialGradient(x - r * 0.25, y + oy - r * 0.3, 0, x, y + oy, r);
      gr.addColorStop(0, 'rgba(150,164,200,0.95)'); gr.addColorStop(0.45, 'rgba(58,70,104,0.95)'); gr.addColorStop(1, 'rgba(40,50,80,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  }
  // small, wise eyes with a crease above
  for (const s of [1, -1]) {
    const [x, y] = at(EYE[0], s * EYE[1]);
    g.fillStyle = 'rgba(52,62,92,0.9)'; g.beginPath(); g.ellipse(x, y, 10, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(22,24,34,1)'; g.beginPath(); g.ellipse(x, y, 5.5, 3.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(190,200,225,0.85)'; g.beginPath(); g.arc(x - 1.5, y - s * 1, 1.1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(40,50,78,0.6)'; g.lineWidth = 1.5;
    for (const k of [1, 2]) { g.beginPath(); g.ellipse(x + 2, y, 11 + k * 5, 6 + k * 4, 0, s > 0 ? Math.PI * 1.1 : Math.PI * 0.1, s > 0 ? Math.PI * 1.9 : Math.PI * 0.9); g.stroke(); }
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;

  // tubercles in the height field too
  for (const [ku, ka, kh] of KNOBS) {
    const [cx, cy] = at(ku, ka), r = 3 + (kh / 0.0036) * 4;
    for (let yy = -Math.ceil(r); yy <= r; yy++) for (let xx = -Math.ceil(r); xx <= r; xx++) {
      const d = Math.hypot(xx, yy) / r;
      if (d > 1) continue;
      const px = Math.round(cx + xx), py = ((Math.round(cy + yy) % H) + H) % H;
      if (px >= 0 && px < W) hgt[py * W + px] += 0.9 * (1 - d * d);
    }
  }
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H;
  const ng = nc.getContext('2d');
  const nimg = ng.createImageData(W, H);
  const hs = (x, y) => hgt[(((y % H) + H) % H) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (hs(x + 1, y) - hs(x - 1, y)) * 1.6, dy = (hs(x, y + 1) - hs(x, y - 1)) * 1.6;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * W + x) * 4;
    nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapT = THREE.RepeatWrapping; normalMap.anisotropy = 8;
  return { map, normalMap };
}

// Bioluminescence (night): photophore streams along the flanks, speckles, glowing throat pleats,
// the mouth line, head tubercles and a dotted dorsal ridge. R = sharp light, G = soft glow field,
// B = per-spot phase (twinkle timing and hue).
function makeBioMap() {
  const W = 2048, H = 1024;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return [c, g]; };
  const [, gs] = mk(), [, gp] = mk();
  gs.globalCompositeOperation = 'lighter';
  const rnd = mulberry32(99);
  const dot = (u, v, r, a = 1, ph = rnd()) => {
    const x = u * W;
    for (const oy of [-H, 0, H]) {
      const y = v * H + oy;
      if (y < -r * 2 || y > H + r * 2) continue;
      const gr = gs.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.35, `rgba(255,255,255,${a * 0.75})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      gs.fillStyle = gr; gs.beginPath(); gs.arc(x, y, r, 0, Math.PI * 2); gs.fill();
      const pv = Math.round(ph * 255);
      gp.fillStyle = `rgb(${pv},${pv},${pv})`; gp.beginPath(); gp.arc(x, y, r * 1.15, 0, Math.PI * 2); gp.fill();
    }
  };
  // photophore streams along both flanks: wandering, broken lines of lights that shrink toward the tail
  for (const side of [0, 1]) {
    for (const [v0, size, step] of [[0.19, 1.0, 0.013], [0.27, 0.75, 0.011], [0.345, 0.55, 0.01]]) {
      const seed = rnd() * 10;
      for (let u = 0.07 + rnd() * 0.02; u < 0.9; u += step * (0.6 + rnd() * 0.9)) {
        if (fbm(u * 9 + seed, v0 * 7, 2) < -0.12) continue; // gaps along the stream
        const bend = 0.035 * fbm(u * 4 + seed, side * 3 + v0 * 5, 2) - 0.05 * smoothstep(0.55, 0.9, u);
        const v = side ? 1 - (v0 + bend) : v0 + bend;
        dot(u, v + (rnd() - 0.5) * 0.02, (4 + 10 * size * (1 - 0.6 * u)) * (0.5 + rnd() * 0.8), 0.45 + rnd() * 0.55, (u * 3 + side * 0.5 + rnd() * 0.2) % 1);
      }
    }
  }
  // large soft blotches: the patchy glow under the skin
  for (let i = 0; i < 90; i++) {
    const u = 0.05 + rnd() * 0.85, v = rnd();
    dot(u, v, 18 + rnd() * 34, 0.12 + rnd() * 0.16);
  }
  // scattered speckles and a few clusters, denser on the back and flanks than the belly
  for (let i = 0; i < 2200; i++) {
    const u = 0.02 + Math.pow(rnd(), 0.9) * 0.93;
    const v = rnd();
    const bellyW = Math.cos(v * Math.PI * 2 - Math.PI) * 0.5 + 0.5;
    if (bellyW > 0.75 && rnd() < 0.7) continue;
    dot(u, v, 2 + rnd() * rnd() * 7, 0.35 + rnd() * 0.55);
  }
  for (let c = 0; c < 26; c++) {
    const cu = 0.08 + rnd() * 0.75, cv = rnd(), ph = rnd();
    for (let i = 0; i < 26; i++) dot(cu + (rnd() - 0.5) * 0.03, cv + (rnd() - 0.5) * 0.05, 2 + rnd() * 4, 0.6 + rnd() * 0.4, (ph + rnd() * 0.1) % 1);
  }
  // throat pleats as dashed luminous lines (on the pleat grooves of the skin)
  for (let k = -28; k <= 28; k++) {
    const ph = rnd();
    for (let u = 0.035; u < 0.47; u += 0.0035) {
      if (Math.floor(u * 170 + k * 0.37) % 3 === 2) continue;
      const rel = (k * Math.PI - 5 * u) / PLEAT_F;
      const aa = Math.PI - Math.abs(rel);
      if (aa < bellyLine(u) + 0.05) continue;
      const fade = smoothstep(0.035, 0.07, u) * smoothstep(0.47, 0.38, u);
      dot(u, 0.5 + rel / (Math.PI * 2), 3.2, 0.55 * fade, ph);
    }
  }
  // mouth line
  for (let u = 0.004; u < 0.33; u += 0.0028) {
    const a = mouthAngle(u) / (Math.PI * 2);
    dot(u, a, 3.6, 0.85, 0.2); dot(u, 1 - a, 3.6, 0.85, 0.2);
  }
  // head tubercles
  for (const [u, a] of KNOBS) dot(u, ((a / (Math.PI * 2)) + 1) % 1, 8, 1.0, 0.05);
  // dotted dorsal ridge, brighter on the hump
  for (let u = 0.24; u < 0.97; u += 0.009) dot(u, 0, 5 + 7 * Math.exp(-((u - 0.66) ** 2) / 0.002), 0.9, 0.6 + u * 0.3);

  const S = gs.getImageData(0, 0, W, H).data, P = gp.getImageData(0, 0, W, H).data;
  // soft glow field at low resolution
  const sw = 256, shh = 128, soft = new Float32Array(sw * shh);
  for (let y = 0; y < shh; y++) for (let x = 0; x < sw; x++) {
    const u = x / sw, v = y / shh;
    const n = fbm(u * 7, Math.sin(v * Math.PI * 2) * 1.6 + 3, 3) * 0.5 + 0.5;
    const bellyW = Math.cos(v * Math.PI * 2 - Math.PI) * 0.5 + 0.5;
    soft[y * sw + x] = clamp(smoothstep(0.42, 0.8, n) * (1 - 0.6 * bellyW) * smoothstep(0.98, 0.7, u), 0, 1);
  }
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const sx = (x / W) * sw, sy = (y / H) * shh;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const at = (xx, yy) => soft[(yy % shh) * sw + Math.min(xx, sw - 1)];
    const sv = lerp(lerp(at(x0, y0), at(x0 + 1, y0), fx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy);
    out[i] = S[i]; out[i + 1] = sv * 255; out[i + 2] = P[i]; out[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.flipY = false; tex.needsUpdate = true;
  return tex;
}

// ----------------------------------------------------------------------------- geometry
function buildBody(L, boneU, nU = 320, nV = 200) {
  const pos = [], uv = [], idx = [], skinI = [], skinW = [];
  for (let i = 0; i <= nU; i++) {
    const t = i / nU;
    const u = clamp(t * t * 0.35 + t * 0.65 * (t * 0.35 + 0.65), 0, 1);
    const sec = section(u);
    const ma = u < 0.34 ? mouthAngle(u) : 0;
    for (let j = 0; j <= nV; j++) {
      const a = (j / nV) * Math.PI * 2;
      const [px, py, pz] = surfacePoint(u, a, sec);
      const aa = a > Math.PI ? Math.PI * 2 - a : a;
      let disp = 0;
      if (sec.head > 0) {
        // the mouth line: a groove with the swelling lower lip below it
        const md = aa - ma;
        disp += sec.head * (-0.0038 * Math.exp(-(md * md) / 0.0018) + 0.0024 * Math.exp(-((md - 0.075) ** 2) / 0.004));
      }
      // splash guard and blowholes on top of the head
      disp += 0.0032 * Math.exp(-(aa * aa) / 0.025 - ((u - 0.212) ** 2) / 0.0003);
      disp -= 0.0016 * Math.exp(-((aa - 0.05) ** 2) / 0.0012 - ((u - 0.232) ** 2) / 0.00006) + 0.0016 * Math.exp(-((aa + 0.05) ** 2) / 0.0012 - ((u - 0.232) ** 2) / 0.00006);
      for (const [ku, ka, kh] of KNOBS) {
        const du = (u - ku) / 0.0055, dA = Math.atan2(Math.sin(a - ka), Math.cos(a - ka)) / 0.05;
        const d2 = du * du + dA * dA;
        if (d2 < 9) disp += kh * Math.exp(-d2);
      }
      // dorsal hump and the knuckles along the tail stock
      disp += 0.007 * Math.exp(-(aa * aa) / 0.04) * Math.exp(-((u - 0.7) ** 2) / 0.0012);
      disp += 0.0026 * Math.exp(-(aa * aa) / 0.02) * smoothstep(0.74, 0.78, u) * smoothstep(0.94, 0.9, u) * Math.max(0, Math.sin(u * 170));
      // the eye sits in a small swelling
      disp += 0.003 * Math.exp(-((u - EYE[0]) ** 2) / 0.00004 - ((aa - EYE[1]) ** 2) / 0.004);
      // push along the outward direction from the centre of the section
      const dy = py - sec.yW, rad = Math.hypot(dy, pz);
      const k = rad > 1e-6 ? disp / Math.max(0.004, rad) : 0;
      pos.push(px * L, (py + dy * k) * L, pz * (1 + k) * L);
      uv.push(u, j / nV);
      let bi = 0;
      while (bi < boneU.length - 1 && boneU[bi + 1] < u) bi++;
      const b0 = bi, b1 = Math.min(bi + 1, boneU.length - 1);
      const w = b0 === b1 ? 0 : clamp((u - boneU[b0]) / (boneU[b1] - boneU[b0]), 0, 1);
      const ws = w * w * (3 - 2 * w);
      skinI.push(b0, b1, 0, 0);
      skinW.push(1 - ws, ws, 0, 0);
    }
  }
  for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
    const a = i * (nV + 1) + j, b = a + nV + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i <= nU; i++) {
    const a = i * (nV + 1), b = a + nV;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  g.userData = { nU, nV };
  return g;
}

// A lofted wing-like surface with a rounded airfoil section (cosine spacing: fine at the edges).
function loft(planform, nS, nC, colorFn) {
  const pos = [], col = [], idx = [];
  const ring = nC * 2;
  for (let i = 0; i <= nS; i++) {
    const s = i / nS;
    const { le, chord, thick } = planform(s);
    for (let k = 0; k < ring; k++) {
      const top = k < nC;
      const q = top ? k / (nC - 1) : 1 - (k - nC) / (nC - 1);
      const xc = 0.5 - 0.5 * Math.cos(Math.PI * q);
      const th = thick * chord * Math.max(0, 1.2 * Math.sqrt(xc) - 1.0 * xc + 0.2 * xc * xc - 0.4 * xc * xc * xc) * 1.6 * (1 - 0.7 * s * s);
      pos.push(le[0] - xc * chord, top ? th : -th, le[1]);
      const c = colorFn(s, xc, top);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nS; i++) for (let k = 0; k < ring; k++) {
    const a = i * ring + k, b = i * ring + ((k + 1) % ring), c = a + ring, d = b + ring;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const FIN_BLUE = new THREE.Color('#566b99'), FIN_EDGE = new THREE.Color('#a9b9d8'), FIN_WHITE = new THREE.Color('#eef1f8');

// long, slender pectoral flipper (over a third of the body) with the scalloped leading edge of a humpback
const FLIPPER_LEN = 0.37;
function flipperGeo(L) {
  const len = FLIPPER_LEN * L;
  const c = new THREE.Color();
  const knob = (s) => (s > 0.06 ? Math.pow(Math.abs(Math.sin(s * Math.PI * 11.5)), 0.65) * smoothstep(0.06, 0.12, s) : 0);
  return loft((s) => {
    const chord = L * (0.074 * Math.pow(1 - s, 0.8) * (0.84 + 0.16 * Math.sin(Math.PI * Math.min(1, s * 2.4))) + 0.008);
    const bump = knob(s) * 0.0095 * L * (1 - 0.5 * s);
    return { le: [0.024 * L - 0.12 * L * Math.pow(s, 1.6) + bump, s * len], chord: chord + bump, thick: 0.1 };
  }, 170, 26, (s, xc, top) => {
    if (top) {
      c.copy(FIN_BLUE);
      c.lerp(FIN_WHITE, smoothstep(0.1, 0.02, xc) * (0.55 + 0.45 * knob(s))); // pale scalloped leading edge
      c.lerp(FIN_EDGE, smoothstep(0.86, 0.98, xc) * 0.8); // soft trailing edge
      c.lerp(FIN_EDGE, smoothstep(0.85, 1.0, s) * 0.5);
    } else {
      c.copy(FIN_WHITE).lerp(FIN_EDGE, smoothstep(0.7, 1.0, xc) * 0.5);
    }
    return c;
  });
}

// broad flukes with a central notch and a serrated, pale trailing edge
const FLUKE_SPAN = 0.5;
function flukeGeo(L) {
  const span = FLUKE_SPAN * L, half = span / 2;
  const c = new THREE.Color();
  const make = (side) => loft((s) => {
    // swept, convex leading edge; pointed tips; serrated trailing edge with a deep central notch
    const le = -(0.02 + 0.34 * Math.pow(s, 1.7)) * span;
    const serr = Math.pow(Math.abs(Math.sin(s * 40)), 0.6) * 0.008 * span * (0.3 + s);
    const te = -(0.24 + 0.12 * Math.pow(s, 1.4) - 0.06 * Math.pow(Math.sin(Math.PI * s), 1.2)) * span + serr + 0.07 * span * smoothstep(0.08, 0, s);
    return { le: [le, side * s * half], chord: Math.max(0.004 * span, le - te), thick: 0.09 };
  }, 90, 22, (s, xc, top) => {
    if (top) {
      c.copy(FIN_BLUE).lerp(FIN_WHITE, smoothstep(0.84, 0.97, xc) * 0.85);
      return c.lerp(FIN_EDGE, smoothstep(0.9, 1.0, s) * 0.5);
    }
    const n = simplex2(s * 6 + side, xc * 4);
    c.copy(FIN_WHITE).lerp(FIN_BLUE, smoothstep(0.35, 0.05, xc) * 0.85);
    return c.lerp(FIN_BLUE, smoothstep(0.35, 0.7, n) * smoothstep(0.8, 0.4, xc) * 0.7);
  });
  const a = make(1), b = make(-1);
  const idx = b.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  b.index.needsUpdate = true;
  b.computeVertexNormals();
  return [a, b];
}

// ----------------------------------------------------------------------------- materials
const CLOUD_GLSL = /* glsl */ `
float wh3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float wn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wh3(i), wh3(i + vec3(1,0,0)), f.x), mix(wh3(i + vec3(0,1,0)), wh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wh3(i + vec3(0,0,1)), wh3(i + vec3(1,0,1)), f.x), mix(wh3(i + vec3(0,1,1)), wh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float cloudF(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * wn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

function whaleMaterial(opts, bioMap = null) {
  const mat = new THREE.MeshPhysicalMaterial({
    roughness: 0.5, metalness: 0, sheen: 0.55, sheenRoughness: 0.5, sheenColor: new THREE.Color('#dde6ff'),
    clearcoat: 0.12, clearcoatRoughness: 0.55, ...opts,
  });
  mat.userData.glow = { value: 0 };
  mat.userData.bio = { value: 1 };
  if (bioMap) mat.defines = { BIO_MAP: '' };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = mat.userData.glow;
    sh.uniforms.uBioAmt = mat.userData.bio;
    if (bioMap) sh.uniforms.uBio = { value: bioMap };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBioPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBioPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGlow, uBioAmt;
varying vec3 vBioPos;
#ifdef BIO_MAP
uniform sampler2D uBio;
#endif
float bioHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
${CLOUD_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifndef BIO_MAP
{
  // fins: the same soft mottling and pale dapples as the body, on the blue parts only
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  float blueness = 1.0 - smoothstep(0.18, 0.55, lum);
  float mottle = cloudF(vBioPos / 34.0);
  diffuseColor.rgb *= 1.0 + (mottle - 0.5) * 0.35 * blueness;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.5, 0.7), smoothstep(0.58, 0.8, mottle) * 0.35 * blueness);
  vec3 sp = vBioPos / 1.8; vec3 ci = floor(sp);
  float speck = step(0.94, bioHash(ci + 3.7)) * smoothstep(0.4, 0.1, length(fract(sp) - 0.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.87, 0.94), speck * 0.55 * blueness);
}
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  vec3 N = normalize(normal);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  float fresThin = pow(1.0 - ndv, 5.0);
  vec3 Nw = inverseTransformDirection(N, viewMatrix);
  float sunSide = clamp(dot(Nw, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
  float dayK = 0.25 + 0.75 * uDayF;
  // a thin gold rim where the sun grazes the edges, a cool sky rim elsewhere
  vec3 gold = vec3(1.0, 0.8, 0.46) * mix(vec3(1.0), uLightCol, 0.5);
  totalEmissiveRadiance += gold * fresThin * (0.2 + 1.2 * sunSide * sunSide) * uDayF;
  totalEmissiveRadiance += vec3(0.62, 0.74, 0.95) * fres * (0.14 + uGlow * 0.8) * dayK;
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.65, 0.85) * (0.05 + uGlow * 0.12) * dayK;
  // bright bounce light from the sea of clouds below: keeps the belly and flipper undersides white
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.9, 0.93, 1.0) * smoothstep(0.1, -0.8, Nw.y) * 0.42 * (0.12 + 0.88 * uDayF);
  // --- night: bioluminescence, like a whale rising through a sea of glowing plankton
  if (uNight > 0.001) {
    float t = uSkyTime;
#ifdef BIO_MAP
    vec4 bio = texture2D(uBio, vMapUv);
    float along = vMapUv.x;
#else
    // fins: procedural photophores in object space, and glowing leading edges
    vec3 bp = vBioPos / 3.5;
    vec3 ci = floor(bp);
    vec3 fo = fract(bp) - 0.5 - (vec3(bioHash(ci + 1.7), bioHash(ci + 5.1), bioHash(ci + 9.3)) - 0.5) * 0.5;
    float hh = bioHash(ci);
    vec4 bio = vec4(step(0.5, hh) * smoothstep(0.34, 0.05, length(fo)) * (0.5 + hh), 0.35, fract(hh * 7.3), 1.0);
    float along = length(vBioPos) / 200.0 + 0.3;
#endif
    float wave = pow(0.5 + 0.5 * sin(along * 16.0 - t * 1.5), 5.0);
    float breath = 0.8 + 0.2 * sin(t * 0.45);
    float tw = 0.55 + 0.45 * sin(t * (0.7 + bio.b * 2.6) + bio.b * 43.0);
    vec3 col = mix(vec3(0.16, 0.8, 1.0), vec3(0.12, 1.0, 0.74), smoothstep(0.3, 0.75, bio.b));
    col = mix(col, vec3(0.5, 0.42, 1.0), smoothstep(0.88, 0.95, bio.b) * 0.8);
    vec3 E = col * (bio.r * tw * (1.3 + 3.2 * wave) + bio.g * 0.22 * (0.6 + 1.2 * wave)) * breath;
    E += vec3(0.2, 0.75, 1.0) * fres * fres * 0.8 * breath;
    totalEmissiveRadiance += E * uNight * uBioAmt * (1.0 + uGlow * 1.6);
  }
}`);
  };
  mat.customProgramCacheKey = () => 'whale-v5' + (bioMap ? '-map' : '');
  return mat;
}

// Glowing plankton shed by the whale at night: world-space specks that drift off its skin and
// fin tips and hang in its wake.
class Plankton {
  constructor(whale, n = 6500) {
    this.whale = whale; this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(-1); this.life = new Float32Array(n).fill(1);
    this.lifeAttr = new Float32Array(n).fill(-1);
    const size = new Float32Array(n), seed = new Float32Array(n);
    const r = mulberry32(3);
    for (let i = 0; i < n; i++) { size[i] = 1.2 + r() * r() * 4.5; seed[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.lifeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPx: { value: 900 } }]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aLife, aSize, aSeed; uniform float uPx;
        varying float vA, vSeed;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float px = aSize * uPx / max(-mvPosition.z, 1.0);
          float fade = aLife < 0.0 ? 0.0 : smoothstep(0.0, 0.08, aLife) * (1.0 - smoothstep(0.5, 1.0, aLife));
          vA = fade * clamp(px / 2.5, 0.0, 1.0);
          vSeed = aSeed;
          gl_PointSize = clamp(px, 2.5, 48.0);
          if (aLife < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        varying float vA, vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d); a *= a;
          float tw = 0.6 + 0.4 * sin(uSkyTime * (1.0 + vSeed * 4.0) + vSeed * 60.0);
          vec3 col = mix(vec3(0.2, 0.85, 1.0), vec3(0.15, 1.0, 0.72), vSeed);
          col = mix(col, vec3(0.62, 0.5, 1.0), step(0.93, vSeed) * 0.7);
          gl_FragColor = vec4(col * a * vA * tw * 1.8 * uNight, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - fogAmountAt(vFogWorld);
          #endif
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 13;
    this.cursor = 0; this.acc = 0; this.alive = 0;
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3(); this._o = new THREE.Vector3();
    this.rnd = mulberry32(17);
  }
  spawn(night) {
    const w = this.whale, r = this.rnd, i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const v = this._v, nrm = this._n;
    if (r() < 0.22) {
      const tips = [...w.pecTips, ...w.flukeTips];
      tips[Math.floor(r() * tips.length)].getWorldPosition(v);
      v.x += (r() - 0.5) * 16; v.y += (r() - 0.5) * 16; v.z += (r() - 0.5) * 16;
      nrm.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    } else {
      // a point on the (bent) skin: a skinned vertex, and the normal from the middle of its ring
      const { nU, nV } = w.body.geometry.userData;
      const row = Math.floor(Math.pow(r(), 1.2) * 0.88 * nU) + 2, col = Math.floor(r() * nV);
      w.body.getVertexPosition(row * (nV + 1) + col, v);
      w.body.getVertexPosition(row * (nV + 1) + ((col + nV / 2) % nV), this._o);
      v.applyMatrix4(w.body.matrixWorld); this._o.applyMatrix4(w.body.matrixWorld);
      nrm.subVectors(v, this._o.lerp(v, 0.5)).normalize();
    }
    const sp = 0.6 + r() * 2.2, off = 1 + r() * r() * 15; // a luminous sheath around the skin
    this.pos[i * 3] = v.x + nrm.x * off; this.pos[i * 3 + 1] = v.y + nrm.y * off; this.pos[i * 3 + 2] = v.z + nrm.z * off;
    this.vel[i * 3] = nrm.x * sp; this.vel[i * 3 + 1] = nrm.y * sp - 0.4; this.vel[i * 3 + 2] = nrm.z * sp;
    this.age[i] = 0; this.life[i] = (6 + r() * 7) * (0.6 + 0.4 * night);
  }
  update(dt, t) {
    const night = SKY.uNight.value;
    this.points.visible = night > 0.01 || this.alive > 0;
    if (!this.points.visible) return;
    if (night > 0.01) {
      this.acc += dt * 700 * night;
      let k = Math.min(Math.floor(this.acc), 300);
      this.acc -= Math.floor(this.acc);
      while (k-- > 0) this.spawn(night);
    }
    const damp = Math.exp(-dt * 0.35);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] < 0) continue;
      this.age[i] += dt;
      const f = this.age[i] / this.life[i];
      if (f >= 1) { this.age[i] = -1; this.lifeAttr[i] = -1; continue; }
      alive++;
      const j = i * 3;
      // slow swirling drift
      const sx = Math.sin(this.pos[j + 1] * 0.03 + t * 0.3 + i), sz = Math.cos(this.pos[j] * 0.03 - t * 0.25 + i * 0.7);
      this.vel[j] = this.vel[j] * damp + sx * 0.25 * dt; this.vel[j + 2] = this.vel[j + 2] * damp + sz * 0.25 * dt;
      this.vel[j + 1] = this.vel[j + 1] * damp - 0.05 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.lifeAttr[i] = f;
    }
    this.alive = alive;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}

// ----------------------------------------------------------------------------- light trails
class Trail {
  constructor(n = 70, width = 5) {
    this.n = n; this.width = width;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    const t = new Float32Array(n * 2), side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { t[i * 2] = t[i * 2 + 1] = i / (n - 1); side[i * 2] = -1; side[i * 2 + 1] = 1; }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    this.geo = g;
  }
  push(p) {
    this.pts.unshift(p.clone());
    if (this.pts.length > this.n) this.pts.pop();
  }
  update(cam) {
    const n = this.n, P = this.pts;
    if (P.length < 2) return;
    const side = new THREE.Vector3(), dir = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = P[Math.min(i, P.length - 1)], q = P[Math.min(i + 1, P.length - 1)];
      dir.subVectors(p, q); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      toCam.subVectors(cam.position, p);
      side.crossVectors(dir, toCam).normalize();
      const w = this.width * (1 - i / n) * smoothstep(0, 3, i) * (i < P.length ? 1 : 0);
      this.pos[i * 6] = p.x - side.x * w; this.pos[i * 6 + 1] = p.y - side.y * w; this.pos[i * 6 + 2] = p.z - side.z * w;
      this.pos[i * 6 + 3] = p.x + side.x * w; this.pos[i * 6 + 4] = p.y + side.y * w; this.pos[i * 6 + 5] = p.z + side.z * w;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ----------------------------------------------------------------------------- the swim path
// A route sampled at even arc length, with position, tangent, bank and turn strength for fast,
// smooth lookups. Closed (the loop) or open (a visit to the traveller).
const K_REF = 1 / 270; // curvature of the tightest loop turn
class Track {
  init(P, n, ds, closed, opts = {}) {
    this.P = P; this.n = n; this.ds = ds; this.closed = closed;
    this.length = closed ? n * ds : (n - 1) * ds;
    this.T = new Float32Array(n * 3); this.bank = new Float32Array(n); this.turn = new Float32Array(n);
    const w = closed ? (i) => ((i % n) + n) % n : (i) => Math.min(n - 1, Math.max(0, i));
    const heading = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const st = closed ? 2 : 4; // tangent stencil (samples each side)
      const a = w(i - st) * 3, b = w(i + st) * 3;
      let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
      const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      this.T[i * 3] = tx; this.T[i * 3 + 1] = ty; this.T[i * 3 + 2] = tz;
      heading[i] = Math.atan2(tz, tx);
    }
    // signed horizontal curvature, smoothed over ~160 m, read ~70 m ahead (the whale anticipates)
    const kap = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let dh = heading[w(i + 1)] - heading[w(i - 1)];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      kap[i] = dh / (Math.max(1, w(i + 1) - w(i - 1)) * ds);
    }
    // (a fast visit smooths and anticipates over longer distances, and banks with a soft limit)
    const R = Math.round((opts.smooth ?? 80) / ds), lead = Math.round((opts.lead ?? 70) / ds);
    this.pitchScale = opts.pitchScale ?? 1;
    this.ks = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += kap[w(i + k)];
      this.ks[i] = sum / (2 * R + 1);
    }
    for (let i = 0; i < n; i++) {
      const k = this.ks[w(i + lead)];
      this.bank[i] = opts.softBank ? 0.62 * Math.tanh((k * 175) / 0.62) : clamp(k * 175, -0.62, 0.62); // bank into the turn (top toward its centre)
      this.turn[i] = clamp(k / K_REF, -1, 1);
    }
    this._q = new THREE.Quaternion(); this._qb = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }
  _lerp(arr, s, k = 1, out) {
    const n = this.n;
    let x = s / this.ds;
    x = this.closed ? ((x % n) + n) % n : Math.min(n - 1.0001, Math.max(0, x));
    const i = Math.floor(x), j = this.closed ? (i + 1) % n : i + 1, f = x - i;
    if (k === 1) return arr[i] + (arr[j] - arr[i]) * f;
    return out.set(arr[i * 3] + (arr[j * 3] - arr[i * 3]) * f, arr[i * 3 + 1] + (arr[j * 3 + 1] - arr[i * 3 + 1]) * f, arr[i * 3 + 2] + (arr[j * 3 + 2] - arr[i * 3 + 2]) * f);
  }
  point(s, out) { return this._lerp(this.P, s, 3, out); }
  tangent(s, out) { return this._lerp(this.T, s, 3, out).normalize(); }
  bankAt(s) { return this._lerp(this.bank, s); }
  turnAt(s) { return this._lerp(this.turn, s); }
  // orientation at a station: +x along the path, banked about it
  frame(s, out, rollExtra = 0) {
    const x = this._lerp(this.T, s, 3, this._x);
    x.y *= this.pitchScale; // steep dives read as a glide, not a plunge
    x.normalize();
    const z = this._z.crossVectors(x, THREE.Object3D.DEFAULT_UP).normalize();
    const y = this._y.crossVectors(z, x).normalize();
    out.setFromRotationMatrix(this._m.makeBasis(x, y, z));
    return out.multiply(this._qb.setFromAxisAngle(this._x.set(1, 0, 0), this.bankAt(s) + rollExtra));
  }
}

// The loop: designed from its curvature, straight passes joined by long, easing turns (none
// tighter than ~270 m), behind the castle and in front of the snow peaks.
class SwimPath extends Track {
  constructor() {
    super();
    const S = 340, Tn = 1700, n = 4096;
    const Ld = 2 * S + 2 * Tn, ds = Ld / n;
    const kap = (s) => {
      for (const a of [S / 2, S / 2 + Tn + S]) if (s >= a && s < a + Tn) return (2 * Math.PI / Tn) * Math.sin(Math.PI * (s - a) / Tn) ** 2;
      return 0;
    };
    const kmax = 2 * Math.PI / Tn;
    let x = 0, z = 0, h = 0;
    const X = new Float64Array(n), Z = new Float64Array(n), K = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X[i] = x; Z[i] = z; K[i] = kap(i * ds) / kmax;
      h += kap((i + 0.5) * ds) * ds; x += Math.cos(h) * ds; z += Math.sin(h) * ds;
    }
    for (let i = 0; i < n; i++) { X[i] -= (x * i) / n; Z[i] -= (z * i) / n; } // close the loop exactly
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < n; i++) { minx = Math.min(minx, X[i]); maxx = Math.max(maxx, X[i]); minz = Math.min(minz, Z[i]); maxz = Math.max(maxz, Z[i]); }
    const depth = maxz - minz, zNear = -1185;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = (Z[i] - minz) / depth; // 0 on the near pass, 1 on the far pass
      P[i * 3] = 560 + X[i] - (minx + maxx) / 2;
      P[i * 3 + 1] = 652 + 130 * f + 45 * K[i] + 14 * Math.sin((i / n) * Math.PI * 6);
      P[i * 3 + 2] = zNear - (Z[i] - minz);
    }
    this.init(P, n, ds, true);
    // ease through turns: slower at the apex, surging out of it (lap time is set by the caller)
    let kPeak = 1e-9;
    for (let i = 0; i < n; i++) kPeak = Math.max(kPeak, Math.abs(this.ks[i]));
    this.time = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.time[i + 1] = this.time[i] + ds / (1 - 0.2 * Math.abs(this.ks[i]) / kPeak);
    // start on the near pass, heading east, about where the old loop began
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) if (this.T[i * 3] > 0.9 && P[i * 3 + 2] > zNear - 40) { const d = Math.abs(P[i * 3] - 250); if (d < bd) { bd = d; best = i; } }
    this.s0 = best * ds;
  }
  // station (arc length) reached after `sec` seconds, for a lap of `lap` seconds
  stationAt(sec, lap) {
    const Tl = this.time[this.n], tt = ((((sec / lap) % 1) + 1) % 1) * Tl;
    let lo = 0, hi = this.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.time[mid] <= tt) lo = mid; else hi = mid; }
    const f = (tt - this.time[lo]) / (this.time[lo + 1] - this.time[lo]);
    return this.s0 + (lo + f) * this.ds;
  }
  // forward distance along the loop from station a to station b
  ahead(a, b) { const L = this.length; return (((b - a) % L) + L) % L; }
}

// A visit: the whale answers the traveller's call, leaves the loop, sweeps down and passes low
// overhead, climbs away and rejoins the loop exactly where (and when) it would have been anyway.
// The route is a copy of the loop before and after, spliced with a smooth flight between.
class VisitTrack extends Track {
  constructor(loop, lap, t0, predict, groundAt, clearAt) {
    super();
    const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const sStart = loop.stationAt(t0, lap);
    const speedAt = (t) => loop.ahead(loop.stationAt(t - 0.5, lap), loop.stationAt(t + 0.5, lap));
    const v0 = speedAt(t0);
    const PRE = 450, LEAD = 20, AVG_IN = 50, AVG_OUT = 32, V_PASS = 26;
    const pt = (s) => loop.point(s, V());
    // waypoints for a given pass point and loop re-entry station
    const route = (target, sEnd, turnPref = 0) => {
      const D0 = pt(sStart + 260), T0 = loop.tangent(sStart + 260, V());
      const passY = groundAt(target.x, target.z) + 215;
      // glide down no steeper than ~1:3: if the traveller is close to the loop, first carry on along
      // the loop while sinking, then swing toward them
      const direct = Math.hypot(target.x - D0.x, target.z - D0.z);
      const extraRun = Math.max(0, (D0.y - passY) / 0.3 - direct);
      const toward = V(target.x - D0.x, 0, target.z - D0.z).normalize();
      const A = D0.clone().addScaledVector(T0.clone().setY(0).normalize(), 380 + extraRun * 0.75).addScaledVector(toward, 220);
      A.y = lerp(D0.y, passY + 100, extraRun > 0 ? 0.5 : 0.3);
      const dPass = V(target.x - A.x, 0, target.z - A.z).normalize();
      const side = V(-dPass.z, 0, dPass.x);
      const approach = clamp(0.5 * Math.hypot(target.x - A.x, target.z - A.z), 220, 520); // never double back
      const J = pt(sEnd - 240), J1 = pt(sEnd - 120), J2 = pt(sEnd);
      const W1 = target.clone().addScaledVector(dPass, -approach); W1.y = passY + 100;
      const W2 = target.clone().addScaledVector(side, 30); W2.y = passY;
      const W3 = target.clone().addScaledVector(dPass, 480); W3.y = passY + 130;
      const turnSign = turnPref || Math.sign(side.dot(V(J.x - W3.x, 0, J.z - W3.z))) || 1;
      const W4 = target.clone().addScaledVector(dPass, 700).addScaledVector(side, 460 * turnSign); W4.y = passY + 330;
      // arrive along the loop's own direction: a lead-in point on its tangent before re-entry
      const tJ3 = loop.tangent(sEnd - 240, V());
      const Jin = J.clone().addScaledVector(tJ3, -420); Jin.y = lerp(W4.y, J.y, 0.7);
      // (the first and last points are phantoms: they set the loop's true tangent at both ends)
      const ctrl = [pt(sStart + LEAD - 120), pt(sStart + LEAD), pt(sStart + 140), D0, A, W1, W2, W3, W4, Jin, J, J1, J2, pt(sEnd + 120)];
      const inDir = V(Jin.x - W4.x, 0, Jin.z - W4.z).normalize(), tJ = tJ3.clone().setY(0).normalize();
      // how sharply the route bends: turn angle at each waypoint over the shorter adjoining leg
      let sharp = 0;
      for (let i = 2; i < ctrl.length - 2; i++) {
        const a = V().subVectors(ctrl[i], ctrl[i - 1]), b = V().subVectors(ctrl[i + 1], ctrl[i]);
        const la = a.length(), lb = b.length();
        if (la < 1 || lb < 1) continue;
        const ang = Math.acos(clamp(a.dot(b) / (la * lb), -1, 1));
        sharp += (ang * ang) * 400 / Math.min(la, lb);
      }
      return { ctrl, W2, sharp, align: Math.acos(clamp(inDir.dot(tJ), -1, 1)) };
    };
    // the gentler of the two ways round after the pass
    const bestRoute = (target, sEnd) => {
      const a = route(target, sEnd, 1), b = route(target, sEnd, -1);
      return a.sharp + a.align <= b.sharp + b.align ? a : b;
    };
    const polyLen = (c) => { let l = 0; for (let i = 1; i < c.length; i++) l += c[i].distanceTo(c[i - 1]); return l; };
    // choose the visit length (re-entering the loop where it heads the way we come in):
    // a fast dive in, a slow majestic pass overhead, a calmer climb back to the loop
    const iW2 = 5;
    const timing = (r) => {
      const c = r.ctrl.slice(1, -1);
      const lenTo = polyLen(c.slice(0, iW2 + 1)) * 1.05 + LEAD, lenAll = polyLen(c) * 1.05 + LEAD;
      return { tIn: lenTo / AVG_IN, D: lenTo / AVG_IN + (lenAll - lenTo) / AVG_OUT };
    };
    let tPass = 40, best = null;
    for (let iter = 0; iter < 2; iter++) {
      const target = predict(tPass);
      let D = 90;
      best = null;
      for (let k = 0; k < 3; k++) D = timing(bestRoute(target, loop.stationAt(t0 + D, lap))).D;
      for (let dD = -30; dD <= 30; dD += 5) {
        const Dc = D + dD, sEnd = loop.stationAt(t0 + Dc, lap), r = bestRoute(target, sEnd);
        const cost = Math.abs(timing(r).D - Dc) * 0.1 + r.align * 1.2 + r.sharp * 1.5 + Dc * 0.004;
        if (!best || cost < best.cost) best = { cost, D: Dc, sEnd, r, target };
      }
      tPass = timing(best.r).tIn; // refine the traveller's predicted position once
    }
    // sample: loop copy before, the smooth flight, loop copy after
    const ds = 2;
    const pts = [];
    for (let s = sStart - PRE; s < sStart + LEAD; s += ds) pts.push(pt(s));
    const ctrl = best.r.ctrl, nc = ctrl.length;
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    // sample between the phantoms densely, then resample at even spacing
    const dense = [];
    const t0c = 1 / (nc - 1), t1c = (nc - 2) / (nc - 1), steps = 20000;
    for (let i = 0; i <= steps; i++) dense.push(curve.getPoint(t0c + (t1c - t0c) * (i / steps)));
    const flightStart = pts.length;
    pts.push(dense[0].clone());
    let acc = 0;
    for (let i = 1; i < dense.length; i++) {
      const seg = dense[i].distanceTo(dense[i - 1]);
      acc += seg;
      while (acc >= ds) { acc -= ds; pts.push(dense[i].clone().lerp(dense[i - 1], seg > 0 ? acc / seg : 0)); }
    }
    // (the join lies `acc` beyond the last even sample: continue the loop copy on the same spacing)
    const flightEnd = pts.length, joinOffset = acc;
    for (let s = best.sEnd + (ds - acc); s < best.sEnd + 900; s += ds) pts.push(pt(s));
    // lift the flight clear of the ground, the castle and its spire (flippers hang ~90 m below the body)
    const need = new Float64Array(pts.length);
    for (let i = flightStart; i < flightEnd; i++) need[i] = Math.max(0, clearAt(pts[i].x, pts[i].z) + 190 - pts[i].y);
    const R = 150, lift = new Float64Array(pts.length);
    for (let i = flightStart; i < flightEnd; i++) {
      let mx = 0;
      for (let k = -R; k <= R; k++) { const j = i + k; if (j >= flightStart && j < flightEnd) mx = Math.max(mx, need[j] * Math.cos((Math.PI / 2) * (k / (R + 1))) ** 2); }
      lift[i] = mx;
    }
    // (then round it off, so the whale rises and settles in long, easy arcs)
    for (let pass = 0; pass < 4; pass++) {
      const l2 = lift.slice();
      for (let i = flightStart; i < flightEnd; i++) {
        let sum = 0, cnt = 0;
        for (let k = -30; k <= 30; k++) { const j = i + k; if (j >= flightStart && j < flightEnd) { sum += lift[j]; cnt++; } }
        l2[i] = Math.max(lift[i] * 0.85, sum / cnt);
      }
      lift.set(l2);
    }
    for (let i = flightStart; i < flightEnd; i++) {
      const edge = smoothstep(0, 160, Math.min(i - flightStart, flightEnd - 1 - i));
      pts[i].y += lift[i] * edge;
    }
    // iron out small kinks (from tight waypoints and the lift) with a few box-filter passes,
    // tapering to nothing at the joins with the loop
    const K = 14, tmp = pts.map((p) => p.clone());
    for (let pass = 0; pass < 4; pass++) {
      for (let i = flightStart; i < flightEnd; i++) {
        const w = smoothstep(0, 80, Math.min(i - flightStart, flightEnd - 1 - i));
        if (w <= 0) continue;
        const acc = V();
        for (let k = -K; k <= K; k++) acc.add(pts[clamp(i + k, 0, pts.length - 1)]);
        tmp[i].copy(pts[i]).lerp(acc.divideScalar(2 * K + 1), w);
      }
      for (let i = flightStart; i < flightEnd; i++) pts[i].copy(tmp[i]);
    }
    // wherever the flight still bends tighter than ~420 m (it flies fast), keep ironing just there
    const tightAt = (i) => {
      const a = pts[Math.max(0, i - 5)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 5)];
      const u1 = V().subVectors(b, a).normalize(), u2 = V().subVectors(c, b).normalize();
      return Math.acos(clamp(u1.dot(u2), -1, 1)) / (10 * ds) > 1 / 420;
    };
    for (let pass = 0; pass < 40; pass++) {
      const mark = new Float32Array(pts.length);
      let any = false;
      for (let i = flightStart + 80; i < flightEnd - 80; i++) if (tightAt(i)) { any = true; for (let k = -60; k <= 60; k++) mark[clamp(i + k, 0, pts.length - 1)] = Math.max(mark[clamp(i + k, 0, pts.length - 1)], 1 - Math.abs(k) / 61); }
      if (!any) break;
      for (let i = flightStart; i < flightEnd; i++) {
        if (!mark[i]) continue;
        const acc = V();
        for (let k = -K; k <= K; k++) acc.add(pts[clamp(i + k, 0, pts.length - 1)]);
        tmp[i].copy(pts[i]).lerp(acc.divideScalar(2 * K + 1), mark[i]);
      }
      for (let i = flightStart; i < flightEnd; i++) if (mark[i]) pts[i].copy(tmp[i]);
    }
    const n = pts.length, P = new Float32Array(n * 3);
    pts.forEach((p, i) => { P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; });
    this.init(P, n, ds, false, { smooth: 240, lead: 150, softBank: true, pitchScale: 0.6 });
    // the overhead moment
    // (the first close approach: the climb back to the loop can cross over the traveller again)
    let iPass = flightStart, bd = Infinity;
    for (let i = flightStart; i < flightEnd; i++) {
      const d = Math.hypot(pts[i].x - best.target.x, pts[i].z - best.target.z);
      if (d < bd) { bd = d; iPass = i; } else if (bd < 150 && d > bd + 60) break;
    }
    // speed in two legs, each easing between its end speeds and covering its length exactly
    const D = best.D, v1 = speedAt(t0 + D);
    const endStation = (flightEnd - 1) * ds + joinOffset;
    const L1 = iPass * ds - PRE, L2 = endStation - iPass * ds;
    const D1 = clamp(L1 / AVG_IN, 8, D - 10), D2 = D - D1;
    const leg = (Ls, Ds, va, vb) => {
      const A = (Ls - (va + vb) * 0.5 * Ds) * Math.PI / (2 * Ds);
      return {
        s: (x) => va * x + (vb - va) * x * x / (2 * Ds) + (A * Ds / Math.PI) * (1 - Math.cos(Math.PI * x / Ds)),
        v: (x) => va + (vb - va) * x / Ds + A * Math.sin(Math.PI * x / Ds),
      };
    };
    const a = leg(L1, D1, v0, V_PASS), b = leg(L2, D2, V_PASS, v1);
    this.sOf = (tau) => (tau <= D1 ? PRE + a.s(Math.max(0, tau)) : PRE + L1 + b.s(Math.min(tau, D) - D1));
    this.speedOf = (tau) => (tau <= D1 ? a.v(Math.max(0, tau)) : b.v(Math.min(tau, D) - D1));
    this.tPass = t0 + D1;
    this.passPos = pts[iPass].clone();
    this.target = best.target.clone();
    this.t0 = t0; this.D = D; this.sEnd = best.sEnd; this.endStation = endStation;
  }
}

// ----------------------------------------------------------------------------- the whale
const BONE_U = [0.0, 0.18, 0.36, 0.52, 0.64, 0.75, 0.85, 0.93, 0.985];
const UNDULATE = [0.0, 0.005, 0.009, 0.016, 0.026, 0.038, 0.052, 0.07, 0.1];
const FOLLOW = 0.72; // how closely the spine follows the path (1 = like a snake, 0 = rigid)

export class Whale {
  constructor(length = 300) {
    this.L = length;
    const L = length;
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.group.add(this.root);

    this.bones = [];
    let parent = null;
    for (let i = 0; i < BONE_U.length; i++) {
      const b = new THREE.Bone();
      b.userData.u = BONE_U[i];
      const x = (0.5 - BONE_U[i]) * L;
      if (parent) { b.position.set(x - (0.5 - BONE_U[i - 1]) * L, 0, 0); parent.add(b); }
      else b.position.set(x, 0, 0);
      this.bones.push(b);
      parent = b;
    }
    const skel = new THREE.Skeleton(this.bones);
    const { map, normalMap } = makeSkin(L);
    const bodyMat = whaleMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }, makeBioMap());
    this.mats = [bodyMat];
    this.body = new THREE.SkinnedMesh(buildBody(L, BONE_U), bodyMat);
    this.body.add(this.bones[0]);
    this.body.bind(skel);
    this.body.frustumCulled = false;
    this.root.add(this.body);

    const finMat = whaleMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.52 });
    this.mats.push(finMat);

    const pGeo = flipperGeo(L);
    this.pecs = []; this.pecTips = [];
    const pecBone = this.bones[2];
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      const u = 0.31;
      const [, py, pz] = surfacePoint(u, 1.95);
      pivot.position.set((0.5 - u) * L - (0.5 - pecBone.userData.u) * L, py * L, side * pz * 0.93 * L);
      const fin = new THREE.Mesh(pGeo, finMat);
      if (side < 0) fin.scale.z = -1;
      pivot.add(fin);
      const tip = new THREE.Object3D();
      tip.position.set((0.024 - 0.12 - 0.01) * L, 0, side * FLIPPER_LEN * L);
      pivot.add(tip);
      this.pecTips.push(tip);
      pecBone.add(pivot);
      pivot.userData.side = side;
      this.pecs.push(pivot);
    }

    const [fa, fb] = flukeGeo(L);
    this.fluke = new THREE.Group();
    this.fluke.add(new THREE.Mesh(fa, finMat), new THREE.Mesh(fb, finMat));
    this.fluke.position.set(0.02 * L, 0.001 * L, 0);
    this.bones[this.bones.length - 1].add(this.fluke);
    this.flukeTips = [1, -1].map((s) => { const o = new THREE.Object3D(); o.position.set(-0.36 * FLUKE_SPAN * L, 0, s * 0.5 * FLUKE_SPAN * L); this.fluke.add(o); return o; });

    // small, sickle-shaped dorsal fin on its hump
    const dShape = new THREE.Shape();
    dShape.moveTo(0.03 * L, 0);
    dShape.quadraticCurveTo(0.004 * L, 0.012 * L, -0.017 * L, 0.03 * L);
    dShape.quadraticCurveTo(-0.013 * L, 0.012 * L, -0.03 * L, 0);
    dShape.lineTo(0.03 * L, 0);
    const dGeo = new THREE.ExtrudeGeometry(dShape, { depth: 0.004 * L, bevelEnabled: true, bevelSize: 0.003 * L, bevelThickness: 0.003 * L, bevelSegments: 3, curveSegments: 16 });
    dGeo.translate(0, 0, -0.002 * L);
    const dMat = whaleMaterial({ color: FIN_BLUE.clone() });
    this.mats.push(dMat);
    const dorsal = new THREE.Mesh(dGeo, dMat);
    const du = 0.7, dBone = this.bones[4];
    dorsal.position.set((0.5 - du) * L - (0.5 - dBone.userData.u) * L, (section(du).yTop + 0.004) * L, 0);
    dBone.add(dorsal);

    // soft light trails from the flipper and fluke tips
    this.trails = [];
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGlow: { value: 0 }, uTime: { value: 0 } }]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aT, aSide; varying float vT, vSide;
        void main(){ vT = aT; vSide = aSide; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uGlow, uTime; varying float vT, vSide;
        void main(){
          float a = (1.0 - vT) * (1.0 - vT) * smoothstep(1.0, 0.0, abs(vSide));
          a *= 0.55 + 0.45 * sin(vT * 30.0 - uTime * 2.0);
          vec3 day = vec3(1.0, 0.92, 0.78) * (0.2 + uGlow * 0.5);
          vec3 night = vec3(0.25, 0.9, 1.0) * (0.75 + uGlow);
          gl_FragColor = vec4(mix(day, night, uNight) * a, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - fogAmountAt(vFogWorld);
          #endif
        }`,
    });
    for (let i = 0; i < 4; i++) {
      const tr = new Trail(80, i < 2 ? 5 : 4);
      const m = new THREE.Mesh(tr.geo, this.trailMat);
      m.frustumCulled = false; m.renderOrder = 12;
      this.group.add(m);
      this.trails.push(tr);
    }

    this.plankton = new Plankton(this);
    this.group.add(this.plankton.points);

    this.time = 0;
    this.glow = 0;
    this.path = new SwimPath();
    this.pathLen = this.path.length;
    this.lap = 311; // one lap takes about as long as the traveller's journey, so the opening sky is similar each time
    this.speed = this.pathLen / this.lap;
    this.viewH = 900; // drawing-buffer height, set by the app (sizes the plankton specks)
    this._trailClock = 0;
    this._turn = 0;
    this._ph = 0;
    this.visitState = null;
    this._qRoot = new THREE.Quaternion(); this._qInv = new THREE.Quaternion();
    this._rel = BONE_U.map(() => new THREE.Quaternion());
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._und = new THREE.Quaternion();
    this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._p = new THREE.Vector3(); this._m4 = new THREE.Matrix4();
    this._centreBone = BONE_U.findIndex((u, i) => BONE_U[i + 1] > 0.5); // the bone segment holding the body's middle
  }

  // answer the traveller: plan a visit starting now (returns the plan, or null if already visiting)
  visit(t, predict, groundAt, clearAt) {
    if (this.visitState) return null;
    this.visitState = new VisitTrack(this.path, this.lap, t, predict, groundAt, clearAt);
    this.setShadows(true);
    return this.visitState;
  }
  setShadows(on) {
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  }

  update(t, dt, camera) {
    this.time = t;
    const L = this.L, loop = this.path;
    // where along which route: the loop, or a visit to the traveller
    const sLoop = loop.stationAt(t, this.lap);
    let path = loop, sc = sLoop, speed = this.speed, wVisit = 0;
    const v = this.visitState;
    if (v) {
      const tau = t - v.t0;
      if (tau < 0 || tau > v.D + 60) { this.visitState = null; this.setShadows(false); }
      else if (tau <= v.D) { path = v; sc = v.sOf(tau); speed = v.speedOf(tau); wVisit = smoothstep(0, 8, tau); }
      else {
        // back on the loop copy: follow the loop's own timing until the tail is clear of the flight
        let extra = loop.ahead(v.sEnd, sLoop);
        if (extra > loop.length / 2) extra = 0;
        if (extra > 320) { this.visitState = null; this.setShadows(false); }
        else { path = v; sc = v.endStation + extra; wVisit = 1 - smoothstep(200, 320, extra); }
      }
    }
    this.route = path; this.station = sc;
    // leaving and rejoining the loop are blended, so nothing snaps
    const blendLoop = path !== loop && wVisit < 1;
    // tail beats quicken with speed
    const w = ((Math.PI * 2) / 11.0) * Math.sqrt(clamp(speed / this.speed, 0.7, 2.2));
    this._ph += dt * w;
    const ph0 = this._ph;
    const turn = blendLoop ? lerp(loop.turnAt(sLoop + 60), path.turnAt(sc + 60), wVisit) : path.turnAt(sc + 60);
    this._turn = lerp(this._turn, turn, clamp(dt * 1.5, 0, 1));
    const turnAbs = Math.abs(this._turn);

    // body centre on the path
    const bob = Math.sin(ph0 - 0.8) * 0.016 * L;
    path.point(sc, this.root.position);
    path.frame(sc, this._qRoot);
    if (blendLoop) {
      this.root.position.lerp(loop.point(sLoop, this._v), 1 - wVisit);
      this._qRoot.slerp(loop.frame(sLoop, this._q2), 1 - wVisit);
    }
    this.root.position.y += bob;
    this._q.setFromEuler(this._e.set(0.03 * Math.sin(t * 0.05), Math.sin(ph0 * 0.5 + 0.7) * 0.01, Math.sin(ph0) * 0.03));
    this.root.quaternion.copy(this._qRoot).multiply(this._q);
    this._qInv.copy(this.root.quaternion).invert();

    // the spine follows the path: each bone takes the orientation of the path at its own station
    // (head ahead of the centre, tail behind), so the body curves through turns, the head leading
    // and the bank rolling back along the body; a vertical tail stroke rides on top
    const stroke = 1 + 0.45 * turnAbs;
    for (let i = 0; i < BONE_U.length; i++) {
      const s = sc + (0.5 - BONE_U[i]) * L * FOLLOW;
      path.frame(s, this._rel[i]);
      if (blendLoop) this._rel[i].slerp(loop.frame(sLoop + (0.5 - BONE_U[i]) * L * FOLLOW, this._q2), 1 - wVisit);
      this._rel[i].premultiply(this._qInv); // relative to the root
    }
    for (let i = 0; i < BONE_U.length; i++) {
      const b = this.bones[i];
      const ph = BONE_U[i] * 2.6;
      this._und.setFromEuler(this._e.set(0, 0.012 * Math.sin(ph0 * 0.5 - ph * 0.6) * (i / BONE_U.length), UNDULATE[i] * stroke * Math.sin(ph0 - ph)));
      if (i === 0) b.quaternion.copy(this._rel[0]);
      else b.quaternion.copy(this._q2.copy(this._rel[i - 1]).invert().multiply(this._rel[i]));
      b.quaternion.multiply(this._und);
    }
    this.bones[1].quaternion.multiply(this._q.setFromAxisAngle(this._v.set(0, 0, 1), 0.01 * Math.sin(ph0 + 0.5))); // the head nods with the stroke
    // place the chain so the middle of the body sits on the path
    this.body.updateMatrixWorld(true);
    const bc = this._centreBone;
    this._m4.copy(this.body.matrixWorld).invert();
    this._p.set(-(0.5 - BONE_U[bc]) * L, 0, 0).applyMatrix4(this.bones[bc].matrixWorld).applyMatrix4(this._m4);
    this.bones[0].position.sub(this._p);

    // flukes: stronger strokes in turns, a twist to steer
    this.fluke.rotation.set(-this._turn * 0.22, 0, 0.22 * stroke * Math.sin(ph0 - 3.5));
    // flippers: held out, down and back with their broad blue faces turned outward (as on the model
    // sheet), rowing slowly; in a turn the inner one reaches down and forward like a rudder while the
    // outer one sweeps back
    for (const pv of this.pecs) {
      const s = pv.userData.side;
      const beat = Math.sin(ph0 * 0.5 + (s > 0 ? 0 : 0.6));
      const inner = clamp(-this._turn * s, -1, 1); // +1 when this flipper is on the inside of the turn
      pv.rotation.set(0, 0, 0);
      pv.rotateY(-s * (0.12 - 0.1 * inner));
      pv.rotateZ(-1.0 + 0.1 * beat + 0.3 * inner);
      pv.rotateX(s * (0.9 + 0.12 * beat + 0.2 * Math.abs(inner)));
    }

    // glow (answers the traveller's call)
    this.glow = Math.max(0, this.glow - dt / 6);
    for (const mm of this.mats) mm.userData.glow.value = this.glow;
    this.trailMat.uniforms.uGlow.value = this.glow;
    this.trailMat.uniforms.uTime.value = t;

    // light trails: sample the tips a few times per second
    this.group.updateMatrixWorld(true);
    this._trailClock += dt;
    if (this._trailClock > 0.12 || this.trails[0].pts.length === 0) {
      if (this._trailClock > 1) this.trails.forEach((tr) => (tr.pts.length = 0));
      this._trailClock = 0;
      [...this.pecTips, ...this.flukeTips].forEach((o, i) => this.trails[i].push(o.getWorldPosition(new THREE.Vector3())));
    }
    if (camera) for (const tr of this.trails) tr.update(camera);
    if (camera) this.plankton.mat.uniforms.uPx.value = this.viewH * 0.5 * camera.projectionMatrix.elements[5];
    this.plankton.update(dt, t);
  }

  get position() { return this.root.position; }
}
