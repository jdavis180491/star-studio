import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReadingTracker, UNLOCK_RATIO } from '../reading/tracker.js';
import { spokenWords, wordsMatch } from '../reading/words.js';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { speak } from '../speech/speak.js';
import { formatCount } from './Bits.jsx';
import { DobPill } from './Dob.jsx';
import WordHelpSheet from './WordHelpSheet.jsx';
import KeywordSheet from './KeywordSheet.jsx';
import { api } from '../api.js';
import { playLines, primeDirectorAudio } from '../speech/directorVoice.js';

import { unlockAudio, tick, keywordHit, greenlight, wrong } from '../sfx.js';
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
  const heardTick = useRef(0); // counts transcripts, so "I say it, you say it" only reacts to new speech
  const echoBase = useRef(0);
  const resumeRef = useRef(false);
  const called = useRef(new Set());
  const callTimer = useRef(null);
  const comboRef = useRef(0);
  const comboTimer = useRef(null);
  const isLittle = brief.ageGroup === 'little';
  // Young children and the daily brief: "I say it, you say it", one sentence at a time.
  const echo = isLittle && !isStory;
  const sentences = useMemo(() => tracker.sentences(), [tracker]);
  const [echoAt, setEchoAt] = useState(0);
  const [echoPhase, setEchoPhase] = useState(echo ? 'start' : 'off'); // start | saying | yours | done | off
  // Young children reading a story: the Director can read it first.
  const [listenFirst, setListenFirst] = useState(isLittle && !echo ? 'ask' : 'done'); // ask | playing | done

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
      rec.on('transcript', ({ text, sessionId, alternatives = [] }) => {
        heardTick.current += 1;
        let lit = tracker.ingest(sessionId, text);
        // Misheard? Try the speech engine's other guesses for the same words.
        for (const alt of alternatives) {
          if (lit.length) break;
          lit = tracker.ingest(sessionId, alt);
        }
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

  // Three tries and the word still isn't heard: word help pops up to sound it out (and then it counts).
  const helped = useRef(new Set());
  useEffect(() => {
    const i = snap.needsHelp;
    if (i == null || helped.current.has(i) || helpIndex != null) return;
    helped.current.add(i);
    shout('Let’s sound it out!');
    openHelp(i); // eslint-disable-line no-use-before-define
  }, [snap.needsHelp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the word they're on (or the sentence they're repeating) in view, above the controls.
  const followIndex = echo && echoPhase !== 'start' && echoPhase !== 'done' ? sentences[echoAt]?.[0] : snap.stuck ?? snap.nextIndex;
  useEffect(() => {
    if (followIndex == null || followIndex < 0) return;
    const el = document.querySelector(`.brief-text .word[data-i="${followIndex}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dock = document.querySelector('.screen.read .dock')?.getBoundingClientRect();
    const bottomLimit = (dock ? dock.top : innerHeight) - 24;
    if (r.bottom > bottomLimit || r.top < 80) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [followIndex]);

  // Read past a word? Tell them to go back for the red one.
  const lastStuck = useRef(null);
  useEffect(() => {
    if (snap.stuck != null && snap.stuck !== lastStuck.current) {
      wrong();
      shout(`Oops! Read “${tracker.tokens[snap.stuck].display.replace(/[^A-Za-z'’-]/g, '')}” first`);
    }
    lastStuck.current = snap.stuck;
  }, [snap.stuck, shout, tracker]);

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
  // Using word help on the word they're stuck on lets them carry on from the next word.
  const markHelped = (norm) => {
    setPaidWords((s) => new Set(s).add(norm));
    if (helpIndex != null && tracker.helpedWith(helpIndex)) setSnap(tracker.snapshot());
  };

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

  // Grown-up skip: hold the locked Film button for 5 seconds (long enough that a child resting a finger won't).
  const holdTimer = useRef(null);
  const startHold = () => {
    if (unlocked) return;
    holdTimer.current = setTimeout(() => setGrownUpSkip(true), 5000);
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

  // ---- "I say it, you say it"
  // Words of the current sentence heard so far (across tries); missed ones go red.
  const echoGot = useRef(new Set());
  const [echoMissing, setEchoMissing] = useState([]);
  const echoSay = async (i, text = null) => {
    unlockAudio();
    primeDirectorAudio();
    recRef.current?.stop();
    if (i !== echoAt || text === null) {
      if (i !== echoAt) echoGot.current = new Set();
      setEchoMissing([]);
    }
    setEchoAt(i);
    setEchoPhase('saying');
    await say(text || sentences[i].map((x) => tracker.tokens[x].display).join(' '));
    echoBase.current = heardTick.current;
    setEchoPhase('yours');
    recRef.current?.start();
  };
  // Every word must be said back (only "a", "an" and "the" can slip through).
  useEffect(() => {
    if (echoPhase !== 'yours' || heardTick.current === echoBase.current) return undefined; // nothing said yet
    const idx = sentences[echoAt];
    const heard = spokenWords(snap.heard || '');
    for (const i of idx) {
      const w = tracker.tokens[i].norm;
      if (['a', 'an', 'the'].includes(w) || heard.some((h) => wordsMatch(w, h, { loose: w.length >= 4 }))) echoGot.current.add(i);
    }
    const missing = idx.filter((i) => !echoGot.current.has(i));
    if (missing.length && missing.length < echoMissing.length) setEchoMissing(missing);
    // Wait for a pause, so they can finish speaking.
    const t = setTimeout(
      () => {
        if (missing.length) {
          // Missed some: show them in red and say just those words for them to repeat.
          setEchoMissing(missing);
          wrong();
          echoSay(echoAt, `Nearly! Say: ${missing.map((i) => tracker.tokens[i].display.replace(/[^A-Za-z'’-]/g, '')).join(', ')}.`);
          return;
        }
        echoGot.current = new Set();
        setEchoMissing([]);
        tracker.completeSentence(idx);
        setSnap(tracker.snapshot());
        celebrateWords(idx);
        if (echoAt + 1 < sentences.length) {
          setEchoPhase('saying');
          setTimeout(() => echoSay(echoAt + 1), 700);
        } else {
          setEchoPhase('done');
        }
      },
      missing.length ? 2600 : 700
    );
    return () => clearTimeout(t);
  }, [snap.heard, echoPhase]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {!listening && !unlocked && !echo && listenFirst === 'done' && mic !== 'unsupported' && (
          <button className="start-top" onClick={toggleMic}>
            🎤 {snap.readCount > 0 ? 'Keep reading' : 'Start reading'}
          </button>
        )}
        {unlocked && (
          <button className="start-top ready" onClick={finish}>
            {isStory ? '★ Finished! Next ➜' : '🎬 Ready! Let’s film ➜'}
          </button>
        )}
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
                i === snap.stuck || echoMissing.includes(i) ? 'stuck' : '',
                echo && echoPhase !== 'start' && echoPhase !== 'done' ? (sentences[echoAt]?.includes(i) ? 'echo-now' : 'echo-dim') : '',
              ].join(' ');
              return (
                <React.Fragment key={i}>
                  <button className={cls} data-i={i} onClick={() => openHelp(i)}>
                    {t.display}
                  </button>{' '}
                </React.Fragment>
              );
            })}
          </p>
          {isLittle && !echo && listenFirst === 'done' && (
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

      {echo && echoPhase !== 'done' && (
        <div className={`listen-first echo-panel ${echoPhase === 'start' ? '' : 'bar'}`}>
          {echoPhase === 'start' && (
            <button className="listen-btn" onClick={() => echoSay(0)}>
              <span className="listen-icon">🔊</span>I say it, you say it!
            </button>
          )}
          {echoPhase === 'saying' && (
            <div className="echo-tag">
              <span className="listen-icon">🎬</span> Listen…
            </div>
          )}
          {echoPhase === 'yours' && (
            <>
              <div className="echo-tag yours">
                <span className="listen-icon">🎤</span> Your turn! Say it back
              </div>
              <button className="big-btn ghost" onClick={() => echoSay(echoAt)}>
                🔁 Say it again
              </button>
            </>
          )}
        </div>
      )}

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
