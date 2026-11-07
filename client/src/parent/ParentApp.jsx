import React, { useCallback, useEffect, useState } from 'react';
import { parentApi, parentToken } from '../api.js';
import { tokenizeBrief, normalizeWord, isKeywordForm } from '../reading/words.js';
import { playLines } from '../speech/directorVoice.js';
import { unlockAudio } from '../sfx.js';
import { Logo } from '../components/Bits.jsx';

const TRACK_NAME = { star: 'Main brief (age 8)', little: 'Little Stars (age 5)' };

export default function ParentApp() {
  const [authed, setAuthed] = useState(Boolean(parentToken.get()));
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('briefs');

  const load = useCallback(() => {
    parentApi
      .get('/api/parent/status')
      .then(setStatus)
      .catch((e) => {
        if (e.status === 401) {
          parentToken.set(null);
          setAuthed(false);
        }
      });
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) return <Login onIn={() => setAuthed(true)} />;

  return (
    <div className="screen parent">
      <header className="topbar">
        <Logo small />
        <span className="grown-tag">GROWN-UPS</span>
        <div className="topbar-right">
          <a className="link" href="/">
            Kids’ app ↗
          </a>
          <button
            className="link"
            onClick={() => {
              parentToken.set(null);
              setAuthed(false);
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {status && (
        <div className="status-row">
          <Pill on={status.claude} label={status.claude ? 'Claude briefs on' : 'Claude off: add ANTHROPIC_API_KEY'} />
          <Pill on={status.voice} label={status.voice ? 'Director voice on' : 'Voice off: add ELEVENLABS_API_KEY'} />
          <Pill on={status.database === 'postgres'} label={status.database === 'postgres' ? 'Database connected' : 'No database: test mode'} />
        </div>
      )}

      <nav className="tabs">
        {[
          ['briefs', 'Daily briefs'],
          ['keywords', 'Keywords'],
          ['studio', 'Studio'],
        ].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="parent-main">
        {status && tab === 'briefs' && <Briefs status={status} />}
        {status && tab === 'keywords' && <Keywords status={status} />}
        {status && tab === 'studio' && <Studio status={status} />}
      </main>
    </div>
  );
}

function Pill({ on, label }) {
  return <span className={`pill ${on ? 'ok' : 'off'}`}>{label}</span>;
}

function Login({ onIn }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const { token } = await parentApi.post('/api/parent/login', { passcode: code });
      parentToken.set(token);
      onIn();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="screen parent login">
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <h1>Grown-ups only</h1>
        <input
          className="title-input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="Passcode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        {err && <div className="notice">{err}</div>}
        <button className="big-btn primary" type="submit">
          Unlock
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------- briefs

function Highlighted({ text, keywords }) {
  const kws = keywords.map(normalizeWord);
  return (
    <p className="p-brief">
      {tokenizeBrief(text).map((t, i) => (
        <React.Fragment key={i}>
          <span className={kws.some((k) => isKeywordForm(k, t.norm)) ? 'p-kw' : ''}>{t.display}</span>{' '}
        </React.Fragment>
      ))}
    </p>
  );
}

function Briefs({ status }) {
  const [day, setDay] = useState('today');
  const date = day === 'today' ? status.today : status.tomorrow;
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    setData(null);
    parentApi.get(`/api/parent/briefs?date=${date}`).then(setData);
  }, [date]);
  useEffect(load, [load]);

  return (
    <section>
      <div className="seg">
        <button className={day === 'today' ? 'on' : ''} onClick={() => setDay('today')}>
          Today · {fmt(status.today)}
        </button>
        <button className={day === 'tomorrow' ? 'on' : ''} onClick={() => setDay('tomorrow')}>
          Tomorrow · {fmt(status.tomorrow)}
        </button>
      </div>
      {!data && <div className="muted">Loading…</div>}
      {data &&
        ['star', 'little'].map((track) => (
          <BriefCard key={`${date}-${track}`} track={track} date={date} brief={data[track]} sample={data.samples[track]} status={status} onChange={load} />
        ))}
    </section>
  );
}

const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function BriefCard({ track, date, brief, sample, status, onChange }) {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [problems, setProblems] = useState([]);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState('');
  const [draft, setDraft] = useState({ title: '', text: '', keywords: '' });

  const run = async (label, fn) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run('Writing…', async () => {
      const out = await parentApi.post('/api/parent/briefs/generate', { date, track, theme });
      setProblems(out.problems || []);
      onChange();
    });

  const approve = () =>
    run('Approving…', async () => {
      await parentApi.post('/api/parent/briefs/approve', { date, track });
      onChange();
    });

  const startEdit = () => {
    setDraft({ title: brief?.title || '', text: brief?.text || '', keywords: (brief?.keywords || []).join(', ') });
    setEditing(true);
  };

  const saveEdit = () =>
    run('Saving…', async () => {
      const out = await parentApi.put('/api/parent/briefs', { date, track, ...draft });
      setProblems(out.problems || []);
      setEditing(false);
      onChange();
    });

  const state = !brief ? 'none' : brief.status;

  return (
    <div className="p-card">
      <div className="p-card-head">
        <h2>{TRACK_NAME[track]}</h2>
        <span className={`badge ${state}`}>{state === 'none' ? 'Not written' : state === 'approved' ? 'Approved ✓' : 'Draft: needs approval'}</span>
      </div>

      {!brief && (
        <div className="muted">
          Until you approve one, the kids get the built-in practice brief “{sample?.title}”.
        </div>
      )}

      {brief && !editing && (
        <>
          <div className="p-title">
            {brief.picture} {brief.title}
          </div>
          <Highlighted text={brief.text} keywords={brief.keywords} />
          <div className="p-keywords">Keywords: {brief.keywords.join(', ')}</div>
        </>
      )}

      {editing && (
        <div className="p-form">
          <label>
            Title
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={40} />
          </label>
          <label>
            Brief
            <textarea rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          </label>
          <label>
            Keywords (must appear in the brief)
            <input value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
          </label>
        </div>
      )}

      {problems.length > 0 && <div className="notice soft">{problems.join(' ')}</div>}
      {err && <div className="notice">{err}</div>}

      {!editing && (
        <div className="p-theme">
          <input
            placeholder="Optional theme idea (e.g. pirates, dinosaurs, a talking fridge)"
            value={theme}
            maxLength={120}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>
      )}

      <div className="p-actions">
        {busy ? (
          <span className="muted">{busy}</span>
        ) : editing ? (
          <>
            <button className="btn primary" onClick={saveEdit}>
              Save changes
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={generate} disabled={!status.claude}>
              {brief ? '↻ Write a new one' : '✨ Write with Claude'}
            </button>
            {brief && (
              <button className="btn" onClick={startEdit}>
                ✎ Edit
              </button>
            )}
            {brief && brief.status !== 'approved' && (
              <button className="btn primary" onClick={approve}>
                Approve for the kids
              </button>
            )}
            {!brief && (
              <button className="btn" onClick={startEdit}>
                ✎ Write my own
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- keywords

function Keywords({ status }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    parentApi.get('/api/parent/settings').then(setSettings);
  }, []);
  if (!settings) return <div className="muted">Loading…</div>;

  const update = (track, patch) => {
    setSaved(false);
    setSettings((s) => ({ ...s, [track]: { ...s[track], ...patch } }));
  };

  const save = async () => {
    const out = await parentApi.put('/api/parent/settings', {
      star: settings.star,
      little: settings.little,
    });
    setSettings(out);
    setSaved(true);
  };

  return (
    <section>
      <p className="muted">
        Each daily brief uses {status.keywordsPerBrief.star} of the main words and {status.keywordsPerBrief.little} Little Stars word, rotating through
        your list across the week. Leave a list empty and words are suggested from the built-in phonics word bank for the year group.
      </p>
      {['star', 'little'].map((track) => (
        <KeywordTrack key={track} track={track} s={settings[track]} status={status} update={(p) => update(track, p)} />
      ))}
      <div className="p-actions">
        <button className="btn primary" onClick={save}>
          Save keywords
        </button>
        {saved && <span className="saved">Saved ✓</span>}
      </div>
    </section>
  );
}

const asText = (v) => (Array.isArray(v) ? v.join(', ') : v || '');

function KeywordTrack({ track, s, status, update }) {
  const [dayText, setDayText] = useState(asText(s.todayWords?.[status.tomorrow]));

  const suggest = async () => {
    const { words } = await parentApi.get(`/api/parent/wordbank/suggest?year=${s.yearGroup}&track=${track}&n=${track === 'little' ? 5 : 10}`);
    update({ weeklyWords: words.join(', ') });
  };

  return (
    <div className="p-card">
      <div className="p-card-head">
        <h2>{TRACK_NAME[track]}</h2>
      </div>
      <div className="p-form">
        <label>
          Year group
          <select value={s.yearGroup} onChange={(e) => update({ yearGroup: e.target.value })}>
            {status.yearGroups.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          This week’s words (e.g. the school spelling list)
          <textarea rows={3} value={asText(s.weeklyWords)} onChange={(e) => update({ weeklyWords: e.target.value })} placeholder="because, whisper, monster…" />
        </label>
        <button className="btn small" onClick={suggest}>
          Suggest from word bank
        </button>
        <label>
          Words for tomorrow only (optional, overrides the weekly list)
          <input
            value={dayText}
            onChange={(e) => {
              setDayText(e.target.value);
              update({ todayWords: { ...(s.todayWords || {}), [status.tomorrow]: e.target.value } });
            }}
          />
        </label>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- studio

function Studio({ status }) {
  const [settings, setSettings] = useState(null);
  const [voices, setVoices] = useState([]);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    parentApi.get('/api/parent/settings').then(setSettings);
    if (status.voice) parentApi.get('/api/parent/voices').then((d) => setVoices(d.voices)).catch((e) => setErr(e.message));
  }, [status.voice]);

  if (!settings) return <div className="muted">Loading…</div>;

  const save = async () => {
    const out = await parentApi.put('/api/parent/settings', { channelName: settings.channelName, directorVoiceId: settings.directorVoiceId });
    setSettings(out);
    setSaved(true);
  };

  const test = async () => {
    unlockAudio();
    const line = await parentApi.post('/api/parent/voice-test', { voiceId: settings.directorVoiceId || status.defaultVoice });
    playLines([line]);
  };

  return (
    <section>
      <div className="p-card">
        <div className="p-form">
          <label>
            Channel name (the AI only ever sees this name, never your children’s real names)
            <input value={settings.channelName} maxLength={30} onChange={(e) => setSettings({ ...settings, channelName: e.target.value })} />
          </label>
          <label>
            Director’s voice
            {status.voice ? (
              <select value={settings.directorVoiceId || ''} onChange={(e) => setSettings({ ...settings, directorVoiceId: e.target.value || null })}>
                <option value="">Default (George, British)</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.accent ? ` · ${v.accent}` : ''}
                    {v.description ? ` · ${v.description}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="muted">Add ELEVENLABS_API_KEY in Replit Secrets to give the Director a real voice.</div>
            )}
          </label>
          {err && <div className="notice">{err}</div>}
          <button className="btn small" onClick={test}>
            🔊 Test the voice
          </button>
        </div>
      </div>
      <div className="p-actions">
        <button className="btn primary" onClick={save}>
          Save
        </button>
        {saved && <span className="saved">Saved ✓ (test the voice after saving)</span>}
      </div>
    </section>
  );
}
