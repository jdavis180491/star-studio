import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, briefRef } from '../api.js';
import { playLines, stopDirector } from '../speech/directorVoice.js';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { unlockAudio } from '../sfx.js';

const MOODS = [
  { id: 'funny', label: 'Funny', icon: '😂' },
  { id: 'dramatic', label: 'Dramatic', icon: '🎭' },
  { id: 'spooky', label: 'Spooky', icon: '👻' },
  { id: 'epic', label: 'Epic', icon: '🚀' },
];
const MUSIC = [
  { id: 'pop', label: 'Pop', icon: '🎤' },
  { id: 'rock', label: 'Rock', icon: '🎸' },
  { id: 'orchestra', label: 'Orchestra', icon: '🎻' },
  { id: 'spooky', label: 'Spooky', icon: '🕸️' },
  { id: 'funky', label: 'Funky', icon: '🕺' },
  { id: 'chill', label: 'Chill', icon: '🌙' },
];
const SLOT_LABEL = { mood: 'MOOD', music: 'MUSIC', ending: 'BIG ENDING' };
const SILENCE_MS = 1800;

export default function Director({ brief, onBack, onDone }) {
  const [started, setStarted] = useState(false);
  const [caption, setCaption] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [slot, setSlot] = useState(null);
  const [plan, setPlan] = useState({});
  const [heard, setHeard] = useState('');
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const heardRef = useRef('');
  const silenceTimer = useRef(null);
  const submittedRef = useRef(false);
  const ref = briefRef(brief);

  const say = useCallback(async (lines) => {
    setSpeaking(true);
    await playLines(lines, { onLine: (i) => setCaption(lines[i].text) });
    setSpeaking(false);
  }, []);

  useEffect(() => () => {
    stopDirector();
    recRef.current?.stop();
    clearTimeout(silenceTimer.current);
  }, []);

  const start = async () => {
    unlockAudio();
    setStarted(true);
    setThinking(true);
    try {
      const data = await api.post('/api/director/start', { briefRef: ref });
      setThinking(false);
      await say(data.lines);
      setSlot(data.slot);
    } catch (e) {
      setThinking(false);
      setError(e.message);
    }
  };

  const submit = useCallback(
    async (answer) => {
      if (submittedRef.current || !slot) return;
      submittedRef.current = true;
      recRef.current?.stop();
      clearTimeout(silenceTimer.current);
      setListening(false);
      setThinking(true);
      try {
        const data = await api.post('/api/director/answer', { briefRef: ref, slot, answer, plan });
        setPlan(data.plan);
        setHeard('');
        setThinking(false);
        setSlot(null);
        await say(data.lines);
        if (data.nextSlot) setSlot(data.nextSlot);
        else setFinished(true);
      } catch (e) {
        setThinking(false);
        setError(e.message);
      } finally {
        submittedRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slot, plan]
  );

  const submitRef = useRef(submit);
  submitRef.current = submit;

  const listen = () => {
    unlockAudio();
    stopDirector();
    if (listening) {
      // Second tap = "I'm done talking".
      submitRef.current(heardRef.current);
      return;
    }
    if (!speechSupported()) return;
    heardRef.current = '';
    setHeard('');
    const rec = recRef.current || createRecognizer({ lang: 'en-GB' });
    if (!recRef.current) {
      recRef.current = rec;
      rec.on('transcript', ({ text, isFinal }) => {
        heardRef.current = text;
        setHeard(text);
        clearTimeout(silenceTimer.current);
        const delay = isFinal ? 500 : SILENCE_MS;
        silenceTimer.current = setTimeout(() => {
          if (heardRef.current.trim()) submitRef.current(heardRef.current);
        }, delay);
      });
      rec.on('state', (s) => setListening(s === 'listening'));
    }
    rec.start();
  };

  const choices = slot === 'mood' ? MOODS : slot === 'music' ? MUSIC : null;
  const busy = speaking || thinking;

  return (
    <div className="screen director">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="script-label inline">
          <span>DIRECTOR’S CHAIR</span> {brief.title}
        </div>
      </header>

      <main className="director-main">
        <div className={`orb ${speaking ? 'talking' : ''} ${listening ? 'listening' : ''} ${thinking ? 'thinking' : ''}`} aria-hidden>
          <div className="orb-core">
            <svg viewBox="0 0 64 40" className="orb-shades">
              <path d="M2 6h60v6c0 10-7 18-16 18s-14-6-14-14c0 8-5 14-14 14S2 22 2 12z" />
            </svg>
          </div>
        </div>
        <div className="director-name">THE DIRECTOR</div>

        <div className="caption" aria-live="polite">
          {!started ? 'Your Director is ready on set.' : thinking && !caption ? '…' : caption}
        </div>

        <div className="plan-row">
          {Object.keys(SLOT_LABEL).map((k) => (
            <div key={k} className={`plan-card ${plan[k] ? 'set' : ''} ${slot === k ? 'asking' : ''}`}>
              <div className="plan-label">{SLOT_LABEL[k]}</div>
              <div className="plan-value">{plan[k] || '—'}</div>
            </div>
          ))}
        </div>

        {error && <div className="notice">{error}</div>}
      </main>

      <footer className="director-dock">
        {!started && (
          <button className="big-btn primary huge" onClick={start}>
            Meet the Director
          </button>
        )}

        {started && slot && (
          <>
            {choices && (
              <div className="choice-row">
                {choices.map((c) => (
                  <button key={c.id} className="choice" disabled={busy} onClick={() => submit(c.label)}>
                    <span className="choice-icon">{c.icon}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="answer-row">
              <button className={`mic ${listening ? 'on' : ''}`} onClick={listen} disabled={busy || !speechSupported()}>
                <svg viewBox="0 0 24 24" className="mic-svg" aria-hidden>
                  <rect x="9" y="2.5" width="6" height="12" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" strokeWidth="2.2" />
                </svg>
                <span className="mic-label">{listening ? 'DONE' : 'ANSWER'}</span>
              </button>
              <div className="heard-live">{listening ? heard || 'Listening…' : thinking ? 'Director is thinking…' : ''}</div>
              {slot === 'ending' && !listening && (
                <button className="big-btn ghost" disabled={busy} onClick={() => submit('surprise me')}>
                  Surprise me
                </button>
              )}
            </div>
          </>
        )}

        {finished && (
          <button className="big-btn primary huge" onClick={() => onDone(plan)} disabled={speaking}>
            🎥 To the camera
          </button>
        )}
      </footer>
    </div>
  );
}
