// The daily brief: ONE per day for each cohort (older = 'star', young = 'little'), the same for everyone.
// Automatic briefs rotate through a large built-in bank (server/data/briefBank.js). The admin can
// replace any future day's brief (written with AI or by hand). Once a day's brief is saved it never
// changes, so every child gets exactly the same one.
// The child's own keywords are added as a last line ("Your secret words today are…").
import { one, many, q, tx } from '../db.js';
import { BRIEF_BANK } from '../data/briefBank.js';
import { dayISO, addDays } from './dates.js';
import { cohortOf, wordsForKid } from './keywords.js';

export const TRACKS = ['star', 'little'];
const SCOPE = 'all';
const EPOCH = '2026-01-01';
const dayNumber = (date) => Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 86400000);

const rowToBrief = (r) =>
  r && { date: r.brief_date, track: r.track, title: r.title, text: r.body, emoji: r.picture || '⭐', source: r.source };

/** The bank pair for a date: older and young versions of the same idea. */
export function bankPairFor(date) {
  const i = (((dayNumber(date) - dayNumber(EPOCH)) % BRIEF_BANK.length) + BRIEF_BANK.length) % BRIEF_BANK.length;
  const b = BRIEF_BANK[i];
  return {
    star: { date, track: 'star', title: b.title, text: b.older, emoji: b.emoji, source: 'bank' },
    little: { date, track: 'little', title: b.title, text: b.young, emoji: b.emoji, source: 'bank' },
  };
}

async function savedPair(date) {
  const rows = await many(`SELECT * FROM briefs WHERE scope = $1 AND brief_date = $2`, [SCOPE, date]);
  const out = {};
  for (const r of rows) out[r.track] = rowToBrief(r);
  return out;
}

async function writePair(client, date, pair, { replace = false } = {}) {
  for (const t of TRACKS) {
    const b = pair[t];
    await client.query(
      `INSERT INTO briefs (scope, brief_date, track, status, title, body, keywords, chunks, picture, source, approved_at)
       VALUES ($1,$2,$3,'approved',$4,$5,'[]','{}',$6,$7,now())
       ON CONFLICT (scope, brief_date, track) DO ${replace ? `UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, picture = EXCLUDED.picture, source = EXCLUDED.source, approved_at = now()` : 'NOTHING'}`,
      [SCOPE, date, t, b.title, b.text, b.emoji || '⭐', b.source || 'bank']
    );
  }
}

/**
 * The brief everyone gets on a date. The first time a day is asked for, it's fixed in the
 * database (the admin's, or the bank's), so it can never differ between children.
 */
export async function dailyBriefs(date = dayISO()) {
  let saved = await savedPair(date);
  if (saved.star && saved.little) return saved;
  await tx((c) => writePair(c, date, bankPairFor(date)));
  saved = await savedPair(date);
  return saved;
}

/** What's planned for upcoming days (doesn't fix anything in place). */
export async function upcomingBriefs(from, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const saved = await savedPair(date);
    const bank = bankPairFor(date);
    out.push({ date, star: saved.star || bank.star, little: saved.little || bank.little });
  }
  return out;
}

export async function setAdminBriefs(date, pair) {
  await tx((c) => writePair(c, date, { star: { ...pair.star, source: 'admin' }, little: { ...pair.little, source: 'admin' } }, { replace: true }));
}

export async function clearBriefs(date) {
  await q(`DELETE FROM briefs WHERE scope = $1 AND brief_date = $2`, [SCOPE, date]);
}

export async function recentTitles(before, days = 60) {
  const rows = await many(`SELECT DISTINCT title FROM briefs WHERE scope = $1 AND brief_date < $2 AND brief_date >= ($2::date - $3::int)`, [SCOPE, before, days]);
  return rows.map((r) => r.title);
}

function secretLine(words, track) {
  if (!words.length) return '';
  if (track === 'little' || words.length === 1) return `Your secret word is ${words[0]}. Can you say ${words[0]} in your video?`;
  const list = words.length === 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `Your secret words today are ${list}. Can you say them in your video?`;
}

/** Today's brief for a child: the shared brief + their own secret words at the end. */
export async function briefForKid(kid, { track = cohortOf(kid), date = dayISO() } = {}) {
  const b = (await dailyBriefs(date))[track];
  const kw = await wordsForKid(kid, date);
  const words = track === cohortOf(kid) ? kw.words : kw.words.slice(0, track === 'little' ? 1 : 3);
  return {
    id: `daily-${date}-${track}`,
    title: b.title,
    emoji: b.emoji,
    ageGroup: track,
    track,
    text: [b.text, secretLine(words, track)].filter(Boolean).join(' '),
    briefText: b.text,
    keywords: words,
    keywordSource: kw.source,
    chunks: {},
    date,
    source: 'daily',
  };
}
