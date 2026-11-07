import React, { useMemo } from 'react';

export function Logo({ small }) {
  return (
    <div className={`logo ${small ? 'logo-small' : ''}`}>
      <span className="logo-star" aria-hidden>
        ★
      </span>
      <span>STAR STUDIO</span>
    </div>
  );
}

export function CoinPill({ coins, bump }) {
  return (
    <div className={`coin-pill ${bump ? 'bump' : ''}`} aria-label={`${coins} coins`}>
      <span className="coin" aria-hidden>
        ●
      </span>
      {coins}
    </div>
  );
}

const COLOURS = ['#ffd23f', '#ff3d8b', '#22e4d4', '#8a5cff', '#3ef08a', '#ffffff'];

export function Confetti({ count = 70 }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 1.6 + Math.random() * 1.6,
        size: 8 + Math.random() * 10,
        colour: COLOURS[i % COLOURS.length],
        spin: Math.random() * 720 - 360,
        round: Math.random() > 0.6,
      })),
    [count]
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.round ? b.size : b.size * 0.45,
            borderRadius: b.round ? '50%' : 2,
            background: b.colour,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            '--spin': `${b.spin}deg`,
          }}
        />
      ))}
    </div>
  );
}
