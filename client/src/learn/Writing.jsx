import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import { DobReward } from '../components/Dob.jsx';
import { SectionHeader } from './common.jsx';
import { createRecognizer, speechSupported } from '../speech/recognizer.js';
import { say, primeDirectorAudio } from '../speech/say.js';
import { unlockAudio, keywordHit, wrong } from '../sfx.js';

// Same as the server: at least 15 words to send a story and earn its Dob (5 for Year 2 and below).
const minWords = (kid) => (['R', 'Y1', 'Y2'].includes(kid?.settings?.levels?.writing || kid?.yearGroup) ? 5 : 15);

// Writing: write a story to a brother/sister, a crew friend or a grown-up; spell check
// highlights mistakes; friends can continue the story.
export default function Writing({ kid, onBack, onKid }) {
  const [view, setView] = useState('home'); // home | compose | thread | reward
  const [mail, setMail] = useState(null);
  const [box, setBox] = useState('inbox');
  const [thread, setThread] = useState(null);
  const [reward, setReward] = useState(null);

  const load = () => api.get('/api/kid/letters').then(setMail).catch(() => setMail({ inbox: [], sent: [] }));
  useEffect(() => {
    load();
  }, []);

  if (view === 'compose') {
    return (
      <Compose
        kid={kid}
        thread={thread}
        onBack={() => setView(thread ? 'thread' : 'home')}
        onSent={(r) => {
          onKid({ ...kid, dobs: r.dobs });
          setReward(r);
          setView('reward');
        }}
      />
    );
  }
  if (view === 'thread' && thread) {
    return <Thread threadId={thread.threadId} onBack={() => { setView('home'); load(); }} onContinue={() => setView('compose')} />;
  }
  if (view === 'reward' && reward) {
    return (
      <DobReward
        earned={reward.gained?.dobs || 0}
        total={reward.dobs}
        title="SENT!"
        sub={reward.status === 'pending' ? 'A grown-up will check it, then it’s delivered.' : 'Delivered!'}
        onDone={() => {
          setThread(null);
          setView('home');
          load();
        }}
      />
    );
  }

  const list = mail?.[box] || [];
  return (
    <main className="section-main">
      <SectionHeader icon="✏️" title="Writing" onBack={onBack} />
      <button className="hero-tile writing" onClick={() => { setThread(null); setView('compose'); }}>
        <span className="hero-tile-icon">✉️</span>
        <span className="hero-tile-text">
          <small>NEW STORY</small>
          Write a story to someone
        </span>
        <span className="hero-tile-go">GO</span>
      </button>
      <div className="seg">
        <button className={box === 'inbox' ? 'on' : ''} onClick={() => setBox('inbox')}>
          📬 Mailbox {mail?.inbox.some((l) => l.unread) && <span className="count-badge">{mail.inbox.filter((l) => l.unread).length}</span>}
        </button>
        <button className={box === 'sent' ? 'on' : ''} onClick={() => setBox('sent')}>
          📤 Sent
        </button>
      </div>
      {!mail && <div className="loading">Loading…</div>}
      {mail && !list.length && <div className="muted-line">{box === 'inbox' ? 'No stories yet. Write one to a friend!' : 'Nothing sent yet.'}</div>}
      <div className="letter-list">
        {list.map((l) => (
          <button
            key={l.id}
            className={`letter-row ${l.unread ? 'unread' : ''}`}
            onClick={() => {
              setThread(l);
              setView('thread');
            }}
          >
            <Avatar avatar={(box === 'inbox' ? l.from : l.to).avatar} size={46} />
            <span className="letter-text">
              <b>{box === 'inbox' ? `From ${l.from.channelName}` : `To ${l.to.channelName}`}</b>
              <span>{l.topic || l.body.slice(0, 60)}</span>
            </span>
            {box === 'sent' && l.status === 'pending' && <span className="badge submitted">Waiting for a grown-up</span>}
            {box === 'sent' && l.status === 'rejected' && <span className="badge rejected">Not sent</span>}
            {l.unread && <span className="unread-dot" />}
          </button>
        ))}
      </div>
    </main>
  );
}

