import React from 'react';

export function SectionHeader({ icon, title, onBack, right }) {
  return (
    <div className="section-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <span className="section-icon">{icon}</span>
      <h1 className="section-title">{title}</h1>
      {right}
    </div>
  );
}

/** Five dots showing progress through a set. */
export function ProgressDots({ total, index, results = [] }) {
  return (
    <div className="pdots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`pdot ${i === index ? 'cur' : ''} ${results[i] ? (results[i].correct && !results[i].gaveUp ? 'ok' : 'miss') : ''}`} />
      ))}
    </div>
  );
}

/** Big on-screen number pad for maths. */
export function NumberPad({ value, onChange, onEnter, disabled }) {
  const press = (k) => {
    if (disabled) return;
    if (k === '⌫') onChange(value.slice(0, -1));
    else if (k === '✓') onEnter();
    else if (value.length < 7) onChange(value + k);
  };
  return (
    <div className="numpad">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', '✓'].map((k) => (
        <button key={k} className={k === '✓' ? 'enter' : k === '⌫' ? 'ghost' : ''} onClick={() => press(k)} disabled={disabled}>
          {k}
        </button>
      ))}
    </div>
  );
}
