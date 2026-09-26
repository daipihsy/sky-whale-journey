import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { N8AOPass } from 'n8ao';
import { CSM } from 'three/addons/csm/CSM.js';
import { VolumetricClouds } from './clouds3d.js';

import { patchFogChunks, buildSky, buildEnvScene, SUN_DIR, LIGHT_DIR, SKY, TimeOfDay, injectSkyAll } from './atmosphere.js';
import { Fireflies } from './night.js';
import { Weather, Rain } from './weather.js';
import { JourneyPath, HeightField, buildTerrain, CASTLE } from './world.js';
import { buildCastle, buildOutworks, makeCastleMaterials, DECKS, OBST } from './castle.js';
import { Whale } from './whale.js';
import { Character } from './character.js';
import { Controller, Obstacles } from './controller.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { buildTrees, buildGrass, buildFlowers, buildRocks, buildGrassMask } from './vegetation.js';
import { Clouds } from './clouds.js';
import { buildWater, buildWaterfalls, WaterReflection } from './water.js';
import { Birds } from './birds.js';
import { buildExtras } from './extras.js';
import { clamp, lerp, smoothstep } from './noise.js';

const params = new URLSearchParams(location.search);
// remembered between visits (per browser): quality, weather, time speed, sound, panels
const PREFS_KEY = 'skywhale.prefs.v1';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } })();
function savePrefs(patch) { Object.assign(prefs, patch); try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } }
const $ = (id) => document.getElementById(id);
const loadingEl = $('loading'), veil = $('veil');

patchFogChunks();

// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, params.has('pr') ? +params.get('pr') : 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xdbe7f0, 0.000165);
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 60000);

// time of day: drives the sun, the moon, the sky palette and all lighting (default: late afternoon)
const weather = new Weather(params.get('weather') || 'clear', !params.has('weather'));
window.__weather = weather;
const tod = new TimeOfDay(params.has('h') ? +params.get('h') : 16.5);
if (params.has('tpause')) tod.playing = false;
window.__T = tod;

// image-based ambient light from the sky itself (re-rendered as the sky changes)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = buildEnvScene();
let envRT = null, envAt = { elev: -999, night: -1, oc: -1, t: -1e9 };
function refreshEnv(force = false) {
  const now = performance.now();
  const oc = SKY.uOvercast.value;
  const changed = Math.abs(tod.sunElev - envAt.elev) > 1.2 || Math.abs(tod.night - envAt.night) > 0.04 || Math.abs(oc - envAt.oc) > 0.05;
  if (!force && (!changed || now - envAt.t < 250)) return;
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  if (old) old.dispose();
  envAt = { elev: tod.sunElev, night: tod.night, oc, t: now };
}
refreshEnv(true);
scene.environmentIntensity = tod.envIntensity;
const hemi = new THREE.HemisphereLight('#c3d6ee', '#8a8a5c', 0.6);
scene.add(hemi);
// Sunlight with cascaded shadows: crisp contact shadows near the traveller, and the castle,
// bridges and forests still cast shadows hundreds of metres away.
const CASCADE_SPLITS = [0.028, 0.16, 1];
const csm = new CSM({
  camera, parent: scene, cascades: 3, maxFar: 1700, mode: 'custom',
  customSplitsCallback: (n, near, far, target) => target.push(...CASCADE_SPLITS),
  shadowMapSize: params.has('lowshadow') ? 1024 : 2048,
  lightDirection: LIGHT_DIR.clone().negate(), lightIntensity: 3.2, lightMargin: 400, lightFar: 5000,
});
csm.fade = true;
const CASCADE_SIZES = params.has('lowshadow') ? [1024, 1024, 768] : [2048, 1536, 1024];
csm.lights.forEach((l, i) => {
  l.color.set('#ffd9a8');
  l.shadow.bias = [-0.00012, -0.0003, -0.0008][i];
  l.shadow.normalBias = [0.25, 0.9, 3.0][i];
  l.shadow.mapSize.set(CASCADE_SIZES[i], CASCADE_SIZES[i]);
  // distant cascades refresh less often (their texels are metres wide; a frame of lag is invisible)
  if (i > 0) l.shadow.autoUpdate = false;
});
let shadowFrame = 0;
function scheduleShadows() {
  shadowFrame++;
  csm.lights[1].shadow.needsUpdate = shadowFrame % 2 === 0;
  csm.lights[2].shadow.needsUpdate = shadowFrame % 3 === 0;
}
// register every lit material with the cascades, keeping each material's own shader tweaks
function csmify(root) {
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m || m.userData.csm || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
      const own = m.onBeforeCompile;
      const ownKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
      csm.setupMaterial(m);
      const csmHook = m.onBeforeCompile;
      m.onBeforeCompile = function (sh, r) { csmHook.call(this, sh, r); if (own) own.call(this, sh, r); };
      m.customProgramCacheKey = () => ownKey + '|csm';
      m.userData.csm = true;
      m.needsUpdate = true;
    }
  });
}
const fill = new THREE.DirectionalLight('#fff1e2', 0.35);
fill.position.set(-0.5, 0.45, 0.75);
scene.add(fill);

// ---------------------------------------------------------------------------
// build the world in stages, letting the loading screen show progress between them
const loadText = $('loadtext'), loadBar = $('loadbar');
const stageTimes = [];
async function stage(label, frac) {
  stageTimes.push([label, performance.now()]);
  if (loadText) loadText.textContent = label;
  if (loadBar) loadBar.style.transform = `scaleX(${frac})`;
  // let the page paint (but never stall if the tab is in the background)
  await Promise.race([new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))), new Promise((r) => setTimeout(r, 60))]);
}
async function build() {
  const t0 = performance.now();
  await stage('铺开大地', 0.05);
  const path = new JourneyPath();
  const hf = new HeightField(path);
  const heightTex = hf.makeTexture();
  const maskTex = buildGrassMask(hf);

  const sky = buildSky();
  scene.add(sky);
  const terrain = buildTerrain(hf);
  scene.add(terrain);
  const water = buildWater(heightTex);
  scene.add(water);
  const falls = buildWaterfalls(hf);
  scene.add(falls);

  await stage('筑起城堡', 0.22);
  const cmats = makeCastleMaterials();
  const castle = buildCastle(cmats, hf);
  scene.add(castle);
  const outworks = buildOutworks(cmats, hf, path);
  scene.add(outworks);
  const extras = buildExtras(hf, castle, cmats, path);
  scene.add(extras);

  await stage('种下森林', 0.4);
  const trees = buildTrees(hf, path);
  scene.add(trees);
  const grass = buildGrass(hf, heightTex, maskTex);
  scene.add(grass);
  const flowers = buildFlowers(hf, path);
  scene.add(flowers);
  const rocks = buildRocks(hf, path);
  scene.add(rocks);

  await stage('唤醒巨鲸', 0.6);
  const whale = new Whale(600);
  scene.add(whale.group);
  await stage('铺满云海', 0.8);
  const clouds = new Clouds();
  scene.add(clouds.mesh);
  const birds = new Birds();
  scene.add(birds.mesh);

  const hero = new Character();
  scene.add(hero.group);
  const fireflies = new Fireflies(hf);
  scene.add(fireflies.points);

  // collision world for the traveller
  const obstacles = new Obstacles();
  for (const [x, z, r] of trees.userData.trunks) obstacles.add(x, z, r);
  for (const [x, z, r] of rocks.userData.obst) obstacles.add(x, z, r);
  for (const [x, z, r] of OBST) obstacles.add(x, z, r);
  const walls = [];
  for (const root of [castle, outworks, extras]) {
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.noCollide && o.visible) walls.push(o); });
  }
  const ctrl = new Controller({ hf, path, decks: DECKS, walls, obstacles });
  const p0 = path.sample(0);
  ctrl.place(p0.x, p0.z, Math.atan2(p0.tx, p0.tz));

  stageTimes.push(['end', performance.now()]);
  console.log(`built in ${(performance.now() - t0).toFixed(0)} ms (` + stageTimes.slice(0, -1).map(([l, t], i) => `${l} ${(stageTimes[i + 1][1] - t).toFixed(0)}`).join(', ') + `); path ${path.length.toFixed(0)} m; walls ${walls.length}`);
  return { path, hf, sky, terrain, water, falls, castle, extras, trees, grass, flowers, whale, clouds, birds, hero, ctrl, cmats, fireflies };
}

