// Soft painterly cloud billboards (instanced, depth-sorted each frame).
import * as THREE from 'three';
import { mulberry32, clamp, lerp, fbm, smoothstep } from './noise.js';
import { SKY_GLSL } from './atmosphere.js';
import { baseHeight } from './world.js';

function makeCloudAtlas() {
  const T = 256, N = 4;
  const cv = document.createElement('canvas');
  cv.width = T * N; cv.height = T;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(T * N, T);
  const rnd = mulberry32(77);
  for (let v = 0; v < N; v++) {
    // blobs forming a cumulus: flat-ish base, puffy crown
    const blobs = [];
    const count = 22 + v * 4;
    for (let i = 0; i < count; i++) {
      const bx = 0.5 + (rnd() - 0.5) * (v === 3 ? 0.8 : 0.62);
      const top = v === 3 ? 0.08 : 0.22;
      const by = 0.6 - Math.pow(rnd(), 1.4) * (0.6 - top) * (1 - Math.abs(bx - 0.5) * 1.2);
      const r = (0.07 + rnd() * 0.11) * (v === 3 ? 0.8 : 1) * (1.2 - Math.abs(bx - 0.5));
      blobs.push([bx, by, r]);
    }
    const dens = new Float32Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = x / T, w = y / T;
      let d = 0;
      for (const [bx, by, r] of blobs) {
        const dx = (u - bx) / r, dy = (w - by) / (r * (v === 3 ? 0.55 : 0.9));
        d += Math.exp(-(dx * dx + dy * dy) * 1.6);
      }
      // flatten the base
      d *= smoothstep(0.72, 0.58, w);
      const n = fbm(u * 6 + v * 10, w * 6, 4);
      d = d * (0.75 + 0.45 * n);
      // fade toward the tile border
      const edge = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u) * smoothstep(0.0, 0.1, w) * smoothstep(1.0, 0.85, w);
      dens[y * T + x] = clamp((d - 0.35) * 1.3, 0, 1) * edge;
    }
    // lighting: light comes from above (and a little right): brighter where density above is low
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let occ = 0;
      for (let k = 1; k <= 10; k++) {
        const sx = Math.min(T - 1, x + k * 2), sy = Math.max(0, y - k * 5);
        occ += dens[sy * T + sx];
      }
      const light = clamp(1 - occ * 0.16, 0, 1);
      const a = dens[y * T + x];
      const i = (y * T * N + v * T + x) * 4;
      img.data[i] = Math.round(light * 255);
      img.data[i + 1] = Math.round(Math.pow(a, 0.9) * 255);
      img.data[i + 2] = Math.round(clamp(fbm(x / 20 + v, y / 20, 2) * 0.5 + 0.5, 0, 1) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class Clouds {
  constructor() {
    this.items = [];
    const rnd = mulberry32(5);
    const add = (x, y, z, w, h, opts = {}) => this.items.push({
      p: new THREE.Vector3(x, y, z), w, h, v: opts.v ?? Math.floor(rnd() * 3), op: opts.op ?? 1,
      drift: opts.drift ?? 1, flip: rnd() < 0.5 ? -1 : 1, warm: opts.warm ?? 0, phase: rnd() * 100,
    });

    // 1) the cumulus sky itself is volumetric now (clouds3d.js); billboards keep to the low layers
    // 2) cloud belts drifting between the mountains
    for (let i = 0; i < 60; i++) {
      const x = lerp(-3000, 3000, rnd()), z = lerp(-3300, -1700, rnd());
      const base = Math.max(baseHeight(x, z), 0);
      const y = lerp(260, 620, rnd());
      const w = lerp(260, 620, rnd());
      const h = w * lerp(0.22, 0.35, rnd());
      if (!this.clear(x, y, z, w, h)) continue;
      add(x, y, z, w, h, { v: 3, op: 0.9 });
    }
    // 3) low cloud banks around the valley rim, below the plateaus (kept soft and distant)
    const low = [
      [-620, 40, -760, 320], [-760, 60, -340, 340], [-460, 30, -1060, 300], [760, 40, -420, 300], [820, 50, -960, 340],
      [600, 30, 160, 260], [-120, 40, -980, 240], [560, 55, -1150, 280], [760, 30, -640, 240], [-700, 35, 120, 280],
      [480, 16, -40, 200], [420, 12, -300, 170],
    ];
    for (const [x, y, z, w] of low) {
      add(x, y + w * 0.16, z, w * 1.5, w * 0.5, { v: 3, op: 0.7 });
      add(x + (rnd() - 0.5) * w, y + w * 0.12, z + (rnd() - 0.5) * w * 0.6, w, w * 0.45, { v: Math.floor(rnd() * 3), op: 0.6 });
    }
    // mist in the gorge and below waterfalls
    add(192, 14, -728, 70, 24, { v: 3, op: 0.85 });
    add(170, 10, -760, 60, 20, { v: 3, op: 0.8 });
    // 4) thin veils at the whale's altitude (it drifts through them)
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2;
      const x = 600 + Math.cos(a) * lerp(500, 760, rnd()), z = -1650 + Math.sin(a) * lerp(380, 560, rnd());
      add(x, lerp(600, 780, rnd()), z, lerp(180, 360, rnd()), lerp(60, 120, rnd()), { v: 3, op: 0.45 });
    }

    const n = this.items.length;
    this.n = n;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aCenter = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); // w, h, variant, flip
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); // opacity, warm, phase
    this.aCenter.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aMisc.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aMisc', this.aMisc);
    geo.instanceCount = n;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uAtlas: { value: null }, uTime: { value: 0 },
    }]);
    uniforms.uAtlas.value = makeCloudAtlas();
    this.material = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 aCenter; attribute vec4 aSize; attribute vec3 aMisc;
        varying vec2 vUv; varying float vVar, vOp, vWarm; varying vec3 vWorld; varying float vFade;
        void main() {
          vec4 mvC = viewMatrix * vec4(aCenter, 1.0);
          vec3 mvPosition3 = mvC.xyz + vec3(position.x * aSize.x, position.y * aSize.y, 0.0);
          vec4 mvPosition = vec4(mvPosition3, 1.0);
          vUv = vec2(aSize.w > 0.0 ? uv.x : 1.0 - uv.x, uv.y);
          vVar = aSize.z; vOp = aMisc.x; vWarm = aMisc.y;
          vWorld = (inverse(viewMatrix) * mvPosition).xyz;
          // fade clouds that come too close to the camera
          vFade = smoothstep(20.0, 140.0, -mvC.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uAtlas;
        varying vec2 vUv; varying float vVar, vOp, vWarm; varying vec3 vWorld; varying float vFade;
        ${'#ifndef USE_FOG\n' + SKY_GLSL + '\n#endif'}
        void main() {
          vec2 uv = vec2((vUv.x + vVar) / 4.0, vUv.y);
          vec4 t = texture2D(uAtlas, uv);
          float a = t.g * vOp * vFade;
          if (a < 0.004) discard;
          vec3 V = normalize(vWorld - cameraPosition);
          float sunF = pow(max(dot(V, uLightDir), 0.0), 3.0);
          vec3 lit = uCloudLit;
          vec3 shade = uCloudShade;
          vec3 warmLit = uCloudLit * vec3(1.0, 0.88, 0.7);
          vec3 c = mix(shade, mix(lit, warmLit, vWarm * 0.55 + sunF * 0.4), t.r);
          // silver lining where the cloud is thin and faces the sun
          c += uLightCol * vec3(1.0, 0.9, 0.75) * (1.0 - t.g) * t.g * 0.9 * (0.15 + sunF * 1.4);
          c *= 0.96 + t.b * 0.08;
          // lower parts pick up bluish bounce
          c = mix(c, c * vec3(0.9, 0.94, 1.02), smoothstep(0.35, 0.85, vUv.y) * 0.0);
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
          gl_FragColor.rgb *= 1.0;
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this._order = new Array(n).fill(0).map((_, i) => i);
    this._dist = new Float32Array(n);
  }

  clear(x, y, z, w, h) {
    for (let i = -3; i <= 3; i++) {
      const xx = x + (i / 3) * w * 0.45;
      if (baseHeight(xx, z) > y - h * 0.18) return false;
    }
    return true;
  }

  update(t, camera) {
    this.material.uniforms.uTime.value = t;
    const cp = camera.position;
    const items = this.items;
    for (let i = 0; i < this.n; i++) {
      const it = items[i];
      it.cx = it.p.x + Math.sin(t * 0.004 + it.phase) * 120 * it.drift;
      it.cy = it.p.y + Math.sin(t * 0.03 + it.phase) * 2;
      it.cz = it.p.z + Math.cos(t * 0.003 + it.phase) * 30 * it.drift;
      const dx = it.cx - cp.x, dy = it.cy - cp.y, dz = it.cz - cp.z;
      this._dist[i] = dx * dx + dy * dy + dz * dz;
    }
    this._order.sort((a, b) => this._dist[b] - this._dist[a]);
    const c = this.aCenter.array, s = this.aSize.array, m = this.aMisc.array;
    for (let k = 0; k < this.n; k++) {
      const it = items[this._order[k]];
      c[k * 3] = it.cx; c[k * 3 + 1] = it.cy; c[k * 3 + 2] = it.cz;
      s[k * 4] = it.w; s[k * 4 + 1] = it.h; s[k * 4 + 2] = it.v; s[k * 4 + 3] = it.flip;
      m[k * 3] = it.op; m[k * 3 + 1] = it.warm; m[k * 3 + 2] = it.phase;
    }
    this.aCenter.needsUpdate = true; this.aSize.needsUpdate = true; this.aMisc.needsUpdate = true;
  }
}
