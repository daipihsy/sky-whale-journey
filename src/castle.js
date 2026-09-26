// The mythic castle: tiered halls, a soaring keep, towers, arcades and arched bridges.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASTLE, CASTLE_FACING, CASTLE_MESA, CASTLE_SCALE, SIDE_MESAS, baseHeight } from './world.js';
import { mulberry32, smoothstep, clamp, lerp } from './noise.js';

const V3 = THREE.Vector3;
const rnd = mulberry32(99);

// ---------------------------------------------------------------------------
// Materials
export const BUMP_GLSL = /* glsl */ `
vec3 perturbNormalC(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos)), vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
float ch1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float cn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(ch1(i),ch1(i+vec2(1,0)),f.x), mix(ch1(i+vec2(0,1)),ch1(i+vec2(1,1)),f.x), f.y); }
float cfbm(vec2 p){ return cn(p) * 0.5 + cn(p * 2.03) * 0.3 + cn(p * 4.1) * 0.2; }
`;

function windowTexture(lit) {
  const W = 128, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const r = W / 2;
  const arch = (inset) => {
    g.beginPath();
    g.moveTo(inset, H - inset * 0.6);
    g.lineTo(inset, r);
    g.arc(W / 2, r, r - inset, Math.PI, 0);
    g.lineTo(W - inset, H - inset * 0.6);
    g.closePath();
  };
  // carved stone surround
  g.fillStyle = '#e9dcc3'; arch(0); g.fill();
  g.fillStyle = '#cdbd9f'; arch(9); g.fill();
  // glass
  const glass = g.createLinearGradient(0, 0, 0, H);
  if (lit) { glass.addColorStop(0, '#ffe0a0'); glass.addColorStop(0.6, '#ffb65c'); glass.addColorStop(1, '#e8893c'); }
  else { glass.addColorStop(0, '#6f86a8'); glass.addColorStop(0.45, '#2f3d55'); glass.addColorStop(1, '#1f2a3c'); }
  g.fillStyle = glass; arch(15); g.fill();
  // leaded diamond panes
  g.save(); arch(15); g.clip();
  g.strokeStyle = lit ? 'rgba(90,50,20,0.55)' : 'rgba(20,25,35,0.7)'; g.lineWidth = 1.5;
  for (let k = -H; k < H * 2; k += 14) {
    g.beginPath(); g.moveTo(0, k); g.lineTo(W, k + W * 0.7); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(W, k - W * 0.7); g.stroke();
  }
  // a soft sky reflection streak on dark glass
  if (!lit) { g.fillStyle = 'rgba(220,235,255,0.18)'; g.beginPath(); g.moveTo(20, 60); g.lineTo(50, 40); g.lineTo(40, 200); g.lineTo(18, 220); g.fill(); }
  g.restore();
  // stone mullion and transom
  g.fillStyle = '#d9caac';
  g.fillRect(W / 2 - 4, r - 6, 8, H - r);
  g.fillRect(15, H * 0.62, W - 30, 7);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.offset.set(0.5, 0); // ShapeGeometry uvs run from -0.5..0.5 across the arch
  return t;
}

export function makeCastleMaterials() {
  const stone = new THREE.MeshStandardMaterial({ color: '#f2e3c8', roughness: 0.86, vertexColors: true });
  stone.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW; varying vec3 vSN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vSW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSW; varying vec3 vSN;
float stoneH;
${BUMP_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float dist = length(vSW - cameraPosition);
  float fade = 1.0 - smoothstep(40.0, 420.0, dist);
  vec3 n = abs(vSN);
  float vert = 1.0 - smoothstep(0.55, 0.85, n.y);
  // ashlar courses: staggered blocks with bevelled edges and slightly uneven faces
  float course = 0.72;
  float row = floor(vSW.y / course);
  float hcoord = (n.x > n.z ? vSW.z : vSW.x) + row * 0.61;
  float bw = 1.35 + 0.35 * ch1(vec2(row, 3.1));
  float col = floor(hcoord / bw);
  float fy = fract(vSW.y / course), fx = fract(hcoord / bw);
  float edge = min(min(fy, 1.0 - fy) * course, min(fx, 1.0 - fx) * bw);
  float mortar = 1.0 - smoothstep(0.015, 0.05, edge);
  float bevel = smoothstep(0.0, 0.09, edge);
  float face = cfbm(vSW.xy * 1.7 + vSW.z * 1.3 + col * 3.7);
  float blockTint = ch1(vec2(row, col)) - 0.5;
  // weathering: rain streaks under ledges, grime near the ground, faint lichen
  float streak = cn(vec2(hcoord * 2.2, vSW.y * 0.06)) * cn(vec2(hcoord * 0.7, vSW.y * 0.2 + 5.0));
  float lichen = smoothstep(0.62, 0.8, cfbm(vSW.xz * 0.35 + vSW.y * 0.2));
  diffuseColor.rgb *= 1.0 + blockTint * 0.1 * vert * fade + (face - 0.5) * 0.08;
  diffuseColor.rgb *= 1.0 - mortar * 0.28 * vert * fade;
  diffuseColor.rgb *= 1.0 - streak * 0.14 * vert;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.88, 0.7), lichen * 0.35);
  stoneH = (bevel * 0.8 + face * 0.25) * vert * fade;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(stoneH), dFdy(stoneH)) * 0.9;
  normal = perturbNormalC(-vViewPosition, normal, dH, faceDirection);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - stoneH * 0.08, 0.5, 1.0);`);
  };
  stone.customProgramCacheKey = () => 'castle-stone-2';
  const roof = new THREE.MeshStandardMaterial({ color: '#7d91b0', roughness: 0.55, metalness: 0.1, vertexColors: true });
  roof.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRW; varying vec3 vRN;\nfloat roofH;\n${BUMP_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float d = length(vRW - cameraPosition);
  float fade = 1.0 - smoothstep(40.0, 380.0, d);
  // fish-scale slate: overlapping rows, staggered, each tile rounded at its lower edge
  float rowH = 0.42;
  float rowI = floor(vRW.y / rowH);
  vec2 hn = normalize(vRN.xz + 1e-4);
  float hc = dot(vRW.xz, vec2(-hn.y, hn.x)) + rowI * 0.19;
  float tw = 0.38;
  float fx = fract(hc / tw) * 2.0 - 1.0;
  float fy = fract(vRW.y / rowH);
  float scallop = sqrt(max(0.0, 1.0 - fx * fx)) * 0.35;
  float tile = 1.0 - fy;                              // thick at the lower edge
  float lip = smoothstep(scallop, scallop + 0.08, fy); // rounded bottom edge of each tile
  float tint = ch1(vec2(rowI, floor(hc / tw))) - 0.5;
  diffuseColor.rgb *= 1.0 + tint * 0.16 * fade;
  diffuseColor.rgb *= 1.0 - (1.0 - lip) * 0.22 * fade;
  roofH = (tile * 0.6 + lip * 0.4) * fade;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(roofH), dFdy(roofH)) * 0.7;
  normal = perturbNormalC(-vViewPosition, normal, dH, faceDirection);
}`);
  };
  roof.customProgramCacheKey = () => 'castle-roof-2';
  const gold = new THREE.MeshStandardMaterial({ color: '#e8c27a', roughness: 0.3, metalness: 0.85, emissive: '#6b4a18', emissiveIntensity: 0.2 });
  const winLitTex = windowTexture(true), winDarkTex = windowTexture(false);
  const winLit = new THREE.MeshStandardMaterial({ map: winLitTex, emissiveMap: winLitTex, emissive: '#ffffff', emissiveIntensity: 1.25, roughness: 0.6 });
  const winDark = new THREE.MeshStandardMaterial({ map: winDarkTex, roughness: 0.25, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: '#e6d5b6', roughness: 0.9, vertexColors: true });
  trim.onBeforeCompile = stone.onBeforeCompile;
  trim.customProgramCacheKey = stone.customProgramCacheKey;
  const moss = new THREE.MeshStandardMaterial({ color: '#5d7f45', roughness: 1, vertexColors: true });
  return { stone, roof, gold, winLit, winDark, trim, moss };
}