const W = await build();
window.__W = W;
const rain = new Rain();
scene.add(rain.mesh);
// the traveller's clothes and hair stay matte in the rain
W.hero.group.traverse((o) => { if (o.material && !o.material.isShaderMaterial) { o.material.defines = { ...(o.material.defines || {}), NO_WET: '' }; o.material.needsUpdate = true; } });
csmify(scene);
injectSkyAll(scene);
// unlit veils (floating-island falls and the like) dim with the light
const tintables = [];
scene.traverse((o) => {
  const m = o.material;
  if (m && m.isMeshBasicMaterial && m.fog && m.blending === THREE.NormalBlending && !tintables.some((t) => t.m === m)) tintables.push({ m, base: m.color.clone() });
});
// lakes and river mirror the world (skip small detail that would never read in a ripple)
const reflection = params.has('norefl') ? null : new WaterReflection(renderer, W.water, W.hf, 0.5);
if (reflection) reflection.hidden.push(W.grass, W.flowers);

// ---------------------------------------------------------------------------
// Post-processing
const composer = new EffectComposer(renderer);
// ambient occlusion grounds the traveller, trees, rocks and the castle (half resolution for speed)
let aoPass = null;
if (!params.has('noao')) {
  aoPass = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight);
  Object.assign(aoPass.configuration, { aoRadius: 2.2, distanceFalloff: 1.0, intensity: 2.0, halfRes: true, gammaCorrection: false, color: new THREE.Color('#1a2433') });
  aoPass.setQualityMode('Performance');
  composer.addPass(aoPass);
} else composer.addPass(new RenderPass(scene, camera));
// volumetric cumulus above the valley (needs the scene depth captured by the AO pass)
const vclouds = aoPass && !params.has('noclouds') ? new VolumetricClouds(camera, () => aoPass.beautyRenderTarget.depthTexture, 0.5) : null;
if (vclouds) composer.addPass(vclouds);
const BLOOM = 0.28;
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.75, 0.9);
composer.addPass(bloom);
// sun shafts through the air (screen-space, only when the sun is near the frame)
const raysPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.9, 0.7) }, uStrength: { value: 0 }, uAspect: { value: 1 }, uCol: { value: new THREE.Color(1, 0.86, 0.64) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength, uAspect; uniform vec3 uCol; varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength < 0.001) { gl_FragColor = base; return; }
      vec2 d = (vUv - uSun) / 40.0;
      vec2 uv = vUv; float acc = 0.0, w = 1.0;
      for (int i = 0; i < 40; i++) {
        uv -= d;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float lum = dot(c, vec3(0.3, 0.55, 0.15));
        acc += smoothstep(0.82, 1.3, lum) * w;
        w *= 0.955;
      }
      float fall = smoothstep(1.3, 0.0, length((vUv - uSun) * vec2(uAspect, 1.0)));
      gl_FragColor = vec4(base.rgb + uCol * acc * 0.045 * uStrength * fall, base.a);
    }`,
});
composer.addPass(raysPass);
// depth of field for photo mode (renders scene depth, so it stays off otherwise)
const bokeh = new BokehPass(scene, camera, { focus: 8, aperture: 0.00025, maxblur: 0.006 });
bokeh.enabled = false;
composer.addPass(bokeh);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAspect, uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      c.rgb *= mix(0.84, 1.0, smoothstep(1.25, 0.35, length(q)));
      // gentle grade: cool lifted shadows, warm highlights
      float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
      c.rgb = mix(c.rgb, c.rgb * vec3(0.93, 0.98, 1.06), (1.0 - l) * 0.35);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.94), smoothstep(0.55, 1.0, l) * 0.4);
      // a touch more saturation and contrast for a crisper, more photographic image
      float l2 = dot(c.rgb, vec3(0.3, 0.59, 0.11));
      c.rgb = mix(vec3(l2), c.rgb, 1.12);
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
      c.rgb = mix(vec3(0.035, 0.05, 0.08), vec3(1.0), clamp(c.rgb, 0.0, 1.0));
      c.rgb += (h(vUv * 800.0) - 0.5) * 0.012; // fine grain against banding
      gl_FragColor = c;
    }`,
});
composer.addPass(finalPass);
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);

function resize() {
  // a hidden or collapsed window can report zero size; never let that reach the camera (0/0 aspect)
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  finalPass.uniforms.uAspect.value = w / h;
  raysPass.uniforms.uAspect.value = w / h;
  fxaa.material.uniforms.resolution.value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio()));
  csm.updateFrustums();
  if (reflection) reflection.setSize(renderer.domElement.width, renderer.domElement.height);
}
window.addEventListener('resize', resize);
resize();
window.__R = () => { if (reflection) reflection.update(scene, camera); composer.render(); };
window.__AO = () => aoPass;
window.__cam = () => ({ ...cam, vw: visitWeight() });

