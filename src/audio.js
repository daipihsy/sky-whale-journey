// Procedural sound, tuned to be soft and warm: a gentle music-box/piano score over a quiet pad,
// low wind and water beds (brown noise, no hiss), muted footsteps, a bright but soft call,
// a church-like bell, and a deep, slow whale song far away in the reverb.
// Everything is synthesised with WebAudio — no audio files.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// D major pentatonic: every note is consonant with every chord below
const PENTA = [62, 64, 66, 69, 71]; // D E F# A B
const CHORDS = [
  { root: 38, pad: [50, 57, 61, 66] }, // Dmaj7
  { root: 35, pad: [50, 54, 57, 61] }, // Bm7 (add D)
  { root: 43, pad: [50, 55, 59, 66] }, // Gmaj7
  { root: 45, pad: [52, 57, 61, 64] }, // A(add9)
];
// other moods, all consonant with the same pentatonic melody
const CHORDS_GOLDEN = [
  { root: 43, pad: [50, 55, 59, 66] }, // Gmaj7
  { root: 38, pad: [50, 57, 61, 64] }, // D(add9)
  { root: 35, pad: [50, 54, 57, 62] }, // Bm(add4)
  { root: 45, pad: [52, 57, 61, 64] }, // A(add9)
];
const CHORDS_NIGHT = [
  { root: 35, pad: [47, 54, 57, 62] }, // Bm7, low and open
  { root: 40, pad: [47, 52, 55, 62, 66] }, // Em9
  { root: 43, pad: [50, 55, 59, 62] }, // G
  { root: 38, pad: [45, 50, 57, 61] }, // Dmaj7
];
const CHORDS_RAIN = [
  { root: 35, pad: [50, 54, 57, 61] }, // Bm7
  { root: 40, pad: [52, 55, 59, 62] }, // Em7
  { root: 43, pad: [50, 55, 59, 66] }, // Gmaj7
  { root: 40, pad: [47, 52, 55, 59] }, // Em
];
// melodic shapes (steps within the pentatonic scale) and their rhythms (in beats)
const MOTIFS = [
  [[0, 1], [2, 1], [4, 2]], [[4, 1], [3, 1], [2, 2]], [[2, 1], [4, 1], [5, 1], [4, 2]],
  [[5, 1.5], [4, 0.5], [2, 2]], [[0, 1], [2, 1], [1, 1], [0, 2]], [[4, 2], [2, 1], [3, 1], [1, 2]],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.nextWhale = 14;
    this.nextBird = 6;
    this.musicTime = 0;
    this.chordIndex = 0;
    this.beat = 0.8; // seconds
  }

  start(ctxOverride) {
    if (this.started) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctxOverride && !AC) return;
    const ctx = this.ctx = ctxOverride || new AC();
    this.started = true;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 1.1, ctx.currentTime + 2.5);
    // gentle glue, soft top end
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2; comp.attack.value = 0.03; comp.release.value = 0.4;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 7000; tone.Q.value = 0.5;
    this.master.connect(tone).connect(comp).connect(ctx.destination);

    // warm, airy hall
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.6, 3.2);
    const rvTone = ctx.createBiquadFilter(); rvTone.type = 'lowpass'; rvTone.frequency.value = 3500;
    this.reverb.connect(rvTone).connect(this.master);
    this.dry = ctx.createGain(); this.dry.connect(this.master);

    this.brown = this._noise(6, 'brown');
    this.pink = this._noise(6, 'pink');
    this._buildWind();
    this._buildWater();
    this._buildRain();

    this.music = ctx.createGain(); this.music.gain.value = 0.9;
    const mLP = ctx.createBiquadFilter(); mLP.type = 'lowpass'; mLP.frequency.value = 4200;
    this.music.connect(mLP);
    const mDry = ctx.createGain(); mDry.gain.value = 0.75; mLP.connect(mDry).connect(this.master);
    const mWet = ctx.createGain(); mWet.gain.value = 0.55; mLP.connect(mWet).connect(this.reverb);
    this.musicTime = ctx.currentTime + 1.0;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1.1, this.ctx.currentTime, 0.3);
  }

  // ------------------------------------------------------------------ building blocks
  _noise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let last = 0, b0 = 0, b1 = 0, b2 = 0, peak = 1e-6;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last; }
        else { b0 = 0.997 * b0 + w * 0.0296; b1 = 0.985 * b1 + w * 0.0325; b2 = 0.95 * b2 + w * 0.048; d[i] = b0 + b1 + b2 + w * 0.02; }
        peak = Math.max(peak, Math.abs(d[i]));
      }
      // normalise and crossfade the loop point so the bed never clicks
      const fade = Math.floor(ctx.sampleRate * 0.25);
      for (let i = 0; i < n; i++) d[i] /= peak;
      for (let i = 0; i < fade; i++) { const a = i / fade; d[i] = d[i] * a + d[n - fade + i] * (1 - a); }
    }
    return b;
  }
  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp = lp * 0.75 + (Math.random() * 2 - 1) * 0.25; // darker tail
        d[i] = lp * Math.pow(1 - t, decay) * Math.min(1, i / (ctx.sampleRate * 0.02));
      }
    }
    return b;
  }
  _loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = true;
    s.start(this.ctx.currentTime, Math.random() * (buffer.duration - 1));
    return s;
  }
  _shot(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    return s;
  }
  _out(node, wet = 0.3, pan = 0) {
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    node.connect(p);
    p.connect(this.dry);
    if (wet > 0) { const w = this.ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.reverb); }
    return p;
  }
  // soft attack / exponential release envelope on a gain param
  _env(param, t, peak, attack, release) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(0.0001, t + attack, release / 4);
  }

  _buildWind() {
    const ctx = this.ctx;
    const src = this._loop(this.brown);
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 380; this.windLP.Q.value = 0.4;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    src.connect(this.windLP).connect(this.windG);
    this._out(this.windG, 0.1);
    // a faint breathy layer that only rises when gliding high up
    const src2 = this._loop(this.pink);
    this.airBP = ctx.createBiquadFilter(); this.airBP.type = 'bandpass'; this.airBP.frequency.value = 650; this.airBP.Q.value = 0.5;
    this.airG = ctx.createGain(); this.airG.gain.value = 0;
    src2.connect(this.airBP).connect(this.airG);
    this._out(this.airG, 0.15, 0.15);
  }
  _buildWater() {
    const ctx = this.ctx;
    const src = this._loop(this.brown);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.45;
    this.waterG = ctx.createGain(); this.waterG.gain.value = 0;
    src.connect(bp).connect(this.waterG);
    this._out(this.waterG, 0.2);
    const src2 = this._loop(this.pink);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    this.fallG = ctx.createGain(); this.fallG.gain.value = 0;
    src2.connect(lp).connect(this.fallG);
    this._out(this.fallG, 0.35);
  }

  // soft rain: a hiss of pink noise with a low patter underneath
  _buildRain() {
    const ctx = this.ctx;
    const src = this._loop(this.pink);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
    src.connect(hp).connect(lp).connect(this.rainG);
    this._out(this.rainG, 0.25);
    const src2 = this._loop(this.brown);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.6;
    this.rainLowG = ctx.createGain(); this.rainLowG.gain.value = 0;
    src2.connect(bp).connect(this.rainLowG);
    this._out(this.rainLowG, 0.2);
  }
  // the whale's wake: a deep rush of air that swells and sweeps across as it passes overhead
  whoosh(dur = 9, panFrom = -0.7, panTo = 0.7) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const s = this._shot(this.brown), bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(140, t); bp.frequency.linearRampToValueAtTime(520, t + dur * 0.5); bp.frequency.linearRampToValueAtTime(120, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    p.pan.setValueAtTime(panFrom, t); p.pan.linearRampToValueAtTime(panTo, t + dur);
    s.connect(bp).connect(g).connect(p);
    p.connect(this.dry);
    const w = ctx.createGain(); w.gain.value = 0.35; p.connect(w).connect(this.reverb);
    s.loop = true; s.start(t); s.stop(t + dur);
  }

  // distant thunder: a long, low, rolling rumble
  thunder() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const s = this._shot(this.brown), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(420, t); lp.frequency.exponentialRampToValueAtTime(90, t + 5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.25);
    g.gain.linearRampToValueAtTime(0.28, t + 1.2);
    g.gain.linearRampToValueAtTime(0.38, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    s.connect(lp).connect(g);
    this._out(g, 0.6, rand(-0.5, 0.5));
    s.start(t); s.stop(t + 6.2);
  }

  // ------------------------------------------------------------------ one-shots
  footstep(surface, strength = 0.5, dist = 8) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = Math.min(1, strength) * Math.min(1, 7 / Math.max(dist, 3)) * 0.5;
    if (vol < 0.01) return;
    const pan = rand(-0.08, 0.08);
    // a soft, low body for every step
    const s = this._shot(this.brown), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass';
    if (surface === 'stone') {
      f.frequency.value = 900;
      this._env(g.gain, t, 0.35 * vol, 0.004, 0.09);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(75, t + 0.08);
      this._env(og.gain, t, 0.12 * vol, 0.004, 0.08);
      o.connect(og); this._out(og, 0.25, pan); o.start(t); o.stop(t + 0.2);
    } else if (surface === 'water') {
      f.type = 'bandpass'; f.frequency.value = rand(500, 800); f.Q.value = 0.8;
      this._env(g.gain, t, 0.5 * vol, 0.02, 0.25);
    } else if (surface === 'path') {
      f.frequency.value = 1400;
      this._env(g.gain, t, 0.35 * vol, 0.006, 0.08);
    } else { // grass: a hushed, cushioned footfall
      f.frequency.value = 700;
      this._env(g.gain, t, 0.4 * vol, 0.012, 0.1);
    }
    s.connect(f).connect(g); this._out(g, 0.06, pan);
    s.start(t, Math.random() * 4); s.stop(t + 0.5);
  }

  jump() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._shot(this.pink), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    this._env(g.gain, t, 0.05, 0.06, 0.3);
    s.connect(f).connect(g); this._out(g, 0.2); s.start(t, Math.random() * 4); s.stop(t + 0.6);
  }

  _chime(f, t, amp, decay, wet = 0.8, pan = 0) {
    // soft music-box/celesta tone: pure fundamental, quick-fading overtones
    const ctx = this.ctx;
    for (const [r, a, d] of [[1, 1, decay], [2, 0.16, decay * 0.4], [3, 0.04, decay * 0.2], [4.2, 0.015, decay * 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * r;
      this._env(g.gain, t, amp * a, 0.006, d);
      o.connect(g); this._out(g, wet, pan); o.start(t); o.stop(t + d + 0.5);
    }
  }

  // the traveller's call: a clear, gentle tone with a soft shimmer
  call() {
    if (!this.started) return;
    const t = this.ctx.currentTime + 0.01;
    const m = pick([74, 76, 78, 81]);
    this._chime(midi(m), t, 0.09, 2.2, 1.0);
    this._chime(midi(m + 7), t + 0.12, 0.035, 1.6, 1.0);
  }

  bell() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.35;
    const f0 = midi(50); // D3, a large old bell
    for (const [r, a, d] of [[0.5, 0.05, 7], [1, 0.07, 6], [1.19, 0.035, 4], [1.5, 0.03, 3.5], [2, 0.03, 3], [2.5, 0.015, 2], [3, 0.01, 1.5]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f0 * r;
      this._env(g.gain, t, a, 0.004, d);
      o.connect(g); this._out(g, 0.9, -0.25); o.start(t); o.stop(t + d + 0.5);
    }
  }

  // deep, slow calls drifting from far away (mostly heard through the reverb)
  whaleSong(loud = 0.5, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.2;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const dur = rand(3.2, 5.0);
      const f0 = rand(95, 150), up = f0 * rand(1.25, 1.5), down = f0 * rand(0.8, 0.92);
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = rand(3.5, 5); lg.gain.value = f0 * 0.012;
      lfo.connect(lg);
      const mix = ctx.createGain();
      for (const [ratio, a] of [[1, 1], [2, 0.22], [3, 0.06]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f0 * ratio, t);
        o.frequency.exponentialRampToValueAtTime(up * ratio, t + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(down * ratio, t + dur);
        lg.connect(o.frequency);
        og.gain.value = a;
        o.connect(og).connect(mix);
        o.start(t); o.stop(t + dur + 0.1);
      }
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09 * loud, t + dur * 0.35);
      g.gain.linearRampToValueAtTime(0.07 * loud, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      mix.connect(lp).connect(g);
      const p = ctx.createStereoPanner(); p.pan.value = pan * 0.6;
      g.connect(p);
      const dry = ctx.createGain(); dry.gain.value = 0.25; p.connect(dry).connect(this.master);
      const wet = ctx.createGain(); wet.gain.value = 1.0; p.connect(wet).connect(this.reverb);
      lfo.start(t); lfo.stop(t + dur + 0.1);
      t += dur + rand(0.6, 1.8);
    }
  }

  // entering the light: a soft rising chord
  gateSwell() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const m of [62, 66, 69, 74, 78]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = midi(m);
      lfo.frequency.value = rand(4, 5.5); lg.gain.value = midi(m) * 0.004; lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025, t + 2.5); g.gain.linearRampToValueAtTime(0.0001, t + 6.5);
      o.connect(g); this._out(g, 1.0);
      for (const x of [o, lfo]) { x.start(t); x.stop(t + 6.6); }
    }
    this._chime(midi(86), t + 0.8, 0.04, 3, 1.0);
  }

  _bird(pan) {
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.05;
    const n = 2 + Math.floor(Math.random() * 3), f = rand(2000, 2900);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f * rand(0.95, 1.05), t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.1, 1.25), t + 0.07);
      this._env(g.gain, t, 0.008, 0.015, 0.07);
      o.connect(g); this._out(g, 0.35, pan); o.start(t); o.stop(t + 0.2);
      t += rand(0.1, 0.18);
    }
  }

  // a soft cricket chirp (night): a few quick pulses of a high, pure tone
  _cricket(pan, amp) {
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.02;
    const f = rand(4200, 4900), n = 3 + Math.floor(Math.random() * 3);
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f;
        this._env(g.gain, t, 0.012 * amp, 0.004, 0.025);
        o.connect(g); this._out(g, 0.5, pan); o.start(t); o.stop(t + 0.06);
        t += 0.045;
      }
      t += rand(0.18, 0.3);
    }
  }

  // ------------------------------------------------------------------ the score
  _piano(m, t, vel) {
    this._chime(midi(m), t, 0.055 * vel, 2.6, 0, 0);
  }
  _pad(m, t, dur) {
    const ctx = this.ctx, f = midi(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.0075, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 2.6);
    }
    lp.connect(g).connect(this.music);
  }
  _bass(m, t, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = midi(m);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 1.5); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + dur + 1.1);
  }
  _scheduleMusic() {
    const ctx = this.ctx;
    while (this.musicTime < ctx.currentTime + 2) {
      // the score follows the world: bright by day, warm at golden hour, sparse and low at night,
      // hushed in the rain (decided per phrase, so moods change at phrase boundaries)
      const md = this.mood || { night: 0, rain: 0, golden: 0 };
      const set = md.rain > 0.5 ? CHORDS_RAIN : md.night > 0.5 ? CHORDS_NIGHT : md.golden > 0.5 ? CHORDS_GOLDEN : CHORDS;
      const B = this.beat * (1 + 0.35 * md.night + 0.2 * md.rain + 0.12 * md.golden);
      const bar = B * 12; // one chord per phrase
      const c = set[this.chordIndex % set.length];
      const t0 = this.musicTime;
      for (const m of c.pad) this._pad(m, t0, bar);
      this._bass(c.root, t0, bar);
      // one or two gentle phrases, with breathing room
      let t = t0 + B * (1 + Math.floor(Math.random() * 2));
      const busy = 0.45 * (1 - md.night) * (1 - md.rain);
      const phrases = md.night > 0.5 && Math.random() < 0.3 ? 0 : Math.random() < 1 - busy ? 1 : 2;
      const lowOct = md.night > 0.5 && Math.random() < 0.5 ? -12 : 0;
      const vel = 1 - 0.3 * md.night - 0.2 * md.rain;
      for (let p = 0; p < phrases && t < t0 + bar - B * 3; p++) {
        const motif = pick(MOTIFS);
        const base = Math.floor(Math.random() * 2);
        for (const [step, len] of motif) {
          const idx = base + step;
          const m = PENTA[idx % 5] + 12 * Math.floor(idx / 5) + 12 + lowOct;
          const human = rand(-0.02, 0.03);
          this._piano(m, t + human, rand(0.7, 1) * vel);
          if (Math.random() < 0.2) this._piano(m - 12, t + human + 0.01, 0.35);
          t += len * B;
        }
        t += B * (2 + Math.floor(Math.random() * 3));
      }
      this.musicTime += bar;
      this.chordIndex++;
    }
  }

  // ------------------------------------------------------------------ per-frame mix
  update(dt, s) {
    if (!this.started || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    this._scheduleMusic();
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.057 + 1);
    const alt = Math.min(1, Math.max(0, (s.altitude - 20) / 80));
    const glide = s.gliding ? 1 : 0;
    this.windG.gain.setTargetAtTime(0.03 + 0.03 * gust + 0.03 * alt + 0.06 * glide, t, 0.8);
    this.windLP.frequency.setTargetAtTime(260 + 220 * gust + 200 * glide, t, 0.8);
    this.airG.gain.setTargetAtTime(0.004 * alt + 0.02 * glide, t, 0.5);
    this.waterG.gain.setTargetAtTime(0.07 * s.water, t, 0.8);
    this.fallG.gain.setTargetAtTime(0.1 * s.falls, t, 0.8);
    this.music.gain.setTargetAtTime(0.9 * (1 - 0.5 * s.veil), t, 1);

    this.nextWhale -= dt;
    if (this.nextWhale <= 0) {
      this.whaleSong(0.6, s.whalePan);
      this.nextWhale = rand(45, 75) * (1 - 0.35 * (s.night || 0));
    }
    const night = s.night || 0, rain = s.rain || 0;
    this.mood = { night, rain, golden: s.golden || 0 };
    this.rainG.gain.setTargetAtTime(0.11 * rain, t, 1.5);
    this.rainLowG.gain.setTargetAtTime(0.05 * rain, t, 1.5);
    this.nextThunder = (this.nextThunder ?? 20) - dt;
    if (this.nextThunder <= 0) { if (rain > 0.75) this.thunder(); this.nextThunder = rand(25, 60); }
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      if (s.birds && Math.random() > night * 1.4 + rain) this._bird(rand(-0.6, 0.6));
      this.nextBird = rand(6, 14);
    }
    this.nextCricket = (this.nextCricket ?? 1) - dt;
    if (this.nextCricket <= 0) {
      if (night > 0.35 && s.birds && rain < 0.3) this._cricket(rand(-0.8, 0.8), night * rand(0.5, 1));
      this.nextCricket = rand(0.6, 2.4);
    }
  }
}
