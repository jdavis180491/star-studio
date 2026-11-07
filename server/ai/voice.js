// ElevenLabs text-to-speech for the Director. Only lines the server itself wrote can
// be voiced (by id), so nobody can use our API key to voice arbitrary text.
import crypto from 'node:crypto';

const API = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1';
// "George": a warm British voice. Parents can pick another in the dashboard.
export const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

export const voiceEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

const lines = new Map(); // id -> { text, voiceId, at }
const audioCache = new Map(); // hash -> Buffer
const MAX_LINES = 1000;
const MAX_AUDIO = 200;

export function registerLine(text, voiceId) {
  const id = crypto.randomBytes(9).toString('base64url');
  lines.set(id, { text, voiceId: voiceId || DEFAULT_VOICE, at: Date.now() });
  if (lines.size > MAX_LINES) lines.delete(lines.keys().next().value);
  return { id, text };
}

export async function lineAudio(id) {
  const line = lines.get(id);
  if (!line) return { status: 404 };
  if (!voiceEnabled()) return { status: 204 };
  const key = crypto.createHash('sha1').update(`${line.voiceId}|${MODEL}|${line.text}`).digest('hex');
  if (audioCache.has(key)) return { status: 200, audio: audioCache.get(key) };

  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(line.voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: line.text,
      model_id: MODEL,
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    console.warn('ElevenLabs error', res.status, (await res.text()).slice(0, 200));
    return { status: 502 };
  }
  const audio = Buffer.from(await res.arrayBuffer());
  audioCache.set(key, audio);
  if (audioCache.size > MAX_AUDIO) audioCache.delete(audioCache.keys().next().value);
  return { status: 200, audio };
}

export async function listVoices() {
  if (!voiceEnabled()) return [];
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const data = await res.json();
  return (data.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    accent: v.labels?.accent || '',
    description: v.labels?.description || v.labels?.descriptive || '',
    preview: v.preview_url || null,
  }));
}