// ---------------------------------------------------------------------------
// Input, audio, HUD
const input = new Input(renderer.domElement);
const audio = new AudioEngine();
const hud = $('hud'), modeEl = $('mode'), soundEl = $('sound'), toastEl = $('toast');
let hudVisible = true;
// ---- photo mode: a free camera, a frozen world if wanted, depth of field, high-resolution saves
const photo = { active: false, frozen: false, dof: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 50 };
const photoBar = $('photobar');
function setPhoto(on) {
  photo.active = on;
  if (on) {
    photo.pos.copy(camera.position);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    photo.yaw = e.y; photo.pitch = e.x; photo.fov = camera.fov;
    photo.frozen = false; photo.dof = false;
  } else {
    photo.frozen = false; bokeh.enabled = false;
    journey.modeChanged = true; // glide back to the story camera
  }
  for (const el of [hud, timeUI, modeEl, soundEl]) el.style.visibility = on ? 'hidden' : '';
  photoBar.style.display = on ? '' : 'none';
  updatePhotoBar();
}
function updatePhotoBar() {
  photoBar.querySelector('.state').textContent = (photo.frozen ? '已定格' : '世界流动中') + ' · 景深' + (photo.dof ? '开' : '关') + ' · 焦距 ' + photo.fov.toFixed(0) + '°';
}
function photoControls(dt, look) {
  const sp = (input.down('ShiftLeft', 'ShiftRight') ? 60 : 12) * dt;
  photo.yaw -= look.dx * 0.004 * (photo.fov / 50);
  photo.pitch = clamp(photo.pitch - look.dy * 0.004 * (photo.fov / 50), -1.5, 1.5);
  if (look.wheel) { photo.fov = clamp(photo.fov * Math.pow(1.08, look.wheel), 12, 90); updatePhotoBar(); }
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(photo.pitch, photo.yaw, 0, 'YXZ'));
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q), r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  if (input.down('KeyW', 'ArrowUp')) photo.pos.addScaledVector(f, sp);
  if (input.down('KeyS', 'ArrowDown')) photo.pos.addScaledVector(f, -sp);
  if (input.down('KeyD', 'ArrowRight')) photo.pos.addScaledVector(r, sp);
  if (input.down('KeyA', 'ArrowLeft')) photo.pos.addScaledVector(r, -sp);
  if (input.down('KeyR')) photo.pos.y += sp;
  if (input.down('KeyF')) photo.pos.y -= sp;
  photo.pos.y = Math.max(photo.pos.y, Math.max(W.hf.height(photo.pos.x, photo.pos.z), 0) + 0.4);
  if (input.hit('Space')) { photo.frozen = !photo.frozen; updatePhotoBar(); }
  if (input.hit('KeyG')) { photo.dof = !photo.dof; updatePhotoBar(); }
  if (input.hit('Enter')) savePhoto();
  if (input.hit('Escape')) setPhoto(false);
}
function applyPhotoCamera() {
  camera.position.copy(photo.pos);
  camera.quaternion.setFromEuler(new THREE.Euler(photo.pitch, photo.yaw, 0, 'YXZ'));
  camera.fov = photo.fov;
  camera.updateProjectionMatrix();
  bokeh.enabled = photo.dof;
  if (photo.dof) bokeh.uniforms.focus.value = camera.position.distanceTo(W.ctrl.pos) + 0.3; // focus on the traveller
}
// render at up to twice the resolution (a few frames first, so the clouds settle) and download it
function savePhoto() {
  const prev = renderer.getPixelRatio();
  const target = Math.min(prev * 2, 3840 / Math.max(1, window.innerWidth), 4);
  setPixelRatio(target);
  camera.updateMatrixWorld();
  for (let i = 0; i < 8; i++) { if (reflection && reflection.enabled !== false) reflection.update(scene, camera); composer.render(); }
  const dims = `${renderer.domElement.width}×${renderer.domElement.height}`;
  renderer.domElement.toBlob((blob) => {
    if (!blob) { toast('保存失败'); return; }
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `天空之鲸-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`照片已保存（${dims}）`);
  }, 'image/jpeg', 0.95);
  setPixelRatio(prev);
}
window.__photo = photo;

function setHud(on, save = true) {
  hudVisible = on;
  hud.style.opacity = on ? 1 : 0; timeUI.style.opacity = on ? 1 : 0; timeUI.style.pointerEvents = on ? '' : 'none';
  if (save) savePrefs({ hud: on });
}
function toast(msg, sec = 3) {
  toastEl.textContent = msg; toastEl.style.opacity = 1;
  clearTimeout(toast._t); toast._t = setTimeout(() => (toastEl.style.opacity = 0), sec * 1000);
}
// time panel: clock, a 24-hour slider, play/pause, speed and quick jumps
const timeUI = $('timeui'), tSlider = $('tslider'), tClock = $('tclock'), tPhase = $('tphase'), tPlay = $('tplay'), tSpeed = $('tspeed'), tIcon = $('ticon');
let tDragging = false, tLastUI = 0;
tSlider.addEventListener('input', () => { tDragging = true; setHours(+tSlider.value); });
tSlider.addEventListener('change', () => { tDragging = false; });
tPlay.addEventListener('click', () => setTimePlaying(!tod.playing));
tSpeed.addEventListener('change', () => { tod.speed = +tSpeed.value; savePrefs({ speed: tod.speed }); });
for (const b of timeUI.querySelectorAll('[data-h]')) b.addEventListener('click', () => setHours(+b.dataset.h));
for (const b of timeUI.querySelectorAll('[data-w]')) b.addEventListener('click', () => setWeather(b.dataset.w));
$('tphoto').addEventListener('click', () => setPhoto(true));
$('psave').addEventListener('click', () => savePhoto());
$('pexit').addEventListener('click', () => setPhoto(false));
photoBar.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') e.preventDefault(); });
// keep keyboard focus on the world after using the panel (so WASD and T keep working)
timeUI.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') e.preventDefault(); });
timeUI.addEventListener('pointerup', () => setTimeout(() => document.activeElement?.blur?.(), 0));
tSpeed.addEventListener('change', () => tSpeed.blur());
if (params.has('tspeed') || prefs.speed) { tod.speed = +(params.get('tspeed') ?? prefs.speed); tSpeed.value = String(tod.speed); }
function updateTimePanel(force = false) {
  const now = performance.now();
  if (!force && now - tLastUI < 200) return;
  tLastUI = now;
  tClock.textContent = tod.clock();
  tPhase.textContent = tod.phaseName() + (tod.playing ? '' : ' · 已暂停');
  if (!tDragging) tSlider.value = tod.hours.toFixed(2);
  tPlay.textContent = tod.playing ? '❚❚' : '▶';
  for (const b of timeUI.querySelectorAll('[data-w]')) b.classList.toggle('on', b.dataset.w === (weather.auto ? 'auto' : weather.kind));
  // a little sun or moon that follows the sky
  const e = tod.sunElev, n = tod.night;
  tIcon.style.background = n > 0.5
    ? 'radial-gradient(circle at 62% 38%, rgba(0,0,0,0) 38%, #f6f1dc 40%, #f6f1dc 54%, rgba(246,241,220,0) 56%), radial-gradient(circle, rgba(170,200,255,.35), rgba(170,200,255,0) 70%)'
    : `radial-gradient(circle, ${e < 8 ? '#ffb46a' : '#fff1c8'} 34%, rgba(255,210,140,.45) 44%, rgba(255,210,140,0) 70%)`;
}

function startAudio() {
  if (audio.started && audio.ctx.state === 'running') return;
  audio.start();
  soundEl.style.opacity = 0;
}
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);

W.hero.onStep = (surface, strength, p) => audio.footstep(surface, strength, camera.position.distanceTo(p));

// ---------------------------------------------------------------------------
// Journey state
const journey = {
  s: params.has('s') ? +params.get('s') : 0,
  mode: 'auto', // 'auto' (the camera tells the story) or 'play' (you walk)
  phase: 'run', // run | light | hold
  veil: params.has('cam') || params.has('nov') ? 0 : 1,
  holdT: 0, lightT: 0,
  relocate: null,
  wait: params.has('s') ? 0 : 4.5, // the traveller first stands at the cliff and looks out
};
if (journey.s > 0) {
  const p = W.path.sample(journey.s);
  W.ctrl.place(p.x, p.z, Math.atan2(p.tx, p.tz));
}
const gateWorld = W.castle.userData.gateGlow.getWorldPosition(new THREE.Vector3());
const sGate = W.path.nearest(gateWorld.x, gateWorld.z, 60).s + 1;
const sLightStart = sGate - 30;
const bellPos = W.extras.userData.bellPos || new THREE.Vector3(-170, 45, 170);
let whaleT = params.has('wt') ? +params.get('wt') : 0;
const timeScale = params.has('ts') ? +params.get('ts') : 1;
let time = 0, last = performance.now(), started = false, realDt = 1 / 60;
const paused = params.has('pause');
let whaleAnswerAt = -1, lastCallAt = -100;
// the whale's visit: where will the traveller be when it passes overhead, and what must it clear
const AUTO_SPEED = W.path.length / 306; // the auto journey's pace (m/s)
const S_AUTO_CALL = W.path.length * 0.2; // where the auto traveller calls to the whale, once per journey
const spireTip = W.castle.userData.spireTip.clone();
function predictTraveller(tau) {
  const c = W.ctrl;
  if (journey.mode !== 'auto') return new THREE.Vector3(c.pos.x, 0, c.pos.z);
  // the auto traveller stops to watch ~8 s before the pass
  const p = W.path.sample(Math.min(journey.s + AUTO_SPEED * Math.max(0, tau - 8), sLightStart - 40));
  return new THREE.Vector3(p.x, 0, p.z);
}
const groundAt = (x, z) => Math.max(W.hf.height(x, z), 0);
const clearAt = (x, z) => Math.max(groundAt(x, z), spireTip.y * smoothstep(170, 70, Math.hypot(x - spireTip.x, z - spireTip.z)));
function whaleVisit() {
  const v = W.whale.visit(whaleT, predictTraveller, groundAt, clearAt);
  if (v) visitInfo = { tPass: v.tPass, sung: false };
  return v;
}
let visitInfo = null;
const gustDir = new THREE.Vector3();

function nearestS(pos, around) {
  const P = W.path;
  let best = 1e18, bs = around;
  const k0 = Math.max(0, Math.floor((around - 12) / P.step)), k1 = Math.min(P.x.length - 1, Math.floor((around + 40) / P.step));
  for (let k = k0; k <= k1; k++) {
    const d = (P.x[k] - pos.x) ** 2 + (P.z[k] - pos.z) ** 2;
    if (d < best) { best = d; bs = k * P.step; }
  }
  if (best > 30 * 30) {
    const n = P.nearest(pos.x, pos.z, 120);
    if (n) return { s: n.s, d: n.d };
    return { s: around, d: Math.sqrt(best) };
  }
  return { s: bs, d: Math.sqrt(best) };
}

function setMode(m) {
  if (journey.mode === m) return;
  journey.mode = m;
  journey.modeChanged = true;
  modeEl.textContent = m === 'auto' ? '自动旅程 · 按方向键或拖动鼠标接管' : '自由探索 · 按 P 回到自动旅程';
  if (m === 'play') {
    // start the orbit camera from wherever the director had it
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    orbit.yaw = Math.atan2(f.x, -f.z);
    orbit.pitch = clamp(-Math.asin(f.y) + 0.12, -0.2, 0.9);
    orbit.dist = clamp(camera.position.distanceTo(W.ctrl.pos), 4, 12);
    orbit.eff = orbit.dist;
    orbit.focus.set(0, 0, 0);
    toast('自由探索：WASD 移动 · 空格跳跃（空中按住滑翔） · F 呼唤', 4);
  } else {
    cam.init = false;
    const n = nearestS(W.ctrl.pos, journey.s);
    journey.s = n.s;
    if (n.d > 14) journey.relocate = { s: n.s, t: 0 };
    toast('自动旅程继续');
  }
}

// ---------------------------------------------------------------------------
// Camera: cinematic director (auto) and orbit follow (play)
const SHOTS = [
  { u: 0.00, bias: 0.9, cx: 0.16, pitch: 3.0, dist: 12.5, sx: -0.4, sy: -0.56, fov: 58 },
  { u: 0.06, bias: 0.85, cx: 0.22, pitch: 4.5, dist: 11.0, sx: -0.34, sy: -0.52, fov: 56 },
  { u: 0.18, bias: 0.7, cx: 0.28, pitch: 5.0, dist: 9.0, sx: -0.2, sy: -0.48, fov: 52 },
  { u: 0.30, bias: 0.6, cx: 0.12, pitch: 4.0, dist: 8.5, sx: 0.1, sy: -0.52, fov: 50 },
  { u: 0.38, bias: 0.7, cx: 0.25, pitch: 4.5, dist: 10.5, sx: -0.22, sy: -0.5, fov: 54 },
  { u: 0.445, bias: 0.75, cx: 0.3, pitch: 4.0, dist: 12.0, sx: -0.3, sy: -0.45, fov: 56 },
  { u: 0.492, bias: 0.4, cx: 0.2, yo: -20, pitch: -3.0, dist: 13.0, sx: 0.3, sy: -0.2, fov: 62 },
  { u: 0.515, bias: 0.4, cx: 0.2, yo: -22, pitch: -3.0, dist: 13.0, sx: 0.32, sy: -0.18, fov: 62 },
  { u: 0.56, bias: 0.7, cx: 0.1, pitch: 7.0, dist: 9.5, sx: 0.16, sy: -0.52, fov: 52 },
  { u: 0.70, bias: 0.75, cx: 0.2, pitch: 9.5, dist: 9.5, sx: -0.05, sy: -0.56, fov: 53 },
  { u: 0.80, bias: 0.8, cx: 0.12, pitch: 12.0, dist: 11.0, sx: -0.12, sy: -0.58, fov: 56 },
  { u: 0.87, bias: 0.85, cx: 0.1, pitch: 22.0, dist: 15.0, sx: -0.06, sy: -0.72, fov: 64 },
  { u: 0.915, bias: 0.9, cx: 0.08, pitch: 25.0, dist: 16.0, sx: -0.02, sy: -0.76, fov: 68 },
  { u: 0.955, bias: 0.2, cx: 0.0, pitch: 11.0, dist: 11.0, sx: 0.0, sy: -0.58, fov: 58 },
  { u: 1.00, bias: 0.0, cx: 0.0, pitch: 6.0, dist: 9.0, sx: 0.0, sy: -0.45, fov: 54 },
];
function shotAt(u) {
  let i = 0;
  while (i < SHOTS.length - 2 && SHOTS[i + 1].u < u) i++;
  const a = SHOTS[i], b = SHOTS[i + 1];
  const t = smoothstep(a.u, b.u, u);
  const o = {};
  for (const k of ['bias', 'cx', 'yo', 'pitch', 'dist', 'sx', 'sy', 'fov']) o[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
  return o;
}
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const cam = { yaw: 0, pitch: 0, dist: 10, sx: 0, sy: 0, fov: 52, init: false, focus: new THREE.Vector3() };
const orbit = { yaw: 0, pitch: 0.2, dist: 7, eff: 7, focus: new THREE.Vector3() };
const camBlend = { t: 1, pos: new THREE.Vector3(), q: new THREE.Quaternion() };
const camRay = new THREE.Raycaster(); camRay.firstHitOnly = true;

function directorCamera(s, dt, t) {
  const { path, hf } = W;
  const u = s / path.length;
  const shot = shotAt(u);
  const p = W.ctrl.pos;
  const pathYaw = path.heading(s, 45);
  const toCastle = Math.atan2(CASTLE.x - p.x, -(CASTLE.z - p.z));
  const tanH = Math.tan(THREE.MathUtils.degToRad(shot.fov / 2)) * camera.aspect;
  const castleYaw = toCastle - Math.atan(shot.cx * tanH);
  let yaw = angLerp(pathYaw, castleYaw, shot.bias);
  yaw += 0.035 * Math.sin(t * 0.05) + THREE.MathUtils.degToRad(shot.yo);
  let pitchDeg = shot.pitch + 0.6 * Math.sin(t * 0.07);
  if (u < 0.935) {
    // the camera quietly notices the whale when it is near the frame
    const wp = W.whale.position;
    const wYaw = Math.atan2(wp.x - p.x, -(wp.z - p.z));
    const dYaw = Math.atan2(Math.sin(wYaw - yaw), Math.cos(wYaw - yaw));
    const halfH = Math.atan(tanH);
    const nearW = smoothstep(halfH + 0.6, halfH - 0.1, Math.abs(dYaw));
    yaw += clamp(dYaw * 0.35, -0.2, 0.2) * nearW;
    const wElev = THREE.MathUtils.radToDeg(Math.atan2(wp.y - p.y, Math.hypot(wp.x - p.x, wp.z - p.z)));
    const top = pitchDeg + shot.fov * 0.5 - 6;
    if (wElev > top) pitchDeg += clamp((wElev - top) * 0.6, 0, 11) * nearW;
  }
  // the whale's visit: look up and hold it in frame as it sweeps overhead
  // (a low-angle shot: close behind the traveller, who sits at the bottom of a wide frame)
  const vw = visitWeight();
  let fov = shot.fov, sy = shot.sy, dist = shot.dist;
  if (vw > 0) {
    const wp = W.whale.position;
    const before = whaleT < visitInfo.tPass;
    if (before) visitInfo.yaw = Math.atan2(wp.x - p.x, -(wp.z - p.z)); // stop chasing once it is overhead
    const dYaw = clamp(Math.atan2(Math.sin(visitInfo.yaw - yaw), Math.cos(visitInfo.yaw - yaw)), -1.2, 1.2);
    const wElev = THREE.MathUtils.radToDeg(Math.atan2(wp.y - p.y, Math.hypot(wp.x - p.x, wp.z - p.z)));
    yaw += dYaw * 0.65 * vw;
    pitchDeg = lerp(pitchDeg, clamp((before ? wElev : 30) - 10, pitchDeg, 30), vw);
    fov = lerp(fov, 72, vw); sy = lerp(sy, -0.86, vw); dist = lerp(dist, 7.5, vw);
  }
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const focusTarget = new THREE.Vector3(p.x, p.y + 0.7, p.z);
  if (!cam.init) {
    Object.assign(cam, { yaw, pitch, dist, sx: shot.sx, sy, fov, init: true, floorInit: false });
    cam.focus.copy(focusTarget);
  }
  const k = 1 - Math.exp(-dt * 0.6);
  cam.yaw = angLerp(cam.yaw, yaw, k);
  cam.pitch = lerp(cam.pitch, pitch, k);
  cam.dist = lerp(cam.dist, dist, k);
  cam.sx = lerp(cam.sx, shot.sx, k);
  cam.sy = lerp(cam.sy, sy, k);
  cam.fov = lerp(cam.fov, fov, k);
  cam.focus.lerp(focusTarget, 1 - Math.exp(-dt * 6));

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cam.pitch, -cam.yaw, 0, 'YXZ'));
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const dir = new THREE.Vector3(cam.sx * tanV * camera.aspect, cam.sy * tanV, -1).normalize().applyQuaternion(q);
  const pos = cam.focus.clone().addScaledVector(dir, -cam.dist);
  let g = Math.max(hf.height(pos.x, pos.z), 0.5);
  const near = path.nearest(pos.x, pos.z, 16);
  if (near && near.d < 8 && path.isBridge(near.s)) g = Math.max(g, path.y[near.k] + 1.2);
  const floorY = g + 1.6;
  if (!cam.floorInit) { cam.floor = floorY; cam.floorInit = true; }
  cam.floor = lerp(cam.floor, floorY, 1 - Math.exp(-dt * (floorY > cam.floor ? 6 : 1.2)));
  if (pos.y < cam.floor) {
    pos.y = cam.floor;
    const toF = cam.focus.clone().sub(pos);
    const elev = Math.atan2(toF.y, Math.hypot(toF.x, toF.z));
    const lowest = Math.atan(Math.min(cam.sy, -0.72) * tanV);
    // (during the whale's pass the shot may tilt up past the traveller)
    const tilt = visitInfo ? smoothstep(visitInfo.tPass - 10, visitInfo.tPass - 4, whaleT) * (1 - smoothstep(visitInfo.tPass + 1, visitInfo.tPass + 6, whaleT)) : 0;
    if (elev - cam.pitch < lowest) q.setFromEuler(new THREE.Euler(lerp(elev - lowest, cam.pitch, 0.85 * tilt), -cam.yaw, 0, 'YXZ'));
  }
  return { pos, q, fov: cam.fov };
}

// 0..1: how much the camera should attend to the whale's overhead pass
function visitWeight() {
  if (!visitInfo) return 0;
  const tp = visitInfo.tPass;
  return smoothstep(tp - 24, tp - 12, whaleT) * (1 - smoothstep(tp + 8, tp + 20, whaleT));
}

function orbitCamera(dt, look) {
  const c = W.ctrl;
  // during the whale's pass, drift the view up toward it unless the player is steering the camera
  const vw = visitWeight();
  if (vw > 0 && performance.now() - input.lastLook > 2500) {
    const wp = W.whale.position;
    const wYaw = Math.atan2(wp.x - c.pos.x, -(wp.z - c.pos.z));
    orbit.yaw = angLerp(orbit.yaw, wYaw, 1 - Math.exp(-dt * 0.8 * vw));
    orbit.pitch = lerp(orbit.pitch, -0.28, 1 - Math.exp(-dt * 0.8 * vw));
  }
  orbit.yaw += look.dx * 0.005;
  orbit.pitch = clamp(orbit.pitch + look.dy * 0.004, -0.32, 1.25);
  orbit.dist = clamp(orbit.dist * Math.pow(1.12, look.wheel), 2.2, 24);
  // drift behind the traveller while moving, unless the player is steering the view
  const sp = Math.hypot(c.vel.x, c.vel.z);
  if (sp > 0.5 && performance.now() - input.lastLook > 1800) {
    const behind = Math.atan2(c.vel.x, -c.vel.z);
    orbit.yaw = angLerp(orbit.yaw, behind, 1 - Math.exp(-dt * 0.9 * Math.min(1, sp / 3)));
  }
  const focusT = c.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
  if (orbit.focus.lengthSq() === 0) orbit.focus.copy(focusT);
  orbit.focus.lerp(focusT, 1 - Math.exp(-dt * 10));
  const lp = -orbit.pitch;
  const fwd = new THREE.Vector3(Math.sin(orbit.yaw) * Math.cos(lp), Math.sin(lp), -Math.cos(orbit.yaw) * Math.cos(lp));
  // collision: walls and terrain between the traveller and the lens
  let d = orbit.dist;
  camRay.set(orbit.focus, fwd.clone().negate()); camRay.far = d;
  const hits = camRay.intersectObjects(c.walls, false);
  if (hits.length) d = Math.max(0.8, hits[0].distance - 0.35);
  for (let i = 1; i <= 10; i++) {
    const tt = (i / 10) * d;
    const pp = orbit.focus.clone().addScaledVector(fwd, -tt);
    if (pp.y < W.hf.height(pp.x, pp.z) + 0.45) { d = Math.max(0.8, tt - d / 10); break; }
  }
  orbit.eff = d < orbit.eff ? d : lerp(orbit.eff, d, 1 - Math.exp(-dt * 2));
  const pos = orbit.focus.clone().addScaledVector(fwd, -orbit.eff);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lp, -orbit.yaw, 0, 'YXZ'));
  return { pos, q, fov: 55 };
}

function updateCamera(dt, t, look) {
  const shot = journey.mode === 'auto' ? directorCamera(journey.s, dt, t) : orbitCamera(dt, look);
  // blend smoothly between camera modes
  if (journey.modeChanged) { camBlend.t = 0; camBlend.pos.copy(camera.position); camBlend.q.copy(camera.quaternion); journey.modeChanged = false; }
  camBlend.t = Math.min(1, camBlend.t + dt / 1.4);
  const b = smoothstep(0, 1, camBlend.t);
  if (b >= 1) { camera.position.copy(shot.pos); camera.quaternion.copy(shot.q); }
  else { camera.position.copy(camBlend.pos).lerp(shot.pos, b); camera.quaternion.copy(camBlend.q).slerp(shot.q, b); }
  camera.fov = b >= 1 ? shot.fov : lerp(camera.fov, shot.fov, 0.1);
  // recover if anything upstream ever produced a non-finite camera (it would otherwise stick forever)
  if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z + camera.quaternion.w + camera.fov)) {
    cam.init = false; orbit.focus.set(0, 0, 0); orbit.eff = orbit.dist = 7; orbit.yaw = 0; orbit.pitch = 0.2;
    if (!Number.isFinite(camera.aspect)) camera.aspect = 16 / 9;
    camera.position.copy(W.ctrl.pos).add(new THREE.Vector3(0, 3, 8)); camera.quaternion.identity(); camera.fov = 55;
  }
  camera.updateProjectionMatrix();

  const dbg = params.get('cam');
  if (dbg === 'whale') {
    const wp = W.whale.position;
    const off = new THREE.Vector3(+(params.get('ox') ?? 0), +(params.get('oy') ?? -60), +(params.get('oz') ?? 520));
    if (params.has('rel')) off.applyQuaternion(W.whale.root.quaternion);
    camera.position.copy(wp).add(off);
    camera.lookAt(wp);
    camera.fov = +(params.get('fov') ?? 40); camera.updateProjectionMatrix();
  } else if (dbg === 'trav') {
    const tp = W.hero.worldPos, f = W.hero.forward;
    const a = +(params.get('a') ?? 1.2), d = +(params.get('d') ?? 3.2), hgt = +(params.get('ch') ?? 0.9);
    const side = new THREE.Vector3(-f.z, 0, f.x);
    camera.position.copy(tp).addScaledVector(side, Math.cos(a) * d).addScaledVector(f, Math.sin(a) * d).add(new THREE.Vector3(0, hgt, 0));
    camera.lookAt(tp.clone().add(new THREE.Vector3(0, +(params.get('ly') ?? 0.65), 0)));
    camera.fov = +(params.get('fov') ?? 40); camera.updateProjectionMatrix();
  } else if (dbg === 'free') {
    camera.position.set(+params.get('x'), +params.get('y'), +params.get('z'));
    camera.lookAt(+params.get('lx'), +params.get('ly'), +params.get('lz'));
  }
}

// ---------------------------------------------------------------------------
// Call effect: a ring of light that blooms from the traveller
const ringMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform float uT; varying vec2 vUv;
    void main(){ float r = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.06, 0.0, abs(r - 0.35 - uT * 0.6)) * (1.0 - uT);
      float core = smoothstep(0.5, 0.0, r) * (1.0 - uT) * 0.5;
      gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * (ring + core), 1.0); }`,
});
const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), ringMat);
ring.visible = false;
scene.add(ring);

