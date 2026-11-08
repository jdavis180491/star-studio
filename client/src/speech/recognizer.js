// Speech recognition behind one small interface, so the engine can be swapped
// (e.g. to OpenAI Whisper) without touching the screens.
//
// Every recognizer has:
//   start()               begin listening (call from a tap: Safari requires it)
//   stop()                stop listening
//   on(event, callback)   returns an "unsubscribe" function. Events:
//     'transcript'  { text, isFinal, sessionId }  text = everything heard this session
//     'state'       'idle' | 'listening' | 'paused' | 'error' | 'unsupported'
//     'error'       { code }
//   static isSupported()
//
// To add Whisper later: write a WhisperRecognizer with the same methods (record short
// chunks with MediaRecorder, POST them to /api/transcribe, emit 'transcript'), then
// add it to createRecognizer() below.

class Emitter {
  constructor() {
    this.listeners = {};
  }
  on(evt, cb) {
    (this.listeners[evt] ||= new Set()).add(cb);
    return () => this.listeners[evt].delete(cb);
  }
  emit(evt, payload) {
    this.listeners[evt]?.forEach((cb) => cb(payload));
  }
}

// Safari sometimes repeats earlier results inside later ones; keep only the longest version.
function collapse(parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    const prev = out[out.length - 1];
    if (prev && p.toLowerCase().startsWith(prev.toLowerCase())) out[out.length - 1] = p;
    else if (prev && prev.toLowerCase().startsWith(p.toLowerCase())) continue;
    else out.push(p);
  }
  return out.join(' ');
}

export class BrowserRecognizer extends Emitter {
  constructor({ lang = 'en-GB' } = {}) {
    super();
    this.lang = lang;
    this.want = false;
    this.rec = null;
    this.sessionId = 0;
    this.restarts = [];
  }

  static isSupported() {
    return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start() {
    if (!BrowserRecognizer.isSupported()) {
      this.emit('state', 'unsupported');
      return;
    }
    this.want = true;
    this.restarts = [];
    if (!this.rec) this._spawn();
  }

  stop() {
    this.want = false;
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    this.emit('state', 'idle');
  }

  _spawn() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 4; // other guesses help when a child's word is misheard
    const id = ++this.sessionId;

    rec.onstart = () => {
      if (this.rec === rec) this.emit('state', 'listening');
    };
    rec.onresult = (e) => {
      const parts = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript.trim());
      const last = e.results[e.results.length - 1];
      const isFinal = last?.isFinal ?? false;
      // The same speech with the engine's other guesses for the latest part.
      const alternatives = [];
      for (let j = 1; last && j < last.length; j++) {
        const alt = last[j]?.transcript?.trim();
        if (alt) alternatives.push(collapse([...parts.slice(0, -1), alt]));
      }
      this.emit('transcript', { text: collapse(parts), isFinal, sessionId: id, alternatives });
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.want = false;
        this.emit('error', { code: e.error });
        this.emit('state', 'error');
        return;
      }
      this.emit('error', { code: e.error });
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (!this.want) {
        this.emit('state', 'idle');
        return;
      }
      // Safari stops listening after a pause; quietly start again.
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 6000);
      this.restarts.push(now);
      // Keep listening until told to stop; if Safari keeps ending quickly, just wait a moment longer.
      const wait = this.restarts.length > 4 ? 1500 : 120;
      setTimeout(() => {
        if (this.want && !this.rec) this._spawn();
      }, wait);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.rec = null;
      this.want = false;
      this.emit('state', 'paused');
    }
  }
}

import { getAudioCtx } from '../sfx.js';

// ---------------------------------------------------------------- ElevenLabs live speech-to-text
// Streams the microphone (16 kHz, 16-bit PCM) to ElevenLabs Scribe v2 Realtime with a
// single-use token from our server, and turns its partial/committed transcripts into the
// same 'transcript' events as the browser engine. Children's voices are heard far better.

const TARGET_RATE = 16000;

