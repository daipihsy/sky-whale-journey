// Weather: clear, cloudy, rain and fog, easing from one to the next (by hand, or on its own every
// few minutes), a rainbow as the rain clears in daylight, and rain streaks around the camera.
import * as THREE from 'three';
import { SKY } from './atmosphere.js';
import { mulberry32 } from './noise.js';

export const WEATHER_NAMES = { clear: '晴', cloudy: '多云', rain: '雨', fog: '雾' };
const PRESETS = {
  clear: { cover: 0.0, overcast: 0.0, rain: 0.0, fog: 0.0 },
  cloudy: { cover: 0.6, overcast: 0.45, rain: 0.0, fog: 0.12 },
  rain: { cover: 0.9, overcast: 0.85, rain: 1.0, fog: 0.4 },
  fog: { cover: 0.25, overcast: 0.4, rain: 0.0, fog: 1.0 },
};
// how often each kind comes up when the weather changes on its own
const AUTO_ODDS = [['clear', 0.45], ['cloudy', 0.27], ['rain', 0.16], ['fog', 0.12]];

export class Weather {
  constructor(kind = 'clear', auto = true) {
    this.auto = auto;
    this.kind = kind;
    this.cur = { ...PRESETS[kind] };
    this.rainbow = 0;
    this.nextChange = 200 + Math.random() * 120; // the first spell of the day is fair
    this._prevRain = this.cur.rain;
    this.rnd = mulberry32(99);
  }
  set(kind) {
    if (kind === 'auto') { this.auto = true; this.nextChange = 150 + this.rnd() * 150; return; }
    this.auto = false;
    this.kind = kind;
  }
  label() { return (this.auto ? '自动 · ' : '') + WEATHER_NAMES[this.kind]; }
  update(dt, sunElev) {
    if (this.auto) {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        let r = this.rnd(), pick = 'clear';
        for (const [k, p] of AUTO_ODDS) { if (r < p) { pick = k; break; } r -= p; }
        this.kind = pick;
        this.nextChange = (pick === 'clear' ? 240 : 150) + this.rnd() * 150;
      }
    }
    // ease toward the target: clouds gather in ~20 s, rain starts a little after and stops sooner
    const T = PRESETS[this.kind], c = this.cur;
    const ease = (k, rate) => { c[k] += (T[k] - c[k]) * (1 - Math.exp(-dt * rate)); };
    ease('cover', 0.12); ease('overcast', 0.12); ease('fog', 0.08);
    ease('rain', T.rain > c.rain ? (c.overcast > 0.6 ? 0.15 : 0.02) : 0.2);
    // a rainbow opposite the sun as the rain clears in daylight
    const clearing = c.rain < this._prevRain - 1e-4 && c.rain < 0.55 && c.overcast < 0.7;
    const sunOk = sunElev > 3 && sunElev < 40;
    if (clearing && sunOk) this.rainbow = Math.min(1, this.rainbow + dt / 6);
    else this.rainbow = Math.max(0, this.rainbow - dt / (sunOk && c.rain < 0.1 ? 50 : 8));
    this._prevRain = c.rain;
    SKY.uOvercast.value = c.overcast;
    SKY.uCover.value = c.cover;
    SKY.uRain.value = c.rain;
    SKY.uRainbow.value = this.rainbow * (1 - c.overcast);
  }
}

// Rain streaks: a box of drops around the camera, animated entirely on the GPU
export class Rain {
  constructor(n = 12000, R = 26, H = 22) {
    const seed = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    const r = mulberry32(5);
    for (let i = 0; i < n; i++) {
      const x = r(), y = r(), z = r();
      for (let k = 0; k < 2; k++) { seed.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uAmt: { value: 0 }, uWind: { value: new THREE.Vector2(2.2, 0.8) } },
      vertexShader: `
        attribute vec3 aSeed; attribute float aEnd;
        uniform vec3 uCam; uniform float uT, uAmt; uniform vec2 uWind;
        varying float vA;
        void main() {
          const float R = ${R.toFixed(1)}, H = ${H.toFixed(1)};
          float speed = 11.0 + aSeed.x * 3.0;
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          // each drop falls through a box that wraps around the camera
          vec3 p;
          p.x = aSeed.x * 2.0 * R + vel.x * uT;
          p.z = aSeed.z * 2.0 * R + vel.z * uT;
          p.y = aSeed.y * H + vel.y * uT;
          p.x = mod(p.x - uCam.x + R, 2.0 * R) + uCam.x - R;
          p.z = mod(p.z - uCam.z + R, 2.0 * R) + uCam.z - R;
          p.y = mod(p.y - uCam.y + H * 0.5, H) + uCam.y - H * 0.5;
          p -= vel * 0.065 * aEnd; // streak length from the motion
          // fewer drops in light rain; fade out toward the edges of the box
          float keep = step(aSeed.y * 0.999, uAmt);
          float edge = 1.0 - smoothstep(0.6, 1.0, length(p.xz - uCam.xz) / R);
          vA = keep * edge * mix(0.35, 1.0, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uAmbientTint;
        varying float vA;
        void main() {
          vec3 c = vec3(0.86, 0.9, 0.97) * (0.45 + 0.55 * uAmbientTint);
          gl_FragColor = vec4(c, vA * 0.5);
        }`,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
  }
  update(t, camPos) {
    const a = SKY.uRain.value;
    this.mesh.visible = a > 0.02;
    this.mat.uniforms.uAmt.value = a;
    this.mat.uniforms.uT.value = t % 1000;
    this.mat.uniforms.uCam.value.copy(camPos);
  }
}
