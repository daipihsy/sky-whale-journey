// Volumetric cumulus layer: raymarched at half resolution through a tiling 3D noise, lit by the
// sun with self-shadowing and forward scattering, fading into the sky with distance, and occluded
// by the scene depth (mountains poke through, the castle stands in front).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SKY_GLSL, SKY } from './atmosphere.js';

function tilingNoise3D(N = 64) {
  const data = new Uint8Array(N * N * N * 2);
  // hashed lattice values that wrap at the period -> seamless tiling
  const hash = (x, y, z, p) => {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p; z = ((z % p) + p) % p;
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const value = (x, y, z, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = smooth(x - xi), fy = smooth(y - yi), fz = smooth(z - zi);
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      r += hash(xi + dx, yi + dy, zi + dz, p) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    }
    return r;
  };
  const worley = (x, y, z, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let d = 9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cx = xi + i, cy = yi + j, cz = zi + k;
      const px = cx + hash(cx, cy, cz, p), py = cy + hash(cx + 17, cy, cz, p), pz = cz + hash(cx, cy + 31, cz, p);
      d = Math.min(d, (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2);
    }
    return 1 - Math.min(1, Math.sqrt(d));
  };
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const per = value(u * 4, v * 4, w * 4, 4) * 0.5 + value(u * 8, v * 8, w * 8, 8) * 0.3 + value(u * 16, v * 16, w * 16, 16) * 0.2;
    const wor = worley(u * 4, v * 4, w * 4, 4) * 0.6 + worley(u * 8, v * 8, w * 8, 8) * 0.3 + worley(u * 16, v * 16, w * 16, 16) * 0.1;
    // Perlin-Worley: billowy base shape; second channel: detail erosion
    const pw = Math.min(1, Math.max(0, per + (wor - 1) * 0.35 * (1 - per) + 0.15));
    data[o++] = pw * 255;
    data[o++] = (worley(u * 8, v * 8, w * 8, 8) * 0.6 + worley(u * 16, v * 16, w * 16, 16) * 0.4) * 255;
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const MARCH_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D tDepth;
uniform sampler3D tNoise;
uniform mat4 uProjInv, uCamWorld;
uniform vec3 uCamPos;
uniform float uTime, uNear, uFar, uFrame;
uniform vec2 uRes;
varying vec2 vUv;
${SKY_GLSL}
const float BASE = 850.0, TOP = 1750.0;

float coverage(vec2 p) {
  // large drifting weather pattern: clusters of cumulus with clear gaps
  vec2 q = p * 0.00011 + vec2(uTime * 0.0012, 0.0);
  float c = texture(tNoise, vec3(q, 0.37)).r * 0.65 + texture(tNoise, vec3(q * 2.3, 0.71)).r * 0.35;
  return smoothstep(0.44 - 0.3 * uCover, 0.7 - 0.22 * uCover, c); // more and heavier cloud in bad weather
}
float heightShape(float h) {
  float t = (h - BASE) / (TOP - BASE);
  return smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.45, t); // rounded base, tapering towers
}
float density(vec3 p) {
  float cov = coverage(p.xz);
  if (cov <= 0.0) return 0.0;
  float t = (p.y - BASE) / (TOP - BASE);
  vec3 q = p * 0.00055 + vec3(uTime * 0.004, 0.0, uTime * 0.0015);
  float base = texture(tNoise, q).r;
  float d = base * heightShape(p.y) * (0.55 + 0.45 * cov) - (1.0 - cov) * 0.55;
  d = clamp((d - 0.25) * 2.4, 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  float det = texture(tNoise, p * 0.0028 + vec3(uTime * 0.01)).g;
  d = clamp(d - (1.0 - det) * 0.22 * (1.0 - t * 0.5), 0.0, 1.0);
  return d * 0.03;
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vp = uProjInv * ndc; vp /= vp.w;
  vec3 dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
  // scene depth -> distance along the ray
  float z = texture2D(tDepth, vUv).r;
  float sceneDist = 1e9;
  if (z < 0.99999) {
    vec4 sp = uProjInv * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); sp /= sp.w;
    sceneDist = length(sp.xyz);
  }
  // intersect the cloud slab
  float t0, t1;
  if (abs(dir.y) < 1e-4) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float ta = (BASE - uCamPos.y) / dir.y, tb = (TOP - uCamPos.y) / dir.y;
  t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
  t1 = min(t1, min(sceneDist, 26000.0));
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  const int STEPS = 44;
  float span = t1 - t0;
  float stepLen = span / float(STEPS);
  float jitter = hash12(gl_FragCoord.xy + fract(uFrame * 0.6180339) * 61.0); // a new offset every frame, even when time stands still
  float T = 1.0;
  vec3 L = vec3(0.0);
  float cosT = dot(dir, uLightDir);
  float phase = min(mix(hg(cosT, 0.5), hg(cosT, -0.2), 0.35) * 4.0 * 3.14159, 3.5);
  vec3 sunCol = uLightCol * vec3(1.0, 0.94, 0.88) * 4.4 * mix(0.4, 1.0, uDayF);
  vec3 skyAmb = skyColor(vec3(0.0, 1.0, 0.0)) * 1.15;
  vec3 gndAmb = vec3(0.42, 0.44, 0.47) * 0.75 * uAmbientTint;
  // twilight: the sun is down but the cloud tops still catch its afterglow
  vec3 twi = mix(uSkyRose, uSkyWarm, 0.5) * 1.6 * uGlowVis * (1.0 - uSunVis * 0.7) * (0.5 + 0.5 * max(cosT, 0.0));
  float firstHit = -1.0;
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + jitter) * stepLen;
    vec3 p = uCamPos + dir * t;
    float d = density(p);
    if (d > 0.0) {
      if (firstHit < 0.0) firstHit = t;
      // light march toward the sun
      float od = 0.0;
      for (int j = 1; j <= 4; j++) od += density(p + uLightDir * (float(j) * 110.0)) * 110.0;
      float beer = exp(-od * 1.1);
      float powder = 1.0 - exp(-od * 2.0 - d * 60.0);
      float hN = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
      vec3 S = sunCol * beer * mix(1.0, powder, 0.6) * phase + mix(gndAmb, skyAmb, hN) * (0.45 + 0.55 * hN) + twi * (0.35 + 0.65 * hN) * pow(beer, 0.3);
      float dt = d * stepLen;
      float tr = exp(-dt);
      L += T * S * (1.0 - tr);
      T *= tr;
      if (T < 0.02) break;
    }
  }
  // aerial perspective toward the horizon colour
  if (firstHit > 0.0) {
    float haze = 1.0 - exp(-firstHit * 0.00005);
    vec3 skyC = skyColor(vec3(dir.x, max(dir.y, 0.02), dir.z));
    L = mix(L, skyC * (1.0 - T), haze);
  }
  // the rainbow hangs in the rain in front of distant clouds (the sky dome draws the rest)
  if (uRainbow > 0.001) L += rainbow(dir) * uRainbow * 0.28 * uDayF * (1.0 - T) * smoothstep(900.0, 3000.0, min(sceneDist, 1e5));
  gl_FragColor = vec4(L, T);
}`;

// Temporal accumulation: blend this frame's (jittered, noisy) march with the history, reprojected
// by view direction (the clouds are far enough away for that), clamped to the current neighbourhood
// so nothing ghosts where mountains or the whale cross the clouds.
const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tCur, tHist;
uniform mat4 uProjInv, uCamWorld, uPrevVP;
uniform vec2 uTexel;
uniform float uValid;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tCur, vUv);
  if (uValid < 0.5) { gl_FragColor = cur; return; }
  vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vp /= vp.w;
  vec3 dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
  vec4 pc = uPrevVP * vec4(dir, 0.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (pc.w <= 0.0 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { gl_FragColor = cur; return; }
  vec4 mn = cur, mx = cur;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 c = texture2D(tCur, vUv + vec2(float(i), float(j)) * uTexel);
    mn = min(mn, c); mx = max(mx, c);
  }
  vec4 hist = clamp(texture2D(tHist, puv), mn, mx);
  gl_FragColor = mix(cur, hist, 0.86);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse, tClouds;
uniform vec2 uCloudTexel;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  // soft 5-tap upsample to hide the half-resolution march and its dithering
  vec4 c = texture2D(tClouds, vUv) * 0.4;
  c += texture2D(tClouds, vUv + vec2(uCloudTexel.x, 0.0)) * 0.15;
  c += texture2D(tClouds, vUv - vec2(uCloudTexel.x, 0.0)) * 0.15;
  c += texture2D(tClouds, vUv + vec2(0.0, uCloudTexel.y)) * 0.15;
  c += texture2D(tClouds, vUv - vec2(0.0, uCloudTexel.y)) * 0.15;
  gl_FragColor = vec4(scene.rgb * c.a + c.rgb, scene.a);
}`;

