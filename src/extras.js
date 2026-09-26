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
  const rock = new THREE.LatheGeometry(pts, 28);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const n = 1 + 0.18 * simplex2(Math.cos(a) * 2 + seed, y * 0.05) + 0.08 * simplex2(a * 3, y * 0.2 + seed);
    p.setXYZ(i, x * n, y, z * n);
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
  const merged = mergeGeometries([rock.toNonIndexed(), top.toNonIndexed(), ...trees].map((g) => { g.deleteAttribute('uv'); return g; }));
  merged.computeVertexNormals();
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
  const fallMat = new THREE.MeshBasicMaterial({ color: '#eef4f8', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  for (const it of islands) {
    const m = new THREE.Mesh(floatingIsland(it.r, it.h, it.s), islandMat);
    m.position.set(...it.p);
    m.userData.noCollide = true;
    group.add(m);
    // thin veil of water spilling off the rim
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(it.r * 0.18, it.h * 1.6, 1, 8), fallMat);
    fall.geometry.translate(0, -it.h * 0.8, 0);
    fall.position.set(it.p[0] + it.r * 0.8, it.p[1], it.p[2] + it.r * 0.3);
    fall.userData.noCollide = true;
    group.add(fall);
    const base = new THREE.Vector3(...it.p), ph = it.s;
    updaters.push((t) => {
      const dy = Math.sin(t * 0.12 + ph) * 3;
      m.position.y = base.y + dy; m.rotation.y = t * 0.004 * (ph % 2 ? 1 : -1);
      fall.position.y = base.y + dy;
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
