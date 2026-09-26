// Trees, grass, flowers and rocks.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { NEAR, CASTLE_MESA, SIDE_MESAS, baseHeight } from './world.js';
import { fbm, simplex2, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import { BUMP_GLSL } from './castle.js';

function colorize(g, c) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = g.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
  for (let i = 0; i < n; i++) {
    const t = (pos.getY(i) - minY) / (maxY - minY || 1);
    const k = typeof c === 'function' ? c(t) : c;
    col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function conifer(detail = 2) {
  const parts = [];
  if (detail > 0) {
    const trunk = new THREE.CylinderGeometry(0.1, 0.18, 2.4, 5, 1, true);
    trunk.translate(0, 1.2, 0);
    parts.push(colorize(trunk.toNonIndexed(), new THREE.Color('#6b5344')));
  }
  const tiers = [1, 3, 5][detail];
  const seg = [6, 7, 10][detail];
  const dark = new THREE.Color('#284f45'), light = new THREE.Color('#5f8b5e');
  const rr = mulberry32(3);
  const span = 8.2; // canopy height
  for (let i = 0; i < tiers; i++) {
    const t = tiers === 1 ? 0 : i / (tiers - 1);
    const r = tiers === 1 ? 2.0 : lerp(2.0, 0.6, Math.pow(t, 0.9));
    const h = tiers === 1 ? span : lerp(3.2, 2.2, t) * (detail === 1 ? 1.35 : 1);
    const y0 = 1.3 + (tiers === 1 ? 0 : i * ((span - h * 0.6) / (tiers - 1)) * 0.95);
    // drooping bough layer: concave cone with a tucked underside
    const prof = detail === 0 ? [
      new THREE.Vector2(0.001, y0 + h), new THREE.Vector2(r * 0.55, y0 + h * 0.45), new THREE.Vector2(r, y0), new THREE.Vector2(0.001, y0 + 0.3),
    ] : [
      new THREE.Vector2(0.001, y0 + h),
      new THREE.Vector2(r * 0.55, y0 + h * 0.4),
      new THREE.Vector2(r, y0 - 0.05),
      new THREE.Vector2(0.001, y0 + 0.4),
    ];
    const g = new THREE.LatheGeometry(prof, seg);
    const p = g.attributes.position;
    const phase = rr() * 6;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k);
      const a = Math.atan2(z, x);
      const f = 1 + 0.13 * Math.sin(a * 5 + phase) + 0.07 * Math.sin(a * 11 + phase * 2);
      p.setX(k, x * f); p.setZ(k, z * f);
    }
    g.computeVertexNormals();
    parts.push(colorize(g.toNonIndexed(), (k) => dark.clone().lerp(light, 0.15 + 0.75 * k * k)));
  }
  const m = mergeGeometries(parts);
  // soften normals toward "up/out" for a painterly, rounded canopy shading
  const n = m.attributes.normal, pp = m.attributes.position;
  for (let k = 0; k < n.count; k++) {
    const x = pp.getX(k), y = pp.getY(k) - 5, z = pp.getZ(k);
    const l = Math.hypot(x, y, z) || 1;
    const nx = n.getX(k) * 0.5 + (x / l) * 0.5, ny = n.getY(k) * 0.5 + (y / l) * 0.5 + 0.15, nz = n.getZ(k) * 0.5 + (z / l) * 0.5;
    const nl = Math.hypot(nx, ny, nz);
    n.setXYZ(k, nx / nl, ny / nl, nz / nl);
  }
  return m;
}

