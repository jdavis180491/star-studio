// Text-to-speech with the device's own voice (free, works offline on iPad).
// Used for word help. The Director gets an ElevenLabs voice in Phase 3.

let chosen = null;

function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  chosen =
    voices.find((v) => v.lang === 'en-GB' && /Daniel|Kate|Serena|Martha|Arthur|Stephanie/i.test(v.name)) ||
    voices.find((v) => v.lang === 'en-GB') ||
    voices.find((v) => v.lang?.startsWith('en')) ||
    null;
  return chosen;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}

/** Say a list of phrases one after another. Resolves when finished. */
export function speakSequence(phrases, { rate = 0.85, pitch = 1.05 } = {}) {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined' || !phrases.length) return resolve();
    speechSynthesis.cancel();
    const voice = chosen || pickVoice();
    let remaining = phrases.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    // Safety net in case Safari never fires "end".
    const safety = setTimeout(resolve, 2500 * phrases.length + 1000);
    phrases.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'en-GB';
      u.rate = i === phrases.length - 1 ? Math.min(1, rate + 0.1) : rate;
      u.pitch = pitch;
      u.onend = () => {
        done();
        if (remaining <= 0) clearTimeout(safety);
      };
      u.onerror = u.onend;
      speechSynthesis.speak(u);
    });
  });
}

export function speak(text, opts) {
  return speakSequence([text], opts);
}
