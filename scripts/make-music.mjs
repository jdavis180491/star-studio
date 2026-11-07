// Generates Star Studio's original, royalty-free music loops (no samples, pure synthesis).
// Run: node scripts/make-music.mjs  →  client/public/music/<style>.mp3
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const SR = 44100;
const OUT = path.join(process.cwd(), 'client', 'public', 'music');
fs.mkdirSync(OUT, { recursive: true });

// Deterministic randomness so the loops are the same every build.
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function track(seconds) {
  const L = new Float32Array(Math.ceil(seconds * SR));
  const R = new Float32Array(L.length);
  const rev = new Float32Array(L.length); // reverb send
  return { L, R, rev, len: L.length };
}

const osc = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  tri: (p) => 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5),
  saw: (p) => 2 * (p % 1) - 1,
  square: (p) => ((p % 1) < 0.5 ? 1 : -1),
};

/** Add a note. opts: wave, vol, a, d, s, r, pan, cutoff (0-1 lowpass), vib, detune, rev */
function note(t, start, dur, freq, o = {}) {
  const { wave = 'sine', vol = 0.2, a = 0.005, d = 0.1, s = 0.7, r = 0.1, pan = 0, cutoff = 1, vib = 0, detune = 0, rev = 0, glide = 0 } = o;
  const i0 = Math.floor(start * SR);
  const n = Math.floor((dur + r) * SR);
  let ph = 0, ph2 = 0, lp = 0;
  const gl = 0.5 - pan / 2, gr = 0.5 + pan / 2;
  for (let i = 0; i < n && i0 + i < t.len; i++) {
    const time = i / SR;
    let env;
    if (time < a) env = time / a;
    else if (time < a + d) env = 1 - (1 - s) * ((time - a) / d);
    else if (time < dur) env = s;
    else env = s * Math.max(0, 1 - (time - dur) / r);
    const f = freq * (glide ? 1 + glide * Math.max(0, 1 - time * 8) : 1) * (1 + vib * Math.sin(2 * Math.PI * 5.5 * time));
    ph += f / SR;
    ph2 += (f * (1 + detune)) / SR;
    let x = osc[wave](ph);
    if (detune) x = (x + osc[wave](ph2)) / 2;
    lp += cutoff * (x - lp);
    const y = lp * env * vol;
    t.L[i0 + i] += y * gl * 2;
    t.R[i0 + i] += y * gr * 2;
    if (rev) t.rev[i0 + i] += y * rev;
  }
}

function kick(t, start, vol = 0.9) {
  const i0 = Math.floor(start * SR);
  let ph = 0;
  for (let i = 0; i < 0.35 * SR && i0 + i < t.len; i++) {
    const time = i / SR;
    const f = 45 + 110 * Math.exp(-time * 30);
    ph += f / SR;
    const y = Math.sin(2 * Math.PI * ph) * Math.exp(-time * 9) * vol;
    t.L[i0 + i] += y;
    t.R[i0 + i] += y;
  }
}

function noiseHit(t, start, { len = 0.15, vol = 0.4, decay = 25, hp = true, tone = 0, pan = 0, rev = 0 } = {}) {
  const i0 = Math.floor(start * SR);
  let prev = 0, ph = 0;
  for (let i = 0; i < len * SR && i0 + i < t.len; i++) {
    const time = i / SR;
    const w = rnd() * 2 - 1;
    let x = hp ? w - prev : w;
    prev = w;
    if (tone) {
      ph += tone / SR;
      x = x * 0.6 + Math.sin(2 * Math.PI * ph) * 0.6;
    }
    const y = x * Math.exp(-time * decay) * vol;
    t.L[i0 + i] += y * (0.5 - pan / 2) * 2;
    t.R[i0 + i] += y * (0.5 + pan / 2) * 2;
    if (rev) t.rev[i0 + i] += y * rev;
  }
}

const snare = (t, s, vol = 0.45) => noiseHit(t, s, { len: 0.22, vol, decay: 18, tone: 190, rev: 0.25 });
const hat = (t, s, vol = 0.12, open = false) => noiseHit(t, s, { len: open ? 0.25 : 0.05, vol, decay: open ? 12 : 60, pan: 0.2 });
const clap = (t, s, vol = 0.35) => [0, 0.012, 0.024].forEach((o) => noiseHit(t, s + o, { len: 0.12, vol, decay: 30, rev: 0.3 }));

