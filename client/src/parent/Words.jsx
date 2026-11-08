import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';

const fmt = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const SOURCE = { auto: 'Automatic', admin: 'Set for everyone', parent: 'Set by you' };
const COHORT = { all: 'Everyone', star: 'Older children', little: 'Young children' };

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

/** Word list + start/end dates, shared by the grown-up and admin forms. */
function WordWindowForm({ today, extra, onSave, onCancel, busy, err }) {
  const [words, setWords] = useState('');
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState(plusDays(today, 6));
  return (
    <div className="p-form">
      {extra}
      <label>
        Words (separate with commas)
        <input value={words} placeholder="because, friend, said" onChange={(e) => setWords(e.target.value)} autoCapitalize="none" autoCorrect="off" />
      </label>
      <div className="date-row">
        <label>
          From
          <input type="date" min={today} value={starts} onChange={(e) => setStarts(e.target.value)} />
        </label>
        <label>
          Until (they stop after this day)
          <input type="date" min={starts} value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
      </div>
      {err && <div className="notice">{err}</div>}
      <div className="p-actions">
        <button className="btn primary" disabled={busy} onClick={() => onSave({ words, starts, ends })}>
          Save words
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SetList({ sets, names, onDelete, today }) {
  if (!sets.length) return null;
  return (
    <table className="ptable">
      <tbody>
        {sets.map((s) => (
          <tr key={s.id}>
            <td>
              <b>{s.words.join(', ')}</b>
              <div className="muted small">
                {names(s)} · {s.starts <= today ? 'now' : `from ${fmt(s.starts)}`} until {fmt(s.ends)}
              </div>
            </td>
            <td className="when">
              <button className="btn danger" onClick={() => onDelete(s)}>
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------- Keywords tab (every grown-up)
export function Keywords() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(false);
  const [pick, setPick] = useState([]);
  const { busy, err, run } = useBusy();
  const load = () => api.get('/api/parent/keywords').then(setData);
  useEffect(() => {
    load();
  }, []);
  if (!data) return <div className="muted">Loading…</div>;
  const nameOf = (id) => data.kids.find((k) => k.id === id)?.name || '';

  const save = (v) =>
    run(async () => {
      await api.post('/api/parent/keywords', { ...v, kidIds: pick });
      setForm(false);
      await load();
    });

  return (
    <section>
      <p className="muted">
        Every child gets new words each day, picked automatically for their year group. They read them in the daily brief, the word moment, their
        stories and spelling. You can choose your own words for your child, for as long as you like. The daily brief stays the same for everyone.
      </p>
      {data.kids.map((k) => (
        <div key={k.id} className="p-card row">
          <Avatar avatar={k.avatar} size={52} />
          <div className="grow">
            <h2>
              {k.name} <span className="muted">({k.channelName})</span>
            </h2>
            <div className="word-chips">
              {k.today.map((w) => (
                <span key={w} className="wchip good">
                  {w}
                </span>
              ))}
            </div>
            <div className="muted small">
              Today’s words · {SOURCE[k.source]}
              {k.source !== 'auto' && ` until ${fmt(k.until)}`}
            </div>
          </div>
        </div>
      ))}

      {!form ? (
        <button
          className="btn primary"
          onClick={() => {
            setPick(data.kids.map((k) => k.id));
            setForm(true);
          }}
        >
          + Choose my own words
        </button>
      ) : (
        <div className="p-card">
          <h2>Choose words</h2>
          <WordWindowForm
            today={data.today}
            busy={busy}
            err={err}
            onSave={save}
            onCancel={() => setForm(false)}
            extra={
              <>
                <div className="field-label">For</div>
                <div className="chip-pick">
                  {data.kids.map((k) => (
                    <button key={k.id} type="button" className={`pick ${pick.includes(k.id) ? 'on' : ''}`} onClick={() => setPick(pick.includes(k.id) ? pick.filter((x) => x !== k.id) : [...pick, k.id])}>
                      {k.name}
                    </button>
                  ))}
                </div>
              </>
            }
          />
        </div>
      )}

      {data.sets.length > 0 && (
        <div className="p-card">
          <h2>Your word lists</h2>
          <p className="muted small">If a list has more words than they need in a day, they work through it a few at a time.</p>
          <SetList
            sets={data.sets}
            today={data.today}
            names={(s) => nameOf(s.kidId)}
            onDelete={async (s) => {
              await api.del(`/api/parent/keywords/${s.id}`);
              load();
            }}
          />
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------- Daily briefs tab (admin only)
function BriefEditor({ date, day, onDone }) {
  const [theme, setTheme] = useState('');
  const [draft, setDraft] = useState({ star: { ...day.star }, little: { ...day.little } });
  const { busy, err, run } = useBusy();
  const set = (t, k, v) => setDraft({ ...draft, [t]: { ...draft[t], [k]: v } });
  return (
    <div className="p-form">
      <label>
        Write a new one with AI (optional idea)
        <input value={theme} maxLength={160} placeholder="e.g. a pet that can talk" onChange={(e) => setTheme(e.target.value)} />
      </label>
      <div className="p-actions">
        <button className="btn" disabled={busy} onClick={() => run(async () => setDraft(await api.post('/api/parent/admin/briefs/generate', { theme })))}>
          {busy ? 'Writing…' : '✨ Write with AI'}
        </button>
      </div>
      {['star', 'little'].map((t) => (
        <div key={t} className="brief-edit">
          <div className="field-label">{t === 'star' ? 'Older (7 and above)' : 'Young (5 and below)'}</div>
          <div className="date-row">
            <input className="emoji-in" value={draft[t].emoji} maxLength={4} onChange={(e) => set(t, 'emoji', e.target.value)} />
            <input value={draft[t].title} maxLength={40} placeholder="Title" onChange={(e) => set(t, 'title', e.target.value)} />
          </div>
          <textarea rows={t === 'star' ? 5 : 2} value={draft[t].text} onChange={(e) => set(t, 'text', e.target.value)} />
        </div>
      ))}
      {err && <div className="notice">{err}</div>}
      <div className="p-actions">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.put(`/api/parent/admin/briefs/${date}`, draft);
              onDone();
            })
          }
        >
          Use this for {fmt(date)}
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AdminBriefs() {
  const [data, setData] = useState(null);
  const [kw, setKw] = useState(null);
  const [editing, setEditing] = useState(null);
  const [kwForm, setKwForm] = useState(false);
  const [cohort, setCohort] = useState('all');
  const { busy, err, run } = useBusy();
  const load = () => Promise.all([api.get('/api/parent/admin/briefs').then(setData), api.get('/api/parent/admin/keywords').then(setKw)]);
  useEffect(() => {
    load();
  }, []);
  if (!data || !kw) return <div className="muted">Loading…</div>;

  return (
    <section>
      <p className="muted">
        You’re an admin. Everyone gets the same brief each day: older children get one version and young children a simpler one. Briefs are picked
        automatically. You can replace any day from tomorrow onwards, and everyone gets yours instead.
      </p>
      {data.days.map((d) => {
        const custom = d.star.source === 'admin';
        const isToday = d.date === data.today;
        return (
          <div key={d.date} className="p-card">
            <div className="brief-head">
              <h2>
                {d.star.emoji} {isToday ? 'Today' : fmt(d.date)}: {d.star.title}
              </h2>
              <span className={`tag ${custom ? 'on' : ''}`}>{custom ? 'Your brief' : 'Automatic'}</span>
            </div>
            {editing === d.date ? (
              <BriefEditor date={d.date} day={d} onDone={() => { setEditing(null); load(); }} />
            ) : (
              <>
                <p>
                  <b>Older:</b> {d.star.text}
                </p>
                <p>
                  <b>Young:</b> {d.little.text}
                </p>
                {isToday ? (
                  <div className="muted small">Today’s brief is already out, so it can’t change.</div>
                ) : (
                  <div className="p-actions">
                    <button className="btn" onClick={() => setEditing(d.date)}>
                      Replace
                    </button>
                    {custom && (
                      <button className="btn" onClick={() => run(async () => { await api.del(`/api/parent/admin/briefs/${d.date}`); load(); })}>
                        Go back to automatic
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="p-card">
        <h2>Keywords for everyone</h2>
        <p className="muted">
          Words you set here replace the automatic words for every child until the end date. A child’s own grown-up can still choose different words
          for their child.
        </p>
        <SetList
          sets={kw.sets}
          today={kw.today}
          names={(s) => COHORT[s.cohort]}
          onDelete={(s) => run(async () => { await api.del(`/api/parent/admin/keywords/${s.id}`); load(); })}
        />
        {!kwForm ? (
          <button className="btn primary" onClick={() => setKwForm(true)}>
            + Set keywords for everyone
          </button>
        ) : (
          <WordWindowForm
            today={kw.today}
            busy={busy}
            err={err}
            onCancel={() => setKwForm(false)}
            onSave={(v) =>
              run(async () => {
                await api.post('/api/parent/admin/keywords', { ...v, cohort });
                setKwForm(false);
                load();
              })
            }
            extra={
              <>
                <div className="field-label">For</div>
                <div className="chip-pick">
                  {Object.entries(COHORT).map(([id, label]) => (
                    <button key={id} type="button" className={`pick ${cohort === id ? 'on' : ''}`} onClick={() => setCohort(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            }
          />
        )}
        {!kwForm && err && <div className="notice">{err}</div>}
      </div>
    </section>
  );
}