// ---------------------------------------------------------------------------
// Geometry builder that merges pieces per material
const SOLID_BUCKETS = new Set(['stone', 'trim', 'roof']);
const _q = new THREE.Vector3();

// point-in-solid tests for the simple primitives the castle is built from
function insideSolid(sol, p) {
  if (p.x < sol.min.x || p.y < sol.min.y || p.z < sol.min.z || p.x > sol.max.x || p.y > sol.max.y || p.z > sol.max.z) return false;
  const q = _q.copy(p).applyMatrix4(sol.inv);
  if (sol.type === 'box') return Math.abs(q.x) <= sol.hx && Math.abs(q.y) <= sol.hy && Math.abs(q.z) <= sol.hz;
  if (sol.type === 'cyl') {
    if (Math.abs(q.y) > sol.h / 2) return false;
    const r = lerp(sol.rb, sol.rt, (q.y + sol.h / 2) / sol.h);
    return Math.hypot(q.x, q.z) <= r;
  }
  // lathe profile
  const pts = sol.pts;
  if (q.y < pts[0].y || q.y > pts[pts.length - 1].y) return false;
  let r = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (q.y >= Math.min(a.y, b.y) && q.y <= Math.max(a.y, b.y)) r = Math.max(r, lerp(a.x, b.x, (q.y - a.y) / ((b.y - a.y) || 1)));
  }
  return Math.hypot(q.x, q.z) <= r;
}

export class Builder {
  constructor() { this.buckets = {}; this.solids = []; }
  add(bucket, geo, matrix, ao = null) {
    this._register(bucket, geo, matrix);
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    // baked ambient occlusion towards the base of each piece + subtle tint variation
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const tint = 0.96 + rnd() * 0.06;
    for (let i = 0; i < pos.count; i++) {
      let a = 1;
      if (ao) a = lerp(ao.min ?? 0.7, 1, smoothstep(ao.base, ao.base + (ao.h ?? 8), pos.getY(i)));
      col[i * 3] = a * tint; col[i * 3 + 1] = a * tint; col[i * 3 + 2] = a * tint * (0.99 + 0.02 * a);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (this.buckets[bucket] ||= []).push(g);
  }
  _register(bucket, geo, matrix) {
    if (!SOLID_BUCKETS.has(bucket) || !geo.parameters) return;
    const m = matrix || new THREE.Matrix4();
    const P = geo.parameters;
    let sol = null;
    if (geo.type === 'BoxGeometry') sol = { type: 'box', hx: P.width / 2, hy: P.height / 2, hz: P.depth / 2 };
    else if (geo.type === 'CylinderGeometry') sol = { type: 'cyl', rt: P.radiusTop, rb: P.radiusBottom, h: P.height };
    else if (geo.type === 'LatheGeometry') sol = { type: 'lathe', pts: P.points.slice().sort((a, b) => a.y - b.y) };
    if (!sol) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox.clone().applyMatrix4(m);
    sol.min = bb.min; sol.max = bb.max;
    sol.inv = m.clone().invert();
    this.solids.push(sol);
  }
  build(materials, opts = {}) {
    const group = new THREE.Group();
    for (const [k, list] of Object.entries(this.buckets)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[k]);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

export const mat4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));

// arched window outline (unit: width 1, height 1, base at y=0)
function archShape(w, h, x = 0, y = 0) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(x - r, y);
  s.lineTo(x + r, y);
  s.lineTo(x + r, y + h - r);
  s.absarc(x, y + h - r, r, 0, Math.PI, false);
  s.lineTo(x - r, y);
  return s;
}
function archPath(w, h, x, y, pointed = false) {
  const p = new THREE.Path();
  const r = w / 2;
  p.moveTo(x - r, y);
  p.lineTo(x - r, y + h - r);
  if (pointed) {
    p.quadraticCurveTo(x - r, y + h - r * 0.1, x, y + h + r * 0.25);
    p.quadraticCurveTo(x + r, y + h - r * 0.1, x + r, y + h - r);
  } else p.absarc(x, y + h - r, r, Math.PI, 0, true);
  p.lineTo(x + r, y);
  p.lineTo(x - r, y);
  return p;
}

const WIN_GEO = new THREE.ShapeGeometry(archShape(1, 1), 6);

