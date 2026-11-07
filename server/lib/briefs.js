import { sampleBriefs } from '../data/sampleBriefs.js';
import { wordsFor, pickWords } from '../data/wordBank.js';
import { dayISO } from './dates.js';

export const TRACKS = ['star', 'little'];
export const KEYWORDS_PER_BRIEF = { star: 3, little: 1 };

/**
 * Which keywords does the brief for `date` use?
 * 1. Words the parent set for that exact day.
 * 2. Otherwise the parent's weekly list, rotating so the week covers them all.
 * 3. Otherwise suggestions from the built-in word bank for the child's year group.
 */
export async function chooseKeywords(store, settings, date, track) {
  const s = settings[track];
  const n = KEYWORDS_PER_BRIEF[track];
  const dayWords = s.todayWords?.[date];
  if (dayWords?.length) return { keywords: dayWords.slice(0, n), source: 'day list' };
  const recent = await store.recentKeywords(track, date, 6);
  if (s.weeklyWords?.length) return { keywords: pickWords(s.weeklyWords, n, recent), source: 'weekly list' };
  return { keywords: pickWords(wordsFor(s.yearGroup, { little: track === 'little' }), n, recent), source: 'word bank' };
}

export function sampleFor(track, date = dayISO()) {
  const pool = sampleBriefs.filter((b) => (track === 'little' ? b.ageGroup === 'little' : b.ageGroup === 'star'));
  const day = Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86400000);
  return pool[day % pool.length];
}

/** Brief shape the kids' app uses. */
export function toClientBrief(b, track) {
  if (b.ageGroup) return { ...b, track: b.ageGroup === 'little' ? 'little' : 'star', source: 'sample' };
  return {
    id: `daily-${b.date}-${track}`,
    title: b.title,
    emoji: b.picture || '⭐',
    ageGroup: track === 'little' ? 'little' : 'star',
    track,
    text: b.text,
    keywords: b.keywords,
    chunks: b.chunks || {},
    date: b.date,
    source: 'daily',
  };
}

/** The brief kids get today: the parent-approved one, or a built-in sample until one is approved. */
export async function briefForKids(store, track, date = dayISO()) {
  const b = await store.getBrief(date, track);
  if (b && b.status === 'approved') return toClientBrief(b, track);
  return toClientBrief(sampleFor(track, date), track);
}

/** Resolve a brief reference sent by the app ({kind:'daily', track} or {kind:'sample', id}). */
export async function resolveBriefRef(store, ref = {}) {
  if (ref.kind === 'sample') return sampleBriefs.find((b) => b.id === ref.id) || null;
  const track = ref.track === 'little' ? 'little' : 'star';
  return briefForKids(store, track);
}