// ---------------------------------------------------------------------------
function update(dt) {
  time += dt;
  whaleT += dt;
  const c = W.ctrl, j = journey;
  const look = input.consumeLook();
  // photo mode takes the keys and the mouse
  if (input.hit('KeyC')) setPhoto(!photo.active);
  const photoOn = photo.active;
  if (photoOn) photoControls(realDt, look);

  // --- mode switching
  const ax = photoOn ? { x: 0, y: 0 } : input.axes();
  const wantsControl = !photoOn && (ax.x !== 0 || ax.y !== 0 || input.hit('Space') || look.dx !== 0 || look.dy !== 0 || look.wheel !== 0);
  if (j.mode === 'auto' && wantsControl && !params.has('cam') && j.phase === 'run') setMode('play');
  else if (input.hit('KeyP')) setMode(j.mode === 'auto' ? 'play' : 'auto');
  if (j.mode === 'play' && performance.now() - Math.max(input.lastActivity, input.lastLook) > 45000) setMode('auto');
  if (input.hit('KeyM')) { audio.setMuted(!audio.muted); savePrefs({ muted: audio.muted }); toast(audio.muted ? '已静音' : '声音已开启'); }
  if (input.hit('KeyH')) setHud(!hudVisible);
  if (!photoOn && input.hit('KeyQ')) applyQuality(quality === 'high' ? 'medium' : quality === 'medium' ? 'low' : 'high');

  // --- movement input
  const move = new THREE.Vector3();
  let walk = false, jump = false, jumpHeld = false;
  let call = !photoOn && input.hit('KeyF');
  if (j.mode === 'auto' && j.phase === 'run' && !j.autoCalled && j.s > S_AUTO_CALL && !W.whale.visitState) { call = true; j.autoCalled = true; }
  if (j.s < 20) j.autoCalled = false;
  const watching = j.mode === 'auto' && visitInfo && Math.abs(whaleT - (visitInfo.tPass + 1)) < 7;
  if (j.phase === 'hold' || j.relocate) {
    // nobody steers while the light covers the screen
  } else if (j.mode === 'auto' && (j.wait > 0 || watching)) {
    j.wait -= dt;
  } else if (j.mode === 'auto') {
    const n = nearestS(c.pos, j.s);
    j.s = Math.max(j.s, n.s);
    const carrot = W.path.sample(Math.min(j.s + 3.2, W.path.length));
    move.set(carrot.x - c.pos.x, 0, carrot.z - c.pos.z);
    if (move.lengthSq() > 1e-4) move.normalize();
    if (j.s >= W.path.length - 4) move.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
  } else {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    move.addScaledVector(f, ax.y).addScaledVector(r, ax.x);
    if (move.lengthSq() > 1) move.normalize();
    walk = input.down('ShiftLeft', 'ShiftRight');
    jump = !photoOn && input.hit('Space');
    jumpHeld = !photoOn && input.down('Space');
    j.s = nearestS(c.pos, j.s).s;
  }
  const wasGrounded = c.grounded;
  c.update(dt, { move, walk, jump, jumpHeld, call });
  if (jump && !c.grounded && wasGrounded) audio.jump();

  // call: light ring, chime, the bell answers nearby and the whale sings back
  if (call && c.callT === 0) {
    audio.call();
    ring.visible = true; ringMat.uniforms.uT.value = 0;
    if (c.pos.distanceTo(bellPos) < 30) audio.bell();
    if (time - lastCallAt > 6 && whaleAnswerAt < 0) whaleAnswerAt = time + 1.6 + Math.random();
    lastCallAt = time;
  }
  if (ring.visible) {
    ringMat.uniforms.uT.value += dt / 1.3;
    ring.position.copy(c.pos).add(new THREE.Vector3(0, 1.0, 0));
    ring.quaternion.copy(camera.quaternion);
    if (ringMat.uniforms.uT.value >= 1) ring.visible = false;
  }
  if (whaleAnswerAt > 0 && time > whaleAnswerAt) {
    whaleAnswerAt = -1;
    audio.whaleSong(0.9, whalePan());
    W.whale.glow = 1;
    // it turns and comes to the traveller (unless it is already on its way)
    if (whaleVisit()) toast('鲸鱼听见了你的呼唤', 3);
  }
  // the overhead pass: a deep song, a swell of music, a slow glow
  if (visitInfo) {
    if (!visitInfo.sung && whaleT > visitInfo.tPass - 5) {
      visitInfo.sung = true;
      audio.whaleSong(1.0, whalePan()); audio.gateSwell(); W.whale.glow = 1;
      audio.whoosh(9, whalePan(), -whalePan() || 0.6);
    }
    if (!W.whale.visitState) visitInfo = null;
  }

  // --- journey: into the light at the castle gate, then back to the meadow
  if (j.phase === 'run') {
    let into = 0;
    if (j.mode === 'auto') into = smoothstep(sLightStart, sGate, j.s);
    else if (c.pos.distanceTo(gateWorld) < 7) { j.phase = 'light'; j.lightT = 0; audio.gateSwell(); }
    j.veil = Math.max(j.veil - dt / 3.2, into);
    if (j.mode === 'auto' && (j.s >= sGate || c.pos.distanceTo(gateWorld) < 5)) { j.phase = 'hold'; j.holdT = 0; audio.gateSwell(); }
    if (c.inDeepWater && !j.relocate) j.relocate = { s: nearestS(c.pos, j.s).s, t: 0 };
  } else if (j.phase === 'light') {
    j.lightT += dt;
    j.veil = Math.min(1, j.veil + dt / 1.6);
    if (j.veil >= 1) { j.phase = 'hold'; j.holdT = 0; }
  } else if (j.phase === 'hold') {
    j.veil = 1;
    j.holdT += dt;
    if (j.holdT > 0.9) {
      const p = W.path.sample(0);
      c.place(p.x, p.z, Math.atan2(p.tx, p.tz));
      j.s = 0; j.phase = 'run'; j.wait = 4.5;
      cam.init = false;
      orbit.focus.set(0, 0, 0);
      if (j.mode === 'play') { orbit.yaw = Math.atan2(p.tx, -p.tz); orbit.pitch = 0.18; }
      camBlend.t = 1;
      W.hero.resetCloth();
    }
  }
  // soft relocation (lost in deep water, or resuming the journey from far away)
  if (j.relocate) {
    const r = j.relocate;
    r.t += dt;
    if (r.t < 0.8) j.veil = Math.max(j.veil, r.t / 0.8);
    else if (!r.done) {
      const p = W.path.sample(r.s);
      c.place(p.x, p.z, Math.atan2(p.tx, p.tz));
      j.s = r.s; r.done = true;
      cam.init = false; orbit.focus.set(0, 0, 0); camBlend.t = 1; W.hero.resetCloth();
    } else if (r.t > 1.4) j.relocate = null;
  }
  veil.style.opacity = (j.veil * j.veil * (3 - 2 * j.veil)).toFixed(3);
  const gg = W.castle.userData.gateGlow;
  if (gg) gg.material.opacity = 0.75 + 0.25 * smoothstep(sLightStart - 60, sGate, j.s);

  // --- time of day (T: play/pause, [ ]: an hour back/forward)
  if (input.hit('KeyT')) setTimePlaying(!tod.playing);
  if (input.hit('KeyY')) { const order = ['clear', 'cloudy', 'rain', 'fog', 'auto']; setWeather(order[(order.indexOf(weather.auto ? 'auto' : weather.kind) + 1) % order.length]); }
  if (input.hit('BracketLeft')) setHours(tod.hours - 1);
  if (input.hit('BracketRight')) setHours(tod.hours + 1);
  applyTimeOfDay(dt);

  // --- character, camera and world
  W.hero.update(dt, time, c, (x, z, y) => c.ground(x, z, y));
  if (photoOn) applyPhotoCamera();
  else updateCamera(dt, time, look);
  W.whale.update(whaleT, dt, camera);
  W.clouds.update(time, camera);
  if (vclouds) vclouds.time = time;
  W.birds.update(time, dt);
  W.extras.userData.update?.(time, dt);
  W.sky.position.copy(camera.position);
  W.fireflies.update(time, c.pos, camera, renderer.domElement.height);
  rain.update(time, camera.position);
  W.trees.userData.updateLOD?.(camera.position);

  const tp = c.pos;
  camera.updateMatrixWorld();
  if (Math.abs(camera.fov - (csm._fov || 0)) > 0.05) { csm._fov = camera.fov; csm.updateFrustums(); }
  csm.update();
  scheduleShadows();

  const gu = W.grass.material.uniforms;
  gu.uTime.value = time;
  gu.uCenter.value.set(camera.position.x, camera.position.z).lerp(new THREE.Vector2(tp.x, tp.z), 0.6);
  if (gu.uPlayer) gu.uPlayer.value.set(tp.x, tp.y, tp.z);
  // the whale's wake: a gust that flattens the grass and flings the cape as it sweeps overhead
  {
    const g = visitInfo ? Math.exp(-(((whaleT - visitInfo.tPass - 1) / 4) ** 2)) : 0;
    const dir = W.whale.route && W.whale.route.tangent ? W.whale.route.tangent(W.whale.station, gustDir).setY(0).normalize() : gustDir.set(1, 0, 0);
    gu.uGust.value.set(dir.x, dir.z, g);
    W.hero.gust = (W.hero.gust || new THREE.Vector3()).set(dir.x * 7 * g, 1.8 * g, dir.z * 7 * g);
  }
  W.water.material.uniforms.uTime.value = time;
  W.falls.userData.material.uniforms.uTime.value = time;
  for (const m of W.trees.userData.materials) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = time;
  const banners = W.castle.userData.banners;
  if (banners) banners.forEach((b, i) => { b.rotation.y = 0.12 * Math.sin(time * 1.3 + i); });

  // sun shafts only when the sun is near the frame (and above the horizon)
  const sp = SUN_DIR.clone().multiplyScalar(1000).add(camera.position).project(camera);
  raysPass.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(SUN_DIR);
  raysPass.uniforms.uStrength.value = sp.z < 1 ? smoothstep(0.35, 0.8, facing) * SKY.uSunVis.value * (1 + 1.6 * weather.cur.fog) : 0; // shafts are stronger in fog
  raysPass.uniforms.uCol.value.copy(tod.lightColor);
  finalPass.uniforms.uTime.value = time % 10;

  // --- audio mix from the surroundings
  if (audio.started) {
    const env = sampleEnvironment(tp);
    audio.update(dt, {
      altitude: tp.y - Math.max(0, W.hf.height(tp.x, tp.z)) + tp.y * 0.3,
      gliding: c.gliding, speed: Math.hypot(c.vel.x, c.vel.z), water: env.water, falls: env.falls,
      whalePan: whalePan(), birds: env.birds, veil: j.veil, night: tod.night, rain: weather.cur.rain,
      golden: smoothstep(14, 5, tod.sunElev) * smoothstep(-6, 0, tod.sunElev),
    });
  }
  input.endFrame();
}

