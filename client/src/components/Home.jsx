import React from 'react';
import { Logo, CoinPill } from './Bits.jsx';

export default function Home({ briefs, loadError, coins, onPick }) {
  return (
    <div className="screen home">
      <header className="topbar">
        <Logo />
        <CoinPill coins={coins} />
      </header>

      <main className="home-main">
        <div className="home-hero">
          <div className="on-air">
            <span className="dot" /> TODAY'S CHALLENGE
          </div>
          <h1 className="hero-title">Pick your brief</h1>
        </div>

        {loadError && <div className="notice">Can't reach the studio. Check the internet and refresh.</div>}
        {!briefs && !loadError && <div className="loading">Loading…</div>}

        <div className="brief-grid">
          {briefs?.map((b, i) => (
            <button
              key={b.id}
              className={`brief-card tilt-${i % 4} ${b.ageGroup === 'little' ? 'little' : ''}`}
              onClick={() => onPick(b)}
            >
              <span className="brief-emoji" aria-hidden>
                {b.emoji}
              </span>
              <span className="brief-name">{b.title}</span>
              {b.ageGroup === 'little' && <span className="tag">LITTLE STARS</span>}
              <span className="brief-go">GO ➜</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
