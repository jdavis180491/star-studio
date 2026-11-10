// Follows a child reading aloud and lights words up, karaoke style.
//
// Strict: every word must be read, in order. The next word to read stays "next" until the child
// says it. If they read on past it, it flashes red ("stuck") until they go back and say it.
// The only words we let through without hearing them are tiny ones ("a", "the", "to"…) that speech
// engines often drop even when the child said them, and only when the words either side were read.
//
// How it works:
//  - The speech engine gives a growing transcript for each listening "session" (Safari restarts
//    sessions when the child pauses). Every time it changes we re-walk it from where that session
//    began. Read words stay read, so the engine changing its mind never "un-reads" a word.

import { tokenizeBrief, spokenWords, wordsMatch, normalizeWord, isKeywordForm, levenshtein, soundKey } from './words.js';

// A child's attempt that's close to the word (the speech engine often mishears children).
function closeTry(target, spoken) {
  if (!spoken || spoken.length < 2) return false;
  if (soundKey(target) === soundKey(spoken)) return true;
  if (target[0] !== spoken[0]) return false;
  return levenshtein(target, spoken) <= Math.ceil(target.length / 2);
}

const LOOKAHEAD = 6;
export const UNLOCK_RATIO = 1;
// Only "a", "an" and "the" can be let through unheard (speech engines often swallow them), and only
// when the very next word is read. Every other word must be heard.
const FILLERS = new Set(['a', 'an', 'the']);

export class ReadingTracker {
  constructor(text, keywords = []) {
    this.tokens = tokenizeBrief(text);
    const kws = [...new Set(keywords.map(normalizeWord).filter(Boolean))];
    for (const t of this.tokens) {
      t.keyword = kws.find((k) => isKeywordForm(k, t.norm)) || null;
      t.filler = !t.keyword && FILLERS.has(t.norm);
    }
    // Only keywords that actually appear in the text are required.
    this.keywords = kws.filter((k) => this.tokens.some((t) => t.keyword === k));
    this.status = this.tokens.map(() => 'unread'); // 'unread' | 'read' | 'filled'
    this.forced = new Set(); // keywords counted via the "say it" helper
    this.cursor = 0;
    this.stuck = null; // index of a word they read past
    this.missCursor = null; // the word they're trying to say…
    this.misses = new Map(); // …and what the engine heard instead
    this.needsHelp = null; // after 3 tries, word help pops up
    this.helpedAt = null; // word help was used on this word
    this.sessionKey = null;
    this.sessionStart = 0;
    this.heard = '';
  }

  endReached() {
    return this.status.every((s) => s !== 'unread');
  }

  _skipDone(j) {
    while (j < this.tokens.length && this.status[j] !== 'unread') j += 1;
    return j;
  }

  /** Feed the full transcript of a listening session. Returns indices newly lit. */
  ingest(sessionKey, transcript) {
    if (sessionKey !== this.sessionKey) {
      this.sessionKey = sessionKey;
      this.sessionStart = this._skipDone(this.cursor);
    }
    this.heard = transcript;
    const words = spokenWords(transcript);
    const before = this.status.slice();
    // Start where this session started, so words already read in it line up again.
    let cursor = this.sessionStart;
    let stuck = null;
    let k = 0;
    const same = (i, word) =>
      i < this.tokens.length &&
      (this.tokens[i].filler ? wordsMatch(this.tokens[i].norm, word, { strict: true }) : wordsMatch(this.tokens[i].norm, word, { loose: this.tokens[i].norm.length >= 4 }));
    while (k < words.length && cursor < this.tokens.length) {
      // Going back over words already read in this same stream (live engines send the whole
      // reading every time): follow them along one by one; mishearings here are ignored.
      if (this.status[cursor] !== 'unread') {
        if (same(cursor, words[k])) {
          cursor += 1;
          k += 1;
          continue;
        }
        if (this.status[cursor + 1] !== 'unread' && same(cursor + 1, words[k])) {
          cursor += 2;
          k += 1;
          continue;
        }
        const m0 = this._match(words, k, this._skipDone(cursor));
        if (m0) {
          for (const i of m0.filled) this.status[i] = 'filled';
          for (const i of m0.read) this.status[i] = 'read';
          cursor = m0.next;
          k += m0.consumed;
          stuck = null;
        } else {
          k += 1;
        }
        continue;
      }
      const m = this._match(words, k, cursor);
      if (m) {
        for (const i of m.filled) this.status[i] = 'filled';
        for (const i of m.read) this.status[i] = 'read';
        cursor = this._skipDone(m.next);
        k += m.consumed;
        stuck = null;
      } else if (this._ahead(words[k], cursor)) {
        stuck = cursor;
        k += 1;
      } else if (this._notATry(words[k], cursor)) {
        k += 1;
      } else {
        // An attempt at the word that wasn't recognised. Two close tries count it.
        if (cursor !== this.missCursor) {
          this.missCursor = cursor;
          this.misses = new Map();
        }
        this.misses.set(`${sessionKey}:${k}`, words[k]);
        const close = [...this.misses.values()].filter((w) => closeTry(this.tokens[cursor].norm, w)).length;
        // After word help they've heard it: two clear tries count, even if the engine hears a different word.
        const afterHelp = cursor === this.helpedAt && this.misses.size >= 2;
        if ((close >= 2 || afterHelp) && !this.tokens[cursor].filler) {
          this.status[cursor] = 'read';
          cursor = this._skipDone(cursor + 1);
          stuck = null;
        }
        k += 1;
      }
    }
    // Tiny words right at the end ("…catch it!") count once the word before them is read.
    if (cursor > 0 && cursor < this.tokens.length && this.status[cursor - 1] === 'read' && this.tokens.slice(cursor).every((t) => t.filler)) {
      for (let i = cursor; i < this.tokens.length; i++) if (this.status[i] === 'unread') this.status[i] = 'filled';
      cursor = this.tokens.length;
    }
    this.cursor = cursor;
    if (this.missCursor !== null && this.missCursor !== this._skipDone(cursor)) {
      this.missCursor = null;
      this.misses = new Map();
    }
    this.needsHelp = this.missCursor !== null && this.misses.size >= 3 && this.status[this.missCursor] === 'unread' ? this.missCursor : null;
    this.stuck = stuck !== null && this.status[stuck] === 'unread' ? stuck : null;
    const lit = [];
    this.status.forEach((st, i) => {
      if (st !== 'unread' && before[i] === 'unread') lit.push(i);
    });
    return lit;
  }