export class Windows {
  constructor() { this.lit = []; this.dark = []; this.rejected = 0; }
  add(matrix, lit) { (lit ? this.lit : this.dark).push(matrix); }
  // A window survives only if it sits on a wall (solid just behind it) and nothing else
  // occupies the space in front of it — this removes windows buried in towers, roofs or terraces.
  _ok(m, solids) {
    const pt = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const c = pt(0, 0.5, 0);
    const n = pt(0, 0.5, 1).sub(c).normalize();
    const probes = [c, pt(-0.45, 0.05, 0), pt(0.45, 0.05, 0), pt(-0.4, 0.9, 0), pt(0.4, 0.9, 0)];
    for (const p of probes) {
      const out = p.clone().addScaledVector(n, 0.22);
      for (const s of solids) if (insideSolid(s, out)) return false;
    }
    const back = c.clone().addScaledVector(n, -0.3);
    for (const s of solids) if (insideSolid(s, back)) return true;
    return false;
  }
  build(mats, solids = null) {
    const g = new THREE.Group();
    for (const [list0, m] of [[this.lit, mats.winLit], [this.dark, mats.winDark]]) {
      const list = solids ? list0.filter((mm) => this._ok(mm, solids)) : list0;
      this.rejected += list0.length - list.length;
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(WIN_GEO, m, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.computeBoundingSphere();
      g.add(im);
    }
    return g;
  }
}

// ---------------------------------------------------------------------------
// Architectural pieces (castle-local coordinates)
function spireGeo(r, h, seg, flare = 0.12, concave = 1.35) {
  const pts = [];
  pts.push(new THREE.Vector2(0.001, -0.3));
  pts.push(new THREE.Vector2(r * (1 + flare), -0.3));
  pts.push(new THREE.Vector2(r * (1 + flare), 0));
  const N = 16;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const rr = r * Math.pow(1 - t, concave) * (1 + flare * Math.pow(1 - t, 6));
    pts.push(new THREE.Vector2(Math.max(rr, 0.001), t * h));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  return g;
}

function finial(b, x, y, z, s = 1) {
  b.add('gold', new THREE.SphereGeometry(0.45 * s, 10, 8), mat4(x, y + 0.3 * s, z));
  b.add('gold', new THREE.ConeGeometry(0.16 * s, 3.2 * s, 8), mat4(x, y + 2.1 * s, z));
}

export function roundTower(b, w, o) {
  const { x, z, base, r, h, roofH = r * 3.2, seg = 24, lit = 0.3 } = o;
  const top = base + h;
  // slightly battered base
  b.add('stone', new THREE.CylinderGeometry(r, r * 1.06, h, seg, 1), mat4(x, base + h / 2, z), { base, h: 10 });
  b.add('trim', new THREE.CylinderGeometry(r * 1.09, r * 1.12, 2.2, seg), mat4(x, base + 1.1, z), { base, h: 3 });
  // string courses
  for (let y = base + 12; y < top - 6; y += 13) b.add('trim', new THREE.CylinderGeometry(r * 1.035, r * 1.035, 0.45, seg), mat4(x, y, z));
  // corbelled gallery at top
  const corb = Math.max(10, Math.round(r * 3));
  for (let i = 0; i < corb; i++) {
    const a = (i / corb) * Math.PI * 2;
    b.add('trim', new THREE.BoxGeometry(0.5, 1.4, 0.8), mat4(x + Math.cos(a) * r * 1.02, top - 1.2, z + Math.sin(a) * r * 1.02, -a));
  }
  b.add('stone', new THREE.CylinderGeometry(r * 1.16, r * 1.1, 2.6, seg), mat4(x, top + 0.7, z), null);
  b.add('trim', new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.5, seg), mat4(x, top + 2.1, z));
  // roof
  b.add('roof', spireGeo(r * 1.18, roofH, seg), mat4(x, top + 2.3, z), null);
  finial(b, x, top + 2.3 + roofH - 0.3, z, Math.max(0.8, r / 5));
  // windows around the shaft
  const rows = Math.max(1, Math.floor((h - 8) / 11));
  for (let k = 0; k < rows; k++) {
    const y = base + 7 + k * 11 + (k === rows - 1 ? 0 : 0);
    const n = Math.max(3, Math.round((r * 2 * Math.PI) / 7));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.5;
      const wx = x + Math.cos(a) * (r + 0.06), wz = z + Math.sin(a) * (r + 0.06);
      const ww = Math.min(1.5, r * 0.28), wh = ww * 2.3;
      w.add(mat4(wx, y, wz, Math.PI / 2 - a, ww, wh, 1), rnd() < lit);
    }
  }
  // a crown of little dormer windows in the roof
  // (placed on the cone surface and tilted with it)
  const nd = Math.max(3, Math.round(r / 1.5));
  const R0 = r * 1.18, tt = 0.1;
  const rr = R0 * Math.pow(1 - tt, 1.35) * (1 + 0.12 * Math.pow(1 - tt, 6)) + 0.07;
  const tilt = Math.atan((R0 * 1.35 * Math.pow(1 - tt, 0.35)) / roofH);
  for (let i = 0; i < nd; i++) {
    const a = (i / nd) * Math.PI * 2 + 0.3;
    w.add(mat4(x + Math.cos(a) * rr, top + 2.3 + roofH * tt, z + Math.sin(a) * rr, Math.PI / 2 - a, 0.7, Math.min(1.5, roofH * 0.1), 1, -tilt), rnd() < 0.6);
  }
}

function squareTower(b, w, o) {
  const { x, z, base, s, h, roofH = s * 2.6, ry = 0, lit = 0.3, pinn = true } = o;
  const top = base + h;
  const R = (lx, lz) => {
    const c = Math.cos(ry), sn = Math.sin(ry);
    return [x + lx * c + lz * sn, z - lx * sn + lz * c];
  };
  b.add('stone', new THREE.BoxGeometry(s, h, s), mat4(x, base + h / 2, z, ry), { base, h: 10 });
  b.add('trim', new THREE.BoxGeometry(s * 1.08, 2, s * 1.08), mat4(x, base + 1, z, ry));
  for (let y = base + 12; y < top - 4; y += 12) b.add('trim', new THREE.BoxGeometry(s * 1.04, 0.45, s * 1.04), mat4(x, y, z, ry));
  b.add('trim', new THREE.BoxGeometry(s * 1.14, 1.6, s * 1.14), mat4(x, top + 0.2, z, ry));
  // corner buttresses
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [cx, cz] = R(sx * s * 0.5, sz * s * 0.5);
    b.add('stone', new THREE.BoxGeometry(s * 0.14, h * 0.96, s * 0.14), mat4(cx, base + h * 0.48, cz, ry), { base, h: 10 });
    if (pinn) {
      b.add('stone', new THREE.CylinderGeometry(s * 0.07, s * 0.08, 3, 8), mat4(cx, top + 2.4, cz));
      b.add('roof', spireGeo(s * 0.085, s * 0.55, 8, 0.1), mat4(cx, top + 3.9, cz));
    }
  }
  b.add('roof', spireGeo(s * 0.6, roofH, 4, 0.1, 1.15), mat4(x, top + 1, z, ry + Math.PI / 4));
  finial(b, x, top + 1 + roofH - 0.2, z, s / 8);
  // windows on the four faces
  for (let f = 0; f < 4; f++) {
    const a = ry + (f * Math.PI) / 2;
    const nx = Math.sin(a), nz = Math.cos(a);
    const tx = Math.cos(a), tz = -Math.sin(a);
    const cols = Math.max(1, Math.floor(s / 4.5));
    for (let y = base + 8; y < top - 5; y += 10) for (let c = 0; c < cols; c++) {
      const off = (c - (cols - 1) / 2) * 3.8;
      w.add(mat4(x + nx * (s / 2 + 0.06) + tx * off, y, z + nz * (s / 2 + 0.06) + tz * off, a, 1.3, 3, 1), rnd() < lit);
    }
  }
}