// ---------------------------------------------------------------------------
// Time of day → lights, exposure, environment, windows, bloom and the time panel
const _tint = new THREE.Color();
const FOG_BASE = scene.fog.density;
function applyTimeOfDay(dt) {
  weather.update(dt, tod.sunElev);
  tod.update(dt);
  const wc = weather.cur;
  scene.fog.density = FOG_BASE * (1 + 6 * wc.fog + 1.5 * wc.rain);
  SKY.uSkyTime.value = time;
  csm.lightDirection.copy(LIGHT_DIR).negate();
  for (const l of csm.lights) { l.color.copy(tod.lightColor); l.intensity = tod.lightIntensity; }
  hemi.color.copy(tod.hemiSky); hemi.groundColor.copy(tod.hemiGround); hemi.intensity = tod.hemiIntensity;
  fill.intensity = 0.35 * tod.dayF;
  scene.environmentIntensity = tod.envIntensity;
  renderer.toneMappingExposure = tod.exposure;
  bloom.strength = BLOOM + 0.32 * tod.night;
  // castle windows kindle at dusk and burn warm through the night
  const lamps = smoothstep(4, -6, tod.sunElev);
  W.cmats.winLit.emissiveIntensity = 1.25 + 3.2 * lamps;
  for (const t of tintables) t.m.color.copy(t.base).multiply(_tint.copy(SKY.uAmbientTint.value));
  W.whale.viewH = renderer.domElement.height;
  refreshEnv();
  updateTimePanel();
}
function setWeather(kind, announce = true) {
  weather.set(kind);
  if (announce) { savePrefs({ weather: kind }); toast('天气：' + weather.label()); }
  updateTimePanel(true);
}
function setHours(h) { tod.setHours(h); refreshEnv(true); updateTimePanel(true); }
function setTimePlaying(on) { tod.playing = on; toast(on ? '时间流动' : '时间暂停'); updateTimePanel(true); }
window.__time = (h) => { setHours(h); applyTimeOfDay(0); };

