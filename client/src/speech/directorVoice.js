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

function playClip(url) {
  return new Promise((resolve, reject) => {
    const a = audioEl();
    a.onended = () => resolve();
    a.onerror = () => reject(new Error('audio error'));
    a.src = url;
    a.play().catch(reject);
  });
}

export function stopDirector() {
  try {
    el?.pause();
  } catch {
    /* ignore */
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Play lines in order. onLine(i) fires as each line starts (for captions). */
export async function playLines(lines, { onLine } = {}) {
  const clips = lines.map(fetchClip);
  for (let i = 0; i < lines.length; i++) {
    const url = await clips[i];
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
