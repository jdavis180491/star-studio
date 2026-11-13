import React from 'react';

// A layered SVG avatar built from the kid's choices and shop items.
const SKIN = { s1: '#ffe0c7', s2: '#f6c79f', s3: '#e0a878', s4: '#c08457', s5: '#8d5a3b', s6: '#5c3a24' };
const HAIR = { black: '#1c1a22', brown: '#5a3820', blonde: '#e8c26a', ginger: '#c9562a', blue: '#3d7bff', pink: '#ff4f9a' };
const TOP = { pink: '#ff2e63', lime: '#9fdc1f', cyan: '#18b6d6', orange: '#ff8a00', purple: '#7a3cff', black: '#24242e' };
// Picture options for the login screen (the stored value is the name, not the emoji).
export const ICONS = {
  unicorn: '🦄', dragon: '🐉', dino: '🦖', cat: '🐱', dog: '🐶', fox: '🦊', panda: '🐼', bunny: '🐰',
  dolphin: '🐬', butterfly: '🦋', rocket: '🚀', star: '🌟', rainbow: '🌈', football: '⚽',
};
const BG = {
  sunset: ['#ff8a00', '#ff2e63'],
  ocean: ['#3de1ff', '#2a5bff'],
  galaxy: ['#7a1fff', '#14141e'],
  lime: ['#c6ff3d', '#1fae6b'],
};

