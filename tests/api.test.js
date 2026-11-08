// Full API walkthrough against a real Postgres (set TEST_DATABASE_URL to run it).
// Two families, a crew, a filmed video → auto-edit → post → approval → premiere → awards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const DB = process.env.TEST_DATABASE_URL;
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'x-star-studio': '1', ...(cookie ? { cookie } : {}), ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b || {}),
    put: (u, b, h) => call('PUT', u, b, h),
    del: (u, b) => call('DELETE', u, b || {}),
  };
}

async function waitFor(fn, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test('star studio API end to end', { skip: !DB, timeout: 240000 }, async (t) => {
  const dbName = `sstest_${Date.now()}`;
  const admin = new URL(DB);
  execFileSync('psql', [DB, '-q', '-c', `CREATE DATABASE ${dbName}`]);
  const url = DB.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-data-'));
  const server = spawn(process.execPath, [path.resolve('server/index.js')], {
    cwd: dataDir,
    env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), SESSION_SECRET: 'test', ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: '', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  t.after(() => {
    server.kill();
    try {
      execFileSync('psql', [DB, '-q', '-c', `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
    } catch {
      /* ignore */
    }
  });
  await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 20000);
  void admin;

  // --- Family A signs up, adds a child
  const A = client();
  assert.equal((await A.post('/api/auth/signup', { email: 'a@test.com', password: 'short', consent: true })).status, 400);
  assert.equal((await A.post('/api/auth/signup', { email: 'a@test.com', password: 'password1', consent: false })).status, 400);
  assert.equal((await A.post('/api/auth/signup', { email: 'a@test.com', password: 'password1', consent: true })).status, 200);
  const kidA = (await A.post('/api/parent/kids', { name: 'Real Name A', channelName: 'Sock Squad', pin: '1234', track: 'star', yearGroup: 'Y3' })).data.kid;
  assert.equal(kidA.channelName, 'Sock Squad');

  // CSRF header is required
  const noHeader = await fetch(`${BASE}/api/parent/kids`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);

  // Keywords + a brief written by hand and approved
  await A.put('/api/parent/settings', { star: { weeklyWords: 'rocket, planet, gravity, orbit' } });
  const scopes = (await A.get('/api/parent/briefs/scopes')).data.scopes;
  assert.equal(scopes[0].scope.startsWith('f:'), true);

  // --- Kid A logs in with the PIN (wrong PIN first)
  assert.equal((await A.post('/api/kid/login', { kidId: kidA.id, pin: '9999' })).status, 401);
  assert.equal((await A.post('/api/kid/login', { kidId: kidA.id, pin: '1234' })).status, 200);
  const me = (await A.get('/api/me')).data;
  assert.equal(me.kid.channelName, 'Sock Squad');
  assert.equal(JSON.stringify(me).includes('Real Name A'), false, 'real name never sent to the kids app');

  // --- Family B, crew
  const B = client();
  await B.post('/api/auth/signup', { email: 'b@test.com', password: 'password2', consent: true });
  const kidB = (await B.post('/api/parent/kids', { name: 'Real Name B', channelName: 'Dino Den', pin: '5555', track: 'star' })).data.kid;
  await B.put('/api/parent/settings', { star: { weeklyWords: ['dinosaur', 'roar'] } });
  // A is still in parent mode (signup grants 30 minutes)
  const crew = (await A.post('/api/parent/crews', { name: 'Best Buds', kidIds: [kidA.id] })).data.crew;
  assert.match(crew.code, /^[A-Z0-9]{6}$/);
  assert.equal((await B.post('/api/parent/crews/join', { code: 'NOPE00', kidIds: [kidB.id] })).status, 404);
  assert.equal((await B.post('/api/parent/crews/join', { code: crew.code, kidIds: [kidB.id] })).status, 200);
  assert.equal((await B.post('/api/parent/crews/join', { code: crew.code, kidIds: [kidB.id] })).status, 409, 'one crew per child');

  // Host writes + approves today's crew brief; keywords come from both families
  const scope = `c:${crew.id}`;
  const today = (await A.get('/api/parent/status')).data.today;
  assert.equal((await B.post('/api/parent/briefs/approve', { scope, date: today, track: 'star' })).status, 403, 'only host manages crew brief');
  const put = await A.put('/api/parent/briefs', {
    scope, date: today, track: 'star', title: 'Rocket Run',
    text: 'Your rocket is about to launch to a strange planet full of dinosaurs. Count down from ten in your loudest voice, then float around like there is no gravity at all. Finish with a big dinosaur roar!',
    keywords: 'rocket, planet, dinosaur',
  });
  assert.deepEqual(put.data.problems, []);
  assert.equal((await A.post('/api/parent/briefs/approve', { scope, date: today, track: 'star' })).status, 200);

  // Kid A: today → read → word → help
  const day = (await A.get('/api/kid/today')).data;
  assert.equal(day.briefs.star.title, 'Rocket Run');
  assert.equal(day.crew.name, 'Best Buds');
  const read = (await A.post('/api/kid/read', { briefTitle: 'Rocket Run', stats: { wordsRead: 30, totalWords: 34, helpedWords: ['launch'], keywords: ['rocket', 'planet', 'dinosaur'], keywordsRead: ['rocket', 'planet', 'dinosaur'], keywordsForced: [] } })).data;
  assert.equal(read.gained.dobs, 0, 'reading the script only unlocks the next step');
  assert.equal((await A.post('/api/kid/read', { stats: {} })).data.already, true, 'once a day');
  await A.post('/api/kid/word', { result: { type: 'spell' } });
  const help = (await A.post('/api/kid/help', { word: 'launch' })).data;
  assert.equal(help.paid, false, 'word help is free by default');

  // Director call works without Claude (scripted fallback)
  let plan = {};
  const history = [];
  let turn = (await A.post('/api/kid/director/turn', { history, plan })).data;
  assert.ok(turn.say && turn.line.id);
  for (const answer of ['funny please', 'rock music', 'I fall over in slow motion']) {
    history.push({ who: 'director', text: turn.say }, { who: 'kid', text: answer });
    turn = (await A.post('/api/kid/director/turn', { history, plan: turn.plan })).data;
  }
  assert.equal(turn.done, true);
  assert.equal(turn.plan.mood, 'funny');
  assert.equal(turn.plan.music, 'rock');
  plan = turn.plan;

  // Film: create video, upload a raw clip, wait for the auto-edit
  const clip = path.join(dataDir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=300', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  const vid = (await A.post('/api/kid/videos', { plan, title: 'The Rocket Show', track: 'star' })).data.id;
  const up = await A.put(`/api/kid/videos/${vid}/raw`, fs.readFileSync(clip), { 'content-type': 'video/mp4' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const ready = await waitFor(async () => {
    const v = (await A.get(`/api/kid/videos/${vid}`)).data.video;
    if (v.status === 'failed') throw new Error(v.renderError + log);
    return v.status === 'ready' && v;
  }, 120000);
  assert.ok(ready.finalUrl);
  const media = await A.get(ready.finalUrl);
  assert.equal(media.status, 200);
  assert.ok(media.data.byteLength > 10000);
  // Range requests (Safari) work
  const ranged = await fetch(BASE + ready.finalUrl, { headers: { range: 'bytes=0-99', cookie: '' } });
  assert.equal(ranged.status, 401, 'no session, no video');

  // Remix once
  assert.equal((await A.post(`/api/kid/videos/${vid}/remix`)).status, 200);
  await waitFor(async () => (await A.get(`/api/kid/videos/${vid}`)).data.video.status === 'ready', 120000);
  assert.equal((await A.post(`/api/kid/videos/${vid}/remix`)).status, 409, 'only one remix');

  // Post → Dibbly Dobs (3 by default, doubled on a viral hit); then B can't see it before approval/premiere
  const posted = (await A.post(`/api/kid/videos/${vid}/post`)).data;
  assert.equal(posted.gained.dobs, posted.viral ? 6 : 3);
  assert.equal(posted.streak, 1);
  assert.equal((await A.post('/api/kid/videos', { plan })).status, 409, 'one challenge a day');

  await B.post('/api/kid/login', { kidId: kidB.id, pin: '5555' });
  let feedB = (await B.get('/api/kid/crew')).data;
  const aRow = feedB.feed.find((f) => f.kid.id === kidA.id);
  assert.equal(aRow.state, 'waiting-approval');
  assert.equal(aRow.video, null);
  assert.equal((await B.get(ready.finalUrl)).status, 403, 'crew-mate cannot watch before premiere');

  // Parent A approves. Premiere waits for everyone (unless it's past 6pm)
  const approvals = (await A.get('/api/parent/videos')).data.videos;
  assert.equal(approvals[0].status, 'submitted');
  assert.equal((await A.post(`/api/parent/videos/${vid}/approve`)).status, 200);
  feedB = (await B.get('/api/kid/crew')).data;
  const after6 = feedB.hourNow >= feedB.premiereHour;
  assert.equal(feedB.revealed, after6);

  // B posts too → everyone in → revealed regardless of the time
  const vidB = (await B.post('/api/kid/videos', { plan: { mood: 'epic', music: 'pop' }, title: 'Dino Roar' })).data.id;
  await B.put(`/api/kid/videos/${vidB}/raw`, fs.readFileSync(clip), { 'content-type': 'video/mp4' });
  await waitFor(async () => (await B.get(`/api/kid/videos/${vidB}`)).data.video.status === 'ready', 120000);
  await B.post(`/api/kid/videos/${vidB}/post`);
  // B's parent is in parent mode from signup
  assert.equal((await B.post(`/api/parent/videos/${vidB}/approve`)).status, 200);
  feedB = (await B.get('/api/kid/crew')).data;
  assert.equal(feedB.revealed, true);
  assert.equal((await B.get(ready.finalUrl)).status, 200, 'crew-mate can watch after premiere');

  // Reactions + awards (not to yourself, once a day)
  assert.equal((await B.post('/api/kid/react', { videoId: vid, sticker: '🔥' })).data.on, true);
  assert.equal((await B.post('/api/kid/award', { videoId: vidB, award: 'funniest' })).status, 400);
  assert.equal((await B.post('/api/kid/award', { videoId: vid, award: 'funniest' })).status, 200);
  assert.equal((await B.post('/api/kid/award', { videoId: vid, award: 'dance' })).status, 409);
  assert.equal((await B.get('/api/kid/crew')).data.league, undefined, 'no separate Star Studio league any more');
  const board = (await B.get('/api/kid/leaderboard')).data.rows;
  assert.equal(board.length, 2);
  const aRowBoard = board.find((r) => r.kidId === kidA.id);
  assert.equal(aRowBoard.weekDobs, posted.gained.dobs + 1, 'video Dobs + 1 for the award');

  // Shop: buy, equip, decor; trophies
  const shopBefore = (await A.get('/api/kid/shop')).data;
  assert.equal(shopBefore.dobs, posted.gained.dobs + 1, 'video Dobs + the award Dob');
  const bought = await A.post('/api/kid/shop/buy', { itemId: 'hat-cap' });
  assert.equal(bought.status, 200);
  assert.equal(bought.data.dobs, shopBefore.dobs - 3);
  assert.equal((await A.put('/api/kid/avatar', { avatar: { hat: 'cap', hair: 'curly' } })).data.avatar.hat, 'cap');
  assert.equal((await A.put('/api/kid/avatar', { avatar: { hat: 'crown' } })).data.avatar.hat, null, 'cannot wear unowned items');
  assert.equal((await A.post('/api/kid/shop/buy', { itemId: 'decor-disco' })).status, 402);
  const meA = (await A.get('/api/me')).data.kid;
  assert.deepEqual(meA.trophies, [], 'first trophy needs 50 Dobs earned');
  assert.equal(meA.followers, undefined, 'followers are gone');

  // Stats for the parent
  const stats = (await A.get('/api/parent/stats')).data.kids[0];
  assert.equal(stats.wordsRead.total, 30);
  assert.deepEqual(stats.helpWords[0], { word: 'launch', times: 1 });

  // Parent lock: kids can't get into the dashboard
  await A.post('/api/auth/lock');
  assert.equal((await A.get('/api/parent/kids')).status, 401);
  assert.equal((await A.post('/api/auth/unlock', { password: 'wrong' })).status, 401);
  assert.equal((await A.post('/api/auth/unlock', { password: 'password1' })).status, 200);

  // Delete a video, then the whole child
  assert.equal((await A.del(`/api/parent/videos/${vid}`)).status, 200);
  assert.equal((await B.get(ready.finalUrl)).status, 404);
  assert.equal((await A.del(`/api/parent/kids/${kidA.id}`)).status, 200);
  assert.equal((await A.get('/api/parent/kids')).data.kids.length, 0);
});
