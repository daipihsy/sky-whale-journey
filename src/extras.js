// Mythic details from the reference painting: floating islands, the light above the spire,
// small ruins on the lake rocks, and a ribbon on the old bell arch.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, Windows, roundTower, mat4, BELL_POS } from './castle.js';
import { PILLARS } from './world.js';
import { mulberry32, simplex2, smoothstep, lerp } from './noise.js';

function floatingIsland(r, h, seed) {
  const rnd = mulberry32(seed);
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // rounded top edge, long rocky taper below
    // rounded shoulder under the turf, then a craggy, bulbous underside tapering to a point
    const q = (t - 0.1) / 0.9;
    const rr = t < 0.1 ? r * (0.92 + 0.08 * Math.sin((t / 0.1) * Math.PI / 2)) : r * (1 - Math.pow(q, 1.6)) * (1 - 0.25 * q);
    pts.push(new THREE.Vector2(Math.max(rr, 0.01), -t * h));
  }
  const rock = new THREE.LatheGeometry(pts, 40);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = 1 + 0.18 * simplex2(Math.cos(a) * 2 + seed, y * 0.05) + 0.08 * simplex2(a * 3, y * 0.2 + seed);
    // stepped strata: little ledges and overhangs down the flanks
    const layer = -y * 0.09 + simplex2(a * 1.3 + seed, 0.5) * 0.6;
    const ledge = 1 - 0.06 * (layer - Math.floor(layer)) * smoothstep(0.02, 0.12, -y / h);
    p.setXYZ(i, x * n * ledge, y, z * n * ledge);
  }
  rock.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color(), a1 = new THREE.Color('#a39c8e'), a2 = new THREE.Color('#6f7383'), g = new THREE.Color('#6e9a52');
  for (let i = 0; i < p.count; i++) {
    const y = -p.getY(i) / h;
    c.copy(a1).lerp(a2, smoothstep(0.1, 0.9, y)).lerp(g, smoothstep(0.08, 0.0, y));
    const band = 0.5 + 0.5 * Math.sin(p.getY(i) * 0.6);
    c.multiplyScalar(0.92 + band * 0.1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const top = new THREE.CircleGeometry(r * 0.97, 28);
  top.rotateX(-Math.PI / 2);
  top.translate(0, 0.3, 0);
  const tc = new Float32Array(top.attributes.position.count * 3);
  for (let i = 0; i < tc.length; i += 3) { tc[i] = 0.42; tc[i + 1] = 0.6; tc[i + 2] = 0.3; }
  top.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  // a few firs on top
  const trees = [];
  for (let i = 0; i < Math.round(r / 2.5); i++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r * 0.7, s = 0.8 + rnd() * 0.8;
    const cone = new THREE.ConeGeometry(2.2 * s, 7 * s, 7);
    cone.translate(Math.cos(a) * d, 3.5 * s + 0.3, Math.sin(a) * d);
    const cc = new Float32Array(cone.attributes.position.count * 3);
    for (let k = 0; k < cc.length; k += 3) { cc[k] = 0.2; cc[k + 1] = 0.36; cc[k + 2] = 0.29; }
    cone.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    trees.push(cone.toNonIndexed());
  }
  // vines and roots trailing from the rim and the underside
  const vines = [];
  const vc = new THREE.Color(), vineA = new THREE.Color('#3f5a3a'), vineB = new THREE.Color('#6c5a44');
  const nv = Math.round(14 + r * 0.5);
  for (let i = 0; i < nv; i++) {
    const a = rnd() * Math.PI * 2, under = rnd() < 0.45;
    const t0 = under ? 0.15 + rnd() * 0.35 : 0.02;
    const q = (t0 - 0.1) / 0.9, rr = (t0 < 0.1 ? r * 0.96 : r * (1 - Math.pow(q, 1.6)) * (1 - 0.25 * q)) * 0.97;
    const start = new THREE.Vector3(Math.cos(a) * rr, -t0 * h, Math.sin(a) * rr);
    const len = (under ? 0.35 : 0.5) * h * (0.4 + rnd() * 0.8);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const cps = [];
    for (let k = 0; k <= 5; k++) {
      const f = k / 5;
      cps.push(start.clone().addScaledVector(out, (under ? -0.5 : 1.2) * f + Math.sin(f * 3 + i) * 0.8).add(new THREE.Vector3(Math.sin(i * 1.7 + f * 4) * 0.8, -len * f, Math.cos(i * 1.3 + f * 3) * 0.8)));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cps), 12, (under ? 0.45 : 0.3) * (0.6 + rnd() * 0.8), 4, false);
    vc.copy(under ? vineB : vineA).multiplyScalar(0.8 + rnd() * 0.4);
    const cc = new Float32Array(tube.attributes.position.count * 3);
    for (let k = 0; k < cc.length; k += 3) { cc[k] = vc.r; cc[k + 1] = vc.g; cc[k + 2] = vc.b; }
    tube.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    vines.push(tube.toNonIndexed());
  }
  // (each part keeps its own smooth normals)
  const merged = mergeGeometries([rock.toNonIndexed(), top.toNonIndexed(), ...trees, ...vines].map((g) => { g.deleteAttribute('uv'); return g; }));
  return merged;
}

