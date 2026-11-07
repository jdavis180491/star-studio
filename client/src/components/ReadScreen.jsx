import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReadingTracker, UNLOCK_RATIO } from '../reading/tracker.js';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { speak } from '../speech/speak.js';
import { CoinPill, Confetti } from './Bits.jsx';
import WordHelpSheet from './WordHelpSheet.jsx';
import KeywordSheet from './KeywordSheet.jsx';
import { HELP_COST } from '../store.js';

const CHEERS = [
  [0.25, 'Nice start!'],
  [0.5, 'Halfway there!'],
  [0.75, 'So close!'],
];

export default function ReadScreen({ brief, coins, spend, onBack, onUnlocked }) {
  const tracker = useMemo(() => new ReadingTracker(brief.text, brief.keywords), [brief]);
  const [snap, setSnap] = useState(() => tracker.snapshot());
  const [mic, setMic] = useState(speechSupported() ? 'idle' : 'unsupported');
  const [helpIndex, setHelpIndex] = useState(null);
  const [focusWord, setFocusWord] = useState(null);
  const [paidWords, setPaidWords] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const [showHeard, setShowHeard] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [grownUpSkip, setGrownUpSkip] = useState(false);
  const [coinBump, setCoinBump] = useState(false);
  const recRef = useRef(null);
  const resumeRef = useRef(false);
  const cheered = useRef(new Set());
  const toastTimer = useRef(null);
  const isLittle = brief.ageGroup === 'little';

  const showToast = useCallback((text) => {
    setToast({ text, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // One recognizer for the whole screen.
  useEffect(() => {
    const rec = createRecognizer({ lang: 'en-GB' });
    recRef.current = rec;
    const offs = [
      rec.on('transcript', ({ text, sessionId }) => {
        tracker.ingest(sessionId, text);
        setSnap(tracker.snapshot());
      }),
      rec.on('state', setMic),
    ];
    return () => {
      offs.forEach((off) => off());
      rec.stop();
    };
  }, [tracker]);

  // Cheers as the meter fills.
  useEffect(() => {
    for (const [at, text] of CHEERS) {
      if (snap.progress >= at && !cheered.current.has(at) && !snap.unlocked) {
        cheered.current.add(at);
        showToast(text);
      }
    }
  }, [snap.progress, snap.unlocked, showToast]);

  const unlocked = snap.unlocked || grownUpSkip;

  useEffect(() => {
    if (!unlocked || celebrate) return;
    recRef.current?.stop();
    setCelebrate(true);
    speak('Filming unlocked!', { rate: 1 });
  }, [unlocked, celebrate]);

  const toggleMic = () => {
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
    pauseForSheet();
    setHelpIndex(i);
  };

  const payForHelp = (norm) => {
    if (paidWords.has(norm)) return true;
    if (coins >= HELP_COST) {
      spend(HELP_COST);
      setCoinBump(true);
      setTimeout(() => setCoinBump(false), 600);
    }
    // Not enough coins? Help is free. We never block a child from help.
    setPaidWords((s) => new Set(s).add(norm));
    return true;
  };

  const openKeyword = (word) => {
    pauseForSheet();
    setFocusWord(word);
  };

  const keywordDone = (word) => {
    tracker.forceKeyword(word);
    setSnap(tracker.snapshot());
  };

  // Hold the locked Film button for 2 seconds = grown-up skip.
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
      grownUpSkip: grownUpSkip && !snap.unlocked,
    });
  };

  const hearBrief = () => {
    pauseForSheet();
    speak(brief.text, { rate: 0.8 }).then(() => {});
  };

  const pct = Math.round(snap.progress * 100);
  const listening = mic === 'listening';

  return (
    <div className={`screen read ${isLittle ? 'is-little' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="brief-title">
          <span aria-hidden>{brief.emoji}</span> {brief.title}
        </div>
        <div className="topbar-right">
          <button
            className={`icon-btn ear ${showHeard ? 'on' : ''}`}
            onClick={() => setShowHeard((v) => !v)}
            aria-label="Show what the app heard"
          >
            👂
          </button>
          <CoinPill coins={coins} bump={coinBump} />
        </div>
      </header>

      {mic === 'unsupported' && (
        <div className="notice">This browser can’t listen. Open Star Studio in Safari on the iPad.</div>
      )}
      {mic === 'error' && (
        <div className="notice">
          The microphone is blocked. Grown-up: allow the microphone for this site in Safari, then tap the mic.
        </div>
      )}

      <main className="prompter-wrap">
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
          {isLittle && (
            <button className="hear-btn" onClick={hearBrief}>
              🔊 Hear it
            </button>
          )}
        </div>
        {showHeard && <div className="heard">{snap.heard || '…'}</div>}
      </main>

      <footer className="dock">
        <div className="dock-left">
          <div className="meter" aria-label={`${pct}% read`}>
            <div className="meter-fill" style={{ width: `${pct}%` }} />
            <div className="meter-goal" style={{ left: `${UNLOCK_RATIO * 100}%` }}>
              ★
            </div>
          </div>
          <div className="chips">
            {snap.keywords.map((k) => (
              <button
                key={k.word}
                className={`chip ${k.done ? 'done' : ''}`}
                onClick={() => !k.done && openKeyword(k.word)}
              >
                {k.done ? '★ ' : ''}
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
          <span className="mic-icon" aria-hidden>
            🎙️
          </span>
          <span className="mic-label">
            {unlocked ? 'Done!' : listening ? 'Listening' : mic === 'paused' ? 'Tap to go on' : 'Read it!'}
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
          <span className="film-icon" aria-hidden>
            {unlocked ? '🎬' : '🔒'}
          </span>
          <span>{unlocked ? 'FILM IT!' : `${pct}%`}</span>
        </button>
      </footer>

      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}

      {celebrate && (
        <>
          <Confetti />
          <div className="unlock-banner">FILMING UNLOCKED!</div>
        </>
      )}

      {helpIndex != null && (
        <WordHelpSheet
          token={tracker.tokens[helpIndex]}
          overrides={brief.chunks}
          paid={paidWords.has(tracker.tokens[helpIndex].norm)}
          coins={coins}
          onPay={payForHelp}
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
