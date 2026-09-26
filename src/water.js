// River / lake surface and waterfalls.
import * as THREE from 'three';
import { NEAR, CASTLE_MESA, SIDE_MESAS, GORGE_POOL, CASTLE, cliffEdge } from './world.js';
import { clamp, lerp, smoothstep } from './noise.js';

const NOISE_GLSL = /* glsl */ `
float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float wn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(wh(i),wh(i+vec2(1,0)),u.x), mix(wh(i+vec2(0,1)),wh(i+vec2(1,1)),u.x), u.y); }
`;

export function buildWater(heightTex) {
  const geo = new THREE.PlaneGeometry(24000, 24000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uHeight: { value: null },
    uNear: { value: new THREE.Vector4(NEAR.x0, NEAR.z0, NEAR.x1 - NEAR.x0, NEAR.z1 - NEAR.z0) },
    uRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  }]);
  uniforms.uHeight.value = heightTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform mat4 uTexMat;
      varying vec3 vW;
      varying vec4 vRefl;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vRefl = uTexMat * w;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uHeight;
      uniform vec4 uNear;
      uniform sampler2D uRefl;
      uniform float uReflOn;
      varying vec3 vW;
      varying vec4 vRefl;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vW.xz;
        vec2 huv = (p - uNear.xy) / uNear.zw;
        float ground = -30.0;
        if (huv.x > 0.0 && huv.y > 0.0 && huv.x < 1.0 && huv.y < 1.0) ground = texture2D(uHeight, huv).r;
        float depth = max(-ground, 0.0);
        // flowing ripples
        vec2 flow = vec2(0.45, 0.35) * uTime;
        float n1 = wn(p * 0.18 + flow * 0.3) + wn(p * 0.5 - flow * 0.6) * 0.5 + wn(p * 1.7 + flow) * 0.25;
        float n2 = wn(p * 0.18 + vec2(3.1, 1.7) + flow * 0.3) + wn(p * 0.5 + vec2(1.3) - flow * 0.6) * 0.5 + wn(p * 1.7 + vec2(7.0) + flow) * 0.25;
        vec3 V = normalize(vW - cameraPosition);
        float dist = length(vW - cameraPosition);
        float amp = 0.07 * (1.0 - smoothstep(80.0, 900.0, dist)) + 0.012;
        vec3 N = normalize(vec3((n1 - 0.875) * amp * 2.0, 1.0, (n2 - 0.875) * amp * 2.0));
        // rain: expanding rings where drops land (near the camera)
        if (uRain > 0.01 && dist < 160.0) {
          vec2 rp = p * 0.7;
          for (int k = 0; k < 2; k++) {
            vec2 q = rp + float(k) * vec2(0.5, 0.37);
            vec2 cell = floor(q), f = fract(q) - 0.5;
            float h = fract(sin(dot(cell, vec2(127.1, 311.7)) + float(k) * 17.0) * 43758.5453);
            vec2 c = (vec2(fract(h * 13.7), fract(h * 71.3)) - 0.5) * 0.5;
            float ph = fract(uTime * (0.9 + h * 0.6) + h);
            vec2 d = f - c; float r = length(d), rad = ph * 0.45;
            float ring = sin((r - rad) * 55.0) * smoothstep(0.08, 0.0, abs(r - rad)) * (1.0 - ph);
            N.xz += (d / max(r, 1e-3)) * ring * 0.35 * uRain * (1.0 - smoothstep(50.0, 160.0, dist));
          }
          N = normalize(N);
        }
        vec3 R = reflect(V, N);
        R.y = abs(R.y);
        vec3 sky = skyColor(normalize(R));
        // planar reflection of the world (castle, mountains, trees, whale), rippled by the surface normal
        if (uReflOn > 0.5) {
          vec4 rc = vRefl;
          rc.xy += N.xz * 0.14 * rc.w * (0.3 + 0.7 * (1.0 - smoothstep(60.0, 1200.0, dist)));
          vec3 refl = texture2DProj(uRefl, rc).rgb;
          sky = mix(sky, refl, 0.92);
        }
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        vec3 deep = vec3(0.05, 0.17, 0.27);
        vec3 shallow = vec3(0.2, 0.42, 0.42);
        vec3 body = mix(shallow, deep, smoothstep(0.3, 4.5, depth)) * uAmbientTint;
        // reflections of the sky, deepened so the water reads as a surface, not a mirror of haze
        vec3 col = mix(body, sky * vec3(0.84, 0.9, 0.97), clamp(fres * 1.05 + 0.18, 0.0, 0.9));
        float glint = pow(max(dot(R, uLightDir), 0.0), 350.0) * 6.0 + pow(max(dot(R, uLightDir), 0.0), 40.0) * 0.35;
        col += uLightCol * vec3(1.0, 0.95, 0.85) * glint;
        // soft foam line at the shore
        float shore = 1.0 - smoothstep(0.0, 0.55, depth + (wn(p * 0.8 + uTime * 0.2) - 0.5) * 0.3);
        col = mix(col, vec3(0.92, 0.95, 0.96) * uAmbientTint, shore * 0.55);
        // night: glowing plankton stirred up in the ripples, brightest near the shore
        if (uNight > 0.001) {
          float bio = pow(wn(p * 0.35 + flow * 0.4) * wn(p * 1.3 - flow * 0.8), 3.0) * 2.2;
          bio += shore * 0.25 * (0.6 + 0.4 * sin(uTime * 1.3 + p.x * 0.4));
          col += vec3(0.08, 0.7, 0.85) * bio * uNight * (1.0 - smoothstep(40.0, 600.0, dist));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.receiveShadow = false;
  return mesh;
}

