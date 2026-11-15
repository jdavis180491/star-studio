import React, { useCallback, useEffect, useState } from 'react';
import Video from './Video.jsx';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';

// Premiere feed (revealed together when everyone has posted, or at 6pm),
// sticker reactions, awards and Friday's Premiere Night.
export default function CrewTab({ kid }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [awardFor, setAwardFor] = useState(null);
  const [day, setDay] = useState(null); // null = today

  const load = useCallback(() => {
    api
      .get(`/api/kid/crew${day ? `?date=${day}` : ''}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [day]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (data?.premiereNight?.status !== 'rendering') return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.premiereNight?.status, load]);

  if (error) return <div className="notice">{error}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const react = async (videoId, sticker) => {
    await api.post('/api/kid/react', { videoId, sticker }).catch(() => {});
    load();
  };
  const giveAward = async (videoId, award) => {
    try {
      await api.post('/api/kid/award', { videoId, award });
      setAwardFor(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const startReel = async () => {
    await api.post('/api/kid/premiere-night').catch((e) => setError(e.message));
    load();
  };

  const hoursLeft = Math.max(0, data.premiereHour - data.hourNow);
  const isToday = data.date === data.today;

  return (
    <main className="crew-main">
      <div className="crew-head">
        <h1 className="hero-title small">{data.crew ? data.crew.name : 'My premieres'}</h1>
        {data.crew && isToday && !data.revealed && (
          <div className="premiere-wait">
            🍿 Premiere {hoursLeft > 0 ? `in about ${hoursLeft}h (6pm)` : 'soon'} or when everyone has posted
          </div>
        )}
        {isToday && data.revealed && data.crew && <div className="premiere-live">🎉 PREMIERE IS LIVE</div>}
        {!data.crew && <div className="muted-line">Ask a grown-up to join a crew with your friends.</div>}
      </div>

      {data.days?.length > 1 && (
        <div className="day-picker" role="tablist" aria-label="Pick a day">
          {data.days.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === data.date}
              className={`day-chip ${d === data.date ? 'on' : ''}`}
              onClick={() => setDay(d === data.today ? null : d)}
            >
              {dayLabel(d, data.today)}
            </button>
          ))}
        </div>
      )}
      {!isToday && data.feed.length === 0 && <div className="muted-line">No videos from this day.</div>}

      <div className="feed">
        {data.feed.map((f) => (
          <div key={f.kid.id} className={`feed-card state-${f.state}`}>
            <div className="feed-who">
              <Avatar avatar={f.kid.avatar} size={44} />
              <span>{f.kid.channelName}</span>
              {f.awards.map((a) => (
                <span key={a} className="award-chip">
                  🏅 {data.awardTypes.find((t) => t.id === a)?.name}
                </span>
              ))}
            </div>
            {f.video ? (
              <>
                <Video className="feed-video" src={f.video.finalUrl} poster={f.video.thumbUrl} />
                <div className="feed-title">
                  {f.video.title}
                  {f.video.viral && <span className="trend">🔥 TRENDING</span>}
                </div>
                <div className="stickers">
                  {f.reactions.map((r) => (
                    <button key={r.sticker} className={`sticker ${r.mine ? 'mine' : ''}`} onClick={() => react(f.video.id, r.sticker)}>
                      {r.sticker} <span>{r.count || ''}</span>
                    </button>
                  ))}
                </div>
                {!f.me && isToday && data.revealed && !data.myAward && (
                  <button className="big-btn ghost small" onClick={() => setAwardFor(f.video.id)}>
                    🏅 Give an award
                  </button>
                )}
              </>
            ) : (
              <div className="feed-locked">
                {f.state === 'not-posted' && '⏳ Still filming…'}
                {f.state === 'waiting-approval' && '🔒 Waiting for a grown-up'}
                {f.state === 'locked' && '🍿 Ready for the premiere!'}
              </div>
            )}
          </div>
        ))}
      </div>


      {isToday && data.premiereNight.available && (
        <section className="premiere-night">
          <h2>🎬 Friday Premiere Night</h2>
          {data.premiereNight.url ? (
            <video className="feed-video" src={data.premiereNight.url} controls playsInline />
          ) : data.premiereNight.status === 'rendering' ? (
            <div className="muted-line">Making this week’s reel…</div>
          ) : (
            <button className="big-btn primary" onClick={startReel}>
              Make this week’s reel
            </button>
          )}
        </section>
      )}

      {awardFor && (
        <div className="sheet-backdrop" onClick={() => setAwardFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-kicker">GIVE ONE AWARD TODAY</div>
            <div className="sheet-actions column">
              {data.awardTypes.map((a) => (
                <button key={a.id} className="big-btn primary" onClick={() => giveAward(awardFor, a.id)}>
                  🏅 {a.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const DAY_MS = 86400000;
/** "Today", "Yesterday", then "Mon 10 Nov". */
function dayLabel(iso, today) {
  const back = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / DAY_MS);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