function Thread({ threadId, onBack, onContinue }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/api/kid/letters/thread/${threadId}`).then(setData);
  }, [threadId]);
  return (
    <main className="section-main">
      <SectionHeader icon="📜" title="Story" onBack={onBack} />
      {!data && <div className="loading">Loading…</div>}
      {data?.parts[0]?.topic && <div className="topic-card small">{data.parts[0].topic}</div>}
      <div className="thread">
        {data?.parts.map((p) => (
          <div key={p.id} className={`bubble ${p.mine ? 'mine' : ''}`}>
            <div className="bubble-who">
              <Avatar avatar={p.from.avatar} size={30} /> {p.from.channelName}
              {p.status === 'pending' && <span className="badge submitted">Waiting for a grown-up</span>}
            </div>
            <p>{p.body}</p>
            <button
              className="listen-small"
              onClick={() => {
                unlockAudio();
                primeDirectorAudio();
                say(p.body);
              }}
            >
              🔊 Listen
            </button>
          </div>
        ))}
      </div>
      {data?.canContinue && (
        <button className="big-btn primary" onClick={onContinue}>
          ✏️ Continue the story
        </button>
      )}
    </main>
  );
}

const tokenize = (text) => text.split(/(\s+)/);
const clean = (w) => w.toLowerCase().replace(/[^a-z'’-]/g, '');

function Compose({ kid, thread, onBack, onSent }) {
  const MIN_WORDS = minWords(kid);
  const [recipients, setRecipients] = useState(null);
  const [to, setTo] = useState(thread ? { continuing: true } : null);
  const [topic, setTopic] = useState(thread ? 'Continue the story!' : '');
  const [tryWords, setTryWords] = useState([]);
  const [text, setText] = useState('');
  const [issues, setIssues] = useState(null); // null = not checked yet
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (!thread) api.get('/api/kid/writing/recipients').then((d) => setRecipients(d.recipients));
  }, [thread]);

  const newTopic = async (who) => {
    const d = await api.get(`/api/kid/writing/topic?to=${encodeURIComponent(who.type === 'parent' ? 'your grown-up' : who.channelName)}&not=${encodeURIComponent(topic)}`);
    setTopic(d.topic);
    setTryWords(d.tryWords);
  };

  const choose = (r) => {
    setTo(r);
    newTopic(r);
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const d = await api.post('/api/kid/writing/check', { text });
      setIssues(d.issues);
      setNote(d.unavailable ? 'Spell check needs Claude switched on, so we skipped it this time.' : d.issues.length ? null : 'No spelling mistakes. Amazing!');
      if (!d.issues.length) keywordHit();
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const fix = (wrongWord, right) => {
    const re = new RegExp(`(^|[^A-Za-z'’])(${wrongWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-z'’])`, 'g');
    setText((t) => t.replace(re, (m, pre, w) => pre + (w[0] === w[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right)));
    setIssues((list) => list.filter((i) => i.word !== wrongWord));
    setOpen(null);
    keywordHit();
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const body = { body: text, topic };
      if (thread) body.threadId = thread.threadId;
      else body.to = to.type === 'parent' ? { parent: true } : { kidId: to.id };
      onSent(await api.post('/api/kid/letters', body));
    } catch (e) {
      setError(e.message);
      setSending(false);
    }
  };

  const wrongSet = useMemo(() => new Map((issues || []).map((i) => [clean(i.word), i])), [issues]);
  const words = text.trim() ? text.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w)).length : 0;
  const enough = words >= MIN_WORDS;

  if (!to) {
    return (
      <main className="section-main">
        <SectionHeader icon="✉️" title="Who’s it for?" onBack={onBack} />
        {!recipients && <div className="loading">Loading…</div>}
        <div className="recipients">
          {recipients?.map((r) => (
            <button key={`${r.type}-${r.id}`} className="recipient" onClick={() => choose(r)}>
              {r.type === 'parent' ? <span className="recipient-icon">🧑‍🍼</span> : <Avatar avatar={r.avatar} size={84} />}
              <span>{r.channelName}</span>
              {!r.sameFamily && <small>crew friend</small>}
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="section-main compose">
      <SectionHeader icon="✏️" title={thread ? 'Continue the story' : `To ${to.channelName}`} onBack={onBack} />
      <div className="topic-card">
        <span>{topic || '…'}</span>
        {!thread && (
          <button className="link" onClick={() => newTopic(to)}>
            🔀 Another idea
          </button>
        )}
      </div>
      {tryWords.length > 0 && (
        <div className="try-words">
          Try to use: {tryWords.map((w) => <span key={w} className="chip">{w}</span>)}
        </div>
      )}

      {issues && issues.length > 0 ? (
        <div className="checked-text" aria-label="Your writing with spelling mistakes highlighted">
          {tokenize(text).map((t, i) => {
            const hit = wrongSet.get(clean(t));
            return hit ? (
              <button key={i} className={`miss ${hit.sure ? '' : 'unsure'}`} onClick={() => setOpen(hit)}>
                {t}
              </button>
            ) : (
              <span key={i}>{t}</span>
            );
          })}
        </div>
      ) : (
        <textarea
          className="write-box"
          value={text}
          placeholder="Once upon a time…"
          onChange={(e) => {
            setText(e.target.value);
            setIssues(null);
            setNote(null);
          }}
          autoCapitalize="sentences"
          spellCheck={false}
          autoCorrect="off"
          autoFocus
        />
      )}
      <div className="write-meta">
        <span className={enough ? 'saved' : ''}>
          {enough ? `${words} words ✓` : `${words} / ${MIN_WORDS} words`}
        </span>
        {issues && issues.length > 0 && <span className="miss-count">{issues.length} to fix: tap the red words</span>}
        {note && <span className="saved">{note}</span>}
      </div>
      {!enough && words > 0 && <div className="muted small">Write at least {MIN_WORDS} words to send it and earn a Dibbly Dob ({MIN_WORDS - words} more to go!)</div>}
      {error && <div className="notice">{error}</div>}
      <div className="row-btns">
        {issues && issues.length > 0 && (
          <button className="big-btn ghost" onClick={() => setIssues(null)}>
            ✎ Keep writing
          </button>
        )}
        {issues === null ? (
          <button className="big-btn primary" onClick={check} disabled={checking || !enough}>
            {checking ? 'Checking…' : '🔍 Check my spelling'}
          </button>
        ) : (
          <button className="big-btn primary" onClick={send} disabled={sending || !enough}>
            {sending ? 'Sending…' : issues.length ? 'Send anyway 🚀' : 'Send it 🚀'}
          </button>
        )}
      </div>
      {open && <FixSheet issue={open} context={text} onFix={fix} onClose={() => setOpen(null)} />}
    </main>
  );
}

/** Tap a red word: see the right spelling. If the app isn't sure, say the word out loud. */
function FixSheet({ issue, context, onFix, onClose }) {
  const [word, setWord] = useState(issue.sure ? issue.suggestion : null);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef(null);

  useEffect(() => () => recRef.current?.stop(), []);

  const sayIt = () => {
    unlockAudio();
    if (!speechSupported()) return;
    const rec = createRecognizer({ lang: 'en-GB' });
    recRef.current = rec;
    let done = false;
    rec.on('state', (s) => setListening(s === 'listening'));
    rec.on('transcript', async ({ text, isFinal }) => {
      if (done || !isFinal) return;
      done = true;
      rec.stop();
      setBusy(true);
      try {
        const d = await api.post('/api/kid/writing/say', { typed: issue.word, said: text, context });
        setWord(d.word);
        say(d.word);
      } catch {
        wrong();
      } finally {
        setBusy(false);
      }
    });
    rec.start();
    setTimeout(() => {
      if (!done) {
        done = true;
        rec.stop();
      }
    }, 6000);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-kicker">YOU WROTE</div>
        <div className="sheet-word wrong-word">{issue.word}</div>
        {word ? (
          <>
            <div className="sheet-kicker">IT’S SPELT</div>
            <div className="sheet-word right-word">{word}</div>
            <div className="sheet-actions">
              <button className="big-btn primary" onClick={() => onFix(issue.word, word)}>
                ✓ Fix it
              </button>
              <button className="big-btn ghost" onClick={() => { primeDirectorAudio(); say(word); }}>
                🔊
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sheet-msg">Hmm, which word did you mean? Say it!</div>
            <div className="sheet-actions">
              <button className={`big-btn primary ${listening ? 'pulse' : ''}`} onClick={sayIt} disabled={busy}>
                {busy ? 'Thinking…' : listening ? 'Listening…' : '🎙️ Say the word'}
              </button>
              <button className="big-btn ghost" onClick={onClose}>
                It’s right
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
