import React from 'react';
import Avatar from './Avatar.jsx';
import { DobPill, DobIcon } from './Dob.jsx';

const NAV = [
  { id: 'home', icon: '🏠', name: 'Home' },
  { id: 'leaderboard', icon: '🏆', name: 'Leaderboard' },
  { id: 'me', icon: '✨', name: 'Me' },
];

// The frame around the kid's app: who's logged in, their Dibbly Dobs, and the tabs.
export default function Hub({ kid, tab, onTab, onSwitch, children }) {
  return (
    <div className="hub">
      <header className="hub-top">
        <button className="hub-me" onClick={onSwitch} aria-label="Switch person">
          <Avatar avatar={kid.avatar} size={52} />
          <span className="hub-name">{kid.channelName}</span>
        </button>
        <div className="topbar-right">
          <DobPill dobs={kid.dobs} />
        </div>
      </header>
      <div className="hub-body">{children}</div>
      <nav className="hub-nav">
        {NAV.map((n) => (
          <button key={n.id} className={tab === n.id ? 'on' : ''} onClick={() => onTab(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-name">{n.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const SECTIONS = [
  { id: 'studio', name: 'Star Studio', sub: 'Today’s video challenge', icon: '🎬', cls: 'studio' },
  { id: 'reading', name: 'Reading', sub: 'Make up a story & read it', icon: '📖', cls: 'reading' },
  { id: 'writing', name: 'Writing', sub: 'Write to a friend', icon: '✏️', cls: 'writing' },
  { id: 'spelling', name: 'Spelling', sub: '5 words to spell', icon: '🐝', cls: 'spelling' },
  { id: 'maths', name: 'Maths', sub: 'Sums, bonds & tables', icon: '🔢', cls: 'maths' },
];

/** Dibbly Dobs home: the five sections. */
export function HomeTab({ kid, today, unread, rules, onOpen }) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const posted = today?.progress?.posted;
  return (
    <main className="home-grid-wrap">
      <div className="home-hello">
        <DobIcon size={64} className="wiggle" />
        <div>
          <div className="muted-line">{hello},</div>
          <h1 className="hero-title small">{kid.channelName}</h1>
        </div>
      </div>
      <div className="home-grid">
        {SECTIONS.map((s) => (
          <button key={s.id} className={`home-tile ${s.cls}`} onClick={() => onOpen(s.id)}>
            <span className="home-tile-icon">{s.icon}</span>
            <span className="home-tile-name">{s.name}</span>
            <span className="home-tile-sub">
              {s.id === 'studio' ? (posted ? 'Posted today ✓' : today?.briefs ? `Today: ${Object.values(today.briefs)[0]?.title}` : s.sub) : s.sub}
            </span>
            {s.id === 'writing' && unread > 0 && <span className="count-badge big">{unread}</span>}
            {rules && (
              <span className="tile-dobs">
                <DobIcon size={20} />+{s.id === 'studio' ? rules.studio : s.id === 'maths' ? rules['maths-addition'] : rules[s.id]}
              </span>
            )}
          </button>
        ))}
      </div>
    </main>
  );
}

const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

/** The Today tab: the daily challenge card and progress. */
export function TodayTab({ kid, today, onStart, onOpenVideo }) {
  if (!today) return <div className="loading">Loading…</div>;
  const tracks = Object.keys(today.briefs);
  const mainTrack = tracks.includes('star') ? 'star' : 'little';
  const main = today.briefs[mainTrack];
  const extraLittle = tracks.length > 1 ? today.briefs.little : null;
  const p = today.progress;
  const posted = p.posted;
  const steps = [
    { id: 'read', name: 'Read', done: p.read },
    { id: 'word', name: 'Word', done: p.word },
    { id: 'film', name: 'Film', done: Boolean(p.video) },
    { id: 'post', name: 'Post', done: posted },
  ];
  return (
    <main className="home-main">
      <button className={`today ${mainTrack === 'little' ? 'today-little' : ''}`} onClick={() => !posted && onStart(main, mainTrack)}>
        <div className="today-top">
          <span className="pill-live">
            <span className="rec-dot" /> {posted ? 'POSTED TODAY' : 'TODAY’S CHALLENGE'}
          </span>
          <span className="today-date">{dayLabel()}</span>
        </div>
        {mainTrack === 'little' && <div className="today-emoji">{main.emoji}</div>}
        <div className="today-channel">{today.crew ? `CREW · ${today.crew.name}` : kid.channelName}</div>
        <div className="today-title">{main.title}</div>
        <div className="steps">
          {steps.map((s) => (
            <span key={s.id} className={`step ${s.done ? 'done' : ''}`}>
              {s.done ? '✓' : '•'} {s.name}
            </span>
          ))}
        </div>
        <div className="today-cta">{posted ? 'Watch the premiere in Crew 🍿' : p.read ? 'KEEP GOING ➜' : 'START SCRIPT READ ➜'}</div>
      </button>
      {extraLittle && !posted && (
        <button className="little-card" onClick={() => onStart(extraLittle, 'little')}>
          <span className="little-emoji" aria-hidden>
            {extraLittle.emoji}
          </span>
          <span className="little-text">
            <small>LITTLE STARS · TODAY</small>
            {extraLittle.title}
          </span>
          <span className="little-go">GO</span>
        </button>
      )}
      {p.video && !posted && p.video.status === 'ready' && (
        <button className="big-btn ghost" onClick={() => onOpenVideo(p.video)}>
          🎞️ Your edit is ready: watch & post
        </button>
      )}
      {kid.streak > 0 && <div className="streak-line">🔥 {kid.streak}-day streak · miss a day and it’s forgiven</div>}
    </main>
  );
}
