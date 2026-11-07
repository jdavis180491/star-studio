// Follows a child reading a brief aloud and lights words up, karaoke style.
//
// How it works:
//  - The speech engine gives us a growing transcript for each listening "session"
//    (Safari restarts sessions whenever the child pauses).
//  - Every time the transcript changes we re-walk it from where that session began,
//    lining spoken words up with the brief's words. Lit words stay lit, so a
//    speech engine changing its mind never "un-reads" a word.
//  - Small skips are allowed. Bigger jumps (skipping a line, going back to re-read)
//    need three words in a row to agree, so stray noise can't light up random words.
//  - Tiny words like "a" / "the" that speech engines often drop are filled in
//    when the words either side were read.

import { tokenizeBrief, spokenWords, wordsMatch, normalizeWord, isKeywordForm } from './words.js';

const LOOKAHEAD = 5;
const SHORT_WORD = 3;
export const UNLOCK_RATIO = 0.8;

export class ReadingTracker {
  constructor(text, keywords = []) {
    this.tokens = tokenizeBrief(text);
    const kws = [...new Set(keywords.map(normalizeWord).filter(Boolean))];
    for (const t of this.tokens) t.keyword = kws.find((k) => isKeywordForm(k, t.norm)) || null;
    // Only keywords that actually appear in the brief are required.
    this.keywords = kws.filter((k) => this.tokens.some((t) => t.keyword === k));
    this.status = this.tokens.map(() => 'unread'); // 'unread' | 'read' | 'filled'
    this.forced = new Set(); // keywords counted via the "say it" helper
    this.cursor = 0;
    this.sessionKey = null;
    this.sessionStart = 0;
    this.heard = '';
  }

  /** Feed the full transcript of a listening session. Returns indices newly lit. */
  ingest(sessionKey, transcript) {
    if (sessionKey !== this.sessionKey) {
      this.sessionKey = sessionKey;
      this.sessionStart = this.cursor;
    }
    this.heard = transcript;
    const words = spokenWords(transcript);
    const before = this.status.slice();
    let cursor = this.sessionStart;
    let k = 0;
    while (k < words.length) {
      const m = this._find(words, k, cursor);
      if (m) {
        for (const i of m.indices) this.status[i] = 'read';
        cursor = m.next;
        k += m.consumed;
      } else {
        k += 1;
      }
    }
    this.cursor = cursor;
    this._fillGaps();
    const lit = [];
    this.status.forEach((s, i) => {
      if (s !== 'unread' && before[i] === 'unread') lit.push(i);
    });
    return lit;
  }

  _find(w, k, cursor) {
    const T = this.tokens;
    const n = T.length;
    for (let off = 0; off <= LOOKAHEAD; off++) {
      const j = cursor + off;
      if (j >= n) break;
      if (wordsMatch(T[j].norm, w[k])) {
        const confirmed =
          off <= 1 || j === n - 1 || (k + 1 < w.length && wordsMatch(T[j + 1].norm, w[k + 1]));
        if (confirmed) return { indices: [j], next: j + 1, consumed: 1 };
      }
      // Speech engine split one word in two ("sud den lee" for "suddenly").
      if (k + 1 < w.length && wordsMatch(T[j].norm, w[k] + w[k + 1], { strict: true })) {
        return { indices: [j], next: j + 1, consumed: 2 };
      }
      // ...or joined two words ("everyone" for "every one").
      if (j + 1 < n && wordsMatch(T[j].norm + T[j + 1].norm, w[k], { strict: true })) {
        return { indices: [j, j + 1], next: j + 2, consumed: 1 };
      }
    }
    // Big jump (skipped ahead, or went back to re-read): three words in a row must agree.
    if (k + 2 < w.length) {
      let best = -1;
      let bestDist = Infinity;
      for (let j = 0; j + 2 < n; j++) {
        if (
          wordsMatch(T[j].norm, w[k]) &&
          wordsMatch(T[j + 1].norm, w[k + 1]) &&
          wordsMatch(T[j + 2].norm, w[k + 2])
        ) {
          const d = Math.abs(j - cursor);
          if (d < bestDist) {
            best = j;
            bestDist = d;
          }
        }
      }
      if (best >= 0) return { indices: [best, best + 1, best + 2], next: best + 3, consumed: 3 };
    }
    return null;
  }

  _fillGaps() {
    const T = this.tokens;
    const n = T.length;
    const fillable = (i) => this.status[i] === 'unread' && !T[i].keyword && T[i].norm.length <= SHORT_WORD;
    let i = 0;
    while (i < n) {
      if (!fillable(i)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < n && fillable(j)) j += 1;
      const leftOk = i === 0 || this.status[i - 1] !== 'unread';
      const rightOk = j === n || this.status[j] !== 'unread';
      const hasNeighbour = (i > 0 && this.status[i - 1] !== 'unread') || (j < n && this.status[j] !== 'unread');
      if (j - i <= 2 && leftOk && rightOk && hasNeighbour) {
        for (let x = i; x < j; x++) this.status[x] = 'filled';
      }
      i = j;
    }
  }

  /** Count a keyword as read (used by the one-word "say it" helper). */
  forceKeyword(keyword) {
    const k = normalizeWord(keyword);
    this.forced.add(k);
    this.tokens.forEach((t, i) => {
      if (t.keyword === k && this.status[i] === 'unread') this.status[i] = 'read';
    });
  }

  keywordDone(k) {
    return this.forced.has(k) || this.tokens.some((t, i) => t.keyword === k && this.status[i] === 'read');
  }

  /** The next word we expect, for the bouncing "you are here" marker. */
  nextIndex() {
    for (let i = this.cursor; i < this.tokens.length; i++) if (this.status[i] === 'unread') return i;
    return this.status.indexOf('unread');
  }

  snapshot() {
    const total = this.tokens.length || 1;
    const readCount = this.status.filter((s) => s !== 'unread').length;
    const progress = readCount / total;
    const keywords = this.keywords.map((k) => ({ word: k, done: this.keywordDone(k) }));
    return {
      status: this.status.slice(),
      progress,
      readCount,
      total: this.tokens.length,
      keywords,
      nextIndex: this.nextIndex(),
      unlocked: progress >= UNLOCK_RATIO && keywords.every((k) => k.done),
      heard: this.heard,
    };
  }
}

/** Did the child say this one word? (forgiving, for the single-word helper) */
export function heardWord(target, transcript) {
  const t = normalizeWord(target);
  const words = spokenWords(transcript);
  for (let i = 0; i < words.length; i++) {
    if (wordsMatch(t, words[i], { loose: true })) return true;
    if (i + 1 < words.length && wordsMatch(t, words[i] + words[i + 1], { loose: true })) return true;
  }
  return false;
}