function hall(b, w, o) {
  // long hall along local axis given by ry; length L (along its x), depth D, wall height H
  const { x, z, base, L, D, H, ry = 0, roofH = D * 0.55, lit = 0.35, buttress = true, gableWin = true } = o;
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.add('stone', new THREE.BoxGeometry(L, H, D), mat4(x, base + H / 2, z, ry), { base, h: 8 });
  b.add('trim', new THREE.BoxGeometry(L + 0.8, 1.2, D + 0.8), mat4(x, base + H + 0.2, z, ry));
  b.add('trim', new THREE.BoxGeometry(L + 1.0, 1.6, D + 1.0), mat4(x, base + 0.8, z, ry));
  // gable roof (triangular prism)
  const tri = new THREE.Shape([new THREE.Vector2(-D / 2 - 0.9, 0), new THREE.Vector2(D / 2 + 0.9, 0), new THREE.Vector2(0, roofH)]);
  const rg = new THREE.ExtrudeGeometry(tri, { depth: L + 1.2, bevelEnabled: false });
  rg.translate(0, 0, -(L + 1.2) / 2);
  rg.rotateY(Math.PI / 2);
  b.add('roof', rg, mat4(x, base + H + 0.8, z, ry));
  // gable ends in stone (slightly inset under the roof)
  const gtri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, roofH * 0.92)]);
  const gg = new THREE.ExtrudeGeometry(gtri, { depth: 0.6, bevelEnabled: false });
  for (const e of [-1, 1]) {
    const [gx, gz] = P(e * (L / 2 - 0.2), 0);
    const m = mat4(gx, base + H + 0.8, gz, ry + Math.PI / 2 + (e < 0 ? Math.PI : 0));
    b.add('stone', gg, m.multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.3)));
    if (gableWin) {
      const [wx, wz] = P(e * (L / 2 + 0.45), 0);
      w.add(mat4(wx, base + H * 0.45, wz, ry + (e > 0 ? Math.PI / 2 : -Math.PI / 2), Math.min(3.2, D * 0.22), Math.min(8, H * 0.55), 1), rnd() < 0.6);
    }
  }
  // ridge crest + finials
  const [e1x, e1z] = P(L / 2 + 0.4, 0), [e2x, e2z] = P(-L / 2 - 0.4, 0);
  finial(b, e1x, base + H + 0.8 + roofH, e1z, 0.7);
  finial(b, e2x, base + H + 0.8 + roofH, e2z, 0.7);
  // buttresses & windows along the long sides
  const bays = Math.max(2, Math.round(L / 6.5));
  for (let i = 0; i < bays; i++) {
    const lx = -L / 2 + (i + 0.5) * (L / bays);
    for (const side of [-1, 1]) {
      const [wx, wz] = P(lx, side * (D / 2 + 0.06));
      const wh = Math.min(H * 0.55, 7.5);
      w.add(mat4(wx, base + H * 0.28, wz, ry + (side > 0 ? 0 : Math.PI), 1.6, wh, 1), rnd() < lit);
      if (H > 14) w.add(mat4(wx, base + H * 0.28 + wh + 1.4, wz, ry + (side > 0 ? 0 : Math.PI), 1.1, 1.1, 1), rnd() < lit);
      if (buttress && i > 0) {
        const [bx, bz] = P(lx - L / bays / 2, side * (D / 2 + 0.55));
        b.add('stone', new THREE.BoxGeometry(0.9, H * 0.9, 1.3), mat4(bx, base + H * 0.45, bz, ry), { base, h: 8 });
        b.add('roof', new THREE.ConeGeometry(0.7, 2.2, 4), mat4(bx, base + H * 0.9 + 1.1, bz, ry + Math.PI / 4));
      }
    }
  }
}

function arcade(b, o) {
  // wall with a row of open arches (loggia), along local axis ry
  const { x, z, base, L, H, T = 1.6, n, ry = 0, archW, archH, roof = true, pointed = false } = o;
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, 0); shape.lineTo(L / 2, 0); shape.lineTo(L / 2, H); shape.lineTo(-L / 2, H); shape.lineTo(-L / 2, 0);
  const aw = archW ?? (L / n) * 0.66;
  const ah = archH ?? H * 0.72;
  for (let i = 0; i < n; i++) {
    const cx = -L / 2 + (i + 0.5) * (L / n);
    shape.holes.push(archPath(aw, ah, cx, 0.001 + (o.sill ?? 0), pointed));
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -T / 2);
  b.add('stone', g, mat4(x, base, z, ry), { base, h: 6 });
  b.add('trim', new THREE.BoxGeometry(L + 0.6, 0.8, T + 0.8), mat4(x, base + H + 0.4, z, ry));
  if (roof) {
    // lean-to roof behind the arcade
    const c = Math.cos(ry), s = Math.sin(ry);
    const depth = 5;
    const rg = new THREE.BoxGeometry(L + 0.8, 0.5, depth + 1);
    const m = mat4(x - s * 0 + s * (-depth / 2), base + H + 1.3, z + c * (-depth / 2), ry, 1, 1, 1, 0.28);
    b.add('roof', rg, m);
  }
}

function crenels(b, x0, z0, x1, z1, y, T = 1.4) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.floor(L / 2.4);
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.add('trim', new THREE.BoxGeometry(1.2, 1.3, T), mat4(lerp(x0, x1, t), y + 0.65, lerp(z0, z1, t), ry));
  }
}

function curtainWall(b, w, x0, z0, x1, z1, base, H, T = 3) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.add('stone', new THREE.BoxGeometry(L, H, T), mat4(cx, base + H / 2 - 4, cz, ry), { base: base - 4, h: 10 });
  b.add('trim', new THREE.BoxGeometry(L, 0.7, T + 0.6), mat4(cx, base + H - 4 + 0.2, cz, ry));
  crenels(b, x0, z0, x1, z1, base + H - 4 + 0.5, 0.8);
  // arrow-slit windows (few, mostly dark), both faces
  const n = Math.floor(L / 9);
  const nx = Math.sin(ry), nz = Math.cos(ry);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    for (const sd of [1, -1]) w.add(mat4(lerp(x0, x1, t) + nx * sd * (T / 2 + 0.06), base + H * 0.45, lerp(z0, z1, t) + nz * sd * (T / 2 + 0.06), ry + (sd > 0 ? 0 : Math.PI), 0.9, 2.4, 1), rnd() < 0.15);
  }
}

// ---------------------------------------------------------------------------
// Multi-arch stone bridge between two points (world or local coordinates)
export const DECKS = []; // walkable bridge decks (world space) for the character controller
export const OBST = []; // extra circular obstacles [x, z, r]
export const BELL_POS = new THREE.Vector3();