  // Only the next word counts. Up to two tiny filler words before it may be skipped over.
  _match(w, k, cursor) {
    const T = this.tokens;
    const n = T.length;
    const filled = [];
    for (let j = cursor; j < n && filled.length <= 1; j++) {
      if (this.status[j] !== 'unread') continue;
      // Forgiving match: it's only ever compared with the one word we're waiting for.
      // After word help on this word, any close try at saying it counts.
      if (j === this.helpedAt && closeTry(T[j].norm, w[k])) return { read: [j], filled: [...filled], next: j + 1, consumed: 1 };
      // ("a", "an", "the" only ever match themselves: "the" must not swallow "tooth".)
      // A forgiving (not exact) match never counts if the word is exactly one further on: that's a skip.
      const exact = wordsMatch(T[j].norm, w[k], T[j].filler ? { strict: true } : {});
      const forgiving = !exact && !T[j].filler && T[j].norm.length >= 4 && wordsMatch(T[j].norm, w[k], { loose: true }) && !this._exactlyAhead(w[k], j);
      if (exact || forgiving) return { read: [j], filled: [...filled], next: j + 1, consumed: 1 };
      // Speech engine split one word in two ("sud den lee" for "suddenly")…
      if (k + 1 < w.length && wordsMatch(T[j].norm, w[k] + w[k + 1], { strict: true })) {
        return { read: [j], filled: [...filled], next: j + 1, consumed: 2 };
      }
      // …or joined two words ("everyone" for "every one").
      if (j + 1 < n && wordsMatch(T[j].norm + T[j + 1].norm, w[k], { strict: true })) {
        return { read: [j, j + 1], filled: [...filled], next: j + 2, consumed: 1 };
      }
      if (!T[j].filler) break; // a real word must be read before moving on
      filled.push(j);
    }
    return null;
  }

  // Did they say a word further on (so they've skipped the next one)?
  _ahead(word, cursor) {
    if (!word || FILLERS.has(word)) return false;
    const T = this.tokens;
    for (let j = cursor + 1; j < T.length; j++) {
      if (!T[j].filler && this.status[j] === 'unread' && wordsMatch(T[j].norm, word)) return true;
    }
    return false;
  }

  _exactlyAhead(word, j) {
    const T = this.tokens;
    for (let i = j + 1; i < Math.min(T.length, j + 1 + LOOKAHEAD); i++) {
      if (this.status[i] === 'unread' && wordsMatch(T[i].norm, word, T[i].filler ? { strict: true } : {})) return true;
    }
    return false;
  }

  // Re-reading words they've already done (or a tiny word) isn't a try at the next word.
  _notATry(word, cursor) {
    if (!word || FILLERS.has(word)) return true;
    const T = this.tokens;
    for (let j = Math.max(0, cursor - LOOKAHEAD); j < cursor; j++) if (wordsMatch(T[j].norm, word)) return true;
    return false;
  }

  /** Sentences as lists of word indices (for "I say it, you say it"). */
  sentences() {
    const out = [[]];
    this.tokens.forEach((t, i) => {
      out[out.length - 1].push(i);
      if (/[.!?]["'’”)]*$/.test(t.display) && i < this.tokens.length - 1) out.push([]);
    });
    return out.filter((s) => s.length);
  }

  /** Count a whole sentence as read (young children repeating it after the Director). */
  completeSentence(indices) {
    for (const i of indices) if (this.status[i] === 'unread') this.status[i] = 'read';
    this.cursor = this._skipDone(Math.max(this.cursor, indices[indices.length - 1] + 1));
    this.sessionKey = null;
    this.sessionStart = this.cursor;
    this.stuck = null;
  }

  /**
   * Word help on the word they're waiting on: it still has to be said, but now any close
   * try counts (they've just heard how it sounds). Help on a word further on does nothing.
   */
  helpedWith(index) {
    if (index !== this._skipDone(this.cursor) || this.status[index] !== 'unread') return false;
    this.helpedAt = index;
    this.sessionStart = this._skipDone(this.cursor);
    this.sessionKey = null;
    this.stuck = null;
    this.missCursor = null;
    this.misses = new Map();
    this.needsHelp = null;
    return true;
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
    const i = this._skipDone(this.cursor);
    return i < this.tokens.length ? i : this.status.indexOf('unread');
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
      stuck: this.stuck,
      needsHelp: this.needsHelp,
      endReached: this.endReached(),
      unlocked: progress >= UNLOCK_RATIO && keywords.every((k) => k.done) && this.endReached(),
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
