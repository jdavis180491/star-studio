import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { VoiceCall } from '../components/DirectorCall.jsx';
import ReadScreen from '../components/ReadScreen.jsx';
import { DobReward } from '../components/Dob.jsx';
import { SectionHeader } from './common.jsx';

// Reading: chat with Story Buddy → Claude writes a story at your level → read it aloud → Dibbly Dobs.
export default function Reading({ kid, rules, onBack, onKid }) {
  const [phase, setPhase] = useState('home'); // home | call | writing | read | reward
  const [stories, setStories] = useState(null);
  const [story, setStory] = useState(null);
  const [reward, setReward] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get('/api/kid/stories').then((d) => setStories(d.stories)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const afterCall = async (ideas) => {
    setPhase('writing');
    try {
      const { story: s } = await api.post('/api/kid/story/create', { ideas });
      setStory(s);
      setPhase('read');
    } catch (e) {
      setError(e.message);
      setPhase('home');
    }
  };

  const afterRead = async (stats) => {
    try {
      const r = await api.post(`/api/kid/stories/${story.id}/read`, { stats });
      onKid({ ...kid, dobs: r.dobs });
      setReward(r);
      setPhase('reward');
    } catch (e) {
      setError(e.message);
      setPhase('home');
    }
  };

  if (phase === 'call') {
    return (
      <VoiceCall
        turnUrl="/api/kid/story/turn"
        name="STORY BUDDY"
        variant="buddy"
        hint="Call Story Buddy and make up a story together"
        onBack={() => setPhase('home')}
        onDone={afterCall}
      />
    );
  }
  if (phase === 'writing') {
    return (
      <div className="screen center">
        <div className="book-spin" aria-hidden>
          📖
        </div>
        <h1 className="suite-title">Writing your story…</h1>
        <div className="muted-line">Story Buddy is putting in your ideas</div>
      </div>
    );
  }
  if (phase === 'read' && story) {
    const brief = { ...story, ageGroup: kid.track === 'little' ? 'little' : 'star', track: kid.track, emoji: story.picture, source: 'story' };
    return (
      <ReadScreen
        key={story.id}
        mode="story"
        brief={brief}
        coins={kid.dobs}
        helpCost={rules?.helpCost || 0}
        onHelp={(word) => api.post('/api/kid/help', { word }).then((r) => onKid({ ...kid, dobs: r.dobs })).catch(() => {})}
        onBack={() => setPhase('home')}
        onUnlocked={afterRead}
      />
    );
  }
  if (phase === 'reward' && reward) {
    return (
      <DobReward
        earned={reward.gained?.dobs || 0}
        total={reward.dobs}
        title="STORY READ!"
        sub={story?.title}
        onDone={() => {
          setPhase('home');
          load();
        }}
      />
    );
  }

  return (
    <main className="section-main">
      <SectionHeader icon="📖" title="Reading" onBack={onBack} />
      {error && <div className="notice">{error}</div>}
      <button className="hero-tile reading" onClick={() => setPhase('call')}>
        <span className="hero-tile-icon">📞</span>
        <span className="hero-tile-text">
          <small>NEW STORY</small>
          Make up a story with Story Buddy
        </span>
        <span className="hero-tile-go">GO</span>
      </button>
      <h2 className="sub-head">My stories</h2>
      {!stories && <div className="loading">Loading…</div>}
      {stories && !stories.length && <div className="muted-line">Your stories will live here. Read them again any time!</div>}
      <div className="story-grid">
        {stories?.map((s) => (
          <button
            key={s.id}
            className="story-card"
            onClick={() => {
              setStory(s);
              setPhase('read');
            }}
          >
            <span className="story-pic">{s.picture}</span>
            <span className="story-title">{s.title}</span>
            <span className="story-meta">Read {s.reads}× · read again ➜</span>
          </button>
        ))}
      </div>
    </main>
  );
}