export function archBridge(b, o) {
  const { ax, az, bx, bz, topAt, groundAt, width = 6, spans = 5, tiers = 1, parapet = 1.05, deckT = 2.2 } = o;
  if (o.walkable !== false) DECKS.push({ ax, az, bx, bz, width: width - 1.0, topAt: (t) => topAt(clamp(t, 0, 1)) });
  const len = Math.hypot(bx - ax, bz - az);
  const ry = Math.atan2(-(bz - az), bx - ax);
  // sample top and ground along the bridge
  const N = 40;
  let minG = 1e9, minTop = 1e9;
  const tops = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = lerp(ax, bx, t), z = lerp(az, bz, t);
    const top = topAt(t);
    tops.push(top);
    minTop = Math.min(minTop, top);
    // ground under the whole width
    minG = Math.min(minG, groundAt(x, z));
  }
  const bottom = minG - 6;
  const shape = new THREE.Shape();
  shape.moveTo(0, bottom);
  shape.lineTo(len, bottom);
  for (let i = N; i >= 0; i--) shape.lineTo((i / N) * len, tops[i]);
  shape.lineTo(0, bottom);
  const pier = o.pier ?? Math.max(3, len / spans * 0.22);
  const spanW = (len - pier * (spans + 1)) / spans;
  const archTop = minTop - deckT;
  const lowTop = tiers === 2 ? lerp(bottom, archTop, 0.62) : archTop;
  for (let i = 0; i < spans; i++) {
    const x0 = pier + i * (spanW + pier);
    const cx = x0 + spanW / 2;
    shape.holes.push(archPath(spanW, lowTop - bottom - 0.5, cx, bottom + 0.5));
    if (tiers === 2) {
      const upH = archTop - lowTop - 3;
      const sub = 2;
      const sw = (spanW + pier) / sub;
      for (let k = 0; k < sub; k++) {
        const scx = x0 - pier / 2 + (k + 0.5) * sw;
        if (scx - sw * 0.33 < 0.8 || scx + sw * 0.33 > len - 0.8) continue;
        shape.holes.push(archPath(sw * 0.62, upH, scx, lowTop + 3));
      }
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -width / 2);
  b.add('stone', g, mat4(ax, 0, az, ry), { base: bottom + 4, h: 20, min: 0.78 });
  // parapets & deck edge trim
  const c = Math.cos(ry), s = Math.sin(ry);
  const nx = s, nz = c; // local +z in world
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const x0 = lerp(ax, bx, t0), z0 = lerp(az, bz, t0), x1 = lerp(ax, bx, t1), z1 = lerp(az, bz, t1);
    const y0 = tops[i], y1 = tops[i + 1];
    const segL = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
    const pitch = Math.atan2(y1 - y0, len / N);
    for (const sd of [-1, 1]) {
      const px = (x0 + x1) / 2 + nx * sd * (width / 2 - 0.25), pz = (z0 + z1) / 2 + nz * sd * (width / 2 - 0.25);
      b.add('trim', new THREE.BoxGeometry(segL + 0.02, parapet, 0.5), mat4(px, (y0 + y1) / 2 + parapet / 2, pz, ry, 1, 1, 1, 0, pitch));
      b.add('trim', new THREE.BoxGeometry(segL + 0.02, 0.5, 0.9), mat4(px + nx * sd * 0.2, (y0 + y1) / 2 - 0.9, pz + nz * sd * 0.2, ry, 1, 1, 1, 0, pitch));
    }
    if (i % Math.max(1, Math.round(N / (spans + 1))) === 0 && o.posts !== false) {
      for (const sd of [-1, 1]) {
        const px = x0 + nx * sd * (width / 2 - 0.25), pz = z0 + nz * sd * (width / 2 - 0.25);
        b.add('trim', new THREE.BoxGeometry(0.8, parapet + 0.7, 0.8), mat4(px, y0 + (parapet + 0.7) / 2, pz, ry));
        b.add('trim', new THREE.ConeGeometry(0.34, 0.5, 4), mat4(px, y0 + parapet + 0.95, pz, ry + Math.PI / 4));
      }
    }
  }
}