// Waterfall ribbons pouring off cliff lips
export function buildWaterfalls(hf) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        float x = vUv.x, y = vUv.y; // y: 0 top -> 1 bottom (arc length)
        float streak = wn(vec2(x * 22.0, y * 3.0 - uTime * 1.6)) * 0.6 + wn(vec2(x * 60.0, y * 8.0 - uTime * 2.8)) * 0.4;
        float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
        float a = edge * (0.45 + 0.55 * streak);
        a *= smoothstep(0.0, 0.03, y);
        // spreads & thins lower down
        a *= mix(1.0, 0.55, y);
        vec3 c = mix(vec3(0.78, 0.86, 0.93), vec3(1.0), streak) * uAmbientTint;
        gl_FragColor = vec4(c, a * 0.9);
        #include <fog_fragment>
      }`,
  });

  const lips = [];
  // castle plateau front, into the gorge pool
  const pushLip = (cx, cz, r, towardX, towardZ, width, top) => {
    const dx = towardX - cx, dz = towardZ - cz, l = Math.hypot(dx, dz);
    lips.push({ x: cx + (dx / l) * r, z: cz + (dz / l) * r, dx: dx / l, dz: dz / l, width, top });
  };
  const cm = CASTLE_MESA;
  // three falls from the plateau (left/right of the grand bridge + one toward the lake side)
  const ang0 = Math.atan2(GORGE_POOL.z - cm.z, GORGE_POOL.x - cm.x);
  for (const [da, w] of [[-0.34, 9], [0.3, 7], [0.85, 12], [-1.05, 10]]) {
    const a = ang0 + da;
    pushLip(cm.x, cm.z, cm.r - 6, cm.x + Math.cos(a) * 100, cm.z + Math.sin(a) * 100, w, CASTLE.top);
  }
  for (const m of SIDE_MESAS.slice(0, 2)) {
    pushLip(m.x, m.z, m.r * 0.72, m.x, m.z + 100, 6, m.top);
  }
  // a spring spilling over the meadow cliff into the lake below
  for (const [zc, w] of [[150, 5], [40, 3.5]]) {
    let x = cliffEdge(zc) - 12;
    const top = hf.height(x, zc);
    while (hf.height(x + 1, zc) > top - 1.5 && x < cliffEdge(zc) + 30) x += 1;
    lips.push({ x, z: zc, dx: 1, dz: 0.05, width: w, top: hf.height(x, zc) - 0.2 });
  }
  for (const L of lips) {
    // trace the fall: move outward until clear of the cliff, then drop
    const pts = [];
    let x = L.x, z = L.z, y = L.top + 0.3;
    let vy = 0, out = 3.2;
    pts.push(new THREE.Vector3(x, y, z));
    for (let k = 0; k < 200; k++) {
      const dt = 0.12;
      vy -= 9.8 * dt;
      y += vy * dt;
      x += L.dx * out * dt; z += L.dz * out * dt;
      const g = hf.height(x, z);
      if (y < g + 1.2) { // hug the cliff
        const push = (g + 1.2 - y);
        x += L.dx * push * 0.5; z += L.dz * push * 0.5;
      }
      pts.push(new THREE.Vector3(x, y, z));
      if (y < Math.max(hf.height(x, z), 0) - 0.5) break;
    }
    if (pts.length < 4) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 60;
    const pos = [], uv = [], idx = [];
    const side = new THREE.Vector3(-L.dz, 0, L.dx);
    const total = curve.getLength();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = curve.getPointAt(t);
      const w = L.width * (1 + t * 0.6);
      pos.push(p.x - side.x * w / 2, p.y, p.z - side.z * w / 2, p.x + side.x * w / 2, p.y, p.z + side.z * w / 2);
      uv.push(0, t * total / 30, 1, t * total / 30);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 5;
    group.add(mesh);
    L.bottom = pts[pts.length - 1];
  }
  group.userData.material = mat;
  group.userData.lips = lips;
  return group;
}


// Planar reflection for the lakes and river (the classic mirrored-camera technique with an oblique
// near plane, rendered at reduced resolution and only when water is in view).
export class WaterReflection {
  constructor(renderer, water, hf, scale = 0.5) {
    this.renderer = renderer; this.water = water; this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
    this.cam = new THREE.PerspectiveCamera();
    this.texMat = water.material.uniforms.uTexMat.value;
    water.material.uniforms.uRefl.value = this.rt.texture;
    this.hidden = [];
    // sample points of open water, used to decide whether any water is on screen
    this.samples = [];
    for (let z = NEAR.z0; z < NEAR.z1; z += 40) for (let x = NEAR.x0; x < NEAR.x1; x += 40) {
      if (hf.height(x, z) < -0.5) this.samples.push(new THREE.Vector3(x, 0, z));
    }
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }
  setSize(w, h) { this.rt.setSize(Math.max(16, Math.floor(w * this.scale)), Math.max(16, Math.floor(h * this.scale))); }
  waterInView(camera) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    for (const p of this.samples) {
      if (p.distanceToSquared(camera.position) < 2600 * 2600 && this.frustum.containsPoint(p)) return true;
    }
    return false;
  }
  update(scene, camera) {
    const u = this.water.material.uniforms;
    if (!this.waterInView(camera) || camera.position.y < 0.3) { u.uReflOn.value = 0; return; }
    u.uReflOn.value = 1;
    const cam = this.cam, r = this.renderer;
    // mirror the camera about the water plane y = 0
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.position.copy(camera.position); cam.position.y *= -1;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
    look.y *= -1;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion); up.y *= -1;
    cam.up.copy(up);
    cam.lookAt(look);
    cam.far = camera.far;
    cam.updateMatrixWorld();
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane: clip everything below the water
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05).applyMatrix4(cam.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = cam.projectionMatrix, e = pm.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    for (const o of this.hidden) o.visible = false;
    this.water.visible = false;
    const prevTarget = r.getRenderTarget(), prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevAuto;
    this.water.visible = true;
    for (const o of this.hidden) o.visible = true;
  }
}
