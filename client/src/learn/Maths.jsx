import React, { useState } from 'react';
import { api } from '../api.js';
import { DobReward } from '../components/Dob.jsx';
import { SectionHeader, ProgressDots, NumberPad } from './common.jsx';
import { unlockAudio, keywordHit, wrong } from '../sfx.js';

const TYPES = [
  { id: 'addition', name: 'Addition', icon: '➕', color: 'lime' },
  { id: 'subtraction', name: 'Subtraction', icon: '➖', color: 'cyan' },
  { id: 'bonds', name: 'Number bonds', icon: '🔗', color: 'orange' },
  { id: 'times', name: 'Times tables', icon: '✖️', color: 'pink' },
];
const MAX_TRIES = 2;

// Maths: four kinds, five questions each, Dibbly Dobs per set.
export default function Maths({ kid, onBack, onKid }) {
  const [set, setSet] = useState(null);
  const [i, setI] = useState(0);
  const [value, setValue] = useState('');
  const [tries, setTries] = useState(0);
  const [results, setResults] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [reward, setReward] = useState(null);
  const [error, setError] = useState(null);

  const start = async (type) => {
    unlockAudio();
    setError(null);
    try {
      const s = await api.post('/api/kid/maths/start', { type });
      setSet(s);
      setI(0);
      setValue('');
      setTries(0);
      setResults([]);
      setFeedback(null);
      setReward(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const advance = async (result) => {
    const all = [...results, result];
    setResults(all);
    if (all.length >= set.questions.length) {
      try {
        const r = await api.post(`/api/kid/practice/${set.setId}/finish`, { results: all });
        onKid({ ...kid, dobs: r.dobs });
        setReward(r);
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    setI(i + 1);
    setValue('');
    setTries(0);
    setFeedback(null);
  };

  const check = () => {
    const q = set.questions[i];
    if (!value || feedback === 'right' || feedback === 'shown') return;
    if (Number(value) === q.answer) {
      keywordHit();
      setFeedback('right');
      setTimeout(() => advance({ correct: true, tries: tries + 1 }), 900);
    } else if (tries + 1 >= MAX_TRIES) {
      wrong();
      setTries(tries + 1);
      setFeedback('shown');
      setValue(String(q.answer));
    } else {
      wrong();
      setTries(tries + 1);
      setFeedback('wrong');
      setValue('');
    }
  };

  if (reward) {
    return (
      <DobReward
        earned={reward.gained?.dobs || 0}
        total={reward.dobs}
        title={`${reward.score}/${reward.total} RIGHT!`}
        sub={TYPES.find((t) => t.id === set.type)?.name}
        onDone={() => {
          setReward(null);
          setSet(null);
        }}
      />
    );
  }

  if (set) {
    const q = set.questions[i];
    const t = TYPES.find((x) => x.id === set.type);
    const shown = q.q.replace('?', '□');
    return (
      <main className="section-main maths">
        <SectionHeader icon={t.icon} title={t.name} onBack={() => setSet(null)} right={<ProgressDots total={set.questions.length} index={i} results={results} />} />
        <div className={`maths-q ${feedback || ''}`}>
          {q.op === 'bond' ? shown.replace('□', value ? `[${value}]` : '□') : `${shown} = ${value || '?'}`}
        </div>
        {q.op === 'bond' || q.b <= 20 ? <Dots q={q} /> : null}
        <div className="spell-msg">
          {feedback === 'right' && '★ Correct! ★'}
          {feedback === 'wrong' && 'Not quite. Try again!'}
          {feedback === 'shown' && `The answer is ${q.answer}.`}
        </div>
        {feedback === 'shown' ? (
          <button className="big-btn primary" onClick={() => advance({ correct: false, tries })}>
            Next ➜
          </button>
        ) : (
          <NumberPad value={value} onChange={(v) => { setValue(v); if (feedback === 'wrong') setFeedback(null); }} onEnter={check} disabled={feedback === 'right'} />
        )}
        {error && <div className="notice">{error}</div>}
      </main>
    );
  }

  return (
    <main className="section-main">
      <SectionHeader icon="🔢" title="Maths" onBack={onBack} />
      {error && <div className="notice">{error}</div>}
      <div className="maths-grid">
        {TYPES.map((t) => (
          <button key={t.id} className={`maths-tile ${t.color}`} onClick={() => start(t.id)}>
            <span className="maths-icon">{t.icon}</span>
            <span className="maths-name">{t.name}</span>
            <span className="maths-sub">5 questions</span>
          </button>
        ))}
      </div>
    </main>
  );
}

/** Little counting dots for small sums (helps younger children). */
function Dots({ q }) {
  if (q.op === '×' || q.op === '−') return null;
  const a = q.a;
  const b = q.op === 'bond' ? q.b - q.a : q.b;
  if (a + b > 20) return null;
  return (
    <div className="count-dots" aria-hidden>
      {Array.from({ length: a }, (_, k) => (
        <span key={`a${k}`} className="cd a" />
      ))}
      <span className="cd-gap" />
      {Array.from({ length: b }, (_, k) => (
        <span key={`b${k}`} className={`cd b ${q.op === 'bond' ? 'hidden' : ''}`} />
      ))}
    </div>
  );
}
