import React, { useEffect, useState } from 'react';

// A video that recovers by itself: if it won't load (a missing file being rebuilt, a stale link,
// a blip), it says so kindly and tries again, instead of showing a broken play button.
export default function Video({ src, poster, className, autoPlay = false, preload = 'none' }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);
  useEffect(() => {
    if (!failed || attempt >= 8) return undefined;
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      setFailed(false);
    }, 12000);
    return () => clearTimeout(t);
  }, [failed, attempt]);
  if (!src) return null;
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}try=${attempt}` : src;
  return (
    <div className={`video-wrap ${className || ''}`}>
      <video key={url} className={className} src={url} poster={poster} controls playsInline autoPlay={autoPlay} preload={attempt ? 'auto' : preload} onError={() => setFailed(true)} />
      {failed && (
        <div className="video-fixing">
          {attempt >= 8 ? 'This video can’t be played right now. Ask a grown-up to check it.' : '🛠️ Getting your video ready… it’ll play in a moment'}
        </div>
      )}
    </div>
  );
}
