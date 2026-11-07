import React, { useState } from 'react';
import { Logo, CoinPill } from './Bits.jsx';

const dayLabel = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

export default function Home({ today, briefs, loadError, coins, onPick }) {
  const [testOpen, setTestOpen] = useState(false);

  return (
    <div className="screen home">
      <header className="topbar">
        <Logo />
        <CoinPill coins={coins} />
      </header>

      <main className="home-main">
        {loadError && <div className="notice">Can't reach the studio. Check the internet and refresh.</div>}

        {today ? (
          <button className="today" onClick={() => onPick(today)}>
            <div className="today-top">
              <span className="pill-live">
                <span className="rec-dot" /> TODAY’S CHALLENGE
              </span>
              <span className="today-date">{dayLabel()}</span>
            </div>
            <div className="today-title">{today.title}</div>
            <div className="today-meta">
              <span>
                <b>{today.keywords.length}</b> unlock words
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
        </div>
      </main>
    </div>
  );
}