// ---------------------------------------------------------------------------
export function buildCastle(mats, hf) {
  const b = new Builder();
  const w = new Windows();

  // --- outer curtain wall polygon with towers
  const poly = [[-52, 60], [52, 60], [82, 8], [86, -68], [54, -118], [-54, -118], [-86, -68], [-82, 8]];
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    if (i === 0) {
      // front wall split around the gatehouse
      curtainWall(b, w, x0, z0, -10, z0, 0, 16);
      curtainWall(b, w, 10, z0, x1, z1, 0, 16);
    } else curtainWall(b, w, x0, z0, x1, z1, 0, 16);
    roundTower(b, w, { x: x0, z: z0, base: -6, r: 5.6, h: 22 + (i % 2) * 4, roofH: 9, lit: 0.2 });
  }

  // --- gatehouse
  {
    const gz = 61;
    const shape = new THREE.Shape();
    const GW = 20, GH = 24;
    shape.moveTo(-GW / 2, 0); shape.lineTo(GW / 2, 0); shape.lineTo(GW / 2, GH); shape.lineTo(-GW / 2, GH); shape.lineTo(-GW / 2, 0);
    shape.holes.push(archPath(7.5, 13, 0, 0.01));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -4.5);
    b.add('stone', g, mat4(0, 0, gz), { base: 0, h: 8 });
    b.add('trim', new THREE.BoxGeometry(GW + 1, 1, 10), mat4(0, GH + 0.3, gz));
    crenels(b, -GW / 2, gz + 4.6, GW / 2, gz + 4.6, GH + 0.8, 0.7);
    // arch moulding
    const ring = new THREE.TorusGeometry(4.35, 0.45, 8, 24, Math.PI);
    b.add('trim', ring, mat4(0, 13 - 3.75, gz + 4.6));
    for (const sx of [-1, 1]) roundTower(b, w, { x: sx * 10.5, z: gz + 1, base: 0, r: 4.6, h: 34, roofH: 14, lit: 0.5 });
    // warm light filling the gate passage (used for the transition glow)
    const glow = new THREE.Mesh(new THREE.ShapeGeometry(archShape(7.4, 12.9), 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d2').multiplyScalar(1.6), transparent: true, opacity: 0.92, fog: false }));
    glow.position.set(0, 0.02, gz - 2.5);
    glow.userData.noCollide = true;
    mats._gateGlow = glow;
    // banners
    for (const sx of [-1, 1]) {
      const pen = new THREE.Shape([new THREE.Vector2(-1.1, 3.5), new THREE.Vector2(1.1, 3.5), new THREE.Vector2(1.1, -2.6), new THREE.Vector2(0, -3.6), new THREE.Vector2(-1.1, -2.6)]);
      const bn = new THREE.Mesh(new THREE.ShapeGeometry(pen), new THREE.MeshStandardMaterial({ color: '#e0823d', side: THREE.DoubleSide, roughness: 0.9 }));
      bn.position.set(sx * 5.8, 17, gz + 4.62);
      bn.userData.noCollide = true;
      mats._banners = (mats._banners || []).concat(bn);
    }
    w.add(mat4(0, 16.5, gz + 4.56, 0, 2.2, 4.5, 1), true);
  }

  // --- courtyard paving
  {
    const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    b.add('trim', g, mat4(0, 0.25, 0), null);
  }

  // --- terrace 1 podium (y 0 -> 14) with front arcade and grand stair
  const T1 = 14;
  b.add('stone', new THREE.BoxGeometry(110, T1, 96), mat4(0, T1 / 2, -12), { base: 0, h: 12 });
  arcade(b, { x: -34, z: 36.3, base: 0, L: 40, H: 11, n: 6, roof: false });
  arcade(b, { x: 34, z: 36.3, base: 0, L: 40, H: 11, n: 6, roof: false });
  b.add('trim', new THREE.BoxGeometry(112, 1, 97), mat4(0, T1 + 0.3, -12));
  // balustrade along terrace edge
  crenels(b, -55, 35.6, -8, 35.6, T1 + 0.6, 0.6);
  crenels(b, 8, 35.6, 55, 35.6, T1 + 0.6, 0.6);
  // grand stair
  for (let i = 0; i < 20; i++) {
    const hh = (i + 1) * (T1 / 20);
    b.add('trim', new THREE.BoxGeometry(14, hh, 0.7), mat4(0, hh / 2, 36 + (19 - i) * 0.7 + 0.35));
  }
  for (const sx of [-1, 1]) {
    b.add('stone', new THREE.BoxGeometry(1.6, 15.5, 14), mat4(sx * 7.8, 7, 43), { base: 0, h: 6 });
    finial(b, sx * 7.8, 14.6, 49.5, 0.8);
  }

  // --- side halls on terrace 1
  hall(b, w, { x: -34, z: -8, base: T1, L: 44, D: 15, H: 13, ry: Math.PI / 2, lit: 0.35 });
  hall(b, w, { x: 34, z: -8, base: T1, L: 44, D: 15, H: 13, ry: Math.PI / 2, lit: 0.35 });
  // upper arcade galleries along inner sides
  arcade(b, { x: -21, z: -8, base: T1, L: 34, H: 8, n: 7, ry: Math.PI / 2, T: 1.2 });
  arcade(b, { x: 21, z: -8, base: T1, L: 34, H: 8, n: 7, ry: Math.PI / 2, T: 1.2 });

  // --- the great nave (cathedral hall) with twin-tower facade
  hall(b, w, { x: 0, z: -4, base: T1, L: 50, D: 22, H: 24, ry: Math.PI / 2, roofH: 13, lit: 0.45, gableWin: false });
  // rose window on the facade
  {
    const rose = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32), mats.winLit);
    rose.position.set(0, T1 + 17, 21.5);
    rose.userData.noCollide = true;
    b._extra = [rose];
    b.add('trim', new THREE.TorusGeometry(4.5, 0.55, 8, 40), mat4(0, T1 + 17, 21.4));
    // portal
    const ps = new THREE.Shape();
    ps.moveTo(-6, 0); ps.lineTo(6, 0); ps.lineTo(6, 12); ps.lineTo(-6, 12); ps.lineTo(-6, 0);
    ps.holes.push(archPath(5, 9.5, 0, 0.01, true));
    const pg = new THREE.ExtrudeGeometry(ps, { depth: 2.4, bevelEnabled: false });
    b.add('trim', pg, mat4(0, T1, 20.8));
    w.add(mat4(0, T1 + 0.02, 22.0, 0, 4.9, 9.4, 1), false);
    w.add(mat4(0, T1 + 5.5, 22.05, 0, 1.6, 2.6, 1), true);
  }
  squareTower(b, w, { x: -13.5, z: 19, base: T1, s: 8.5, h: 44, roofH: 24, lit: 0.4 });
  squareTower(b, w, { x: 13.5, z: 19, base: T1, s: 8.5, h: 44, roofH: 24, lit: 0.4 });
  // crossing tower (flèche) on the nave
  b.add('stone', new THREE.CylinderGeometry(3.4, 3.6, 10, 8), mat4(0, T1 + 24 + 13 + 3, -10));
  b.add('roof', spireGeo(3.9, 22, 8, 0.1, 1.1), mat4(0, T1 + 24 + 13 + 8, -10));
  finial(b, 0, T1 + 24 + 13 + 8 + 22, -10, 0.8);

  // --- terrace 2 (y 14 -> 32) at the back
  const T2 = 32;
  b.add('stone', new THREE.BoxGeometry(92, T2, 62), mat4(0, T2 / 2, -86), { base: T1, h: 14 });
  arcade(b, { x: 0, z: -54.6, base: T1, L: 90, H: 13, n: 13, roof: false, T: 1.4 });
  b.add('trim', new THREE.BoxGeometry(94, 1, 63), mat4(0, T2 + 0.3, -86));
  crenels(b, -46, -55, 46, -55, T2 + 0.6, 0.6);

  // --- the keep: square base -> octagonal belfry -> soaring spire
  {
    const kx = 0, kz = -84;
    const s = 26, h1 = 74;
    squareTower(b, w, { x: kx, z: kz, base: T2, s, h: h1, roofH: 0.01, lit: 0.45, pinn: false });
    // corner turrets
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      roundTower(b, w, { x: kx + sx * s * 0.52, z: kz + sz * s * 0.52, base: T2 + h1 - 22, r: 2.6, h: 26, roofH: 11, seg: 16, lit: 0.4 });
    }
    // octagonal stage
    const oBase = T2 + h1 + 1.4;
    const oh = 34, or = 10.5;
    b.add('stone', new THREE.CylinderGeometry(or, or * 1.05, oh, 8), mat4(kx, oBase + oh / 2, kz, Math.PI / 8), { base: oBase, h: 6 });
    b.add('trim', new THREE.CylinderGeometry(or * 1.12, or * 1.12, 1.4, 8), mat4(kx, oBase + oh, kz, Math.PI / 8));
    b.add('trim', new THREE.CylinderGeometry(or * 1.1, or * 1.1, 0.6, 8), mat4(kx, oBase + oh * 0.5, kz, Math.PI / 8));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const fx = kx + Math.sin(a) * (or * Math.cos(Math.PI / 8) + 0.06), fz = kz + Math.cos(a) * (or * Math.cos(Math.PI / 8) + 0.06);
      // tall lancet belfry openings
      w.add(mat4(fx, oBase + oh * 0.55, fz, a, 2.4, 11, 1), i % 2 === 0);
      w.add(mat4(fx, oBase + 4, fz, a, 1.6, 6, 1), i % 3 === 0);
      // pinnacles at corners
      const ca = a + Math.PI / 8;
      const px = kx + Math.sin(ca) * or * 1.05, pz = kz + Math.cos(ca) * or * 1.05;
      b.add('stone', new THREE.CylinderGeometry(0.7, 0.8, 5, 8), mat4(px, oBase + oh + 3, pz));
      b.add('roof', spireGeo(0.85, 8, 8, 0.1), mat4(px, oBase + oh + 5.5, pz));
      finial(b, px, oBase + oh + 13.3, pz, 0.35);
      // small gables (lucarnes) at the spire base
      const gx = kx + Math.sin(a) * or * 0.86, gz = kz + Math.cos(a) * or * 0.86;
      const lt = new THREE.Shape([new THREE.Vector2(-1.6, 0), new THREE.Vector2(1.6, 0), new THREE.Vector2(0, 5)]);
      b.add('stone', new THREE.ExtrudeGeometry(lt, { depth: 0.6, bevelEnabled: false }), mat4(gx, oBase + oh + 1.2, gz, a));
    }
    // main spire (octagonal, concave)
    const spH = 78;
    b.add('roof', spireGeo(or * 0.95, spH, 8, 0.06, 1.25), mat4(kx, oBase + oh + 1.2, kz, Math.PI / 8));
    const tip = oBase + oh + 1.2 + spH;
    finial(b, kx, tip - 1, kz, 2.2);
    b.add('gold', new THREE.TorusGeometry(3.2, 0.22, 8, 48), mat4(kx, tip + 3.2, kz, 0, 1, 1, 1, Math.PI / 2 - 0.25));
    mats._spireTip = new V3(kx, tip + 6, kz);
  }

  // --- secondary towers
  roundTower(b, w, { x: -38, z: -76, base: T2, r: 6.2, h: 58, roofH: 22, lit: 0.4 });
  roundTower(b, w, { x: 40, z: -80, base: T2, r: 6.8, h: 70, roofH: 25, lit: 0.4 });
  roundTower(b, w, { x: 26, z: -106, base: T2, r: 4.2, h: 96, roofH: 20, seg: 20, lit: 0.35 });
  roundTower(b, w, { x: -25, z: -108, base: T2, r: 4.6, h: 82, roofH: 19, seg: 20, lit: 0.35 });
  roundTower(b, w, { x: -58, z: -24, base: 0, r: 5.4, h: 44, roofH: 15, lit: 0.35 });
  roundTower(b, w, { x: 60, z: -34, base: 0, r: 5.8, h: 50, roofH: 16, lit: 0.35 });


  // --- rear palace hall across the back
  hall(b, w, { x: 0, z: -110, base: T2, L: 64, D: 16, H: 20, lit: 0.5 });
  hall(b, w, { x: -30, z: -60, base: T2, L: 24, D: 12, H: 12, lit: 0.5 });
  hall(b, w, { x: 30, z: -60, base: T2, L: 24, D: 12, H: 12, lit: 0.5 });

  // --- flying bridge between the keep and the slender rear tower
  archBridge(b, {
    ax: 13, az: -96, bx: 23, bz: -104, width: 3, spans: 1, pier: 1.2, deckT: 1.2,
    topAt: () => T2 + 44, groundAt: () => T2 + 30, posts: false, walkable: false,
  });

  const castleMesh = b.build(mats);
  const winMesh = w.build(mats, b.solids);
  const group = new THREE.Group();
  group.add(castleMesh, winMesh);
  if (b._extra) b._extra.forEach((m) => group.add(m));
  if (mats._gateGlow) group.add(mats._gateGlow);
  if (mats._banners) mats._banners.forEach((m) => group.add(m));
  group.position.set(CASTLE.x, CASTLE.top, CASTLE.z);
  group.rotation.y = CASTLE_FACING;
  group.scale.set(CASTLE_SCALE, CASTLE_SCALE * 1.28, CASTLE_SCALE);
  group.updateMatrixWorld(true);
  group.userData.gateGlow = mats._gateGlow;
  group.userData.windowsRemoved = w.rejected;
  group.userData.banners = mats._banners;
  group.userData.spireTip = group.localToWorld(mats._spireTip.clone());
  return group;
}

