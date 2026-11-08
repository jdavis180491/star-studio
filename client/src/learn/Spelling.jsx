import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { DobReward } from '../components/Dob.jsx';
import { SectionHeader, ProgressDots } from './common.jsx';
import { playLines, primeDirectorAudio, stopDirector } from '../speech/directorVoice.js';
import { unlockAudio, keywordHit, wrong } from '../sfx.js';
import { say as sayAloud } from '../speech/say.js';

const HINT_AFTER = 2; // wrong tries before the first hint
const GIVE_UP_AFTER = 3; // wrong tries before "show me" appears

// Spelling: five words, said aloud (word, sentence, word). Hints after 2 tries,
// a bigger hint and the option to give up after 3. Five done = Dibbly Dobs.
export default function Spelling({ kid, onBack, onKid }) {
  const [phase, setPhase] = useState('home'); // home | loading | run | reward
  const [set, setSet] = useState(null);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const [tries, setTries] = useState(0);
  const [results, setResults] = useState([]);
  const [feedback, setFeedback] = useState(null); // null | 'right' | 'wrong' | 'shown'
  const [locked, setLocked] = useState([]); // letters they've already got right stay in place
  const [hints, setHints] = useState(0);
  const [reward, setReward] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const little = kid.track === 'little';

  const item = set?.items[i];

  const say = (it = item) => {
    unlockAudio();
    primeDirectorAudio();
    if (it) playLines([it.line]);
  };

  const start = async () => {
    unlockAudio();
    primeDirectorAudio();
    setPhase('loading');
    setError(null);
    try {
      const s = await api.post('/api/kid/spelling/start');
      setSet(s);
      setI(0);
      setResults([]);
      setTries(0);
      setAnswer('');
      setFeedback(null);
      setLocked([]);
      setHints(0);
      setPhase('run');
      setTimeout(() => say(s.items[0]), 300);
    } catch (e) {
      setError(e.message);
      setPhase('home');
    }
  };

  const next = async (result) => {
    const all = [...results, result];
    setResults(all);
    if (all.length >= set.items.length) {
      stopDirector();
      try {
        const r = await api.post(`/api/kid/practice/${set.setId}/finish`, { results: all });
        onKid({ ...kid, dobs: r.dobs });
        setReward(r);
        setPhase('reward');
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    const n = i + 1;
    setI(n);
    setTries(0);
    setAnswer('');
    setFeedback(null);
    setLocked([]);
    setHints(0);
    setTimeout(() => {
      say(set.items[n]);
      inputRef.current?.focus();
    }, 250);
  };

  const word = item?.word.toLowerCase() || '';
  const slotMode = little || locked.some(Boolean);
  const open = word.length - locked.filter(Boolean).length;
  const attemptOf = (typed) => (slotMode ? fillSlots(word, locked, typed) : typed.trim().toLowerCase());

  const check = () => {
    if (!answer.trim() || feedback === 'right' || feedback === 'shown') return;
    const attempt = attemptOf(answer);
    if (attempt === word) {
      keywordHit();
      setFeedback('right');
      setLocked(word.split(''));
      setTimeout(() => next({ correct: true, tries: tries + 1, gaveUp: false, hints }), 1100);
    } else {
      wrong();
      // Keep every letter that's already right; only the wrong ones need another go.
      setLocked(keepRight(word, attempt, locked));
      setTries((t) => t + 1);
      setFeedback('wrong');
      setAnswer('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // 💡 Hint: sound the word out and put the next missing letter in for them.
  const hint = () => {
    unlockAudio();
    primeDirectorAudio();
    const cur = locked.length ? [...locked] : Array(word.length).fill(null);
    const k = cur.findIndex((c) => !c);
    if (k >= 0) cur[k] = word[k];
    setLocked(cur);
    setHints((h) => h + 1);
    setAnswer('');
    sayAloud([...(item.chunks || []), item.word]);
    if (cur.every(Boolean)) {
      setFeedback('shown');
      return;
    }
    setFeedback(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const giveUp = () => {
    setFeedback('shown');
    setAnswer(item.word);
    say();
  };

  if (phase === 'reward' && reward) {
    return (
      <DobReward
        earned={reward.gained?.dobs || 0}
        total={reward.dobs}
        title={`${reward.score}/${reward.total} SPELT!`}
        sub="Spelling set complete"
        onDone={() => setPhase('home')}
      />
    );
  }

  if (phase === 'run' && item) {
    const hint1 = tries >= HINT_AFTER;
    const hint2 = tries >= GIVE_UP_AFTER;
    return (
      <main className="section-main spelling">
        <SectionHeader icon="🐝" title="Spelling" onBack={() => { stopDirector(); setPhase('home'); }} right={<ProgressDots total={set.items.length} index={i} results={results} />} />
        <button className="speak-big" onClick={() => say()} aria-label="Hear the word again">
          <span>🔊</span>
          Hear it again
        </button>
        {hint1 && !slotMode && feedback !== 'shown' && (
          <div className="hint">
            <span className="hint-label">HINT</span>
            {hint2 ? (
              <span className="hint-word">
                {item.chunks.map((c, k) => (
                  <span key={k} className="hint-chunk">
                    {c[0]}
                    {'_'.repeat(Math.max(0, c.length - 1))}
                  </span>
                ))}
              </span>
            ) : (
              <span className="hint-word">
                {item.word[0]}
                {' _'.repeat(item.word.length - 1)}
              </span>
            )}
            <span className="hint-sub">{hint2 ? `${item.chunks.length} chunk${item.chunks.length > 1 ? 's' : ''}` : `${item.word.length} letters`}</span>
          </div>
        )}
        {little ? (
          <Tiles word={word} locked={locked} value={answer} onChange={setAnswer} disabled={feedback === 'right' || feedback === 'shown'} />
        ) : (
          <>
          {slotMode && <Slots word={word} locked={locked} value={answer} right={feedback === 'right'} />}
          <input
            ref={inputRef}
            className={`spell-input ${feedback === 'right' ? 'right' : ''} ${feedback === 'wrong' ? 'shake' : ''}`}
            value={answer}
            onChange={(e) => {
              const v = e.target.value.replace(/[^A-Za-z'’-]/g, '').toLowerCase();
              setAnswer(slotMode ? v.slice(0, open) : v);
              if (feedback === 'wrong') setFeedback(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && check()}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder={slotMode ? 'Missing letters' : 'Type it here'}
            readOnly={feedback === 'right' || feedback === 'shown'}
            autoFocus
          />
          </>
        )}
        <div className="spell-msg">
          {feedback === 'right' && '★ Spot on! ★'}
          {feedback === 'wrong' &&
            (locked.some(Boolean)
              ? 'The green letters are right! Fill in the rest.'
              : tries >= GIVE_UP_AFTER
                ? 'Nearly! Use the hint, or tap Show me.'
                : 'Not quite. Listen again and have another go!')}
          {feedback === 'shown' && `It’s spelt ${item.word}. Next time!`}
        </div>
        <div className="row-btns">
          {feedback === 'shown' ? (
            <button className="big-btn primary" onClick={() => next({ correct: false, tries, gaveUp: true, hints })}>
              Next word ➜
            </button>
          ) : (
            <>
              <button className="big-btn ghost" onClick={hint}>
                💡 Hint
              </button>
              {tries >= GIVE_UP_AFTER && (
                <button className="big-btn ghost" onClick={giveUp}>
                  Show me
                </button>
              )}
              <button className="big-btn primary" onClick={check} disabled={!answer || feedback === 'right'}>
                Check ✓
              </button>
            </>
          )}
        </div>
        {error && <div className="notice">{error}</div>}
      </main>
    );
  }

  return (
    <main className="section-main">
      <SectionHeader icon="🐝" title="Spelling" onBack={onBack} />
      {error && <div className="notice">{error}</div>}
      <button className="hero-tile spelling" onClick={start} disabled={phase === 'loading'}>
        <span className="hero-tile-icon">🐝</span>
        <span className="hero-tile-text">
          <small>5 WORDS</small>
          {phase === 'loading' ? 'Getting your words…' : 'Start a spelling challenge'}
        </span>
        <span className="hero-tile-go">GO</span>
      </button>
      <div className="how">
        <div>🔊 Listen to the word and the sentence</div>
        <div>⌨️ Type the word</div>
        <div>💡 Stuck? Tap Hint any time. Letters you get right stay in place</div>
        <div>🟢 5 words = Dibbly Dobs</div>
      </div>
    </main>
  );
}

// Put the typed letters into the gaps between the letters they already got right.
function fillSlots(word, locked, typed) {
  let t = 0;
  return word
    .split('')
    .map((_, k) => locked[k] || typed[t++] || '')
    .join('');
}

// Letters in the right place (lined up from the start, or from the end) stay.
function keepRight(word, attempt, locked) {
  const out = word.split('').map((_, k) => locked[k] || null);
  for (let k = 0; k < attempt.length && k < word.length; k++) if (attempt[k] === word[k]) out[k] = word[k];
  const shift = word.length - attempt.length;
  for (let k = 0; k < attempt.length; k++) {
    const j = k + shift;
    if (j >= 0 && j < word.length && attempt[k] === word[j]) out[j] = word[j];
  }
  return out;
}

function Slots({ word, locked, value, right }) {
  let t = 0;
  return (
    <div className="slots spell-slots">
      {word.split('').map((_, k) => {
        const fixed = locked[k];
        const ch = fixed || value[t++] || '';
        return (
          <span key={k} className={`slot ${ch ? 'full' : ''} ${fixed ? 'locked' : ''} ${right ? 'locked' : ''}`}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

function Tiles({ word, locked = [], value, onChange, disabled }) {
  const open = word.length - locked.filter(Boolean).length;
  const tiles = useMemo(() => {
    const extra = 'aeioustm'.split('').filter((c) => !word.includes(c)).slice(0, 2);
    const all = [...word.split(''), ...extra];
    for (let k = all.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [all[k], all[j]] = [all[j], all[k]];
    }
    return all;
  }, [word]);
  return (
    <div className="tile-entry">
      <Slots word={word} locked={locked} value={value} />
      <div className="tiles">
        {tiles.map((t, k) => (
          <button key={k} className="tile" disabled={disabled} onClick={() => value.length < open && onChange(value + t)}>
            {t}
          </button>
        ))}
        <button className="tile back" disabled={disabled} onClick={() => onChange(value.slice(0, -1))}>
          ⌫
        </button>
      </div>
    </div>
  );
}
