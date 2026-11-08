import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { coin, wrong } from '../sfx.js';
import { DobIcon } from './Dob.jsx';

const OPTIONS = {
  skin: ['s1', 's2', 's3', 's4', 's5', 's6'],
  hair: ['short', 'curly', 'long', 'bun', 'spiky', 'bald'],
  hairColor: ['black', 'brown', 'blonde', 'ginger', 'blue', 'pink'],
  eyes: ['happy', 'wide', 'wink'],
  topColor: ['pink', 'lime', 'cyan', 'orange', 'purple', 'black'],
  bg: ['sunset', 'ocean', 'galaxy', 'lime'],
};
const LABELS = { skin: 'Skin', hair: 'Hair', hairColor: 'Hair colour', eyes: 'Eyes', topColor: 'Top colour', bg: 'Background' };
const DECOR_ICONS = {
  'decor-plant': '🪴', 'decor-poster': '🪐', 'decor-rug': '🟣', 'decor-lava': '🌋', 'decor-fairy': '✨',
  'decor-neon': '⭐', 'decor-ringlight': '💡', 'decor-chair': '🪑', 'decor-cat': '🐈', 'decor-disco': '🪩',
};
const ITEM_ICONS = {
  'top-tee': '👕', 'top-hoodie': '🧥', 'top-jacket': '🧥', 'top-sport': '🎽', 'top-sparkle': '✨',
  'hat-cap': '🧢', 'hat-beanie': '🧶', 'hat-headphones': '🎧', 'hat-wizard': '🧙', 'hat-crown': '👑',
  'glasses-shades': '🕶️', 'glasses-hearts': '😍', 'glasses-stars': '🤩', 'glasses-visor': '🥽', ...DECOR_ICONS,
};
const TROPHIES = [
  { id: 'rising', name: 'Rising Star', at: 50, color: '#cd7f32' },
  { id: 'hitmaker', name: 'Super Star', at: 250, color: '#c0c7d4' },
  { id: 'mega', name: 'Mega Star', at: 1000, color: '#ffd400' },
];

