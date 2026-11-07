// Plays the Director's lines: ElevenLabs audio from the server when available,
// otherwise the device voice. Audio for a batch of lines is fetched in parallel.
import { getAudioCtx, unlockAudio } from '../sfx.js';
import { speak } from './speak.js';

async function fetchBuffer(line) {
  try {
    const res = await fetch(`/api/director/audio/${encodeURIComponent(line.id)}`);
    if (res.status !== 200) return null;
    const bytes = await res.arrayBuffer();
    unlockAudio();
    const ctx = getAudioCtx();
    return ctx ? await ctx.decodeAudioData(bytes) : null;
  } catch {
    return null;
  }
}

let current = null;

export function stopDirector() {
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** Play lines in order. onLine(i) fires as each line starts (for captions). */
export async function playLines(lines, { onLine } = {}) {
  const buffers = lines.map(fetchBuffer);
  for (let i = 0; i < lines.length; i++) {
    const buf = await buffers[i];
    onLine?.(i);
    const ctx = getAudioCtx();
    if (buf && ctx) {
      await new Promise((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.onended = resolve;
        current = src;
        src.start();
      });
    } else {
      await speak(lines[i].text, { rate: 1, pitch: 1 });
    }
  }
  current = null;
}
