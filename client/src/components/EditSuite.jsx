import React, { useEffect, useRef, useState } from 'react';
import { api, uploadVideo } from '../api.js';
import { greenlight, coin } from '../sfx.js';

const STEPS = ['Adding the intro…', 'Cutting your best bits…', 'Dropping the beat…', 'Writing captions…', 'Adding special effects…', 'Polishing…'];
const TROPHY_NAMES = { rising: 'Rising Star', hitmaker: 'Super Star', mega: 'Mega Star' };

// Upload → the server edits (intro, captions, effects, music, sing-along) → watch → remix (once) → post.
export default function EditSuite({ brief, plan, take, existing, title, track, onDone, onRetake }) {
  const [phase, setPhase] = useState('uploading'); // uploading | editing | ready | posting | posted | failed
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const idRef = useRef(null);
  const poll = useRef(null);
  const started = useRef(false);

  const watch = (id) => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const { video: v } = await api.get(`/api/kid/videos/${id}`);
        if (v.status === 'ready') {
          clearInterval(poll.current);
          setVideo(v);
          setPhase('ready');
          greenlight();
        } else if (v.status === 'failed') {
          clearInterval(poll.current);
          setError(v.renderError || 'The edit failed');
          setPhase('failed');
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
  };

  useEffect(() => {
    if (started.current) return undefined;
    started.current = true;
    if (existing) {
      // Coming back to an edit made earlier today.
      idRef.current = existing.id;
      if (existing.status === 'ready') {
        setVideo(existing);
        setPhase('ready');
      } else {
        setPhase('editing');
        watch(existing.id);
      }
      return () => clearInterval(poll.current);
    }
    (async () => {
      try {
        const { id } = await api.post('/api/kid/videos', { plan, title, track, seconds: take.seconds });
        idRef.current = id;
        // Once the upload is through, show "Editing" while the server edits (the request stays open).
        await uploadVideo(`/api/kid/videos/${id}/raw`, take.blob, (p) => {
          setProgress(p);
          if (p >= 0.999) setPhase('editing');
        });
        setPhase('editing');
        watch(id);
      } catch (e) {
        setError(e.message);
        setPhase('failed');
      }
    })();
    return () => clearInterval(poll.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'editing') return undefined;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1800);
    return () => clearInterval(t);
  }, [phase]);

  const remix = async () => {
    try {
      setVideo(null);
      setPhase('editing');
      watch(idRef.current);
      await api.post(`/api/kid/videos/${idRef.current}/remix`); // stays open while the remix is made
    } catch (e) {
      setError(e.message);
    }
  };

  const post = async () => {
    setPhase('posting');
    try {
      const r = await api.post(`/api/kid/videos/${idRef.current}/post`);
      setResult(r);
      setPhase('posted');
      coin();
    } catch (e) {
      setError(e.message);
      setPhase('ready');
    }
  };

  return (
    <div className="screen edit-suite">
      <main className="suite-main">
        {(phase === 'uploading' || phase === 'editing') && (
          <div className="suite-working">
            {take?.url ? (
              // Something to watch while the edit is made: their own take, on a loop.
              <video className="suite-peek" src={take.url} muted autoPlay loop playsInline />
            ) : (
              <div className="reel-spin" aria-hidden>
                <span />
              </div>
            )}
            <h1 className="suite-title">{phase === 'uploading' ? 'Sending to the edit suite' : 'Editing your video'}</h1>
            <div className="suite-step">{phase === 'uploading' ? `${Math.round(progress * 100)}%` : STEPS[step]}</div>
            <div className="meter suite-meter">
              <div className="meter-fill" style={{ width: `${phase === 'uploading' ? progress * 100 : 100}%` }} />
            </div>
          </div>
        )}

        {(phase === 'ready' || phase === 'posting') && video && (
          <>
            <div className="gl-kicker">{(video.title || brief.title).toUpperCase()}</div>
            <video className="final-video" src={video.finalUrl} poster={video.thumbUrl} controls playsInline autoPlay />
            {error && <div className="notice">{error}</div>}
            <div className="row-btns">
              {video.remixesLeft > 0 && (
                <button className="big-btn ghost" onClick={remix} disabled={phase === 'posting'}>
                  🎛️ Remix it
                </button>
              )}
              <button className="big-btn primary huge" onClick={post} disabled={phase === 'posting'}>
                🚀 Post it!
              </button>
            </div>
          </>
        )}

        {phase === 'posted' && result && (
          <div className="posted">
            {result.viral && <div className="viral-badge">🔥 VIRAL HIT · DOUBLE DIBBLY DOBS</div>}
            <h1 className="gl-title">POSTED!</h1>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-num">{result.streak}🔥</div>
                <div className="stat-label">day streak</div>
              </div>
              <div className="stat">
                <div className="stat-num">+{result.gained?.dobs || 0}</div>
                <div className="stat-label">Dibbly Dobs</div>
              </div>
              {result.keywordsSaid?.length > 0 && (
                <div className="stat">
                  <div className="stat-num">{result.keywordsSaid.length}</div>
                  <div className="stat-label">unlock words said</div>
                </div>
              )}
            </div>
            {result.newTrophies?.map((t) => (
              <div key={t} className="trophy-new">
                🏆 New trophy: {TROPHY_NAMES[t] || t}!
              </div>
            ))}
            <p className="muted-line">A grown-up will check it, then it premieres to your crew.</p>
            <button className="big-btn primary" onClick={onDone}>
              Back to the studio
            </button>
          </div>
        )}

        {phase === 'failed' && (
          <div className="suite-working">
            <h1 className="suite-title">Uh oh, the edit got stuck</h1>
            <div className="notice">{error}</div>
            <div className="row-btns">
              <button className="big-btn ghost" onClick={onRetake}>
                Film again
              </button>
              <button className="big-btn primary" onClick={onDone}>
                Back to the studio
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
