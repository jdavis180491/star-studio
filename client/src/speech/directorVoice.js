// Plays the Director's lines: ElevenLabs audio from the server when available,
// otherwise the device voice. Audio for a batch of lines is fetched in parallel.
//
// Audio plays through an <audio> element rather than Web Audio: on iPhone/iPad the
// silent switch mutes Web Audio but not media playback, and media playback also
// stays louder after the microphone has been used.
import { speak } from './speak.js';

let el = null;
let silentUrl = null;

function audioEl() {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
  }
  return el;
}

// A tiny silent WAV, played from a tap so Safari lets us play audio later without one.
function silentWavUrl() {
  if (silentUrl) return silentUrl;
  const n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

/** Call from a tap (before any await) so the Director can talk afterwards. */
export function primeDirectorAudio() {
  try {
    const a = audioEl();
    a.src = silentWavUrl();
    a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

async function fetchClip(line) {
  try {
    const res = await fetch(`/api/director/audio/${encodeURIComponent(line.id)}`);
    if (res.status !== 200) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

// One audio player is shared by everything that talks. If a new clip starts while another is
// still playing, the old one is finished off first, so nothing is left waiting forever.
let finishPrevious = null;
function playClip(url) {
  finishPrevious?.();
  return new Promise((resolve, reject) => {
    const a = audioEl();
    const done = (fn) => (arg) => {
      if (finishPrevious === settle) finishPrevious = null;
      a.onended = null;
      a.onerror = null;
      fn(arg);
    };
    const settle = done(resolve);
    finishPrevious = settle;
    a.onended = settle;
    a.onerror = done(() => reject(new Error('audio error')));
    a.src = url;
    a.play().catch(done(reject));
  });
}

// Bumped by stopDirector(): anything queued to speak before then is dropped.
let generation = 0;

export function stopDirector() {
  generation += 1;
  finishPrevious?.();
  try {
    el?.pause();
  } catch {
    /* ignore */
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Play lines in order. onLine(i) fires as each line starts (for captions). */
export const speechGeneration = () => generation;

export async function playLines(lines, { onLine, gen = generation } = {}) {
  if (gen !== generation) return;
  const clips = lines.map(fetchClip);
  for (let i = 0; i < lines.length; i++) {
    const url = await clips[i];
    if (gen !== generation) return; // stopped (e.g. a new screen started talking)
    onLine?.(i);
    let played = false;
    if (url) {
      try {
        await playClip(url);
        played = true;
      } catch {
        played = false;
      }
      URL.revokeObjectURL(url);
    }
    if (!played) await speak(lines[i].text, { rate: 1, pitch: 1 });
  }
}