function whalePan() {
  const v = W.whale.position.clone().project(camera);
  return clamp(v.x, -0.8, 0.8) * (v.z < 1 ? 1 : -1);
}

let envCache = { t: -1, water: 0, falls: 0, birds: true };
function sampleEnvironment(p) {
  if (time - envCache.t < 0.25) return envCache;
  let wet = 0;
  for (const r of [8, 20, 40, 70]) for (let a = 0; a < 8; a++) {
    const x = p.x + Math.cos(a * 0.785) * r, z = p.z + Math.sin(a * 0.785) * r;
    if (W.hf.height(x, z) < 0) wet = Math.max(wet, 1 - r / 90);
  }
  let falls = 0;
  for (const L of W.falls.userData.lips) {
    if (!L.bottom) continue;
    const d = Math.min(p.distanceTo(L.bottom), p.distanceTo(new THREE.Vector3(L.x, L.top, L.z)));
    falls = Math.max(falls, clamp(1 - d / 160, 0, 1));
  }
  envCache = { t: time, water: wet, falls, birds: p.y < 70 && p.z > -700 };
  return envCache;
}

function frame(now) {
  requestAnimationFrame(frame);
  realDt = Math.max(0, Math.min((now - last) / 1000, 0.05));
  let dt = realDt * timeScale;
  last = now;
  if (photo.active && photo.frozen) dt = 0;
  if (paused) dt = params.has('step') ? 1 / 60 : 0;
  try { update(dt || 1e-4); } catch (e) { if (!frame.err) console.error('update failed:', e.stack.replace(/\n/g, ' | ')); frame.err = true; }
  if (reflection && reflection.enabled !== false && journey.veil < 0.99) reflection.update(scene, camera);
  else if (reflection) W.water.material.uniforms.uReflOn.value = 0;
  composer.render();
  if (!started) {
    started = true;
    loadingEl.style.opacity = 0;
    if (journey.veil === 0) loadingEl.remove();
    setTimeout(() => loadingEl.remove(), 1500);
  }
  if (params.has('stats')) statsTick(now);
  if (!photo.active) adaptResolution(now);
}

