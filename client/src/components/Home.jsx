import React, { useState } from 'react';
import { Logo, CoinPill } from './Bits.jsx';

const dayLabel = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

export default function Home({ today, briefs, loadError, coins, onPick }) {
  const brief = today?.brief;
  const little = today?.little;
  const [testOpen, setTestOpen] = useState(false);

  return (
    <div className="screen home">
      <header className="topbar">
        <Logo />
        <CoinPill coins={coins} />
      </header>

      <main className="home-main">
        {loadError && <div className="notice">Can't reach the studio. Check the internet and refresh.</div>}

        {brief ? (
          <button className="today" onClick={() => onPick(brief)}>
            <div className="today-top">
              <span className="pill-live">
                <span className="rec-dot" /> TODAY’S CHALLENGE
              </span>
              <span className="today-date">{dayLabel()}</span>
            </div>
            <div className="today-channel">{today.channelName}</div>
            <div className="today-title">{brief.title}</div>
            <div className="today-meta">
              <span>
                <b>{brief.keywords.length}</b> unlock words
              </span>
              <span className="sep" />
              <span>
                <b>60s</b> to film
              </span>
              <span className="sep" />
              <span>Same brief for the whole crew</span>
            </div>
            <div className="today-cta">START SCRIPT READ ➜</div>
          </button>
        ) : (
          !loadError && <div className="today skeleton" />
        )}

        {little && (
          <button className="little-card" onClick={() => onPick(little)}>
            <span className="little-emoji" aria-hidden>
              {little.emoji}
            </span>
            <span className="little-text">
              <small>LITTLE STARS · TODAY</small>
              {little.title}
            </span>
            <span className="little-go">GO</span>
          </button>
        )}

        <div className="test-drawer">
          <button className="test-toggle" onClick={() => setTestOpen((v) => !v)}>
            {testOpen ? '▾' : '▸'} Test briefs
          </button>
          {testOpen && (
            <div className="test-list">
              {briefs?.map((b) => (
                <button key={b.id} className="test-pill" onClick={() => onPick(b)}>
                  {b.title}
                  {b.ageGroup === 'little' && <em> · Little Stars</em>}
                </button>
              ))}
            </div>
          )}
          <a className="grownups" href="/parent">
            Grown-ups
          </a>
        </div>
      </main>
    </div>
  );
}
