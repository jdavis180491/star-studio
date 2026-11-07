import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { briefProblems } from '../server/ai/claude.js';
import { pickWords, wordsFor } from '../server/data/wordBank.js';
import { createFileStore } from '../server/store/file.js';
import { chooseKeywords, briefForKids } from '../server/lib/briefs.js';
import { withDefaults } from '../server/store/defaults.js';

test('brief check catches missing keywords and accepts word forms', () => {
  const text = 'The rockets fly to a planet where gravity is upside down, so you have to walk on the ceiling and wave at everyone below you. Show us!';
  assert.deepEqual(briefProblems(text, ['rocket', 'planet', 'gravity'], 'star'), []);
  assert.match(briefProblems(text, ['monster'], 'star')[0], /monster/);
});

test('word bank picks fresh words', () => {
  const pool = wordsFor('Y3');
  const picked = pickWords(pool, 3, pool.slice(0, pool.length - 3));
  assert.equal(picked.length, 3);
  for (const w of picked) assert.ok(pool.slice(-3).includes(w));
  assert.ok(wordsFor('R', { little: true }).every((w) => w.length === 3));
});

test('keywords come from day list, then weekly list, then word bank', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const store = createFileStore(path.join(dir, 'store.json'));
  let s = withDefaults({});
  const fromBank = await chooseKeywords(store, s, '2026-11-09', 'star');
  assert.equal(fromBank.source, 'word bank');
  assert.equal(fromBank.keywords.length, 3);

  s = withDefaults({ star: { weeklyWords: ['alpha', 'bravo', 'charlie', 'delta'] } });
  const weekly = await chooseKeywords(store, s, '2026-11-09', 'star');
  assert.equal(weekly.source, 'weekly list');
  assert.ok(weekly.keywords.every((k) => s.star.weeklyWords.includes(k)));

  s.star.todayWords = { '2026-11-09': ['zebra', 'yacht'] };
  assert.deepEqual((await chooseKeywords(store, s, '2026-11-09', 'star')).keywords, ['zebra', 'yacht']);
});

test('kids only see approved briefs; drafts fall back to a sample', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
  const store = createFileStore(path.join(dir, 'store.json'));
  const date = '2026-11-09';
  await store.saveBrief({ date, track: 'star', status: 'draft', title: 'Draft', text: 'x', keywords: [] });
  assert.equal((await briefForKids(store, 'star', date)).source, 'sample');
  await store.saveBrief({ date, track: 'star', status: 'approved', title: 'Live', text: 'Go rocket go', keywords: ['rocket'] });
  const b = await briefForKids(store, 'star', date);
  assert.equal(b.source, 'daily');
  assert.equal(b.title, 'Live');
});
