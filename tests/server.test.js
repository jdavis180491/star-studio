import test from 'node:test';
import assert from 'node:assert/strict';
import { briefProblems } from '../server/ai/claude.js';
import { completePlan } from '../server/ai/director.js';
import { pickWords, wordsFor } from '../server/data/wordBank.js';
import { nextStreak } from '../server/lib/rewards.js';
import { cleanAvatar, trophiesFor } from '../server/lib/catalog.js';
import { cleanEdit, fallbackEdit } from '../server/media/render.js';
import { signedUrl, verifySigned } from '../server/media/signed.js';
import { weekStartISO, addDays } from '../server/lib/dates.js';

test('brief check catches missing keywords and accepts word forms', () => {
  const text = 'The rockets fly to a planet where gravity is upside down, so you have to walk on the ceiling and wave at everyone below you. Show us!';
  assert.deepEqual(briefProblems(text, ['rocket', 'planet', 'gravity'], 'star'), []);
  assert.match(briefProblems(text, ['monster'], 'star')[0], /monster/);
});

test('word bank picks fresh words; Little Stars get CVC words', () => {
  const pool = wordsFor('Y3');
  const picked = pickWords(pool, 3, pool.slice(0, pool.length - 3));
  assert.equal(picked.length, 3);
  for (const w of picked) assert.ok(pool.slice(-3).includes(w));
  assert.ok(wordsFor('R', { little: true }).every((w) => w.length === 3));
});

test('forgiving streak: one missed day is forgiven', () => {
  const today = '2026-11-10';
  assert.equal(nextStreak('2026-11-09', 4, today), 5);
  assert.equal(nextStreak('2026-11-08', 4, today), 5, 'missed one day: still counts');
  assert.equal(nextStreak('2026-11-07', 4, today), 1, 'missed two days: restart');
  assert.equal(nextStreak(today, 4, today), 4, 'same day: no change');
  assert.equal(nextStreak(null, 0, today), 1);
});

