import React, { useState } from 'react';
import { chunkWord, speakableChunk } from '../reading/phonics.js';
import { speakSequence } from '../speech/speak.js';

export default function WordHelpSheet({ token, overrides, paid, onHelp, onClose }) {
  const word = token.display.replace(/[^A-Za-z0-9'’-]/g, '').replace(/-$/, '');
  const chunks = chunkWord(token.norm, overrides);
  const [revealed, setRevealed] = useState(paid);
  const [active, setActive] = useState(-1);

  const play = async () => {
    for (let i = 0; i < chunks.length; i++) {
      setActive(i);
      await speakSequence([speakableChunk(chunks[i])], { rate: 0.75 });
    }
    setActive(chunks.length);
    await speakSequence([token.norm], { rate: 0.9 });
    setActive(-1);
  };

  const help = () => {
    onHelp(token.norm);
    setRevealed(true);
    play();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Help with ${word}`}>
        <div className="sheet-kicker">WORD ASSIST</div>
        <div className="sheet-word">
          {revealed ? (
            chunks.map((c, i) => (
              <span key={i} className={`chunk c${i % 4} ${active === i || active === chunks.length ? 'say' : ''}`}>
                {c}
              </span>
            ))
          ) : (
            <span>{word}</span>
          )}
        </div>

        <div className="sheet-actions">
          {!revealed ? (
            <button className="big-btn pink" onClick={help}>
              Break it down
            </button>
          ) : (
            <button className="big-btn pink" onClick={play}>
              🔊 Replay
            </button>
          )}
          <button className="big-btn ghost" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
