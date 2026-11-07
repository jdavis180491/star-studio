import React from 'react';
import { Logo, CoinPill, formatCount } from './Bits.jsx';
import { EFFECTS } from './WordMoment.jsx';

// "That's a wrap": the end of today's shoot (the edit suite arrives in Phase 4).
export default function Unlocked({ brief, stats, production, coins, onAgain, onHome }) {
  const fx = EFFECTS.find((e) => e.id === production?.word?.effect);
  const plan = production?.plan || {};
  return (
    <div className="screen unlocked">
      <header className="topbar">
        <Logo small />
        <CoinPill coins={coins} />
      </header>
      <main className="unlocked-main">
        <div className="gl-kicker">{(production?.word?.title || brief.title).toUpperCase()}</div>
        <h1 className="gl-title">THAT’S A WRAP</h1>

        {production?.take && (
          <video className="wrap-video" src={production.take.url} controls playsInline />
        )}

        <div className="stat-row">
          <div className="stat">
            <div className="stat-num">{formatCount(stats?.peakViewers ?? 0)}</div>
            <div className="stat-label">peak viewers</div>
          </div>
          <div className="stat">
            <div className="stat-num">x{stats?.bestCombo ?? 0}</div>
            <div className="stat-label">best combo</div>
          </div>
          {fx && (
            <div className="stat">
              <div className="stat-num">{fx.icon}</div>
              <div className="stat-label">{fx.name} FX</div>
            </div>
          )}
        </div>

        <div className="gl-words">
          {plan.mood && <span className="chip done">{plan.mood}</span>}
          {plan.music && <span className="chip done">♫ {plan.music}</span>}
          {plan.ending && <span className="chip">{plan.ending}</span>}
        </div>

        <div className="next-up">
          <span className="next-tag">NEXT</span> Edit suite: music, captions + FX
          <span className="soon">coming in the next update</span>
        </div>
        <div className="row-btns">
          <button className="big-btn primary" onClick={onHome}>
            Back to studio
          </button>
          <button className="big-btn ghost" onClick={onAgain}>
            Start over
          </button>
        </div>
      </main>
    </div>
  );
}
