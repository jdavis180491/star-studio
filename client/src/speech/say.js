// Say something in the app's ElevenLabs voice (falls back to the iPad voice if it's off or fails).
// Call primeDirectorAudio() from the tap first so iPad Safari allows the audio.
import { api } from '../api.js';
import { playLines, primeDirectorAudio } from './directorVoice.js';
import { speak } from './speak.js';

export { primeDirectorAudio };

/** Say one text or a list in order. onLine(i) fires as each one starts (for highlighting). */
export async function say(texts, { onLine } = {}) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  if (!list.length) return;
  let lines = null;
  try {
    lines = (await api.post('/api/kid/say', { texts: list })).lines;
  } catch {
    lines = null;
  }
  if (lines) return playLines(lines, { onLine });
  for (let i = 0; i < list.length; i++) {
    onLine?.(i);
    await speak(list[i], { rate: 0.9 });
  }
}