export default function Avatar({ avatar = {}, size = 96, ring = false }) {
  const a = { skin: 's3', hair: 'short', hairColor: 'brown', eyes: 'happy', top: 'hoodie', topColor: 'pink', hat: null, glasses: null, bg: 'sunset', ...avatar };
  const skin = SKIN[a.skin] || SKIN.s3;
  const hair = HAIR[a.hairColor] || HAIR.brown;
  const top = TOP[a.topColor] || TOP.pink;
  const [b1, b2] = BG[a.bg] || BG.sunset;
  const id = `av${Math.round(size)}${a.bg}`;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={`avatar ${ring ? 'ring' : ''}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b1} />
          <stop offset="1" stopColor={b2} />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <circle cx="60" cy="60" r="58" />
        </clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${id})`} />
      {ICONS[a.icon] ? (
        <text x="60" y="64" textAnchor="middle" dominantBaseline="middle" fontSize="70">
          {ICONS[a.icon]}
        </text>
      ) : (
      <g clipPath={`url(#${id}c)`}>
        {/* body / outfit */}
        {a.top === 'jacket' && <path d="M18 120c2-24 18-34 42-34s40 10 42 34z" fill="#1d1d26" />}
        <path d="M24 120c2-20 16-30 36-30s34 10 36 30z" fill={top} />
        {a.top === 'hoodie' && <path d="M44 92c4 8 28 8 32 0" stroke="rgba(0,0,0,.25)" strokeWidth="4" fill="none" />}
        {a.top === 'sport' && <path d="M60 92v28M40 104h40" stroke="#fff" strokeWidth="4" />}
        {a.top === 'sparkle' && [30, 48, 70, 88].map((x, i) => <circle key={i} cx={x} cy={104 + (i % 2) * 8} r="3" fill="#fff" />)}
        {a.top === 'jacket' && <path d="M60 90v30" stroke="#c6ff3d" strokeWidth="3" />}
        {/* neck + head */}
        <rect x="52" y="74" width="16" height="16" rx="6" fill={skin} />
        <ellipse cx="60" cy="56" rx="24" ry="27" fill={skin} />
        {/* hair */}
        {a.hair === 'short' && <path d="M35 52c0-18 11-27 25-27s25 9 25 27c-6-8-14-12-25-12s-19 4-25 12z" fill={hair} />}
        {a.hair === 'curly' && [38, 46, 54, 62, 70, 78, 82, 36].map((x, i) => <circle key={i} cx={x} cy={i > 5 ? 46 : 32 + (i % 2) * 3} r="9" fill={hair} />)}
        {a.hair === 'long' && <path d="M34 54c0-20 12-29 26-29s26 9 26 29v30c-6-4-8-12-8-24-6-6-12-8-18-8s-12 2-18 8c0 12-2 20-8 24z" fill={hair} />}
        {a.hair === 'bun' && (
          <>
            <circle cx="60" cy="22" r="11" fill={hair} />
            <path d="M35 52c0-18 11-27 25-27s25 9 25 27c-6-8-14-12-25-12s-19 4-25 12z" fill={hair} />
          </>
        )}
        {a.hair === 'spiky' && <path d="M34 50l4-20 8 8 6-14 8 10 8-12 4 14 10-6-2 20c-6-6-14-9-24-9s-16 3-22 9z" fill={hair} />}
        {/* face */}
        {a.eyes === 'happy' && (
          <>
            <path d="M47 57q4-5 8 0M65 57q4-5 8 0" stroke="#1c1a22" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        )}
        {a.eyes === 'wide' && (
          <>
            <circle cx="51" cy="56" r="4" fill="#1c1a22" />
            <circle cx="69" cy="56" r="4" fill="#1c1a22" />
            <circle cx="52" cy="55" r="1.4" fill="#fff" />
            <circle cx="70" cy="55" r="1.4" fill="#fff" />
          </>
        )}
        {a.eyes === 'wink' && (
          <>
            <circle cx="51" cy="56" r="4" fill="#1c1a22" />
            <path d="M65 57q4-4 8 0" stroke="#1c1a22" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        )}
        <path d="M50 68q10 9 20 0" stroke="#1c1a22" strokeWidth="3" fill="#fff" strokeLinecap="round" />
        <circle cx="44" cy="66" r="4" fill="#ff7a9a" opacity=".45" />
        <circle cx="76" cy="66" r="4" fill="#ff7a9a" opacity=".45" />
        {/* glasses */}
        {a.glasses === 'shades' && <path d="M40 52h40v4c0 6-5 9-10 9s-8-3-9-8h-2c-1 5-4 8-9 8s-10-3-10-9z" fill="#111" />}
        {a.glasses === 'hearts' &&
          [50, 70].map((x) => <path key={x} d={`M${x} 62c-8-5-10-9-10-12a5 5 0 0110-1 5 5 0 0110 1c0 3-2 7-10 12z`} fill="#ff2e63" />)}
        {a.glasses === 'stars' &&
          [50, 70].map((x) => <path key={x} d={`M${x} 46l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z`} fill="#ffd400" stroke="#111" strokeWidth="1.5" />)}
        {a.glasses === 'visor' && <rect x="36" y="49" width="48" height="12" rx="6" fill="#3de1ff" opacity=".85" />}
        {/* hats */}
        {a.hat === 'cap' && (
          <>
            <path d="M34 42c2-14 13-20 26-20s24 6 26 20z" fill="#ff2e63" />
            <rect x="56" y="38" width="40" height="7" rx="3" fill="#c4173a" />
          </>
        )}
        {a.hat === 'beanie' && (
          <>
            <path d="M34 44c0-16 12-24 26-24s26 8 26 24z" fill="#3d7bff" />
            <rect x="32" y="40" width="56" height="9" rx="4" fill="#2a5bd6" />
            <circle cx="60" cy="18" r="6" fill="#fff" />
          </>
        )}
        {a.hat === 'headphones' && (
          <>
            <path d="M34 56c0-24 12-34 26-34s26 10 26 34" stroke="#24242e" strokeWidth="6" fill="none" />
            <rect x="28" y="50" width="12" height="20" rx="5" fill="#c6ff3d" />
            <rect x="80" y="50" width="12" height="20" rx="5" fill="#c6ff3d" />
          </>
        )}
        {a.hat === 'wizard' && (
          <>
            <path d="M36 38L60 0l24 38z" fill="#5a2bd6" />
            <circle cx="62" cy="20" r="3" fill="#ffd400" />
            <rect x="30" y="34" width="60" height="8" rx="4" fill="#3f1d99" />
          </>
        )}
        {a.hat === 'crown' && <path d="M38 36l4-18 10 10 8-14 8 14 10-10 4 18z" fill="#ffd400" stroke="#c99a00" strokeWidth="2" />}
      </g>
      )}
    </svg>
  );
}
