// Daily briefs per scope (a crew, or a family not in a crew) and track ('star' | 'little').
import { one, many, q } from '../db.js';
import { sampleBriefs } from '../data/sampleBriefs.js';
import { wordsFor, pickWords } from '../data/wordBank.js';
import { dayISO } from './dates.js';
import { scopeFamilies, familySettings } from './family.js';

export const TRACKS = ['star', 'little'];
export const KEYWORDS_PER_BRIEF = { star: 3, little: 1 };

const rowToBrief = (r) =>
  r && {
    id: r.id,
    scope: r.scope,
    date: r.brief_date,
    track: r.track,
    status: r.status,
    title: r.title,
    text: r.body,
    keywords: r.keywords,
    chunks: r.chunks,
    picture: r.picture,
    source: r.source,
  };

export async function getBrief(scope, date, track) {
  return rowToBrief(await one(`SELECT * FROM briefs WHERE scope = $1 AND brief_date = $2 AND track = $3`, [scope, date, track]));
}

export async function saveBrief(b) {
  const r = await one(
    `INSERT INTO briefs (scope, brief_date, track, status, title, body, keywords, chunks, picture, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (scope, brief_date, track) DO UPDATE SET
       status = EXCLUDED.status, title = EXCLUDED.title, body = EXCLUDED.body, keywords = EXCLUDED.keywords,
       chunks = EXCLUDED.chunks, picture = EXCLUDED.picture, source = EXCLUDED.source,
       approved_at = CASE WHEN EXCLUDED.status = 'approved' THEN now() ELSE NULL END
     RETURNING *`,
    [b.scope, b.date, b.track, b.status, b.title, b.text, JSON.stringify(b.keywords || []), JSON.stringify(b.chunks || {}), b.picture || null, b.source || 'claude']
  );
  return rowToBrief(r);
}

async function recentKeywords(scope, track, beforeDate, days = 6) {
  const rows = await many(
    `SELECT keywords FROM briefs WHERE scope = $1 AND track = $2 AND brief_date < $3 AND brief_date >= ($3::date - $4::int)`,
    [scope, track, beforeDate, days]
  );
  return rows.flatMap((r) => r.keywords);
}

/**
 * Keywords for a scope's brief. Every family in a crew gets their words in:
 * we take turns picking one word from each family's list (day list first, then weekly).
 * If nobody has set words, the built-in word bank fills in for the first family's year group.
 */
export async function chooseKeywords(scope, date, track) {
  const n = KEYWORDS_PER_BRIEF[track];
  const families = (await scopeFamilies(scope)).map((f) => familySettings(f.settings));
  const recent = await recentKeywords(scope, track, date);
  const lists = families
    .map((s) => {
      const t = s[track];
      if (t.todayWords?.[date]?.length) return { words: t.todayWords[date], exact: true };
      if (t.weeklyWords?.length) return { words: pickWords(t.weeklyWords, n, recent), exact: false };
      return null;
    })
    .filter(Boolean);
  if (lists.length) {
    const out = [];
    for (let round = 0; out.length < n && round < n; round++) {
      for (const l of lists) if (l.words[round] && !out.includes(l.words[round]) && out.length < n) out.push(l.words[round]);
    }
    return { keywords: out, source: lists.some((l) => l.exact) ? 'day list' : 'weekly list' };
  }
  const year = families[0]?.[track]?.yearGroup || (track === 'little' ? 'R' : 'Y3');
  return { keywords: pickWords(wordsFor(year, { little: track === 'little' }), n, recent), source: 'word bank' };
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
    id: `daily-${b.id}`,
    title: b.title,
    emoji: b.picture || '⭐',
    ageGroup: track,
    track,
    text: b.text,
    keywords: b.keywords,
    chunks: b.chunks || {},
    date: b.date,
    source: 'daily',
  };
}

/** Today's brief for kids: the approved one, or a built-in practice brief until a grown-up approves one. */
export async function briefForKids(scope, track, date = dayISO()) {
  const b = await getBrief(scope, date, track);
  if (b && b.status === 'approved') return toClientBrief(b, track);
  return { ...toClientBrief(sampleFor(track, date), track), date };
}

export async function deleteScopeBriefs(scope) {
  await q(`DELETE FROM briefs WHERE scope = $1`, [scope]);
}