test('league week starts on Monday', () => {
  assert.equal(weekStartISO('2026-11-09'), '2026-11-09'); // Monday
  assert.equal(weekStartISO('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('trophies at 50 / 250 / 1,000 Dobs earned', () => {
  assert.deepEqual(trophiesFor(49), []);
  assert.deepEqual(trophiesFor(50), ['rising']);
  assert.deepEqual(trophiesFor(1200), ['rising', 'hitmaker', 'mega']);
});

test('login picture: unicorn allowed, junk ignored', () => {
  assert.equal(cleanAvatar({ icon: 'unicorn' }).icon, 'unicorn');
  assert.equal(cleanAvatar({ icon: '<script>' }).icon, 'face');
  assert.equal(cleanAvatar({}).icon, 'face');
});

test('avatars only wear owned items', () => {
  const a = cleanAvatar({ hat: 'crown', glasses: 'shades', hair: 'curly', skin: 'nope' }, ['glasses-shades']);
  assert.equal(a.hat, null);
  assert.equal(a.glasses, 'shades');
  assert.equal(a.hair, 'curly');
  assert.equal(a.skin, 's3');
});

test('edit plans are clamped inside the clip', () => {
  const e = cleanEdit(
    {
      captions: [{ start: -3, end: 99, text: 'BIG', position: 'top' }, { start: 2, end: 3, text: '' }],
      effects: [{ type: 'explode', start: 1, end: 2 }, { type: 'flash', start: 9, end: 30 }],
      lyrics: ['one', 'two'],
    },
    10,
    { keywords: ['rocket'] }
  );
  assert.equal(e.captions.length, 1);
  assert.equal(e.captions[0].start, 0);
  assert.ok(e.captions[0].end <= 4);
  assert.deepEqual(e.effects.map((x) => x.type), ['flash']);
  assert.ok(e.effects[0].end <= 10);
  assert.deepEqual(e.lyrics, [], 'too few lines → no song');
  const f = cleanEdit(fallbackEdit(5, { title: 'Test', keywords: [] }, { mood: 'funny' }, false), 5, { keywords: [] });
  assert.ok(f.captions.length >= 3);
});

test('director plan always complete', () => {
  assert.deepEqual(completePlan({ mood: 'epic' }), { mood: 'epic', music: 'pop', ending: 'a big surprise finish', weather: 'none', backdrop: 'none', look: 'none' });
});

test('signed media links expire and cannot be tampered with', () => {
  const url = new URL(`http://x${signedUrl('final', 'abc', 60)}`);
  const exp = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');
  assert.ok(verifySigned('final', 'abc', exp, sig));
  assert.equal(verifySigned('final', 'abd', exp, sig), false);
  assert.equal(verifySigned('raw', 'abc', exp, sig), false);
  assert.equal(verifySigned('final', 'abc', '1', sig), false);
});

import { makeSet, mathsSettings } from '../server/lib/maths.js';
import { DOB_VALUES, DOB_ACTIVITIES } from '../server/lib/rewards.js';

test('maths sets follow year group and settings', () => {
  for (let n = 0; n < 30; n++) {
    for (const q of makeSet('addition', 'R', {})) assert.ok(q.answer <= 10 && q.a > 0 && q.b > 0, q.q);
    for (const q of makeSet('subtraction', 'Y1', {})) assert.ok(q.answer >= 0 && q.a <= 40, q.q);
    for (const q of makeSet('subtraction', 'Y5', {})) assert.ok(q.answer >= 0);
    for (const q of makeSet('bonds', 'Y2', { maths: { bonds: [100] } })) assert.ok(q.answer + q.a === 100);
    for (const q of makeSet('times', 'Y3', { maths: { timesTables: [3, 4] } })) assert.ok(q.answer % 3 === 0 || q.answer % 4 === 0);
  }
  const set = makeSet('times', 'Y3', { maths: { timesTables: [9] } });
  assert.equal(new Set(set.map((q) => q.q)).size, 5, 'no repeated questions');
  assert.deepEqual(mathsSettings({ maths: { timesTables: [99], bonds: [] } }), { timesTables: [2, 5, 10], bonds: [10] }, 'bad settings fall back');
});

test('every activity is worth exactly 1 Dob, and the values cannot be changed', () => {
  assert.equal(Object.keys(DOB_VALUES).length, DOB_ACTIVITIES.length);
  assert.ok(Object.values(DOB_VALUES).every((v) => v === 1));
  assert.throws(() => {
    'use strict';
    DOB_VALUES.reading = 5;
  });
});

import { autoWords, cleanWords, windowProblem } from '../server/lib/keywords.js';
import { bankPairFor } from '../server/lib/briefs.js';
import { BRIEF_BANK } from '../server/data/briefBank.js';
import { isAdminEmail } from '../server/lib/admin.js';

test('one brief a day for everyone, from a bank that lasts months', () => {
  assert.ok(BRIEF_BANK.length >= 150);
  const a = bankPairFor('2026-11-10');
  assert.deepEqual(bankPairFor('2026-11-10'), a, 'same day, same brief');
  assert.equal(a.star.title, a.little.title, 'young and older get the same idea');
  const titles = new Set(Array.from({ length: BRIEF_BANK.length }, (_, i) => bankPairFor(addDays('2026-11-10', i)).star.title));
  assert.equal(titles.size, BRIEF_BANK.length, 'no repeats until the whole bank is used');
});

test('automatic keywords: same for the whole year group each day, and they change daily', () => {
  assert.deepEqual(autoWords('Y3', 'star', '2026-11-10'), autoWords('Y3', 'star', '2026-11-10'));
  assert.notDeepEqual(autoWords('Y3', 'star', '2026-11-10'), autoWords('Y3', 'star', '2026-11-11'));
  assert.equal(autoWords('R', 'little', '2026-11-10').length, 1);
  assert.deepEqual(cleanWords('Rocket, planet!  rocket;x'), ['rocket', 'planet']);
  assert.equal(windowProblem('2026-11-10', '2026-11-09', '2026-11-10'), 'The end date must be on or after the start date');
  assert.equal(windowProblem('2026-11-10', '2026-11-17', '2026-11-10'), null);
});

test('admins come from the ADMIN_EMAILS secret', () => {
  const was = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = 'Me@Example.com, other@x.com';
  assert.equal(isAdminEmail('me@example.com'), true);
  assert.equal(isAdminEmail('nobody@x.com'), false);
  process.env.ADMIN_EMAILS = was || '';
  assert.equal(isAdminEmail(''), false);
});

import { levelFor, cleanLevels } from '../server/lib/levels.js';

test('subject levels follow reading unless set', () => {
  const kid = { year_group: 'Y3', settings: { levels: { maths: 'Y5' } } };
  assert.equal(levelFor(kid, 'reading'), 'Y3');
  assert.equal(levelFor(kid, 'maths'), 'Y5');
  assert.equal(levelFor(kid, 'spelling'), 'Y3', 'not set: same as reading');
  assert.deepEqual(cleanLevels({ writing: 'Y9', spelling: 'Y1', maths: '' }), { spelling: 'Y1' });
});

import { minWritingWords } from '../server/routes/learn.js';

test('writing: 5 words for Year 2 and below (by writing level), 15 for older', () => {
  assert.equal(minWritingWords({ year_group: 'Y2', settings: {} }), 5);
  assert.equal(minWritingWords({ year_group: 'R', settings: {} }), 5);
  assert.equal(minWritingWords({ year_group: 'Y3', settings: {} }), 15);
  assert.equal(minWritingWords({ year_group: 'Y4', settings: { levels: { writing: 'Y1' } } }), 5, 'follows the writing level');
});
