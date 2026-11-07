import React, { useEffect, useRef, useState } from 'react';
import { unlockAudio, countdownBeep, greenlight } from '../sfx.js';

export const MAX_SECONDS = 60;

// Safari records MP4/H.264. Other browsers fall back to WebM (the server converts later).
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

export default function FilmScreen({ brief, plan, onBack, onDone }) {
  const [state, setState] = useState('init'); // init | denied | ready | countdown | recording | review
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState(null);
  const [error, setError] = useState(null);
  const liveRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const startedAt = useRef(0);

  const openCamera = async () => {
    unlockAudio();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      setState('ready');
    } catch (e) {
      setState('denied');
      setError(e.name === 'NotAllowedError' ? 'Camera blocked' : 'No camera found');
    }
  };

  // Attach the live camera to the preview whenever it is on screen.
  useEffect(() => {
    if (liveRef.current && streamRef.current && state !== 'review') {
      liveRef.current.srcObject = streamRef.current;
      liveRef.current.play?.().catch(() => {});
    }
  }, [state]);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      try {
        if (recRef.current?.state === 'recording') recRef.current.stop();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const begin = () => {
    unlockAudio();
    setState('countdown');
    let n = 3;
    setCount(n);
    countdownBeep();
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        countdownBeep();
      } else {
        clearInterval(t);
        countdownBeep(true);
        record();
      }
    }, 1000);
  };

  const record = () => {
    const mime = pickMime();
    if (mime === null) {
      setError('This browser cannot record video.');
      setState('ready');
      return;
    }
    chunks.current = [];
    let rec;
    try {
      rec = new MediaRecorder(streamRef.current, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 });
    } catch {
      rec = new MediaRecorder(streamRef.current);
    }
    rec.ondataavailable = (e) => e.data?.size && chunks.current.push(e.data);
    rec.onstop = () => {
      clearInterval(timer.current);
      const type = rec.mimeType || mime || 'video/mp4';
      const blob = new Blob(chunks.current, { type });
      const seconds = Math.min(MAX_SECONDS, Math.round((Date.now() - startedAt.current) / 1000));
      setTake({ blob, url: URL.createObjectURL(blob), mime: type, seconds });
      setState('review');
    };
    recRef.current = rec;
    startedAt.current = Date.now();
    setSecs(0);
    rec.start(1000);
    setState('recording');
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setSecs(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  };

  const stop = () => {
    clearInterval(timer.current);
    if (recRef.current?.state === 'recording') recRef.current.stop();
  };

  const retake = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setState('ready');
  };

  const useTake = () => {
    greenlight();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onDone(take);
  };

  const left = Math.max(0, MAX_SECONDS - secs);
  const ring = 2 * Math.PI * 44;

  return (
    <div className="screen film-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back" disabled={state === 'recording'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className={`rec-chip ${state === 'recording' ? 'on' : ''}`}>
          <span className="rec-dot" />
          {state === 'recording' ? 'REC' : state === 'review' ? 'PLAYBACK' : 'CAMERA'}
          <span className="tc">
            0:{String(state === 'review' ? take?.seconds ?? 0 : secs).padStart(2, '0')} / 1:00
          </span>
        </div>
        <div className="notes">
          {plan?.mood && <span className="note">{plan.mood}</span>}
          {plan?.music && <span className="note">♫ {plan.music}</span>}
        </div>
      </header>

      <main className="viewfinder-wrap">
        <div className={`viewfinder ${state === 'recording' ? 'rec' : ''}`}>
          {state === 'review' && take ? (
            <video key={take.url} className="review" src={take.url} controls playsInline autoPlay />
          ) : (
            <video ref={liveRef} className="live" muted playsInline autoPlay />
          )}

          {(state === 'init' || state === 'denied') && (
            <div className="vf-overlay">
              {state === 'denied' && <div className="notice">{error}. Grown-up: allow the camera for this site in Safari settings.</div>}
              <button className="big-btn primary huge" onClick={openCamera}>
                🎥 Camera on
              </button>
            </div>
          )}

          {state === 'countdown' && <div className="count">{count}</div>}

          {(state === 'ready' || state === 'recording') && plan?.ending && (
            <div className="ending-note">
              <span>BIG ENDING</span> {plan.ending}
            </div>
          )}
          {(state === 'ready' || state === 'recording') && (
            <div className="say-words">
              {brief.keywords.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </div>
          )}
          {state === 'recording' && left <= 10 && <div className="time-warn">{left}</div>}
        </div>
        {error && state !== 'denied' && <div className="notice">{error}</div>}
      </main>

      <footer className="film-dock">
        {state === 'ready' && (
          <button className="rec-btn" onClick={begin} aria-label="Start recording">
            <span />
          </button>
        )}
        {state === 'recording' && (
          <button className="rec-btn recording" onClick={stop} aria-label="Stop recording">
            <svg viewBox="0 0 100 100" className="rec-ring">
              <circle cx="50" cy="50" r="44" style={{ strokeDasharray: ring, strokeDashoffset: ring * (secs / MAX_SECONDS) }} />
            </svg>
            <span className="stop" />
          </button>
        )}
        {state === 'review' && (
          <div className="row-btns">
            <button className="big-btn ghost" onClick={retake}>
              ↺ Retake
            </button>
            <button className="big-btn primary" onClick={useTake}>
              Use this take ✓
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
