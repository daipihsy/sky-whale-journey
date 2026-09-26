// Night life around the traveller: fireflies drifting over the grass and water.
import * as THREE from 'three';
import { SKY } from './atmosphere.js';
import { mulberry32 } from './noise.js';

export class Fireflies {
  constructor(hf, n = 240, radius = 70) {
    this.hf = hf; this.n = n; this.R = radius;
    const r = mulberry32(8);
    this.anchor = new Float32Array(n * 3); // world-space anchors, wrapped into a box around the traveller
    this.phase = new Float32Array(n);
    this.pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.anchor[i * 3] = (r() - 0.5) * 2 * radius;
      this.anchor[i * 3 + 1] = 0.4 + r() * r() * 5;
      this.anchor[i * 3 + 2] = (r() - 0.5) * 2 * radius;
      this.phase[i] = r() * 100; seed[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPx: { value: 900 }, uCenter: { value: new THREE.Vector3() } }]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aSeed; uniform float uPx, uSkyTime; uniform vec3 uCenter;
        varying float vA, vSeed;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float px = 0.24 * uPx / max(-mvPosition.z, 0.5);
          // slow blink: a dim ember that swells to full glow for a few seconds
          float b = sin(uSkyTime * (0.35 + aSeed * 0.5) + aSeed * 40.0);
          float blink = 0.15 + 0.85 * smoothstep(-0.2, 0.8, b);
          float edge = 1.0 - smoothstep(0.7, 1.0, length(position.xz - uCenter.xz) / ${radius.toFixed(1)});
          vA = blink * edge * clamp(px / 2.0, 0.0, 1.0);
          vSeed = aSeed;
          gl_PointSize = clamp(px, 2.0, 40.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        varying float vA, vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.18, 0.0, d), halo = smoothstep(0.5, 0.0, d);
          vec3 col = mix(vec3(0.75, 1.0, 0.35), vec3(1.0, 0.85, 0.35), vSeed);
          gl_FragColor = vec4(col * (core * 2.2 + halo * halo * 0.6) * vA * uNight, 1.0);
          #ifdef USE_FOG
            gl_FragColor.rgb *= 1.0 - fogAmountAt(vFogWorld);
          #endif
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
    this.geo = g;
  }
  update(t, center, camera, viewH) {
    this.points.visible = SKY.uNight.value > 0.02;
    if (!this.points.visible) return;
    const R = this.R, D = R * 2;
    const wrap = (a, c) => c + ((((a - c + R) % D) + D) % D) - R;
    for (let i = 0; i < this.n; i++) {
      const ph = this.phase[i];
      const ax = wrap(this.anchor[i * 3], center.x), az = wrap(this.anchor[i * 3 + 2], center.z);
      // lazy wandering loops
      const x = ax + Math.sin(t * 0.21 + ph) * 3 + Math.sin(t * 0.53 + ph * 2.1) * 1.2;
      const z = az + Math.cos(t * 0.17 + ph * 1.3) * 3 + Math.cos(t * 0.47 + ph) * 1.2;
      const ground = Math.max(this.hf.height(x, z), 0);
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = ground + this.anchor[i * 3 + 1] + Math.sin(t * 0.7 + ph) * 0.5; this.pos[i * 3 + 2] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mat.uniforms.uCenter.value.copy(center);
    this.mat.uniforms.uPx.value = viewH * 0.5 * camera.projectionMatrix.elements[5];
  }
}
