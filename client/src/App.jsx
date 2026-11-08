import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { DobsLogo } from './components/Dob.jsx';
import KidPicker from './components/KidPicker.jsx';
import Hub, { HomeTab, TodayTab } from './components/Hub.jsx';
import CrewTab from './components/CrewTab.jsx';
import StudioTab, { ChannelTab, Leaderboard } from './components/StudioTab.jsx';
import ReadScreen from './components/ReadScreen.jsx';
import WordMoment, { planWordMoment } from './components/WordMoment.jsx';
import DirectorCall from './components/DirectorCall.jsx';
import StudioCamera from './camera/StudioCamera.jsx';
import EditSuite from './components/EditSuite.jsx';
import Reading from './learn/Reading.jsx';
import Writing from './learn/Writing.jsx';
import Spelling from './learn/Spelling.jsx';
import Maths from './learn/Maths.jsx';
import { SectionHeader } from './learn/common.jsx';

// What a word-moment effect unlocks in the camera.
const FX_UNLOCKS = {
  lightning: { weather: 'storm' },
  confetti: { weather: 'confetti' },
  neon: { look: 'neon' },
  vhs: { look: 'retro' },
  glitch: { look: 'comic' },
  slowmo: { weather: 'snow' },
};

export default function App() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('home');
  const [section, setSection] = useState(null); // studio | reading | writing | spelling | maths
  const [studioTab, setStudioTab] = useState('today');
  const [screen, setScreen] = useState('hub'); // Star Studio full-screen steps
  const [today, setToday] = useState(null);
  const [rules, setRules] = useState(null);
  const [unread, setUnread] = useState(0);
  const [prod, setProd] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const loadMe = useCallback(() => api.get('/api/me').then(setMe).catch((e) => setError(e.message)), []);
  const loadToday = useCallback(
    () =>
      api
        .get('/api/kid/today')
        .then((t) => {
          setToday(t);
          setMe((m) => (m ? { ...m, kid: t.kid } : m));
        })
        .catch(() => {}),
    []
  );

  useEffect(() => {
    loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (!me?.kid || screen !== 'hub') return;
    loadToday();
    api.get('/api/kid/rules').then(setRules).catch(() => {});
    api.get('/api/kid/letters').then((d) => setUnread(d.inbox.filter((l) => l.unread).length)).catch(() => {});
  }, [me?.kid?.id, screen, section, loadToday]); // eslint-disable-line react-hooks/exhaustive-deps

  const kid = me?.kid;
  const setKid = (k) => setMe((m) => ({ ...m, kid: k }));
  const applyReward = (r) => r && setMe((m) => ({ ...m, kid: { ...m.kid, dobs: r.dobs ?? m.kid.dobs } }));

  if (error) return <Center><div className="notice">{error}</div></Center>;
  if (!me) return <Center><div className="loading">Loading…</div></Center>;
  if (!me.device) {
    return (
      <Center>
        <DobsLogo />
        <h1 className="hero-title small">Welcome to Dibbly Dobs</h1>
        <p className="muted-line">A grown-up needs to sign in on this iPad first.</p>
        <a className="big-btn primary" href="/parent">
          Grown-ups: sign in
        </a>
      </Center>
    );
  }
  if (!kid) return <KidPicker kids={me.kids} onIn={(k) => setKid(k)} />;

  const switchKid = async () => {
    await api.post('/api/kid/logout').catch(() => {});
    setProd(null);
    setScreen('hub');
    setSection(null);
    setTab('home');
    setToday(null);
    loadMe();
  };

  const home = () => {
    setSection(null);
    setTab('home');
  };
  const backToStudio = () => {
    setScreen('hub');
    setSection('studio');
    setStudioTab('today');
  };

  // ---- Star Studio's daily flow
  const start = (brief, track) => {
    const p = today?.progress || {};
    setProd({ brief, track, moment: planWordMoment(brief), plan: {}, title: brief.title });
    setAttempt((a) => a + 1);
    setScreen(!p.read ? 'read' : !p.word ? 'word' : 'call');
  };
  const afterRead = async (stats) => {
    setScreen('word');
    applyReward(await api.post('/api/kid/read', { briefTitle: prod.brief.title, stats }).catch(() => null));
  };
  const afterWord = async (result) => {
    const unlock = result.type === 'spell' ? FX_UNLOCKS[result.effect] || {} : {};
    setProd((p) => ({ ...p, word: result, title: result.title || p.title, unlock }));
    setScreen('call');
    applyReward(await api.post('/api/kid/word', { result }).catch(() => null));
  };
  const afterCall = (plan) => {
    setProd((p) => ({ ...p, plan: { ...plan, ...Object.fromEntries(Object.entries(p.unlock || {}).filter(([k]) => !plan[k] || plan[k] === 'none')) } }));
    setScreen('camera');
  };
  const afterCamera = (take, fx) => {
    setProd((p) => ({ ...p, take, plan: { ...p.plan, weather: fx.weather, backdrop: fx.backdrop, look: fx.look, frame: fx.frame, music: fx.music, stickers: fx.stickers } }));
    setScreen('suite');
  };

  if (screen === 'read' && prod) {
    return (
      <ReadScreen
        key={`read-${attempt}`}
        brief={prod.brief}
        coins={kid.dobs}
        onBack={backToStudio}
        onUnlocked={afterRead}
      />
    );
  }
  if (screen === 'word' && prod) return <WordMoment brief={prod.brief} moment={prod.moment} onDone={afterWord} />;
  if (screen === 'call' && prod) return <DirectorCall track={prod.track} onBack={backToStudio} onDone={afterCall} />;
  if (screen === 'camera' && prod) {
    return <StudioCamera brief={prod.brief} plan={prod.plan} channelName={kid.channelName} little={prod.track === 'little'} onBack={() => setScreen('call')} onDone={afterCamera} />;
  }
  if (screen === 'suite' && prod) {
    return (
      <EditSuite
        key={`suite-${attempt}-${prod.existing?.id || 'new'}`}
        brief={prod.brief}
        plan={prod.plan}
        take={prod.take}
        existing={prod.existing}
        title={prod.title}
        track={prod.track}
        onRetake={() => setScreen('camera')}
        onDone={() => {
          setProd(null);
          backToStudio();
          loadMe();
        }}
      />
    );
  }

  // ---- learning sections take the whole screen (they have their own back buttons)
  const sectionProps = { kid, rules, onKid: setKid, onBack: home };
  if (section === 'reading') return <Shell><Reading {...sectionProps} /></Shell>;
  if (section === 'writing') return <Shell><Writing {...sectionProps} /></Shell>;
  if (section === 'spelling') return <Shell><Spelling {...sectionProps} /></Shell>;
  if (section === 'maths') return <Shell><Maths {...sectionProps} /></Shell>;

  return (
    <Hub
      kid={kid}
      tab={section === 'studio' ? 'home' : tab}
      onTab={(t) => {
        setSection(null);
        setTab(t);
      }}
      onSwitch={switchKid}
    >
      {section === 'studio' ? (
        <>
          <SectionHeader
            icon="🎬"
            title="Star Studio"
            onBack={home}
            right={
              <div className="seg compact">
                {[
                  ['today', 'Today'],
                  ['crew', 'Crew'],
                  ['channel', 'My Channel'],
                ].map(([id, name]) => (
                  <button key={id} className={studioTab === id ? 'on' : ''} onClick={() => setStudioTab(id)}>
                    {name}
                  </button>
                ))}
              </div>
            }
          />
          {studioTab === 'today' && (
            <TodayTab
              kid={kid}
              today={today}
              onStart={start}
              onOpenVideo={(video) => {
                const track = Object.keys(today.briefs)[0];
                setProd({ brief: today.briefs[track], track, existing: video, plan: video.plan || {}, title: video.title });
                setScreen('suite');
              }}
            />
          )}
          {studioTab === 'crew' && <CrewTab kid={kid} />}
          {studioTab === 'channel' && <ChannelTab kid={kid} />}
        </>
      ) : tab === 'home' ? (
        <HomeTab kid={kid} today={today} unread={unread} rules={rules} onOpen={setSection} />
      ) : tab === 'leaderboard' ? (
        <Leaderboard kid={kid} />
      ) : (
        <StudioTab kid={kid} onKid={setKid} />
      )}
    </Hub>
  );
}

function Center({ children }) {
  return <div className="screen center">{children}</div>;
}

function Shell({ children }) {
  return <div className="screen learn-shell">{children}</div>;
}
