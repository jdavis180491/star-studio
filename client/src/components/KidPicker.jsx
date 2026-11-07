import React, { useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { Logo } from './Bits.jsx';
import { unlockAudio, tick, wrong } from '../sfx.js';

// "Who's creating today?" → tap your avatar → 4-digit PIN.
export default function KidPicker({ kids, onIn }) {
  const [kid, setKid] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);

  const press = async (d) => {
    unlockAudio();
    if (pin.length >= 4) return;
    tick(pin.length);
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === 4) {
      try {
        const out = await api.post('/api/kid/login', { kidId: kid.id, pin: next });
        onIn(out.kid);
      } catch (e) {
        wrong();
        setError(e.message);
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin('');
        }, 450);
      }
    }
  };

  if (!kids.length) {
    return (
      <div className="screen picker">
        <Logo />
        <h1 className="hero-title small">No creators yet</h1>
        <p className="muted-line">A grown-up needs to add a profile first.</p>
        <a className="big-btn primary" href="/parent">
          Grown-ups
        </a>
      </div>
    );
  }

  return (
    <div className="screen picker">
      <header className="topbar">
        <Logo />
        <a className="link" href="/parent">
          Grown-ups
        </a>
      </header>
      {!kid ? (
        <main className="picker-main">
          <h1 className="hero-title small">Who’s creating?</h1>
          <div className="picker-grid">
            {kids.map((k) => (
              <button key={k.id} className="picker-kid" onClick={() => setKid(k)}>
                <Avatar avatar={k.avatar} size={140} ring />
                <span>{k.channelName}</span>
              </button>
            ))}
          </div>
        </main>
      ) : (
        <main className="picker-main">
          <button className="picker-kid selected" onClick={() => setKid(null)}>
            <Avatar avatar={kid.avatar} size={120} ring />
            <span>{kid.channelName}</span>
          </button>
          <div className={`pin-dots ${shake ? 'shake' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <div className="pin-msg">{error || 'Enter your secret code'}</div>
          <div className="pinpad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button className="ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">
              ⌫
            </button>
            <button onClick={() => press('0')}>0</button>
            <button className="ghost" onClick={() => setKid(null)} aria-label="Back">
              ←
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
