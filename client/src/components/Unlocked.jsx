import React from 'react';
import { Logo, CoinPill, formatCount } from './Bits.jsx';

export default function Unlocked({ brief, stats, coins, onAgain, onHome }) {
  return (
    <div className="screen unlocked">
      <header className="topbar">
        <Logo small />
        <CoinPill coins={coins} />
      </header>
      <main className="unlocked-main">
        <div className="gl-kicker">{brief.title.toUpperCase()}</div>
        <h1 className="gl-title">GREENLIT</h1>
        <div className="stat-row">
          <div className="stat">
            <div className="stat-num">{formatCount(stats?.peakViewers ?? 0)}</div>
            <div className="stat-label">peak viewers</div>
          </div>
          <div className="stat">
            <div className="stat-num">x{stats?.bestCombo ?? 0}</div>
            <div className="stat-label">best combo</div>
          </div>
        </div>
        <div className="gl-words">
          {stats?.keywordsRead?.map((w) => (
            <span key={w} className="chip done">
              {w}
            </span>
          ))}
        </div>
        <div className="next-up">
          <span className="next-tag">NEXT</span> Director chat + camera
          <span className="soon">coming in the next update</span>
        </div>
        <div className="row-btns">
          <button className="big-btn primary" onClick={onHome}>
            Back to studio
          </button>
          <button className="big-btn ghost" onClick={onAgain}>
            Read it again
          </button>
        </div>
      </main>
    </div>
  );
}
