import React, { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import ReadScreen from './components/ReadScreen.jsx';
import WordMoment, { planWordMoment } from './components/WordMoment.jsx';
import Director from './components/Director.jsx';
import FilmScreen from './components/FilmScreen.jsx';
import Unlocked from './components/Unlocked.jsx';
import { api } from './api.js';
import { loadCoins, saveCoins, logReading } from './store.js';

// Today's shoot: read → word moment → director → film → wrap.
export default function App() {
  const [briefs, setBriefs] = useState(null);
  const [today, setToday] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [screen, setScreen] = useState('home');
  const [brief, setBrief] = useState(null);
  const [stats, setStats] = useState(null);
  const [production, setProduction] = useState({});
  const [moment, setMoment] = useState(null);
  const [coins, setCoins] = useState(loadCoins);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api.get('/api/briefs/samples').then((d) => setBriefs(d.briefs)).catch(() => setLoadError(true));
    api.get('/api/briefs/today').then(setToday).catch(() => setLoadError(true));
  }, []);

  useEffect(() => saveCoins(coins), [coins]);

  const spend = (n) => {
    if (coins < n) return false;
    setCoins((c) => c - n);
    return true;
  };

  const startBrief = (b) => {
    setBrief(b);
    setProduction({});
    setAttempt((a) => a + 1);
    setScreen('read');
  };

  const afterRead = (s) => {
    logReading({ briefId: brief.id, ...s });
    setStats(s);
    setMoment(planWordMoment(brief));
    setScreen('word');
  };

  const home = () => {
    if (production.take?.url) URL.revokeObjectURL(production.take.url);
    setScreen('home');
  };

  if (brief && screen === 'read') {
    return (
      <ReadScreen key={`${brief.id}-${attempt}`} brief={brief} coins={coins} spend={spend} onBack={home} onUnlocked={afterRead} />
    );
  }
  if (brief && screen === 'word') {
    return (
      <WordMoment
        brief={brief}
        moment={moment}
        onDone={(word) => {
          setProduction((p) => ({ ...p, word }));
          setScreen('director');
        }}
      />
    );
  }
  if (brief && screen === 'director') {
    return (
      <Director
        brief={brief}
        onBack={home}
        onDone={(plan) => {
          setProduction((p) => ({ ...p, plan }));
          setScreen('film');
        }}
      />
    );
  }
  if (brief && screen === 'film') {
    return (
      <FilmScreen
        brief={brief}
        plan={production.plan}
        onBack={() => setScreen('director')}
        onDone={(take) => {
          setProduction((p) => ({ ...p, take }));
          setScreen('wrap');
        }}
      />
    );
  }
  if (brief && screen === 'wrap') {
    return (
      <Unlocked brief={brief} stats={stats} production={production} coins={coins} onAgain={() => startBrief(brief)} onHome={home} />
    );
  }
  return <Home today={today} briefs={briefs} loadError={loadError} coins={coins} onPick={startBrief} />;
}
