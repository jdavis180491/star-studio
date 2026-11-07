import React from 'react';

export function Logo({ small }) {
  return (
    <div className={`logo ${small ? 'logo-small' : ''}`}>
      <svg className="logo-mark" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21.1l1.6-7L2 9.3l7.1-.7z" />
      </svg>
      <span>STAR STUDIO</span>
    </div>
  );
}

export function CoinPill({ coins, bump }) {
  return (
    <div className={`coin-pill ${bump ? 'bump' : ''}`} aria-label={`${coins} coins`}>
      <span className="coin" aria-hidden />
      {coins}
    </div>
  );
}

export function formatCount(n) {
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