// ---------------------------------------------------------------------------
// World-space additions: bridges to the side mesas, chapels, the path bridges, ruins
export function buildOutworks(mats, hf, path) {
  const b = new Builder();
  const w = new Windows();
  const H = (x, z) => hf.height(x, z);

  // bridges from castle plateau to side mesas
  const toLocal = (lx, lz) => {
    const c = Math.cos(CASTLE_FACING), s = Math.sin(CASTLE_FACING);
    return [CASTLE.x + lx * c + lz * s, CASTLE.z - lx * s + lz * c];
  };
  const m1 = SIDE_MESAS[0], m2 = SIDE_MESAS[1], m3 = SIDE_MESAS[2];
  const edge = (m, towards, r) => {
    const dx = towards[0] - m.x, dz = towards[1] - m.z, l = Math.hypot(dx, dz);
    return [m.x + (dx / l) * r, m.z + (dz / l) * r];
  };
  const cm = CASTLE_MESA;
  const cA = edge(cm, [m1.x, m1.z], cm.r * 0.9);
  const mA = edge(m1, [cm.x, cm.z], m1.r * 0.7);
  archBridge(b, { ax: mA[0], az: mA[1], bx: cA[0], bz: cA[1], width: 7, spans: 4, tiers: 2, topAt: () => m1.top + 0.3, groundAt: H });
  const cB = edge(cm, [m2.x, m2.z], cm.r * 0.9);
  const mB = edge(m2, [cm.x, cm.z], m2.r * 0.7);
  archBridge(b, { ax: cB[0], az: cB[1], bx: mB[0], bz: mB[1], width: 7, spans: 4, tiers: 2, topAt: () => m2.top + 0.3, groundAt: H });
  const mC = edge(m2, [m3.x, m3.z], m2.r * 0.7);
  const m3e = edge(m3, [m2.x, m2.z], m3.r * 0.7);
  archBridge(b, { ax: mC[0], az: mC[1], bx: m3e[0], bz: m3e[1], width: 6, spans: 7, tiers: 2, topAt: () => m3.top + 0.3, groundAt: H });
  // towers where the bridges meet the castle cliff
  // gate towers flank the bridge heads (the deck itself stays open to walk across)
  for (const [x, z, top, ox, oz] of [[cA[0], cA[1], m1.top, mA[0], mA[1]], [cB[0], cB[1], m2.top, mB[0], mB[1]]]) {
    const dx = ox - x, dz = oz - z, l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    for (const sd of [-1, 1]) {
      const tx = x + nx * sd * 6.2, tz = z + nz * sd * 6.2;
      roundTower(b, w, { x: tx, z: tz, base: top - 4, r: 2.6, h: CASTLE.top - top + 18, roofH: 9, seg: 16, lit: 0.4 });
      OBST.push([tx, tz, 2.8]);
    }
  }

  // chapels on the side mesas
  for (const m of SIDE_MESAS) {
    const ry = Math.atan2(-(CASTLE.z - m.z), CASTLE.x - m.x);
    hall(b, w, { x: m.x, z: m.z, base: m.top, L: 20, D: 10, H: 10, ry, lit: 0.5 });
    const c = Math.cos(ry), s = Math.sin(ry);
    roundTower(b, w, { x: m.x - c * 12, z: m.z + s * 12, base: m.top, r: 3.8, h: 30 + (m.top % 7) * 3, roofH: 13, lit: 0.45 });
  }

  // --- journey bridges
  for (let i = 0; i < path.bridges.length; i++) {
    const br = path.bridges[i];
    const a = path.sample(br.s0 - 3), c = path.sample(br.s1 + 3);
    const len = br.s1 - br.s0 + 6;
    const topAt = (t) => {
      const s = br.s0 - 3 + t * len;
      return path.sample(s).y;
    };
    if (i === 0) {
      archBridge(b, { ax: a.x, az: a.z, bx: c.x, bz: c.z, width: 6, spans: 4, topAt, groundAt: H, deckT: 2.4 });
    } else {
      archBridge(b, { ax: a.x, az: a.z, bx: c.x, bz: c.z, width: 7, spans: 3, tiers: 2, topAt, groundAt: H, deckT: 3 });
      // gate pylons where the grand bridge lands
      const d = new V3(c.x - a.x, 0, c.z - a.z).normalize();
      const n = new V3(-d.z, 0, d.x);
      for (const sd of [-1, 1]) {
        const px = a.x + n.x * sd * 5.2, pz = a.z + n.z * sd * 5.2;
        roundTower(b, w, { x: px, z: pz, base: a.y - 1, r: 1.7, h: 12, roofH: 6, seg: 12, lit: 0.8 });
      }
    }
  }

  // --- ancient ruins near the start: bell arch, fallen blocks, old pillars along the way
  {
    // bell arch standing beside the meadow path (frames the opening like the reference)
    const bp = path.sample(40);
    const lx = bp.tz, lz = -bp.tx; // left of travel direction
    const sx = bp.x + lx * 16, sz = bp.z + lz * 16;
    const y = H(sx, sz) - 0.6;
    const ry = Math.atan2(-bp.tx, -bp.tz) - 0.45; // arch opening faces back along the path
    const L = (ax, ay, az) => { // local -> world matrix helper
      const c = Math.cos(ry), sn = Math.sin(ry);
      return [sx + ax * c + az * sn, y + ay, sz - ax * sn + az * c];
    };
    const put = (bucket, geo, ax, ay, az, extraRy = 0) => { const [wx, wy, wz] = L(ax, ay, az); b.add(bucket, geo, mat4(wx, wy, wz, ry + extraRy), { base: y, h: 5 }); };
    put('trim', new THREE.BoxGeometry(6.4, 1.2, 3.2), 0, 0.6, 0);
    for (const px of [-2.2, 2.2]) {
      put('stone', new THREE.BoxGeometry(1.4, 11, 1.8), px, 6.6, 0);
      put('trim', new THREE.BoxGeometry(1.8, 0.6, 2.2), px, 1.5, 0);
      put('trim', new THREE.BoxGeometry(1.8, 0.6, 2.2), px, 12.1, 0);
    }
    const arch = new THREE.Shape();
    arch.moveTo(-2.9, 0); arch.lineTo(2.9, 0); arch.lineTo(2.9, 3.4); arch.lineTo(-2.9, 3.4); arch.lineTo(-2.9, 0);
    arch.holes.push(archPath(3.0, 2.4, 0, -0.01));
    const ag0 = new THREE.ExtrudeGeometry(arch, { depth: 1.8, bevelEnabled: false, curveSegments: 14 });
    ag0.translate(0, 0, -0.9);
    put('stone', ag0, 0, 12.4, 0);
    put('trim', new THREE.BoxGeometry(6.6, 0.6, 2.6), 0, 16.1, 0);
    const gab = new THREE.Shape([new THREE.Vector2(-3.2, 0), new THREE.Vector2(3.2, 0), new THREE.Vector2(0, 2.2)]);
    const gg = new THREE.ExtrudeGeometry(gab, { depth: 2.4, bevelEnabled: false });
    gg.translate(0, 0, -1.2);
    put('roof', gg, 0, 16.4, 0);
    { const [fx, fy, fz] = L(0, 18.6, 0); finial(b, fx, fy, fz, 0.7); }
    const bellPts = [new THREE.Vector2(0.01, 0), new THREE.Vector2(0.95, 0), new THREE.Vector2(0.8, 0.4), new THREE.Vector2(0.58, 1.1), new THREE.Vector2(0.5, 1.5), new THREE.Vector2(0.01, 1.62)];
    { const [bx, by, bz] = L(0, 12.2, 0); BELL_POS.set(bx, by, bz); b.add('gold', new THREE.LatheGeometry(bellPts, 20), mat4(bx, by, bz)); b.add('trim', new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), mat4(bx, by + 2.1, bz)); }
    // moss & ivy clumps on the old stones
    const r0 = mulberry32(12);
    for (let i = 0; i < 18; i++) {
      const px = (r0() < 0.5 ? -2.2 : 2.2) + (r0() - 0.5) * 1.2;
      const py = Math.pow(r0(), 2.2) * 9 + 0.8;
      const pz = (r0() < 0.5 ? -0.92 : 0.92);
      const g = new THREE.IcosahedronGeometry(0.28 + r0() * 0.3, 1);
      g.scale(1.3, 0.8, 0.45);
      put('moss', g, px, py, pz);
    }
    const sy0 = y;
    // broken columns
    const cols = [[-166, 150, 5.5], [-188, 186, 3.2], [-150, 120, 2.2], [-120, 60, 4.5], [-97, 6, 3.0], [-70, -62, 5.2], [-46, -124, 2.6]];
    for (const [cx, cz, ch] of cols) {
      const off = path.nearest(cx, cz, 60);
      let px = cx, pz = cz;
      if (off && off.d < 7) { // keep clear of the path
        const p = path.sample(off.s);
        const nx = -p.tz, nz = p.tx;
        px = p.x + nx * 8; pz = p.z + nz * 8;
      }
      const gy = H(px, pz);
      b.add('stone', new THREE.CylinderGeometry(0.55, 0.62, ch, 12), mat4(px, gy + ch / 2 - 0.3, pz), { base: gy, h: 2 });
      OBST.push([px, pz, 0.8]);
      b.add('trim', new THREE.BoxGeometry(1.6, 0.5, 1.6), mat4(px, gy + 0.1, pz));
      if (ch > 4) b.add('trim', new THREE.BoxGeometry(1.5, 0.5, 1.5), mat4(px, gy + ch - 0.3, pz, 0.3));
    }
    // scattered blocks
    const r = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const bx = -200 + r() * 90, bz = 110 + r() * 110;
      const n = path.nearest(bx, bz, 30);
      if (n && (n.d < 14 || n.s < 30)) continue;
      const gy = H(bx, bz);
      const sx2 = 0.8 + r() * 1.6;
      b.add('stone', new THREE.BoxGeometry(sx2, 0.6 + r() * 0.8, 0.8 + r() * 1.2), mat4(bx, gy + 0.2, bz, r() * 3, 1, 1, 1, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3), { base: gy - 0.5, h: 1.5 });
    }
  }

  const g = new THREE.Group();
  g.add(b.build(mats), w.build(mats, b.solids));
  return g;
}
