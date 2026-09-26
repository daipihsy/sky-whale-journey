// Sky, sun & moon, a world-space height fog that fades into the sky colour, and the time of day.
// Every material in the scene shares the SKY uniforms below (injected by `injectSky`), so the
// whole world — sky, fog, water, clouds, foliage, the whale — follows the same sun and moon.
import * as THREE from 'three';

// live vectors (updated by TimeOfDay every frame)
export const SUN_DIR = new THREE.Vector3(0.8, 0.36, -0.32).normalize();
export const LIGHT_DIR = SUN_DIR.clone();

export const SKY = {
  uSunDir: { value: SUN_DIR }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uLightDir: { value: LIGHT_DIR },
  uLightCol: { value: new THREE.Color(1, 0.9, 0.75) },
  uSkyZen: { value: new THREE.Color() }, uSkyMid: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() },
  uSkyLow: { value: new THREE.Color() }, uSkyWarm: { value: new THREE.Color() }, uSkyRose: { value: new THREE.Color() },
  uSkyLav: { value: new THREE.Color() },
  uNight: { value: 0 }, uSunVis: { value: 1 }, uGlowVis: { value: 1 }, uDayF: { value: 1 },
  uAmbientTint: { value: new THREE.Color(1, 1, 1) },
  uCloudLit: { value: new THREE.Color(1, 0.975, 0.95) }, uCloudShade: { value: new THREE.Color(0.62, 0.68, 0.84) },
  uSkyTime: { value: 0 },
  // weather
  uOvercast: { value: 0 }, uCover: { value: 0 }, uRain: { value: 0 }, uRainbow: { value: 0 },
};

// add the shared sky uniforms to a material (keeps any existing onBeforeCompile)
export function injectSky(m) {
  if (!m || m.userData.skyInjected) return;
  const own = m.onBeforeCompile;
  // keep the program cache key of the original hook (the default key is the hook's source text,
  // which would otherwise be the same wrapper for every material)
  const keyFn = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : null;
  const fixedKey = keyFn ? '' : own.toString();
  m.onBeforeCompile = function (sh, r) {
    for (const k in SKY) sh.uniforms[k] = SKY[k];
    own.call(this, sh, r);
  };
  m.customProgramCacheKey = () => (keyFn ? keyFn() : fixedKey) + '|sky';
  m.userData.skyInjected = true;
  m.needsUpdate = true;
}