function reverb(t, mix = 0.25) {
  // Small Schroeder reverb (parallel combs + allpass) on the send bus.
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  let out = new Float32Array(t.len);
  for (let n = 0; n < t.len; n++) {
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.buf[c.i] = t.rev[n] + y * 0.82;
      c.i = (c.i + 1) % c.d;
      acc += y;
    }
    out[n] = acc / combs.length;
  }
  for (const d of [225, 556]) {
    const buf = new Float32Array(d);
    let i = 0;
    const o2 = new Float32Array(t.len);
    for (let n = 0; n < t.len; n++) {
      const b = buf[i];
      const y = -out[n] + b;
      buf[i] = out[n] + b * 0.5;
      i = (i + 1) % d;
      o2[n] = y;
    }
    out = o2;
  }
  for (let n = 0; n < t.len; n++) {
    t.L[n] += out[n] * mix;
    t.R[n] += out[(n + 300) % t.len] * mix;
  }
}

function writeMp3(t, name) {
  let peak = 0;
  for (let n = 0; n < t.len; n++) {
    t.L[n] = Math.tanh(t.L[n] * 1.2);
    t.R[n] = Math.tanh(t.R[n] * 1.2);
    peak = Math.max(peak, Math.abs(t.L[n]), Math.abs(t.R[n]));
  }
  const g = 0.89 / (peak || 1);
  // Short fades so the loop restarts without a click.
  const fade = Math.floor(0.01 * SR);
  for (let n = 0; n < fade; n++) {
    const k = n / fade;
    t.L[n] *= k; t.R[n] *= k;
    t.L[t.len - 1 - n] *= k; t.R[t.len - 1 - n] *= k;
  }
  const data = Buffer.alloc(t.len * 4);
  for (let n = 0; n < t.len; n++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, t.L[n] * g)) * 32767), n * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, t.R[n] * g)) * 32767), n * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  const wav = path.join(os.tmpdir(), `${name}.wav`);
  fs.writeFileSync(wav, Buffer.concat([head, data]));
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(OUT, `${name}.mp3`)]);
  fs.rmSync(wav);
  console.log('♪', name);
}

// chord helper: root midi + intervals
const chord = (root, q) => ({ maj: [0, 4, 7], min: [0, 3, 7], sus: [0, 5, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], pow: [0, 7, 12] }[q].map((x) => root + x));

function pop() {
  const bpm = 118, beat = 60 / bpm, bars = 16, t = track(bars * 4 * beat);
  const prog = [[60, 'maj'], [67, 'maj'], [69, 'min'], [65, 'maj']];
  for (let b = 0; b < bars; b++) {
    const [root, q] = prog[b % 4];
    const bt = b * 4 * beat;
    for (let i = 0; i < 4; i++) {
      kick(t, bt + i * beat);
      hat(t, bt + i * beat + beat / 2, 0.1);
      if (i % 2 === 1) clap(t, bt + i * beat);
    }
    chord(root, q).forEach((m, k) => note(t, bt, 4 * beat * 0.95, mtof(m), { wave: 'saw', vol: 0.05, a: 0.02, s: 0.6, r: 0.3, cutoff: 0.08, detune: 0.004, pan: k - 1, rev: 0.4 }));
    for (let i = 0; i < 8; i++) note(t, bt + i * beat / 2, beat / 2 * 0.8, mtof(root - 24 + (i % 4 === 3 ? 7 : 0)), { wave: 'square', vol: 0.12, cutoff: 0.06, s: 0.5, r: 0.05 });
    const arp = chord(root + 12, q);
    for (let i = 0; i < 16; i++) note(t, bt + i * beat / 4, beat / 4 * 0.7, mtof(arp[i % 3] + (i % 6 === 5 ? 12 : 0)), { wave: 'tri', vol: 0.06, s: 0.3, r: 0.08, pan: (i % 2 ? 0.4 : -0.4), rev: 0.3 });
  }
  reverb(t, 0.3);
  return t;
}

