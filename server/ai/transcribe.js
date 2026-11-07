// Optional: transcribe what the child says on camera with OpenAI Whisper, so the edit can
// time captions to their words and we can reward unlock words said on camera.
// Only used when OPENAI_API_KEY is set. (Speech goes to OpenAI; covered by the parent consent.)
import fs from 'node:fs';

export const transcribeEnabled = () => Boolean(process.env.OPENAI_API_KEY);

/** Returns { text, segments: [{start, end, text}] } or null. */
export async function transcribe(audioFile) {
  if (!transcribeEnabled()) return null;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audioFile)], { type: 'audio/mpeg' }), 'clip.mp3');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data.text || '',
    segments: (data.segments || []).map((s) => ({ start: s.start, end: s.end, text: String(s.text).trim() })),
  };
}