function roundTree() {
  // a broadleaf crown made of lumpy leaf clusters on a forked trunk
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.26, 3.2, 7);
  trunk.translate(0, 1.6, 0);
  parts.push(colorize(trunk.toNonIndexed(), new THREE.Color('#6f5a48')));
  for (const [x, z, a] of [[0.5, 0.2, 0.5], [-0.45, -0.1, -0.6]]) {
    const br = new THREE.CylinderGeometry(0.07, 0.12, 1.8, 6);
    br.translate(0, 0.9, 0); br.rotateZ(a); br.translate(x * 0.3, 2.8, z * 0.3);
    parts.push(colorize(br.toNonIndexed(), new THREE.Color('#6f5a48')));
  }
  const rnd = mulberry32(9);
  const blobs = [[0, 4.6, 0, 2.1], [1.4, 4.0, 0.5, 1.5], [-1.3, 4.1, -0.3, 1.6], [0.3, 5.7, -0.4, 1.5], [-0.3, 3.8, 1.3, 1.4], [0.9, 5.0, -1.1, 1.3], [-1.0, 5.2, 0.8, 1.2]];
  const dark = new THREE.Color('#4f7d42'), light = new THREE.Color('#b0c768');
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.IcosahedronGeometry(r, 2);
    const p = s.attributes.position;
    const ph = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const n = 1 + 0.16 * simplex2(vx * 1.3 + ph, vy * 1.3 + vz) + 0.08 * simplex2(vx * 3.1, vz * 3.1 + ph);
      p.setXYZ(i, vx * n, vy * n * 0.9, vz * n);
    }
    s.translate(x, y, z);
    parts.push(colorize(s.toNonIndexed(), (k) => dark.clone().lerp(light, Math.pow(k, 1.3))));
  }
  const m = mergeGeometries(parts);
  // round, soft shading over the crown
  const n = m.attributes.normal, pp = m.attributes.position;
  m.computeVertexNormals();
  for (let k = 0; k < n.count; k++) {
    const x = pp.getX(k), y = pp.getY(k) - 4.6, z = pp.getZ(k);
    if (pp.getY(k) < 2.4) continue;
    const l = Math.hypot(x, y, z) || 1;
    const nx = n.getX(k) * 0.45 + (x / l) * 0.55, ny = n.getY(k) * 0.45 + (y / l) * 0.55, nz = n.getZ(k) * 0.45 + (z / l) * 0.55;
    const nl = Math.hypot(nx, ny, nz);
    n.setXYZ(k, nx / nl, ny / nl, nz / nl);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Card-based foliage: painted needle sprays and leaf clusters on alpha-tested planes

function needleTexture() {
  const W = 256, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rnd = mulberry32(31);
  const needleCols = ['#1d372a', '#24422f', '#2d4d35', '#37583b', '#46663f', '#5a7a47'];
  const twig = (x0, y0, ang, len, depth) => {
    const x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len;
    g.strokeStyle = depth === 0 ? '#4a3726' : '#3d3322'; g.lineWidth = depth === 0 ? 3.2 : 1.6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    // needles along the twig, denser and lighter toward its tip
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.9 + rnd() * 0.35) - 0.25;
        const nl = (9 + rnd() * 7) * (1 - 0.35 * t) * (depth === 0 ? 1.1 : 0.9);
        const ci = Math.min(needleCols.length - 1, Math.floor(t * 3 + rnd() * 3.2));
        g.strokeStyle = needleCols[ci]; g.lineWidth = 1.4 + rnd() * 0.6;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(a) * nl, py - Math.cos(a) * nl); g.stroke();
      }
    }
    return [x1, y1];
  };
  // main stem with alternating side shoots: a flat fir spray, broad at the base, pointed at the tip
  const baseY = H - 8, len = H - 30;
  twig(W / 2, baseY, 0, len, 0);
  for (let i = 0; i < 17; i++) {
    const t = 0.06 + (i / 17) * 0.86;
    const y = baseY - t * len;
    const sideLen = (W * 0.44) * (1 - t * 0.8) * (0.8 + rnd() * 0.3);
    for (const side of [-1, 1]) twig(W / 2, y, side * (0.95 + rnd() * 0.2), sideLen, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

function leafTexture() {
  const N = 256;
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const g = cv.getContext('2d');
  const rnd = mulberry32(44);
  const cols = ['#3f6a34', '#4d7a3a', '#5d8a40', '#78a04b', '#93b458', '#a9c265'];
  // a few twigs, then overlapping leaves radiating from them
  g.strokeStyle = '#4b3a28'; g.lineWidth = 2;
  for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(N / 2, N - 4); g.quadraticCurveTo(N / 2 + (rnd() - 0.5) * 60, N / 2, N * (0.2 + rnd() * 0.6), N * (0.1 + rnd() * 0.3)); g.stroke(); }
  for (let i = 0; i < 130; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * N * 0.4;
    const x = N / 2 + Math.cos(a) * r, y = N / 2 + Math.sin(a) * r * 0.9;
    const len = 16 + rnd() * 14, wid = len * (0.42 + rnd() * 0.15);
    g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 0.8);
    const light = (1 - r / (N * 0.4)) * 0.4 + rnd() * 0.6;
    g.fillStyle = cols[Math.min(cols.length - 1, Math.floor(light * cols.length))];
    g.beginPath(); g.ellipse(0, 0, wid / 2, len / 2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(40,60,30,0.35)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(0, -len / 2); g.lineTo(0, len / 2); g.stroke();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// a quad bent along its length (for drooping boughs); returns non-indexed geometry with uv/normal/color
function cardGeometry(cards) {
  const pos = [], nor = [], uv = [], col = [];
  const P = new THREE.Vector3(), Nn = new THREE.Vector3();
  for (const c of cards) {
    // c: origin, dir (length axis), side (width axis), len, width, droop, normalFn(p) -> vec3, shade(t) -> color
    const rows = c.rows || 3;
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const along = c.dir.clone().multiplyScalar(t * c.len).add(new THREE.Vector3(0, -c.droop * t * t * c.len, 0));
      for (const u of [0, 1]) {
        P.copy(c.origin).add(along).addScaledVector(c.side, (u - 0.5) * c.width);
        const n = c.normalFn(P, t);
        const sh = c.shade(t);
        grid.push({ p: P.clone(), n: n.clone(), uv: [u, t], c: sh });
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = grid[r * 2], b = grid[r * 2 + 1], d = grid[r * 2 + 2], e = grid[r * 2 + 3];
      for (const v of [a, b, d, b, e, d]) {
        pos.push(v.p.x, v.p.y, v.p.z); nor.push(v.n.x, v.n.y, v.n.z); uv.push(v.uv[0], v.uv[1]); col.push(v.c.r, v.c.g, v.c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function barkGeometry(r0, r1, h, seg = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true).toNonIndexed();
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); // all at (0,0): a transparent corner of the sheet is avoided below
  return colorize(g, (k) => new THREE.Color('#4a3a2c').lerp(new THREE.Color('#6d5846'), k));
}

// Spruce-like fir built from drooping needle sprays arranged in whorls
function cardConifer(detail) {
  const rnd = mulberry32(detail * 17 + 3);
  const H = 9.4;
  const cards = [];
  const whorls = detail === 2 ? 13 : detail === 1 ? 7 : 5;
  const perWhorl = detail === 2 ? 5 : detail === 1 ? 4 : 4;
  const dark = new THREE.Color('#6d7f68'), light = new THREE.Color('#ffffff');
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = lerp(1.0, H - 1.0, t);
    const len = (2.5 * Math.pow(1 - t, 0.95) + 0.35) * (detail === 1 ? 1.12 : 1);
    const rot0 = w * 2.399;
    for (let b = 0; b < perWhorl; b++) {
      const a = rot0 + (b / perWhorl) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const pitch = -(0.18 + 0.3 * (1 - t)) + (rnd() - 0.5) * 0.15;
      const dir = out.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0)).normalize();
      // roll the spray so it is not always edge-on to the viewer
      const roll = (rnd() - 0.5) * 0.9;
      const side = new THREE.Vector3(-out.z, 0, out.x).applyAxisAngle(dir, roll);
      cards.push({
        origin: new THREE.Vector3(0, y, 0).addScaledVector(out, 0.06), dir, side, len, width: len * 0.95,
        droop: 0.28, rows: detail === 2 ? 3 : 2,
        normalFn: (p) => new THREE.Vector3(p.x, (p.y - y) * 0.5 + 0.55 * Math.hypot(p.x, p.z) + 0.2, p.z).normalize(),
        shade: (tt) => dark.clone().lerp(light, 0.35 + 0.65 * tt * (0.5 + 0.5 * t) + 0.2 * t),
      });
    }
  }
  // leader at the top
  for (const a of [0, Math.PI / 2]) {
    const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    cards.push({
      origin: new THREE.Vector3(0, H - 1.4, 0), dir: new THREE.Vector3(0, 1, 0), side, len: 1.6, width: 0.9, droop: 0, rows: 1,
      normalFn: (p) => new THREE.Vector3(p.x, 0.6, p.z).normalize(), shade: () => light,
    });
  }
  const foliage = cardGeometry(cards);
  return { foliage, bark: barkGeometry(0.2, 0.05, H - 0.8) };
}

// Broadleaf crown: leaf clusters scattered through an ellipsoid, normals pointing out of the crown
function cardBroadleaf() {
  const rnd = mulberry32(77);
  const cards = [];
  const C = new THREE.Vector3(0, 4.7, 0), R = new THREE.Vector3(2.7, 2.2, 2.7);
  const dark = new THREE.Color('#5a6b52'), light = new THREE.Color('#ffffff');
  for (let i = 0; i < 90; i++) {
    const d = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (d.lengthSq() > 1) { i--; continue; }
    const shell = 0.55 + 0.45 * Math.sqrt(d.length());
    const p = d.clone().normalize().multiplyScalar(shell).multiply(R).add(C);
    const nrm = p.clone().sub(C).divide(R).normalize();
    const size = 1.5 + rnd() * 0.8;
    const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const side = new THREE.Vector3().crossVectors(dir, nrm).normalize();
    const origin = p.clone().addScaledVector(dir, -size / 2);
    const k = 0.35 + 0.65 * (0.5 + 0.5 * nrm.y) * shell;
    cards.push({ origin, dir, side, len: size, width: size, droop: 0, rows: 1, normalFn: () => nrm, shade: () => dark.clone().lerp(light, k) });
  }
  const foliage = cardGeometry(cards);
  const parts = [barkGeometry(0.26, 0.13, 3.4, 8)];
  for (const [x, z, a] of [[0.5, 0.2, 0.5], [-0.45, -0.1, -0.6], [0.1, -0.5, 0.35]]) {
    const br = new THREE.CylinderGeometry(0.06, 0.11, 2.0, 6, 1, true).toNonIndexed();
    br.translate(0, 1.0, 0); br.rotateZ(a); br.rotateY(x * 3 + z); br.translate(x * 0.3, 3.0, z * 0.3);
    br.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(br.attributes.position.count * 2), 2));
    parts.push(colorize(br, new THREE.Color('#57463a')));
  }
  return { foliage, bark: mergeGeometries(parts) };
}

// `fade`: { far, dir } dissolves each tree across a band around `far` metres (dir +1: the detailed
// tree fades out with distance, -1: its cheap stand-in fades in), so level-of-detail never pops
const LOD_BAND = 30;
function foliageMaterial(map = null, fade = null) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map, alphaTest: map ? 0.42 : 0, side: map ? THREE.DoubleSide : THREE.FrontSide });
  if (fade) m.defines = { LOD_FADE: '', LOD_DIR: fade.dir.toFixed(1) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = { value: 0 };
    if (fade) { sh.uniforms.uLodFar = { value: fade.far }; sh.uniforms.uLodBand = { value: LOD_BAND }; }
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vFolW; varying vec3 vFolLocal; varying float vHue; varying float vLodD;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 ip = instanceMatrix[3].xyz;
  #else
    vec3 ip = vec3(0.0);
  #endif
  float sway = sin(uTime * 0.9 + ip.x * 0.05 + ip.z * 0.03) * 0.5 + sin(uTime * 1.7 + ip.x * 0.2) * 0.2;
  transformed.x += sway * 0.035 * max(position.y - 1.5, 0.0);
  transformed.z += sway * 0.02 * max(position.y - 1.5, 0.0);
  vFolLocal = position;
  vHue = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 wpF = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpF = instanceMatrix * wpF;
  #endif
  vFolW = (modelMatrix * wpF).xyz;
  #ifdef USE_INSTANCING
    vLodD = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
  #else
    vLodD = distance((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
  #endif
}`);
    if (map) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef LOD_FADE
{
  // a stable screen-space dissolve between the detailed tree and its stand-in
  float f = smoothstep(uLodFar - uLodBand, uLodFar + uLodBand, vLodD);
  float keep = LOD_DIR > 0.0 ? 1.0 - f : f;
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (ign >= keep) discard;
}
#endif`)
      .replace('#include <common>', `#include <common>
varying vec3 vFolW; varying vec3 vFolLocal; varying float vHue; varying float vLodD;
#ifdef LOD_FADE
uniform float uLodFar, uLodBand;
#endif
float fh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float fn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float d = length(vFolW - cameraPosition);
  // needle clumps: small-scale light/dark patches, stronger up close
  float near = 1.0 - smoothstep(30.0, 260.0, d);
  float cl = 0.5;
  if (near > 0.0) cl = mix(0.5, fn(vFolW * 1.6) * 0.6 + fn(vFolW * 4.3) * 0.4, near);
  diffuseColor.rgb *= 1.0 + (cl - 0.5) * (0.25 + 0.35 * near);
  // per-tree hue: some bluish firs, some warmer, lighter tips
  diffuseColor.rgb *= mix(vec3(0.9, 0.98, 1.06), vec3(1.08, 1.04, 0.9), vHue);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.12, 0.92), smoothstep(0.55, 1.0, cl) * 0.5);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // light through the needles when back-lit by the low sun
  vec3 Vw = normalize(vFolW - cameraPosition);
  float back = pow(max(dot(Vw, uLightDir), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * (0.04 * uDayF + back * 0.16 * uLightCol) * vec3(1.0, 0.95, 0.7);
}`);
  };
  m.customProgramCacheKey = () => 'foliage' + (map ? '-card' : '') + (fade ? (fade.dir > 0 ? '-out' : '-in') : '');
  return m;
}

