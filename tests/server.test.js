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

test('trophies at 100 / 1,000 / 10,000 followers', () => {
  assert.deepEqual(trophiesFor(99), []);
  assert.deepEqual(trophiesFor(100), ['rising']);
  assert.deepEqual(trophiesFor(12000), ['rising', 'hitmaker', 'mega']);
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