export class VolumetricClouds extends Pass {
  constructor(camera, getDepth, scale = 0.5) {
    super();
    this.camera = camera; this.getDepth = getDepth; this.scale = scale;
    this.noise = tilingNoise3D(64);
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
    const vert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.marchMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tDepth: { value: null }, tNoise: { value: this.noise }, uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 },
        uNear: { value: 0.1 }, uFar: { value: 1 }, uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 },
        ...SKY,
      },
      vertexShader: vert,
      fragmentShader: MARCH_FRAG.replace(/gl_FragColor/g, 'outColor').replace('varying vec2 vUv;', 'in vec2 vUv;\nout vec4 outColor;').replace(/texture2D\(/g, 'texture('),
      depthTest: false, depthWrite: false,
    });
    this.marchMat.vertexShader = 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tClouds: { value: this.rt.texture }, uCloudTexel: { value: new THREE.Vector2() } },
      vertexShader: vert, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.hist = [0, 1].map(() => new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType }));
    this.ping = 0; this.histValid = false;
    this.prevVP = new THREE.Matrix4();
    this.resolveMat = new THREE.ShaderMaterial({
      uniforms: {
        tCur: { value: this.rt.texture }, tHist: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uPrevVP: { value: this.prevVP }, uTexel: { value: new THREE.Vector2() }, uValid: { value: 0 },
      },
      vertexShader: vert, fragmentShader: RESOLVE_FRAG, depthTest: false, depthWrite: false,
    });
    this.marchQuad = new FullScreenQuad(this.marchMat);
    this.resolveQuad = new FullScreenQuad(this.resolveMat);
    this.compQuad = new FullScreenQuad(this.compMat);
    this.time = 0;
  }
  setSize(w, h) {
    const cw = Math.max(16, Math.floor(w * this.scale)), ch = Math.max(16, Math.floor(h * this.scale));
    this.rt.setSize(cw, ch);
    for (const h of this.hist) h.setSize(cw, ch);
    this.histValid = false;
    this.resolveMat.uniforms.uTexel.value.set(1 / cw, 1 / ch);
    this.compMat.uniforms.uCloudTexel.value.set(1 / cw, 1 / ch);
    this.marchMat.uniforms.uRes.value.set(cw, ch);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.marchMat.uniforms, cam = this.camera;
    u.tDepth.value = this.getDepth();
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uTime.value = this.time;
    u.uFrame.value = (u.uFrame.value + 1) % 100000;
    renderer.setRenderTarget(this.rt);
    this.marchQuad.render(renderer);
    // accumulate over frames (ping-pong history)
    const r = this.resolveMat.uniforms, hIn = this.hist[this.ping], hOut = this.hist[1 - this.ping];
    r.tHist.value = hIn.texture; r.uValid.value = this.histValid ? 1 : 0;
    r.uProjInv.value.copy(cam.projectionMatrixInverse); r.uCamWorld.value.copy(cam.matrixWorld);
    renderer.setRenderTarget(hOut);
    this.resolveQuad.render(renderer);
    this.ping = 1 - this.ping; this.histValid = true;
    this.prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.compMat.uniforms.tClouds.value = hOut.texture;
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compQuad.render(renderer);
  }
}