function rock() {
  const bpm = 132, beat = 60 / bpm, bars = 16, t = track(bars * 4 * beat);
  const prog = [40, 40, 43, 45, 40, 40, 48, 47];
  for (let b = 0; b < bars; b++) {
    const root = prog[b % 8];
    const bt = b * 4 * beat;
    for (let i = 0; i < 8; i++) {
      const tt = bt + i * beat / 2;
      if (i === 0 || i === 3 || i === 4) kick(t, tt, 1);
      if (i === 2 || i === 6) snare(t, tt, 0.5);
      hat(t, tt, 0.09, i === 7);
      chord(root, 'pow').forEach((m) => note(t, tt, beat / 2 * 0.85, mtof(m), { wave: 'square', vol: 0.09, cutoff: 0.15, s: 0.8, r: 0.03, detune: 0.006 }));
      note(t, tt, beat / 2 * 0.8, mtof(root - 12), { wave: 'saw', vol: 0.12, cutoff: 0.05, r: 0.03 });
    }
    if (b % 4 === 3) note(t, bt + 2 * beat, 2 * beat, mtof(root + 24), { wave: 'saw', vol: 0.06, vib: 0.01, cutoff: 0.2, rev: 0.5 });
  }
  reverb(t, 0.2);
  return t;
}

function orchestra() {
  const bpm = 92, beat = 60 / bpm, bars = 12, t = track(bars * 4 * beat);
  const prog = [[57, 'min'], [53, 'maj'], [48, 'maj'], [55, 'maj']];
  const melody = [69, 72, 76, 74, 72, 71, 72, 64];
  for (let b = 0; b < bars; b++) {
    const [root, q] = prog[b % 4];
    const bt = b * 4 * beat;
    chord(root, q).concat([root - 12]).forEach((m, k) => note(t, bt, 4 * beat, mtof(m), { wave: 'saw', vol: 0.045, a: 0.6, s: 0.9, r: 0.8, cutoff: 0.05, vib: 0.004, detune: 0.003, pan: (k - 1.5) / 2, rev: 0.7 }));
    noiseHit(t, bt, { len: 0.6, vol: 0.25, decay: 6, hp: false, tone: 70, rev: 0.6 });
    if (b % 2 === 1) noiseHit(t, bt + 3.5 * beat, { len: 0.4, vol: 0.18, decay: 8, hp: false, tone: 70, rev: 0.6 });
    if (b >= 4) {
      for (let i = 0; i < 2; i++) note(t, bt + i * 2 * beat, 2 * beat * 0.95, mtof(melody[(b * 2 + i) % 8]), { wave: 'saw', vol: 0.06, a: 0.08, s: 0.8, r: 0.3, cutoff: 0.12, vib: 0.006, rev: 0.6 });
    }
    for (let i = 0; i < 8; i++) note(t, bt + i * beat / 2, beat / 2 * 0.5, mtof(root - 12), { wave: 'tri', vol: 0.08, s: 0.4, r: 0.05 });
  }
  reverb(t, 0.45);
  return t;
}

function spooky() {
  const bpm = 84, beat = 60 / bpm, bars = 12, t = track(bars * 4 * beat);
  const prog = [[45, 'min'], [46, 'maj'], [45, 'min'], [41, 'maj']];
  const theremin = [81, 80, 77, 76, 81, 84, 83, 77];
  for (let b = 0; b < bars; b++) {
    const [root, q] = prog[b % 4];
    const bt = b * 4 * beat;
    note(t, bt, 4 * beat, mtof(root - 12), { wave: 'saw', vol: 0.08, a: 0.5, s: 1, r: 0.5, cutoff: 0.03, detune: 0.01 });
    chord(root + 12, q).forEach((m) => note(t, bt, 4 * beat, mtof(m), { wave: 'tri', vol: 0.04, a: 1, s: 0.8, r: 1, vib: 0.01, rev: 0.7 }));
    kick(t, bt, 0.7);
    kick(t, bt + 2.5 * beat, 0.5);
    for (let i = 0; i < 4; i++) note(t, bt + i * beat + beat / 2, 0.1, mtof(96 + (i % 2) * 3), { wave: 'sine', vol: 0.035, s: 0.2, r: 0.4, rev: 0.8, pan: i % 2 ? 0.6 : -0.6 });
    note(t, bt + beat, 2.5 * beat, mtof(theremin[b % 8]), { wave: 'sine', vol: 0.07, a: 0.3, s: 0.9, r: 0.6, vib: 0.02, glide: -0.05, rev: 0.6 });
  }
  reverb(t, 0.5);
  return t;
}

