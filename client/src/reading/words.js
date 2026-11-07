// Word normalising and forgiving matching for the read-aloud check.
// Plain JS with no browser APIs, so it can be unit-tested in Node.

const NUMBER_WORDS = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen',
  14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
  19: 'nineteen', 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty',
  70: 'seventy', 80: 'eighty', 90: 'ninety', 100: 'hundred', 1000: 'thousand',
};
const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth' };

// Words a speech engine may hear "correctly" but spell differently.
const HOMOPHONE_GROUPS = [
  ['their', 'there', 'theyre'], ['to', 'too', 'two'], ['for', 'four', 'fore'],
  ['your', 'youre', 'yore'], ['its', 'it'], ['no', 'know'], ['right', 'write'],
  ['see', 'sea'], ['ate', 'eight'], ['one', 'won'], ['hear', 'here'], ['by', 'buy', 'bye'],
  ['new', 'knew'], ['so', 'sew'], ['would', 'wood'], ['whole', 'hole'], ['bear', 'bare'],
  ['flower', 'flour'], ['tail', 'tale'], ['night', 'knight'], ['sock', 'sox'],
  ['socks', 'sox'], ['ok', 'okay'], ['mum', 'mom', 'mam'], ['grey', 'gray'],
  ['colour', 'color'], ['favourite', 'favorite'], ['teddy', 'teddie'], ['oh', 'o'],
  ['weight', 'wait'], ['week', 'weak'], ['which', 'witch'], ['where', 'wear', 'ware'],
  ['blue', 'blew'], ['red', 'read'], ['made', 'maid'], ['road', 'rode'], ['meet', 'meat'],
  ['our', 'are', 'hour'], ['and', 'an', 'n'], ['a', 'uh', 'the'], ['the', 'thee', 'da'],
];
const HOMOPHONES = new Map();
for (const group of HOMOPHONE_GROUPS) {
  for (const w of group) {
    if (!HOMOPHONES.has(w)) HOMOPHONES.set(w, new Set());
    for (const other of group) HOMOPHONES.get(w).add(other);
  }
}

export function normalizeWord(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase().replace(/[’‘`]/g, "'");
  if (ORDINALS[s.replace(/[^a-z0-9]/g, '')]) return ORDINALS[s.replace(/[^a-z0-9]/g, '')];
  s = s.replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(s) && NUMBER_WORDS[Number(s)]) return NUMBER_WORDS[Number(s)];
  return s;
}

/**
 * Split a brief into display tokens. Hyphenated words become two tokens
 * because speech engines hear them as two words.
 * Returns [{ index, display, norm }]
 */
export function tokenizeBrief(text) {
  const tokens = [];
  const pieces = String(text).split(/\s+/).filter(Boolean);
  for (const piece of pieces) {
    const parts = piece.split(/(?<=[A-Za-z])[-–—](?=[A-Za-z])/);
    parts.forEach((part, i) => {
      const display = i < parts.length - 1 ? `${part}-` : part;
      const norm = normalizeWord(part);
      if (!norm) {
        // Stray punctuation: glue it onto the previous word.
        if (tokens.length) tokens[tokens.length - 1].display += ` ${display}`;
        return;
      }
      tokens.push({ index: tokens.length, display, norm });
    });
  }
  return tokens;
}

export function spokenWords(transcript) {
  return String(transcript || '')
    .split(/[\s\-–—]+/)
    .map(normalizeWord)
    .filter(Boolean);
}

export function stem(w) {
  if (w.length <= 3) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('es') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.endsWith('e') && s.length > 3) s = s.slice(0, -1);
  // "swimming" -> "swimm" -> "swim"
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1);
  return s;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// A rough "sounds like" key: spelling quirks folded together, inner vowels dropped.
export function soundKey(w) {
  let s = w
    .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w').replace(/^ps/, 's')
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/tch/g, 'ch').replace(/dge/g, 'j')
    .replace(/gh/g, '').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k')
    .replace(/x/g, 'ks').replace(/z/g, 's');
  const first = s[0] || '';
  s = first + s.slice(1).replace(/[aeiouy]/g, '');
  return s.replace(/(.)\1+/g, '$1');
}

/**
 * Is `spoken` close enough to `target` to count as reading it?
 * Forgiving by design: children's voices are often mis-heard by speech engines.
 * opts.strict: only exact/stem/homophone matches (used for joined-word checks)
 * opts.loose: extra forgiving (used when a child is practising one single word)
 */
export function wordsMatch(target, spoken, opts = {}) {
  if (!target || !spoken) return false;
  if (target === spoken) return true;
  if (HOMOPHONES.get(target)?.has(spoken)) return true;
  const st = stem(target);
  const ss = stem(spoken);
  if (st === ss) return true;
  if (opts.strict) return false;

  const len = Math.max(target.length, spoken.length);
  const dist = levenshtein(target, spoken);
  if (len >= 4 && dist <= 1) return true;
  if (len >= 7 && dist <= 2) return true;
  if (len >= 4 && target[0] === spoken[0] && soundKey(target) === soundKey(spoken)) return true;

  if (opts.loose) {
    if (len >= 3 && target[0] === spoken[0] && dist <= Math.ceil(len / 3)) return true;
    if (soundKey(target) === soundKey(spoken)) return true;
    if (spoken.length >= 4 && (spoken.includes(target) || target.includes(spoken))) return true;
  }
  return false;
}

/** Does this brief word belong to the keyword's family (float / floats / floating)? */
export function isKeywordForm(keyword, norm) {
  return keyword === norm || stem(keyword) === stem(norm);
}
