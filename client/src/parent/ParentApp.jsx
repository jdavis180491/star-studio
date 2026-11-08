import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { DobsLogo as Logo, DobIcon } from '../components/Dob.jsx';
import Avatar from '../components/Avatar.jsx';
import { tokenizeBrief, normalizeWord, isKeywordForm } from '../reading/words.js';
import { playLines, primeDirectorAudio } from '../speech/directorVoice.js';
import { unlockAudio } from '../sfx.js';

const TABS = [
  ['kids', 'Kids'],
  ['dobs', 'Dibbly Dobs'],
  ['approvals', 'Approvals'],
  ['briefs', 'Daily briefs'],
  ['keywords', 'Keywords'],
  ['crews', 'Crews'],
  ['stats', 'Reading stats'],
  ['settings', 'Settings'],
];
const TRACK_NAME = { star: 'Main brief (age 7+)', little: 'Little Stars (age 4-6)' };
const MODE_NAME = { star: 'Main', little: 'Little Stars', family: 'Family channel (both)' };

export default function ParentApp() {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('kids');
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    const m = await api.get('/api/me');
    setMe(m);
    if (m.parentMode) {
      setStatus(await api.get('/api/parent/status'));
      const v = await api.get('/api/parent/videos').catch(() => ({ videos: [] }));
      const l = await api.get('/api/parent/letters').catch(() => ({ letters: [] }));
      setPending(v.videos.filter((x) => x.status === 'submitted').length + l.letters.filter((x) => x.status === 'pending').length);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!me) return <div className="screen center"><div className="loading">Loading…</div></div>;
  if (!me.device) return <Auth onIn={load} />;
  if (!me.parentMode) return <Unlock onIn={load} />;
  if (!status) return <div className="screen center"><div className="loading">Loading…</div></div>;

  const lock = async () => {
    await api.post('/api/auth/lock');
    window.location.href = '/';
  };

  return (
    <div className="screen parent">
      <header className="topbar">
        <Logo small />
        <span className="grown-tag">GROWN-UPS</span>
        <div className="topbar-right">
          <button className="link" onClick={lock}>
            Lock & open kids’ app ↗
          </button>
        </div>
      </header>

      <div className="status-row">
        <Pill on={status.claude} label={status.claude ? 'Claude on' : 'Claude off: add ANTHROPIC_API_KEY'} />
        <Pill on={status.voice} label={status.voice ? 'Director voice on' : 'Voice off: add ELEVENLABS_API_KEY'} />
        <Pill on={status.storage === 'replit'} label={status.storage === 'replit' ? 'Video storage on' : 'Videos on temporary disk: switch on App Storage'} />
        <Pill on={status.transcribe} soft label={status.transcribe ? 'On-camera words: on' : 'On-camera words: off (optional OPENAI_API_KEY)'} />
      </div>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'approvals' && pending > 0 && <span className="count-badge">{pending}</span>}
          </button>
        ))}
      </nav>

      <main className="parent-main">
        {tab === 'kids' && <Kids status={status} />}
        {tab === 'dobs' && <Dobs />}
        {tab === 'approvals' && <Approvals onChange={load} />}
        {tab === 'briefs' && <Briefs status={status} />}
        {tab === 'keywords' && <Keywords status={status} />}
        {tab === 'crews' && <Crews status={status} />}
        {tab === 'stats' && <Stats />}
        {tab === 'settings' && <Settings status={status} />}
      </main>
    </div>
  );
}

function Pill({ on, label, soft }) {
  return <span className={`pill ${on ? 'ok' : soft ? 'soft' : 'off'}`}>{label}</span>;
}

function useAction() {
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const run = async (label, fn) => {
    setBusy(label);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, err, run, setErr };
}