function toPcm16Base64(float32, inRate) {
  // Resample to 16 kHz (simple averaging) and convert to little-endian 16-bit PCM.
  const ratio = inRate / TARGET_RATE;
  const n = Math.floor(float32.length / ratio);
  const buf = new ArrayBuffer(n * 2);
  const view = new DataView(buf);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < float32.length; j++) sum += float32[j];
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class ElevenLabsRecognizer extends Emitter {
  constructor({ tokenUrl = '/api/kid/listen-token' } = {}) {
    super();
    this.tokenUrl = tokenUrl;
    this.want = false;
    this.sessionId = 0;
    this.ws = null;
    this.audio = null;
  }

  static isSupported() {
    return typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia && window.WebSocket && (window.AudioContext || window.webkitAudioContext));
  }

  /** Resolves true when listening, false if ElevenLabs isn't available (caller falls back). */
  async start() {
    this.want = true;
    const id = ++this.sessionId;
    const alive = () => this.want && id === this.sessionId;
    try {
      // Use the app's shared audio context (switched on by the child's taps; iPad needs that).
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = getAudioCtx() || (this.ownCtx ||= new Ctx());
      if (ctx.state === 'suspended') ctx.resume?.();
      // Ask for the pass and open the microphone at the same time.
      const [res, stream] = await Promise.all([
        fetch(this.tokenUrl, { method: 'POST', headers: { 'x-star-studio': '1', 'content-type': 'application/json' }, body: '{}' }),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      ]);
      if (res.status !== 200 || !alive()) {
        stream.getTracks().forEach((t) => t.stop());
        return res.status === 200 || !alive();
      }
      const { token, url, params } = await res.json();
      // Start recording straight away; chunks wait in a queue until ElevenLabs is ready,
      // so the child's first words aren't lost while connecting.
      const queue = [];
      let ws = null;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const pending = [];
      let pendingLen = 0;
      const send = (b64) => {
        const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64, commit: false, sample_rate: TARGET_RATE });
        if (ws && ws.readyState === 1 && ws.ready) ws.send(msg);
        else if (queue.length < 100) queue.push(msg); // up to ~10 s
      };
      proc.onaudioprocess = (ev) => {
        const data = ev.inputBuffer.getChannelData(0);
        pending.push(new Float32Array(data));
        pendingLen += data.length;
        if (pendingLen < ctx.sampleRate * 0.1) return;
        const all = new Float32Array(pendingLen);
        let o = 0;
        for (const p of pending) {
          all.set(p, o);
          o += p.length;
        }
        pending.length = 0;
        pendingLen = 0;
        send(toPcm16Base64(all, ctx.sampleRate));
      };
      src.connect(proc);
      proc.connect(ctx.destination);
      this.audio = { stream, src, proc };

      ws = new WebSocket(`${url}?${new URLSearchParams({ ...params, token })}`);
      this.ws = ws;
      let committed = '';
      let partial = '';
      const emit = (isFinal) => {
        const text = [committed, partial].filter(Boolean).join(' ').trim();
        this.emit('transcript', { text, isFinal, sessionId: `el-${id}`, alternatives: [] });
      };
      const opened = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 6000);
        ws.onmessage = (e) => {
          let m;
          try {
            m = JSON.parse(e.data);
          } catch {
            return;
          }
          if (m.message_type === 'session_started') {
            clearTimeout(timer);
            ws.ready = true;
            for (const msg of queue.splice(0)) ws.send(msg);
            resolve(true);
          } else if (m.message_type === 'partial_transcript') {
            partial = m.text || '';
            emit(false);
          } else if (m.message_type === 'committed_transcript') {
            committed = [committed, m.text || ''].filter(Boolean).join(' ');
            partial = '';
            emit(true);
          } else if (m.error || /error|exceeded|limited|overflow|exhausted/.test(m.message_type || '')) {
            console.warn('ElevenLabs listening:', m.message_type, m.error);
            this.emit('error', { code: m.message_type });
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
        ws.onclose = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });
      if (!opened || !alive()) {
        this._teardown();
        return !alive();
      }
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this._teardown();
        // Dropped mid-read (e.g. the 15-minute session limit): quietly start a new one.
        if (this.want) this.start().then((ok) => !ok && this.emit('fallback'));
      };
      this.emit('state', 'listening');
      return true;
    } catch (e) {
      console.warn('ElevenLabs listening unavailable:', e.message);
      this._teardown();
      return false;
    }
  }

  _teardown() {
    const a = this.audio;
    this.audio = null;
    if (a) {
      try {
        a.proc.disconnect();
        a.src.disconnect();
      } catch {
        /* ignore */
      }
      a.stream.getTracks().forEach((t) => t.stop());
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  stop() {
    this.want = false;
    this.sessionId += 1;
    this._teardown();
    this.emit('state', 'idle');
  }
}

// Tries ElevenLabs first; if it isn't available, uses the iPad's own recognition.
class AutoRecognizer extends Emitter {
  constructor({ lang = 'en-GB' } = {}) {
    super();
    this.el = ElevenLabsRecognizer.isSupported() ? new ElevenLabsRecognizer() : null;
    this.browser = BrowserRecognizer.isSupported() ? new BrowserRecognizer({ lang }) : null;
    this.active = null;
    this.useBrowser = !this.el;
    for (const r of [this.el, this.browser].filter(Boolean)) {
      r.on('transcript', (t) => this.active === r && this.emit('transcript', t));
      r.on('state', (s) => this.active === r && this.emit('state', s));
      r.on('error', (e) => this.active === r && this.emit('error', e));
    }
    this.el?.on('fallback', () => {
      this.useBrowser = true;
      if (this.active === this.el) this._startBrowser();
    });
  }

  get engine() {
    return this.active === this.el ? 'elevenlabs' : 'device';
  }

  _startBrowser() {
    if (!this.browser) {
      this.emit('state', 'unsupported');
      return;
    }
    this.active = this.browser;
    this.browser.start();
  }

  start() {
    this.wanted = true;
    if (this.useBrowser || !this.el) return this._startBrowser();
    this.active = this.el;
    this.emit('state', 'listening'); // show "listening" straight away while connecting
    this.el.start().then((ok) => {
      if (!ok && this.wanted && this.active === this.el) {
        this.useBrowser = true; // don't keep trying this session
        this._startBrowser();
      }
    });
  }

  stop() {
    this.wanted = false;
    this.el?.stop();
    this.browser?.stop();
    this.emit('state', 'idle');
  }
}

export function createRecognizer({ provider = 'auto', lang = 'en-GB' } = {}) {
  switch (provider) {
    case 'browser':
      return new BrowserRecognizer({ lang });
    case 'auto':
    default:
      return new AutoRecognizer({ lang });
  }
}

export function speechSupported() {
  return BrowserRecognizer.isSupported() || ElevenLabsRecognizer.isSupported();
}
