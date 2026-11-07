import React from 'react';
import { Logo, CoinPill, Confetti } from './Bits.jsx';

export default function Unlocked({ brief, stats, coins, onAgain, onHome }) {
  return (
    <div className="screen unlocked">
      <header className="topbar">
        <Logo small />
        <CoinPill coins={coins} />
      </header>
      <Confetti count={50} />
      <main className="unlocked-main">
        <div className="clapper" aria-hidden>
          🎬
        </div>
        <h1 className="hero-title">Ready to film!</h1>
        <div className="stat-row">
          <div className="stat">
            <div className="stat-num">{stats?.wordsRead ?? 0}</div>
            <div className="stat-label">words read</div>
          </div>
          <div className="stat">
            <div className="stat-num">
              {stats?.keywordsRead?.length ?? 0}/{stats?.keywords?.length ?? 0}
            </div>
            <div className="stat-label">star words</div>
          </div>
          <div className="stat">
            <div className="stat-num">{stats?.helpedWords?.length ?? 0}</div>
            <div className="stat-label">help used</div>
          </div>
        </div>
        <p className="coming-soon">The camera arrives in the next update.</p>
        <div className="row-btns">
          <button className="big-btn yellow" onClick={onHome}>
            New brief
          </button>
          <button className="big-btn ghost" onClick={onAgain}>
            Read “{brief.title}” again
          </button>
        </div>
      </main>
    </div>
  );
}
