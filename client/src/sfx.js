// Tiny synthesized sound effects (no audio files). Safari needs unlock() from a tap first.
let ctx = null;

export function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone({ freq = 600, to = freq, dur = 0.08, type = 'sine', vol = 0.08, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Soft tick per word; climbs in pitch as the combo grows. */
export function tick(combo = 0) {
  const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const n = steps[Math.min(combo, steps.length - 1)];
  tone({ freq: 520 * 2 ** (n / 12), dur: 0.07, type: 'triangle', vol: 0.06 });
}

export function keywordHit() {
  tone({ freq: 660, to: 990, dur: 0.12, type: 'square', vol: 0.05 });
  tone({ freq: 990, to: 1320, dur: 0.14, type: 'square', vol: 0.05, delay: 0.09 });
}

export function greenlight() {
  tone({ freq: 180, to: 1400, dur: 0.45, type: 'sawtooth', vol: 0.05 });
  [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.08, delay: 0.35 + i * 0.08 }));
}

export function coin() {
  tone({ freq: 988, dur: 0.06, type: 'square', vol: 0.05 });
  tone({ freq: 1319, dur: 0.16, type: 'square', vol: 0.05, delay: 0.06 });
}