// fast-forward (no rendering) with continuity statistics — used for automated checks
window.__advance = (seconds, step = 1 / 30) => {
  const stats = { camJump: 0, camJumpAt: 0, whaleJump: 0, travOut: 0, minCamClear: 1e9, loops: 0, whaleOffFrame: 0, frames: 0 };
  update(step);
  const prevCam = camera.position.clone(), prevWhale = W.whale.position.clone();
  let prevPhase = journey.phase;
  const v = new THREE.Vector3();
  for (let t = 0; t < seconds; t += step) {
    update(step);
    camera.updateMatrixWorld();
    const visible = journey.veil < 0.5;
    const cj = camera.position.distanceTo(prevCam);
    if (visible && cj > stats.camJump) { stats.camJump = cj; stats.camJumpAt = journey.s; }
    stats.whaleJump = Math.max(stats.whaleJump, W.whale.position.distanceTo(prevWhale));
    prevCam.copy(camera.position); prevWhale.copy(W.whale.position);
    if (journey.phase !== prevPhase && journey.phase === 'hold') stats.loops++;
    prevPhase = journey.phase;
    if (!visible) continue;
    stats.frames++;
    v.copy(W.ctrl.pos).y += 0.7; v.project(camera);
    if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95 || v.z > 1) { stats.travOut++; if (stats.travOut % 20 === 1) (stats.outAt ||= []).push(journey.s.toFixed(0)); }
    v.copy(W.whale.position).project(camera);
    if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 || v.z > 1) stats.whaleOffFrame++;
    stats.minCamClear = Math.min(stats.minCamClear, camera.position.y - Math.max(W.hf.height(camera.position.x, camera.position.z), 0));
  }
  stats.s = journey.s; stats.phase = journey.phase; stats.pos = W.ctrl.pos.toArray().map((x) => +x.toFixed(1));
  return stats;
};
// simulate held keys for automated checks: __keys(['KeyW'], seconds)
window.__keys = (codes, seconds, step = 1 / 30) => {
  for (const k of codes) { input.keys.add(k); input.pressed.add(k); }
  input.lastActivity = performance.now();
  for (let t = 0; t < seconds; t += step) { update(step); for (const k of codes) input.pressed.delete(k); }
  for (const k of codes) input.keys.delete(k);
  return { pos: W.ctrl.pos.toArray().map((x) => +x.toFixed(2)), mode: journey.mode, grounded: W.ctrl.grounded, s: +journey.s.toFixed(1) };
};

