import React, { useMemo, useRef, useState } from 'react';
import { say, primeDirectorAudio } from '../speech/say.js';
import { normalizeWord, isKeywordForm, levenshtein } from '../reading/words.js';
import { unlockAudio, tick, wrong, greenlight } from '../sfx.js';

export const EFFECTS = [
  { id: 'lightning', name: 'LIGHTNING', icon: '⚡' },
  { id: 'glitch', name: 'GLITCH', icon: '📺' },
  { id: 'neon', name: 'NEON GLOW', icon: '💡' },
  { id: 'confetti', name: 'CONFETTI BLAST', icon: '🎉' },
  { id: 'slowmo', name: 'SLOW-MO', icon: '🐌' },
  { id: 'vhs', name: 'RETRO VHS', icon: '📼' },
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Pick which word moment to play (Little Stars always spell; others 50/50). */
export function planWordMoment(brief) {
  const words = brief.keywords.map(normalizeWord).filter(Boolean);
  const word = words[rand(words.length)] || 'star';
  const little = brief.ageGroup === 'little';
  const mode = little || Math.random() < 0.5 ? 'spell' : 'title';
  return { mode, word, effect: EFFECTS[rand(EFFECTS.length)] };
}

export default function WordMoment({ brief, moment, onDone }) {
  return moment.mode === 'spell' ? (
    <SpellTiles word={moment.word} effect={moment.effect} little={brief.ageGroup === 'little'} onDone={onDone} />
  ) : (
    <TitleIt brief={brief} onDone={onDone} />
  );
}

function SpellTiles({ word, effect, little, onDone }) {
  const letters = word.split('');
  const tiles = useMemo(() => {
    const extra = [];
    const pool = ALPHABET.split('').filter((c) => !letters.includes(c));
    for (let i = 0; i < (little ? 1 : 2); i++) extra.push(pool[rand(pool.length)]);
    return shuffle([...letters, ...extra]).map((ch, i) => ({ ch, id: i }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);
  const [used, setUsed] = useState(() => new Set());
  const [filled, setFilled] = useState(0);
  const [shake, setShake] = useState(null);
  const [misses, setMisses] = useState(0);
  const done = filled === letters.length;

  const hear = () => {
    unlockAudio();
    primeDirectorAudio();
    say(word);
  };

  const tap = (t) => {
    unlockAudio();
    if (done || used.has(t.id)) return;
    if (t.ch === letters[filled]) {
      tick(filled);
      setUsed((u) => new Set(u).add(t.id));
      const n = filled + 1;
      setFilled(n);
      setMisses(0);
      if (n === letters.length) {
        greenlight();
        setTimeout(() => say(word), 500);
      }
    } else {
      wrong();
      setShake(t.id);
      setMisses((m) => m + 1);
      setTimeout(() => setShake(null), 400);
    }
  };

  const hintId = misses >= 2 ? tiles.find((t) => !used.has(t.id) && t.ch === letters[filled])?.id : null;

  return (
    <div className="screen moment">
      <div className="moment-kicker">WORD MOMENT</div>
      <div className={`fx-card ${done ? 'won' : ''}`}>
        <span className="fx-icon">{effect.icon}</span>
        <div>
          <div className="fx-label">{done ? 'UNLOCKED' : 'SPELL IT TO UNLOCK'}</div>
          <div className="fx-name">{effect.name} FX</div>
        </div>
      </div>

      <button className="hear-word" onClick={hear} aria-label="Hear the word">
        🔊
      </button>

      <div className="slots">
        {letters.map((ch, i) => (
          <span key={i} className={`slot ${i < filled ? 'full' : ''} ${i === filled && !done ? 'cur' : ''}`}>
            {i < filled ? ch : ''}
          </span>
        ))}
      </div>

      {!done ? (
        <div className="tiles">
          {tiles.map((t) => (
            <button
              key={t.id}
              className={`tile ${used.has(t.id) ? 'used' : ''} ${shake === t.id ? 'shake' : ''} ${hintId === t.id ? 'hint' : ''}`}
              onClick={() => tap(t)}
              disabled={used.has(t.id)}
            >
              {t.ch}
            </button>
          ))}
        </div>
      ) : (
        <button className="big-btn primary moment-go" onClick={() => onDone({ type: 'spell', word, effect: effect.id })}>
          Meet the Director ➜
        </button>
      )}
    </div>
  );
}

function TitleIt({ brief, onDone }) {
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState(null);
  const [locked, setLocked] = useState(null);
  const inputRef = useRef(null);
  const keywords = brief.keywords.map(normalizeWord);

  const check = () => {
    const raw = title.trim().replace(/\s+/g, ' ');
    if (raw.length < 3) return setMsg('Give it a title first!');
    const words = raw.split(' ');
    let fixed = null;
    let ok = false;
    const out = words.map((w) => {
      const n = normalizeWord(w);
      for (const k of keywords) {
        if (isKeywordForm(k, n)) ok = true;
        else if (k.length >= 5 && levenshtein(k, n) === 1) {
          ok = true;
          fixed = k;
          return w.replace(/[A-Za-z']+/, k);
        }
      }
      return w;
    });
    if (!ok) {
      wrong();
      return setMsg('Sneak one of the unlock words in!');
    }
    greenlight();
    const finalTitle = out.join(' ').slice(0, 40);
    setLocked({ title: finalTitle, fixed });
    setMsg(null);
  };

  return (
    <div className="screen moment">
      <div className="moment-kicker">WORD MOMENT</div>
      <h1 className="moment-title">Name your video</h1>
      <div className="moment-sub">Use an unlock word</div>
      <div className="gl-words">
        {brief.keywords.map((k) => (
          <span key={k} className="chip">
            {k}
          </span>
        ))}
      </div>

      {!locked ? (
        <>
          <input
            ref={inputRef}
            className="title-input"
            value={title}
            maxLength={40}
            onChange={(e) => {
              setTitle(e.target.value);
              setMsg(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && check()}
            placeholder="My epic video…"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <div className="sheet-msg warn">{msg}</div>
          <button className="big-btn primary" onClick={check}>
            Lock it in
          </button>
        </>
      ) : (
        <>
          <div className="title-locked">{locked.title}</div>
          <div className="sheet-msg">{locked.fixed ? `TITLE LOCKED · spelling fixed: ${locked.fixed}` : 'TITLE LOCKED'}</div>
          <button className="big-btn primary moment-go" onClick={() => onDone({ type: 'title', title: locked.title })}>
            Meet the Director ➜
          </button>
        </>
      )}
    </div>
  );
}