// ------------------------------------------------------------- sign up / log in
function Auth({ onIn }) {
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const { busy, err, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run('…', async () => {
      if (mode === 'signup') await api.post('/api/auth/signup', { email, password, consent });
      else await api.post('/api/auth/login', { email, password });
      onIn();
    });
  };

  return (
    <div className="screen parent login">
      <form className="login-card wide" onSubmit={submit}>
        <Logo />
        <h1>{mode === 'signup' ? 'Create your family account' : 'Welcome back'}</h1>
        <input className="field" type="email" autoComplete="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="field"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={mode === 'signup' ? 'Choose a password (8+ characters)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'signup' && (
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I’m the parent or guardian. I agree that my children’s <b>voice and video</b> are processed by AI services to run the game: Anthropic Claude
              (writing briefs, the Director’s replies and video edits, from speech transcripts), ElevenLabs (the Director’s voice), the device’s speech
              recognition, and optionally OpenAI Whisper (transcribing what’s said on camera). Children’s names are never sent to these services. Videos
              are private to our invite-only crew and I can delete them at any time.
            </span>
          </label>
        )}
        {err && <div className="notice">{err}</div>}
        <button className="big-btn primary" type="submit" disabled={Boolean(busy)}>
          {mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
          {mode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}

function Unlock({ onIn }) {
  const [password, setPassword] = useState('');
  const { busy, err, run } = useAction();
  return (
    <div className="screen parent login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          run('…', async () => {
            await api.post('/api/auth/unlock', { password });
            onIn();
          });
        }}
      >
        <Logo />
        <h1>Grown-ups only</h1>
        <input className="field" type="password" autoCapitalize="none" autoCorrect="off" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {err && <div className="notice">{err}</div>}
        <button className="big-btn primary" type="submit" disabled={Boolean(busy)}>
          Unlock
        </button>
        <a className="link" href="/">
          ← Back to the kids’ app
        </a>
        <button
          type="button"
          className="link"
          onClick={async () => {
            await api.post('/api/auth/logout');
            onIn();
          }}
        >
          Sign out of this iPad
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------- kids
function Kids({ status }) {
  const [kids, setKids] = useState(null);
  const [edit, setEdit] = useState(null);
  const { busy, err, run } = useAction();
  const load = () => api.get('/api/parent/kids').then((d) => setKids(d.kids));
  useEffect(() => {
    load();
  }, []);

  const save = () =>
    run('Saving…', async () => {
      if (edit.id) await api.put(`/api/parent/kids/${edit.id}`, edit);
      else await api.post('/api/parent/kids', edit);
      setEdit(null);
      load();
    });

  const remove = (k) => {
    if (!window.confirm(`Delete ${k.name}'s profile and ALL their videos, scores and reading data? This can't be undone.`)) return;
    run('Deleting…', async () => {
      await api.del(`/api/parent/kids/${k.id}`);
      load();
    });
  };

  if (!kids) return <div className="muted">Loading…</div>;
  return (
    <section>
      <p className="muted">
        Each child logs in on this iPad by tapping their avatar and entering their 4-digit PIN. Their real name stays here; the app and the AI only use the
        channel name.
      </p>
      {kids.map((k) => (
        <div key={k.id} className="p-card row">
          <Avatar avatar={k.avatar} size={64} />
          <div className="grow">
            <h2>{k.channelName}</h2>
            <div className="muted">
              {k.name} · {MODE_NAME[k.track]} · {status.yearGroups.find((y) => y.id === k.yearGroup)?.label} · {k.dobs} Dibbly Dobs
            </div>
          </div>
          <button
            className="btn"
            onClick={() =>
              setEdit({
                id: k.id, name: k.name, channelName: k.channelName, track: k.track, yearGroup: k.yearGroup, pin: '',
                maths: { timesTables: k.settings?.maths?.timesTables || [2, 5, 10], bonds: k.settings?.maths?.bonds || [10] },
              })
            }
          >
            Edit
          </button>
          <button className="btn danger" onClick={() => remove(k)}>
            Delete
          </button>
        </div>
      ))}
      {!edit && (
        <button className="btn primary" onClick={() => setEdit({ name: '', channelName: '', track: 'star', yearGroup: 'Y3', pin: '' })}>
          + Add a child
        </button>
      )}
      {edit && (
        <div className="p-card">
          <h2>{edit.id ? 'Edit profile' : 'New profile'}</h2>
          <div className="p-form">
            <label>
              Child’s name (private: only you see this)
              <input value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label>
              Name in the app (their channel name: friends see this, so don’t use their real name)
              <input value={edit.channelName} maxLength={30} onChange={(e) => setEdit({ ...edit, channelName: e.target.value })} />
            </label>
            <label>
              Mode
              <select value={edit.track} onChange={(e) => setEdit({ ...edit, track: e.target.value, yearGroup: e.target.value === 'little' ? 'R' : edit.yearGroup })}>
                <option value="star">Main (about 7+)</option>
                <option value="little">Little Stars (about 4-6)</option>
                <option value="family">Family channel: siblings share one channel and can play both</option>
              </select>
            </label>
            <label>
              Year group
              <select value={edit.yearGroup} onChange={(e) => setEdit({ ...edit, yearGroup: e.target.value })}>
                {status.yearGroups.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </select>
            </label>
            {edit.maths && (
              <>
                <div className="field-label">Times tables to practise</div>
                <div className="chip-pick">
                  {status.timesTables.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`pick ${edit.maths.timesTables.includes(n) ? 'on' : ''}`}
                      onClick={() =>
                        setEdit({ ...edit, maths: { ...edit.maths, timesTables: edit.maths.timesTables.includes(n) ? edit.maths.timesTables.filter((x) => x !== n) : [...edit.maths.timesTables, n].sort((a, b) => a - b) } })
                      }
                    >
                      ×{n}
                    </button>
                  ))}
                </div>
                <div className="field-label">Number bonds to</div>
                <div className="chip-pick">
                  {status.bondTargets.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`pick ${edit.maths.bonds.includes(n) ? 'on' : ''}`}
                      onClick={() =>
                        setEdit({ ...edit, maths: { ...edit.maths, bonds: edit.maths.bonds.includes(n) ? edit.maths.bonds.filter((x) => x !== n) : [...edit.maths.bonds, n].sort((a, b) => a - b) } })
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="muted small">Addition and subtraction difficulty follows the year group.</div>
              </>
            )}
            <label>
              {edit.id ? 'New 4-digit PIN (leave empty to keep it)' : '4-digit PIN'}
              <input inputMode="numeric" maxLength={4} value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            </label>
          </div>
          {err && <div className="notice">{err}</div>}
          <div className="p-actions">
            <button className="btn primary" onClick={save} disabled={Boolean(busy)}>
              Save
            </button>
            <button className="btn" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------- approvals
function Approvals({ onChange }) {
  const [videos, setVideos] = useState(null);
  const [letters, setLetters] = useState([]);
  const { busy, err, run } = useAction();
  const load = () => {
    api.get('/api/parent/letters').then((d) => setLetters(d.letters));
    return api.get('/api/parent/videos').then((d) => setVideos(d.videos));
  };
  const actLetter = (id, what) => run('…', async () => (await api.post(`/api/parent/letters/${id}/${what}`), await load(), onChange()));
  useEffect(() => {
    load();
  }, []);
  const act = (id, what) =>
    run('…', async () => {
      if (what === 'delete') {
        if (!window.confirm('Delete this video for good?')) return;
        await api.del(`/api/parent/videos/${id}`);
      } else await api.post(`/api/parent/videos/${id}/${what}`);
      await load();
      onChange();
    });
  if (!videos) return <div className="muted">Loading…</div>;
  const label = { submitted: 'Waiting for you', approved: 'Approved', rejected: 'Not approved', ready: 'Edited, not posted', rendering: 'Editing…', uploaded: 'Editing…', failed: 'Edit failed' };
  return (
    <section>
      <p className="muted">Nothing is shown to your child’s crew until you approve it. Crews see approved videos together at the premiere (when everyone has posted, or 6pm).</p>
      {err && <div className="notice">{err}</div>}
      {letters.length > 0 && <h2 className="p-sub">Stories & letters</h2>}
      {letters.map((l) => (
        <div key={l.id} className={`p-card ${l.status === 'pending' ? 'highlight' : ''}`}>
          <div className="p-card-head">
            <h2>
              {l.toMe ? `${l.from} wrote to you` : `${l.from} → ${l.to}`}
            </h2>
            <span className={`badge ${l.status === 'pending' ? 'submitted' : l.status}`}>{l.status === 'pending' ? 'Check before it’s sent' : l.toMe ? 'For you' : l.status}</span>
          </div>
          {l.topic && <div className="muted small">{l.topic}</div>}
          <p className="p-letter">{l.body}</p>
          {l.status === 'pending' && (
            <div className="p-actions">
              <button className="btn primary" onClick={() => actLetter(l.id, 'approve')} disabled={Boolean(busy)}>
                ✓ Send it
              </button>
              <button className="btn" onClick={() => actLetter(l.id, 'reject')} disabled={Boolean(busy)}>
                Don’t send
              </button>
            </div>
          )}
        </div>
      ))}
      <h2 className="p-sub">Star Studio videos</h2>
      {!videos.length && <div className="muted">No videos yet.</div>}
      {videos.map((v) => (
        <div key={v.id} className={`p-card ${v.status === 'submitted' ? 'highlight' : ''}`}>
          <div className="p-card-head">
            <h2>
              {v.title} <span className="muted">· {v.channelName} · {v.date}</span>
            </h2>
            <span className={`badge ${v.status}`}>{label[v.status] || v.status}</span>
          </div>
          {v.finalUrl && <video className="p-video" src={v.finalUrl} poster={v.thumbUrl} controls playsInline preload="none" />}
          <div className="p-actions">
            {v.status === 'submitted' && (
              <>
                <button className="btn primary" onClick={() => act(v.id, 'approve')} disabled={Boolean(busy)}>
                  ✓ Approve
                </button>
                <button className="btn" onClick={() => act(v.id, 'reject')} disabled={Boolean(busy)}>
                  Don’t share
                </button>
              </>
            )}
            {v.rawUrl && (
              <a className="btn" href={v.rawUrl} target="_blank" rel="noreferrer">
                Original clip
              </a>
            )}
            <button className="btn danger" onClick={() => act(v.id, 'delete')} disabled={Boolean(busy)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </section>
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

const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function Briefs({ status }) {
  const [scopes, setScopes] = useState(null);
  const [scope, setScope] = useState(null);
  const [day, setDay] = useState('today');
  const [data, setData] = useState(null);
  const date = day === 'today' ? status.today : status.tomorrow;

  useEffect(() => {
    api.get('/api/parent/briefs/scopes').then((d) => {
      setScopes(d);
      setScope((s) => s || d.scopes[0]?.scope || null);
    });
  }, []);
  const load = useCallback(() => {
    if (!scope) return;
    setData(null);
    api.get(`/api/parent/briefs?scope=${encodeURIComponent(scope)}&date=${date}`).then(setData);
  }, [scope, date]);
  useEffect(load, [load]);

  if (!scopes) return <div className="muted">Loading…</div>;
  if (!scopes.scopes.length) {
    return (
      <section>
        <div className="muted">
          {scopes.hostedElsewhere.length
            ? `Your children's crew (${scopes.hostedElsewhere.join(', ')}) gets its daily brief from the crew's host family.`
            : 'Add a child first.'}
        </div>
      </section>
    );
  }
  return (
    <section>
      <p className="muted">
        Everyone in a crew gets the same brief each day. Approve tomorrow’s the night before. Until you approve one, kids get a built-in practice brief.
      </p>
      {scopes.scopes.length > 1 && (
        <div className="seg">
          {scopes.scopes.map((s) => (
            <button key={s.scope} className={scope === s.scope ? 'on' : ''} onClick={() => setScope(s.scope)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="muted small">For: {scopes.scopes.find((s) => s.scope === scope)?.members.join(', ')}</div>
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
          <BriefCard key={`${scope}-${date}-${track}`} scope={scope} track={track} date={date} brief={data[track]} sample={data.samples[track]} status={status} onChange={load} hasMain={Boolean(data.star)} />
        ))}
    </section>
  );
}

function BriefCard({ scope, track, date, brief, sample, status, onChange, hasMain }) {
  const { busy, err, run } = useAction();
  const [problems, setProblems] = useState([]);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState('');
  const [draft, setDraft] = useState({ title: '', text: '', keywords: '' });

  const generate = () =>
    run('Claude is writing…', async () => {
      const out = await api.post('/api/parent/briefs/generate', { scope, date, track, theme });
      setProblems(out.problems || []);
      onChange();
    });
  const approve = () => run('Approving…', async () => (await api.post('/api/parent/briefs/approve', { scope, date, track }), onChange()));
  const saveEdit = () =>
    run('Saving…', async () => {
      const out = await api.put('/api/parent/briefs', { scope, date, track, ...draft });
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
      {!brief && <div className="muted">Until you approve one, kids get the practice brief “{sample?.title}”.</div>}
      {track === 'little' && !brief && hasMain && <div className="muted">Tip: Claude will make a simple version of today’s main brief.</div>}
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
          <input placeholder="Optional theme (pirates, a talking fridge… or let your child pick tomorrow’s!)" value={theme} maxLength={120} onChange={(e) => setTheme(e.target.value)} />
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
            <button
              className="btn"
              onClick={() => {
                setDraft({ title: brief?.title || '', text: brief?.text || '', keywords: (brief?.keywords || []).join(', ') });
                setEditing(true);
              }}
            >
              ✎ {brief ? 'Edit' : 'Write my own'}
            </button>
            {brief && brief.status !== 'approved' && (
              <button className="btn primary" onClick={approve}>
                Approve for the kids
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- keywords
const asText = (v) => (Array.isArray(v) ? v.join(', ') : v || '');

function Keywords({ status }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.get('/api/parent/settings').then(setSettings);
  }, []);
  if (!settings) return <div className="muted">Loading…</div>;
  const update = (track, patch) => {
    setSaved(false);
    setSettings((s) => ({ ...s, [track]: { ...s[track], ...patch } }));
  };
  const save = async () => {
    setSettings(await api.put('/api/parent/settings', { star: settings.star, little: settings.little }));
    setSaved(true);
  };
  return (
    <section>
      <p className="muted">
        Each daily brief uses {status.keywordsPerBrief.star} main words and {status.keywordsPerBrief.little} Little Stars word, rotating through your list.
        In a crew, every family’s words take turns. Leave a list empty and the built-in phonics word bank suggests words for the year group.
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

function KeywordTrack({ track, s, status, update }) {
  const [dayText, setDayText] = useState(asText(s.todayWords?.[status.tomorrow]));
  const suggest = async () => {
    const { words } = await api.get(`/api/parent/wordbank/suggest?year=${s.yearGroup}&track=${track}&n=${track === 'little' ? 5 : 10}`);
    update({ weeklyWords: words.join(', ') });
  };
  return (
    <div className="p-card">
      <h2>{TRACK_NAME[track]}</h2>
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
          Words for tomorrow only (optional)
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

// ------------------------------------------------------------- crews
function Crews({ status }) {
  const [crews, setCrews] = useState(null);
  const [kids, setKids] = useState([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pick, setPick] = useState([]);
  const { busy, err, run } = useAction();
  const load = () => {
    api.get('/api/parent/crews').then((d) => setCrews(d.crews));
    api.get('/api/parent/kids').then((d) => setKids(d.kids));
  };
  useEffect(load, []);
  if (!crews) return <div className="muted">Loading…</div>;

  const inCrew = new Set(crews.flatMap((c) => c.members.filter((m) => m.mine).map((m) => m.id)));
  const free = kids.filter((k) => !inCrew.has(k.id));
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const Picker = () => (
    <div className="kid-pick">
      {free.map((k) => (
        <button key={k.id} className={`kid-chip ${pick.includes(k.id) ? 'on' : ''}`} onClick={() => toggle(k.id)}>
          <Avatar avatar={k.avatar} size={32} /> {k.channelName}
        </button>
      ))}
    </div>
  );

  return (
    <section>
      <p className="muted">
        A crew is a private group of {2}-{status.maxCrew} friends. Each friend’s parent creates their own account, then joins with your invite code. No
        searching, no strangers, no messages: only sticker reactions and awards.
      </p>
      {err && <div className="notice">{err}</div>}
      {crews.map((c) => (
        <div key={c.id} className="p-card">
          <div className="p-card-head">
            <h2>{c.name}</h2>
            {c.host && (
              <span className="code">
                Invite code: <b>{c.code}</b>
              </span>
            )}
          </div>
          <div className="kid-pick">
            {c.members.map((m) => (
              <span key={m.id} className="kid-chip static">
                <Avatar avatar={m.avatar} size={32} /> {m.channelName} {m.mine && <em>(yours)</em>}
              </span>
            ))}
          </div>
          <div className="p-actions">
            {c.members.some((m) => m.mine) && (
              <button
                className="btn"
                onClick={() =>
                  run('…', async () => {
                    await api.post(`/api/parent/crews/${c.id}/leave`, { kidIds: c.members.filter((m) => m.mine).map((m) => m.id) });
                    load();
                  })
                }
              >
                Take my children out
              </button>
            )}
            {c.host && (
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm('Close this crew for everyone?')) run('…', async () => (await api.del(`/api/parent/crews/${c.id}`), load()));
                }}
              >
                Close crew
              </button>
            )}
          </div>
        </div>
      ))}
      {free.length > 0 && (
        <>
          <div className="p-card">
            <h2>Start a crew</h2>
            <div className="p-form">
              <label>
                Crew name
                <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Sock Squad" />
              </label>
            </div>
            <div className="muted small">Which of your children are in it?</div>
            <Picker />
            <button
              className="btn primary"
              disabled={Boolean(busy)}
              onClick={() =>
                run('…', async () => {
                  await api.post('/api/parent/crews', { name, kidIds: pick });
                  setName('');
                  setPick([]);
                  load();
                })
              }
            >
              Create crew & get invite code
            </button>
          </div>
          <div className="p-card">
            <h2>Join a friend’s crew</h2>
            <div className="p-form">
              <label>
                Invite code
                <input value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
              </label>
            </div>
            <Picker />
            <button
              className="btn primary"
              disabled={Boolean(busy)}
              onClick={() =>
                run('…', async () => {
                  await api.post('/api/parent/crews/join', { code, kidIds: pick });
                  setCode('');
                  setPick([]);
                  load();
                })
              }
            >
              Join crew
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------- stats
function Stats() {
  const [data, setData] = useState(null);
  const [practice, setPractice] = useState({});
  useEffect(() => {
    api.get('/api/parent/stats').then(setData);
    api.get('/api/parent/practice-stats').then((d) => setPractice(Object.fromEntries(d.kids.map((k) => [k.kidId, k]))));
  }, []);
  if (!data) return <div className="muted">Loading…</div>;
  if (!data.kids.length) return <div className="muted">Add a child first.</div>;
  return (
    <section>
      {data.kids.map((s) => (
        <div key={s.kid.id} className="p-card">
          <div className="p-card-head">
            <h2>{s.kid.channelName}</h2>
            <span className="muted">{s.sessions} read-alouds</span>
          </div>
          <div className="stat-grid">
            <div className="pstat">
              <b>{s.wordsRead.week}</b>
              <span>words read this week</span>
            </div>
            <div className="pstat">
              <b>{s.wordsRead.total}</b>
              <span>words read in total</span>
            </div>
            <div className="pstat">
              <b>{s.accuracy == null ? '–' : `${s.accuracy}%`}</b>
              <span>of brief words read</span>
            </div>
            <div className="pstat">
              <b>{s.keywordsMastered.length}</b>
              <span>keywords mastered</span>
            </div>
          </div>
          {practice[s.kid.id] && <PracticeStats p={practice[s.kid.id]} />}
          <h3>Keywords mastered</h3>
          <div className="word-chips">{s.keywordsMastered.length ? s.keywordsMastered.map((w) => <span key={w} className="wchip good">{w}</span>) : <span className="muted">None yet: a keyword is mastered after reading it correctly in two sessions.</span>}</div>
          <h3>Still practising</h3>
          <div className="word-chips">{s.keywordsPractising.map((w) => <span key={w.word} className={`wchip ${w.struggled ? 'warn' : ''}`}>{w.word}</span>)}</div>
          <h3>Words that needed help</h3>
          <div className="word-chips">{s.helpWords.length ? s.helpWords.map((w) => <span key={w.word} className="wchip warn">{w.word} ×{w.times}</span>) : <span className="muted">None so far.</span>}</div>
          {s.recent.length > 0 && (
            <>
              <h3>Recent</h3>
              <table className="ptable">
                <tbody>
                  {s.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td>{r.title}</td>
                      <td>
                        {r.wordsRead}/{r.totalWords} words
                      </td>
                      <td>{r.helped} help</td>
                      <td>{r.skipped ? 'grown-up skip' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------- settings
function Settings({ status }) {
  const [settings, setSettings] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voiceMsg, setVoiceMsg] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState(null);
  const { err, run } = useAction();

  useEffect(() => {
    api.get('/api/parent/settings').then(setSettings);
    if (status.voice) api.get('/api/parent/voices').then((d) => setVoices(d.voices)).catch(() => {});
  }, [status.voice]);
  if (!settings) return <div className="muted">Loading…</div>;

  const test = async () => {
    unlockAudio();
    primeDirectorAudio();
    setVoiceMsg({ text: 'Testing…' });
    try {
      const line = await api.post('/api/parent/voice-test', { voiceId: settings.directorVoiceId || status.defaultVoice });
      setVoiceMsg(line.ok ? { ok: true, text: 'ElevenLabs is working ✓' } : { text: line.hint || 'ElevenLabs did not work, so the iPad voice was used.', detail: line.detail });
      playLines([line]);
    } catch (e) {
      setVoiceMsg({ text: e.message });
    }
  };

  return (
    <section>
      <div className="p-card">
        <h2>Director’s voice</h2>
        <div className="p-form">
          {status.voice ? (
            <select value={settings.directorVoiceId || ''} onChange={(e) => setSettings({ ...settings, directorVoiceId: e.target.value || null })}>
              <option value="">Default (George, British)</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.accent ? ` · ${v.accent}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="muted">Add ELEVENLABS_API_KEY in Replit Secrets to give the Director a real voice.</div>
          )}
          {voiceMsg && (
            <div className={voiceMsg.ok ? 'saved' : 'notice soft'}>
              {voiceMsg.text}
              {voiceMsg.detail && <div className="detail">{voiceMsg.detail}</div>}
            </div>
          )}
          <div className="p-actions">
            <button className="btn" onClick={test}>
              🔊 Test the voice
            </button>
            <button
              className="btn primary"
              onClick={() => run('…', async () => (await api.put('/api/parent/settings', { directorVoiceId: settings.directorVoiceId }), setMsg('Voice saved ✓')))}
            >
              Save voice
            </button>
          </div>
        </div>
      </div>

      <div className="p-card">
        <h2>Change password</h2>
        <div className="p-form">
          <input type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input type="password" placeholder="New password (8+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <button className="btn" onClick={() => run('…', async () => (await api.post('/api/parent/password', pw), setPw({ current: '', next: '' }), setMsg('Password changed ✓')))}>
            Change password
          </button>
        </div>
      </div>

      <div className="p-card">
        <h2>Delete everything</h2>
        <p className="muted">Deletes your account, every child profile, every video and all reading data. This can’t be undone.</p>
        <button
          className="btn danger"
          onClick={() => {
            const password = window.prompt('Type your password to delete your family account and all data:');
            if (password) run('…', async () => (await api.del('/api/parent/account', { password }), (window.location.href = '/')));
          }}
        >
          Delete my account and all data
        </button>
      </div>
      {msg && <div className="saved">{msg}</div>}
      {err && <div className="notice">{err}</div>}
      <p className="muted small">Signed in as {status.email}</p>
    </section>
  );
}

function PracticeStats({ p }) {
  return (
    <>
      <div className="stat-grid">
        <div className="pstat">
          <b>{p.stories}</b>
          <span>stories made ({p.storyReads} reads)</span>
        </div>
        <div className="pstat">
          <b>{p.writing}</b>
          <span>stories & letters written</span>
        </div>
        <div className="pstat">
          <b>{p.spelling.accuracy == null ? '–' : `${p.spelling.accuracy}%`}</b>
          <span>spelling first-time right ({p.spelling.sets} sets)</span>
        </div>
      </div>
      <h3>Maths</h3>
      <div className="word-chips">
        {p.maths.map((m) => (
          <span key={m.type} className="wchip">
            {m.name}: {m.sets ? `${m.accuracy}% · ${m.sets} sets` : 'not tried'}
          </span>
        ))}
      </div>
      <h3>Tricky spellings</h3>
      <div className="word-chips">
        {p.spelling.tricky.length ? p.spelling.tricky.map((w) => <span key={w.word} className="wchip warn">{w.word} ×{w.times}</span>) : <span className="muted">None yet.</span>}
      </div>
    </>
  );
}

// ------------------------------------------------------------- Dibbly Dobs
const TYPE_LABEL = {
  studio: 'Star Studio video', reading: 'Read a story aloud', writing: 'Wrote a story', continue: 'Continued a story',
  award: 'Award from a crew friend', spelling: 'Spelling set', 'maths-addition': 'Maths: addition', 'maths-subtraction': 'Maths: subtraction',
  'maths-bonds': 'Maths: number bonds', 'maths-times': 'Maths: times tables', buy: 'Bought in the app shop', help: 'Word help',
  'parent-good': 'Good behaviour', 'parent-naughty': 'Naughty', 'parent-spent': 'Spent at the shops', 'parent-other': 'Grown-up adjustment',
};

function Dobs() {
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [form, setForm] = useState(null); // { kidId, reason, amount, note }
  const [saved, setSaved] = useState(false);
  const { busy, err, run } = useAction();
  const load = () => api.get('/api/parent/dobs').then(setData);
  useEffect(() => {
    load();
    api.get('/api/parent/dob-rules').then(setRules);
  }, []);
  if (!data || !rules) return <div className="muted">Loading…</div>;

  const submit = () =>
    run('…', async () => {
      await api.post('/api/parent/dobs/adjust', form);
      setForm(null);
      load();
    });

  return (
    <section>
      <p className="muted">
        Children earn Dibbly Dobs instantly when they finish something, using the values you set below. You see exactly what they did, and you can add Dobs for
        good behaviour, take some away for naughty behaviour, or take off what they spend at the shops.
      </p>
      <div className="dob-kids">
        {data.kids.map((k) => (
          <div key={k.id} className="p-card dob-kid">
            <div className="dob-kid-head">
              <Avatar avatar={k.avatar} size={56} />
              <div className="grow">
                <h2>{k.channelName}</h2>
                <div className="dob-big">
                  <DobIcon size={34} /> {k.dobs}
                </div>
              </div>
            </div>
            <div className="p-actions">
              <button className="btn good" onClick={() => setForm({ kidId: k.id, reason: 'good', amount: 1, note: '' })}>
                🌟 Good
              </button>
              <button className="btn danger" onClick={() => setForm({ kidId: k.id, reason: 'naughty', amount: 1, note: '' })}>
                😬 Naughty
              </button>
              <button className="btn" onClick={() => setForm({ kidId: k.id, reason: 'spent', amount: 1, note: '' })}>
                🛍️ Spent
              </button>
            </div>
            {form?.kidId === k.id && (
              <div className="p-form adjust">
                <label>
                  {form.reason === 'good' ? 'Add how many Dobs?' : form.reason === 'spent' ? 'How many Dobs did they spend?' : 'Take away how many Dobs?'}
                  <input type="number" min="1" max="500" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </label>
                <label>
                  What for? (they’ll see this)
                  <input value={form.note} maxLength={120} placeholder={form.reason === 'good' ? 'Tidied their room' : form.reason === 'spent' ? 'Sweets at the shop' : 'Not listening at bedtime'} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
                <div className="p-actions">
                  <button className="btn primary" onClick={submit} disabled={Boolean(busy)}>
                    Save
                  </button>
                  <button className="btn" onClick={() => setForm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {err && <div className="notice">{err}</div>}

      <div className="p-card">
        <h2>What they did</h2>
        {!data.feed.length && <div className="muted">Nothing yet.</div>}
        <table className="ptable feed">
          <tbody>
            {data.feed.map((e) => (
              <tr key={e.id}>
                <td className={`amt ${e.dobs > 0 ? 'plus' : 'minus'}`}>
                  {e.dobs > 0 ? '+' : ''}
                  {e.dobs}
                </td>
                <td>
                  <b>{e.channelName}</b> · {TYPE_LABEL[e.type] || e.type}
                  <div className="muted small">{e.note || e.what}</div>
                </td>
                <td className="when">{new Date(e.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-card">
        <h2>Dob values</h2>
        <p className="muted">How many Dibbly Dobs each activity is worth. Set 0 to give none.</p>
        <div className="rules">
          {rules.activities.map((a) => (
            <label key={a.id} className="rule">
              <span>
                {a.name} <em>({a.hint})</em>
              </span>
              <input
                type="number"
                min="0"
                max="50"
                inputMode="numeric"
                value={rules.rules[a.id]}
                onChange={(e) => {
                  setSaved(false);
                  setRules({ ...rules, rules: { ...rules.rules, [a.id]: e.target.value } });
                }}
              />
            </label>
          ))}
          <label className="rule">
            <span>
              Word help costs <em>(when reading; free if they can’t afford it)</em>
            </span>
            <input type="number" min="0" max="10" inputMode="numeric" value={rules.rules.helpCost} onChange={(e) => { setSaved(false); setRules({ ...rules, rules: { ...rules.rules, helpCost: e.target.value } }); }} />
          </label>
        </div>
        <div className="p-actions">
          <button
            className="btn primary"
            onClick={() =>
              run('…', async () => {
                const out = await api.put('/api/parent/dob-rules', { rules: rules.rules });
                setRules({ ...rules, rules: out.rules });
                setSaved(true);
              })
            }
          >
            Save values
          </button>
          {saved && <span className="saved">Saved ✓</span>}
        </div>
      </div>
    </section>
  );
}
