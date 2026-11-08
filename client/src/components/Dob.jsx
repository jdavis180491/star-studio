import React, { useEffect, useState } from 'react';

let gid = 0;

/** A Dibbly Dob: a happy little blob with a sprout. */
export function DobIcon({ size = 28, mood = 'happy', className = '' }) {
  const [id] = useState(() => `dob${gid++}`);
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`dob-icon ${className}`} aria-hidden>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#f2ffb0" />
          <stop offset="0.45" stopColor="#c6ff3d" />
          <stop offset="1" stopColor="#57b000" />
        </radialGradient>
      </defs>
      <path d="M24 9c2-5 7-6 9-4-3 0-5 2-6 5" fill="none" stroke="#3c8f00" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 10c11 0 19 8 19 18 0 9-8 15-19 15S5 37 5 28c0-10 8-18 19-18z" fill={`url(#${id})`} stroke="#2f7000" strokeWidth="1.5" />
      <ellipse cx="17.5" cy="25" rx="4" ry="4.6" fill="#fff" />
      <ellipse cx="30.5" cy="25" rx="4" ry="4.6" fill="#fff" />
      <circle cx="18.4" cy="26" r="2.2" fill="#14141e" />
      <circle cx="31.4" cy="26" r="2.2" fill="#14141e" />
      {mood === 'happy' ? (
        <path d="M18 33q6 6 12 0" stroke="#14141e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      ) : (
        <ellipse cx="24" cy="34" rx="3" ry="3.5" fill="#14141e" />
      )}
      <circle cx="12" cy="31" r="2.4" fill="#ff7aa0" opacity=".6" />
      <circle cx="36" cy="31" r="2.4" fill="#ff7aa0" opacity=".6" />
    </svg>
  );
}

export function DobPill({ dobs, bump }) {
  return (
    <div className={`dob-pill ${bump ? 'bump' : ''}`} aria-label={`${dobs} Dibbly Dobs`}>
      <DobIcon size={30} />
      <span>{dobs}</span>
    </div>
  );
}

export function DobsLogo({ small }) {
  return (
    <div className={`logo dobs-logo ${small ? 'logo-small' : ''}`}>
      <DobIcon size={small ? 34 : 44} />
      <span>
        DIBBLY <b>DOBS</b>
      </span>
    </div>
  );
}

/** Full-screen "you earned Dibbly Dobs!" moment. */
export function DobReward({ earned, total, title = 'Nice one!', sub, onDone, extra }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!earned) return undefined;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= earned) clearInterval(t);
    }, Math.max(120, 700 / earned));
    return () => clearInterval(t);
  }, [earned]);
  return (
    <div className="screen center dob-reward">
      <div className="dob-burst">
        {Array.from({ length: Math.min(earned || 1, 12) }, (_, i) => (
          <span key={i} style={{ '--a': `${(i / Math.min(earned || 1, 12)) * 360}deg`, animationDelay: `${i * 0.08}s` }}>
            <DobIcon size={44} />
          </span>
        ))}
        <DobIcon size={150} className="dob-hero" />
      </div>
      <h1 className="gl-title">{title}</h1>
      {earned > 0 ? (
        <div className="dob-earned">
          +{shown} Dibbly Dob{earned === 1 ? '' : 's'}
        </div>
      ) : (
        <div className="muted-line">Great practice!</div>
      )}
      {sub && <div className="muted-line">{sub}</div>}
      {extra}
      <div className="muted-line">You have {total} Dibbly Dobs</div>
      <button className="big-btn primary" onClick={onDone}>
        Brilliant ➜
      </button>
    </div>
  );
}
