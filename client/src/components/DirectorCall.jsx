import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { playLines, stopDirector, primeDirectorAudio } from '../speech/directorVoice.js';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { unlockAudio } from '../sfx.js';

// A voice call with the Director: no subtitles, no menus. She talks, the mic opens
// by itself, the child answers like a real call, and she replies.
const END_OF_TURN_MS = 1600; // quiet time after speech = they've finished
const NO_ANSWER_MS = 9000; // nothing said at all

const DEFAULT_PLAN = { mood: 'funny', music: 'pop', ending: 'a big surprise finish', weather: 'none', backdrop: 'none', look: 'none' };

/**
 * A voice call with an AI character. Used by the Director (Star Studio) and Story Buddy (Reading).
 * turnUrl gets { history, plan, ...extra } and returns { say, line, plan, done }.
 */
export function VoiceCall({ turnUrl, extra = {}, name, variant = 'director', hint, defaultPlan = {}, onBack, onDone }) {
  const [phase, setPhase] = useState('ready'); // ready | connecting | talking | listening | thinking | tap | done | error
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  const history = useRef([]);
  const plan = useRef({});
  const recRef = useRef(null);
  const heard = useRef('');
  const timers = useRef({});
  const finishing = useRef(false);
  const alive = useRef(true);

  const clearTimers = () => Object.values(timers.current).forEach(clearTimeout);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimers();
      stopDirector();
      recRef.current?.stop();
    };
  }, []);

  // Call timer
  useEffect(() => {
    if (phase === 'ready' || phase === 'done') return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase === 'ready' || phase === 'done']); // eslint-disable-line react-hooks/exhaustive-deps

  const takeTurn = useCallback(async () => {
    setPhase('thinking');
    try {
      const turn = await api.post(turnUrl, { history: history.current, plan: plan.current, ...extra });
      if (!alive.current) return;
      plan.current = turn.plan || plan.current;
      history.current.push({ who: 'director', text: turn.say });
      setPhase('talking');
      await playLines([turn.line]);
      if (!alive.current) return;
      if (turn.done) {
        setPhase('done');
        setTimeout(() => alive.current && onDone({ ...defaultPlan, ...plan.current }), 700);
      } else listen(); // eslint-disable-line no-use-before-define
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  }, [turnUrl, onDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishAnswer = useCallback(
    (text) => {
      if (finishing.current) return;
      finishing.current = true;
      clearTimers();
      recRef.current?.stop();
      setLevel(0);
      history.current.push({ who: 'kid', text: text.trim() });
      takeTurn().finally(() => {
        finishing.current = false;
      });
    },
    [takeTurn]
  );

  function listen() {
    heard.current = '';
    if (!speechSupported()) {
      setPhase('tap');
      return;
    }
    let rec = recRef.current;
    if (!rec) {
      rec = createRecognizer({ lang: 'en-GB' });
      recRef.current = rec;
      rec.on('transcript', ({ text, isFinal }) => {
        if (finishing.current) return;
        heard.current = text;
        setLevel(Math.min(1, 0.4 + Math.random() * 0.6));
        clearTimeout(timers.current.end);
        clearTimeout(timers.current.none);
        timers.current.end = setTimeout(() => finishAnswer(heard.current), isFinal ? 700 : END_OF_TURN_MS);
      });
      rec.on('state', (s) => {
        if (s === 'listening') setPhase((p) => (p === 'tap' || p === 'talking' ? 'listening' : p));
        if ((s === 'paused' || s === 'error') && !finishing.current) setPhase('tap');
      });
    }
    setPhase('listening');
    rec.start();
    clearTimeout(timers.current.none);
    timers.current.none = setTimeout(() => {
      if (!heard.current) finishAnswer('');
    }, NO_ANSWER_MS);
  }

  const startCall = () => {
    unlockAudio();
    primeDirectorAudio();
    setPhase('connecting');
    setSeconds(0);
    takeTurn();
  };

  // If Safari won't reopen the mic by itself, one tap does it.
  const tapToTalk = () => {
    unlockAudio();
    primeDirectorAudio();
    if (phase === 'listening') finishAnswer(heard.current);
    else listen();
  };

  const hangUp = () => {
    clearTimers();
    stopDirector();
    recRef.current?.stop();
    onDone({ ...defaultPlan, ...plan.current });
  };

  const mm = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const status = {
    ready: '',
    connecting: 'Calling…',
    talking: '',
    listening: '',
    thinking: '',
    tap: '',
    done: variant === 'buddy' ? 'Writing your story…' : 'Cameras are yours!',
    error: '',
  }[phase];

  return (
    <div className={`screen call phase-${phase} call-${variant}`}>
      <header className="call-top">
        <button className="icon-btn" onClick={onBack} aria-label="Back" disabled={phase !== 'ready'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        {phase !== 'ready' && (
          <div className="call-timer">
            <span className="rec-dot" /> {mm}
          </div>
        )}
      </header>

      <main className="call-main">
        <div className={`call-face ${phase === 'talking' ? 'talking' : ''} ${phase === 'thinking' ? 'thinking' : ''}`}>
          <div className="call-ring r1" />
          <div className="call-ring r2" />
          <div className="call-orb">
            <svg viewBox="0 0 120 120" className="call-features" aria-hidden>
              <path d="M20 44h80v8c0 14-9 22-21 22s-19-8-19-18c0 10-7 18-19 18S20 66 20 52z" className="shades" />
              <rect x="44" y="86" width="32" height="10" rx="5" className="mouth" />
            </svg>
          </div>
        </div>
        <div className="call-name">{name}</div>
        <div className="call-status">{status}</div>

        {phase === 'listening' && (
          <div className="you-talk" aria-label="Listening">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ transform: `scaleY(${0.3 + level * (0.4 + ((i * 37) % 10) / 15)})` }} />
            ))}
          </div>
        )}
        {phase === 'thinking' && (
          <div className="dots" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && <div className="notice">{error}</div>}
      </main>

      <footer className="call-dock">
        {phase === 'ready' && (
            <button className="call-btn answer" onClick={startCall} aria-label={`Call ${name}`}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6.6 10.8a15.2 15.2 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1z" />
            </svg>
          </button>
        )}
        {(phase === 'tap' || phase === 'listening') && (
          <button className={`big-btn ${phase === 'tap' ? 'primary pulse' : 'ghost'}`} onClick={tapToTalk}>
            {phase === 'tap' ? '🎙️ Tap to talk' : "I'm done"}
          </button>
        )}
        {phase === 'error' && (
          <button className="big-btn primary" onClick={takeTurn}>
            Try again
          </button>
        )}
        {phase !== 'ready' && phase !== 'done' && (
          <button className="call-btn hangup" onClick={hangUp} aria-label="Hang up">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 01-1.41-.02L.29 13.08a1 1 0 010-1.42C3.34 8.77 7.46 7 12 7s8.66 1.77 11.71 4.66a1 1 0 010 1.42l-2.48 2.47a1 1 0 01-1.41.02 11.3 11.3 0 00-2.66-1.85 1 1 0 01-.56-.9v-3.1A15 15 0 0012 9z" />
            </svg>
          </button>
        )}
        {phase === 'ready' && <div className="call-hint">{hint}</div>}
      </footer>
    </div>
  );
}

export default function DirectorCall({ track, onBack, onDone }) {
  return (
    <VoiceCall
      turnUrl="/api/kid/director/turn"
      extra={{ track }}
      name="THE DIRECTOR"
      variant="director"
      hint="Call the Director to plan your video"
      defaultPlan={DEFAULT_PLAN}
      onBack={onBack}
      onDone={onDone}
    />
  );
}
