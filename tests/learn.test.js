// Dibbly Dobs learning sections against a real Postgres (set TEST_DATABASE_URL to run).
// Reading, Writing (with cross-family approval + continuing), Spelling, Maths,
// Dob values, good/naughty/spent adjustments and the leaderboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = process.env.TEST_DATABASE_URL;
const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'x-star-studio': '1', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}) };
}

test('Dibbly Dobs learning sections', { skip: !DB, timeout: 120000 }, async (t) => {
  const dbName = `ddtest_${Date.now()}`;
  execFileSync('psql', [DB, '-q', '-c', `CREATE DATABASE ${dbName}`]);
  const url = DB.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const server = spawn(process.execPath, [path.resolve('server/index.js')], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-')),
    env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), SESSION_SECRET: 't', ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: '', REPL_ID: '' },
    stdio: 'ignore',
  });
  t.after(() => {
    server.kill();
    try {
      execFileSync('psql', [DB, '-q', '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
    } catch {
      /* ignore */
    }
  });
  for (let i = 0; i < 80; i++) {
    if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  // Family A: two siblings. Family B: one child. A crew links A1 and B1.
  const A = client();
  await A.post('/api/auth/signup', { email: 'a@x.com', password: 'password1', consent: true });
  const a1 = (await A.post('/api/parent/kids', { name: 'Ann', channelName: 'Ann TV', pin: '1111', track: 'star', yearGroup: 'Y3' })).data.kid;
  const a2 = (await A.post('/api/parent/kids', { name: 'Bob', channelName: 'Bob TV', pin: '2222', track: 'little', yearGroup: 'R' })).data.kid;
  const B = client();
  await B.post('/api/auth/signup', { email: 'b@x.com', password: 'password2', consent: true });
  const b1 = (await B.post('/api/parent/kids', { name: 'Cat', channelName: 'Cat TV', pin: '3333', track: 'star', yearGroup: 'Y4' })).data.kid;
  const crew = (await A.post('/api/parent/crews', { name: 'Pals', kidIds: [a1.id] })).data.crew;
  await B.post('/api/parent/crews/join', { code: crew.code, kidIds: [b1.id] });

  // Grown-up A sets maths settings (Dob values are fixed: 1 each, for every family)
  assert.notEqual((await A.put('/api/parent/dob-rules', { rules: { reading: 50 } })).status, 200, 'grown-ups cannot change Dob values');
  await A.put(`/api/parent/kids/${a1.id}`, { maths: { timesTables: [7], bonds: [20] } });

  await A.post('/api/kid/login', { kidId: a1.id, pin: '1111' });
  const rules = (await A.get('/api/kid/rules')).data;
  assert.ok(Object.values(rules).every((v) => v === 1), 'every activity is worth 1 Dob');
  assert.equal(rules.helpCost, undefined, 'word help never costs Dobs');

  // ---------------- Reading (offline Story Buddy + offline story)
  let turn = (await A.post('/api/kid/story/turn', { history: [], plan: {} })).data;
  const history = [];
  const said = ['a dragon called Zog on the moon', 'he loses his roar'];
  for (let i = 0; i < said.length; i++) {
    assert.equal(turn.done, false, 'Story Buddy asks a question');
    history.push({ who: 'buddy', text: turn.say }, { who: 'kid', text: said[i] });
    turn = (await A.post('/api/kid/story/turn', { history, plan: turn.plan })).data;
  }
  assert.equal(turn.done, true, 'two questions, then it writes the story');
  assert.equal(turn.plan.hero, 'a dragon called Zog on the moon');
  const story = (await A.post('/api/kid/story/create', { ideas: turn.plan })).data.story;
  assert.match(story.text, /dragon called Zog/);
  assert.ok(story.keywords.length >= 1);
  let r = (await A.post(`/api/kid/stories/${story.id}/read`, { stats: { wordsRead: 50, totalWords: 55, keywords: story.keywords, keywordsRead: story.keywords } })).data;
  assert.equal(r.gained.dobs, 1);
  r = (await A.post(`/api/kid/stories/${story.id}/read`, { stats: { wordsRead: 55, totalWords: 55 } })).data;
  assert.equal(r.dobs, 2, 'reading earns every time');
  assert.equal((await A.get('/api/kid/stories')).data.stories[0].reads, 2);

  // ---------------- Writing
  const recips = (await A.get('/api/kid/writing/recipients')).data.recipients;
  assert.deepEqual(recips.map((x) => x.channelName).sort(), ['Bob TV', 'Cat TV', 'My grown-up']);
  assert.equal(recips.find((x) => x.channelName === 'Cat TV').sameFamily, false);
  const topic = (await A.get('/api/kid/writing/topic?to=Cat%20TV')).data;
  assert.match(topic.topic, /Cat TV/);
  assert.equal((await A.post('/api/kid/writing/check', { text: 'I went to the parc becos' })).data.unavailable, true, 'spell check needs Claude');
  // to a sibling: delivered straight away
  const short = await A.post('/api/kid/letters', { to: { kidId: a2.id }, topic: 'Hi', body: 'Dear Bob, a penguin is in the bath.' });
  assert.equal(short.status, 400, 'at least 15 words to send and earn a Dob');
  assert.match(short.data.error, /15 words/);
  r = (await A.post('/api/kid/letters', { to: { kidId: a2.id }, topic: 'Hi', body: 'Dear Bob, a penguin is in the bath and he will not get out because he loves the bubbles.' })).data;
  assert.equal(r.status, 'delivered');
  assert.equal(r.gained.dobs, 1);
  // to a crew friend: waits for grown-up A
  r = (await A.post('/api/kid/letters', { to: { kidId: b1.id }, topic: topic.topic, body: 'Dear Cat, my shoes started talking today and they would not stop singing songs about cheese all day long!' })).data;
  assert.equal(r.status, 'pending');
  // can't write to a stranger
  assert.equal((await A.post('/api/kid/letters', { to: { kidId: 9999 }, body: 'hello there you, this is a story about a big red bus that can fly over the town' })).status, 400);
  // B can't see it yet
  await B.post('/api/kid/login', { kidId: b1.id, pin: '3333' });
  assert.equal((await B.get('/api/kid/letters')).data.inbox.length, 0);
  // grown-up A approves (A is still in parent mode from signup)
  const pending = (await A.get('/api/parent/letters')).data.letters.find((l) => l.status === 'pending');
  assert.equal((await B.post(`/api/parent/letters/${pending.id}/approve`)).status, 404, 'only the sender’s grown-up approves');
  assert.equal((await A.post(`/api/parent/letters/${pending.id}/approve`)).status, 200);
  const inbox = (await B.get('/api/kid/letters')).data.inbox;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].unread, true);
  const thread = (await B.get(`/api/kid/letters/thread/${inbox[0].threadId}`)).data;
  assert.equal(thread.canContinue, true);
  // B continues the story → back to A, waits for B's grown-up
  r = (await B.post('/api/kid/letters', { threadId: inbox[0].threadId, body: 'Then my socks joined in and sang the loudest song you have ever heard in your whole life!' })).data;
  assert.equal(r.status, 'pending');
  const bPending = (await B.get('/api/parent/letters')).data.letters.find((l) => l.status === 'pending');
  await B.post(`/api/parent/letters/${bPending.id}/approve`);
  const aThread = (await A.get(`/api/kid/letters/thread/${inbox[0].threadId}`)).data;
  assert.equal(aThread.parts.length, 2);
  assert.equal(aThread.canContinue, true);

  // ---------------- Spelling
  const sp = (await A.post('/api/kid/spelling/start')).data;
  assert.equal(sp.items.length, 5);
  assert.ok(sp.items.every((it) => it.sentence.includes(it.word) && it.line.id && it.chunks.length));
  assert.equal((await A.post(`/api/kid/practice/${sp.setId}/finish`, { results: [{ correct: true }] })).status, 400, 'must finish all 5');
  r = (await A.post(`/api/kid/practice/${sp.setId}/finish`, { results: sp.items.map((_, i) => ({ correct: i < 4, tries: i + 1, gaveUp: i === 4 })) })).data;
  assert.equal(r.score, 4);
  assert.equal(r.gained.dobs, 1);
  assert.equal((await A.post(`/api/kid/practice/${sp.setId}/finish`, { results: sp.items.map(() => ({ correct: true })) })).status, 409, 'no double claiming');

  // ---------------- Maths (settings respected)
  const times = (await A.post('/api/kid/maths/start', { type: 'times' })).data;
  assert.equal(times.questions.length, 5);
  assert.ok(times.questions.every((q) => q.q.includes('7') && q.answer % 7 === 0), 'only the 7 times table');
  const bonds = (await A.post('/api/kid/maths/start', { type: 'bonds' })).data;
  assert.ok(bonds.questions.every((q) => q.q.endsWith('= 20') && q.answer >= 0 && q.answer <= 20));
  r = (await A.post(`/api/kid/practice/${times.setId}/finish`, { results: times.questions.map(() => ({ correct: true })) })).data;
  assert.equal(r.gained.dobs, 1);
  assert.equal((await A.post('/api/kid/maths/start', { type: 'cake' })).status, 400);
  assert.notEqual((await A.post('/api/kid/help', { word: 'dragon' })).status, 200, 'no paid word help any more');

  // ---------------- Grown-up: good / naughty / spent, and the feed
  r = (await A.post('/api/parent/dobs/adjust', { kidId: a1.id, reason: 'good', amount: 3, note: 'Tidied room' })).data;
  r = (await A.post('/api/parent/dobs/adjust', { kidId: a1.id, reason: 'naughty', amount: 2, note: 'Bedtime fuss' })).data;
  const spent = (await A.post('/api/parent/dobs/adjust', { kidId: a1.id, reason: 'spent', amount: 9999 }));
  assert.equal(spent.status, 400, 'cannot spend more than they have');
  r = (await A.post('/api/parent/dobs/adjust', { kidId: a1.id, reason: 'spent', amount: 5, note: 'Sweets' })).data;
  const feed = (await A.get('/api/parent/dobs')).data.feed;
  assert.equal(feed[0].type, 'parent-spent');
  assert.equal(feed[0].dobs, -5);
  assert.ok(feed.some((e) => e.type === 'reading' && /Read “/.test(e.what)), 'the grown-up sees what they did');
  assert.equal((await B.post('/api/parent/dobs/adjust', { kidId: a1.id, reason: 'good', amount: 1 })).status, 404, 'not your child');
  const hist = (await A.get('/api/kid/dobs')).data.history;
  assert.ok(hist.some((h) => h.note === 'Tidied room'));

  // ---------------- Leaderboard: family + crew
  const board = (await A.get('/api/kid/leaderboard')).data;
  assert.deepEqual(board.rows.map((x) => x.channelName).sort(), ['Ann TV', 'Bob TV', 'Cat TV']);
  assert.equal(board.rows[0].channelName, 'Ann TV');

  // ---------------- Levels per subject: maths at Reception while reading stays at Year 3
  let kid = (await A.put(`/api/parent/kids/${a1.id}`, { levels: { maths: 'R', writing: 'nonsense' } })).data.kid;
  assert.deepEqual(kid.levels, { maths: 'R' }, 'unknown levels mean "same as reading"');
  const easy = (await A.post('/api/kid/maths/start', { type: 'addition' })).data;
  assert.ok(easy.questions.every((q) => q.answer <= 10), 'maths follows its own level');
  kid = (await A.put(`/api/parent/kids/${a1.id}`, { levels: {} })).data.kid;
  assert.deepEqual(kid.levels, {}, 'back to following reading');
  const sayLines = (await A.post('/api/kid/say', { texts: ['dr', 'ag', 'on', 'dragon'] })).data;
  assert.equal(sayLines.lines.length, 4, 'word help is read in the app’s voice');
  assert.ok(sayLines.lines.every((l) => l.id));

  // ---------------- Phone notifications
  let n = (await A.get('/api/parent/notifications')).data;
  assert.ok(n.publicKey.length > 40, 'push key is made automatically');
  assert.deepEqual(n.prefs, { approvals: true, dobs: true }, 'both on by default');
  assert.equal(n.phones, 0);
  assert.equal((await A.post('/api/parent/notifications/subscribe', { subscription: { endpoint: 'http://evil', keys: {} } })).status, 400);
  const sub = { endpoint: 'https://localhost:1/push/abc', keys: { p256dh: 'BOr' + 'x'.repeat(84), auth: 'y'.repeat(22) } };
  assert.equal((await A.post('/api/parent/notifications/subscribe', { subscription: sub, origin: 'https://dobs.example' })).status, 200);
  await A.post('/api/parent/notifications/subscribe', { subscription: sub }); // same phone twice = one phone
  n = (await A.get('/api/parent/notifications')).data;
  assert.equal(n.phones, 1);
  assert.equal((await B.get('/api/parent/notifications')).data.phones, 0, 'phones belong to one family');
  assert.equal(n.publicKey, (await B.get('/api/parent/notifications')).data.publicKey, 'one key for the app');
  assert.deepEqual((await A.put('/api/parent/notifications/prefs', { approvals: true, dobs: false })).data.prefs, { approvals: true, dobs: false });
  assert.equal((await A.post('/api/parent/notifications/test')).data.sent, 0, 'an unreachable phone does not crash anything');
  await A.post('/api/parent/notifications/unsubscribe', { endpoint: sub.endpoint });
  assert.equal((await A.get('/api/parent/notifications')).data.phones, 0);

  // ---------------- Stats for the grown-up
  const ps = (await A.get('/api/parent/practice-stats')).data.kids.find((k) => k.kidId === a1.id);
  assert.equal(ps.spelling.sets, 1);
  assert.equal(ps.maths.find((m) => m.type === 'times').accuracy, 100);
  assert.equal(ps.writing, 2);
  assert.deepEqual(ps.mathsSettings.timesTables, [7]);
});

