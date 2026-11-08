import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReadingTracker, UNLOCK_RATIO } from '../reading/tracker.js';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { speak } from '../speech/speak.js';
import { formatCount } from './Bits.jsx';
import { DobPill } from './Dob.jsx';
import WordHelpSheet from './WordHelpSheet.jsx';
import KeywordSheet from './KeywordSheet.jsx';
import { api } from '../api.js';
import { playLines, primeDirectorAudio } from '../speech/directorVoice.js';

import { unlockAudio, tick, keywordHit, greenlight } from '../sfx.js';
import { say } from '../speech/say.js';

const HYPE_CALLS = [
  [0.3, 'CHAT IS WAKING UP'],
  [0.55, 'HYPE RISING'],
  [0.75, 'ALMOST GREENLIT'],
];
const REACTIONS = ['🔥', '😂', '😮', '👏', '💯', '⚡', '🤩'];
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function LockIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" className="lock-svg" aria-hidden>
      <rect x="4" y="10.5" width="16" height="11" rx="3" />
      <path d={open ? 'M8 10.5V7a4 4 0 0 1 7.6-1.7' : 'M8 10.5V7a4 4 0 0 1 8 0v3.5'} fill="none" strokeWidth="2.6" />
    </svg>
  );
}

export default function ReadScreen({ brief, coins = 0, onBack, onUnlocked, mode = 'script' }) {
  const isStory = mode === 'story';
  const tracker = useMemo(() => new ReadingTracker(brief.text, brief.keywords), [brief]);
  const [snap, setSnap] = useState(() => tracker.snapshot());
  const [mic, setMic] = useState(speechSupported() ? 'idle' : 'unsupported');
  const [helpIndex, setHelpIndex] = useState(null);
  const [focusWord, setFocusWord] = useState(null);
  const [paidWords, setPaidWords] = useState(() => new Set());
  const [call, setCall] = useState(null);
  const [showHeard, setShowHeard] = useState(false);
  const [greenlit, setGreenlit] = useState(false);
  const [grownUpSkip, setGrownUpSkip] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [secs, setSecs] = useState(0);
  const recRef = useRef(null);
  const resumeRef = useRef(false);
  const called = useRef(new Set());
  const callTimer = useRef(null);
  const comboRef = useRef(0);
  const comboTimer = useRef(null);
  const isLittle = brief.ageGroup === 'little';
  // Little Stars: the Director reads the brief first, then it's their turn.
  const [listenFirst, setListenFirst] = useState(isLittle ? 'ask' : 'done'); // ask | playing | done

  const shout = useCallback((text) => {
    setCall({ text, id: Date.now() });
    clearTimeout(callTimer.current);
    callTimer.current = setTimeout(() => setCall(null), 1700);
  }, []);

  const react = useCallback((n = 1) => {
    const fresh = Array.from({ length: n }, () => ({
      id: Math.random(),
      emoji: REACTIONS[rand(0, REACTIONS.length - 1)],
      x: rand(0, 60),
      d: 1.8 + Math.random() * 0.8,
    }));
    setReactions((r) => [...r.slice(-18), ...fresh]);
    setTimeout(() => setReactions((r) => r.filter((x) => !fresh.includes(x))), 2800);
  }, []);

  // Words lighting up: combo, sounds, viewers, reactions.
  const celebrateWords = useCallback(
    (lit) => {
      const real = lit.filter((i) => tracker.status[i] === 'read');
      if (!real.length) return;
      let kw = false;
      for (const i of real) {
        comboRef.current += 1;
        if (tracker.tokens[i].keyword) kw = true;
      }
      tick(comboRef.current);
      if (kw) setTimeout(keywordHit, 90);
      setCombo(comboRef.current);
      setBestCombo((b) => Math.max(b, comboRef.current));
      setViewers((v) => v + real.reduce((s) => s + rand(9, 24) + comboRef.current * 2, 0));
      react(kw ? 5 : Math.random() < 0.55 ? 1 : 0);
      clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => {
        comboRef.current = 0;
        setCombo(0);
      }, 2600);
    },
    [tracker, react]
  );

  useEffect(() => {
    const rec = createRecognizer({ lang: 'en-GB' });
    recRef.current = rec;
    const offs = [
      rec.on('transcript', ({ text, sessionId }) => {
        const lit = tracker.ingest(sessionId, text);
        setSnap(tracker.snapshot());
        if (lit.length) celebrateWords(lit);
      }),
      rec.on('state', setMic),
    ];
    return () => {
      offs.forEach((off) => off());
      rec.stop();
      clearTimeout(comboTimer.current);
    };
  }, [tracker, celebrateWords]);

  // REC timecode while listening.
  useEffect(() => {
    if (mic !== 'listening') return undefined;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [mic]);

  useEffect(() => {
    for (const [at, text] of HYPE_CALLS) {
      if (snap.progress >= at && !called.current.has(at) && !snap.unlocked) {
        called.current.add(at);
        shout(text);
      }
    }
  }, [snap.progress, snap.unlocked, shout]);

  const unlocked = snap.unlocked || grownUpSkip;

  useEffect(() => {
    if (!unlocked || greenlit) return;
    recRef.current?.stop();
    setGreenlit(true);
    greenlight();
    react(10);
  }, [unlocked, greenlit, react]);

  const toggleMic = () => {
    unlockAudio();
    if (mic === 'listening') recRef.current.stop();
    else recRef.current.start();
  };

  const pauseForSheet = () => {
    resumeRef.current = mic === 'listening';
    recRef.current?.stop();
  };
  const resumeAfterSheet = () => {
    if (resumeRef.current && !unlocked) recRef.current?.start();
    resumeRef.current = false;
  };

  const openHelp = (i) => {
    unlockAudio();
    pauseForSheet();
    setHelpIndex(i);
  };

  // Word help is always free.
  const markHelped = (norm) => setPaidWords((s) => new Set(s).add(norm));

  const openKeyword = (word) => {
    unlockAudio();
    pauseForSheet();
    setFocusWord(word);
  };

  const keywordDone = (word) => {
    tracker.forceKeyword(word);
    keywordHit();
    react(5);
    setSnap(tracker.snapshot());
  };

  // Grown-up skip: hold the locked Film button for 2 seconds.
  const holdTimer = useRef(null);
  const startHold = () => {
    if (unlocked) return;
    holdTimer.current = setTimeout(() => setGrownUpSkip(true), 2000);
  };
  const endHold = () => clearTimeout(holdTimer.current);

  const finish = () => {
    onUnlocked({
      wordsRead: snap.readCount,
      totalWords: snap.total,
      helpedWords: [...paidWords],
      keywords: snap.keywords.map((k) => k.word),
      keywordsRead: snap.keywords.filter((k) => k.done).map((k) => k.word),
      keywordsForced: [...tracker.forced],
      grownUpSkip: grownUpSkip && !snap.unlocked,
      peakViewers: viewers,
      bestCombo,
      seconds: secs,
    });
  };

  const hearBrief = async () => {
    unlockAudio();
    primeDirectorAudio();
    pauseForSheet();
    setListenFirst('playing');
    // Read out exactly what's on screen (the brief or their story) in the app's voice.
    await say(brief.text);
    setListenFirst('done');
  };

  const pct = Math.round(snap.progress * 100);
  const listening = mic === 'listening';
  const needsKeywords = snap.progress >= UNLOCK_RATIO && snap.keywords.some((k) => !k.done);
  const tc = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className={`screen read ${isLittle ? 'is-little' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className={`rec-chip ${listening ? 'on' : ''}`}>
          <span className="rec-dot" />
          {listening ? 'LIVE' : 'READY'} <span className="tc">{tc}</span>
        </div>
        <div className="viewers" aria-label={`${viewers} viewers`}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
          </svg>
          {formatCount(viewers)}
        </div>
        <div className="topbar-right">
          <button
            className={`icon-btn ear ${showHeard ? 'on' : ''}`}
            onClick={() => setShowHeard((v) => !v)}
            aria-label="Grown-ups: show what the app heard"
          >
            👂
          </button>
          <DobPill dobs={coins} />
        </div>
      </header>

      {mic === 'unsupported' && (
        <div className="notice">This browser can’t listen. Open Star Studio in Safari on the iPad.</div>
      )}
      {mic === 'error' && (
        <div className="notice">Mic blocked. Grown-up: allow the microphone for this site in Safari, then tap the mic.</div>
      )}

      <main className="prompter-wrap">
        <div className="script-label">
          <span>{isStory ? 'STORY' : 'SCRIPT'}</span> {brief.title}
        </div>
        {isLittle && (
          <div className="little-picture" aria-hidden>
            {brief.emoji}
          </div>
        )}
        <div className={`prompter ${listening ? 'live' : ''}`}>
          <p className="brief-text">
            {tracker.tokens.map((t, i) => {
              const s = snap.status[i];
              const cls = [
                'word',
                t.keyword ? 'kw' : '',
                s !== 'unread' ? 'lit' : '',
                s === 'filled' ? 'filled' : '',
                paidWords.has(t.norm) ? 'helped' : '',
                listening && i === snap.nextIndex ? 'next' : '',
              ].join(' ');
              return (
                <React.Fragment key={i}>
                  <button className={cls} onClick={() => openHelp(i)}>
                    {t.display}
                  </button>{' '}
                </React.Fragment>
              );
            })}
          </p>
          {isLittle && listenFirst === 'done' && (
            <button className="hear-btn" onClick={hearBrief}>
              🔊 Hear it first
            </button>
          )}
          <div className="reactions" aria-hidden>
            {reactions.map((r) => (
              <span key={r.id} style={{ right: r.x, animationDuration: `${r.d}s` }}>
                {r.emoji}
              </span>
            ))}
          </div>
        </div>
        {showHeard && <div className="heard">{snap.heard || '…'}</div>}
      </main>

      {isLittle && listenFirst !== 'done' && (
        <div className="listen-first">
          <button className="listen-btn" onClick={hearBrief} disabled={listenFirst === 'playing'}>
            <span className="listen-icon">{listenFirst === 'playing' ? '🎬' : '🔊'}</span>
            {listenFirst === 'playing' ? 'Listen…' : 'Listen first'}
          </button>
        </div>
      )}

      <footer className="dock">
        <div className="dock-left">
          <div className="hype-row">
            <span className="hype-label">HYPE</span>
            <div className="meter" aria-label={`${pct}% read`}>
              <div className="meter-fill" style={{ width: `${pct}%` }} />
              <div className="meter-goal" style={{ left: `${UNLOCK_RATIO * 100}%` }} />
            </div>
            <span className={`combo ${combo >= 3 ? 'show' : ''}`} key={combo >= 3 ? combo : 'x'}>
              x{combo}
            </span>
          </div>
          <div className="chips">
            {snap.keywords.map((k) => (
              <button
                key={k.word}
                className={`chip ${k.done ? 'done' : ''} ${needsKeywords && !k.done ? 'needs' : ''}`}
                onClick={() => !k.done && openKeyword(k.word)}
              >
                <LockIcon open={k.done} />
                {k.word}
              </button>
            ))}
          </div>
        </div>

        <button
          className={`mic ${listening ? 'on' : ''} ${mic === 'paused' ? 'paused' : ''}`}
          onClick={toggleMic}
          disabled={mic === 'unsupported' || unlocked}
          aria-label={listening ? 'Stop listening' : 'Start reading'}
        >
          <svg viewBox="0 0 24 24" className="mic-svg" aria-hidden>
            <rect x="9" y="2.5" width="6" height="12" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" strokeWidth="2.2" />
          </svg>
          <span className="mic-label">
            {unlocked ? 'DONE' : listening ? 'LIVE' : mic === 'paused' ? 'RESUME' : 'START'}
          </span>
        </button>

        <button
          className={`film ${unlocked ? 'ready' : 'locked'}`}
          onClick={() => unlocked && finish()}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={unlocked ? 'Go to filming' : 'Filming is locked'}
        >
          {unlocked && isStory ? (
            <span className="done-star" aria-hidden>
              ★
            </span>
          ) : unlocked ? (
            <svg viewBox="0 0 24 24" className="film-svg" aria-hidden>
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h8A2.5 2.5 0 0 1 16 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 16.5zM17 10l4-2.5v9L17 14z" />
            </svg>
          ) : (
            <LockIcon />
          )}
          <span>{unlocked ? (isStory ? 'DONE' : 'FILM') : 'LOCKED'}</span>
        </button>
      </footer>

      {call && (
        <div key={call.id} className="hype-call">
          {call.text}
        </div>
      )}

      {greenlit && (
        <>
          <div className="flash" />
          <div className="stamp">
            <small>{isStory ? 'STORY READ' : 'SCRIPT READ'}</small>
            {isStory ? 'AMAZING' : 'GREENLIT'}
          </div>
        </>
      )}

      {helpIndex != null && (
        <WordHelpSheet
          token={tracker.tokens[helpIndex]}
          overrides={brief.chunks}
          paid={paidWords.has(tracker.tokens[helpIndex].norm)}
          onHelp={markHelped}
          onClose={() => {
            setHelpIndex(null);
            resumeAfterSheet();
          }}
        />
      )}

      {focusWord && (
        <KeywordSheet
          word={focusWord}
          onDone={() => keywordDone(focusWord)}
          onClose={() => {
            setFocusWord(null);
            resumeAfterSheet();
          }}
        />
      )}
    </div>
  );
}
