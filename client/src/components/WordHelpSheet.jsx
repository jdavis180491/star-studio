import React, { useEffect, useState } from 'react';
import { say, primeDirectorAudio } from '../speech/say.js';

// Word help: opens only when the child taps a word. It says the whole word clearly
// (no sounding-out: single sounds come out odd), and they can hear it again.
export default function WordHelpSheet({ token, onHelp, onClose }) {
  const word = token.display.replace(/[^A-Za-z0-9'’-]/g, '').replace(/-$/, '');
  const [speaking, setSpeaking] = useState(false);

  const hear = async () => {
    primeDirectorAudio();
    setSpeaking(true);
    await say(word);
    setSpeaking(false);
  };

  useEffect(() => {
    onHelp?.(token.norm);
    hear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Help with ${word}`}>
        <div className="sheet-kicker">WORD HELP</div>
        <div className={`sheet-word ${speaking ? 'speaking' : ''}`}>{word}</div>
        <div className="sheet-actions">
          <button className="big-btn pink" onClick={hear}>
            🔊 Hear it again
          </button>
          <button className="big-btn ghost" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