export default function StudioTab({ kid, onKid }) {
  const [shop, setShop] = useState(null);
  const [mode, setMode] = useState('room'); // room | look | shop
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/api/kid/shop').then(setShop);
  }, []);
  if (!shop) return <div className="loading">Loading…</div>;

  const owned = new Set(shop.owned);
  const avatar = kid.avatar;

  const saveAvatar = async (patch) => {
    const out = await api.put('/api/kid/avatar', { avatar: { ...avatar, ...patch } });
    onKid({ ...kid, avatar: out.avatar });
  };

  const buy = async (item) => {
    try {
      const out = await api.post('/api/kid/shop/buy', { itemId: item.id });
      coin();
      setShop({ ...shop, owned: out.owned, dobs: out.dobs });
      onKid({ ...kid, dobs: out.dobs, owned: out.owned });
      setMsg(`${item.name} is yours!`);
      if (item.type === 'decor') {
        const decor = [...kid.decor, item.id];
        const d = await api.put('/api/kid/decor', { decor });
        onKid({ ...kid, dobs: out.dobs, owned: out.owned, decor: d.decor });
      } else {
        const slot = item.type;
        const value = item.id.replace(`${slot}-`, '');
        const a = await api.put('/api/kid/avatar', { avatar: { ...avatar, [slot]: value } });
        onKid({ ...kid, dobs: out.dobs, owned: out.owned, avatar: a.avatar });
      }
    } catch (e) {
      wrong();
      setMsg(e.message);
    }
  };

  const toggleDecor = async (id) => {
    const decor = kid.decor.includes(id) ? kid.decor.filter((d) => d !== id) : [...kid.decor, id];
    const d = await api.put('/api/kid/decor', { decor });
    onKid({ ...kid, decor: d.decor });
  };

  const wear = (item) => {
    const slot = item.type;
    const value = item.id.replace(`${slot}-`, '');
    saveAvatar({ [slot]: avatar[slot] === value && slot !== 'top' ? null : value });
  };

  return (
    <main className="studio-main">
      <div className="seg">
        {[
          ['room', 'My studio'],
          ['look', 'My look'],
          ['shop', 'Shop'],
          ['dobs', 'My Dobs'],
        ].map(([id, name]) => (
          <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>
            {name}
          </button>
        ))}
      </div>
      {msg && <div className="toast-line">{msg}</div>}

      {mode === 'room' && (
        <div className="room">
          <div className="room-wall">
            {kid.decor.includes('decor-neon') && <div className="decor neon">⭐ {kid.channelName}</div>}
            {kid.decor.includes('decor-fairy') && <div className="decor fairy">✨✨✨✨✨✨✨✨</div>}
            {kid.decor.includes('decor-poster') && <div className="decor poster">🪐</div>}
            {kid.decor.includes('decor-disco') && <div className="decor disco">🪩</div>}
            <div className="shelf">
              {TROPHIES.map((t) => {
                const has = kid.trophies.includes(t.id);
                return (
                  <div key={t.id} className={`trophy ${has ? 'has' : ''}`} title={t.name}>
                    <svg viewBox="0 0 60 80" width="56" height="74" aria-hidden>
                      <path d="M30 4l7 14 15 2-11 11 3 15-14-7-14 7 3-15L8 20l15-2z" fill={has ? t.color : 'rgba(255,255,255,.12)'} />
                      <rect x="24" y="48" width="12" height="14" fill={has ? t.color : 'rgba(255,255,255,.12)'} />
                      <rect x="14" y="62" width="32" height="10" rx="3" fill={has ? '#2a2a38' : 'rgba(255,255,255,.08)'} />
                    </svg>
                    <span>{has ? t.name : `Earn ${t.at.toLocaleString()} Dobs`}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="room-floor">
            {kid.decor.includes('decor-plant') && <span className="decor big">🪴</span>}
            {kid.decor.includes('decor-lava') && <span className="decor big">🌋</span>}
            {kid.decor.includes('decor-ringlight') && <span className="decor big">💡</span>}
            <span className="room-me">
              <Avatar avatar={avatar} size={150} />
            </span>
            {kid.decor.includes('decor-chair') && <span className="decor big">🪑</span>}
            {kid.decor.includes('decor-cat') && <span className="decor big">🐈</span>}
            {kid.decor.includes('decor-rug') && <div className="rug" />}
          </div>
          <div className="room-stats">
            <span>🟢 {(kid.dobsEarned || 0).toLocaleString()} Dobs earned</span>
            <span>🔥 best streak {kid.bestStreak}</span>
          </div>
          {shop.owned.some((id) => id.startsWith('decor-')) && (
            <div className="opt-row">
              {shop.owned.filter((id) => id.startsWith('decor-')).map((id) => (
                <button key={id} className={`opt ${kid.decor.includes(id) ? 'on' : ''}`} onClick={() => toggleDecor(id)}>
                  <span className="opt-icon">{DECOR_ICONS[id]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'dobs' && <DobHistory />}

      {mode === 'look' && (
        <div className="look-editor">
          <Avatar avatar={avatar} size={180} ring />
          {Object.entries(OPTIONS).map(([key, opts]) => (
            <div key={key} className="look-row">
              <span className="look-label">{LABELS[key]}</span>
              <div className="look-opts">
                {opts.map((o) => (
                  <button key={o} className={`look-opt ${avatar[key] === o ? 'on' : ''}`} onClick={() => saveAvatar({ [key]: o })}>
                    <Avatar avatar={{ ...avatar, [key]: o }} size={54} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="look-row">
            <span className="look-label">Wear</span>
            <div className="look-opts">
              {shop.items
                .filter((i) => i.type !== 'decor' && owned.has(i.id))
                .map((i) => {
                  const on = avatar[i.type] === i.id.replace(`${i.type}-`, '');
                  return (
                    <button key={i.id} className={`look-opt ${on ? 'on' : ''}`} onClick={() => wear(i)}>
                      <span className="opt-icon">{ITEM_ICONS[i.id]}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {mode === 'shop' && (
        <div className="shop-grid">
          {shop.items
            .filter((i) => i.price > 0)
            .map((i) => {
              const has = owned.has(i.id);
              return (
                <button key={i.id} className={`shop-item ${has ? 'owned' : ''}`} onClick={() => !has && buy(i)} disabled={has}>
                  <span className="shop-icon">{ITEM_ICONS[i.id]}</span>
                  <span className="shop-name">{i.name}</span>
                  <span className="shop-price">{has ? 'Owned ✓' : <><DobIcon size={22} /> {i.price}</>}</span>
                </button>
              );
            })}
        </div>
      )}
    </main>
  );
}

export function ChannelTab({ kid }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/api/kid/channel').then(setData);
  }, []);
  if (!data) return <div className="loading">Loading…</div>;
  const label = { submitted: 'Waiting for a grown-up', approved: 'Premiered', rejected: 'Not approved', ready: 'Not posted' };
  return (
    <main className="channel-main">
      <div className="channel-head">
        <Avatar avatar={kid.avatar} size={96} ring />
        <div>
          <h1 className="hero-title small">{kid.channelName}</h1>
          <div className="muted-line">
            {data.videos.filter((v) => v.status === 'approved').length} videos
          </div>
        </div>
      </div>
      {!data.videos.length && <div className="muted-line">Your videos will appear here.</div>}
      <div className="video-grid">
        {data.videos.map((v) => (
          <div key={v.id} className="video-card">
            {v.finalUrl ? <video src={v.finalUrl} poster={v.thumbUrl} controls playsInline preload="none" /> : <div className="video-ph">🎬</div>}
            <div className="video-meta">
              <b>{v.title}</b>
              <span className={`badge ${v.status}`}>{label[v.status] || v.status}</span>
              {v.viral && <span className="trend">🔥 TRENDING</span>}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

const TYPE_LABEL = {
  studio: 'Star Studio video', reading: 'Read a story', writing: 'Wrote a story', continue: 'Continued a story',
  award: 'Award from a friend 🏅', spelling: 'Spelling', 'maths-addition': 'Addition', 'maths-subtraction': 'Subtraction', 'maths-bonds': 'Number bonds',
  'maths-times': 'Times tables', buy: 'Shop', help: 'Word help', 'parent-good': 'Good behaviour 🌟',
  'parent-naughty': 'Naughty 😬', 'parent-spent': 'Spent at the shops 🛍️', 'parent-other': 'From a grown-up',
};

function DobHistory() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/api/kid/dobs').then(setData);
  }, []);
  if (!data) return <div className="loading">Loading…</div>;
  return (
    <div className="dob-history">
      <div className="dob-balance">
        <DobIcon size={72} />
        <div>
          <b>{data.dobs}</b>
          <span>Dibbly Dobs</span>
        </div>
      </div>
      {!data.history.length && <div className="muted-line">Earn Dibbly Dobs by reading, writing, spelling, maths and Star Studio!</div>}
      {data.history.map((h) => (
        <div key={h.id} className="dob-row">
          <span className={`dob-amt ${h.dobs > 0 ? 'plus' : 'minus'}`}>
            {h.dobs > 0 ? '+' : ''}
            {h.dobs}
          </span>
          <span className="dob-what">
            <b>{TYPE_LABEL[h.type] || h.type}</b>
            <span>{h.note || h.what}</span>
          </span>
          <span className="dob-when">{new Date(h.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
      ))}
    </div>
  );
}

export function Leaderboard({ kid }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/api/kid/leaderboard').then(setData);
  }, []);
  if (!data) return <div className="loading">Loading…</div>;
  return (
    <main className="section-main">
      <h1 className="hero-title small">Leaderboard</h1>
      <div className="muted-line">Dibbly Dobs earned this week{data.crew ? ` · ${data.crew} + family` : ' · family'} · resets every Monday</div>
      <div className="podium">
        {data.rows.map((r, i) => (
          <div key={r.kidId} className={`podium-row ${r.kidId === kid.id ? 'me' : ''} p${i + 1}`}>
            <span className="pos">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
            <Avatar avatar={r.avatar} size={52} />
            <span className="league-name">{r.channelName}</span>
            <span className="podium-dobs">
              <DobIcon size={26} /> {r.weekDobs}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
