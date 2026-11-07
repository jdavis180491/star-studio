import React, { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import ReadScreen from './components/ReadScreen.jsx';
import Unlocked from './components/Unlocked.jsx';
import { loadCoins, saveCoins, logReading } from './store.js';

export default function App() {
  const [briefs, setBriefs] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [screen, setScreen] = useState('home');
  const [brief, setBrief] = useState(null);
  const [result, setResult] = useState(null);
  const [coins, setCoins] = useState(loadCoins);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetch('/api/briefs/samples')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => setBriefs(d.briefs))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => saveCoins(coins), [coins]);

  const spend = (n) => {
    if (coins < n) return false;
    setCoins((c) => c - n);
    return true;
  };

  const startBrief = (b) => {
    setBrief(b);
    setAttempt((a) => a + 1);
    setScreen('read');
  };

  const finish = (stats) => {
    logReading({ briefId: brief.id, ...stats });
    setResult(stats);
    setScreen('unlocked');
  };

  if (screen === 'read' && brief) {
    return (
      <ReadScreen
        key={`${brief.id}-${attempt}`}
        brief={brief}
        coins={coins}
        spend={spend}
        onBack={() => setScreen('home')}
        onUnlocked={finish}
      />
    );
  }
  if (screen === 'unlocked' && brief) {
    return (
      <Unlocked
        brief={brief}
        stats={result}
        coins={coins}
        onAgain={() => startBrief(brief)}
        onHome={() => setScreen('home')}
      />
    );
  }
  return <Home briefs={briefs} loadError={loadError} coins={coins} onPick={startBrief} />;
}
