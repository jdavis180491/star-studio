import React, { useEffect, useRef, useState } from 'react';

// The app's own on-screen keyboard for Writing and Spelling.
// The iPad's keyboard never opens (there's no editable box to focus), so its
// microphone / dictation button can't type for the child. A real plugged-in
// keyboard still works, because that's genuine typing.

const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const NUMBERS = ['1234567890', '-/:;()&@"', "!?'"];

/** Apply one key to the text. */
export function applyKey(text, key) {
  if (key === 'Backspace') return text.slice(0, -1);
  if (key === 'Enter') return text + '\n';
  return text + key;
}

/** True when the next letter should be a capital (start, or after . ! ? and a space / new line). */
export function wantsCapital(text) {
  return !text.trim() || /[.!?]\s+$/.test(text) || /\n\s*$/.test(text);
}

export default function KidKeyboard({ mode = 'writing', text = '', onKey, onEnter, disabled = false, enterDisabled = false }) {
  const [page, setPage] = useState('abc'); // abc | 123
  const [shift, setShift] = useState(null); // null = automatic capitals, true/false = the child chose
  const writing = mode === 'writing';
  const caps = writing && (shift ?? wantsCapital(text));
  const latest = useRef({});
  latest.current = { onKey, onEnter, disabled, writing, enterDisabled };

  // A real keyboard (plugged in or Bluetooth) is proper typing, so allow it.
  useEffect(() => {
    const down = (e) => {
      const h = latest.current;
      if (h.disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        h.onKey('Backspace');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (h.writing) h.onKey('Enter');
        else if (!h.enterDisabled) h.onEnter?.();
      } else if (e.key.length === 1) {
        if (!h.writing && !/[a-z]/i.test(e.key)) return;
        e.preventDefault();
        h.onKey(h.writing ? e.key : e.key.toLowerCase());
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const press = (k) => {
    if (disabled) return;
    onKey(caps && /^[a-z]$/.test(k) ? k.toUpperCase() : k);
    if (shift !== null && k.length === 1) setShift(null);
  };

  // Keys act on finger-down so quick typing keeps up; preventDefault stops focus jumping about.
  const key = (id, label, cls = '', fn = () => press(id)) => (
    <button
      key={`${id}|${label}`}
      type="button"
      className={`kk-key ${cls}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        fn();
      }}
      onClick={(e) => e.detail === 0 && fn()}
    >
      {label}
    </button>
  );

  const rows = page === '123' ? NUMBERS : LETTERS;
  return (
    <div className={`kid-keyboard ${writing ? 'writing' : 'spelling'}`} role="group" aria-label="Keyboard">
      {rows.map((row, r) => (
        <div key={r} className="kk-row">
          {r === 2 && writing && page === 'abc' && key('shift', '⇧', `wide ${caps ? 'on' : ''}`, () => setShift(!caps))}
          {row.split('').map((c) => key(c, caps ? c.toUpperCase() : c))}
          {r === 2 && key('Backspace', '⌫', 'wide back')}
        </div>
      ))}
      {writing && (
        <div className="kk-row">
          {key('page', page === '123' ? 'ABC' : '123', 'wide', () => setPage(page === '123' ? 'abc' : '123'))}
          {key(',', ',')}
          {key(' ', 'space', 'space')}
          {key('.', '.')}
          {key('Enter', '↵', 'wide')}
        </div>
      )}
    </div>
  );
}