// inject into every material of a scene graph (cheap to call repeatedly: already-injected are skipped)
export function injectSkyAll(root) {
  root.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) o.material.forEach(injectSky); else injectSky(o.material);
  });
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uLightDir, uLightCol;
uniform vec3 uSkyZen, uSkyMid, uSkyHor, uSkyLow, uSkyWarm, uSkyRose, uSkyLav;
uniform float uNight, uSunVis, uGlowVis, uDayF, uSkyTime;
uniform vec3 uAmbientTint, uCloudLit, uCloudShade;
uniform float uOvercast, uCover, uRain, uRainbow;
#define SUN_DIR uSunDir
vec3 skyColor(vec3 d) {
  float y = d.y;
  float yy = max(y, 0.0);
  vec3 c = mix(uSkyHor, uSkyMid, smoothstep(0.0, 0.22, yy));
  c = mix(c, uSkyZen, smoothstep(0.18, 0.75, yy));
  c = mix(c, uSkyLow, smoothstep(0.0, -0.25, y));
  // warm light around the sun (a twilight glow lingers after sunset); cloud cover mutes it
  float sd = max(dot(d, SUN_DIR), 0.0);
  float horizonBand = 1.0 - smoothstep(0.0, 0.45, abs(y - 0.05));
  float gv = uGlowVis * (1.0 - 0.75 * uOvercast);
  c = mix(c, uSkyRose, pow(sd, 2.0) * horizonBand * 0.35 * gv);
  c = mix(c, uSkyWarm, pow(sd, 5.0) * 0.75 * (0.45 + 0.55 * horizonBand) * gv);
  c += uLightCol * pow(sd, 48.0) * 0.25 * uSunVis * (1.0 - 0.9 * uOvercast);
  // soft lavender away from the sun near the horizon
  c = mix(c, uSkyLav, (1.0 - sd) * horizonBand * 0.18);
  // moonlit haze at night
  float md = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.35, 0.45, 0.7) * (pow(md, 24.0) * 0.12 + pow(md, 4.0) * 0.02) * uNight * (1.0 - 0.8 * uOvercast);
  // overcast: a soft, even grey that keeps a little of the sky's hue, a touch brighter near the horizon
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  vec3 grey = vec3(lum) * vec3(0.93, 0.96, 1.02) * (0.82 + 0.1 * horizonBand);
  c = mix(c, grey, uOvercast * 0.85);
  return c;
}
// a rainbow on the far side of the sun (and a faint second bow outside it)
vec3 rainbow(vec3 d) {
  float a = degrees(acos(clamp(dot(d, -SUN_DIR), -1.0, 1.0)));
  vec3 c = vec3(0.0);
  float t = (a - 40.2) / 2.6;          // 0 = violet (inside), 1 = red (outside)
  if (t > -0.2 && t < 1.2) {
    vec3 hue = clamp(abs(fract(vec3(0.0, 0.667, 0.333) + (1.0 - clamp(t, 0.0, 1.0)) * 0.78) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    c += hue * smoothstep(-0.2, 0.15, t) * smoothstep(1.2, 0.85, t);
  }
  float t2 = (a - 50.5) / 3.4;
  if (t2 > -0.2 && t2 < 1.2) {
    vec3 hue2 = clamp(abs(fract(vec3(0.0, 0.667, 0.333) + clamp(t2, 0.0, 1.0) * 0.78) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    c += hue2 * smoothstep(-0.2, 0.15, t2) * smoothstep(1.2, 0.85, t2) * 0.35;
  }
  return c * smoothstep(-0.02, 0.08, d.y);
}
`;

export function patchFogChunks() {
  // rain: upward-facing surfaces of lit materials darken and turn glossy (opt out with NO_WET)
  THREE.ShaderChunk.roughnessmap_fragment += `
#if defined(USE_FOG) && !defined(FLAT_SHADED) && !defined(NO_WET)
  {
    vec3 nWet = inverseTransformDirection(normalize(vNormal), viewMatrix);
    float wet = uRain * smoothstep(0.35, 0.85, nWet.y);
    diffuseColor.rgb *= 1.0 - 0.3 * wet;
    roughnessFactor = mix(roughnessFactor, 0.2, wet * 0.85);
  }
#endif`;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vFogWorld;
  ${SKY_GLSL}
  float fogAmountAt(vec3 wp) {
    vec3 v = wp - cameraPosition;
    float dist = length(v);
    vec3 dir = v / max(dist, 1e-3);
    float b = 0.0022;
    float h0 = max(cameraPosition.y, -20.0);
    float dy = dir.y * b;
    float integ = abs(dy) > 1e-5 ? (1.0 - exp(-dist * dy)) / dy : dist;
    float amt = fogDensity * exp(-h0 * b) * integ + dist * fogDensity * 0.12;
    return 1.0 - exp(-amt);
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  {
    vec3 fv = vFogWorld - cameraPosition;
    vec3 fdir = normalize(fv);
    float fa = fogAmountAt(vFogWorld);
    vec3 fc = skyColor(vec3(fdir.x, max(fdir.y, -0.05) * 0.6 + 0.02, fdir.z));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fa);
  }
#endif`;
}

const STARS_GLSL = /* glsl */ `
float sh31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 sh33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh31(i), sh31(i + vec3(1,0,0)), f.x), mix(sh31(i + vec3(0,1,0)), sh31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh31(i + vec3(0,0,1)), sh31(i + vec3(1,0,1)), f.x), mix(sh31(i + vec3(0,1,1)), sh31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float starLayer(vec3 d, float scale, float density, float t) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  float h = sh31(cell);
  if (h > density) return 0.0;
  vec3 c = cell + 0.5 + (sh33(cell) - 0.5) * 0.7;
  float r = length(p - c);
  float tw = 0.65 + 0.35 * sin(t * (1.5 + h * 40.0) + h * 100.0);
  return smoothstep(0.32, 0.0, r) * (0.4 + 0.6 * sh31(cell + 7.0)) * tw;
}
vec3 nightSky(vec3 d) {
  vec3 col = vec3(0.0);
  float up = smoothstep(-0.02, 0.12, d.y);
  // stars, a few coloured
  float s = starLayer(d, 240.0, 0.07, uSkyTime) * 0.9 + starLayer(d, 110.0, 0.035, uSkyTime * 0.7) * 2.4 + starLayer(d, 55.0, 0.02, uSkyTime * 0.5) * 2.6;
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), sh31(floor(d * 110.0) + 3.0));
  col += tint * s;
  // the Milky Way: a faint dusty band across the sky
  vec3 bandN = normalize(vec3(0.35, 0.55, 0.76));
  float band = exp(-pow(dot(d, bandN), 2.0) * 14.0);
  float dust = vn3(d * 9.0) * 0.6 + vn3(d * 23.0) * 0.4;
  float lanes = smoothstep(0.35, 0.75, vn3(d * 14.0 + 3.0));
  col += vec3(0.45, 0.5, 0.75) * band * dust * (1.0 - lanes * 0.6) * 0.22;
  col += vec3(0.9, 0.9, 1.0) * starLayer(d, 360.0, 0.25 * band, uSkyTime) * band * 0.9;
  return col * up;
}
// shooting stars: now and then a short bright streak crosses the upper sky
vec3 meteors(vec3 d) {
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float P = 9.0 + float(k) * 4.0;
    float tt = uSkyTime + float(k) * 5.3;
    float id = floor(tt / P), ph = fract(tt / P);
    float dur = 0.09;                   // fraction of the period it is visible (~1 s)
    if (ph > dur) continue;
    float prog = ph / dur;
    vec3 h = sh33(vec3(id, float(k) * 7.0, 3.1));
    float az = h.x * 6.2832, el = mix(0.45, 1.1, h.y);
    vec3 A = normalize(vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el)));
    vec3 side = normalize(cross(A, vec3(0.0, 1.0, 0.0)));
    vec3 B = normalize(A + side * (h.z - 0.5) * 0.8 - vec3(0.0, 0.35, 0.0));
    vec3 n = normalize(cross(A, B));
    float off = abs(dot(d, n));
    vec3 e1 = A, e2 = normalize(cross(n, A));
    float ang = atan(dot(d, e2), dot(d, e1));
    float arc = acos(clamp(dot(A, B), -1.0, 1.0));
    float head = prog * arc, tail = 0.12;
    float along = smoothstep(head - tail, head, ang) * step(ang, head);
    float fade = sin(prog * 3.14159);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.0022, 0.0, off) * along * pow(clamp((ang - head + tail) / tail, 0.0, 1.0), 2.0) * fade * 2.2;
  }
  return col;
}
vec3 moonDisc(vec3 d) {
  float md = dot(d, uMoonDir);
  float disc = smoothstep(0.99975, 0.99985, md);
  // faint maria on the lunar face
  vec3 tangent = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 bit = cross(tangent, uMoonDir);
  vec2 q = vec2(dot(d, tangent), dot(d, bit)) * 70.0;
  float maria = vn3(vec3(q * 3.0, 1.0)) * 0.5 + vn3(vec3(q * 7.0, 2.0)) * 0.3;
  vec3 c = vec3(1.0, 0.97, 0.9) * (1.1 - maria * 0.45) * disc * 2.6;
  c += vec3(0.55, 0.65, 0.9) * pow(max(md, 0.0), 900.0) * 0.8; // halo
  return c;
}
`;

export function buildSky() {
  const geo = new THREE.SphereGeometry(40000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { ...SKY },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      ${STARS_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float sd = max(dot(d, SUN_DIR), 0.0);
        c += uLightCol * smoothstep(0.9993, 0.9998, sd) * 1.6 * uSunVis * (1.0 - 0.95 * uOvercast);
        if (uNight > 0.001) c += (nightSky(d) + moonDisc(d) + meteors(d)) * uNight * (1.0 - 0.9 * uOvercast);
        if (uRainbow > 0.001) c += rainbow(d) * uRainbow * 0.28 * uDayF;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  mat.userData.skyInjected = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

// A small scene of the sky (and a hazy ground below the horizon) used to light PBR materials
export function buildEnvScene() {
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { ...SKY },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(vec3(d.x, max(d.y, 0.0), d.z));
        vec3 ground = vec3(0.21, 0.25, 0.14) * (0.08 + 0.92 * uDayF);
        c = mix(c, ground, smoothstep(0.0, -0.25, d.y));
        float sd = max(dot(d, SUN_DIR), 0.0);
        c += uLightCol * smoothstep(0.995, 0.9995, sd) * 2.0 * uSunVis;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  mat.userData.skyInjected = true;
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat));
  return sc;
}

// ---------------------------------------------------------------------------------------------
// Time of day: the sun rises on the left of the valley, stands behind the traveller at noon and
// sets low on the right (the golden, back-lit look of the painting); the moon follows at night.
const C = (h) => new THREE.Color(h);
const PALETTE = [ // by sun elevation (degrees)
  { e: -18, zen: C('#02050d'), mid: C('#050b1a'), hor: C('#0a1528'), low: C('#050810'), warm: C('#0c1224'), rose: C('#0a1020'), lav: C('#0b1326') },
  { e: -10, zen: C('#0c1834'), mid: C('#1b2a52'), hor: C('#3a4674'), low: C('#161c2c'), warm: C('#5a4470'), rose: C('#4a3a66'), lav: C('#363866') },
  { e: -4, zen: C('#20407a'), mid: C('#565c96'), hor: C('#dc8a70'), low: C('#5a4e66'), warm: C('#ff7a48'), rose: C('#c0668a'), lav: C('#7a6aa8') },
  { e: 2, zen: C('#3867ad'), mid: C('#8893c0'), hor: C('#f3b88c'), low: C('#b0a4ae'), warm: C('#ff9a55'), rose: C('#e98a8a'), lav: C('#a89cc8') },
  { e: 8, zen: C('#4a7ec4'), mid: C('#95b4da'), hor: C('#edd8be'), low: C('#c6c8d0'), warm: C('#ffb877'), rose: C('#f2aa9c'), lav: C('#c6c0dc') },
  { e: 20, zen: C('#4f8fd8'), mid: C('#8fbde9'), hor: C('#dbe7f0'), low: C('#c9d8e6'), warm: C('#ffd6a6'), rose: C('#f4c9c6'), lav: C('#cfd2ec') },
  { e: 60, zen: C('#3f7fd0'), mid: C('#86b6e6'), hor: C('#d8e6f0'), low: C('#c9d8e6'), warm: C('#fff0d8'), rose: C('#f4dcd0'), lav: C('#d0d8ec') },
];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class TimeOfDay {
  constructor(hours = 16.5) {
    this.hours = hours;
    this.playing = true;
    this.speed = 60; // game seconds per real second: one hour per minute
    this.sunDir = SUN_DIR; this.moonDir = SKY.uMoonDir.value; this.lightDir = LIGHT_DIR;
    this.lightColor = new THREE.Color(); this.lightIntensity = 3;
    this.hemiSky = new THREE.Color(); this.hemiGround = new THREE.Color(); this.hemiIntensity = 0.6;
    this.envIntensity = 0.45; this.exposure = 0.9; this.night = 0; this.dayF = 1; this.sunElev = 20;
    this.update(0);
  }
  static dirAt(h, tilt = 62, north = false) {
    const th = ((h - 6) / 12) * Math.PI;
    const elev = Math.asin(Math.sin(th) * Math.sin(THREE.MathUtils.degToRad(tilt)));
    const az = THREE.MathUtils.degToRad(205 - ((h - 6) / 12) * 250);
    const z = Math.sin(az) * Math.cos(elev);
    return new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), north ? -z : z).normalize();
  }
  // the moon crosses the sky in front of the valley, low over the castle, so it is in view at night
  static moonAt(h) { return TimeOfDay.dirAt((h + 12) % 24, 25, true); }
  setHours(h) { this.hours = ((h % 24) + 24) % 24; this.update(0); }
  // weather dims and softens the sun, and lifts the flat fill light of an overcast sky
  get overcast() { return SKY.uOvercast.value; }
  update(dt) {
    if (this.playing) this.hours = (this.hours + (dt * this.speed) / 3600) % 24;
    const h = this.hours;
    this.sunDir.copy(TimeOfDay.dirAt(h));
    this.moonDir.copy(TimeOfDay.moonAt(h));
    const e = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    const me = THREE.MathUtils.radToDeg(Math.asin(this.moonDir.y));
    this.sunElev = e;
    // sky palette
    let i = 0;
    while (i < PALETTE.length - 2 && PALETTE[i + 1].e < e) i++;
    const A = PALETTE[i], B = PALETTE[i + 1];
    const t = Math.min(1, Math.max(0, (e - A.e) / (B.e - A.e)));
    for (const [k, u] of [['zen', 'uSkyZen'], ['mid', 'uSkyMid'], ['hor', 'uSkyHor'], ['low', 'uSkyLow'], ['warm', 'uSkyWarm'], ['rose', 'uSkyRose'], ['lav', 'uSkyLav']]) {
      SKY[u].value.copy(A[k]).lerp(B[k], t);
    }
    // key light: the sun by day, the moon by night (crossing over while both are faint)
    const dayF = smooth(-9, 14, e);
    this.dayF = dayF;
    this.night = smooth(-4, -15, e);
    const sunCol = new THREE.Color('#ff8a4c').lerp(new THREE.Color('#ffc07a'), smooth(-1, 5, e)).lerp(new THREE.Color('#ffe4bc'), smooth(5, 22, e)).lerp(new THREE.Color('#fff2e2'), smooth(25, 55, e));
    const oc = SKY.uOvercast.value;
    const sunInt = 3.3 * smooth(-3, 5, e) * (0.65 + 0.35 * smooth(5, 30, e)) * (1 - 0.82 * oc);
    const moonInt = 0.55 * smooth(-3, -11, e) * smooth(-2, 12, me) * (1 - 0.8 * oc);
    if (e > -3) { this.lightDir.copy(this.sunDir); this.lightColor.copy(sunCol); this.lightIntensity = sunInt; }
    else { this.lightDir.copy(this.moonDir); this.lightColor.set('#9eb6ff'); this.lightIntensity = moonInt; }
    if (this.lightDir.y < 0.05) { this.lightDir.y = 0.05; this.lightDir.normalize(); }
    SKY.uLightCol.value.copy(this.lightColor).multiplyScalar(Math.max(this.lightIntensity, 0.001) / 3.2);
    SKY.uSunVis.value = smooth(-2, 1, e) * (1 - 0.85 * oc);
    SKY.uGlowVis.value = smooth(-14, -1, e);
    SKY.uNight.value = this.night;
    SKY.uDayF.value = dayF;
    // fills and exposure
    this.hemiSky.copy(SKY.uSkyMid.value).lerp(new THREE.Color('#ffffff'), 0.25);
    this.hemiGround.set('#7f8a5e').multiplyScalar(0.25 + 0.75 * dayF);
    this.hemiIntensity = (0.16 + 0.5 * dayF) * (1 + 0.45 * oc);
    this.envIntensity = (0.14 + 0.32 * dayF) * (1 + 0.35 * oc);
    this.exposure = (1.45 - 0.55 * dayF) * (1 + 0.12 * oc);
    // tint for self-lit shaders (grass, waterfalls): warm at golden hour, cool and dim at night
    const golden = smooth(22, 6, e) * smooth(-4, 3, e);
    // how brightly lit the ground is: the direct sun dominates, the sky adds a little
    const lightLevel = Math.min(1, (sunInt / 3.3) * 0.8 + dayF * (0.35 + 0.3 * oc));
    this.lightLevel = lightLevel;
    SKY.uAmbientTint.value.set(0.075, 0.1, 0.19).lerp(new THREE.Color(1, 1, 1), lightLevel).lerp(new THREE.Color(1.08, 0.94, 0.78), golden * 0.6 * lightLevel);
    SKY.uCloudLit.value.set(0.075, 0.095, 0.16).lerp(new THREE.Color(1, 0.975, 0.95).lerp(sunCol, 0.35 * golden + 0.1), dayF);
    SKY.uCloudShade.value.set(0.03, 0.04, 0.07).lerp(new THREE.Color(0.62, 0.68, 0.84).lerp(SKY.uSkyRose.value, golden * 0.4), dayF);
  }
  clock() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  phaseName() {
    const e = this.sunElev;
    if (e > 25) return '白昼';
    if (e > 6) return this.hours < 12 ? '清晨' : '午后';
    if (e > -2) return this.hours < 12 ? '日出' : '黄昏';
    if (e > -11) return this.hours < 12 ? '拂晓' : '暮色';
    return '夜晚';
  }
}
