// A few white birds gliding over the valley (instanced, wing flap in the vertex shader).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export class Birds {
  constructor(count = 14) {
    const g = new THREE.BufferGeometry();
    // body + two wings (wing verts tagged by |x|)
    const v = [
      0, 0, 0.5, -0.08, 0, -0.4, 0.08, 0, -0.4, // body
      0, 0, 0.15, 0, 0, -0.2, -1.2, 0, -0.25, // left wing
      0, 0, 0.15, 1.2, 0, -0.25, 0, 0, -0.2, // right wing
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.8, emissive: '#ffffff', emissiveIntensity: 0.25 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      mat.userData.shader = sh;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = float(gl_InstanceID) * 1.7;
        float flap = sin(uTime * 5.0 + ph) * step(0.5, mod(floor(uTime * 0.25 + ph), 2.0) + 0.5 * sin(ph));
        transformed.y += abs(position.x) * (0.55 * flap + 0.12);`);
    };
    this.mat = mat;
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false;
    const r = mulberry32(8);
    this.birds = Array.from({ length: count }, (_, i) => ({
      cx: 120 + r() * 200, cz: -200 - r() * 400, rad: 60 + r() * 120, y: 40 + r() * 60,
      sp: (0.08 + r() * 0.05) * (r() < 0.5 ? 1 : -1), ph: r() * 6.28, s: 1.2 + r() * 0.6,
    }));
    this.m = new THREE.Matrix4();
  }
  update(t) {
    if (this.mat.userData.shader) this.mat.userData.shader.uniforms.uTime.value = t;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    this.birds.forEach((b, i) => {
      const a = b.ph + t * b.sp;
      const x = b.cx + Math.cos(a) * b.rad, z = b.cz + Math.sin(a) * b.rad * 0.6;
      const y = b.y + Math.sin(t * 0.3 + b.ph) * 6;
      const dx = -Math.sin(a) * Math.sign(b.sp), dz = Math.cos(a) * 0.6 * Math.sign(b.sp);
      e.set(0, Math.atan2(dx, dz), -0.35 * Math.sign(b.sp));
      q.setFromEuler(e);
      this.m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(b.s, b.s, b.s));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