export function buildTrees(hf, path) {
  const group = new THREE.Group();
  const rnd = mulberry32(42);
  const nearMats = foliageMaterial();
  const needleTex = needleTexture(), leafTex = leafTexture();
  const lodMats = [];
  // for each LOD pair: the detailed foliage and bark fade out while the stand-in fades in
  const lodSet = (far, tex) => {
    const set = { hi: foliageMaterial(tex, { far, dir: 1 }), bark: foliageMaterial(null, { far, dir: 1 }), lo: foliageMaterial(null, { far, dir: -1 }) };
    lodMats.push(set.hi, set.bark, set.lo);
    return set;
  };
  const L1 = lodSet(170, needleTex), L2 = lodSet(140, needleTex), L3 = lodSet(220, leafTex);
  const firHi = cardConifer(2), firMid = cardConifer(1), coniferLo = conifer(0), broad = cardBroadleaf(), broadLo = roundTree();
  const near = [], mid = [], rounds = [];
  const trunks = [];

  const castleClear = (x, z) => {
    const dx = x - CASTLE_MESA.x, dz = z - CASTLE_MESA.z;
    if (dx * dx + dz * dz < (CASTLE_MESA.r - 6) ** 2) return false;
    for (const m of SIDE_MESAS) if ((x - m.x) ** 2 + (z - m.z) ** 2 < (m.r * 0.8) ** 2) return false;
    return true;
  };

  // candidate sampling across the near region
  const tries = 150000;
  for (let i = 0; i < tries; i++) {
    const x = lerp(NEAR.x0 + 10, NEAR.x1 - 10, rnd());
    const z = lerp(NEAR.z0 + 10, NEAR.z1 - 10, rnd());
    const h = hf.height(x, z);
    if (h < 1.2) continue;
    const n = hf.normal(x, z, 2);
    if (n.y < 0.8) continue;
    const pd = hf.pathDistAt(x, z);
    if (pd < 9) continue;
    if (!castleClear(x, z)) continue;
    // forest density field
    let dens = smoothstep(-0.1, 0.35, fbm(x / 220, z / 220, 3) + 0.15);
    // keep the start meadow open, forests toward its left edge and down the valley
    const meadow = smoothstep(150, 40, Math.hypot(x + 150, z - 130));
    dens *= 1 - meadow * 0.95;
    // forest edge along the left of the descent
    const edge = smoothstep(60, 20, Math.abs(pd - 34)) * smoothstep(0, -300, z - 60) * 0.7;
    dens = Math.max(dens, edge * (x < path.sample(clamp((- z + 200) * 1.0, 0, path.length)).x ? 1 : 0.3));
    // riverbanks and the ridge flanks
    dens += smoothstep(40, 16, Math.abs(h - 10)) * 0.2;
    dens *= smoothstep(9, 22, pd);
    if (rnd() > dens * 0.55) continue;
    const s = (0.7 + rnd() * 0.7) * (pd < 40 ? 0.85 : 1.1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, h - 0.3, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)),
      new THREE.Vector3(s, s * (0.9 + rnd() * 0.4), s),
    );
    const isRound = h < 30 && pd < 130 && rnd() < 0.08;
    let added = true;
    if (isRound) rounds.push(m);
    else if (pd < 70) near.push(m);
    else if (pd < 260 || rnd() < 0.55) mid.push(m);
    else added = false;
    // the low boughs of the firs reach out: keep the traveller from walking into them
    if (added) trunks.push([x, z, (isRound ? 0.45 : 0.95) * s]);
  }
  // a few special round trees on the meadow (like the reference's autumn tree)
  const special = [[-190, 150, 1.4], [-208, 118, 1.1], [-120, 175, 1.0], [-100, 120, 0.8]];
  for (const [x, z, s] of special) {
    const h = hf.height(x, z);
    rounds.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.3, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    trunks.push([x, z, 0.35 * s + 0.1]);
  }
  // instanced in spatial tiles so the camera (and the shadow camera) can cull what it does not see
  const mk = (geo, list, mat, shadow, tile = 160, tint = null) => {
    if (!list.length) return [];
    const tiles = new Map();
    const v = new THREE.Vector3();
    for (const m of list) {
      v.setFromMatrixPosition(m);
      const key = Math.floor(v.x / tile) + ',' + Math.floor(v.z / tile);
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(m);
    }
    const out = [];
    const r2 = mulberry32(list.length);
    const c = new THREE.Color();
    for (const arr of tiles.values()) {
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((m, i) => {
        im.setMatrixAt(i, m);
        if (tint) tint(c, i, r2); else c.setHSL(0.0, 0, 0.88 + r2() * 0.24);
        im.setColorAt(i, c);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      out.push(im);
    }
    return out;
  };
  // near the path: detailed card firs close up, cheap cones beyond ~300 m (switched per tile)
  const lod = [];
  const pair = (hiList, loList, far = 300) => {
    hiList.forEach((m, i) => { m.userData.lodFar = far; lod.push(m); });
    loList.forEach((m) => { m.userData.lodNear = far; lod.push(m); });
  };
  pair([...mk(firHi.foliage, near, L1.hi, true, 80), ...mk(firHi.bark, near, L1.bark, true, 80)], mk(coniferLo, near, L1.lo, false, 80), 170);
  pair([...mk(firMid.foliage, mid, L2.hi, false, 80), ...mk(firMid.bark, mid, L2.bark, false, 80)], mk(coniferLo, mid, L2.lo, false, 80), 140);
  // broadleaf trees, some turning autumn gold
  const tintBroad = (c, i, r) => c.set(r() < 0.3 ? '#ffc88a' : '#ffffff');
  pair([...mk(broad.foliage, rounds, L3.hi, true, 80, tintBroad), ...mk(broad.bark, rounds, L3.bark, true, 80)], mk(broadLo, rounds, L3.lo, false, 80, tintBroad), 220);
  group.userData.updateLOD = (camPos) => {
    for (const m of lod) {
      // a tile is drawn while any of its trees can be inside its fading band
      const c = m.boundingSphere ? m.boundingSphere.center.distanceTo(camPos) : 0, r = m.boundingSphere ? m.boundingSphere.radius : 0;
      const d = Math.max(0, c - r * 0.7);
      m.visible = m.userData.lodFar !== undefined ? c - r < m.userData.lodFar + LOD_BAND : c + r >= m.userData.lodNear - LOD_BAND;
      if (m.userData.caster === undefined) m.userData.caster = m.castShadow;
      m.castShadow = m.userData.caster && d < 120; // only nearby trees draw into the shadow cascades
    }
  };

  // far forests on the lower mountain slopes / foothills (cheap)
  const far = [];
  const r4 = mulberry32(7);
  for (let i = 0; i < 90000 && far.length < 26000; i++) {
    const x = lerp(-3200, 3200, r4()), z = lerp(-3400, 900, r4());
    if (x > NEAR.x0 && x < NEAR.x1 && z > NEAR.z0 && z < NEAR.z1) continue;
    const h = baseHeight(x, z);
    if (h < 2 || h > 520) continue;
    const e = 6;
    const nx = baseHeight(x + e, z) - baseHeight(x - e, z), nz = baseHeight(x, z + e) - baseHeight(x, z - e);
    const slope = Math.hypot(nx, nz) / (2 * e);
    if (slope > 0.9) continue;
    if (fbm(x / 500, z / 500, 2) < -0.15) continue;
    const s = 2.0 + r4() * 1.6;
    far.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 1, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.2, s)));
  }
  mk(coniferLo, far, nearMats, false, 900);

  group.userData.materials = [nearMats, ...lodMats];
  group.userData.trunks = trunks;
  return group;
}

