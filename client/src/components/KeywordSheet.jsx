import React, { useEffect, useRef, useState } from 'react';
import { createRecognizer } from '../speech/recognizer.js';
import { heardWord } from '../reading/tracker.js';
import { speak } from '../speech/speak.js';

// Practise one star word on its own. Very forgiving: after 3 goes we count it anyway.
const MAX_TRIES = 3;

export default function KeywordSheet({ word, onDone, onClose }) {
  const [state, setState] = useState('ready'); // ready | listening | yes | counted
  const [tries, setTries] = useState(0);
  const recRef = useRef(null);
  const settled = useRef(false);
  const heardSomething = useRef(false);

  useEffect(() => {
    const rec = createRecognizer({ lang: 'en-GB' });
    recRef.current = rec;
    const offs = [
      rec.on('transcript', ({ text, isFinal }) => {
        if (settled.current) return;
        heardSomething.current = true;
        if (heardWord(word, text)) {
          settled.current = true;
          rec.stop();
          setState('yes');
          onDone();
        } else if (isFinal) {
          rec.stop();
        }
      }),
      rec.on('state', (s) => {
        if (s === 'listening') setState('listening');
        if ((s === 'idle' || s === 'paused') && !settled.current) {
          if (heardSomething.current) {
            setTries((t) => {
              const n = t + 1;
              if (n >= MAX_TRIES) {
                settled.current = true;
                setState('counted');
                onDone();
              } else setState('ready');
              return n;
            });
          } else setState('ready');
          heardSomething.current = false;
        }
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      rec.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  useEffect(() => {
    if (state === 'yes') speak('Yes!', { rate: 1 });
  }, [state]);

  const listen = () => {
    heardSomething.current = false;
    recRef.current.start();
  };

  const done = state === 'yes' || state === 'counted';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Say ${word}`}>
        <div className="sheet-kicker">STAR WORD</div>
        <div className={`sheet-word kw-big ${done ? 'got' : ''}`}>{word}</div>
        <div className="sheet-msg">
          {state === 'yes' && '★ Nailed it! ★'}
          {state === 'counted' && '★ Great try, that counts! ★'}
          {state === 'listening' && 'Say it now…'}
          {state === 'ready' && tries > 0 && 'Ooh, nearly! One more go.'}
        </div>
        <div className="sheet-actions">
          {!done ? (
            <button className={`big-btn pink ${state === 'listening' ? 'pulse' : ''}`} onClick={listen}>
              🎙️ Say it!
            </button>
          ) : (
            <button className="big-btn yellow" onClick={onClose}>
              Back to reading ➜
            </button>
          )}
          {!done && (
            <button className="big-btn ghost" onClick={onClose}>
              Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