let frameAcc = 0, frameCount = 0, lastAdapt = performance.now(), prevNow = performance.now();
function adaptResolution(now) {
  const ft = now - prevNow; prevNow = now;
  if (ft > 200 || document.hidden) return;
  frameAcc += ft; frameCount++;
  if (now - lastAdapt < 2500) return;
  const avg = frameAcc / frameCount;
  frameAcc = 0; frameCount = 0; lastAdapt = now;
  if (params.has('pr')) return;
  let pr = pixelRatio;
  const cap = Math.min(window.devicePixelRatio, QUALITY[quality].pr);
  if (avg > 21 && pr > 0.6) pr = Math.max(0.6, pr - 0.25);
  else if (avg < 13 && pr < cap) pr = Math.min(cap, pr + 0.25);
  if (pr > cap) pr = cap;
  if (pr !== pixelRatio) setPixelRatio(pr);
}
function setPixelRatio(pr) {
  pixelRatio = pr;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  resize();
}

// quality presets (Q cycles them)
const QUALITY = {
  high: { name: '高', pr: 1.5, refl: 0.5, clouds: 0.5 },
  medium: { name: '中', pr: 1.0, refl: 0.35, clouds: 0.4 },
  low: { name: '低', pr: 0.75, refl: 0, clouds: 0.3 },
};
let quality = params.get('q') in QUALITY ? params.get('q') : 'high';
function applyQuality(q, announce = true) {
  quality = q;
  const Q = QUALITY[q];
  if (reflection) { reflection.scale = Math.max(Q.refl, 0.2); reflection.enabled = Q.refl > 0; }
  if (vclouds) vclouds.scale = Q.clouds;
  setPixelRatio(Math.min(window.devicePixelRatio, Q.pr, q === 'high' ? 1.25 : Q.pr));
  if (announce) { savePrefs({ q }); toast('画质：' + Q.name + '（按 Q 切换）'); }
}

let fN = 0, fLast = performance.now();
const statsEl = params.has('stats') ? Object.assign(document.createElement('div'), { id: 'stats' }) : null;
if (statsEl) document.body.appendChild(statsEl);
function statsTick(now) {
  fN++;
  if (now - fLast > 500) {
    statsEl.textContent = `${(fN * 1000 / (now - fLast)).toFixed(0)} fps  s=${journey.s.toFixed(0)}/${W.path.length.toFixed(0)}  ${journey.mode}  calls=${renderer.info.render.calls}`;
    fN = 0; fLast = now;
  }
}

modeEl.textContent = '自动旅程 · 按方向键或拖动鼠标接管';
if (params.has('q')) applyQuality(quality, false);
else if (prefs.q in QUALITY) applyQuality(prefs.q, false);
// the rest of the remembered settings (the address bar wins)
if (!params.has('weather') && prefs.weather) setWeather(prefs.weather, false);
if (prefs.muted) audio.setMuted(true);
if (prefs.hud === false) setHud(false, false);
// compile every shader before the first frame without freezing the page (parallel where supported)
await stage('准备光影', 0.92);
{
  const tc = performance.now();
  update(1e-4);
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older browsers: compile on first draw */ }
  console.log(`shaders ready in ${(performance.now() - tc).toFixed(0)} ms`);
}
await stage('出发', 1);
requestAnimationFrame(frame);
