import React, { useCallback, useEffect, useState } from 'react';
import Video from '../components/Video.jsx';
import { api } from '../api.js';
import { DobsLogo as Logo, DobIcon } from '../components/Dob.jsx';
import Avatar from '../components/Avatar.jsx';
import { tokenizeBrief, normalizeWord, isKeywordForm } from '../reading/words.js';
import { playLines, primeDirectorAudio } from '../speech/directorVoice.js';
import { unlockAudio } from '../sfx.js';
import { PrivacySheet } from './Privacy.jsx';
import NotificationsCard from './Notifications.jsx';
import CameraCheck from './CameraCheck.jsx';
import { Keywords, AdminBriefs } from './Words.jsx';

const TABS = [
  ['kids', 'Kids'],
  ['dobs', 'Dibbly Dobs'],
  ['approvals', 'Approvals'],
  ['briefs', 'Daily briefs', 'admin'],
  ['keywords', 'Keywords'],
  ['crews', 'Crews'],
  ['stats', 'Reading stats'],
  ['settings', 'Settings'],
];
const MODE_NAME = { star: 'Older', little: 'Young', family: 'Family channel' };

export default function ParentApp() {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);
  // A notification can open a tab directly, e.g. /parent?tab=approvals
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(location.search).get('tab');
    return TABS.some(([id]) => id === t) ? t : 'kids';
  });
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

      {!(status.claude && status.voice && status.storage === 'replit') && (
      <div className="status-row">
        {!status.claude && <Pill label="AI is off: add ANTHROPIC_API_KEY" />}
        {!status.voice && <Pill label="Voice is off: add ELEVENLABS_API_KEY" />}
        {status.storage !== 'replit' && (
          <Pill label={`Videos on temporary disk: add the OBJECT_STORAGE_BUCKET_ID secret${status.storageProblem && !/No storage bucket set/.test(status.storageProblem) ? ` (${status.storageProblem.slice(0, 120)})` : ''}`} />
        )}
      </div>
      )}

      <nav className="tabs">
        {TABS.filter(([, , who]) => !who || status.admin).map(([id, label]) => (
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
        {tab === 'briefs' && status.admin && <AdminBriefs />}
        {tab === 'keywords' && <Keywords />}
        {tab === 'crews' && <Crews status={status} />}
        {tab === 'stats' && <Stats />}
        {tab === 'settings' && <Settings status={status} />}
      </main>
    </div>
  );
}

// Settings: is the app hearing the children with ElevenLabs?
function ListeningCard({ status }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post('/api/parent/listen-test');
      setMsg(r.ok ? { ok: true, text: 'ElevenLabs listening is working ✓' } : { text: r.hint, detail: r.detail });
    } catch (e) {
      setMsg({ text: e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-card">
      <h2>👂 Hearing your children</h2>
      <p className="muted">
        {status.listening === 'elevenlabs'
          ? 'The app uses ElevenLabs speech-to-text to hear your children read. If it’s ever unavailable, the iPad’s own recognition takes over automatically.'
          : 'Add ELEVENLABS_API_KEY in Replit Secrets to hear children with ElevenLabs. For now the iPad’s own recognition is used.'}
      </p>
      <div className="p-actions">
        <button className="btn" onClick={test} disabled={busy}>
          {busy ? 'Testing…' : '🎙️ Test listening'}
        </button>
        {msg?.ok && <span className="saved">{msg.text}</span>}
      </div>
      {msg && !msg.ok && (
        <div className="notice">
          {msg.text}
          {msg.detail && <div className="muted small">{msg.detail}</div>}
        </div>
      )}
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
  const [reading, setReading] = useState(false);
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
          <div className="consent">
            <input id="accept-terms" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <label htmlFor="accept-terms">
              I’m the parent or guardian and I accept the{' '}
              <button type="button" className="link inline" onClick={() => setReading(true)}>
                Terms &amp; Privacy
              </button>
            </label>
          </div>
        )}
        {err && <div className="notice">{err}</div>}
        <button className="big-btn primary" type="submit" disabled={Boolean(busy)}>
          {mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
          {mode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>
      </form>
      {reading && (
        <PrivacySheet
          onAccept={() => {
            setConsent(true);
            setReading(false);
          }}
          onClose={() => setReading(false)}
        />
      )}
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
      {kids.map((k) => (
        <div key={k.id} className="p-card row">
          <Avatar avatar={k.avatar} size={64} />
          <div className="grow">
            <h2>
              {k.name} <span className="muted">({k.channelName})</span>
            </h2>
            <div className="muted">
              {MODE_NAME[k.track]} · {status.yearGroups.find((y) => y.id === k.yearGroup)?.label} · {k.dobs} Dibbly Dobs
              {Object.entries(k.levels || {}).map(([subject, yg]) => (
                <span key={subject}>
                  {' '}
                  · {subject[0].toUpperCase() + subject.slice(1)}: {status.yearGroups.find((y) => y.id === yg)?.label}
                </span>
              ))}
            </div>
          </div>
          <button
            className="btn"
            onClick={() =>
              setEdit({
                id: k.id, name: k.name, channelName: k.channelName, track: k.track, yearGroup: k.yearGroup, pin: '', levels: k.levels || {},
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
        <button className="btn primary" onClick={() => setEdit({ name: '', channelName: '', track: 'star', yearGroup: 'Y3', pin: '', levels: {}, maths: { timesTables: [2, 5, 10], bonds: [10] } })}>
          + Add a child
        </button>
      )}
      {edit && (
        <div className="p-card">
          <h2>{edit.id ? 'Edit profile' : 'New profile'}</h2>
          <div className="p-form">
            <label>
              Child’s name
              <input value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label>
              Nickname (this is the name that appears to others in the app)
              <input value={edit.channelName} maxLength={30} onChange={(e) => setEdit({ ...edit, channelName: e.target.value })} />
            </label>
            <label>
              Star Studio mode
              <select value={edit.track} onChange={(e) => setEdit({ ...edit, track: e.target.value, yearGroup: e.target.value === 'little' ? 'R' : edit.yearGroup })}>
                <option value="little">Young (5 and below)</option>
                <option value="star">Older (7 and above)</option>
                {edit.track === 'family' && <option value="family">Family channel (no longer offered)</option>}
              </select>
            </label>
            <label>
              Reading level
              <select value={edit.yearGroup} onChange={(e) => setEdit({ ...edit, yearGroup: e.target.value })}>
                {status.yearGroups.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="muted small">Writing, spelling and maths follow the reading level. Change any of them if your child is at a different level.</div>
            {[
              ['writing', 'Writing level'],
              ['spelling', 'Spelling level'],
              ['maths', 'Maths level'],
            ].map(([subject, label]) => {
              const reading = status.yearGroups.find((y) => y.id === edit.yearGroup)?.label;
              return (
                <label key={subject}>
                  {label}
                  <select
                    value={edit.levels?.[subject] || ''}
                    onChange={(e) => setEdit({ ...edit, levels: { ...(edit.levels || {}), [subject]: e.target.value || undefined } })}
                  >
                    <option value="">Same as reading ({reading})</option>
                    {status.yearGroups.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
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
                <div className="muted small">Addition and subtraction difficulty follows the maths level.</div>
              </>
            )}
            <label>
              {edit.id ? 'New 4-digit PIN (leave empty to keep it)' : '4-digit PIN'}{' '}
              <span className="muted">(to log in, your child taps their picture, then types this)</span>
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
          {v.finalUrl && <Video className="p-video" src={v.finalUrl} poster={v.thumbUrl} />}
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
      <CameraCheck />
      <ListeningCard status={status} />
      <NotificationsCard />
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
  const [form, setForm] = useState(null); // { kidId, reason, amount, note }
  const { busy, err, run } = useAction();
  const load = () => api.get('/api/parent/dobs').then(setData);
  useEffect(() => {
    load();
  }, []);
  if (!data) return <div className="muted">Loading…</div>;

  const submit = () =>
    run('…', async () => {
      await api.post('/api/parent/dobs/adjust', form);
      setForm(null);
      load();
    });

  return (
    <section>
      <p className="muted">
        Every activity earns 1 Dibbly Dob, the same for every child. Add Dobs for good behaviour, take some away for naughty behaviour, or take off what
        they spend at the shops.
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

    </section>
  );
}