export function buildExtras(hf, castle, mats, path) {
  const group = new THREE.Group();
  const updaters = [];
  group.userData.bellPos = BELL_POS;

  // --- floating islands drifting in the sky (left of the valley, like the painting)
  const islandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const islands = [
    { p: [-470, 250, -820], r: 46, h: 80, s: 3 }, { p: [-260, 340, -1120], r: 30, h: 58, s: 5 },
    { p: [-700, 420, -1400], r: 60, h: 110, s: 7 },
  ];
  const fallMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float x = vUv.x, y = 1.0 - vUv.y; // y: 0 at the rim -> 1 far below
        float streak = fn(vec2(x * 14.0, y * 4.0 - uTime * 1.4)) * 0.6 + fn(vec2(x * 40.0, y * 10.0 - uTime * 2.6)) * 0.4;
        float edge = smoothstep(0.0, 0.2 + 0.3 * y, x) * smoothstep(1.0, 0.8 - 0.3 * y, x);
        float a = edge * (0.18 + 0.82 * streak * streak) * smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.2, 0.9, y)); // falls apart into mist
        vec3 c = mix(vec3(0.8, 0.87, 0.94), vec3(1.0), streak) * uAmbientTint;
        gl_FragColor = vec4(c, a * 0.7);
        #include <fog_fragment>
      }`,
  });
  // a ribbon that leaves the rim, arcs outward and falls
  const fallRibbon = (w, L) => {
    const g = new THREE.PlaneGeometry(w, L, 1, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const f = 0.5 - p.getY(i) / L; // 0 at the top, 1 at the bottom
      p.setXYZ(i, p.getX(i) * (1 + f * 1.8), -f * L, Math.sqrt(f) * L * 0.12);
    }
    g.computeVertexNormals();
    return g;
  };
  // a small ruined watchtower on the largest island, in the castle's own stone
  const rb = new Builder(), rw = new Windows();
  roundTower(rb, rw, { x: -10, z: 6, base: 0, r: 4.2, h: 16, roofH: 9, seg: 18, lit: 0.6 });
  rb.add('stone', new THREE.BoxGeometry(14, 5.5, 1.6), mat4(4, 2.75, 3, 0.4), { base: 0, h: 4 });
  rb.add('stone', new THREE.BoxGeometry(1.6, 9, 1.6), mat4(11, 4.5, 0, 0.4), { base: 0, h: 4 });
  const ruin = rb.build(mats);
  ruin.add(rw.build(mats, rb.solids));
  ruin.traverse((o) => { o.userData.noCollide = true; });
  for (const [idx, it] of islands.entries()) {
    const m = new THREE.Mesh(floatingIsland(it.r, it.h, it.s), islandMat);
    m.position.set(...it.p);
    m.userData.noCollide = true;
    group.add(m);
    if (idx === 0) { ruin.position.set(0, 0.3, 0); m.add(ruin); }
    // water spilling off the rim (two falls on the big islands)
    const falls = [];
    for (let k = 0; k < (it.r > 40 ? 2 : 1); k++) {
      const a = (it.s * 1.7 + k * 2.4) % (Math.PI * 2);
      const fall = new THREE.Mesh(fallRibbon(it.r * (0.08 + 0.03 * k), it.h * 1.8), fallMat);
      fall.position.set(Math.cos(a) * it.r * 0.93, 0.2, Math.sin(a) * it.r * 0.93);
      fall.rotation.y = -a + Math.PI / 2;
      fall.userData.noCollide = true;
      m.add(fall);
      falls.push(fall);
    }
    const base = new THREE.Vector3(...it.p), ph = it.s;
    updaters.push((t) => {
      const dy = Math.sin(t * 0.12 + ph) * 3;
      m.position.y = base.y + dy; m.rotation.y = t * 0.004 * (ph % 2 ? 1 : -1);
      fallMat.uniforms.uTime.value = t;
    });
  }

  // --- light above the keep: a soft vertical beam and a halo
  const tip = castle.userData.spireTip.clone();
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; varying vec2 vUv;
      void main(){
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float a = pow(across, 3.0) * smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.02, vUv.y);
        a *= 0.8 + 0.2 * sin(vUv.y * 40.0 - uT * 0.8);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a * 0.32, 1.0);
      }`,
  });
  for (let i = 0; i < 2; i++) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 1600), beamMat);
    beam.geometry.translate(0, 800, 0);
    beam.position.copy(tip);
    beam.rotation.y = i * Math.PI / 2;
    beam.userData.noCollide = true;
    group.add(beam);
  }
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(16, 0.5, 8, 96), haloMat);
  halo.position.copy(tip).add(new THREE.Vector3(0, 22, 0));
  halo.rotation.x = Math.PI / 2 - 0.2;
  halo.userData.noCollide = true;
  group.add(halo);
  updaters.push((t) => { beamMat.uniforms.uT.value = t; halo.rotation.z = t * 0.05; haloMat.opacity = 0.45 + 0.1 * Math.sin(t * 0.7); });

  // --- small ruined towers on the lake rocks and a far highland shrine
  const b = new Builder(), w = new Windows();
  for (const [x, z, r, hgt] of PILLARS.filter((p) => p[3] >= 14 && p[3] <= 30)) {
    const y = hf.height(x, z);
    roundTower(b, w, { x, z, base: y - 1, r: Math.min(3.2, r * 0.25), h: 9 + hgt * 0.35, roofH: 6, seg: 14, lit: 0.5 });
  }
  const g2 = b.build(mats);
  group.add(g2, w.build(mats, b.solids));

  // --- a faded ribbon hanging from the bell arch
  const ribbonG = new THREE.PlaneGeometry(0.7, 5.5, 1, 14);
  ribbonG.translate(0, -2.75, 0);
  const ribbon = new THREE.Mesh(ribbonG, new THREE.MeshStandardMaterial({ color: '#efa16a', side: THREE.DoubleSide, roughness: 0.9 }));
  ribbon.position.copy(BELL_POS).add(new THREE.Vector3(2.2, 3.4, 0.6));
  ribbon.userData.noCollide = true;
  group.add(ribbon);
  const rest = ribbonG.attributes.position.array.slice();
  updaters.push((t) => {
    const p = ribbonG.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const d = -rest[i + 1] / 5.5;
      p[i + 2] = rest[i + 2] + Math.sin(t * 1.7 - d * 3) * d * d * 0.9 + d * d * 1.2;
      p[i] = rest[i] + Math.sin(t * 1.1 - d * 2) * d * 0.25;
    }
    ribbonG.attributes.position.needsUpdate = true;
    ribbonG.computeVertexNormals();
  });

  group.userData.update = (t, dt) => { for (const u of updaters) u(t, dt); };
  return group;
}
