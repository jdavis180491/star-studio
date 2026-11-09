import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createWeather, drawBackdrop, applyLook, drawFrame, drawStickers, stickerAt } from './effects.js';
import { getSegmenter, createMasker } from './segmenter.js';
import { WEATHER, BACKDROPS, LOOKS, FRAMES, MUSIC, STICKER_EMOJI } from '../shared/creative.js';
import { unlockAudio, countdownBeep, greenlight } from '../sfx.js';
import { say, primeDirectorAudio } from '../speech/say.js';

export const MAX_SECONDS = 60;
const W = 1280;
const H = 720;

const TABS = [
  { id: 'weather', name: 'Weather', icon: '🌦️', list: WEATHER },
  { id: 'backdrop', name: 'Backdrop', icon: '🏙️', list: BACKDROPS },
  { id: 'look', name: 'Look', icon: '🎨', list: LOOKS },
  { id: 'frame', name: 'Frame', icon: '📺', list: FRAMES },
  { id: 'stickers', name: 'Stickers', icon: '😎' },
  { id: 'music', name: 'Music', icon: '🎵', list: MUSIC },
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

function coverRect(vw, vh) {
  const s = Math.max(W / vw, H / vh);
  const w = vw * s;
  const h = vh * s;
  return [(W - w) / 2, (H - h) / 2, w, h];
}

// Show the whole camera picture. A wide camera fills the frame; a tall one (iPad held upright)
// is shown in full in the middle instead of being cropped to a zoomed-in strip.
function fitRect(vw, vh) {
  if (vw / vh >= 1.5) return coverRect(vw, vh);
  const s = Math.min(W / vw, H / vh);
  const w = vw * s;
  const h = vh * s;
  return [(W - w) / 2, (H - h) / 2, w, h];
}

/** A few quick sentences reminding them of the story they chose with the Director. */
export function recapLine(brief, plan = {}, little = false) {
  const title = brief?.title || 'today’s challenge';
  const parts = [`Remember, the story you chose is ${title}.`];
  if (!little) {
    const how = [];
    if (plan.mood) how.push(`make it ${plan.mood}`);
    if (plan.ending) how.push(`finish with ${String(plan.ending).replace(/[.!?]+$/, '')}`);
    if (how.length) parts.push(`${how.join(', and ')}.`.replace(/^./, (c) => c.toUpperCase()));
  }
  parts.push(little ? 'Big smile! Ready?' : 'Big energy. Ready?');
  return parts.join(' ');
}

export default function StudioCamera({ brief, plan, channelName, little, onBack, onDone }) {
  const [state, setState] = useState('init'); // init | denied | ready | recap | countdown | recording | review
  const [recap, setRecap] = useState(null);
  const [fx, setFx] = useState(() => ({
    weather: plan?.weather || 'none',
    backdrop: plan?.backdrop || 'none',
    look: plan?.look || 'none',
    frame: 'none',
    music: plan?.music || 'pop',
  }));
  const [tab, setTab] = useState('weather');
  const [stickers, setStickers] = useState([]);
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState(null);
  const [error, setError] = useState(null);
  const [seg, setSeg] = useState('off'); // off | loading | on | failed
  const [musicOn, setMusicOn] = useState(true);

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fxRef = useRef(fx);
  const stickersRef = useRef(stickers);
  const weatherRef = useRef(null);
  const segRef = useRef(null);
  const maskerRef = useRef(null);
  const personRef = useRef(null);
  const recRef = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const startedAt = useRef(0);
  const audioRef = useRef(null);
  const dragRef = useRef(null);
  const viewers = useRef(1200 + Math.floor(Math.random() * 800));
  const usedFx = useRef(new Set());

  fxRef.current = fx;
  stickersRef.current = stickers;

  // ---- effects that need setup when changed
  useEffect(() => {
    weatherRef.current = createWeather(fx.weather, W, H);
    usedFx.current.add(`weather:${fx.weather}`);
  }, [fx.weather]);

  useEffect(() => {
    usedFx.current.add(`backdrop:${fx.backdrop}`);
    if (fx.backdrop === 'none' || segRef.current) return;
    setSeg('loading');
    getSegmenter()
      .then((s) => {
        segRef.current = s;
        maskerRef.current = createMasker();
        setSeg('on');
      })
      .catch(() => setSeg('failed'));
  }, [fx.backdrop]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.src = `/music/${fx.music}.mp3`;
    a.loop = true;
    a.volume = 0.22;
    if (musicOn && state !== 'init' && state !== 'denied' && state !== 'review') a.play().catch(() => {});
  }, [fx.music]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Music plays while they get ready, but NOT while filming: the iPad's echo cancelling fights
    // speaker music and makes the voice crackle and drop out. The edit adds the music back in.
    if (musicOn && (state === 'ready' || state === 'recap' || state === 'countdown')) a.play().catch(() => {});
    else a.pause();
  }, [musicOn, state]);

  // ---- camera
  // Turning the camera on, carefully: some iPads refuse particular settings, Low Power Mode can
  // stop the picture playing, and permissions can be off. Each case gets a fix or a clear message.
  const [needTap, setNeedTap] = useState(false);
  const [slow, setSlow] = useState(false);
  const cameraProblem = (e) => {
    const n = e?.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError')
      return 'The camera is switched off for Dibbly Dobs. Grown-up: on the iPad open Settings → Safari → Camera → Allow (and Microphone → Allow), then come back and tap Camera on.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy. Close any other app using the camera (like FaceTime), then tap Camera on.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
    if (n === 'NoMediaDevices') return 'This browser can’t use the camera. Open Dibbly Dobs in Safari (not inside another app).';
    return `The camera didn’t start (${n || 'unknown problem'}). Tap Camera on to try again.`;
  };

  const startPicture = async () => {
    const v = videoRef.current;
    try {
      v.muted = true;
      await v.play();
      setNeedTap(false);
    } catch {
      setNeedTap(true); // e.g. Low Power Mode: one tap starts it
    }
  };

  const openCamera = async () => {
    unlockAudio();
    setError(null);
    setNeedTap(false);
    setState('starting');
    const slowTimer = setTimeout(() => setSlow(true), 6000);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no media'), { name: 'NoMediaDevices' });
      // Ask for the best picture first; if the iPad says no, ask more simply.
      const tries = [
        {
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          // Plain microphone: echo cancelling and noise suppression chop children's voices in and out.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        },
        { video: { facingMode: 'user' }, audio: true },
        { video: true, audio: true },
        { video: true, audio: false },
      ];
      let stream = null;
      let lastErr = null;
      for (const c of tries) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch (e) {
          lastErr = e;
          if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; // asking again won't help
        }
      }
      if (!stream) throw lastErr;
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      await startPicture();
      setState('ready');
      audioRef.current?.play().catch(() => {});
      // No picture after a few seconds? Offer the tap-to-start button.
      setTimeout(() => {
        if (videoRef.current && videoRef.current.readyState < 2) setNeedTap(true);
      }, 2500);
    } catch (e) {
      console.warn('Camera failed:', e?.name, e?.message);
      setState('denied');
      setError(cameraProblem(e));
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  };

  // ---- the draw loop
  useEffect(() => {
    let raf;
    let last = performance.now();
    let frameNo = 0;
    const canvas = canvasRef.current;
    const g = canvas.getContext('2d');
    personRef.current ||= Object.assign(document.createElement('canvas'), { width: W, height: H });
    const pg = personRef.current.getContext('2d');
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const v = videoRef.current;
      const f = fxRef.current;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0a0a10';
      g.fillRect(0, 0, W, H);
      const hasVideo = v && v.readyState >= 2 && v.videoWidth;
      const rect = hasVideo ? fitRect(v.videoWidth, v.videoHeight) : null;
      const wide = hasVideo && v.videoWidth / v.videoHeight >= 1.5;
      const masker = maskerRef.current;
      if (hasVideo && f.backdrop !== 'none' && segRef.current && masker) {
        if (frameNo % 2 === 0) masker.update(segRef.current, v, now);
      }
      if (hasVideo && f.backdrop !== 'none' && masker?.ready) {
        drawBackdrop(g, f.backdrop, t, W, H);
        pg.clearRect(0, 0, W, H);
        pg.save();
        pg.translate(W, 0);
        pg.scale(-1, 1);
        pg.globalCompositeOperation = 'source-over';
        pg.drawImage(v, ...rect);
        pg.globalCompositeOperation = 'destination-in';
        pg.drawImage(masker.canvas, ...rect);
        pg.restore();
        g.drawImage(personRef.current, 0, 0);
      } else if (hasVideo) {
        g.save();
        g.translate(W, 0);
        g.scale(-1, 1);
        if (!wide) {
          // Fill the sides with a soft, dark copy of the picture.
          g.globalAlpha = 0.35;
          g.drawImage(v, ...coverRect(v.videoWidth, v.videoHeight));
          g.globalAlpha = 1;
        }
        g.drawImage(v, ...rect);
        g.restore();
      }
      weatherRef.current?.update(dt);
      weatherRef.current?.draw(g);
      applyLook(g, f.look, W, H, t);
      drawFrame(g, f.frame, W, H, t, { channelName, title: brief.title, viewers: viewers.current + Math.floor(t * 3) % 500 });
      drawStickers(g, stickersRef.current, t);
      frameNo++;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [brief.title, channelName]);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      try {
        if (recRef.current?.state === 'recording') recRef.current.stop();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
    },
    []
  );

  // ---- stickers: tap a sticker to remove it, drag to move it
  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const onDown = (e) => {
    const [x, y] = toCanvas(e);
    const s = stickerAt(stickersRef.current, x, y);
    if (!s) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id: s.id, dx: s.x - x, dy: s.y - y, moved: false };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const [x, y] = toCanvas(e);
    d.moved = true;
    setStickers((list) => list.map((s) => (s.id === d.id ? { ...s, x: x + d.dx, y: y + d.dy } : s)));
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) setStickers((list) => list.filter((s) => s.id !== d.id));
  };
  const addSticker = (emoji) => {
    usedFx.current.add(`sticker:${emoji}`);
    setStickers((list) => [...list.slice(-7), { id: Date.now() % 100000, emoji, x: 260 + Math.random() * (W - 520), y: 160 + Math.random() * (H - 360), size: 120 }]);
  };

  const choose = (key, id) => {
    unlockAudio();
    setFx((f) => ({ ...f, [key]: id }));
  };

  // ---- recording
  // Tap record: the Director gives a quick reminder of their story, then 3-2-1.
  const begin = async () => {
    unlockAudio();
    primeDirectorAudio();
    const words = recapLine(brief, plan, little);
    setRecap(words);
    setState('recap');
    const a = audioRef.current;
    if (a) a.volume = 0.06;
    try {
      await Promise.race([say(words), new Promise((r) => setTimeout(r, 15000))]);
    } catch {
      /* carry on */
    }
    if (a) a.volume = 0.22;
    setRecap(null);
    countdown();
  };

  const countdown = () => {
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
    let stream;
    try {
      const canvasStream = canvasRef.current.captureStream(30);
      stream = new MediaStream([...canvasStream.getVideoTracks(), ...streamRef.current.getAudioTracks()]);
    } catch {
      stream = streamRef.current; // effects won't be recorded, but the take still works
    }
    chunks.current = [];
    let rec;
    try {
      // A smaller file uploads much faster (still sharp at 720p).
      rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 128_000 });
    } catch {
      rec = new MediaRecorder(stream);
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

  const stop = useCallback(() => {
    clearInterval(timer.current);
    if (recRef.current?.state === 'recording') recRef.current.stop();
  }, []);

  const retake = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setState('ready');
  };

  const useTake = () => {
    greenlight();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.pause();
    onDone(take, { ...fx, stickers: stickers.map((s) => s.emoji), used: [...usedFx.current] });
  };

  const current = TABS.find((t) => t.id === tab);
  const left = Math.max(0, MAX_SECONDS - secs);
  const ring = 2 * Math.PI * 44;
  const live = state === 'ready' || state === 'recap' || state === 'countdown' || state === 'recording';

  return (
    <div className={`screen studio-cam ${little ? 'is-little' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back" disabled={state === 'recording'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className={`rec-chip ${state === 'recording' ? 'on' : ''}`}>
          <span className="rec-dot" />
          {state === 'recording' ? 'REC' : state === 'review' ? 'PLAYBACK' : 'CAMERA'}
          <span className="tc">0:{String(state === 'review' ? take?.seconds ?? 0 : secs).padStart(2, '0')} / 1:00</span>
        </div>
        <button className={`icon-btn ${musicOn ? 'on-music' : ''}`} onClick={() => setMusicOn((m) => !m)} aria-label="Music on or off">
          {musicOn ? '🔊' : '🔇'}
        </button>
      </header>

      <main className="cam-main">
        <div className="cam-stage">
        {state !== 'review' && (brief.keywords || []).length > 0 && (
          // Their secret words, beside the picture (not recorded into the video).
          <aside className={`secret-words ${state === 'recording' ? 'live' : ''}`} aria-label="Your secret words">
            <span className="secret-title">{little ? 'Say it!' : 'Say your secret words!'}</span>
            {brief.keywords.map((w) => (
              <span key={w} className="secret-word">
                {w}
              </span>
            ))}
          </aside>
        )}
        <div className={`viewfinder ${state === 'recording' ? 'rec' : ''} ${state === 'countdown' || state === 'recap' ? 'counting' : ''}`}>
          {/* The live camera sits under the effects picture; iPads only keep it playing if it's really on screen. */}
          <video ref={videoRef} className="cam-source" muted playsInline autoPlay />
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className={state === 'review' ? 'gone' : ''}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          {state === 'review' && take && (
            <video
              key={take.url}
              className="review"
              src={take.url}
              controls
              playsInline
              autoPlay
              // Hear the backing music with the take, like the finished edit.
              onPlay={(e) => {
                const a = audioRef.current;
                if (!a || !musicOn) return;
                a.currentTime = e.currentTarget.currentTime % (a.duration || 1e9);
                a.volume = 0.25;
                a.play().catch(() => {});
              }}
              onPause={() => audioRef.current?.pause()}
              onEnded={() => audioRef.current?.pause()}
            />
          )}
          {(state === 'init' || state === 'denied' || state === 'starting') && (
            <div className="vf-overlay">
              {state === 'denied' && <div className="notice">{error}</div>}
              {state === 'starting' ? (
                <div className="cam-starting">
                  Starting the camera…
                  {slow && <small>If nothing happens, tap Allow if the iPad asks, or check Settings → Safari → Camera.</small>}
                </div>
              ) : (
                <button className="big-btn primary huge" onClick={openCamera}>
                  🎥 Camera on
                </button>
              )}
            </div>
          )}
          {needTap && state !== 'review' && (
            <div className="vf-overlay">
              <button className="big-btn primary huge" onClick={() => { unlockAudio(); startPicture(); }}>
                👆 Tap to start the camera
              </button>
            </div>
          )}
          {state === 'countdown' && <div className="count">{count}</div>}
          {state === 'recap' && recap && (
            <div className="recap">
              <span>🎬 THE DIRECTOR</span>
              {recap}
            </div>
          )}
          {state === 'recording' && left <= 10 && <div className="time-warn">{left}</div>}
          {live && plan?.ending && (
            <div className="ending-note">
              <span>BIG ENDING</span> {plan.ending}
            </div>
          )}
          {seg === 'loading' && fx.backdrop !== 'none' && <div className="seg-note">Setting up the backdrop…</div>}
          {seg === 'failed' && fx.backdrop !== 'none' && <div className="seg-note">Backdrops need internet. Try again soon!</div>}
        </div>
        </div>
        {error && state !== 'denied' && <div className="notice">{error}</div>}
      </main>

      {(state === 'ready' || state === 'init' || state === 'denied') && (
        <section className="tray">
          <div className="tray-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tray-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                <span className="tray-icon">{t.icon}</span>
                {!little && <span>{t.name}</span>}
              </button>
            ))}
          </div>
          <div className="tray-options">
            {tab === 'stickers'
              ? STICKER_EMOJI.map((e) => (
                  <button key={e} className="opt" onClick={() => addSticker(e)}>
                    <span className="opt-icon">{e}</span>
                  </button>
                ))
              : current.list.map((o) => (
                  <button key={o.id} className={`opt ${fx[tab] === o.id ? 'on' : ''}`} onClick={() => choose(tab, o.id)}>
                    <span className="opt-icon">{o.icon}</span>
                    {!little && <span className="opt-name">{o.name}</span>}
                  </button>
                ))}
            {tab === 'stickers' && stickers.length > 0 && <div className="opt-hint">Tap a sticker on screen to remove it, or drag it</div>}
          </div>
        </section>
      )}

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
      <audio ref={audioRef} preload="auto" />
    </div>
  );
}