function funky() {
  const bpm = 104, beat = 60 / bpm, bars = 16, t = track(bars * 4 * beat);
  const prog = [[52, 'min7'], [57, 'min7'], [52, 'min7'], [55, 'maj7']];
  const bassline = [0, null, 0, 12, null, 10, 7, null, 0, null, 3, null, 5, 7, null, 10];
  const swing = (i) => (i % 2 ? beat / 4 * 1.25 : 0);
  for (let b = 0; b < bars; b++) {
    const [root, q] = prog[b % 4];
    const bt = b * 4 * beat;
    for (let i = 0; i < 16; i++) {
      const tt = bt + Math.floor(i / 2) * beat / 2 + swing(i);
      if (i === 0 || i === 7 || i === 10) kick(t, bt + i * beat / 4);
      if (i === 4 || i === 12) snare(t, bt + i * beat / 4, 0.45);
      hat(t, tt, i % 4 === 2 ? 0.12 : 0.07, i === 14);
      if (bassline[i] !== null) note(t, bt + i * beat / 4, beat / 4 * 0.9, mtof(root - 24 + bassline[i]), { wave: 'saw', vol: 0.14, cutoff: 0.08, s: 0.6, r: 0.03 });
      if (i === 2 || i === 6 || i === 11 || i === 14) chord(root, q).forEach((m, k) => note(t, bt + i * beat / 4, 0.09, mtof(m), { wave: 'square', vol: 0.035, cutoff: 0.35, s: 0.3, r: 0.04, pan: (k - 1.5) / 3 }));
    }
    if (b % 2 === 1) note(t, bt + 3 * beat, beat, mtof(root + 24 + 7), { wave: 'saw', vol: 0.05, cutoff: 0.25, vib: 0.008, rev: 0.4 });
  }
  reverb(t, 0.2);
  return t;
}

function chill() {
  const bpm = 78, beat = 60 / bpm, bars = 12, t = track(bars * 4 * beat);
  const prog = [[62, 'maj7'], [64, 'min7'], [57, 'min7'], [60, 'maj7']];
  for (let b = 0; b < bars; b++) {
    const [root, q] = prog[b % 4];
    const bt = b * 4 * beat;
    kick(t, bt, 0.6);
    kick(t, bt + 2.75 * beat, 0.45);
    snare(t, bt + beat, 0.25);
    snare(t, bt + 3 * beat, 0.25);
    for (let i = 0; i < 8; i++) hat(t, bt + i * beat / 2 + (i % 2 ? 0.04 : 0), 0.05);
    chord(root, q).forEach((m, k) => {
      note(t, bt, 2 * beat * 0.95, mtof(m), { wave: 'sine', vol: 0.06, a: 0.01, d: 0.6, s: 0.4, r: 0.4, vib: 0.002, pan: (k - 1.5) / 3, rev: 0.5 });
      note(t, bt + 2.5 * beat, 1.4 * beat, mtof(m), { wave: 'sine', vol: 0.045, a: 0.01, d: 0.6, s: 0.4, r: 0.4, pan: (k - 1.5) / 3, rev: 0.5 });
    });
    note(t, bt, 3 * beat, mtof(root - 24), { wave: 'sine', vol: 0.16, s: 0.7, r: 0.2 });
  }
  // gentle vinyl crackle
  for (let n = 0; n < t.len; n += 1 + Math.floor(rnd() * 3000)) {
    const v = (rnd() - 0.5) * 0.08;
    t.L[n] += v;
    t.R[n] += v;
  }
  reverb(t, 0.35);
  return t;
}

for (const [name, fn] of Object.entries({ pop, rock, orchestra, spooky, funky, chill })) {
  seed = 7 + name.length;
  writeMp3(fn(), name);
}
