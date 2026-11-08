// Keywords: the child's words for the day (read in the brief, the word moment, stories, spelling).
// Who decides, for a child on a date (first match wins):
//   1. their grown-up's list, if today is inside its date window
//   2. the admin's list for everyone (or for their cohort), if today is inside its window
//   3. automatic: a daily pick from the national-curriculum word list for their year group
// The daily brief itself never changes: it's the same for everyone.
import { one, many } from '../db.js';
import { wordsFor, pickWords } from '../data/wordBank.js';
import { dayISO, addDays } from './dates.js';

export const WORDS_PER_DAY = { star: 3, little: 1 };
export const COHORTS = ['all', 'star', 'little'];
export const MAX_WINDOW_DAYS = 366;

export const cohortOf = (kid) => (kid.track === 'little' ? 'little' : 'star');
const dayNumber = (date) => Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86400000);
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
const iso = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));

/** Clean a typed list ("rocket, planet") into lower-case words. */
export function cleanWords(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,;\n]+/);
  return [...new Set(list.map((w) => String(w).toLowerCase().replace(/[^a-z'’-]/g, '').replace(/^[-']+|[-']+$/g, '')).filter((w) => w.length >= 2 && w.length <= 24))].slice(0, 20);
}

// A fixed shuffle per word list, so everyone in a year group gets the same words on the same day.
function seeded(list, seedText) {
  let seed = [...seedText].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0), 2166136261);
  const rand = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** n words starting at a rotating position, so a long list is worked through day by day. */
function rotate(list, n, step) {
  if (list.length <= n) return [...list];
  const start = (((step * n) % list.length) + list.length) % list.length;
  return Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);
}

export function autoWords(yearGroup, cohort, date = dayISO()) {
  const pool = seeded(wordsFor(yearGroup, { little: cohort === 'little' }), `${yearGroup}:${cohort}`);
  return rotate(pool, WORDS_PER_DAY[cohort], dayNumber(date));
}

const shapeSet = (r) => r && { id: r.id, kidId: r.kid_id, cohort: r.cohort, words: r.words, starts: iso(r.starts), ends: iso(r.ends), byAdmin: !r.kid_id };

export async function activeSet(kid, date = dayISO()) {
  const mine = await one(
    `SELECT * FROM keyword_sets WHERE kid_id = $1 AND starts <= $2 AND ends >= $2 ORDER BY created_at DESC LIMIT 1`,
    [kid.id, date]
  );
  if (mine) return { ...shapeSet(mine), source: 'parent' };
  const admin = await one(
    `SELECT * FROM keyword_sets WHERE kid_id IS NULL AND cohort = ANY($1) AND starts <= $2 AND ends >= $2 ORDER BY created_at DESC LIMIT 1`,
    [['all', cohortOf(kid)], date]
  );
  if (admin) return { ...shapeSet(admin), source: 'admin' };
  return null;
}

/** Today's words for a child: { words (for the brief), list (the whole set), source, until }. */
export async function wordsForKid(kid, date = dayISO()) {
  const cohort = cohortOf(kid);
  const set = await activeSet(kid, date);
  if (set) return { words: rotate(set.words, WORDS_PER_DAY[cohort], daysBetween(set.starts, date)), list: set.words, source: set.source, until: set.ends, setId: set.id };
  const words = autoWords(kid.year_group || (cohort === 'little' ? 'R' : 'Y3'), cohort, date);
  return { words, list: words, source: 'auto', until: date };
}

/** Words to practise (spelling, writing): the chosen list first, then the year-group word bank. */
export async function practiceWords(kid, n) {
  const k = await wordsForKid(kid);
  const chosen = pickWords(k.list, Math.min(n, k.list.length));
  const bank = wordsFor(kid.year_group, { little: cohortOf(kid) === 'little' });
  for (const w of pickWords(bank, n * 3)) if (chosen.length < n && !chosen.includes(w)) chosen.push(w);
  return chosen.slice(0, n);
}

/** Check a date window: starts today or later, ends on or after it, at most a year long. */
export function windowProblem(starts, ends, today = dayISO()) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(starts || '') || !re.test(ends || '')) return 'Choose a start and end date';
  if (starts < today) return 'The start date can’t be in the past';
  if (ends < starts) return 'The end date must be on or after the start date';
  if (daysBetween(starts, ends) > MAX_WINDOW_DAYS) return 'Choose an end date within a year';
  return null;
}

export async function setsFor({ kidIds = null, admin = false, from = dayISO() }) {
  const rows = admin
    ? await many(`SELECT * FROM keyword_sets WHERE kid_id IS NULL AND ends >= $1 ORDER BY starts, id`, [from])
    : await many(`SELECT * FROM keyword_sets WHERE kid_id = ANY($1) AND ends >= $2 ORDER BY starts, id`, [kidIds || [], from]);
  return rows.map(shapeSet);
}

export { addDays };
