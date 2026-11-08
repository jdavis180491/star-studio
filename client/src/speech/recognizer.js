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

export function createRecognizer({ provider = 'browser', lang = 'en-GB' } = {}) {
  switch (provider) {
    case 'browser':
    default:
      return new BrowserRecognizer({ lang });
  }
}

export function speechSupported() {
  return BrowserRecognizer.isSupported();
}