// ---------------------------------------------------------------------------
// Grass that always surrounds the camera (GPU-wrapped instanced blades)
export function buildGrass(hf, heightTex, maskTex) {
  const blade = new THREE.BufferGeometry();
  // 3-segment tapered blade
  const pos = [], uv = [];
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.035 * (1 - t * 0.85);
    pos.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
  }
  const idx = [];
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  blade.setIndex(idx);

  const COUNT = 220000;
  const R = 70; // half-size of the wrapped patch
  const offs = new Float32Array(COUNT * 4);
  const rnd = mulberry32(11);
  for (let i = 0; i < COUNT; i++) {
    offs[i * 4] = rnd() * R * 2; offs[i * 4 + 1] = rnd() * R * 2;
    offs[i * 4 + 2] = rnd(); offs[i * 4 + 3] = rnd();
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  geo.attributes.uv = blade.attributes.uv;
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 4));
  geo.instanceCount = COUNT;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog, THREE.UniformsLib.lights,
    {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uR: { value: R },
      uHeight: { value: heightTex }, uMask: { value: maskTex },
      uNear: { value: new THREE.Vector4(NEAR.x0, NEAR.z0, NEAR.x1 - NEAR.x0, NEAR.z1 - NEAR.z0) },
      uSun: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3(1e5, 0, 1e5) },
    },
  ]);
  uniforms.uHeight.value = heightTex;
  uniforms.uMask.value = maskTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 aOff;
      uniform float uTime, uR;
      uniform vec2 uCenter;
      uniform sampler2D uHeight, uMask;
      uniform vec4 uNear;
      uniform vec3 uPlayer;
      varying float vT, vShade, vDist, vFlower;
      varying vec3 vCol;
      void main() {
        vec2 rel = mod(aOff.xy - uCenter + uR, 2.0 * uR) - uR;
        vec2 wp = uCenter + rel;
        vec2 huv = (wp - uNear.xy) / uNear.zw;
        vec2 texel = 1.0 / vec2(textureSize(uHeight, 0));
        huv = huv * (1.0 - texel) + texel * 0.5;
        float h = texture2D(uHeight, huv).r;
        vec4 mask = texture2D(uMask, huv);
        float dist = length(rel);
        float fade = 1.0 - smoothstep(uR * 0.6, uR * 0.98, dist);
        float dens = mask.r;
        float keep = step(aOff.z, dens) * fade;
        float height = (0.13 + aOff.w * 0.22) * (0.6 + 0.7 * mask.g) * keep;
        float ang = aOff.z * 40.0;
        vec3 p = position;
        float c = cos(ang), s = sin(ang);
        p.xz = mat2(c, -s, s, c) * vec2(p.x, 0.0);
        float t = position.y;
        // wind: gusts rolling across the meadow
        float gust = sin(wp.x * 0.07 + wp.y * 0.05 - uTime * 1.3) * 0.5 + 0.5;
        float w = (0.25 + 0.55 * gust) * (0.8 + 0.2 * sin(uTime * 3.1 + aOff.z * 30.0));
        vec2 wdir = normalize(vec2(0.8, 0.45));
        p.xz += wdir * w * t * t * height * 0.9;
        p.y = t * height * (1.0 - 0.25 * w * t);
        // blades part around the traveller's feet
        vec2 dp = wp - uPlayer.xz;
        float dd = length(dp);
        float push = smoothstep(0.75, 0.15, dd) * step(abs(h - uPlayer.y), 1.2);
        p.xz += (dp / max(dd, 1e-3)) * push * t * height * 1.3;
        p.y *= 1.0 - push * 0.55;
        vec3 world = vec3(wp.x, h - 0.04, wp.y) + p;
        vT = t;
        vDist = dist;
        vFlower = 0.0;
        vShade = gust;
        vCol = mix(vec3(0.33, 0.55, 0.18), vec3(0.62, 0.74, 0.25), aOff.w) * (0.85 + 0.3 * mask.b);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vT, vShade, vDist, vFlower;
      varying vec3 vCol;
      void main() {
        vec3 base = vCol * mix(0.45, 1.0, vT);
        // sun-kissed tips
        base += vec3(0.25, 0.2, 0.05) * pow(vT, 3.0) * (0.5 + 0.5 * vShade);
        gl_FragColor = vec4(base * 1.05 * uAmbientTint, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  return mesh;
}

// Wild flowers (static instanced, near the path)
export function buildFlowers(hf, path) {
  const petal = new THREE.CircleGeometry(0.07, 6);
  petal.rotateX(-Math.PI / 2);
  const stem = new THREE.PlaneGeometry(0.012, 0.3);
  stem.translate(0, -0.15, 0);
  const rnd = mulberry32(21);
  const list = [];
  const cols = [];
  const palette = ['#ffffff', '#fff6d8', '#fbe39a', '#f7f1ff', '#ffd9e0', '#dfe8ff'].map((c) => new THREE.Color(c));
  for (let i = 0; i < 60000 && list.length < 16000; i++) {
    const s = rnd() * path.length;
    const p = path.sample(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const d = 2.6 + Math.pow(rnd(), 1.6) * 40;
    const x = p.x - p.tz * d * side + (rnd() - 0.5) * 6, z = p.z + p.tx * d * side + (rnd() - 0.5) * 6;
    const h = hf.height(x, z);
    if (h < 1.5) continue;
    if (hf.normal(x, z).y < 0.85) continue;
    if (hf.roadAt(x, z) > 0.2) continue;
    if (path.isBridge(s)) continue;
    const cluster = simplex2(x * 0.08, z * 0.08);
    if (cluster < 0.1 && rnd() > 0.2) continue;
    const sc = 0.7 + rnd() * 0.7;
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h + 0.22 * sc, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4)), new THREE.Vector3(sc, sc, sc)));
    cols.push(palette[Math.floor(rnd() * palette.length)]);
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.08 });
  const im = new THREE.InstancedMesh(petal, mat, list.length);
  list.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); });
  im.computeBoundingSphere();
  return im;
}