test('trophies count Dobs ever earned, so spending never takes one away', { skip: !DB, timeout: 60000 }, async () => {
  const { tx, one } = await import('../server/db.js');
  const { grant } = await import('../server/lib/rewards.js');
  const dbName = `ddtrophy_${Date.now()}`;
  execFileSync('psql', [DB, '-q', '-c', `CREATE DATABASE ${dbName}`]);
  process.env.DATABASE_URL = DB.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  try {
    const { migrate, getPool } = await import('../server/db.js');
    await migrate();
    const fam = await one(`INSERT INTO families (email, password_hash, consent_at) VALUES ('t@t.t','x',now()) RETURNING id`);
    const kid = await one(`INSERT INTO kids (family_id, name, channel_name, pin_hash) VALUES ($1,'T','T TV','x') RETURNING id`, [fam.id]);
    let r = await tx((c) => grant(c, kid.id, 'reading', { dobs: 49 }));
    assert.deepEqual(r.newTrophies, []);
    r = await tx((c) => grant(c, kid.id, 'reading', { dobs: 2 }));
    assert.deepEqual(r.newTrophies, ['rising']);
    r = await tx((c) => grant(c, kid.id, 'parent-spent', { dobs: -40 }));
    assert.equal(r.dobs, 11);
    const k = await one(`SELECT dobs_earned FROM kids WHERE id = $1`, [kid.id]);
    assert.equal(k.dobs_earned, 51, 'spending does not reduce Dobs earned');
    r = await tx((c) => grant(c, kid.id, 'reading', { dobs: 1 }));
    assert.deepEqual(r.newTrophies, [], 'no repeat trophy after spending');
    await getPool().end();
  } finally {
    execFileSync('psql', [DB, '-q', '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
  }
});
