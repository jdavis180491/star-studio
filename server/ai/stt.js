// Hearing the children: ElevenLabs live speech-to-text (Scribe v2 Realtime).
// The API key never leaves the server: for each listening session the server asks
// ElevenLabs for a single-use token (valid 15 minutes, used once) and the iPad streams
// the microphone straight to ElevenLabs with it. If anything fails, the app falls back
// to the iPad's own speech recognition.
import { voiceEnabled } from './voice.js';

const API = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1';
export const STT_CONSENT_VERSION = 3; // parents must have accepted the Terms that mention it

export const sttEnabled = () => voiceEnabled() && process.env.ELEVENLABS_STT !== 'off';

function explain(status, body) {
  const b = String(body || '').toLowerCase();
  if (b.includes('missing_permissions') || b.includes('permission'))
    return 'The ElevenLabs key is not allowed to use speech-to-text. In ElevenLabs, edit the key and switch on "Speech to Text".';
  if (b.includes('quota') || b.includes('credits')) return 'Out of ElevenLabs credits for this month.';
  if (b.includes('unusual_activity')) return 'ElevenLabs blocked this request (its free plan often refuses cloud servers).';
  if (status === 401) return 'ElevenLabs did not accept the key. Check ELEVENLABS_API_KEY in Replit Secrets.';
  return `ElevenLabs speech-to-text error ${status}.`;
}

/** A single-use token and the WebSocket address the iPad connects to. */
export async function sttToken() {
  const res = await fetch(`${API}/single-use-token/realtime_scribe`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(explain(res.status, body));
    err.status = res.status;
    err.detail = body.slice(0, 300);
    throw err;
  }
  const { token } = await res.json();
  if (!token) throw new Error('ElevenLabs did not return a token.');
  return {
    token,
    url: `${API.replace(/^http/, 'ws')}/speech-to-text/realtime`,
    params: { model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', language_code: 'en', commit_strategy: 'vad', vad_silence_threshold_secs: '0.9' },
  };
}
