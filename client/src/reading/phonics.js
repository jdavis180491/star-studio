// Breaks a word into chunks a child can sound out, e.g. "monster" -> ["mon", "ster"],
// "float" -> ["fl", "oat"]. A heuristic, not a dictionary: briefs can supply
// hand-made chunks for tricky words, which always win.

const DIGRAPHS = ['ch', 'sh', 'th', 'wh', 'ph', 'ck', 'ng', 'gh'];
const KEEP_LEFT = new Set(['ck', 'ng', 'x']); // these stay with the syllable before
const BLENDS = new Set([
  'st', 'sp', 'sk', 'sc', 'sm', 'sn', 'sw', 'tr', 'dr', 'br', 'cr', 'fr', 'gr', 'pr',
  'bl', 'cl', 'fl', 'gl', 'pl', 'sl', 'tw', 'str', 'spr', 'scr', 'thr', 'shr',
]);

function isVowel(w, i) {
  const c = w[i];
  if ('aeiou'.includes(c)) return !(c === 'u' && w[i - 1] === 'q');
  if (c === 'y') return i > 0 && !'aeiou'.includes(w[i - 1]);
  return false;
}

function vowelGroups(w) {
  const groups = [];
  let i = 0;
  while (i < w.length) {
    if (isVowel(w, i)) {
      let j = i;
      while (j + 1 < w.length && isVowel(w, j + 1)) j += 1;
      groups.push({ start: i, end: j });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return groups;
}

function onsetRime(w, group) {
  if (!group || group.start === 0) return [w];
  return [w.slice(0, group.start), w.slice(group.start)];
}

export function chunkWord(word, overrides) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (overrides && overrides[w]) return overrides[w];
  if (w.length <= 2) return [w];

  const groups = vowelGroups(w);
  const last = groups[groups.length - 1];
  const n = w.length;

  if (groups.length > 1 && last.start === n - 1 && w[n - 1] === 'e' && !isVowel(w, n - 2)) {
    if (w.endsWith('le') && n > 3 && !isVowel(w, n - 3)) last.consonantLe = true; // ta-ble
    else groups.pop(); // silent e: make, cause
  }
  if (groups.length > 1 && w.endsWith('ed') && last.start === n - 2 && !/[td]/.test(w[n - 3])) {
    groups.pop(); // jumped, played
  }
  if (groups.length <= 1) return onsetRime(w, groups[0]);

  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const a = groups[g].end + 1;
    const b = groups[g + 1].start;
    const cl = w.slice(a, b);
    let cut;
    if (groups[g + 1].consonantLe) cut = cl.endsWith('ckl') || cl.length < 2 ? b - 1 : b - 2;
    else if (cl.length === 0) cut = a;
    else if (cl.length === 1) cut = cl === 'x' ? b : a; // ro-bot, tax-i
    else if (cl.length === 2 && DIGRAPHS.includes(cl)) cut = KEEP_LEFT.has(cl) ? b : a; // rock-et, mo-ther
    else if (cl.length >= 3 && BLENDS.has(cl.slice(-3))) cut = b - 3;
    else if (cl.length >= 3 && (BLENDS.has(cl.slice(-2)) || DIGRAPHS.includes(cl.slice(-2)))) cut = b - 2; // mon-ster
    else if (KEEP_LEFT.has(cl.slice(0, 2))) cut = a + 2;
    else cut = a + 1; // whis-per, bas-ket
    cuts.push(cut);
  }
  const chunks = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev && c < n) {
      chunks.push(w.slice(prev, c));
      prev = c;
    }
  }
  chunks.push(w.slice(prev));
  return chunks.filter(Boolean);
}

// How to *say* a chunk with no vowel in it (a speech voice would otherwise spell it out).
const SOUNDS = {
  b: 'buh', c: 'kuh', k: 'kuh', d: 'duh', f: 'fff', g: 'guh', h: 'huh', j: 'juh', l: 'lll',
  m: 'mmm', n: 'nnn', p: 'puh', r: 'rrr', s: 'sss', t: 'tuh', v: 'vvv', w: 'wuh', y: 'yuh',
  z: 'zzz', x: 'ks', qu: 'kwuh', sh: 'shhh', ch: 'chuh', th: 'thh', wh: 'wuh', ph: 'fff',
};

export function speakableChunk(chunk) {
  if (/[aeiouy]/.test(chunk)) return chunk;
  if (SOUNDS[chunk]) return SOUNDS[chunk];
  return chunk.split('').map((c) => SOUNDS[c] || c).join(', ');
}