export function buildRocks(hf, path) {
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const moss = new THREE.Color('#7f9e5c'), stone = new THREE.Color('#aaa396'), dark = new THREE.Color('#7b776f');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.2 * simplex2(x * 1.7 + z, y * 1.7) + 0.06 * simplex2(x * 5 + 3, z * 5 - y * 3);
    p.setXYZ(i, x * n, y * n * 0.62, z * n);
    c.copy(stone).lerp(dark, clamp(0.5 - y * 0.6 + simplex2(x * 3, z * 3) * 0.2, 0, 1));
    c.lerp(moss, smoothstep(0.55, 0.95, y + simplex2(x * 2.3, z * 2.3) * 0.3) * 0.55);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  // weathered rock: triplanar cracks and grain as a bump, lichen collecting on top
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkW; varying vec3 vRkN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{ vec4 wq = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wq = instanceMatrix * wq;
  #endif
  vRkW = (modelMatrix * wq).xyz;
  vRkN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRkW; varying vec3 vRkN;\nfloat rockH;\n${BUMP_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 bw = pow(abs(normalize(vRkN)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  vec3 p = vRkW * 1.6;
  float g = cfbm(p.zy) * bw.x + cfbm(p.xz) * bw.y + cfbm(p.xy) * bw.z;
  float cr = abs(cn(p.zy * 0.7 + 3.0) * bw.x + cn(p.xz * 0.7 + 3.0) * bw.y + cn(p.xy * 0.7 + 3.0) * bw.z - 0.5);
  float crack = 1.0 - smoothstep(0.0, 0.06, cr);
  diffuseColor.rgb *= 0.86 + g * 0.3 - crack * 0.25;
  float lichen = smoothstep(0.55, 0.9, normalize(vRkN).y + (g - 0.5) * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.52, 0.3), lichen * 0.45);
  rockH = g * 0.6 - crack * 0.5;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec2 dH = vec2(dFdx(rockH), dFdy(rockH)) * 0.8; normal = perturbNormalC(-vViewPosition, normal, dH, faceDirection); }`);
  };
  mat.customProgramCacheKey = () => 'rock-2';
  const rnd = mulberry32(31);
  const list = [];
  for (let i = 0; i < 5000 && list.length < 900; i++) {
    const s = rnd() * path.length;
    const pp = path.sample(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const d = 3.6 + Math.pow(rnd(), 2) * 50;
    const x = pp.x - pp.tz * d * side, z = pp.z + pp.tx * d * side;
    const h = hf.height(x, z);
    if (h < 0.5 || path.isBridge(s)) continue;
    if ((x - CASTLE_MESA.x) ** 2 + (z - CASTLE_MESA.z) ** 2 < (CASTLE_MESA.r - 5) ** 2) continue;
    const sc = 0.25 + Math.pow(rnd(), 3) * 1.4 * Math.min(1.6, d / 25 + 0.2);
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h + sc * 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd() * 0.3)), new THREE.Vector3(sc * (1 + rnd()), sc, sc * (1 + rnd() * 0.6))));
  }
  const im = new THREE.InstancedMesh(g, mat, list.length);
  list.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = true; im.receiveShadow = true;
  const v = new THREE.Vector3(), sc = new THREE.Vector3(), qq = new THREE.Quaternion();
  im.userData.obst = list.map((m) => { m.decompose(v, qq, sc); return [v.x, v.z, Math.max(sc.x, sc.z) * 0.85]; }).filter((o) => o[2] > 0.45);
  im.computeBoundingSphere();
  return im;
}

// Grass mask texture: R density, G height, B tint
export function buildGrassMask(hf) {
  const data = new Uint8Array(hf.nx * hf.nz * 4);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const idx = j * hf.nx + i;
    const x = NEAR.x0 + i * NEAR.step, z = NEAR.z0 + j * NEAR.step;
    const h = hf.h[idx];
    const n = hf.normal(x, z, 3);
    let d = smoothstep(0.78, 0.9, n.y) * smoothstep(0.8, 2.2, h);
    d *= 1 - smoothstep(0.1, 0.6, hf.road[idx]);
    if ((x - CASTLE_MESA.x) ** 2 + (z - CASTLE_MESA.z) ** 2 < (CASTLE_MESA.r * 0.72) ** 2) d = 0;
    d *= 0.55 + 0.45 * smoothstep(-0.4, 0.4, fbm(x / 40, z / 40, 2));
    data[idx * 4] = Math.round(clamp(d, 0, 1) * 255);
    data[idx * 4 + 1] = Math.round(clamp(0.5 + fbm(x / 30, z / 30, 2), 0, 1) * 255);
    data[idx * 4 + 2] = Math.round(clamp(0.5 + fbm(x / 80 + 5, z / 80, 2), 0, 1) * 255);
    data[idx * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, hf.nx, hf.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
