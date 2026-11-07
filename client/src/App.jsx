import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Logo } from './components/Bits.jsx';
import KidPicker from './components/KidPicker.jsx';
import Hub, { TodayTab } from './components/Hub.jsx';
import CrewTab from './components/CrewTab.jsx';
import StudioTab, { ChannelTab } from './components/StudioTab.jsx';
import ReadScreen from './components/ReadScreen.jsx';
import WordMoment, { planWordMoment } from './components/WordMoment.jsx';
import DirectorCall from './components/DirectorCall.jsx';
import StudioCamera from './camera/StudioCamera.jsx';
import EditSuite from './components/EditSuite.jsx';

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
  const [tab, setTab] = useState('today');
  const [screen, setScreen] = useState('hub');
  const [today, setToday] = useState(null);
  const [prod, setProd] = useState(null); // today's production in progress
  const [attempt, setAttempt] = useState(0);

  const loadMe = useCallback(() => api.get('/api/me').then(setMe).catch((e) => setError(e.message)), []);
  const loadToday = useCallback(() => api.get('/api/kid/today').then((t) => {
    setToday(t);
    setMe((m) => (m ? { ...m, kid: t.kid } : m));
  }).catch(() => {}), []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);
  useEffect(() => {
    if (me?.kid && screen === 'hub') loadToday();
  }, [me?.kid?.id, screen, loadToday]); // eslint-disable-line react-hooks/exhaustive-deps

  const kid = me?.kid;
  const setKid = (k) => setMe((m) => ({ ...m, kid: k }));
  const applyReward = (r) => r && setMe((m) => ({ ...m, kid: { ...m.kid, followers: r.followers ?? m.kid.followers, coins: r.coins ?? m.kid.coins } }));

  if (error) return <Center><div className="notice">{error}</div></Center>;
  if (!me) return <Center><div className="loading">Loading…</div></Center>;
  if (!me.device) {
    return (
      <Center>
        <Logo />
        <h1 className="hero-title small">Welcome to the studio</h1>
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
    setTab('today');
    setToday(null);
    loadMe();
  };

  const backToHub = () => {
    setScreen('hub');
    setTab('today');
  };

  // ---- today's flow
  const start = (brief, track) => {
    const p = today?.progress || {};
    setProd({ brief, track, moment: planWordMoment(brief), plan: {}, title: brief.title });
    setAttempt((a) => a + 1);
    setScreen(!p.read ? 'read' : !p.word ? 'word' : 'call');
  };

  const afterRead = async (stats) => {
    setScreen('word');
    const r = await api.post('/api/kid/read', { briefTitle: prod.brief.title, stats }).catch(() => null);
    applyReward(r);
  };

  const afterWord = async (result) => {
    const unlock = result.type === 'spell' ? FX_UNLOCKS[result.effect] || {} : {};
    setProd((p) => ({ ...p, word: result, title: result.title || p.title, unlock }));
    setScreen('call');
    const r = await api.post('/api/kid/word', { result }).catch(() => null);
    applyReward(r);
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
        coins={kid.coins}
        onHelp={(word) => api.post('/api/kid/help', { word }).then((r) => applyReward({ coins: r.coins })).catch(() => {})}
        onBack={backToHub}
        onUnlocked={afterRead}
      />
    );
  }
  if (screen === 'word' && prod) return <WordMoment brief={prod.brief} moment={prod.moment} onDone={afterWord} />;
  if (screen === 'call' && prod) return <DirectorCall track={prod.track} onBack={backToHub} onDone={afterCall} />;
  if (screen === 'camera' && prod) {
    return (
      <StudioCamera
        brief={prod.brief}
        plan={prod.plan}
        channelName={kid.channelName}
        little={prod.track === 'little'}
        onBack={() => setScreen('call')}
        onDone={afterCamera}
      />
    );
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
          backToHub();
          loadMe();
        }}
      />
    );
  }

  return (
    <Hub kid={kid} tab={tab} onTab={setTab} onSwitch={switchKid}>
      {tab === 'today' && (
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
      {tab === 'crew' && <CrewTab kid={kid} />}
      {tab === 'studio' && <StudioTab kid={kid} onKid={setKid} />}
      {tab === 'channel' && <ChannelTab kid={kid} />}
    </Hub>
  );
}

function Center({ children }) {
  return <div className="screen center">{children}</div>;
}
