import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { DobReward } from '../components/Dob.jsx';
import { SectionHeader, ProgressDots } from './common.jsx';
import { playLines, primeDirectorAudio, stopDirector } from '../speech/directorVoice.js';
import { unlockAudio, keywordHit, wrong } from '../sfx.js';

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
    setTimeout(() => {
      say(set.items[n]);
      inputRef.current?.focus();
    }, 250);
  };

  const check = () => {
    if (!answer.trim() || feedback === 'right' || feedback === 'shown') return;
    if (answer.trim().toLowerCase() === item.word.toLowerCase()) {
      keywordHit();
      setFeedback('right');
      setTimeout(() => next({ correct: true, tries: tries + 1, gaveUp: false }), 1100);
    } else {
      wrong();
      setTries((t) => t + 1);
      setFeedback('wrong');
      setAnswer('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
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
        {hint1 && feedback !== 'shown' && (
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
          <Tiles word={item.word} value={answer} onChange={setAnswer} disabled={feedback === 'right' || feedback === 'shown'} />
        ) : (
          <input
            ref={inputRef}
            className={`spell-input ${feedback === 'right' ? 'right' : ''} ${feedback === 'wrong' ? 'shake' : ''}`}
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value.replace(/[^A-Za-z'’-]/g, ''));
              if (feedback === 'wrong') setFeedback(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && check()}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="Type it here"
            readOnly={feedback === 'right' || feedback === 'shown'}
            autoFocus
          />
        )}
        <div className="spell-msg">
          {feedback === 'right' && '★ Spot on! ★'}
          {feedback === 'wrong' && (tries >= GIVE_UP_AFTER ? 'Nearly! Use the hint, or tap Show me.' : tries >= HINT_AFTER ? 'Have a look at the hint!' : 'Not quite. Listen again and have another go!')}
          {feedback === 'shown' && `It’s spelt ${item.word}. Next time!`}
        </div>
        <div className="row-btns">
          {feedback === 'shown' ? (
            <button className="big-btn primary" onClick={() => next({ correct: false, tries, gaveUp: true })}>
              Next word ➜
            </button>
          ) : (
            <>
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
        <div>💡 Stuck? You get hints after 2 tries</div>
        <div>🟢 5 words = Dibbly Dobs</div>
      </div>
    </main>
  );
}

function Tiles({ word, value, onChange, disabled }) {
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
      <div className="slots">
        {word.split('').map((_, k) => (
          <span key={k} className={`slot ${value[k] ? 'full' : ''}`}>
            {value[k] || ''}
          </span>
        ))}
      </div>
      <div className="tiles">
        {tiles.map((t, k) => (
          <button key={k} className="tile" disabled={disabled} onClick={() => value.length < word.length && onChange(value + t)}>
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
